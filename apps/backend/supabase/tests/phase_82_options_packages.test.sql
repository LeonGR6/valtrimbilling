begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.draw_packages'::regclass
      and conname = 'draw_packages_package_type_check'
      and pg_get_constraintdef(oid) like '%OPTIONS%'
      and pg_get_constraintdef(oid) like '%PRICE_ADJUSTMENT%'
  ),
  'OPTIONS is a Package type next to Draw, Retention Release and Price Adjustment'
);

select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'valtrim'
      and table_name = 'package_options'
      and column_name in ('billing_lot_id', 'draw_id')
      and is_nullable = 'NO'
  ),
  'An Option billed on its own has no billing Lot or Draw line'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.package_options'::regclass
      and conname = 'package_options_anchor_pair_check'
      and pg_get_constraintdef(oid) like '%billing_lot_id IS NULL%'
      and pg_get_constraintdef(oid) like '%draw_id IS NULL%'
  ),
  'The billing Lot and the Draw line are both set or both empty'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'valtrim.package_options'::regclass
      and tgname = 'package_options_check_anchor'
      and pg_get_triggerdef(oid) like 'CREATE TRIGGER package_options_check_anchor BEFORE INSERT%'
  ),
  'Only an Options Package bills Options without a Draw line, and it bills nothing else'
);

select ok(
  (
    select count(*) = 2
    from information_schema.columns
    where table_schema = 'valtrim'
      and table_name = 'package_options'
      and column_name in ('retention_amount', 'wrap_amount')
      and column_default like '0%'
      and is_nullable = 'NO'
  ),
  'Each Option keeps the Retention and WRAP deducted on it, zero in a Draw Package'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.package_options', 'retention_amount', 'SELECT')
  and has_column_privilege('authenticated', 'valtrim.package_options', 'wrap_amount', 'SELECT'),
  'Signed-in users can read the Retention and WRAP of an Option'
);

select ok(
  coalesce((
    select relrowsecurity
    from pg_class
    where oid = 'valtrim.retention_release_option_lines'::regclass
  ), false)
  and has_table_privilege('authenticated', 'valtrim.retention_release_option_lines', 'SELECT')
  and not has_table_privilege('authenticated', 'valtrim.retention_release_option_lines', 'INSERT'),
  'What a Retention Release took from Options Packages can be read, never written, by users'
);

select ok(
  has_function_privilege('authenticated', 'valtrim.create_options_package(bigint,jsonb,date,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'valtrim.create_options_package(bigint,jsonb,date,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.create_options_package(bigint,jsonb,date,text)', 'EXECUTE'),
  'Signed-in users can create an Options Package, visitors cannot'
);

select throws_ok(
  $$ select valtrim.create_options_package(0, '[]'::jsonb) $$,
  '42501',
  'You do not have permission to create an Options Package',
  'Without a signed-in user nothing is created'
);

select ok(coalesce((
  select procedure.prosecdef
    and procedure.prosrc like '%''OPTIONS''%'
    and procedure.prosrc like '%''OP-''%'
    and procedure.prosrc like '%retention_amount%'
    and procedure.prosrc like '%wrap_amount%'
    and procedure.prosrc like '%nothing to invoice%'
  from pg_proc procedure
  where procedure.oid = 'private.create_options_package(bigint,jsonb,date,text)'::regprocedure
), false), 'The Package gets its own number, deducts Retention and WRAP per Option, and needs a positive total');

select ok(coalesce((
  select procedure.prosrc like '%retention_release_option_lines%'
    and procedure.prosrc like '%v_inserted_options%'
    and procedure.prosrc like '%package_type = ''OPTIONS''%'
  from pg_proc procedure
  where procedure.oid = 'private.create_retention_release_package(bigint,bigint,text)'::regprocedure
), false), 'The Retention Release takes the retention of Options Packages and records which Options it took');

select ok(coalesce((
  select procedure.prosrc like '%retention_release_option_lines%'
    and procedure.prosrc like '%''OPTIONS''%'
  from pg_proc procedure
  where procedure.oid = 'valtrim.prevent_allocated_source_package_void()'::regprocedure
), false), 'An Options Package that a Retention Release took from cannot be cancelled');

select ok(coalesce((
  select procedure.prosrc like '%retention_release_option_lines%'
    and procedure.prosrc like '%valtrim.package_options line%'
  from pg_proc procedure
  where procedure.oid = 'valtrim.validate_package_workflow_status_change()'::regprocedure
), false), 'An Options Package leaves Draft because it has Options, and cannot go back while a Retention Release holds it');

select ok(coalesce((
  select procedure.prosrc like '%package_type in (''DRAW'', ''OPTIONS'')%'
  from pg_proc procedure
  where procedure.oid = 'private.get_package_release_values(bigint)'::regprocedure
), false), 'An Options Package that is not paid is listed as owed by the Packages after it');

select * from finish();

rollback;
