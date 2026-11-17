# Supabase Phase 14: Draft Draw Package corrections

Users with the `ADMIN` or `PROJECT_MANAGEMENT` role can correct a Draw &
Invoice Package while it is still an unissued, unsynced draft. The UI offers
three actions on the focused Package:

- **Edit Package** replaces the final set of Lot / Draw cells and can adjust
  its billing period and notes. Cells that did not change keep their original
  calculated snapshots. Newly added cells are calculated using the Package's
  fixed `package_date`. Job, Phase, Billing Setup and Package date remain
  immutable; a mistaken scope requires removing the draft and creating a
  new Package.
- **Move cells here** selects cells owned by another editable Package for the
  same Job, Phase and Billing Setup. One atomic RPC releases each cell from the
  source before adding it to the target. If the source becomes empty, it is
  automatically cancelled. The target's date determines its new prices and
  deductions; the old source prices are not copied.
- **Delete draft** uses a recoverable cancellation: it releases all active
  cells and their Option snapshot rows,
  resets its draft Invoice totals to zero, and marks the Package `VOIDED`.
  Its number, reason and correction history remain in audit storage, but it is
  removed from the active catalog. The cancelled Package cannot be reactivated.

## Active Package catalog

The catalog excludes cancelled Packages from its table, cards and tabs. It
uses only the four existing workflow statuses: Draft, Ready to submit,
Awaiting payment and Paid/Closed. Each status card shows the Package count
and combined Invoice amount for the current Builder, Community and search
scope; selecting a card or tab filters the table. Builder and Community have
separate dropdown filters, with Community options limited by Builder.

The Action column keeps Open as the primary button and adds a dropdown for
Open, Edit Package, Move cells here and Delete draft as permissions allow.
Delete draft is offered only while the Package workflow is `DRAFT`; ready or
later Packages cannot be deleted from this UI. This is deliberately not a
hard SQL delete: draft billing cells are released without erasing their audit
trail or silently changing another Package's history.

The database's global `(lot_id, draw_id)` key on `package_draws` and
`(lot_id, option_id)` key on `package_options` prevent duplicate active billing.
The Invoice totals trigger now runs on both insert and delete of Draw cells,
so released cells immediately stop contributing to the draft Invoice.
Calculated Options are already included once in their Draw gross amount, so
the correction does not add separate Option totals to the Invoice.

## Safety boundary

Corrections require both the legacy Package status and Invoice status to be
`DRAFT`. The Package workflow must be `DRAFT` or `READY_TO_SUBMIT`; there can
be no Invoice number/date, payment, completed/waived document, submission or
QuickBooks creation/reference. The server checks both source and target after
locking. Other statuses remain immutable in this slice.

Every correction requires a reason (maximum 500 characters). A single
`draw_package_corrections` record stores the action, actor, timestamp, exact
cell IDs, other Package ID if applicable, and metadata changes. These IDs are
audit history only, not active calculated billing lines. The correction RPC
locks the Phase first, then affected Packages in ID order, matching the
creator's Phase lock and avoiding competing allocations.

Browser clients retain read-only grants on calculated lines and have no direct
write grant on the correction history table. The public RPCs are
security-invoker wrappers around one role-checked, security-definer private
implementation. QuickBooks internals, Invoice issuance, payments and document
uploads are not newly exposed to the browser.

## Validation

- Migration: `apps/backend/supabase/migrations/20260915184246_draw_package_corrections.sql`
- Database grants/functions: `apps/backend/supabase/tests/phase_14_draw_package_corrections.test.sql`
- Rollback-only transfer/edit/cancel lifecycle:
  `apps/backend/supabase/validation/phase_14_draw_package_corrections.remote.sql`
- Frontend mapping: `apps/frontend/tests/draw-invoice-package-record.test.mjs`
- Catalog filters, status totals and Draft-only Delete action:
  `apps/frontend/tests/package-catalog.test.mjs`

The remote lifecycle script chooses two eligible Packages on the same scope,
moves cells from the later Package to the earlier one, checks totals and
exclusive ownership, exercises cancellation and permission/QuickBooks guards,
and rolls everything back.
