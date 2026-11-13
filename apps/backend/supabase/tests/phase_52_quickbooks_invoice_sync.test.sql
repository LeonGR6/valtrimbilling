begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select has_table('valtrim', 'quickbooks_invoice_syncs', 'QuickBooks invoice attempts are stored per Package');

select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.quickbooks_invoice_syncs'::regclass),
  'Row level security is enabled on the sync table'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.quickbooks_invoice_syncs', 'insert')
  and not has_table_privilege('anon', 'valtrim.quickbooks_invoice_syncs', 'select'),
  'Users cannot write sync rows and anonymous users cannot read them'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.quickbooks_invoice_syncs', 'status', 'select')
  and not has_column_privilege('authenticated', 'valtrim.quickbooks_invoice_syncs', 'payload', 'select')
  and not has_column_privilege('authenticated', 'valtrim.quickbooks_invoice_syncs', 'request_id', 'select'),
  'Signed-in users see the outcome but not the sent payload or request id'
);

select ok(
  not has_function_privilege('authenticated', 'valtrim.claim_quickbooks_invoice_sync(bigint,uuid,text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'valtrim.complete_quickbooks_invoice_sync(bigint,text,text,text,numeric,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'valtrim.fail_quickbooks_invoice_sync(bigint,text,boolean)', 'execute')
  and has_function_privilege('service_role', 'valtrim.claim_quickbooks_invoice_sync(bigint,uuid,text,text,text)', 'execute'),
  'Only the service role can claim, complete or fail an attempt'
);

select ok(
  (
    select bool_and(prosecdef and array_to_string(proconfig, ',') = 'search_path=""')
    from pg_proc
    where oid in (
      'valtrim.claim_quickbooks_invoice_sync(bigint,uuid,text,text,text)'::regprocedure,
      'valtrim.complete_quickbooks_invoice_sync(bigint,text,text,text,numeric,jsonb)'::regprocedure,
      'valtrim.fail_quickbooks_invoice_sync(bigint,text,boolean)'::regprocedure
    )
  ),
  'The sync functions use definer rights with an empty search path'
);

select throws_ok(
  $$ select valtrim.claim_quickbooks_invoice_sync(-1, gen_random_uuid(), 'sandbox', '9341', '15001') $$,
  'P0002',
  'The Package no longer exists',
  'Claiming a missing Package fails'
);

select throws_ok(
  $$ select valtrim.complete_quickbooks_invoice_sync(-1, '1', 'DP-1', '0', 1, null) $$,
  '55000',
  'No QuickBooks invoice attempt is in progress for this Package',
  'Completing without a claimed attempt fails'
);

select * from finish();

rollback;
