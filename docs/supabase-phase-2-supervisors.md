# Supabase Phase 2: Supervisors

Phase 2 persists Valtrim People with the `SUPERVISOR` role. Communities,
jobsites, Jobs, and the other person roles remain outside this phase.

## Included

- `20260908182759_phase_2_supervisors.sql` opens the minimum Data API access
  for `valtrim.people` and `valtrim.person_roles`.
- `phase_2_supervisors.test.sql` checks the table, column, sequence, function,
  policy, and out-of-scope grants.
- Active authenticated users can read People only when they have the
  `SUPERVISOR` role.
- `ADMIN` and `PROJECT_MANAGEMENT` users can create, update, deactivate, and
  reactivate Supervisors.
- Creation uses a narrow transactional function so a Person and its
  `SUPERVISOR` role cannot be saved independently. Its privileged implementation
  stays in the unexposed `private` schema; the Data API exposes only an
  invoker-rights wrapper.
- Browser clients cannot insert arbitrary People or roles, write audit fields,
  allocate People identities directly, or hard delete records.
- Deactivation is persisted with `is_active = false`; historical references and
  the `SUPERVISOR` role remain intact.
- The React People provider now loads and saves Supervisors through Supabase.
  The same provider remains the source used by the calendar and Job assignment
  UI, without persisting Jobs in this phase.

## Access matrix

| Role | Read | Create | Update/deactivate | Hard delete |
| --- | --- | --- | --- | --- |
| `ADMIN` | Yes | Yes | Yes | No |
| `PROJECT_MANAGEMENT` | Yes | Yes | Yes | No |
| Other active roles | Yes | No | No | No |
| Anonymous/inactive | No | No | No | No |

## Validation

The migration is deployed to `ValtrimBillingTestV2`. Its structural and
behavioral checks confirmed atomic ADMIN creation, audit stamping, update and
soft deactivation, SUPERVISOR-only visibility, denied READ_ONLY writes, and
closed Communities and Jobs access. Validation transactions are rolled back so
no sample People remain.

For a local Supabase stack:

```bash
npm run db:push
npm run db:test
npm run lint
node --test --test-name-pattern="person|supervisor" \
  apps/frontend/tests/form-schemas.test.mjs \
  apps/frontend/tests/supervisor-record.test.mjs
npm run build
```

The next persistence slice is communities/jobsites and their Builder and
Supervisor relationships. Jobs should remain closed until those parent records
are stable.
