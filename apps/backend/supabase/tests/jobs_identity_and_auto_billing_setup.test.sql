begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

select hasnt_column(
  'valtrim', 'jobs', 'name',
  'Jobs are identified only by code and do not store a redundant name'
);
select hasnt_column(
  'valtrim', 'jobs', 'ap_contact_id',
  'Jobs do not require an AP Contact assignment'
);
select hasnt_column(
  'valtrim', 'jobs', 'ap_contact_type',
  'Jobs have no generated AP Contact type'
);
select hasnt_index(
  'valtrim', 'jobs', 'jobs_builder_name_uq',
  'The obsolete Builder and Job name index was removed'
);
select hasnt_index(
  'valtrim', 'jobs', 'jobs_ap_contact_idx',
  'The obsolete Job AP Contact index was removed'
);
select has_index(
  'valtrim', 'jobs', 'jobs_created_by_idx',
  'The Job creator audit reference has a covering index'
);
select has_index(
  'valtrim', 'jobs', 'jobs_updated_by_idx',
  'The Job updater audit reference has a covering index'
);
select has_column(
  'valtrim', 'jobs', 'billing_setup_version_id',
  'Jobs retain a Billing Setup version snapshot'
);
select col_not_null(
  'valtrim', 'jobs', 'billing_setup_version_id',
  'Every persisted Job has a Billing Setup version snapshot'
);
select ok(
  exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'valtrim.jobs'::regclass
      and constraint_record.conname =
        'jobs_billing_setup_version_id_builder_id_fkey'
  ),
  'The Job Billing Setup version must belong to the same Builder'
);
select ok(
  position(
    $$version.status = 'ACTIVE'$$ in
    pg_get_functiondef('valtrim.validate_job()'::regprocedure)
  ) > 0,
  'Job creation resolves the Builder ACTIVE Billing Setup version'
);
select ok(
  position(
    'old.billing_setup_version_id' in
    pg_get_functiondef('valtrim.validate_job()'::regprocedure)
  ) > 0,
  'Normal Job edits retain the original Billing Setup version'
);

select hasnt_column(
  'valtrim', 'job_overview', 'name',
  'Job overview identifies Jobs only by code'
);
select hasnt_column(
  'valtrim', 'job_overview', 'ap_contact_id',
  'Job overview has no AP Contact assignment'
);
select hasnt_column(
  'valtrim', 'job_overview', 'ap_contact_name',
  'Job overview has no AP Contact display value'
);
select hasnt_column(
  'valtrim', 'draw_package_overview', 'job_name',
  'Draw package overview identifies its Job by code'
);
select ok(
  'security_invoker=true' = any(coalesce((
    select view_record.reloptions
    from pg_class view_record
    where view_record.oid = 'valtrim.job_overview'::regclass
  ), array[]::text[])),
  'Job overview remains a security-invoker view'
);
select ok(
  'security_invoker=true' = any(coalesce((
    select view_record.reloptions
    from pg_class view_record
    where view_record.oid = 'valtrim.draw_package_overview'::regclass
  ), array[]::text[])),
  'Draw package overview remains a security-invoker view'
);
select ok(
  has_table_privilege('authenticated', 'valtrim.jobs', 'select')
  and has_column_privilege('authenticated', 'valtrim.jobs', 'code', 'insert')
  and has_column_privilege('authenticated', 'valtrim.jobs', 'code', 'update')
  and not has_table_privilege('authenticated', 'valtrim.jobs', 'delete'),
  'Jobs expose catalog reads and soft-write operations without hard delete'
);
select ok(
  not has_table_privilege(
    'authenticated', 'valtrim.job_overview', 'select'
  ),
  'Job overview remains closed to authenticated browser clients'
);
select ok(
  not has_table_privilege(
    'authenticated', 'valtrim.draw_package_overview', 'select'
  ),
  'Draw package overview remains closed to authenticated browser clients'
);
select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'valtrim' and tablename = 'jobs'
  ),
  3::bigint,
  'Jobs have select, insert, and update RLS policies'
);
select has_table(
  'valtrim', 'communities',
  'The legacy Communities table remains outside this change'
);
select ok(
  not has_table_privilege('authenticated', 'valtrim.communities', 'select'),
  'The legacy Communities table remains closed'
);

insert into valtrim.builders (code, name)
values ('JOBIDENTITYPGTAP', 'Job Identity PgTap Builder');

insert into valtrim.people (name, email, territory)
values (
  'Job Identity Supervisor',
  'job-identity-supervisor@example.com',
  'Job Identity PgTap territory'
);

insert into valtrim.person_roles (person_id, role)
select id, 'SUPERVISOR'
from valtrim.people
where email = 'job-identity-supervisor@example.com';

insert into valtrim.builder_contacts (builder_id, name, type, email)
select id, 'Job Identity Superintendent', 'JOBSITE_SUPERINTENDENT',
  'job-identity-superintendent@example.com'
from valtrim.builders
where code = 'JOBIDENTITYPGTAP';

insert into valtrim.billing_setup_versions (
  setup_id,
  builder_id,
  version_number,
  status,
  frequency,
  cutoff_day,
  submission_day,
  activated_at
)
select
  setup.id,
  builder.id,
  1,
  'ACTIVE',
  'MONTHLY',
  15,
  20,
  now()
from valtrim.builders builder
join valtrim.billing_setups setup on setup.builder_id = builder.id
where builder.code = 'JOBIDENTITYPGTAP';

insert into valtrim.jobs (
  code,
  builder_id,
  community,
  supervisor_id,
  superintendent_id
)
select
  'JOBIDENTITYPGTAP',
  builder.id,
  '  Job Identity Community  ',
  supervisor.id,
  superintendent.id
from valtrim.builders builder
join valtrim.people supervisor
  on supervisor.email = 'job-identity-supervisor@example.com'
join valtrim.builder_contacts superintendent
  on superintendent.builder_id = builder.id
 and superintendent.type = 'JOBSITE_SUPERINTENDENT'
where builder.code = 'JOBIDENTITYPGTAP';

select is(
  (
    select job.billing_setup_version_id
    from valtrim.jobs job
    where job.code = 'JOBIDENTITYPGTAP'
  ),
  (
    select version.id
    from valtrim.billing_setup_versions version
    join valtrim.builders builder on builder.id = version.builder_id
    where builder.code = 'JOBIDENTITYPGTAP'
      and version.status = 'ACTIVE'
  ),
  'PostgreSQL assigns the Builder ACTIVE Billing Setup version on insert'
);
select is(
  (
    select community
    from valtrim.jobs
    where code = 'JOBIDENTITYPGTAP'
  ),
  'Job Identity Community',
  'The same insert still normalizes Community text'
);

create temporary table job_identity_original_version (
  id bigint primary key
) on commit drop;

insert into job_identity_original_version (id)
select billing_setup_version_id
from valtrim.jobs
where code = 'JOBIDENTITYPGTAP';

update valtrim.billing_setup_versions version
set status = 'SUPERSEDED', updated_at = now()
from job_identity_original_version original
where version.id = original.id;

insert into valtrim.billing_setup_versions (
  setup_id,
  builder_id,
  version_number,
  status,
  frequency,
  cutoff_day,
  submission_day,
  activated_at
)
select
  setup.id,
  builder.id,
  2,
  'ACTIVE',
  'MONTHLY',
  16,
  21,
  now()
from valtrim.builders builder
join valtrim.billing_setups setup on setup.builder_id = builder.id
where builder.code = 'JOBIDENTITYPGTAP';

update valtrim.jobs job
set community = '  Updated Community  ',
    billing_setup_version_id = active_version.id
from valtrim.billing_setup_versions active_version
where job.code = 'JOBIDENTITYPGTAP'
  and active_version.builder_id = job.builder_id
  and active_version.status = 'ACTIVE';

select is(
  (
    select job.billing_setup_version_id
    from valtrim.jobs job
    where job.code = 'JOBIDENTITYPGTAP'
  ),
  (
    select id from job_identity_original_version
  ),
  'A later active Builder Setup does not rebind an existing Job'
);
select is(
  (
    select community
    from valtrim.jobs
    where code = 'JOBIDENTITYPGTAP'
  ),
  'Updated Community',
  'A Job using a superseded historical Setup can still be edited'
);

select * from finish();

rollback;
