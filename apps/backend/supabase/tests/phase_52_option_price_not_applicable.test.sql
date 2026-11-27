begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select has_column('valtrim', 'option_prices', 'is_not_applicable',
  'An Option price can be marked NA');
select has_column('valtrim', 'package_options', 'option_not_applicable',
  'The Package snapshot remembers that an Option price was NA');
select col_default_is('valtrim', 'option_prices', 'is_not_applicable', 'false',
  'Existing prices are not NA');

select ok(
  has_column_privilege('authenticated', 'valtrim.option_prices', 'is_not_applicable', 'select')
  and has_column_privilege('authenticated', 'valtrim.package_options', 'option_not_applicable', 'select'),
  'Signed-in users can read the NA flags'
);

select has_function('valtrim', 'set_option_price', array['bigint', 'numeric', 'boolean'],
  'One function sets an Option price or NA');
select hasnt_function('valtrim', 'set_option_price', array['bigint', 'numeric'],
  'The old two-argument function is gone');

select ok(
  pg_get_functiondef('valtrim.populate_package_options()'::regprocedure)
    like '%option_not_applicable%',
  'Billing an Option copies the NA flag into the Package'
);

select throws_ok(
  $$
    insert into valtrim.option_prices (option_id, price, is_not_applicable, effective_from)
    values (-1, 10, true, current_date)
  $$,
  '23514',
  null,
  'An NA price must be zero'
);

select * from finish();

rollback;
