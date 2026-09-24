begin;

create extension if not exists pgtap with schema extensions;

select plan(48);

select has_table('valtrim', 'plans', 'Plans table is available');
select has_table('valtrim', 'plan_options', 'Plan Options table is available');
select has_table('valtrim', 'plan_prices', 'Plan Prices table is available');
select has_table('valtrim', 'option_prices', 'Option Prices table is available');

select ok(
  has_table_privilege('authenticated', 'valtrim.plans', 'select'),
  'Authenticated users can select Plans subject to RLS'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.plans', 'code', 'insert'),
  'Authenticated users can insert Plan codes subject to RLS'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.plans', 'is_active', 'update'),
  'Authenticated users can soft-deactivate Plans subject to RLS'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.plans', 'delete'),
  'Plans cannot be hard deleted from the browser'
);

select ok(
  has_table_privilege('authenticated', 'valtrim.plan_options', 'select'),
  'Authenticated users can select Options subject to RLS'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.plan_options', 'code', 'insert'),
  'Authenticated users can insert Option codes subject to RLS'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.plan_options', 'is_active', 'update'),
  'Authenticated users can soft-deactivate Options subject to RLS'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.plan_options', 'delete'),
  'Options cannot be hard deleted from the browser'
);

select ok(
  has_table_privilege('authenticated', 'valtrim.plan_prices', 'select'),
  'Authenticated users can select Plan price history subject to RLS'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.plan_prices', 'insert'),
  'Browser clients cannot insert Plan price periods directly'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.plan_prices', 'update'),
  'Browser clients cannot edit Plan price periods directly'
);

select ok(
  has_table_privilege('authenticated', 'valtrim.option_prices', 'select'),
  'Authenticated users can select Option price history subject to RLS'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.option_prices', 'insert'),
  'Browser clients cannot insert Option price periods directly'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.option_prices', 'update'),
  'Browser clients cannot edit Option price periods directly'
);

select ok(
  has_sequence_privilege('authenticated', 'valtrim.plans_id_seq', 'usage'),
  'Authenticated Plan inserts can allocate an identity'
);

select ok(
  has_sequence_privilege('authenticated', 'valtrim.plan_options_id_seq', 'usage'),
  'Authenticated Option inserts can allocate an identity'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.set_plan_price(bigint,numeric,numeric)',
    'execute'
  ),
  'Authenticated users can call the role-checked Plan price RPC'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.set_option_price(bigint,numeric)',
    'execute'
  ),
  'Authenticated users can call the role-checked Option price RPC'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.deactivate_job_plan(bigint)',
    'execute'
  ),
  'Authenticated users can call the role-checked Plan deactivation RPC'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.deactivate_plan_option(bigint)',
    'execute'
  ),
  'Authenticated users can call the role-checked Option deactivation RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'valtrim.set_plan_price(bigint,numeric,numeric)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'valtrim.set_option_price(bigint,numeric)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'valtrim.deactivate_job_plan(bigint)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'valtrim.deactivate_plan_option(bigint)',
    'execute'
  ),
  'Anonymous clients cannot call Plan and Option mutation RPCs'
);

select ok(
  not exists (
    select 1
    from pg_constraint constraint_record
    join pg_class table_record on table_record.oid = constraint_record.conrelid
    join pg_namespace schema_record on schema_record.oid = table_record.relnamespace
    where schema_record.nspname = 'valtrim'
      and table_record.relname = 'plan_options'
      and constraint_record.conname = 'plan_options_plan_id_code_key'
  ),
  'A Plan can contain repeated Option display codes'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'valtrim'
      and table_name = 'plan_prices'
      and column_name = 'hardware_price'
      and is_nullable = 'YES'
  ),
  'Hardware can remain unpriced independently of the base Plan'
);

select is(
  (
    select character_maximum_length::integer
    from information_schema.columns
    where table_schema = 'valtrim'
      and table_name = 'plan_options'
      and column_name = 'name'
  ),
  300,
  'Option billing names support the complete UI description'
);

select is(
  (
    select character_maximum_length::integer
    from information_schema.columns
    where table_schema = 'valtrim'
      and table_name = 'package_options'
      and column_name = 'option_name'
  ),
  300,
  'Future package snapshots preserve the complete Option billing name'
);

select has_index(
  'valtrim',
  'plans',
  'plans_created_by_idx',
  'Plan creator audit foreign key is indexed'
);

select has_index(
  'valtrim',
  'plans',
  'plans_updated_by_idx',
  'Plan updater audit foreign key is indexed'
);

select has_index(
  'valtrim',
  'plan_options',
  'plan_options_created_by_idx',
  'Option creator audit foreign key is indexed'
);

select has_index(
  'valtrim',
  'plan_options',
  'plan_options_updated_by_idx',
  'Option updater audit foreign key is indexed'
);

select has_index(
  'valtrim',
  'plan_prices',
  'plan_prices_created_by_idx',
  'Plan price creator audit foreign key is indexed'
);

select has_index(
  'valtrim',
  'option_prices',
  'option_prices_created_by_idx',
  'Option price creator audit foreign key is indexed'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'valtrim'
      and tablename = 'plans'
  ),
  3::bigint,
  'Plans have select, insert and update RLS policies'
);

select set_eq(
  $$
    select policyname
    from pg_policies
    where schemaname = 'valtrim'
      and tablename = 'plans'
  $$,
  $$ values ('plans_select'), ('plans_insert'), ('plans_update') $$,
  'Plans expose exactly the expected policies'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'valtrim'
      and tablename = 'plan_options'
  ),
  3::bigint,
  'Options have select, insert and update RLS policies'
);

select set_eq(
  $$
    select policyname
    from pg_policies
    where schemaname = 'valtrim'
      and tablename = 'plan_options'
  $$,
  $$ values
    ('plan_options_select'),
    ('plan_options_insert'),
    ('plan_options_update')
  $$,
  'Options expose exactly the expected policies'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'valtrim'
      and tablename = 'plan_prices'
  ),
  1::bigint,
  'Plan prices expose only their read policy'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'valtrim'
      and tablename = 'option_prices'
  ),
  1::bigint,
  'Option prices expose only their read policy'
);

select ok(
  not has_column_privilege('authenticated', 'valtrim.plans', 'created_by', 'insert'),
  'Browser clients cannot provide the Plan creator audit field'
);

select ok(
  not has_column_privilege('authenticated', 'valtrim.plan_options', 'updated_by', 'update'),
  'Browser clients cannot provide the Option updater audit field'
);

select ok(
  not has_table_privilege('anon', 'valtrim.plans', 'select')
  and not has_table_privilege('anon', 'valtrim.plans', 'insert')
  and not has_table_privilege('anon', 'valtrim.plans', 'update')
  and not has_table_privilege('anon', 'valtrim.plans', 'delete'),
  'Anonymous clients have no Plan table privileges'
);

select ok(
  not has_table_privilege('anon', 'valtrim.plan_options', 'select')
  and not has_table_privilege('anon', 'valtrim.plan_options', 'insert')
  and not has_table_privilege('anon', 'valtrim.plan_options', 'update')
  and not has_table_privilege('anon', 'valtrim.plan_options', 'delete'),
  'Anonymous clients have no Option table privileges'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.phases', 'select'),
  'Sequence Sheet Phases remain closed'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.lots', 'select'),
  'Sequence Sheet Lots remain closed'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.draw_packages', 'select'),
  'Draw Packages remain closed'
);

select * from finish();

rollback;
