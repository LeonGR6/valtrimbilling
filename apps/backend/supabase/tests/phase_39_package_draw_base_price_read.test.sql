begin;

create extension if not exists pgtap with schema extensions;

select plan(2);

select ok(
  has_column_privilege(
    'authenticated',
    'valtrim.package_draws',
    'base_price',
    'SELECT'
  ),
  'Authenticated users can read the immutable Package Draw base price snapshot'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'valtrim.package_draws',
    'SELECT'
  ),
  'Package Draw reads remain restricted to explicitly granted columns'
);

select * from finish();

rollback;
