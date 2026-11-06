begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select has_table('valtrim', 'job_billing_setup_changes', 'The history of Job billing setup changes exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.job_billing_setup_changes'::regclass),
  'The history of Job billing setup changes has RLS enabled'
);

select ok(
  has_table_privilege('authenticated', 'valtrim.job_billing_setup_changes', 'select')
  and not has_table_privilege('authenticated', 'valtrim.job_billing_setup_changes', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.job_billing_setup_changes', 'update')
  and not has_table_privilege('authenticated', 'valtrim.job_billing_setup_changes', 'delete'),
  'Browser clients can read the history but never write it'
);

select set_eq(
  $$
    select policyname
    from pg_policies
    where schemaname = 'valtrim'
      and tablename = 'job_billing_setup_changes'
  $$,
  $$ values ('job_billing_setup_changes_select') $$,
  'The history exposes only the active-user read policy'
);

select ok(
  not has_column_privilege('authenticated', 'valtrim.jobs', 'billing_setup_version_id', 'update')
  and not has_column_privilege('authenticated', 'valtrim.jobs', 'billing_setup_version_id', 'insert'),
  'Browser clients cannot write the billing setup version of a Job directly'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.change_job_billing_setup(bigint,bigint,text)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'valtrim.preview_job_billing_setup_change(bigint,bigint)',
    'execute'
  ),
  'Authenticated users can call the role-checked change and preview functions'
);

select ok(
  not has_function_privilege(
    'anon',
    'valtrim.change_job_billing_setup(bigint,bigint,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'valtrim.preview_job_billing_setup_change(bigint,bigint)',
    'execute'
  ),
  'Anonymous clients cannot call the change or preview functions'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.job_billing_setup_change_check(bigint,bigint)',
    'execute'
  ),
  'The checks behind the change are not callable from the browser'
);

select ok(
  (
    select prosecdef
    from pg_proc
    where oid = 'valtrim.change_job_billing_setup(bigint,bigint,text)'::regprocedure
  ),
  'The change runs as SECURITY DEFINER after checking the role itself'
);

select is(
  (
    select count(*)::integer
    from pg_trigger
    where tgrelid = 'valtrim.jobs'::regclass
      and tgname = 'jobs_validate'
      and not tgisinternal
  ),
  1,
  'The Job validation trigger is still in place'
);

select ok(
  pg_get_functiondef('valtrim.validate_job()'::regprocedure)
    like '%valtrim.job_setup_change%',
  'The Job validation lets only the change function move the version'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.job_billing_setup_changes'::regclass
      and conname = 'job_billing_setup_changes_moved'
  ),
  'A change must move the Job to a different version'
);

select * from finish();

rollback;
