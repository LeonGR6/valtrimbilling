-- QuickBooks Test (sandbox) and Production side by side, in the same database.
--
-- How it works:
--   * One connection per environment (primary key `environment`); both can stay
--     connected, so switching never means reconnecting. Each keeps its own
--     refresh token in Vault, its own lease and its own Product.
--   * `quickbooks_settings.active_environment` says where NEW invoices go. Only
--     an administrator changes it (logged), and only to an environment that is
--     connected and has its Product.
--   * Each Package remembers the environment it was sent to
--     (`draw_packages.quickbooks_environment`). Everything after the send --
--     void, PDF, payments -- uses THAT environment, never the active one.
--   * The invoice number is typed by the person who sends the invoice, instead
--     of coming from a serial. It must be unused in the same environment.
--   * A Test (sandbox) invoice can be reset: the Package goes back to a clean
--     Draft so it can be sent to Production. The sandbox attempt is kept in an
--     archive. A Production invoice is never reset, only voided.
--   * The Packages already sent to the sandbox are reclassified that way now.
--
-- UPDATEs and DELETEs always filter on a key: pg_safeupdate, loaded for the API
-- roles, rejects them without a WHERE clause.

begin;

-- 1. One connection per environment ------------------------------------------

alter table valtrim.quickbooks_connections
  drop constraint quickbooks_connections_pkey;

alter table valtrim.quickbooks_connections
  drop column id;

alter table valtrim.quickbooks_connections
  add primary key (environment);

-- Each refresh token has its own Vault secret name, so two can coexist.
do $rename$
declare
  v_connection record;
begin
  for v_connection in
    select connection.environment, connection.refresh_token_secret_id
    from valtrim.quickbooks_connections connection
  loop
    perform vault.update_secret(
      v_connection.refresh_token_secret_id,
      new_name => 'quickbooks_refresh_token_' || v_connection.environment
    );
  end loop;
end;
$rename$;

drop function valtrim.acquire_quickbooks_token_lease(uuid, integer);
drop function valtrim.release_quickbooks_token_lease(uuid);
drop function valtrim.get_quickbooks_credentials();
drop function valtrim.rotate_quickbooks_refresh_token(text, timestamptz);

create or replace function valtrim.complete_quickbooks_connection(
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
  v_secret_name text := 'quickbooks_refresh_token_' || p_environment;
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
  where connection.environment = p_environment
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
      'QuickBooks Online (' || p_environment || ') refresh token'
    ) into v_secret_id;
  else
    perform vault.update_secret(v_secret_id, p_refresh_token);
  end if;

  insert into valtrim.quickbooks_connections (
    environment,
    realm_id,
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
    p_environment,
    btrim(p_realm_id),
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
  on conflict (environment) do update
  set realm_id = excluded.realm_id,
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

-- What a session needs to call QuickBooks, or null when that environment is not
-- connected. The refresh token is decrypted only here.
create function valtrim.get_quickbooks_credentials(p_environment text)
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
  where connection.environment = p_environment
    and connection.status = 'CONNECTED';

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
  p_environment text,
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
  where connection.environment = p_environment
  for update;

  if v_secret_id is null then
    return false;
  end if;

  perform vault.update_secret(v_secret_id, p_refresh_token);

  update valtrim.quickbooks_connections connection
  set refresh_token_expires_at = coalesce(p_refresh_token_expires_at, connection.refresh_token_expires_at),
      status = 'CONNECTED',
      last_error = null
  where connection.environment = p_environment;

  return true;
end;
$$;

-- Returns 'ACQUIRED', 'BUSY' (someone else holds it) or 'NOT_CONNECTED'. Each
-- environment has its own lease, so Test never waits for Production.
create function valtrim.acquire_quickbooks_token_lease(
  p_owner uuid,
  p_environment text,
  p_seconds integer default 30
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_owner is null or p_seconds is null or p_seconds not between 1 and 120 then
    raise exception 'The QuickBooks token lease needs an owner and 1 to 120 seconds'
      using errcode = '22023';
  end if;

  update valtrim.quickbooks_connections connection
  set token_lease_owner = p_owner,
      token_lease_expires_at = now() + make_interval(secs => p_seconds)
  where connection.environment = p_environment
    and (
      connection.token_lease_owner is null
      or connection.token_lease_expires_at <= now()
      or connection.token_lease_owner = p_owner
    );

  if found then
    return 'ACQUIRED';
  end if;

  if exists (
    select 1 from valtrim.quickbooks_connections connection
    where connection.environment = p_environment
  ) then
    return 'BUSY';
  end if;

  return 'NOT_CONNECTED';
end;
$$;

create function valtrim.release_quickbooks_token_lease(p_owner uuid, p_environment text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update valtrim.quickbooks_connections connection
  set token_lease_owner = null,
      token_lease_expires_at = null
  where connection.environment = p_environment
    and connection.token_lease_owner = p_owner;

  return found;
end;
$$;

-- The OAuth state remembers which environment started the connection, because
-- Intuit's callback carries nothing but the code.
alter table valtrim.quickbooks_oauth_states
  add column environment text not null default 'sandbox'
    check (environment in ('sandbox', 'production'));

-- 2. Where new invoices go ---------------------------------------------------

create table valtrim.quickbooks_settings (
  id boolean primary key default true check (id),
  active_environment text not null default 'sandbox'
    check (active_environment in ('sandbox', 'production')),
  changed_by uuid references valtrim.app_users(id) on delete set null,
  changed_at timestamptz not null default now()
);

insert into valtrim.quickbooks_settings (id) values (true);

create table valtrim.quickbooks_environment_log (
  id bigint generated always as identity primary key,
  environment text not null check (environment in ('sandbox', 'production')),
  previous_environment text check (previous_environment in ('sandbox', 'production')),
  changed_by uuid references valtrim.app_users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create function private.set_quickbooks_active_environment(p_environment text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_previous text;
begin
  if v_actor_id is null or not (select private.has_app_role('ADMIN')) then
    raise exception 'Only an administrator can change the QuickBooks mode'
      using errcode = '42501';
  end if;

  if p_environment is null or p_environment not in ('sandbox', 'production') then
    raise exception 'Choose Test or Production' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from valtrim.quickbooks_connections connection
    where connection.environment = p_environment
      and connection.status = 'CONNECTED'
      and connection.item_id is not null
  ) then
    raise exception 'Connect QuickBooks % first, and make sure its Product exists',
      case when p_environment = 'sandbox' then 'Test' else 'Production' end
      using errcode = '23514';
  end if;

  select settings.active_environment
  into v_previous
  from valtrim.quickbooks_settings settings
  where settings.id
  for update;

  if v_previous is distinct from p_environment then
    update valtrim.quickbooks_settings settings
    set active_environment = p_environment,
        changed_by = v_actor_id,
        changed_at = now()
    where settings.id;

    insert into valtrim.quickbooks_environment_log (environment, previous_environment, changed_by)
    values (p_environment, v_previous, v_actor_id);
  end if;

  return p_environment;
end;
$$;

create function valtrim.set_quickbooks_active_environment(p_environment text)
returns text
language sql
security invoker
set search_path = ''
as $$
  select private.set_quickbooks_active_environment(p_environment);
$$;

-- 3. The environment of each Package -----------------------------------------

alter table valtrim.draw_packages
  add column quickbooks_environment text
    check (quickbooks_environment in ('sandbox', 'production'));

update valtrim.draw_packages package
set quickbooks_environment = sync.environment
from valtrim.quickbooks_invoice_syncs sync
where sync.package_id = package.id;

-- 4. The invoice number is typed, and unique within its environment ----------

alter table valtrim.quickbooks_invoice_syncs
  drop constraint quickbooks_invoice_syncs_invoice_number_key;

alter table valtrim.quickbooks_invoice_syncs
  drop constraint quickbooks_invoice_syncs_invoice_number_check;

alter table valtrim.quickbooks_invoice_syncs
  add constraint quickbooks_invoice_syncs_invoice_number_check
    check (invoice_number is null or invoice_number ~ '^[0-9A-Za-z][0-9A-Za-z.-]{0,20}$');

create unique index quickbooks_invoice_syncs_number_per_environment_key
  on valtrim.quickbooks_invoice_syncs (environment, invoice_number)
  where invoice_number is not null;

drop function valtrim.preview_quickbooks_invoice_number(bigint);
drop function valtrim.claim_quickbooks_invoice_sync(bigint, uuid, text, text);
drop sequence valtrim.quickbooks_invoice_number_seq;

-- Takes the Package for one creation attempt. Returns {claimed: false, reason}
-- when it must not be sent: voided, already created, another attempt running,
-- an unresolved attempt in the other environment, or a number already used.
create function valtrim.claim_quickbooks_invoice_sync(
  p_package_id bigint,
  p_user_id uuid,
  p_environment text,
  p_realm_id text,
  p_invoice_number text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package record;
  v_sync valtrim.quickbooks_invoice_syncs%rowtype;
  v_has_sync boolean;
  v_request_id uuid;
  v_number text := nullif(btrim(p_invoice_number), '');
begin
  if p_environment is null or p_environment not in ('sandbox', 'production') then
    raise exception 'Choose Test or Production' using errcode = '22023';
  end if;

  if v_number is null or v_number !~ '^[0-9A-Za-z][0-9A-Za-z.-]{0,20}$' then
    raise exception 'Enter an invoice number of up to 21 letters, numbers, dots or dashes'
      using errcode = '22023';
  end if;

  select package.status, package.quickbooks_status
  into v_package
  from valtrim.draw_packages package
  where package.id = p_package_id
  for update;

  if not found then
    raise exception 'The Package no longer exists' using errcode = 'P0002';
  end if;

  if v_package.status = 'VOIDED' then
    return jsonb_build_object('claimed', false, 'reason', 'VOIDED');
  end if;
  if v_package.quickbooks_status not in ('NOT_CREATED', 'SYNC_ERROR') then
    return jsonb_build_object('claimed', false, 'reason', 'ALREADY_CREATED');
  end if;

  select *
  into v_sync
  from valtrim.quickbooks_invoice_syncs sync
  where sync.package_id = p_package_id
  for update;
  v_has_sync := found;

  if v_has_sync and v_sync.status = 'CREATED' then
    return jsonb_build_object('claimed', false, 'reason', 'ALREADY_CREATED');
  end if;

  -- An attempt that may have reached QuickBooks in the other environment must be
  -- finished there; sending from here could duplicate a real invoice.
  if v_has_sync
     and v_sync.environment <> p_environment
     and (v_sync.status = 'CREATING' or v_sync.request_reusable) then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'OTHER_ENVIRONMENT',
      'environment', v_sync.environment
    );
  end if;

  if v_has_sync
     and v_sync.status = 'CREATING'
     and v_sync.updated_at > now() - interval '5 minutes' then
    return jsonb_build_object('claimed', false, 'reason', 'IN_PROGRESS');
  end if;

  -- After an attempt that may have created the invoice, its number is fixed: a
  -- different one would turn a safe retry into a possible duplicate.
  if v_has_sync
     and v_sync.environment = p_environment
     and (v_sync.status = 'CREATING' or v_sync.request_reusable)
     and v_sync.invoice_number is not null then
    v_number := v_sync.invoice_number;
  end if;

  if exists (
    select 1
    from valtrim.quickbooks_invoice_syncs other
    where other.environment = p_environment
      and other.invoice_number = v_number
      and other.package_id <> p_package_id
  ) then
    return jsonb_build_object('claimed', false, 'reason', 'NUMBER_IN_USE');
  end if;

  if not v_has_sync then
    insert into valtrim.quickbooks_invoice_syncs (
      package_id, status, environment, realm_id, created_by, invoice_number
    ) values (
      p_package_id, 'CREATING', p_environment, p_realm_id, p_user_id, v_number
    )
    returning request_id into v_request_id;
  else
    -- The outcome of a stale CREATING row is unknown, so its request id is kept.
    -- After a definite failure, or against another company, start a new one.
    v_request_id := case
      when (v_sync.status = 'CREATING' or v_sync.request_reusable)
           and v_sync.environment = p_environment
           and v_sync.realm_id = p_realm_id
        then v_sync.request_id
      else gen_random_uuid()
    end;

    update valtrim.quickbooks_invoice_syncs sync
    set status = 'CREATING',
        environment = p_environment,
        realm_id = p_realm_id,
        request_id = v_request_id,
        request_reusable = false,
        error = null,
        created_by = p_user_id,
        invoice_number = v_number
    where sync.package_id = p_package_id;
  end if;

  update valtrim.draw_packages package
  set quickbooks_environment = p_environment
  where package.id = p_package_id;

  return jsonb_build_object(
    'claimed', true,
    'requestId', v_request_id,
    'invoiceNumber', v_number
  );
end;
$$;

-- The highest numeric invoice number used in an environment, to show next to the
-- field where the next one is typed. Voided invoices keep their number.
create function valtrim.last_quickbooks_invoice_number(p_environment text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select sync.invoice_number
  from valtrim.quickbooks_invoice_syncs sync
  where sync.environment = p_environment
    and sync.status in ('CREATING', 'CREATED', 'VOIDED')
    and sync.invoice_number ~ '^[0-9]+$'
  order by sync.invoice_number::numeric desc
  limit 1;
$$;

-- 5. Resetting a Test invoice ------------------------------------------------

create table valtrim.quickbooks_invoice_sync_archive (
  like valtrim.quickbooks_invoice_syncs,
  archived_at timestamptz not null default now(),
  archived_by uuid,
  archive_reason text
);

-- Puts a Package whose invoice went to the sandbox back to a clean Draft: no
-- QuickBooks state, no saved invoice PDF, free to be sent to Production. The
-- sandbox attempt is archived. A Production invoice is refused: it must be voided.
-- Returns {removed_storage_path}; the caller deletes that PDF from Storage.
create function valtrim.reset_quickbooks_test_invoice(
  p_package_id bigint,
  p_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package record;
  v_sync valtrim.quickbooks_invoice_syncs%rowtype;
  v_old_file_id bigint;
  v_old_path text;
begin
  select package.status,
         package.quickbooks_status,
         package.workflow_status,
         package.submission_status,
         package.submitted_at,
         invoice.paid_amount
    into v_package
  from valtrim.draw_packages package
  join valtrim.invoices invoice on invoice.package_id = package.id
  where package.id = p_package_id
  for update of package;

  if not found then
    raise exception 'The Package no longer exists' using errcode = 'P0002';
  end if;

  select *
  into v_sync
  from valtrim.quickbooks_invoice_syncs sync
  where sync.package_id = p_package_id
  for update;

  if not found then
    raise exception 'This Package has no QuickBooks attempt to reset' using errcode = '23514';
  end if;

  if v_sync.environment <> 'sandbox' then
    raise exception 'Only a Test invoice can be reset. A Production invoice must be voided'
      using errcode = '23514';
  end if;

  if v_package.status <> 'DRAFT'
     or v_package.workflow_status not in ('DRAFT', 'READY_TO_SUBMIT', 'AWAITING_PAYMENT')
     or v_package.submission_status <> 'NOT_SUBMITTED'
     or v_package.submitted_at is not null
     or v_package.paid_amount <> 0
     or exists (
       select 1
       from valtrim.invoice_payments payment
       join valtrim.invoices invoice on invoice.id = payment.invoice_id
       where invoice.package_id = p_package_id
     ) then
    raise exception 'Only an unpaid Test Package that was not submitted can be reset'
      using errcode = '23514';
  end if;

  insert into valtrim.quickbooks_invoice_sync_archive
  select sync.*, now(), p_user_id, left(p_reason, 300)
  from valtrim.quickbooks_invoice_syncs sync
  where sync.package_id = p_package_id;

  delete from valtrim.quickbooks_invoice_syncs sync
  where sync.package_id = p_package_id;

  select document.file_id, file.object_path
    into v_old_file_id, v_old_path
  from valtrim.package_documents document
  left join valtrim.stored_files file on file.id = document.file_id
  where document.package_id = p_package_id
    and document.document_type = 'INVOICE'
  for update of document;

  if found then
    delete from valtrim.package_documents document
    where document.package_id = p_package_id
      and document.document_type = 'INVOICE';

    if v_old_file_id is not null then
      delete from valtrim.stored_files file
      where file.id = v_old_file_id;
    end if;
  end if;

  update valtrim.draw_packages package
  set quickbooks_status = 'NOT_CREATED',
      quickbooks_reference = null,
      quickbooks_environment = null,
      paid_via_quickbooks = false,
      workflow_status = case
        when package.workflow_status = 'AWAITING_PAYMENT'
          then 'DRAFT'::valtrim.package_workflow_status
        else package.workflow_status
      end,
      status_changed_at = case
        when package.workflow_status = 'AWAITING_PAYMENT' then now()
        else package.status_changed_at
      end,
      status_changed_by = case
        when package.workflow_status = 'AWAITING_PAYMENT' then p_user_id
        else package.status_changed_by
      end,
      updated_by = p_user_id
  where package.id = p_package_id;

  return jsonb_build_object('removed_storage_path', v_old_path);
end;
$$;

-- 6. Access ------------------------------------------------------------------

alter table valtrim.quickbooks_settings enable row level security;
alter table valtrim.quickbooks_environment_log enable row level security;
alter table valtrim.quickbooks_invoice_sync_archive enable row level security;

revoke all on table valtrim.quickbooks_settings from public, anon, authenticated;
revoke all on table valtrim.quickbooks_environment_log from public, anon, authenticated;
revoke all on table valtrim.quickbooks_invoice_sync_archive from public, anon, authenticated;
grant all on table valtrim.quickbooks_settings to service_role;
grant all on table valtrim.quickbooks_environment_log to service_role;
grant all on table valtrim.quickbooks_invoice_sync_archive to service_role;

-- Everyone signed in sees which mode is active and who changed it; nobody
-- writes these tables directly.
grant select on valtrim.quickbooks_settings to authenticated;
grant select on valtrim.quickbooks_environment_log to authenticated;

create policy quickbooks_settings_select
on valtrim.quickbooks_settings for select to authenticated
using ((select private.is_active_user()));

create policy quickbooks_environment_log_select
on valtrim.quickbooks_environment_log for select to authenticated
using ((select private.is_active_user()));

grant select (quickbooks_environment) on valtrim.draw_packages to authenticated;

revoke all on function valtrim.get_quickbooks_credentials(text)
  from public, anon, authenticated;
revoke all on function valtrim.rotate_quickbooks_refresh_token(text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function valtrim.acquire_quickbooks_token_lease(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function valtrim.release_quickbooks_token_lease(uuid, text)
  from public, anon, authenticated;
revoke all on function valtrim.claim_quickbooks_invoice_sync(bigint, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function valtrim.last_quickbooks_invoice_number(text)
  from public, anon, authenticated;
revoke all on function valtrim.reset_quickbooks_test_invoice(bigint, uuid, text)
  from public, anon, authenticated;
grant execute on function valtrim.get_quickbooks_credentials(text) to service_role;
grant execute on function valtrim.rotate_quickbooks_refresh_token(text, text, timestamptz)
  to service_role;
grant execute on function valtrim.acquire_quickbooks_token_lease(uuid, text, integer)
  to service_role;
grant execute on function valtrim.release_quickbooks_token_lease(uuid, text) to service_role;
grant execute on function valtrim.claim_quickbooks_invoice_sync(bigint, uuid, text, text, text)
  to service_role;
grant execute on function valtrim.last_quickbooks_invoice_number(text) to service_role;
grant execute on function valtrim.reset_quickbooks_test_invoice(bigint, uuid, text)
  to service_role;

revoke execute on function private.set_quickbooks_active_environment(text)
  from public, anon, authenticated;
revoke execute on function valtrim.set_quickbooks_active_environment(text)
  from public, anon, authenticated;
grant execute on function private.set_quickbooks_active_environment(text)
  to authenticated, service_role;
grant execute on function valtrim.set_quickbooks_active_environment(text)
  to authenticated, service_role;

comment on table valtrim.quickbooks_settings is
  'Single row: the QuickBooks environment (sandbox = Test, production) where new invoices go.';
comment on table valtrim.quickbooks_environment_log is
  'Who switched the QuickBooks mode, and when.';
comment on table valtrim.quickbooks_invoice_sync_archive is
  'Test (sandbox) invoice attempts that were reset so their Package could go to Production.';
comment on column valtrim.draw_packages.quickbooks_environment is
  'The QuickBooks environment this Package was sent to; null until it is sent. Everything after the send uses it.';
comment on function valtrim.set_quickbooks_active_environment(text) is
  'ADMIN only: chooses where new QuickBooks invoices go (sandbox or production). Needs that environment connected.';
comment on function valtrim.reset_quickbooks_test_invoice(bigint, uuid, text) is
  'Service-role-only: returns a Package sent to the sandbox to a clean Draft and archives the attempt. Refuses Production.';

-- 7. The Packages already sent to the sandbox become Test Packages again ------

do $reclassify$
declare
  v_package_id bigint;
begin
  for v_package_id in
    select sync.package_id
    from valtrim.quickbooks_invoice_syncs sync
    join valtrim.draw_packages package on package.id = sync.package_id
    where sync.environment = 'sandbox'
      and sync.status = 'CREATED'
      and package.status = 'DRAFT'
      and package.quickbooks_status = 'CREATED'
    order by sync.package_id
  loop
    perform valtrim.reset_quickbooks_test_invoice(
      v_package_id,
      null,
      'Test invoices reclassified when QuickBooks Production was added'
    );
  end loop;
end;
$reclassify$;

notify pgrst, 'reload schema';

commit;
