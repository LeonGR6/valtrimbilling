-- Phase 12: establish the Google Calendar OAuth connection boundary.
--
-- This phase deliberately stops after OAuth and creation of the dedicated
-- Google calendar. Production schedule synchronization remains a later slice.

begin;

create extension if not exists supabase_vault with schema vault;

-- OAuth callbacks cannot carry the ValtrimBilling session JWT. The authenticated
-- start function creates one opaque state value, but only its SHA-256 digest is
-- retained. The public callback must atomically consume that short-lived row
-- before it can use service-role access.
create table valtrim.google_oauth_states (
  state_hash text primary key
    check (state_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references valtrim.app_users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint google_oauth_states_expiry_check
    check (expires_at > created_at),
  constraint google_oauth_states_consumed_check
    check (consumed_at is null or consumed_at >= created_at)
);

create index google_oauth_states_user_expiry_idx
  on valtrim.google_oauth_states (user_id, expires_at);

-- The refresh token itself lives encrypted in Vault. Browser clients receive
-- column-level SELECT grants only for the non-secret connection metadata.
create table valtrim.google_calendar_connections (
  user_id uuid primary key references valtrim.app_users(id) on delete cascade,
  google_calendar_id text not null
    check (btrim(google_calendar_id) <> '' and char_length(google_calendar_id) <= 1024),
  calendar_summary varchar(100) not null
    check (btrim(calendar_summary) <> ''),
  refresh_token_secret_id uuid not null,
  granted_scope text not null
    default 'https://www.googleapis.com/auth/calendar.app.created'
    check (btrim(granted_scope) <> '' and char_length(granted_scope) <= 2000),
  status varchar(20) not null default 'CONNECTED'
    check (status in ('CONNECTED', 'ERROR', 'DISCONNECTED')),
  connected_at timestamptz not null default now(),
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index google_calendar_connections_calendar_uq
  on valtrim.google_calendar_connections (google_calendar_id);

create trigger google_calendar_connections_set_updated_at
before update on valtrim.google_calendar_connections
for each row execute function valtrim.set_updated_at();

-- The connection row owns its Vault secret. Removing an application user or
-- connection must not leave recoverable OAuth credentials behind.
create function private.delete_google_calendar_refresh_token()
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

create trigger google_calendar_connections_delete_refresh_token
after delete on valtrim.google_calendar_connections
for each row execute function private.delete_google_calendar_refresh_token();

-- Only the Edge Function service client can complete this operation. The
-- function owns the Vault interaction so neither token nor decrypted Vault
-- view ever needs Data API exposure.
create function valtrim.complete_google_calendar_connection(
  p_user_id uuid,
  p_google_calendar_id text,
  p_calendar_summary text,
  p_refresh_token text,
  p_granted_scope text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_secret_name text := 'google_calendar_refresh_' || replace(p_user_id::text, '-', '');
begin
  if p_user_id is null
     or not exists (
       select 1
       from valtrim.app_users app_user
       where app_user.id = p_user_id
         and app_user.is_active
         and app_user.role = 'ADMIN'
     ) then
    raise exception 'Only an active administrator can connect Google Calendar'
      using errcode = '42501';
  end if;

  if nullif(btrim(p_google_calendar_id), '') is null
     or char_length(p_google_calendar_id) > 1024
     or nullif(btrim(p_calendar_summary), '') is null
     or char_length(p_calendar_summary) > 100
     or nullif(btrim(p_refresh_token), '') is null
     or char_length(p_refresh_token) > 4096
     or nullif(btrim(p_granted_scope), '') is null
     or char_length(p_granted_scope) > 2000 then
    raise exception 'Google Calendar returned an invalid OAuth connection payload'
      using errcode = '22023';
  end if;

  select connection.refresh_token_secret_id
  into v_secret_id
  from valtrim.google_calendar_connections connection
  where connection.user_id = p_user_id
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
      'Google Calendar offline refresh token for ValtrimBilling user ' || p_user_id::text
    ) into v_secret_id;
  else
    perform vault.update_secret(v_secret_id, p_refresh_token);
  end if;

  insert into valtrim.google_calendar_connections (
    user_id,
    google_calendar_id,
    calendar_summary,
    refresh_token_secret_id,
    granted_scope,
    status,
    connected_at,
    last_error
  ) values (
    p_user_id,
    btrim(p_google_calendar_id),
    btrim(p_calendar_summary),
    v_secret_id,
    btrim(p_granted_scope),
    'CONNECTED',
    now(),
    null
  )
  on conflict (user_id) do update
  set google_calendar_id = excluded.google_calendar_id,
      calendar_summary = excluded.calendar_summary,
      refresh_token_secret_id = excluded.refresh_token_secret_id,
      granted_scope = excluded.granted_scope,
      status = 'CONNECTED',
      connected_at = now(),
      last_error = null;

  return p_user_id;
end;
$$;

alter table valtrim.google_oauth_states enable row level security;
alter table valtrim.google_calendar_connections enable row level security;

revoke all on table valtrim.google_oauth_states
  from public, anon, authenticated;
revoke all on table valtrim.google_calendar_connections
  from public, anon, authenticated;
revoke all on function valtrim.complete_google_calendar_connection(
  uuid, text, text, text, text
) from public, anon, authenticated;
revoke all on function private.delete_google_calendar_refresh_token()
  from public, anon, authenticated;

grant all on table valtrim.google_oauth_states to service_role;
grant all on table valtrim.google_calendar_connections to service_role;
grant execute on function valtrim.complete_google_calendar_connection(
  uuid, text, text, text, text
) to service_role;

grant select (
  user_id,
  google_calendar_id,
  calendar_summary,
  granted_scope,
  status,
  connected_at,
  last_error,
  created_at,
  updated_at
) on valtrim.google_calendar_connections to authenticated;

create policy google_calendar_connections_select_own
on valtrim.google_calendar_connections for select to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_active_user())
);

comment on table valtrim.google_oauth_states is
  'Short-lived SHA-256 OAuth state digests consumed by the Google Calendar callback.';
comment on table valtrim.google_calendar_connections is
  'Per-administrator Google Calendar OAuth connection metadata; refresh tokens are encrypted in Vault.';
comment on function valtrim.complete_google_calendar_connection(
  uuid, text, text, text, text
) is
  'Service-role-only boundary that encrypts a Google refresh token in Vault and records its dedicated calendar.';

notify pgrst, 'reload schema';

commit;
