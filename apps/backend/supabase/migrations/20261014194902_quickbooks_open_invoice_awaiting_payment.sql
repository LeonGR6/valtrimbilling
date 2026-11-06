-- A Package whose QuickBooks invoice is open is Awaiting payment.
--
-- Until now a Package stayed in Draft after its invoice was created in
-- QuickBooks and only moved when it was sent to the Builder or paid. Now:
--   * creating the invoice moves Draft -> Awaiting payment right away,
--   * every payment check does the same for a Package that is still Draft while
--     its invoice is open, overdue or partially paid (covers invoices made
--     before this change),
--   * paid in QuickBooks still moves it to Paid / Closed (unchanged),
--   * voiding the invoice, here or in QuickBooks, returns a Package that was not
--     sent to the Builder to Draft, so it can be deleted or invoiced again.
-- Voiding from the app used to need a Draft Package; an unpaid, unsent Package is
-- now Awaiting payment while its invoice stands, so that is accepted too.

begin;

create or replace function valtrim.complete_quickbooks_invoice_sync(
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
      -- A new invoice is open: the Package now waits for its payment.
      workflow_status = case
        when workflow_status in ('DRAFT', 'READY_TO_SUBMIT')
          then 'AWAITING_PAYMENT'::valtrim.package_workflow_status
        else workflow_status
      end,
      status_changed_at = case
        when workflow_status in ('DRAFT', 'READY_TO_SUBMIT') then now()
        else status_changed_at
      end,
      status_changed_by = case
        when workflow_status in ('DRAFT', 'READY_TO_SUBMIT') then v_user_id
        else status_changed_by
      end,
      updated_by = v_user_id
  where id = p_package_id;

  return true;
end;
$$;

create or replace function valtrim.apply_quickbooks_invoice_state(
  p_package_id bigint,
  p_state text,
  p_total numeric,
  p_balance numeric,
  p_due_date date,
  p_overdue boolean,
  p_linked text[],
  p_qbo_last_updated timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous text;
  v_workflow valtrim.package_workflow_status;
  v_via_quickbooks boolean;
  v_submission valtrim.submission_status;
begin
  if p_state not in ('OPEN', 'OVERDUE', 'PARTIALLY_PAID', 'PAID', 'CLOSED', 'VOIDED', 'DELETED') then
    raise exception 'Unknown QuickBooks payment state %', p_state using errcode = '22023';
  end if;

  select sync.qbo_state
  into v_previous
  from valtrim.quickbooks_invoice_syncs sync
  where sync.package_id = p_package_id and sync.status = 'CREATED'
  for update;
  if not found then
    raise exception 'This Package has no QuickBooks invoice' using errcode = 'P0002';
  end if;

  update valtrim.quickbooks_invoice_syncs
  set qbo_state = p_state,
      qbo_total = p_total,
      qbo_balance = p_balance,
      qbo_due_date = p_due_date,
      qbo_overdue = coalesce(p_overdue, false),
      qbo_linked_transactions = coalesce(p_linked, '{}'),
      qbo_last_updated_at = p_qbo_last_updated,
      qbo_state_changed_at = case
        when v_previous is distinct from p_state then now()
        else qbo_state_changed_at
      end,
      qbo_state_checked_at = now()
  where package_id = p_package_id;

  select package.workflow_status, package.paid_via_quickbooks, package.submission_status
  into v_workflow, v_via_quickbooks, v_submission
  from valtrim.draw_packages package
  where package.id = p_package_id and package.status <> 'VOIDED'
  for update;
  if not found then
    return null;
  end if;

  if p_state = 'PAID' and v_workflow in ('DRAFT', 'READY_TO_SUBMIT', 'AWAITING_PAYMENT') then
    update valtrim.draw_packages
    set workflow_status = 'PAID_CLOSED',
        paid_via_quickbooks = true,
        status_changed_at = now(),
        status_changed_by = null
    where id = p_package_id;
    v_workflow := 'PAID_CLOSED';
  elsif p_state in ('OPEN', 'OVERDUE', 'PARTIALLY_PAID')
        and v_workflow in ('DRAFT', 'READY_TO_SUBMIT') then
    -- The invoice stands and is not paid: the Package is waiting for payment.
    update valtrim.draw_packages
    set workflow_status = 'AWAITING_PAYMENT',
        status_changed_at = now(),
        status_changed_by = null
    where id = p_package_id;
    v_workflow := 'AWAITING_PAYMENT';
  elsif p_state <> 'PAID' and v_workflow = 'PAID_CLOSED' and v_via_quickbooks then
    -- QuickBooks no longer shows it as paid (a payment was deleted or voided).
    update valtrim.draw_packages
    set workflow_status = 'AWAITING_PAYMENT',
        paid_via_quickbooks = false,
        status_changed_at = now(),
        status_changed_by = null
    where id = p_package_id;
    v_workflow := 'AWAITING_PAYMENT';
  end if;

  if p_state = 'VOIDED' then
    update valtrim.draw_packages
    set quickbooks_status = 'VOIDED'
    where id = p_package_id and quickbooks_status = 'CREATED';

    -- Nothing is owed any more. A Package that was not sent to the Builder goes
    -- back to Draft; one that was sent keeps its status for someone to decide.
    if v_workflow = 'AWAITING_PAYMENT' and v_submission = 'NOT_SUBMITTED' then
      update valtrim.draw_packages
      set workflow_status = 'DRAFT',
          status_changed_at = now(),
          status_changed_by = null
      where id = p_package_id;
      v_workflow := 'DRAFT';
    end if;
  end if;

  return v_workflow::text;
end;
$$;

create or replace function valtrim.void_quickbooks_invoice_sync(
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

  -- Voiding twice is harmless: the second call just reports it.
  if v_package.quickbooks_status = 'VOIDED' then
    return jsonb_build_object('voided', true, 'already', true, 'removed_storage_path', null);
  end if;

  if v_package.quickbooks_status <> 'CREATED' then
    raise exception 'Only a Package with a QuickBooks invoice can have it voided'
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
    raise exception 'Only an unpaid Package that was not submitted can have its invoice voided'
      using errcode = '23514';
  end if;

  update valtrim.quickbooks_invoice_syncs sync
  set status = 'VOIDED',
      voided_at = now(),
      voided_by = p_user_id
  where sync.package_id = p_package_id
    and sync.status = 'CREATED';

  if not found then
    raise exception 'The Package has no created QuickBooks invoice to void'
      using errcode = '55000';
  end if;

  -- Without an invoice nothing is awaited: back to Draft, as before it was sent.
  update valtrim.draw_packages package
  set quickbooks_status = 'VOIDED',
      workflow_status = 'DRAFT',
      status_changed_at = case
        when package.workflow_status <> 'DRAFT' then now()
        else package.status_changed_at
      end,
      status_changed_by = case
        when package.workflow_status <> 'DRAFT' then p_user_id
        else package.status_changed_by
      end,
      updated_by = p_user_id
  where package.id = p_package_id;

  -- The saved PDF shows an invoice that no longer stands.
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

  return jsonb_build_object('voided', true, 'already', false, 'removed_storage_path', v_old_path);
end;
$$;

-- Invoices created before this change are still Draft: they are open, so they
-- wait for payment. Ones already paid in QuickBooks reach Paid / Closed on the
-- next payment check.
update valtrim.draw_packages package
set workflow_status = 'AWAITING_PAYMENT',
    status_changed_at = now(),
    status_changed_by = null
where package.quickbooks_status = 'CREATED'
  and package.status <> 'VOIDED'
  and package.workflow_status in ('DRAFT', 'READY_TO_SUBMIT');

notify pgrst, 'reload schema';

commit;
