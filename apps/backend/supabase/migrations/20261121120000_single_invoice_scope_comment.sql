-- The single invoice option does not ask for everything available of a Phase or Building to be billed
-- together: it only divides a selection. When Create Package is given Lots, Draws, Options and
-- Hardware of several Phases (or Buildings), it makes one Package, so one invoice, for each, with
-- what was chosen of it. This corrects the description of the column added by
-- 20261117120000_single_invoice_scope.sql; the column and its values do not change.

begin;

comment on column valtrim.billing_setup_versions.single_invoice_scope is
  'Whether the Builder takes one invoice per PHASE or per BUILDING: a selection that spans several is created as one Package for each, with what was chosen of it. Null when not configured.';

commit;
