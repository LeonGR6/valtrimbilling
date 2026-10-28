-- The date of a Package's QuickBooks invoice, readable by the app.
--
-- The invoice date (QuickBooks' TxnDate) was only inside `payload`, the request
-- sent to QuickBooks, which the app cannot read. The A/R report shows it, so it
-- gets its own column, filled from that payload:
--   * a trigger keeps it in step with `payload` (the invoice is created, or the
--     attempt is replaced), so no function that writes the payload has to change,
--   * the invoices that already exist are filled here.
-- Nothing else changes: the Due Date is still the one QuickBooks reports back
-- (`qbo_due_date`), worked out from the Builder's Payment Terms when the invoice
-- was created.

begin;

alter table valtrim.quickbooks_invoice_syncs
  add column qbo_invoice_date date;

comment on column valtrim.quickbooks_invoice_syncs.qbo_invoice_date is
  'Invoice date sent to QuickBooks (TxnDate), copied from the payload.';

create function valtrim.set_quickbooks_invoice_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.qbo_invoice_date := case
    when new.payload ->> 'TxnDate' ~ '^\d{4}-\d{2}-\d{2}$'
      then (new.payload ->> 'TxnDate')::date
    else null
  end;
  return new;
end;
$$;

create trigger quickbooks_invoice_syncs_set_invoice_date
before insert or update of payload on valtrim.quickbooks_invoice_syncs
for each row execute function valtrim.set_quickbooks_invoice_date();

-- Filling the existing rows must not look like a change to them: updated_at tells
-- when the last invoice was created.
alter table valtrim.quickbooks_invoice_syncs
  disable trigger quickbooks_invoice_syncs_set_updated_at;

update valtrim.quickbooks_invoice_syncs
set qbo_invoice_date = (payload ->> 'TxnDate')::date
where payload ->> 'TxnDate' ~ '^\d{4}-\d{2}-\d{2}$';

alter table valtrim.quickbooks_invoice_syncs
  enable trigger quickbooks_invoice_syncs_set_updated_at;

grant select (qbo_invoice_date) on valtrim.quickbooks_invoice_syncs to authenticated;

notify pgrst, 'reload schema';

commit;
