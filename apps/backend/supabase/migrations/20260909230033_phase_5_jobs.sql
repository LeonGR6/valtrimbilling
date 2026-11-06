-- Phase 5: persist the Jobs catalog while keeping Communities, Plans,
-- Sequence Sheets, Production, Draw Packages and Invoices closed.
--
-- Active authenticated users can read Jobs. Only ADMIN and
-- PROJECT_MANAGEMENT can create, edit or soft-deactivate them. Browser clients
-- can write only fields owned by the current Job form; PostgreSQL owns the
-- Billing Setup snapshot, generated contact type and audit columns.

begin;

alter table valtrim.jobs enable row level security;

revoke all on table valtrim.jobs from public, anon, authenticated;
revoke all on sequence valtrim.jobs_id_seq from public, anon, authenticated;

grant select on table valtrim.jobs to authenticated;

grant insert (
  code,
  builder_id,
  community,
  supervisor_id,
  superintendent_id
) on valtrim.jobs to authenticated;

grant update (
  code,
  builder_id,
  community,
  supervisor_id,
  superintendent_id,
  is_active
) on valtrim.jobs to authenticated;

grant usage on sequence valtrim.jobs_id_seq to authenticated;

create policy jobs_select
on valtrim.jobs for select to authenticated
using ((select private.is_active_user()));

create policy jobs_insert
on valtrim.jobs for insert to authenticated
with check ((select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')));

create policy jobs_update
on valtrim.jobs for update to authenticated
using ((select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')))
with check ((select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')));

comment on policy jobs_select on valtrim.jobs is
  'Active authenticated users can read the Jobs catalog.';

comment on policy jobs_insert on valtrim.jobs is
  'ADMIN and PROJECT_MANAGEMENT can create Jobs; validate_job selects the active Builder Billing Setup version.';

comment on policy jobs_update on valtrim.jobs is
  'ADMIN and PROJECT_MANAGEMENT can edit or soft-deactivate Jobs. Hard delete is intentionally unavailable.';

-- The overview still joins unopened downstream tables, so it remains closed.
-- The frontend reads Jobs directly and resolves display names from the already
-- persisted Builders, Supervisors and Builder Contacts catalogs.
revoke all on valtrim.job_overview from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
