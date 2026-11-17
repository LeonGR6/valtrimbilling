-- The number of a voided invoice that was deleted in QuickBooks is free again.
--
-- Voiding an invoice in QuickBooks keeps it, with its number, so the app keeps that number
-- reserved (and shows it as the last one used) for as long as QuickBooks has the invoice. When
-- the voided invoice is then deleted in QuickBooks the number is free there, but the app still
-- held it: "Last used here" kept showing it and the number could not be typed again.
--
-- The app now asks QuickBooks whether a voided invoice still exists and, when it does not,
-- releases its number here. Two service-role functions support that:
--   * quickbooks_invoice_number_candidates: the numeric numbers of an environment, highest
--     first, saying which belong to a voided invoice (so only those are checked in QuickBooks),
--   * release_quickbooks_voided_invoice_number: clears the number of a voided invoice.
-- Only a voided invoice can be released. The number stays in qbo_doc_number and in the saved
-- request, so the history of the Package keeps it.

begin;

create function valtrim.quickbooks_invoice_number_candidates(p_environment text)
returns table (invoice_number text, voided boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select sync.invoice_number, sync.status = 'VOIDED'
  from valtrim.quickbooks_invoice_syncs sync
  where sync.environment = p_environment
    and sync.status in ('CREATING', 'CREATED', 'VOIDED')
    and sync.invoice_number ~ '^[0-9]+$'
  order by sync.invoice_number::numeric desc
  limit 20;
$$;

create function valtrim.release_quickbooks_voided_invoice_number(
  p_environment text,
  p_invoice_number text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released integer;
begin
  update valtrim.quickbooks_invoice_syncs sync
  set invoice_number = null
  where sync.environment = p_environment
    and sync.invoice_number = p_invoice_number
    and sync.status = 'VOIDED';

  get diagnostics v_released = row_count;
  return v_released > 0;
end;
$$;

revoke all on function valtrim.quickbooks_invoice_number_candidates(text)
  from public, anon, authenticated;
revoke all on function valtrim.release_quickbooks_voided_invoice_number(text, text)
  from public, anon, authenticated;
grant execute on function valtrim.quickbooks_invoice_number_candidates(text) to service_role;
grant execute on function valtrim.release_quickbooks_voided_invoice_number(text, text) to service_role;

comment on function valtrim.quickbooks_invoice_number_candidates(text) is
  'Service-role-only: the numeric invoice numbers used in an environment, highest first, and whether each belongs to a voided invoice.';
comment on function valtrim.release_quickbooks_voided_invoice_number(text, text) is
  'Service-role-only: frees the number of a voided invoice that QuickBooks no longer has. Returns whether one was freed.';

notify pgrst, 'reload schema';

commit;
