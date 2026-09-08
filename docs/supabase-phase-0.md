# Supabase Phase 0

Phase 0 establishes a reproducible database baseline, Auth, application roles,
and a closed-by-default Data API. It intentionally does **not** persist Builders,
Jobs, supervisors, jobsites, or the other business modules yet.

## What is included

- `20260908161430_frontend_db_improved_baseline.sql` is an exact migration copy
  of `frontend-db-2026-09-07-improved.sql`.
- `20260908161436_auth_roles_rls.sql` adds `app_users`, application roles,
  per-community access, Auth synchronization, audit-user foreign keys, grants,
  and RLS on every table in the `valtrim` schema.
- `20260908161441_expose_valtrim_data_api.sql` exposes `valtrim` through
  PostgREST; explicit grants and RLS still keep business tables closed.
- `20260908161445_refresh_postgrest_schema_cache.sql` refreshes PostgREST's
  schema cache after the custom schema is exposed.
- Only the authenticated user's own profile and administrator-managed community
  scopes are exposed. All business tables remain inaccessible to browser roles.
- The React application now uses Supabase sessions for sign-in, sign-out,
  password recovery, and protected routes.

## Remote rollout status

The `ValtrimBillingTestV2` Supabase project contained only a manually installed,
empty baseline schema when Phase 0 began. That schema was rebuilt from the
repository migrations on September 8, 2026, and the remote migration history
now matches the filenames in this repository.

The `health` and `users-admin` Edge Functions are also deployed. `health` is
public but returns only reachability and a row count; `users-admin` requires a
valid JWT and performs its own administrator check.

For a new environment, link it and inspect the dry run before pushing:

Run these commands from the repository root:

```bash
npx supabase login
npm run db:link -- --project-ref YOUR_PROJECT_REF
npm run db:push -- --dry-run
npm run db:push
```

For the current project, complete the Auth settings that are managed outside
SQL in the Supabase dashboard:

1. In Authentication URL Configuration, set the production Site URL and add
   `https://YOUR_DOMAIN/reset-password` as an allowed redirect URL.
2. Keep public email sign-up disabled; ValtrimBilling users are created by an
   administrator.

The exposed-schema list is deliberately migration-managed. If control should
return to the dashboard later, first run `alter role authenticator reset
pgrst.db_schemas;` and reload PostgREST's configuration.

## Bootstrap the first administrator

After the Phase 0 migration is installed, create the first identity in the
Supabase Authentication dashboard. The trigger creates its `app_users` profile
as `READ_ONLY`. Promote exactly that account in the SQL editor:

```sql
update valtrim.app_users
set role = 'ADMIN'
where email = lower('ADMIN_EMAIL');
```

Do not add service-role keys to the frontend. The browser only receives the
project URL and publishable key:

```bash
cp apps/frontend/.env.example apps/frontend/.env
```

Then fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

## Validation

For a local Supabase stack:

```bash
npx supabase start --workdir apps/backend
npx supabase db reset --workdir apps/backend
npm run db:test
npm run lint
npm test
npm run build
```

Before Phase 1, also validate the linked project:

```bash
npm run db:lint
npm run db:test -- --linked
```

## Phase 1 boundary

The next migration should open only the first complete workflow and give it
specific grants and RLS policies. Recommended order:

1. Builders and their automatic billing setup.
2. People with the `SUPERVISOR` role.
3. Communities/jobsite records and their Builder/Supervisor relationships.
4. Frontend providers for those three catalogs, replacing mock arrays with
   Supabase repositories while preserving the current component API.

Jobs should follow only after those parent records are stable, because every
job depends on a Builder and community/jobsite context.
