# Supabase Phase 4: Builder Billing Setups

Phase 4 persists the complete Billing Setup form for each Builder. The
`valtrim.billing_setups` parent remains an internal one-to-one record created by
the Builder trigger. User edits create immutable rows in
`valtrim.billing_setup_versions` with their related draws and required
documents.

The incremental migrations are
`20260909170224_phase_4_builder_billing_setups.sql` and
`20260909171227_phase_4_builder_billing_setup_audit_indexes.sql`. They were
applied to the `ValtrimBillingTestV2` Supabase project on September 9, 2026. No
previously applied migration was edited.

## Persisted model

- A Builder owns exactly one internal `billing_setups` container.
- Saving the form creates and activates a new `billing_setup_versions` row.
- The formerly active version becomes `SUPERSEDED` in the same transaction.
- Draw names and percentages are stored in `billing_draws`.
- Required-document switches are stored in
  `billing_required_documents`.
- The version audit references (`created_by` and `activated_by`) have covering
  partial indexes.
- Deactivation supersedes the active version; it does not delete financial
  configuration or history.

The form uses zero-based draw selectors, while PostgreSQL stores one-based draw
numbers. The persistence mapper performs that conversion for Hardware and
Options. `OCIP / Wrap` form fields map to the existing `wrap_*` database
columns, and frequency-specific fields that do not apply are stored as `NULL`
or an empty array.

Hardware now has an explicit billing-draw selector whenever its price is
separated. This is required by the database model and prevents downstream
billing logic from having to infer when separated Hardware should be billed.

## Access matrix

| Role | Read active setup | Save new version | Deactivate |
| --- | --- | --- | --- |
| `ADMIN` | Yes | Yes | Yes |
| `PROJECT_MANAGEMENT` | Yes | Yes | Yes |
| Other active roles | Yes | No | No |
| Anonymous/inactive | No | No | No |

Authenticated active users receive `SELECT` only on completed setup versions,
draws, and required documents. Browser clients receive no direct `INSERT`,
`UPDATE`, `DELETE`, or sequence grants. All changes go through the
`save_builder_billing_setup` and `deactivate_builder_billing_setup` RPCs, which
are `SECURITY DEFINER`, use an empty `search_path`, and enforce the application
role again inside PostgreSQL.

## Scope boundaries

- Jobs were still closed during this historical phase. Phase 5 subsequently
  opened their catalog and now references the active
  `billing_setup_version_id` without changing Setup versioning behavior.
- Plans, draw packages, invoices, and downstream financial calculations were
  not opened or changed.
- Communities remains closed. It is a legacy model pending removal because
  `user_community_access` and `service_properties` still depend on it.
- Users, Customer Service, Builder Contacts, and other modules were not changed.

## Validation

Remote structural validation confirmed:

- The three expected read policies and authenticated `SELECT` grants.
- No direct authenticated write grants on the three persisted tables.
- Authenticated execution and anonymous denial for both public RPCs.
- At the time of this rollout, Jobs and Communities were unavailable through
  the Data API. Jobs were subsequently opened in Phase 5; Communities remains
  closed.
- The Supabase advisors report no security finding for the four Billing Setup
  tables, and the version audit foreign keys are no longer reported as
  unindexed. Their new indexes are currently marked unused because the version
  table is still empty.

A rollback-only behavioral validation confirmed that:

- An `ADMIN` can create an active version with draws and documents.
- A second save atomically supersedes the first version.
- `READ_ONLY` and anonymous sessions cannot save.
- Deactivation supersedes the active version without deleting it.
- An active authenticated user can read the expected versions, draws, and
  documents through RLS.

The validation transaction left all existing table rows unchanged. PostgreSQL
sequences are non-transactional, so the rollback-only checks advanced the five
test-table sequence counters even though no test rows remained. They were not
rewound because resetting live sequences requires an exclusive lock and is not
necessary for correctness; gaps in surrogate IDs are expected and harmless.

Frontend schema/mapping tests, lint, and the production build pass. The broader
test suite retains four pre-existing mock-domain failures in draw-package and
Job fixture expectations; they are outside this persistence phase.
