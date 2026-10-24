-- Cover the application-user audit foreign keys before Jobs persistence is
-- opened in a later phase.

create index jobs_created_by_idx
  on valtrim.jobs (created_by)
  where created_by is not null;

create index jobs_updated_by_idx
  on valtrim.jobs (updated_by)
  where updated_by is not null;
