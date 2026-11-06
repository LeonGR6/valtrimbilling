begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select col_is_pk('valtrim', 'quickbooks_connections', 'environment', 'There is one connection per environment');

select has_table('valtrim', 'quickbooks_settings', 'The active QuickBooks environment is stored');
select has_table('valtrim', 'quickbooks_environment_log', 'Changes of mode are logged');
select has_table('valtrim', 'quickbooks_invoice_sync_archive', 'Reset Test attempts are archived');

select has_column('valtrim', 'draw_packages', 'quickbooks_environment', 'A Package remembers the environment it was sent to');

select has_function('valtrim', 'set_quickbooks_active_environment', array['text'], 'The mode can be changed');
select has_function('valtrim', 'claim_quickbooks_invoice_sync', array['bigint', 'uuid', 'text', 'text', 'text'], 'The claim takes the typed invoice number');
select has_function('valtrim', 'reset_quickbooks_test_invoice', array['bigint', 'uuid', 'text'], 'A Test invoice can be reset');

select ok(
  has_function_privilege('authenticated', 'valtrim.set_quickbooks_active_environment(text)', 'execute')
  and not has_function_privilege('anon', 'valtrim.set_quickbooks_active_environment(text)', 'execute'),
  'Signed-in users reach the mode switch, anonymous users do not (the function checks for ADMIN)'
);

select ok(
  not has_function_privilege('authenticated', 'valtrim.reset_quickbooks_test_invoice(bigint,uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'valtrim.claim_quickbooks_invoice_sync(bigint,uuid,text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'valtrim.last_quickbooks_invoice_number(text)', 'execute'),
  'Claiming, resetting and the last number are service-role-only'
);

select ok(
  has_table_privilege('authenticated', 'valtrim.quickbooks_settings', 'select')
  and not has_table_privilege('authenticated', 'valtrim.quickbooks_settings', 'update')
  and not has_table_privilege('authenticated', 'valtrim.quickbooks_invoice_sync_archive', 'select'),
  'Everyone reads the mode; nobody writes it directly and the archive stays private'
);

select ok(
  (
    select count(*) = 1 from valtrim.quickbooks_settings
  ),
  'There is exactly one settings row'
);

select throws_ok(
  $$ select private.set_quickbooks_active_environment('production') $$,
  '42501',
  'Only an administrator can change the QuickBooks mode',
  'Without a signed-in administrator the mode cannot change'
);

select throws_ok(
  $$ select valtrim.claim_quickbooks_invoice_sync(-1, gen_random_uuid(), 'sandbox', '9341', 'bad number!') $$,
  '22023',
  'Enter an invoice number of up to 21 letters, numbers, dots or dashes',
  'The invoice number is checked before anything is claimed'
);

select throws_ok(
  $$ select valtrim.reset_quickbooks_test_invoice(-1, null, 'x') $$,
  'P0002',
  'The Package no longer exists',
  'Resetting a missing Package fails'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'valtrim'
      and tablename = 'quickbooks_invoice_syncs'
      and indexname = 'quickbooks_invoice_syncs_number_per_environment_key'
  )
  and not exists (select 1 from pg_class where relname = 'quickbooks_invoice_number_seq'),
  'Invoice numbers are unique per environment and no serial hands them out any more'
);

select ok(
  pg_get_functiondef('private.mark_package_submitted_internal(bigint)'::regprocedure)
    like '%quickbooks_environment%'
  and pg_get_functiondef('private.mark_package_submitted_internal(bigint)'::regprocedure)
    like '%invoiced in QuickBooks Test%',
  'A Package invoiced in QuickBooks Test cannot be marked as submitted'
);

select ok(
  pg_get_functiondef('valtrim.reset_quickbooks_test_invoice(bigint,uuid,text)'::regprocedure)
    like '%still being created%',
  'An invoice that is still being created cannot be reset'
);

select * from finish();

rollback;
