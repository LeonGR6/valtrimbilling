begin;

create extension if not exists pgtap with schema extensions;

select plan(3);

select ok(
  has_column_privilege('authenticated', 'valtrim.draw_packages', 'quickbooks_status', 'select')
  and has_column_privilege('authenticated', 'valtrim.draw_packages', 'quickbooks_reference', 'select'),
  'Signed-in users can read the QuickBooks status and reference of a Package'
);

select ok(
  not has_column_privilege('anon', 'valtrim.draw_packages', 'quickbooks_status', 'select'),
  'Anonymous users still cannot read them'
);

select ok(
  not has_column_privilege('authenticated', 'valtrim.draw_packages', 'quickbooks_status', 'update')
  and not has_column_privilege('authenticated', 'valtrim.draw_packages', 'quickbooks_reference', 'update'),
  'Signed-in users still cannot change them directly'
);

select * from finish();

rollback;
