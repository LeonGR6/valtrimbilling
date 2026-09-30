# Supabase Phase 7: Sequence Sheets

Phase 7 persists each Job's Sequence Sheet Phases and Lots, including the Plan
assigned to every Lot, its Reverse orientation and its selected Plan Options.
The incremental migrations are
`20260910183652_phase_7_sequence_sheets.sql` and the selector-audit follow-up
`20260910185729_phase_7_sequence_sheet_selector_audit.sql`; both were applied
to `ValtrimBillingTestV2` on September 10, 2026.

## Persisted behavior

- The Jobs provider loads active Phases in parallel with Plans after loading
  the Jobs catalog. It then loads ordered Lots and their selected Option ids,
  with batching and pagination beyond the Data API's 1,000-row response limit.
- Creating or editing a Phase calls one transactional RPC. PostgreSQL validates
  the active Job, active Plan ownership, Option-to-Plan ownership, unique Lot
  numbers, maximum 500 Lots, Reverse values and display order before saving.
- Existing Lot ids are preserved during edits. Plan assignments and Lot numbers
  can be swapped between existing Lots in one save without a temporary uniqueness
  failure.
- Removing a Phase deletes its Lot and selected-Option assignments, then
  soft-deactivates the Phase identity. Recreating the same Phase code safely reuses
  and reactivates that identity record.
- Downstream foreign keys still prevent deleting Lot assignments that are already
  in use. No downstream workflow was opened or changed in this phase.
- The UI now waits for remote saves/deletes, reports errors, supports retrying
  loads and hides mutation controls from users without a management role.

## Access matrix

| Role | Read | Save Phase/Lots/Options | Delete Phase assignments | Direct table writes |
| --- | --- | --- | --- | --- |
| `ADMIN` | Yes | Yes | Yes | No |
| `PROJECT_MANAGEMENT` | Yes | Yes | Yes | No |
| Other active roles | Yes | No | No | No |
| Anonymous/inactive | No | No | No | No |

`authenticated` receives `SELECT` on `phases`, `lots` and `lot_options`, subject
to active-user RLS policies. It receives no table `INSERT`, `UPDATE`, `DELETE` or
identity-sequence access. Mutations are available only through
`save_sequence_sheet_phase` and `deactivate_sequence_sheet_phase`; both verify
`ADMIN`/`PROJECT_MANAGEMENT` inside their `SECURITY DEFINER` boundary. The browser
continues to use the publishable key, never `service_role`.

## Scope boundaries

- Production tables and scheduling behavior remain closed and unchanged.
- Draw Packages, Invoices and QuickBooks remain closed and unchanged.
- Customer Service remains closed and unchanged.
- Plans, Options and their current pricing remain the already-persisted parent
  catalog used to validate Lot assignments.

## Validation

- The 36 pgTAP structural assertions passed remotely, covering grants, RLS,
  RPC exposure, normalization constraints, audit indexes and closed downstream
  modules.
- The rollback-only remote lifecycle check in
  `apps/backend/supabase/validation/phase_7_sequence_sheets.remote.sql` passed:
  ADMIN create/edit/deactivate/reactivate; stable Lot ids; Lot-number swaps;
  Plan reassignment; Reverse and selected Options; active READ_ONLY reads with
  denied writes; anonymous denial; and zero retained test rows after rollback.
- The two directed frontend record/RPC tests pass. Frontend lint and production
  build pass.
- Local pgTAP could not run because PostgreSQL was unavailable at
  `127.0.0.1:54322`. The full frontend suite is 149/153; its four failures are
  the pre-existing mock-fixture expectations outside this phase.
- Supabase advisors reported no missing RLS policy or unindexed foreign key for
  `phases`, `lots` or `lot_options`. Informational findings remain on unopened
  modules, and unused-index notices are expected on the empty test tables.
