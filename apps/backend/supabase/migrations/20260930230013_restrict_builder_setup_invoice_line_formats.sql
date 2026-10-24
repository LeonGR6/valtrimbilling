-- Builder Setup now supports only Lot + Scope and Building + Scope invoice
-- lines. Existing setup versions are normalized to Lot + Scope. Draw Packages
-- keep their own immutable invoice_line_format snapshots unchanged.

begin;

-- This is an explicit business-rule migration of historical Builder Setup
-- versions. Bypass only the setup-version immutability guard while applying
-- the one-time normalization; the surrounding transaction guarantees the
-- trigger is restored if anything fails.
alter table valtrim.billing_setup_versions
  disable trigger billing_setup_versions_protect;

update valtrim.billing_setup_versions
set invoice_line_format = 'LOT_SCOPE'
where invoice_line_format <> 'LOT_SCOPE';

alter table valtrim.billing_setup_versions
  enable trigger billing_setup_versions_protect;

alter table valtrim.billing_setup_versions
  add constraint billing_setup_versions_invoice_line_format_check
  check (invoice_line_format::text in ('LOT_SCOPE', 'BUILDING_SCOPE'));

comment on constraint billing_setup_versions_invoice_line_format_check
  on valtrim.billing_setup_versions is
  'Builder Setup versions support one invoice line per Lot and Scope or per Building and Scope.';

commit;
