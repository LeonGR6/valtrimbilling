-- Phase 4 follow-up: cover the application-user audit foreign keys that become
-- active when Builder billing setup versions are persisted.

create index billing_setup_versions_created_by_idx
  on valtrim.billing_setup_versions (created_by)
  where created_by is not null;

create index billing_setup_versions_activated_by_idx
  on valtrim.billing_setup_versions (activated_by)
  where activated_by is not null;
