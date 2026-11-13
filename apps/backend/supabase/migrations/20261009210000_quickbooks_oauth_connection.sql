-- QuickBooks Online connection: OAuth state, one company-wide connection and the
-- Builder -> QuickBooks Customer mapping.
--
-- This phase stops after OAuth. Creating invoices is a later slice.
--
-- Unlike Google Calendar (one connection per user), QuickBooks is connected once
-- for the whole company, so the connection table is a singleton. The refresh
-- token lives encrypted in Vault; QuickBooks rotates it on every refresh, so
-- the service-only functions below read and replace it.

begin;

create extension if not exists supabase_vault with schema vault;

-- The OAuth callback cannot carry the ValtrimBilling session JWT. The start
-- function stores only the SHA-256 digest of an opaque, short-lived state value;
-- the public callback must atomically consume that row before any privileged work.
create table valtrim.quickbooks_oauth_states (
  state_hash text primary key
    check (state_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references valtrim.app_users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint quickbooks_oauth_states_expiry_check
    check (expires_at > created_at),
  constraint quickbooks_oauth_states_consumed_check
    check (consumed_at is null or consumed_at >= created_at)
);

create index quickbooks_oauth_states_user_expiry_idx
  on valtrim.quickbooks_oauth_states (user_id, expires_at);

-- `id` is always true, so at most one company can be connected at a time.
create table valtrim.quickbooks_connections (
  id boolean primary key default true check (id),
  realm_id text not null
    check (btrim(realm_id) <> '' and char_length(realm_id) <= 64),
  environment text not null
    check (environment in ('sandbox', 'production')),
  company_name varchar(200),
  item_id text
    check (item_id is null or (btrim(item_id) <> '' and char_length(item_id) <= 64)),
  item_name varchar(200),
  refresh_token_secret_id uuid not null,
  refresh_token_expires_at timestamptz,
  granted_scope text not null
    default 'com.intuit.quickbooks.accounting'
    check (btrim(granted_scope) <> '' and char_length(granted_scope) <= 2000),
  status varchar(20) not null default 'CONNECTED'
    check (status in ('CONNECTED', 'ERROR', 'DISCONNECTED')),
  connected_by uuid references valtrim.app_users(id) on delete set null,
  connected_at timestamptz not null default now(),
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger quickbooks_connections_set_updated_at
before update on valtrim.quickbooks_connections
for each row execute function valtrim.set_updated_at();

-- Removing the connection must not leave a recoverable refresh token behind.
create function private.delete_quickbooks_refresh_token()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets
  where id = old.refresh_token_secret_id;
  return old;
end;
$$;

create trigger quickbooks_connections_delete_refresh_token
after delete on valtrim.quickbooks_connections
for each row execute function private.delete_quickbooks_refresh_token();

-- QuickBooks Customer ids differ between the sandbox company and production, so
-- the mapping is kept per environment instead of as a column on builders.
create table valtrim.builder_quickbooks_customers (
  builder_id bigint not null references valtrim.builders(id) on delete cascade,
  environment text not null
    check (environment in ('sandbox', 'production')),
  customer_id text not null
    check (btrim(customer_id) <> '' and char_length(customer_id) <= 64),
  display_name varchar(200),
  created_by uuid references valtrim.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (builder_id, environment)
);

create trigger builder_quickbooks_customers_set_updated_at
before update on valtrim.builder_quickbooks_customers
for each row execute function valtrim.set_updated_at();

-- Only the Edge Function service client can complete the connection. The
-- function owns the Vault interaction so neither the token nor the decrypted
-- Vault view ever needs Data API exposure.
create function valtrim.complete_quickbooks_connection(
  p_user_id uuid,
  p_realm_id text,
  p_environment text,
  p_company_name text,
  p_item_id text,
  p_item_name text,
  p_refresh_token text,
  p_refresh_token_expires_at timestamptz,
  p_granted_scope text,
  p_last_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_secret_name constant text := 'quickbooks_refresh_token';
begin
  if p_user_id is null
     or not exists (
       select 1
       from valtrim.app_users app_user
       where app_user.id = p_user_id
         and app_user.is_active
         and app_user.role = 'ADMIN'
     ) then
    raise exception 'Only an active administrator can connect QuickBooks'
      using errcode = '42501';
  end if;

  if nullif(btrim(p_realm_id), '') is null
     or char_length(p_realm_id) > 64
     or p_environment not in ('sandbox', 'production')
     or nullif(btrim(p_refresh_token), '') is null
     or char_length(p_refresh_token) > 4096
     or nullif(btrim(p_granted_scope), '') is null
     or char_length(p_granted_scope) > 2000 then
    raise exception 'QuickBooks returned an invalid OAuth connection payload'
      using errcode = '22023';
  end if;

  select connection.refresh_token_secret_id
  into v_secret_id
  from valtrim.quickbooks_connections connection
  for update;

  if v_secret_id is null
     or not exists (select 1 from vault.secrets secret where secret.id = v_secret_id) then
    select secret.id
    into v_secret_id
    from vault.secrets secret
    where secret.name = v_secret_name;
  end if;

  if v_secret_id is null then
    select vault.create_secret(
      p_refresh_token,
      v_secret_name,
      'QuickBooks Online refresh token for the connected company'
    ) into v_secret_id;
  else
    perform vault.update_secret(v_secret_id, p_refresh_token);
  end if;

  insert into valtrim.quickbooks_connections (
    id,
    realm_id,
    environment,
    company_name,
    item_id,
    item_name,
    refresh_token_secret_id,
    refresh_token_expires_at,
    granted_scope,
    status,
    connected_by,
    connected_at,
    last_error
  ) values (
    true,
    btrim(p_realm_id),
    p_environment,
    nullif(btrim(p_company_name), ''),
    nullif(btrim(p_item_id), ''),
    nullif(btrim(p_item_name), ''),
    v_secret_id,
    p_refresh_token_expires_at,
    btrim(p_granted_scope),
    'CONNECTED',
    p_user_id,
    now(),
    nullif(btrim(p_last_error), '')
  )
  on conflict (id) do update
  set realm_id = excluded.realm_id,
      environment = excluded.environment,
      company_name = excluded.company_name,
      item_id = excluded.item_id,
      item_name = excluded.item_name,
      refresh_token_secret_id = excluded.refresh_token_secret_id,
      refresh_token_expires_at = excluded.refresh_token_expires_at,
      granted_scope = excluded.granted_scope,
      status = 'CONNECTED',
      connected_by = excluded.connected_by,
      connected_at = now(),
      last_error = excluded.last_error;

  return true;
end;
$$;

-- Returns what the invoice function needs to call QuickBooks, or null when the
-- company is not connected. The refresh token is decrypted only here.
create function valtrim.get_quickbooks_credentials()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection valtrim.quickbooks_connections%rowtype;
  v_refresh_token text;
begin
  select *
  into v_connection
  from valtrim.quickbooks_connections connection
  where connection.status = 'CONNECTED';

  if not found then
    return null;
  end if;

  select secret.decrypted_secret
  into v_refresh_token
  from vault.decrypted_secrets secret
  where secret.id = v_connection.refresh_token_secret_id;

  if nullif(v_refresh_token, '') is null then
    raise exception 'The QuickBooks refresh token is unavailable; reconnect QuickBooks'
      using errcode = '55000';
  end if;

  return jsonb_build_object(
    'realmId', v_connection.realm_id,
    'environment', v_connection.environment,
    'itemId', v_connection.item_id,
    'refreshToken', v_refresh_token,
    'refreshTokenExpiresAt', v_connection.refresh_token_expires_at
  );
end;
$$;

-- QuickBooks returns a new refresh token on every refresh and the previous one
-- stops being the canonical token, so the latest value must always be stored.
create function valtrim.rotate_quickbooks_refresh_token(
  p_refresh_token text,
  p_refresh_token_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  if nullif(btrim(p_refresh_token), '') is null
     or char_length(p_refresh_token) > 4096 then
    raise exception 'QuickBooks returned an invalid refresh token'
      using errcode = '22023';
  end if;

  select connection.refresh_token_secret_id
  into v_secret_id
  from valtrim.quickbooks_connections connection
  for update;

  if v_secret_id is null then
    return false;
  end if;

  perform vault.update_secret(v_secret_id, p_refresh_token);

  update valtrim.quickbooks_connections
  set refresh_token_expires_at = coalesce(p_refresh_token_expires_at, refresh_token_expires_at),
      status = 'CONNECTED',
      last_error = null;

  return true;
end;
$$;

alter table valtrim.quickbooks_oauth_states enable row level security;
alter table valtrim.quickbooks_connections enable row level security;
alter table valtrim.builder_quickbooks_customers enable row level security;

revoke all on table valtrim.quickbooks_oauth_states
  from public, anon, authenticated;
revoke all on table valtrim.quickbooks_connections
  from public, anon, authenticated;
revoke all on table valtrim.builder_quickbooks_customers
  from public, anon, authenticated;
revoke all on function valtrim.complete_quickbooks_connection(
  uuid, text, text, text, text, text, text, timestamptz, text, text
) from public, anon, authenticated;
revoke all on function valtrim.get_quickbooks_credentials()
  from public, anon, authenticated;
revoke all on function valtrim.rotate_quickbooks_refresh_token(text, timestamptz)
  from public, anon, authenticated;
revoke all on function private.delete_quickbooks_refresh_token()
  from public, anon, authenticated;

grant all on table valtrim.quickbooks_oauth_states to service_role;
grant all on table valtrim.quickbooks_connections to service_role;
grant all on table valtrim.builder_quickbooks_customers to service_role;
grant execute on function valtrim.complete_quickbooks_connection(
  uuid, text, text, text, text, text, text, timestamptz, text, text
) to service_role;
grant execute on function valtrim.get_quickbooks_credentials() to service_role;
grant execute on function valtrim.rotate_quickbooks_refresh_token(text, timestamptz)
  to service_role;

-- Signed-in users may see whether QuickBooks is connected, never the secret id.
grant select (
  id,
  realm_id,
  environment,
  company_name,
  item_id,
  item_name,
  refresh_token_expires_at,
  granted_scope,
  status,
  connected_by,
  connected_at,
  last_error,
  created_at,
  updated_at
) on valtrim.quickbooks_connections to authenticated;

grant select on valtrim.builder_quickbooks_customers to authenticated;

create policy quickbooks_connections_select
on valtrim.quickbooks_connections for select to authenticated
using ((select private.is_active_user()));

create policy builder_quickbooks_customers_select
on valtrim.builder_quickbooks_customers for select to authenticated
using ((select private.is_active_user()));

comment on table valtrim.quickbooks_oauth_states is
  'Short-lived SHA-256 OAuth state digests consumed by the QuickBooks callback.';
comment on table valtrim.quickbooks_connections is
  'Single company-wide QuickBooks Online connection; the refresh token is encrypted in Vault.';
comment on table valtrim.builder_quickbooks_customers is
  'QuickBooks Customer id of each Builder, per environment because sandbox and production ids differ.';
comment on function valtrim.complete_quickbooks_connection(
  uuid, text, text, text, text, text, text, timestamptz, text, text
) is
  'Service-role-only boundary that encrypts a QuickBooks refresh token in Vault and records the connected company.';
comment on function valtrim.get_quickbooks_credentials() is
  'Service-role-only: returns the realm, environment, Product id and decrypted refresh token, or null when not connected.';
comment on function valtrim.rotate_quickbooks_refresh_token(text, timestamptz) is
  'Service-role-only: stores the refresh token QuickBooks returned on the latest refresh.';

notify pgrst, 'reload schema';

commit;
