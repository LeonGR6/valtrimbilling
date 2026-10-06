begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select has_column(
  'valtrim', 'billing_setup_versions', 'retention_release_scope',
  'Builder Setup versions store the immutable retention release scope'
);
select col_default_is(
  'valtrim', 'billing_setup_versions', 'retention_release_scope',
  'JOB',
  'Historical and new Builder Setup versions default retention release to Per Job'
);
select has_column(
  'valtrim', 'draw_packages', 'package_type',
  'Packages distinguish Draw and Retention Release records'
);
select has_table(
  'valtrim', 'retention_releases',
  'Retention Release headers are persisted'
);
select has_table(
  'valtrim', 'retention_release_lines',
  'Retention Release source allocations are persisted'
);

select ok(coalesce((
  select table_record.relrowsecurity
  from pg_class table_record
  where table_record.oid = 'valtrim.retention_releases'::regclass
), false), 'Retention Release headers have RLS enabled');
select ok(coalesce((
  select table_record.relrowsecurity
  from pg_class table_record
  where table_record.oid = 'valtrim.retention_release_lines'::regclass
), false), 'Retention Release source lines have RLS enabled');

select has_function(
  'private',
  'create_retention_release_package',
  array['bigint', 'bigint', 'text'],
  'A private atomic Retention Release implementation exists'
);
select has_function(
  'valtrim',
  'create_retention_release_package',
  array['bigint', 'bigint', 'text'],
  'The browser-facing Retention Release wrapper exists'
);

select ok(coalesce((
  select procedure.prosrc like '%READY_TO_SUBMIT%'
    and procedure.prosrc like '%AWAITING_PAYMENT%'
    and procedure.prosrc like '%PAID_CLOSED%'
    and procedure.prosrc not like '%package.workflow_status in (%DRAFT%'
  from pg_proc procedure
  where procedure.oid =
    'private.create_retention_release_package(bigint,bigint,text)'::regprocedure
), false), 'Only qualifying non-Draft workflow statuses fund a release');

select ok(coalesce((
  select procedure.prosrc like '%not lot.is_utility_building%'
    and procedure.prosrc like '%sum(line.retention_amount)%'
  from pg_proc procedure
  where procedure.oid =
    'private.create_retention_release_package(bigint,bigint,text)'::regprocedure
), false), 'Utility is excluded from Hardware completion but all retained lines fund the release');

select ok(coalesce((
  select procedure.prosrc like '%private.add_one_month_clamped%'
    and procedure.prosrc like '%current_date < v_available_date%'
  from pg_proc procedure
  where procedure.oid =
    'private.create_retention_release_package(bigint,bigint,text)'::regprocedure
), false), 'Release creation enforces the one-month cutoff hold');

select ok(coalesce((
  select procedure.prosrc like '%retention_release_lines%'
  from pg_proc procedure
  where procedure.oid =
    'valtrim.validate_package_workflow_status_change()'::regprocedure
), false), 'A Retention Release with immutable source lines can leave Draft');

select ok(
  has_column_privilege(
    'authenticated',
    'valtrim.billing_setup_versions',
    'retention_release_scope',
    'SELECT'
  ),
  'Authenticated users can read the Builder retention release scope'
);
select ok(
  has_column_privilege(
    'authenticated',
    'valtrim.draw_packages',
    'package_type',
    'SELECT'
  ),
  'Authenticated users can read the Package type'
);
select ok(
  has_table_privilege(
    'authenticated',
    'valtrim.retention_releases',
    'SELECT'
  ) and has_table_privilege(
    'authenticated',
    'valtrim.retention_release_lines',
    'SELECT'
  ),
  'Authenticated users can read Retention Release snapshots'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'valtrim.retention_releases',
    'INSERT'
  ) and not has_table_privilege(
    'authenticated',
    'valtrim.retention_release_lines',
    'INSERT'
  ),
  'Browser users cannot insert Retention Release snapshots directly'
);

select ok(coalesce((
  select not procedure.prosecdef
  from pg_proc procedure
  where procedure.oid =
    'valtrim.create_retention_release_package(bigint,bigint,text)'::regprocedure
), false), 'The exposed RPC is a security-invoker wrapper');

select * from finish();

rollback;
