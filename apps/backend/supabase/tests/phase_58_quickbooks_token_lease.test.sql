begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

select has_function(
  'valtrim',
  'acquire_quickbooks_token_lease',
  array['uuid', 'integer'],
  'The token lease can be acquired'
);

select ok(
  not has_function_privilege('authenticated', 'valtrim.acquire_quickbooks_token_lease(uuid,text,integer)', 'execute')
  and not has_function_privilege('anon', 'valtrim.release_quickbooks_token_lease(uuid,text)', 'execute')
  and has_function_privilege('service_role', 'valtrim.acquire_quickbooks_token_lease(uuid,text,integer)', 'execute')
  and has_function_privilege('service_role', 'valtrim.release_quickbooks_token_lease(uuid,text)', 'execute'),
  'Only the service role can take or release the lease'
);

select ok(
  (
    select bool_and(prosecdef and array_to_string(proconfig, ',') = 'search_path=""')
    from pg_proc
    where oid in (
      'valtrim.acquire_quickbooks_token_lease(uuid,text,integer)'::regprocedure,
      'valtrim.release_quickbooks_token_lease(uuid,text)'::regprocedure
    )
  ),
  'The lease functions use definer rights with an empty search path'
);

select ok(
  not has_column_privilege('authenticated', 'valtrim.quickbooks_connections', 'token_lease_owner', 'select'),
  'Signed-in users cannot read who holds the lease'
);

select throws_ok(
  $$ select valtrim.acquire_quickbooks_token_lease(gen_random_uuid(), 'sandbox', 0) $$,
  '22023',
  'The QuickBooks token lease needs an owner and 1 to 120 seconds',
  'A lease needs a sensible duration'
);

select is(
  valtrim.acquire_quickbooks_token_lease(gen_random_uuid(), 'sandbox', 30),
  case
    when exists (select 1 from valtrim.quickbooks_connections connection where connection.environment = 'sandbox')
      then 'ACQUIRED'
    else 'NOT_CONNECTED'
  end,
  'Without a connection nothing can be leased; with one the first caller gets it'
);

select is(
  valtrim.release_quickbooks_token_lease(gen_random_uuid(), 'sandbox'),
  false,
  'Releasing a lease that is not yours changes nothing'
);

select * from finish();

rollback;
