-- What QuickBooks says about the payment of a Package's invoice.
--
-- QuickBooks has no "status" on an invoice: what its screen shows (Paid, Closed,
-- Overdue, Voided...) is worked out from the balance, the due date and what is
-- linked to it. The `quickbooks-payments-sync` function reads those and calls
-- `apply_quickbooks_invoice_state`, which keeps the reading on the sync row and
-- moves the Package between Awaiting payment and Paid / Closed:
--   * paid in QuickBooks   -> Paid / Closed (remembered in paid_via_quickbooks),
--   * no longer paid there -> back to Awaiting payment, but only if QuickBooks is
--     what closed it; a Package someone closed by hand is never reopened here,
--   * voided or deleted there -> only reported, never cancelled automatically.

begin;

alter table valtrim.quickbooks_invoice_syncs
  add column qbo_state text
    check (qbo_state in ('OPEN', 'OVERDUE', 'PARTIALLY_PAID', 'PAID', 'CLOSED', 'VOIDED', 'DELETED')),
  add column qbo_total numeric(14, 2),
  add column qbo_balance numeric(14, 2),
  add column qbo_due_date date,
  add column qbo_overdue boolean not null default false,
  add column qbo_linked_transactions text[] not null default '{}',
  add column qbo_last_updated_at timestamptz,
  add column qbo_state_changed_at timestamptz,
  add column qbo_state_checked_at timestamptz;

alter table valtrim.draw_packages
  add column paid_via_quickbooks boolean not null default false;

create function valtrim.apply_quickbooks_invoice_state(
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

  select package.workflow_status, package.paid_via_quickbooks
  into v_workflow, v_via_quickbooks
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
  end if;

  return v_workflow::text;
end;
$$;

revoke all on function valtrim.apply_quickbooks_invoice_state(
  bigint, text, numeric, numeric, date, boolean, text[], timestamptz
) from public, anon, authenticated;
grant execute on function valtrim.apply_quickbooks_invoice_state(
  bigint, text, numeric, numeric, date, boolean, text[], timestamptz
) to service_role;

comment on function valtrim.apply_quickbooks_invoice_state(
  bigint, text, numeric, numeric, date, boolean, text[], timestamptz
) is
  'Service-role-only: records what QuickBooks shows for the Package invoice and moves the Package between Awaiting payment and Paid / Closed.';

grant select (
  qbo_state,
  qbo_total,
  qbo_balance,
  qbo_due_date,
  qbo_overdue,
  qbo_linked_transactions,
  qbo_state_changed_at,
  qbo_state_checked_at
) on valtrim.quickbooks_invoice_syncs to authenticated;

notify pgrst, 'reload schema';

commit;
