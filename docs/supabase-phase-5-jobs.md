# Supabase Phase 5: Jobs

Phase 5 persists the Jobs catalog in Supabase using the application-owned
model: Job number, Builder, direct Community text, Supervisor and Jobsite
Superintendent. The incremental migration is
`20260909230033_phase_5_jobs.sql`; it was applied to
`ValtrimBillingTestV2` on September 9, 2026.

## Persisted behavior

- The React Jobs provider loads the catalog from `valtrim.jobs` after an
  authenticated profile is available.
- Creating and editing a Job sends only `code`, `builder_id`, `community`,
  `supervisor_id` and `superintendent_id`.
- Deactivation sets `is_active = false`; browser clients cannot hard delete a
  Job.
- PostgreSQL normalizes Community and assigns the Builder's current `ACTIVE`
  Billing Setup version. Normal later edits keep the version already captured
  by that Job.
- Builder display names come from the persisted Builders context. Supervisor
  and Jobsite Superintendent names continue to come from their persisted
  catalogs.
- The UI exposes loading, retryable load errors, mutation errors and role-aware
  controls. Inactive Jobs remain visible and clearly labeled.

## Access matrix

| Role | Read | Create | Edit/deactivate | Hard delete |
| --- | --- | --- | --- | --- |
| `ADMIN` | Yes | Yes | Yes | No |
| `PROJECT_MANAGEMENT` | Yes | Yes | Yes | No |
| Other active roles | Yes | No | No | No |
| Anonymous/inactive | No | No | No | No |

Grants and RLS are both required. `authenticated` receives table `SELECT`,
column-level `INSERT`/`UPDATE`, and sequence `USAGE`. It receives no write
privilege for the internal Billing Setup reference, generated Superintendent
type, audit fields, timestamps, optional fields absent from the form, or hard
delete.

## Scope boundaries

- `job_overview` remains closed because it aggregates unopened Phases and Lots.
  The frontend reads `jobs` directly.
- Plans, Options, Sequence Sheets, Phases, Lots, pricing, Production, Draw
  Packages and Invoices remain outside this persistence phase. Their temporary
  in-memory edits are preserved by the Jobs context until each module is
  persisted.
- `valtrim.communities` remains closed and pending retirement. It was not
  deleted because `user_community_access` and `service_properties` still depend
  on it.
- Users and Customer Service were not opened or changed.

## Validation

- Pre- and post-migration Jobs counts were zero, with the same
  `d41d8cd98f00b204e9800998ecf8427e` empty-table fingerprint.
- Structural checks confirmed the exact grants, three Jobs policies, sequence
  access, protected internal columns, no hard delete, and continued closure of
  every out-of-scope table and view.
- A rollback-only remote behavior check confirmed ADMIN create, edit and
  deactivation; automatic Billing Setup selection; Community trimming and
  audit stamping; active READ_ONLY reads with denied writes; anonymous denial;
  and denial of `job_overview` access.
- No temporary validation Builder, Person, Contact or Job remained after the
  rollback, and application roles retained their original values.
- PostgreSQL identity sequences are non-transactional, so rollback-only inserts
  can leave harmless gaps in surrogate ids even though they leave no rows or
  changes to existing records.
- Supabase advisors report no missing Jobs policy or unindexed Jobs foreign key.
  The remaining global notices belong to unopened modules; the leaked-password
  warning is an Auth project setting rather than a Jobs schema issue.
- Job schema, route and persistence-mapper tests pass 4/4; lint and production
  build pass. The full frontend suite passes 142/146, with the same four
  pre-existing mock-fixture failures outside this phase.
