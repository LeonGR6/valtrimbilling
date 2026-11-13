begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

select has_function('valtrim', 'import_purchase_order_options', array['bigint[]'],
  'There is still one import function');

select ok(
  pg_get_functiondef('valtrim.import_purchase_order_options(bigint[])'::regprocedure)
    like '%''added'', v_added_items%'
  and pg_get_functiondef('valtrim.import_purchase_order_options(bigint[])'::regprocedure)
    like '%''created_option'', v_created_now%',
  'The import lists each option it selected for a Lot, and whether it created the option'
);

select ok(
  has_function_privilege('authenticated', 'valtrim.import_purchase_order_options(bigint[])', 'execute')
  and not has_function_privilege('anon', 'valtrim.import_purchase_order_options(bigint[])', 'execute'),
  'Replacing the function keeps who can call it'
);

select ok(
  pg_get_functiondef('valtrim.import_purchase_order_options(bigint[])'::regprocedure)
    like '%has_app_role(''ADMIN'', ''PROJECT_MANAGEMENT'')%'
  and pg_get_functiondef('valtrim.import_purchase_order_options(bigint[])'::regprocedure)
    like '%phase_billed%',
  'The permission check and the billed-Phase protection are unchanged'
);

select * from finish();

rollback;
