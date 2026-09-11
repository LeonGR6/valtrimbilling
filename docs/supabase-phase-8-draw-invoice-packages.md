# Supabase Phase 8: Draw & Invoice Packages

Phase 8 persists Draw & Invoice Packages and opens only the package data needed
by the current browser UI.

## Scope

- Persist a Package for selected Lots and Builder Billing Setup Draws.
- Snapshot calculated Draw, hardware, Option, retention, WRAP and net Invoice
  amounts in PostgreSQL.
- Create exactly one calculated Invoice row per Package.
- Manage the Package status as `DRAFT`, `READY_TO_SUBMIT`,
  `AWAITING_PAYMENT` or `PAID_CLOSED`.
- Load persisted Packages, calculated lines and totals through the frontend
  repository and context.

Document upload/storage, QuickBooks, Invoice payments, Invoice issuance and
Customer Service remain outside this phase.

## Security boundary

Active authenticated users can read the exposed Package and Invoice fields.
Only active `ADMIN` and `PROJECT_MANAGEMENT` users can create a Package or
change its status.

Browser clients cannot insert, update or delete `draw_packages`, `invoices`,
`package_draws` or `package_options` directly and cannot allocate their
identities. Creation and status changes use security-invoker RPC wrappers in the
exposed `valtrim` schema. The privileged implementations live in the unexposed
`private` schema, use an empty `search_path`, derive the actor from `auth.uid()`
and re-check the application role.

The browser has no access to Package QuickBooks fields, `package_documents`,
`invoice_payments`, Invoice issuance helpers or Customer Service tables.

## Persistence rules

`create_draw_invoice_package` validates that:

- the Phase and Job are active;
- the Job Billing Setup snapshot is active or superseded;
- every requested Lot belongs to the Phase;
- every requested Draw belongs to the Billing Setup;
- Lot and Draw selections are unique;
- the billing period is valid; and
- every requested calculated line is created.

PostgreSQL resolves current Plan and Option prices and stores immutable line
snapshots. The Invoice totals are recalculated from those snapshots. A duplicate
Lot/Draw selection is rejected by the existing database uniqueness boundary.

The Package status actor and timestamp are persisted independently from the
general update audit fields. A Package without calculated lines cannot leave
`DRAFT`.

## Frontend flow

`drawInvoicePackagesRepository.js` reads Packages in pages, then loads their
Invoices, Draw lines, Option lines and Billing Setup snapshot in batches. The
mapper converts persisted Draw numbers to zero-based UI indexes and keeps the
database financial snapshot as the source of truth for Package totals.

`DrawInvoicePackagesContext` owns authenticated loading, retry, creation, status
updates and error state. Read-only roles can inspect Packages; only management
roles see enabled creation and status controls.

## Validation

- Database structure and access: `apps/backend/supabase/tests/phase_8_draw_invoice_packages.test.sql`
- Frontend mapper/RPC payloads: `apps/frontend/tests/draw-invoice-package-record.test.mjs`
- Persisted snapshot totals: `apps/frontend/tests/draw-packages.test.mjs`
- Migration: `apps/backend/supabase/migrations/20260911134556_phase_8_draw_invoice_packages.sql`

Apply schema changes from the canonical migration directory with `supabase db
push`. Remote lifecycle checks must run inside one transaction and finish with
`rollback` so validation leaves no Package, Invoice or calculated-line records.
