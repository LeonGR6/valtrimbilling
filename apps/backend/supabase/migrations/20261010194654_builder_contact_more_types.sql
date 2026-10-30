-- PostgreSQL enum values cannot be used safely until the transaction that
-- adds them commits. This migration only extends the enum; nothing here
-- reads or writes the new values.

alter type valtrim.contact_type add value if not exists 'ESTIMATOR';
alter type valtrim.contact_type add value if not exists 'JOB_COORDINATOR';
alter type valtrim.contact_type add value if not exists 'PURCHASING';
alter type valtrim.contact_type add value if not exists 'SCHEDULING';
alter type valtrim.contact_type add value if not exists 'OPTIONS_COORDINATOR';
alter type valtrim.contact_type add value if not exists 'PROJECT_MANAGER';
