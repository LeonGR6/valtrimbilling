-- The browser writes the columns of a Job one by one (column-level grants), and the new
-- project_manager_id column was left without its INSERT and UPDATE grants, so creating or
-- editing a Job failed with "permission denied". Row level security and the jobs_validate
-- trigger still decide who may write and what the contact must be.

begin;

grant insert (project_manager_id), update (project_manager_id)
  on valtrim.jobs to authenticated;

commit;

notify pgrst, 'reload schema';
