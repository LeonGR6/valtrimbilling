-- PostgreSQL enum values cannot be used safely until the transaction that
-- adds them commits. This migration only extends the enums; nothing here
-- reads or writes the new values.
--
-- The Estimator, Job Coordinator, Purchasing, Scheduling, Options Coordinator
-- and Project Manager contacts work for Valtrim, not for the Builder, so they
-- become roles of a Company Contact (valtrim.people) next to SUPERVISOR.
-- OTHER is a Builder contact whose type was typed by the team and is kept in
-- builder_contact_types.

alter type valtrim.person_role add value if not exists 'ESTIMATOR';
alter type valtrim.person_role add value if not exists 'JOB_COORDINATOR';
alter type valtrim.person_role add value if not exists 'PURCHASING';
alter type valtrim.person_role add value if not exists 'SCHEDULING';
alter type valtrim.person_role add value if not exists 'OPTIONS_COORDINATOR';
alter type valtrim.person_role add value if not exists 'PROJECT_MANAGER';

alter type valtrim.contact_type add value if not exists 'OTHER';
