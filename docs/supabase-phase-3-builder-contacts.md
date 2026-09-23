# Supabase Phase 3: Builder Contacts

Phase 3 persists the Builder Contacts catalog in Supabase. Both
`JOBSITE_SUPERINTENDENT` and `AP_CONTACT` records use the existing
`valtrim.builder_contacts` table and differ only by their `type`. Communities
and Jobs remain outside this phase.

## Included

- `20260908230127_phase_3_builder_contacts.sql` opens the minimum Data API
  access for `valtrim.builder_contacts`.
- `phase_3_builder_contacts.test.sql` checks grants, RLS policies, contact
  types, indexes, persisted Builder relationships, and out-of-scope tables.
- Active authenticated users can read Builder Contacts.
- `ADMIN` and `PROJECT_MANAGEMENT` users can create, update, deactivate, and
  reactivate either contact type.
- Every Builder Contact references an existing persisted Builder through
  `builder_id`; the frontend no longer uses mock Builder codes for this view.
- Browser clients cannot write audit fields or hard delete Builder Contacts.
- Deactivation is logical through `is_active = false`, preserving historical
  references. Inactive contacts remain visible in the catalog and are excluded
  from new Jobsite Superintendent assignments.
- The Builder Contacts repository and React context use the publishable
  Supabase client. No `service_role` credential is present in browser code.
- The existing Jobs form can persist a newly entered Jobsite Superintendent,
  but Jobs and Communities themselves are not persisted or opened by this
  phase.

## Access matrix

| Role | Read | Create | Update/deactivate | Hard delete |
| --- | --- | --- | --- | --- |
| `ADMIN` | Yes | Yes | Yes | No |
| `PROJECT_MANAGEMENT` | Yes | Yes | Yes | No |
| Other active roles | Yes | No | No | No |
| Anonymous/inactive | No | No | No | No |

## Validation

The migration is deployed to `ValtrimBillingTestV2`. Structural and
behavioral checks confirmed both contact types against a persisted Builder,
audit stamping, ADMIN and PROJECT_MANAGEMENT writes, soft deactivation,
READ_ONLY read access with denied writes, and closed Communities and Jobs.
Validation transactions were rolled back, the test sequence was restored, and
no sample Builder Contacts remain.

For a local Supabase stack:

```bash
npm run db:push
npm run db:test
npm run lint
node --test --test-name-pattern="builder contact|contact" \
  apps/frontend/tests/form-schemas.test.mjs \
  apps/frontend/tests/builder-contact-record.test.mjs \
  apps/frontend/tests/calendar-contact-actions.test.mjs
npm run build
```

Community is a separate future entity. There is no standalone Jobsite entity in
this slice: “Jobsite” refers only to the `JOBSITE_SUPERINTENDENT` Builder
Contact type.
