begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

select ok(
  coalesce((
    select procedure.prosrc like '%pending_packages%'
      and procedure.prosrc like '%PAID_CLOSED%'
      and procedure.prosrc like '%VOIDED%'
      and procedure.prosrc like '%package_type = ''DRAW''%'
      and procedure.prosrc like '%other.job_id = v_package.job_id%'
    from pg_proc procedure
    where procedure.oid = 'private.get_package_release_values(bigint)'::regprocedure
  ), false),
  'Pending Packages are the unpaid, unvoided Draw Packages of the same Job'
);

select ok(
  coalesce((
    select procedure.prosrc like '%(other.package_date, other.id) < (v_package.package_date, v_package.id)%'
      and procedure.prosrc like '%order by other.package_date, other.id%'
    from pg_proc procedure
    where procedure.oid = 'private.get_package_release_values(bigint)'::regprocedure
  ), false),
  'Only earlier Packages count, oldest first'
);

select ok(
  coalesce((
    select procedure.prosrc like '%other.id <> v_package.id%'
    from pg_proc procedure
    where procedure.oid = 'private.get_package_release_values(bigint)'::regprocedure
  ), false),
  'The Package is never its own pending Package'
);

select ok(
  coalesce((
    select (length(procedure.prosrc) - length(replace(procedure.prosrc, 'resolve_billing_cutoff_date', '')))
      / length('resolve_billing_cutoff_date') >= 3
    from pg_proc procedure
    where procedure.oid = 'private.get_package_release_values(bigint)'::regprocedure
  ), false),
  'Each pending Package gets its cut-off from the same rule as the Package'
);

select ok(
  (
    select prosecdef
    from pg_proc
    where oid = 'private.get_package_release_values(bigint)'::regprocedure
  )
  and not (
    select prosecdef
    from pg_proc
    where oid = 'valtrim.get_package_release_values(bigint)'::regprocedure
  ),
  'The RPC keeps its definer implementation and invoker wrapper'
);

select ok(
  coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'private.get_package_release_values(bigint)'::regprocedure
  ), false),
  'The private function still pins an empty search path'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.get_package_release_values(bigint)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'valtrim.get_package_release_values(bigint)',
    'execute'
  ),
  'Execution is still limited to signed-in users'
);

select throws_ok(
  $$ select private.get_package_release_values(1) $$,
  '42501',
  'You do not have permission to read Package values',
  'Package values still need a signed-in user'
);

select ok(
  'PAID_CLOSED' = any (enum_range(null::valtrim.package_workflow_status)::text[])
  and 'VOIDED' = any (enum_range(null::valtrim.package_status)::text[]),
  'The statuses the rule relies on exist'
);

select * from finish();

rollback;
