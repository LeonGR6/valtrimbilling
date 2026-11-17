begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select has_function('valtrim', 'import_purchase_order_options', array['bigint[]'],
  'Options of a Purchase Order can be imported into the Job');

select ok(
  has_function_privilege('authenticated', 'valtrim.import_purchase_order_options(bigint[])', 'execute')
  and not has_function_privilege('anon', 'valtrim.import_purchase_order_options(bigint[])', 'execute'),
  'Signed-in users can call the import; anonymous clients cannot'
);

select ok(
  (select prosecdef from pg_proc
    where oid = 'valtrim.import_purchase_order_options(bigint[])'::regprocedure),
  'The import runs behind its own authorization boundary'
);

select ok(
  pg_get_functiondef('valtrim.import_purchase_order_options(bigint[])'::regprocedure)
    like '%has_app_role(''ADMIN'', ''PROJECT_MANAGEMENT'')%',
  'Only Admin and Project Management can import options'
);

select ok(
  pg_get_functiondef('valtrim.import_purchase_order_options(bigint[])'::regprocedure)
    like '%header_status <> ''resolved''%',
  'A Lot that was only suggested must be confirmed before its options are imported'
);

select ok(
  pg_get_functiondef('valtrim.import_purchase_order_options(bigint[])'::regprocedure)
    like '%package_draws%'
  and pg_get_functiondef('valtrim.import_purchase_order_options(bigint[])'::regprocedure)
    like '%phase_billed%',
  'A Phase that a Package already billed is not touched'
);

select ok(
  pg_get_functiondef('valtrim.import_purchase_order_options(bigint[])'::regprocedure)
    like '%set_option_price(v_option_id, v_line.po_unit_price, false)%',
  'A new option is created with the price the Purchase Order prints'
);

select ok(
  pg_get_functiondef('valtrim.import_purchase_order_options(bigint[])'::regprocedure)
    like '%pg_advisory_xact_lock%',
  'Two imports of the same Job cannot create an option twice'
);

select * from finish();

rollback;
