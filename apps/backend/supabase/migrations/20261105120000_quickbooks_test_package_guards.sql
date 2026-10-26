-- A Package invoiced in the QuickBooks Test company is not a real invoice, so it
-- must never be submitted to a Builder. Two guards:
--   1. mark_package_submitted refuses a Package whose invoice lives in Test.
--      (The email Edge Function also refuses before sending, so nothing leaves.)
--   2. reset_quickbooks_test_invoice does not touch an attempt that is still
--      being created, which could race with the request that is creating it.

begin;

create or replace function private.mark_package_submitted_internal(p_package_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_status valtrim.package_workflow_status;
  v_environment text;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to submit Draw & Invoice Packages'
      using errcode = '42501';
  end if;

  select package.workflow_status, package.quickbooks_environment
  into v_status, v_environment
  from valtrim.draw_packages package
  where package.id = p_package_id and package.status <> 'VOIDED'
  for update;
  if not found then
    raise exception 'The Package is cancelled or no longer exists'
      using errcode = 'P0002';
  end if;

  if v_environment = 'sandbox' then
    raise exception 'This Package was invoiced in QuickBooks Test, so it cannot be submitted. Move it back to Production first'
      using errcode = '23514';
  end if;

  if v_status in ('DRAFT', 'READY_TO_SUBMIT') then
    update valtrim.draw_packages
    set workflow_status = 'AWAITING_PAYMENT',
        status_changed_at = now(),
        status_changed_by = v_actor_id,
        updated_by = v_actor_id
    where id = p_package_id;
    v_status := 'AWAITING_PAYMENT';
  end if;

  return v_status::text;
end;
$$;

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

notify pgrst, 'reload schema';

commit;
