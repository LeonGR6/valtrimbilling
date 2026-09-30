begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

select has_table('valtrim', 'jobs', 'Jobs table is available');

select ok(
  has_table_privilege('authenticated', 'valtrim.jobs', 'select'),
  'Authenticated users can select Jobs subject to RLS'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.jobs', 'code', 'insert'),
  'Authenticated users can insert the Job number subject to RLS'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.jobs', 'community', 'insert'),
  'Authenticated users can insert direct Community text subject to RLS'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.jobs', 'supervisor_id', 'update'),
  'Authenticated users can update the Supervisor subject to RLS'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.jobs', 'is_active', 'update'),
  'Authenticated users can soft-deactivate Jobs subject to RLS'
);

select ok(
  not has_column_privilege('authenticated', 'valtrim.jobs', 'is_active', 'insert'),
  'New Jobs always use the database active default'
);

select ok(
  not has_column_privilege(
    'authenticated', 'valtrim.jobs', 'billing_setup_version_id', 'insert'
  ),
  'Browser clients cannot choose the Job Billing Setup snapshot'
);

select ok(
  not has_column_privilege(
    'authenticated', 'valtrim.jobs', 'billing_setup_version_id', 'update'
  ),
  'Browser clients cannot replace the Job Billing Setup snapshot'
);

select ok(
  not has_column_privilege('authenticated', 'valtrim.jobs', 'created_by', 'insert'),
  'Browser clients cannot provide the creator audit field'
);

select ok(
  not has_column_privilege('authenticated', 'valtrim.jobs', 'updated_by', 'update'),
  'Browser clients cannot provide the updater audit field'
);

select ok(
  not has_column_privilege(
    'authenticated', 'valtrim.jobs', 'superintendent_type', 'insert'
  ),
  'Browser clients cannot provide the generated Superintendent type'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.jobs', 'delete'),
  'Jobs cannot be hard deleted from the browser'
);

select ok(
  has_sequence_privilege('authenticated', 'valtrim.jobs_id_seq', 'usage'),
  'Authenticated Job inserts can allocate an identity'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'valtrim'
      and tablename = 'jobs'
  ),
  3::bigint,
  'Jobs have select, insert, and update RLS policies'
);

select set_eq(
  $$
    select policyname
    from pg_policies
    where schemaname = 'valtrim'
      and tablename = 'jobs'
  $$,
  $$ values ('jobs_select'), ('jobs_insert'), ('jobs_update') $$,
  'Jobs expose exactly the expected policies'
);

select ok(
  not has_table_privilege('anon', 'valtrim.jobs', 'select')
  and not has_table_privilege('anon', 'valtrim.jobs', 'insert')
  and not has_table_privilege('anon', 'valtrim.jobs', 'update')
  and not has_table_privilege('anon', 'valtrim.jobs', 'delete'),
  'Anonymous clients have no Jobs privileges'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.job_overview', 'select'),
  'Job overview remains closed while its downstream tables are unopened'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.communities', 'select'),
  'The legacy Communities model remains closed'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.plans', 'select'),
  'Plans remain closed'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.phases', 'select'),
  'Sequence Sheet phases remain closed'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.draw_packages', 'select'),
  'Draw Packages remain closed'
);

select * from finish();

rollback;
