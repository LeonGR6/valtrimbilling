-- Commit the new enum value before the following migration uses it.
-- PostgreSQL does not allow using an added enum value before its transaction commits.
begin;
alter type valtrim.service_request_source_type add value if not exists 'EMAIL_METADATA';
commit;
