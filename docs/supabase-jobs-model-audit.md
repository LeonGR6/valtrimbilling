# Supabase Jobs model audit

Audit date: 2026-09-09

## Scope

This audit compares the current Job create/edit form with `valtrim.jobs` after
the incremental model corrections and the Phase 5 Jobs persistence rollout.
The `jobs_audit_indexes` migration covers both application-user audit foreign
keys. Phase 5 opens only Jobs; it does not open or change Communities, Users,
Customer Service, Plans, Sequence Sheets, Production, Draw Packages, Invoices,
or other feature persistence.

`community` now matches the application: it is required text stored on each
Job, trimmed before storage, limited to 100 characters, and has no foreign key
to `valtrim.communities`.

`valtrim.communities` remains closed and is documented in PostgreSQL as a
legacy model pending retirement because `valtrim.user_community_access` and
`valtrim.service_properties` still reference it.

## Field comparison

| Current form field | Database field | Result |
| --- | --- | --- |
| `code` | `code` | Compatible after the form uppercases and trims it. The form limits it to 30 characters while PostgreSQL permits 40. |
| `builder` | `builder_id` | The repository persists the selected Builder id; the context resolves its display name from the persisted Builders catalog. |
| `community` | `community` | Aligned by this migration: required trimmed text, maximum 100 characters, no catalog dependency. |
| `supervisorId` | `supervisor_id` | Structurally aligned. PostgreSQL additionally requires an active Person with the `SUPERVISOR` role. |
| `superintendentId` | `superintendent_id` | Structurally aligned. PostgreSQL additionally requires an active `JOBSITE_SUPERINTENDENT` belonging to the selected Builder. |
| No form field | `billing_setup_version_id` | Intentionally internal. PostgreSQL selects the Builder's `ACTIVE` version on Job creation or an explicit Builder change. |

## Resolved model decisions

1. `name` was removed. `code` is the sole Job identifier in the application and
   database.
2. `ap_contact_id` and its generated type, foreign key, and index were removed.
   A Job currently assigns only a Supervisor and Jobsite Superintendent.
3. `billing_setup_version_id` remains required but is never selected by the
   user. On insert, PostgreSQL resolves the selected Builder's `ACTIVE` Setup
   version. If the Builder is explicitly changed, PostgreSQL resolves the new
   Builder's active version. All other edits preserve the Job's original
   version, including after that version becomes `SUPERSEDED`.

A Builder without an `ACTIVE` Billing Setup version cannot produce a persisted
Job. This is intentional because the Job must capture a complete financial
configuration when it is created.

## Other observed differences

- `sequence_sheet_name` and `notes` are optional database fields absent from
  the Job form; they do not block an insert.
- `status` and `is_active` are absent from the form but have database defaults
  (`ACTIVE` and `true`), so they do not block an insert.
- Audit fields and timestamps are database-managed and should remain absent
  from browser-authored payloads.

The form, repository and database now agree on every required Job input. The
Jobs catalog reads from Supabase, and create, edit and non-destructive
deactivation write to Supabase. The child modules currently reached through a
Job retain their temporary in-memory behavior until their own persistence
phases.

## Validation performed

- The migration was applied to an ephemeral PostgreSQL database containing one
  legacy Job. Its Community label moved to the new text column and was trimmed;
  every other stored Job field remained byte-for-byte equivalent as JSONB.
- The same run created a new Job with no matching Communities row, verified the
  updated overview, and rejected blank and 101-character Community values.
- All 24 fixture assertions and all 26 assertions in
  `jobs_community_text.test.sql` passed.
- Supabase applied the migration to `ValtrimBillingTestV2` as version
  `20260909155052`. Before and after application, Jobs and Communities both had
  zero rows and the same empty-table fingerprint
  (`d41d8cd98f00b204e9800998ecf8427e`), so no existing row data changed.
- A remote behavioral check created the complete dependency set and a Job,
  verified normalization and the overview, rejected invalid Community text,
  and rolled the transaction back. No validation rows remained afterward.
- Supabase applied `jobs_identity_and_auto_billing_setup` as version
  `20260909192453`. Jobs still had zero rows with the same empty fingerprint,
  and no validation rows remained.
- Supabase applied `jobs_audit_indexes` as version `20260909192908`; it changes
  no row data.
- A rollback-only remote check confirmed automatic selection of the active
  Builder Setup, preservation of that version after a newer Setup became
  active, continued Job edits against a `SUPERSEDED` historical version, and a
  code-only `job_overview`.
- The canonical SQL Editor installer now creates the aligned Jobs model
  directly, without first creating `name`, AP Contact columns, or the old
  Community foreign key.
- Phase 5 was applied remotely as `20260909230033_phase_5_jobs`. It gives active
  authenticated users read access and limits create/update/deactivate to
  `ADMIN` and `PROJECT_MANAGEMENT`; browser hard delete is unavailable.
- Browser column grants exclude `billing_setup_version_id`, generated contact
  type, audit fields, timestamps and fields absent from the current form.
- A rollback-only RLS check confirmed ADMIN create/edit/deactivate, automatic
  Setup selection, Community normalization, active READ_ONLY access without
  writes, anonymous denial, hard-delete denial and continued closure of
  `job_overview`.
- Before and after Phase 5, Jobs contained zero rows and retained the same
  empty-table fingerprint. The validation Builder, Person, Contact and Job all
  rolled back, and the tested ADMIN roles remained unchanged.
- Supabase advisors no longer report Jobs as having RLS without policies or any
  unindexed Job foreign key. Unused Job indexes are expected while the table is
  empty.
- The new pgTap regression file contains 28 structural and behavioral
  assertions. The local Supabase stack is not running, so the equivalent
  assertions were executed remotely inside rollback-only transactions.
- Job schema, route and persistence-mapper tests pass 4/4; lint and the
  production build pass. The complete frontend suite passes 142/146 and retains
  the same four unrelated mock-domain failures documented before Phase 5.
