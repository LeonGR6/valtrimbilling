-- A Package whose QuickBooks invoice was voided can get a new invoice.
--
-- Until now a voided invoice tied its Package to it for good: the Package could only
-- be deleted as a draft and its cells invoiced again in a new Package. Now the voided
-- invoice can be detached: the attempt moves to the archive (the same one the Test
-- resets use) and the Package goes back to "not created", ready to be sent again.
-- QuickBooks keeps the voided invoice with its number, so that number is still taken
-- there; the archive keeps remembering it until QuickBooks lets it go.
--
-- Three things in one migration:
--   1. The archive missed the column added to the sync table for the A/R report
--      (qbo_invoice_date), so "Move back to Production" failed with "INSERT has more
--      expressions than target columns". Archiving now names its columns, in one
--      function both resets use, so a column added later cannot break it again.
--   2. detach_voided_quickbooks_invoice: the new, service-role-only function.
--   3. The numbers of archived voided invoices count as used numbers, like the live
--      ones, so "Last used here" and the offered next number do not point at a number
--      QuickBooks still holds.
--
-- UPDATEs and DELETEs always filter on a key: pg_safeupdate, loaded for the API roles,
-- rejects them without a WHERE clause.

begin;

-- 1. The archive and the one place that writes it -------------------------------

alter table valtrim.quickbooks_invoice_sync_archive
  add column qbo_invoice_date date;

create function valtrim.archive_quickbooks_invoice_sync(
  p_package_id bigint,
  p_user_id uuid,
  p_reason text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into valtrim.quickbooks_invoice_sync_archive (
    package_id, status, environment, realm_id, request_id, request_reusable,
    qbo_invoice_id, qbo_doc_number, qbo_sync_token, total_amount, payload, error,
    created_by, created_at, updated_at, voided_at, voided_by,
    qbo_state, qbo_total, qbo_balance, qbo_due_date, qbo_overdue,
    qbo_linked_transactions, qbo_last_updated_at, qbo_state_changed_at,
    qbo_state_checked_at, invoice_number, qbo_invoice_date,
    archived_by, archive_reason
  )
  select
    sync.package_id, sync.status, sync.environment, sync.realm_id, sync.request_id,
    sync.request_reusable, sync.qbo_invoice_id, sync.qbo_doc_number,
    sync.qbo_sync_token, sync.total_amount, sync.payload, sync.error,
    sync.created_by, sync.created_at, sync.updated_at, sync.voided_at, sync.voided_by,
    sync.qbo_state, sync.qbo_total, sync.qbo_balance, sync.qbo_due_date,
    sync.qbo_overdue, sync.qbo_linked_transactions, sync.qbo_last_updated_at,
    sync.qbo_state_changed_at, sync.qbo_state_checked_at, sync.invoice_number,
    sync.qbo_invoice_date,
    p_user_id, left(p_reason, 300)
  from valtrim.quickbooks_invoice_syncs sync
  where sync.package_id = p_package_id;
$$;

revoke all on function valtrim.archive_quickbooks_invoice_sync(bigint, uuid, text)
  from public, anon, authenticated;

comment on function valtrim.archive_quickbooks_invoice_sync(bigint, uuid, text) is
  'Internal: copies the Package''s QuickBooks attempt to the archive, naming every column.';

-- The same reset as before (20261105120000); only the archiving changed.
create or replace function valtrim.reset_quickbooks_test_invoice(
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

  -- An attempt that started moments ago may still be running; a stuck one can be reset.
  if v_sync.status = 'CREATING' and v_sync.updated_at > now() - interval '5 minutes' then
    raise exception 'The invoice is still being created in QuickBooks. Try again in a few minutes'
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

  perform valtrim.archive_quickbooks_invoice_sync(p_package_id, p_user_id, p_reason);

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

-- 2. Detaching a voided invoice -------------------------------------------------

-- Returns {removed_storage_path, voided_invoice_number}. The path is a saved invoice
-- PDF, if one was left; the caller deletes it from Storage (SQL cannot). Voiding
-- already removes it, so this is only a safety net.
create function valtrim.detach_voided_quickbooks_invoice(
  p_package_id bigint,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package record;
  v_invoice_number text;
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

  if v_package.status <> 'DRAFT' then
    raise exception 'A cancelled Package cannot get a new invoice' using errcode = '23514';
  end if;

  if v_package.quickbooks_status <> 'VOIDED' then
    raise exception 'Only a Package whose QuickBooks invoice was voided can get a new invoice'
      using errcode = '23514';
  end if;

  if v_package.workflow_status not in ('DRAFT', 'READY_TO_SUBMIT', 'AWAITING_PAYMENT')
     or v_package.submission_status <> 'NOT_SUBMITTED'
     or v_package.submitted_at is not null
     or v_package.paid_amount <> 0
     or exists (
       select 1
       from valtrim.invoice_payments payment
       join valtrim.invoices invoice on invoice.id = payment.invoice_id
       where invoice.package_id = p_package_id
     ) then
    raise exception 'Only an unpaid Package that was not submitted can get a new invoice'
      using errcode = '23514';
  end if;

  select coalesce(sync.qbo_doc_number, sync.invoice_number)
    into v_invoice_number
  from valtrim.quickbooks_invoice_syncs sync
  where sync.package_id = p_package_id
  for update;

  perform valtrim.archive_quickbooks_invoice_sync(
    p_package_id,
    p_user_id,
    'Voided invoice detached so the Package can get a new one'
  );

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

  return jsonb_build_object(
    'removed_storage_path', v_old_path,
    'voided_invoice_number', v_invoice_number
  );
end;
$$;

revoke all on function valtrim.detach_voided_quickbooks_invoice(bigint, uuid)
  from public, anon, authenticated;
grant execute on function valtrim.detach_voided_quickbooks_invoice(bigint, uuid)
  to service_role;

comment on function valtrim.detach_voided_quickbooks_invoice(bigint, uuid) is
  'Service-role-only: archives the voided QuickBooks invoice of a Package and returns the Package to "not created" so it can get a new invoice.';

-- 3. Archived voided invoices keep their number until QuickBooks lets it go -------

create or replace function valtrim.quickbooks_invoice_number_candidates(p_environment text)
returns table (invoice_number text, voided boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select used.invoice_number, used.voided
  from (
    select sync.invoice_number, sync.status = 'VOIDED' as voided
    from valtrim.quickbooks_invoice_syncs sync
    where sync.environment = p_environment
      and sync.status in ('CREATING', 'CREATED', 'VOIDED')
      and sync.invoice_number ~ '^[0-9]+$'
    union
    select archived.invoice_number, true
    from valtrim.quickbooks_invoice_sync_archive archived
    where archived.environment = p_environment
      and (archived.status = 'VOIDED' or archived.qbo_state = 'VOIDED')
      and archived.invoice_number ~ '^[0-9]+$'
      and not exists (
        select 1
        from valtrim.quickbooks_invoice_syncs live
        where live.environment = p_environment
          and live.invoice_number = archived.invoice_number
      )
  ) used
  order by used.invoice_number::numeric desc
  limit 20;
$$;

create or replace function valtrim.release_quickbooks_voided_invoice_number(
  p_environment text,
  p_invoice_number text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_live integer;
  v_archived integer;
begin
  update valtrim.quickbooks_invoice_syncs sync
  set invoice_number = null
  where sync.environment = p_environment
    and sync.invoice_number = p_invoice_number
    and sync.status = 'VOIDED';

  get diagnostics v_live = row_count;

  update valtrim.quickbooks_invoice_sync_archive archived
  set invoice_number = null
  where archived.environment = p_environment
    and archived.invoice_number = p_invoice_number
    and (archived.status = 'VOIDED' or archived.qbo_state = 'VOIDED');

  get diagnostics v_archived = row_count;

  return v_live + v_archived > 0;
end;
$$;

notify pgrst, 'reload schema';

commit;
