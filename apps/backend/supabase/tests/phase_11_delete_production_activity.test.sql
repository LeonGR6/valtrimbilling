begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

select has_function(
  'private',
  'cancel_production_activity',
  array['bigint'],
  'Private Production cancellation implementation is available'
);
select has_function(
  'valtrim',
  'cancel_production_activity',
  array['bigint'],
  'Exposed Production cancellation RPC is available'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.cancel_production_activity(bigint)',
    'execute'
  ),
  'Authenticated users can call the role-checked cancellation RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'valtrim.cancel_production_activity(bigint)',
    'execute'
  ),
  'Anonymous clients cannot call the cancellation RPC'
);
select ok(
  not has_function_privilege(
    'public',
    'private.cancel_production_activity(bigint)',
    'execute'
  ),
  'The privileged cancellation implementation is not public'
);

select ok(
  (select prosecdef from pg_proc where oid =
    'private.cancel_production_activity(bigint)'::regprocedure),
  'Private cancellation uses definer rights after its actor and role checks'
);
select ok(
  not (select prosecdef from pg_proc where oid =
    'valtrim.cancel_production_activity(bigint)'::regprocedure),
  'Exposed cancellation wrapper runs as the caller'
);
select ok(
  coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'private.cancel_production_activity(bigint)'::regprocedure
  ), false)
  and coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'valtrim.cancel_production_activity(bigint)'::regprocedure
  ), false),
  'Cancellation functions pin an empty search path'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.production_activities', 'delete')
  and not has_table_privilege('authenticated', 'valtrim.production_schedules', 'delete')
  and not has_table_privilege('authenticated', 'valtrim.production_date_history', 'delete'),
  'Browser clients still cannot hard-delete Production or audit rows'
);

select is(
  obj_description('valtrim.cancel_production_activity(bigint)'::regprocedure, 'pg_proc'),
  'Soft-cancels one complete Production calendar group while retaining its schedules and audit history. ADMIN, PROJECT_MANAGEMENT and SCHEDULING only.',
  'Cancellation RPC documents its soft-delete and role boundary'
);

select * from finish();

rollback;
