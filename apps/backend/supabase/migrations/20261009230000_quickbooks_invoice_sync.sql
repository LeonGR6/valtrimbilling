-- QuickBooks invoice creation for Draw Packages.
--
-- One sync row per Package records the attempt and what QuickBooks returned. The
-- claim / complete / fail functions are service-only and keep three guarantees:
--   * two clicks cannot create two invoices (the claim locks the Package),
--   * a retry after an ambiguous failure (network error, 5xx) reuses the same
--     QuickBooks request id, so QuickBooks returns the original invoice instead
--     of creating a duplicate,
--   * draw_packages.quickbooks_status / quickbooks_reference only change here.

begin;

create table valtrim.quickbooks_invoice_syncs (
  package_id bigint primary key
    references valtrim.draw_packages(id) on delete restrict,
  status varchar(20) not null
    check (status in ('CREATING', 'CREATED', 'FAILED')),
  environment text not null
    check (environment in ('sandbox', 'production')),
  realm_id text not null
    check (btrim(realm_id) <> '' and char_length(realm_id) <= 64),
  -- Sent to QuickBooks as `requestid`; QuickBooks replays the original result
  -- when it sees the same id again.
  request_id uuid not null default gen_random_uuid(),
  -- True after a failure that may have created the invoice (network, 5xx).
  request_reusable boolean not null default false,
  qbo_invoice_id text,
  qbo_doc_number text,
  qbo_sync_token text,
  total_amount numeric(14, 2),
  payload jsonb,
  error text check (error is null or char_length(error) <= 1000),
  created_by uuid references valtrim.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quickbooks_invoice_syncs_created_check
    check (status <> 'CREATED' or qbo_invoice_id is not null)
);

create trigger quickbooks_invoice_syncs_set_updated_at
before update on valtrim.quickbooks_invoice_syncs
for each row execute function valtrim.set_updated_at();

-- Takes the Package for one creation attempt. Returns {claimed: false, reason}
-- when it must not be sent (voided, already created, another attempt running).
create function valtrim.claim_quickbooks_invoice_sync(
  p_package_id bigint,
  p_user_id uuid,
  p_environment text,
  p_realm_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package record;
  v_sync valtrim.quickbooks_invoice_syncs%rowtype;
  v_request_id uuid;
begin
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

  if not found then
    insert into valtrim.quickbooks_invoice_syncs (
      package_id, status, environment, realm_id, created_by
    ) values (
      p_package_id, 'CREATING', p_environment, p_realm_id, p_user_id
    )
    returning request_id into v_request_id;

    return jsonb_build_object('claimed', true, 'requestId', v_request_id);
  end if;

  if v_sync.status = 'CREATED' then
    return jsonb_build_object('claimed', false, 'reason', 'ALREADY_CREATED');
  end if;

  -- A CREATING row older than five minutes means the function died mid-attempt.
  if v_sync.status = 'CREATING' and v_sync.updated_at > now() - interval '5 minutes' then
    return jsonb_build_object('claimed', false, 'reason', 'IN_PROGRESS');
  end if;

  -- The outcome of a stale CREATING row is unknown, so its request id is kept.
  -- After a definite failure, or against a different company, start a new one.
  v_request_id := case
    when (v_sync.status = 'CREATING' or v_sync.request_reusable)
         and v_sync.environment = p_environment
         and v_sync.realm_id = p_realm_id
      then v_sync.request_id
    else gen_random_uuid()
  end;

  update valtrim.quickbooks_invoice_syncs
  set status = 'CREATING',
      environment = p_environment,
      realm_id = p_realm_id,
      request_id = v_request_id,
      request_reusable = false,
      error = null,
      created_by = p_user_id
  where package_id = p_package_id;

  return jsonb_build_object('claimed', true, 'requestId', v_request_id);
end;
$$;

create function valtrim.complete_quickbooks_invoice_sync(
  p_package_id bigint,
  p_qbo_invoice_id text,
  p_qbo_doc_number text,
  p_qbo_sync_token text,
  p_total_amount numeric,
  p_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  update valtrim.quickbooks_invoice_syncs
  set status = 'CREATED',
      qbo_invoice_id = nullif(btrim(p_qbo_invoice_id), ''),
      qbo_doc_number = nullif(btrim(p_qbo_doc_number), ''),
      qbo_sync_token = nullif(btrim(p_qbo_sync_token), ''),
      total_amount = p_total_amount,
      payload = p_payload,
      request_reusable = false,
      error = null
  where package_id = p_package_id
    and status = 'CREATING'
  returning created_by into v_user_id;

  if not found then
    raise exception 'No QuickBooks invoice attempt is in progress for this Package'
      using errcode = '55000';
  end if;

  update valtrim.draw_packages
  set quickbooks_status = 'CREATED',
      quickbooks_reference = left(
        coalesce(nullif(btrim(p_qbo_doc_number), ''), btrim(p_qbo_invoice_id)),
        120
      ),
      updated_by = v_user_id
  where id = p_package_id;

  return true;
end;
$$;

create function valtrim.fail_quickbooks_invoice_sync(
  p_package_id bigint,
  p_error text,
  p_request_reusable boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update valtrim.quickbooks_invoice_syncs
  set status = 'FAILED',
      request_reusable = coalesce(p_request_reusable, false),
      error = left(p_error, 1000)
  where package_id = p_package_id
    and status = 'CREATING';

  if not found then
    return false;
  end if;

  update valtrim.draw_packages
  set quickbooks_status = 'SYNC_ERROR'
  where id = p_package_id
    and quickbooks_status <> 'CREATED';

  return true;
end;
$$;

alter table valtrim.quickbooks_invoice_syncs enable row level security;

revoke all on table valtrim.quickbooks_invoice_syncs
  from public, anon, authenticated;
revoke all on function valtrim.claim_quickbooks_invoice_sync(bigint, uuid, text, text)
  from public, anon, authenticated;
revoke all on function valtrim.complete_quickbooks_invoice_sync(
  bigint, text, text, text, numeric, jsonb
) from public, anon, authenticated;
revoke all on function valtrim.fail_quickbooks_invoice_sync(bigint, text, boolean)
  from public, anon, authenticated;

grant all on table valtrim.quickbooks_invoice_syncs to service_role;
grant execute on function valtrim.claim_quickbooks_invoice_sync(bigint, uuid, text, text)
  to service_role;
grant execute on function valtrim.complete_quickbooks_invoice_sync(
  bigint, text, text, text, numeric, jsonb
) to service_role;
grant execute on function valtrim.fail_quickbooks_invoice_sync(bigint, text, boolean)
  to service_role;

-- The sent payload and request id stay server-side; users only see the outcome.
grant select (
  package_id,
  status,
  environment,
  qbo_invoice_id,
  qbo_doc_number,
  total_amount,
  error,
  created_at,
  updated_at
) on valtrim.quickbooks_invoice_syncs to authenticated;

create policy quickbooks_invoice_syncs_select
on valtrim.quickbooks_invoice_syncs for select to authenticated
using ((select private.is_active_user()));

comment on table valtrim.quickbooks_invoice_syncs is
  'One QuickBooks invoice creation attempt per Package, with the ids QuickBooks returned.';
comment on function valtrim.claim_quickbooks_invoice_sync(bigint, uuid, text, text) is
  'Service-role-only: locks a Package for one QuickBooks invoice creation attempt and returns the request id to send.';
comment on function valtrim.complete_quickbooks_invoice_sync(
  bigint, text, text, text, numeric, jsonb
) is
  'Service-role-only: records the created invoice and marks the Package as created in QuickBooks.';
comment on function valtrim.fail_quickbooks_invoice_sync(bigint, text, boolean) is
  'Service-role-only: records a failed attempt and marks the Package as SYNC_ERROR so it can be retried.';

notify pgrst, 'reload schema';

commit;
