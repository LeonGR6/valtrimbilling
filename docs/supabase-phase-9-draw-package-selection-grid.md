# Supabase Phase 9: Draw Package Selection Grid

Phase 9 lets one Draw & Invoice Package contain any available combination of
Lot and Draw cells. It removes the Phase 8 restriction that applied every
selected Draw to every selected Lot.

## User flow

The Create Draw dialog uses a worksheet-style grid:

- each row is a Lot;
- each column is a configured Draw;
- each available cell can be selected independently;
- row and Draw checkboxes select all remaining available cells; and
- yellow locked cells show combinations already owned by another Package.

For example, one Package can combine Lots 4–5 on Draw 1 with Lots 1–3 on Draw
2, even when Lots 1–3 on Draw 1 already belong to an earlier Package.

## Persistence contract

`create_draw_invoice_package` now receives `p_selections jsonb`. Each array item
contains one `lot_id` and one one-based `draw_number`. PostgreSQL validates that
the array is non-empty, contains unique positive pairs and that every Lot and
Draw belongs to the selected Phase and its Billing Setup.

Only those exact pairs are inserted into `package_draws`. Existing triggers
still calculate immutable Draw, hardware, Option, retention, WRAP and Invoice
snapshots. Options are included only for Lots whose selected cell is the
Builder's configured Options billing Draw.

The previous array-based creator was removed so the exposed PostgREST function
is not overloaded. The API name, role check, atomic transaction and status RPC
remain unchanged.

## Security and scope

The Phase 8 grants and RLS policies are unchanged. Active `ADMIN` and
`PROJECT_MANAGEMENT` users can create Packages through the role-checked RPC;
other active users remain read-only. Direct browser writes to calculated lines
are still denied.

QuickBooks, document uploads, Invoice payments, Invoice issuance and Customer
Service remain outside this phase.

## Validation

- Migration: `apps/backend/supabase/migrations/20260911144622_draw_package_selection_grid.sql`
- Database structure: `apps/backend/supabase/tests/phase_9_draw_package_selection_grid.test.sql`
- RPC mapping: `apps/frontend/tests/draw-invoice-package-record.test.mjs`
- Independent selection and Option totals: `apps/frontend/tests/draw-packages.test.mjs`

Remote lifecycle validation must create mixed Lot / Draw selections inside one
transaction, assert the exact persisted cells and Invoice totals, verify role
denials, and finish with `rollback`.
