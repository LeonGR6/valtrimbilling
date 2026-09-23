begin;

create extension if not exists pgtap with schema extensions;

select plan(36);

select has_table('valtrim', 'phases', 'Sequence Sheet Phases table is available');
select has_table('valtrim', 'lots', 'Sequence Sheet Lots table is available');
select has_table('valtrim', 'lot_options', 'Selected Lot Options table is available');

select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.phases'::regclass),
  'Phases have RLS enabled'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.lots'::regclass),
  'Lots have RLS enabled'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.lot_options'::regclass),
  'Selected Lot Options have RLS enabled'
);

select ok(
  has_table_privilege('authenticated', 'valtrim.phases', 'select'),
  'Authenticated users can select Phases subject to RLS'
);

select ok(
  has_table_privilege('authenticated', 'valtrim.lots', 'select'),
  'Authenticated users can select Lots subject to RLS'
);

select ok(
  has_table_privilege('authenticated', 'valtrim.lot_options', 'select'),
  'Authenticated users can select selected Lot Options subject to RLS'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.phases', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.phases', 'update')
  and not has_table_privilege('authenticated', 'valtrim.phases', 'delete'),
  'Browser clients cannot mutate Phases directly'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.lots', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.lots', 'update')
  and not has_table_privilege('authenticated', 'valtrim.lots', 'delete'),
  'Browser clients cannot mutate Lots directly'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.lot_options', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.lot_options', 'update')
  and not has_table_privilege('authenticated', 'valtrim.lot_options', 'delete'),
  'Browser clients cannot mutate selected Lot Options directly'
);

select ok(
  not has_sequence_privilege('authenticated', 'valtrim.phases_id_seq', 'usage'),
  'Browser clients cannot allocate Phase identities directly'
);

select ok(
  not has_sequence_privilege('authenticated', 'valtrim.lots_id_seq', 'usage'),
  'Browser clients cannot allocate Lot identities directly'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb)',
    'execute'
  ),
  'Authenticated users can call the role-checked atomic save RPC'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.deactivate_sequence_sheet_phase(bigint)',
    'execute'
  ),
  'Authenticated users can call the role-checked Phase deactivation RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'valtrim.deactivate_sequence_sheet_phase(bigint)',
    'execute'
  ),
  'Anonymous clients cannot call Sequence Sheet mutation RPCs'
);

select set_eq(
  $$
    select policyname
    from pg_policies
    where schemaname = 'valtrim'
      and tablename = 'phases'
  $$,
  $$ values ('phases_select') $$,
  'Phases expose only the active-user read policy'
);

select set_eq(
  $$
    select policyname
    from pg_policies
    where schemaname = 'valtrim'
      and tablename = 'lots'
  $$,
  $$ values ('lots_select') $$,
  'Lots expose only the active-user read policy'
);

select set_eq(
  $$
    select policyname
    from pg_policies
    where schemaname = 'valtrim'
      and tablename = 'lot_options'
  $$,
  $$ values ('lot_options_select') $$,
  'Selected Lot Options expose only the active-user read policy'
);

select is(
  (
    select character_maximum_length::integer
    from information_schema.columns
    where table_schema = 'valtrim'
      and table_name = 'phases'
      and column_name = 'code'
  ),
  40,
  'Phase codes support the existing form limit'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.phases'::regclass
      and conname = 'phases_code_check'
      and contype = 'c'
  ),
  'Phase codes are normalized'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.phases'::regclass
      and conname = 'phases_building_check'
      and contype = 'c'
  ),
  'Building codes are normalized'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.lots'::regclass
      and conname = 'lots_lot_number_check'
      and contype = 'c'
  ),
  'Lot numbers are normalized'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.lots'::regclass
      and conname = 'lots_display_order_check'
      and contype = 'c'
  ),
  'Lot display order is bounded'
);

select has_index('valtrim', 'phases', 'phases_created_by_idx', 'Phase creator audit FK is indexed');
select has_index('valtrim', 'phases', 'phases_updated_by_idx', 'Phase updater audit FK is indexed');
select has_index('valtrim', 'lots', 'lots_created_by_idx', 'Lot creator audit FK is indexed');
select has_index('valtrim', 'lots', 'lots_updated_by_idx', 'Lot updater audit FK is indexed');
select has_index('valtrim', 'lot_options', 'lot_options_selected_by_idx', 'Lot Option selector audit FK is indexed');

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'valtrim.lot_options'::regclass
      and tgname = 'stamp_lot_option_selector'
      and not tgisinternal
  ),
  'Selected Lot Options stamp the authenticated selector'
);

select ok(
  (
    select prosecdef
    from pg_proc
    where oid = 'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb)'::regprocedure
  )
  and (
    select prosecdef
    from pg_proc
    where oid = 'valtrim.deactivate_sequence_sheet_phase(bigint)'::regprocedure
  ),
  'Sequence Sheet mutation RPCs use their explicit authorization boundary'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.production_activities', 'select'),
  'Production remains closed'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.draw_packages', 'select'),
  'Draw Packages remain closed'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.invoices', 'select'),
  'Invoices and QuickBooks inputs remain closed'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.service_requests', 'select'),
  'Customer Service remains closed'
);

select * from finish();

rollback;
