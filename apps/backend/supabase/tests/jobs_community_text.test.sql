begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

select has_column(
  'valtrim',
  'jobs',
  'community',
  'Jobs store Community as a direct column'
);

select col_type_is(
  'valtrim',
  'jobs',
  'community',
  'text',
  'Jobs Community uses the text type'
);

select col_not_null(
  'valtrim',
  'jobs',
  'community',
  'Jobs Community is required'
);

select ok(
  exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'valtrim.jobs'::regclass
      and constraint_record.conname = 'jobs_community_normalized_check'
      and pg_get_constraintdef(constraint_record.oid) like '%btrim%'
      and pg_get_constraintdef(constraint_record.oid) like '%char_length%100%'
  ),
  'Jobs Community has normalization and length constraints'
);

select hasnt_column(
  'valtrim',
  'jobs',
  'community_id',
  'Jobs no longer store a Community catalog id'
);

select ok(
  not exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'valtrim.jobs'::regclass
      and pg_get_constraintdef(constraint_record.oid) like '%community_id%'
  ),
  'No Jobs constraint depends on community_id'
);

select hasnt_index(
  'valtrim',
  'jobs',
  'jobs_community_idx',
  'The obsolete Community foreign-key index was removed'
);

select has_index(
  'valtrim',
  'jobs',
  'jobs_builder_community_idx',
  'Jobs have a Builder and normalized Community lookup index'
);

select ok(
  (
    select indexdef like '%(builder_id, lower(community))%'
    from pg_indexes
    where schemaname = 'valtrim'
      and tablename = 'jobs'
      and indexname = 'jobs_builder_community_idx'
  ),
  'The replacement index targets Builder and case-normalized Community text'
);

select has_column(
  'valtrim',
  'job_overview',
  'community',
  'Job overview exposes the direct Community text'
);

select hasnt_column(
  'valtrim',
  'job_overview',
  'community_id',
  'Job overview no longer exposes a Community id'
);

select hasnt_column(
  'valtrim',
  'job_overview',
  'community_name',
  'Job overview no longer models Community as a joined entity'
);

select ok(
  'security_invoker=true' = any(
    coalesce(
      (
        select view_record.reloptions
        from pg_class view_record
        where view_record.oid = 'valtrim.job_overview'::regclass
      ),
      array[]::text[]
    )
  ),
  'Job overview remains a security-invoker view'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.job_overview', 'select'),
  'Job overview remains closed to authenticated browser clients'
);

select ok(
  has_table_privilege('authenticated', 'valtrim.jobs', 'select')
  and has_column_privilege('authenticated', 'valtrim.jobs', 'code', 'insert')
  and has_column_privilege('authenticated', 'valtrim.jobs', 'code', 'update')
  and not has_table_privilege('authenticated', 'valtrim.jobs', 'delete'),
  'Jobs expose catalog reads and soft-write operations without hard delete'
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
  'valtrim',
  'communities',
  'The legacy Communities table remains in place'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.communities', 'select'),
  'The legacy Communities table remains closed'
);

select ok(
  coalesce(obj_description('valtrim.communities'::regclass), '')
    like '%pending retirement%'
  and coalesce(obj_description('valtrim.communities'::regclass), '')
    like '%user_community_access%'
  and coalesce(obj_description('valtrim.communities'::regclass), '')
    like '%service_properties%',
  'Communities are documented as pending retirement with both retained dependencies'
);

select is(
  (
    select count(*)
    from pg_constraint constraint_record
    where constraint_record.confrelid = 'valtrim.communities'::regclass
      and constraint_record.conrelid in (
        'valtrim.user_community_access'::regclass,
        'valtrim.service_properties'::regclass
      )
      and constraint_record.contype = 'f'
  ),
  2::bigint,
  'Community foreign keys for Users and Customer Service remain intact'
);

select ok(
  position(
    'communities' in lower(
      pg_get_functiondef('valtrim.validate_job()'::regprocedure)
    )
  ) = 0
  and position(
    'new.community_id' in lower(
      pg_get_functiondef('valtrim.validate_job()'::regprocedure)
    )
  ) = 0,
  'validate_job no longer reads the Communities catalog'
);

select ok(
  position(
    'new.community := btrim(new.community)' in lower(
      pg_get_functiondef('valtrim.validate_job()'::regprocedure)
    )
  ) > 0,
  'validate_job normalizes Community before storage'
);

select is(
  (
    select count(*)
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'valtrim.jobs'::regclass
      and constraint_record.contype = 'f'
      and constraint_record.conname in (
        'jobs_superintendent_id_builder_id_superintendent_type_fkey',
        'jobs_billing_setup_version_id_builder_id_fkey'
      )
  ),
  2::bigint,
  'Current Jobsite Superintendent and billing constraints remain intact'
);

insert into valtrim.builders (code, name)
values ('JOBSCOMMUNITYPGTAP', 'Jobs Community PgTap Builder');

insert into valtrim.people (name, email, territory)
values (
  'Jobs Community Supervisor',
  'jobs-community-supervisor@example.com',
  'Jobs Community PgTap territory'
);

insert into valtrim.person_roles (person_id, role)
select id, 'SUPERVISOR'
from valtrim.people
where email = 'jobs-community-supervisor@example.com';

insert into valtrim.builder_contacts (builder_id, name, type, email)
select id, 'Jobs Community Superintendent', 'JOBSITE_SUPERINTENDENT',
  'jobs-community-superintendent@example.com'
from valtrim.builders
where code = 'JOBSCOMMUNITYPGTAP';

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
where builder.code = 'JOBSCOMMUNITYPGTAP';

insert into valtrim.jobs (
  code,
  builder_id,
  community,
  supervisor_id,
  superintendent_id
)
select
  'JOBSCOMMUNITYPGTAP',
  builder.id,
  '  North Ridge  ',
  supervisor.id,
  superintendent.id
from valtrim.builders builder
join valtrim.people supervisor
  on supervisor.email = 'jobs-community-supervisor@example.com'
join valtrim.builder_contacts superintendent
  on superintendent.builder_id = builder.id
  and superintendent.type = 'JOBSITE_SUPERINTENDENT'
where builder.code = 'JOBSCOMMUNITYPGTAP';

select is(
  (
    select community
    from valtrim.jobs
    where code = 'JOBSCOMMUNITYPGTAP'
  ),
  'North Ridge',
  'A Job stores trimmed Community text without a catalog id'
);

select is(
  (
    select community
    from valtrim.job_overview
    where code = 'JOBSCOMMUNITYPGTAP'
  ),
  'North Ridge',
  'Job overview returns the stored Community text'
);

select is(
  (
    select count(*)
    from valtrim.communities
    where name = 'North Ridge'
  ),
  0::bigint,
  'Creating a Job does not create or require a Communities catalog row'
);

select * from finish();

rollback;
