# Supabase Phase 1: Builders

Phase 1 persists the Builders catalog in Supabase. Supervisors, jobsites, Jobs,
and billing setup configuration remain outside this phase.

## Included

- `20260908161450_phase_1_builders.sql` opens the minimum Data API access for
  `valtrim.builders` and the automatically created `valtrim.billing_setups` row.
- `20260908161454_phase_1_builders_audit_indexes.sql` adds the three partial
  indexes recommended for the Builder audit-user foreign keys.
- `20260908161458_phase_1_secure_billing_setup_trigger.sql` makes Billing Setup
  creation an internal trigger-only operation.
- Active authenticated users can read Builders.
- `ADMIN` and `PROJECT_MANAGEMENT` users can create and update Builders.
- Browser clients cannot write audit fields and cannot hard delete Builders.
- Deactivation is persisted by setting `is_active` to `false`.
- Creating a Builder runs the existing `builders_initialize_billing` trigger and
  creates exactly one Billing Setup. Setup versions and draw configuration remain
  closed.
- The React Builders provider now reads and writes Supabase instead of the mock
  array. Builder date spacing is persisted in the same record.

## Access matrix

| Role | Read | Create | Update/deactivate | Hard delete |
| --- | --- | --- | --- | --- |
| `ADMIN` | Yes | Yes | Yes | No |
| `PROJECT_MANAGEMENT` | Yes | Yes | Yes | No |
| Other active roles | Yes | No | No | No |
| Anonymous/inactive | No | No | No | No |

## Remote rollout status

All three Phase 1 migrations were applied to the `ValtrimBillingTestV2` Supabase
project on September 8, 2026. No sample Builders were inserted; the test catalog
starts empty.

The remote structural validation confirmed:

- The expected table and column grants and four RLS policies.
- Automatic Billing Setup creation from a temporary Builder.
- Direct Billing Setup insertion and direct trigger-function execution remain
  unavailable to browser roles.
- The temporary Builder and Billing Setup were removed, and both sequences were
  restored to their initial empty-state values.

Behavioral RLS validation with `ADMIN` and `READ_ONLY` sessions remains pending
until the first Auth identity is created in this project.

## Validation

For a local Supabase stack:

```bash
npm run db:push
npm run db:test
npm run lint
npm test
npm run build
```

People with the `SUPERVISOR` role are implemented in Phase 2. The next
recommended slice is communities/jobsites and their Builder and Supervisor
relationships. Jobs should remain closed until those parent records are stable.
