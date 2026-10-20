-- Invoice numbers for QuickBooks: a serial that starts at 15001 (15001, 15002...).
--
-- In production the invoices were already at 14xxx, so this continues that
-- count. The number is taken when a Package is first sent to QuickBooks and kept
-- on its sync row: a retry reuses it, and a Package never gets a second one.
-- QuickBooks receives it as the invoice's DocNumber, replacing the Package
-- number (DP-0000xxxx), which stays the Package's own identifier.
--
-- Numbers are only taken by a real send, never by a preview, so Packages that
-- are deleted before being sent leave no gaps.

begin;

create sequence valtrim.quickbooks_invoice_number_seq
  as bigint
  start with 15001
  minvalue 15001;

alter table valtrim.quickbooks_invoice_syncs
  add column invoice_number text
    check (invoice_number is null or invoice_number ~ '^[0-9]{5,}$'),
  add constraint quickbooks_invoice_syncs_invoice_number_key unique (invoice_number);

create or replace function valtrim.claim_quickbooks_invoice_sync(
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
  v_invoice_number text;
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
    v_invoice_number := nextval('valtrim.quickbooks_invoice_number_seq')::text;

    insert into valtrim.quickbooks_invoice_syncs (
      package_id, status, environment, realm_id, created_by, invoice_number
    ) values (
      p_package_id, 'CREATING', p_environment, p_realm_id, p_user_id, v_invoice_number
    )
    returning request_id into v_request_id;

    return jsonb_build_object(
      'claimed', true,
      'requestId', v_request_id,
      'invoiceNumber', v_invoice_number
    );
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

  -- The Package keeps the number it was given, whatever happens to the attempt.
  v_invoice_number := coalesce(
    v_sync.invoice_number,
    nextval('valtrim.quickbooks_invoice_number_seq')::text
  );

  update valtrim.quickbooks_invoice_syncs
  set status = 'CREATING',
      environment = p_environment,
      realm_id = p_realm_id,
      request_id = v_request_id,
      request_reusable = false,
      error = null,
      created_by = p_user_id,
      invoice_number = v_invoice_number
  where package_id = p_package_id;

  return jsonb_build_object(
    'claimed', true,
    'requestId', v_request_id,
    'invoiceNumber', v_invoice_number
  );
end;
$$;

-- What number a Package would get, for the preview: its own if it has one,
-- else the next in the series. It takes nothing from the series.
create function valtrim.preview_quickbooks_invoice_number(p_package_id bigint)
returns text
language sql
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select sync.invoice_number
      from valtrim.quickbooks_invoice_syncs sync
      where sync.package_id = p_package_id
    ),
    (
      select (case when seq.is_called then seq.last_value + 1 else seq.last_value end)::text
      from valtrim.quickbooks_invoice_number_seq seq
    )
  );
$$;

revoke all on function valtrim.preview_quickbooks_invoice_number(bigint)
  from public, anon, authenticated;
grant execute on function valtrim.preview_quickbooks_invoice_number(bigint)
  to service_role;

grant select (invoice_number) on valtrim.quickbooks_invoice_syncs to authenticated;

comment on function valtrim.preview_quickbooks_invoice_number(bigint) is
  'Service-role-only: the invoice number a Package has or would get, without taking it.';

notify pgrst, 'reload schema';

commit;
