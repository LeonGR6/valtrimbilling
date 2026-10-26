begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

select has_table('valtrim', 'quickbooks_oauth_states', 'OAuth states are stored');
select has_table('valtrim', 'quickbooks_connections', 'The QuickBooks connection is stored');
select has_table('valtrim', 'builder_quickbooks_customers', 'Builder to Customer mapping is stored');

select ok(
  (
    select bool_and(relrowsecurity)
    from pg_class
    where oid in (
      'valtrim.quickbooks_oauth_states'::regclass,
      'valtrim.quickbooks_connections'::regclass,
      'valtrim.builder_quickbooks_customers'::regclass
    )
  ),
  'Row level security is enabled on every QuickBooks table'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.quickbooks_oauth_states', 'select')
  and not has_table_privilege('anon', 'valtrim.quickbooks_connections', 'select'),
  'OAuth states and the connection are not readable by anonymous users, and states not by signed-in users'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.quickbooks_connections', 'status', 'select')
  and not has_column_privilege(
    'authenticated',
    'valtrim.quickbooks_connections',
    'refresh_token_secret_id',
    'select'
  ),
  'Signed-in users can see the connection status but never the Vault secret id'
);

select ok(
  not has_function_privilege('authenticated', 'valtrim.get_quickbooks_credentials(text)', 'execute')
  and not has_function_privilege('anon', 'valtrim.get_quickbooks_credentials(text)', 'execute')
  and has_function_privilege('service_role', 'valtrim.get_quickbooks_credentials(text)', 'execute'),
  'Only the service role can read the decrypted credentials'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'valtrim.rotate_quickbooks_refresh_token(text, text, timestamptz)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'valtrim.rotate_quickbooks_refresh_token(text, text, timestamptz)',
    'execute'
  ),
  'Only the service role can rotate the refresh token'
);

select ok(
  (
    select bool_and(prosecdef and array_to_string(proconfig, ',') = 'search_path=""')
    from pg_proc
    where oid in (
      'valtrim.complete_quickbooks_connection(uuid,text,text,text,text,text,text,timestamptz,text,text)'::regprocedure,
      'valtrim.get_quickbooks_credentials(text)'::regprocedure,
      'valtrim.rotate_quickbooks_refresh_token(text,text,timestamptz)'::regprocedure
    )
  ),
  'Credential functions use definer rights with an empty search path'
);

select throws_ok(
  $$ select valtrim.complete_quickbooks_connection(
       gen_random_uuid(), '9341', 'sandbox', null, null, null, 'refresh', null,
       'com.intuit.quickbooks.accounting', null
     ) $$,
  '42501',
  'Only an active administrator can connect QuickBooks',
  'Only an administrator can complete the connection'
);

select throws_ok(
  $$ insert into valtrim.quickbooks_connections (realm_id, environment, refresh_token_secret_id)
     values ('1', 'staging', gen_random_uuid()) $$,
  '23514',
  null,
  'Only Test (sandbox) and Production can be connected'
);

select * from finish();

rollback;
