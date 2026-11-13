# Supabase Phase 6: Plans, Options and Pricing

Phase 6 persists the Plans and optional Options configured under each Job, plus
their effective-dated prices. The incremental migration is
`20260910140554_phase_6_plans_options_pricing.sql`; it was applied to
`ValtrimBillingTestV2` on September 10, 2026.

## Persisted behavior

- The Jobs provider loads active Plans, their active Options, and the current
  open price periods after loading the Jobs catalog.
- Plans can be created and edited with a required code and an optional display
  name. PostgreSQL stores the code as a safe fallback when the display name is
  omitted.
- Options remain optional. Each one stores its P.O. / OPT # and description.
  Multiple Options under one Plan may share a display code because Lot
  assignments use the Option id and the UI distinguishes those rows by their
  descriptions.
- Deleting from the catalog is a soft deactivation. A Plan deactivation also
  deactivates its Options, and PostgreSQL blocks deactivation when Lots still
  depend on the Plan or Option.
- A Plan's base price and optional separate hardware price are stored in
  `plan_prices`. Option prices are stored in `option_prices`.
- Pricing RPCs update a same-day price in place; on a later date they close the
  prior period and create a new current period. This preserves the price used
  by historical draw packages.
- When separate hardware billing applies, hardware may remain unpriced while
  the base Plan price is already assigned. The UI continues to flag that state.

## Access matrix

| Role | Read | Create/edit/deactivate | Set prices | Hard delete |
| --- | --- | --- | --- | --- |
| `ADMIN` | Yes | Yes | Yes | No |
| `PROJECT_MANAGEMENT` | Yes | Yes | Yes | No |
| Other active roles | Yes | No | No | No |
| Anonymous/inactive | No | No | No | No |

Grants and RLS are both required. `authenticated` receives table `SELECT`,
column-level `INSERT`/`UPDATE` for catalog fields, and identity-sequence
`USAGE`. Browser clients cannot write audit fields or price periods directly.
Price and dependency-aware deactivation mutations use explicitly granted,
role-checked RPCs. No browser `service_role` key is used.

## Scope boundaries

- Sequence Sheet Phases, Lots and Lot Option assignments remain in-memory and
  closed in the Data API.
- Production, Draw Packages, Invoices, QuickBooks and Customer Service are not
  opened or changed by this phase.
- Existing Builder Billing Setup versions remain the source of whether
  hardware is priced separately and which draw bills Options.

## Validation

- The migration and 48 pgTAP structural assertions were executed together in
  a rollback-only transaction against `ValtrimBillingTestV2`.
- A second rollback-only remote check confirmed ADMIN Plan/Option creation,
  repeated Option codes, nullable hardware pricing, effective-date history,
  active READ_ONLY visibility with denied writes, and dependency-aware soft
  deactivation.
- Frontend record-mapper tests, lint and the production build pass. The broader
  fixture-based test suite still contains unrelated pre-existing mock-data
  expectation failures outside this phase.
