begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select col_type_is('valtrim', 'option_prices', 'price', 'numeric(14,2)',
  'An Option price is a plain amount that can be negative');
select col_type_is('valtrim', 'package_options', 'option_price', 'numeric(14,2)',
  'The Package snapshot of an Option price can be negative');
select col_type_is('valtrim', 'package_draws', 'options_amount', 'numeric(14,2)',
  'The Options total of a Draw line can be negative');
select col_type_is('valtrim', 'package_draws', 'gross_amount', 'valtrim.amount',
  'A Draw line gross is still never negative');

select ok(
  pg_get_functiondef('valtrim.set_option_price(bigint,numeric,boolean)'::regprocedure)
    not like '%p_price < 0%',
  'Setting an Option price no longer rejects negative amounts'
);

select ok(
  pg_get_functiondef('valtrim.prepare_package_draw()'::regprocedure)
    like '%Options credit is larger%',
  'A credit larger than the Draw it is billed with has its own message'
);

select * from finish();

rollback;
