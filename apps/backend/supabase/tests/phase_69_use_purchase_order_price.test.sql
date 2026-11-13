begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select has_function('valtrim', 'use_purchase_order_price', array['bigint[]', 'text', 'boolean'],
  'The price a Purchase Order prints can be adopted');

select ok(
  has_function_privilege('authenticated', 'valtrim.use_purchase_order_price(bigint[],text,boolean)', 'execute')
  and not has_function_privilege('anon', 'valtrim.use_purchase_order_price(bigint[],text,boolean)', 'execute'),
  'Signed-in users can call it; anonymous clients cannot'
);

select ok(
  (select prosecdef from pg_proc
    where oid = 'valtrim.use_purchase_order_price(bigint[],text,boolean)'::regprocedure),
  'It runs behind its own authorization boundary'
);

select ok(
  pg_get_functiondef('valtrim.use_purchase_order_price(bigint[],text,boolean)'::regprocedure)
    like '%has_app_role(''ADMIN'', ''PROJECT_MANAGEMENT'')%',
  'Only Admin and Project Management can change option prices'
);

select ok(
  pg_get_functiondef('valtrim.use_purchase_order_price(bigint[],text,boolean)'::regprocedure)
    like '%Enter the reason for this price change%',
  'A reason is required'
);

select ok(
  pg_get_functiondef('valtrim.use_purchase_order_price(bigint[],text,boolean)'::regprocedure)
    like '%valtrim.set_option_price(v_option_id, v_price, false)%'
  and pg_get_functiondef('valtrim.use_purchase_order_price(bigint[],text,boolean)'::regprocedure)
    like '%valtrim.apply_phase_price_changes(%',
  'The Plan price is set and the chosen Lots move with the Phase price update'
);

select ok(
  pg_get_functiondef('valtrim.use_purchase_order_price(bigint[],text,boolean)'::regprocedure)
    like '%header_status <> ''resolved''%',
  'A Lot that was only suggested must be confirmed first'
);

select ok(
  pg_get_functiondef('valtrim.use_purchase_order_price(bigint[],text,boolean)'::regprocedure)
    like '%Choose lines of one option that print the same price%',
  'An option has one price per Plan: all chosen lines must print the same one'
);

select * from finish();

rollback;
