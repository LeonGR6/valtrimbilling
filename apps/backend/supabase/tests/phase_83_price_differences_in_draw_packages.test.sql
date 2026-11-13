begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.price_adjustment_lines'::regclass
      and conname = 'price_adjustment_lines_package_id_fkey'
      and pg_get_constraintdef(oid) like '%REFERENCES valtrim.draw_packages(id)%'
  ),
  'The difference lines of any Package, not only a Price Adjustment, belong to a Package'
);

select has_function(
  'valtrim',
  'create_draw_package_with_price_differences',
  array['bigint', 'jsonb', 'jsonb', 'date', 'text', 'bigint[]'],
  'A Draw Package is created with the price differences it carries'
);

select ok(
  not has_function_privilege(
    'anon',
    'valtrim.create_draw_package_with_price_differences(bigint, jsonb, jsonb, date, text, bigint[])',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'valtrim.create_draw_package_with_price_differences(bigint, jsonb, jsonb, date, text, bigint[])',
    'execute'
  ),
  'Only signed-in users can create it'
);

select ok(
  (
    select p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'create_draw_package_with_price_differences'
  ),
  'The creation runs with the rights of its owner, like the other Package creations'
);

select ok(
  pg_get_functiondef('valtrim.recalculate_invoice_totals()'::regprocedure)
    like '%private.recalculate_package_invoice_totals%',
  'The invoice totals trigger works the totals out in one place'
);

select ok(
  pg_get_functiondef('private.recalculate_package_invoice_totals(bigint)'::regprocedure)
    like '%price_adjustment_lines%'
  and pg_get_functiondef('private.recalculate_package_invoice_totals(bigint)'::regprocedure)
    like '%VOIDED%',
  'The invoice adds the difference lines of a Draw Package until it is cancelled'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'valtrim.draw_packages'::regclass
      and tgname = 'draw_packages_empty_invoice_with_differences'
  ),
  'Cancelling a Package that carried differences empties its invoice'
);

select ok(
  pg_get_functiondef('private.release_differences_of_voided_adjustment()'::regprocedure)
    not like '%PRICE_ADJUSTMENT%',
  'The differences are given back when any Package that collected them is cancelled'
);

select ok(
  pg_get_functiondef('private.correct_draw_invoice_package(text, bigint, bigint, jsonb, text, text)'::regprocedure)
    like '%cannot be edited or transferred%',
  'A Package that collected differences cannot be edited or transferred'
);

select ok(
  pg_get_functiondef('private.create_retention_release_package(bigint, bigint, text)'::regprocedure)
    like '%package.package_type in (''DRAW'', ''PRICE_ADJUSTMENT'')%',
  'The Retention Release takes what the differences of a Draw Package retained'
);

select * from finish();

rollback;
