begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select has_table('valtrim', 'phase_price_recalculations',
  'Each Phase price update is recorded');
select has_table('valtrim', 'phase_price_recalculation_lines',
  'Each Lot and Option moved by an update is recorded');

select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.phase_price_recalculations'::regclass)
  and (select relrowsecurity from pg_class where oid = 'valtrim.phase_price_recalculation_lines'::regclass),
  'Phase price update records have RLS enabled'
);

select ok(
  has_table_privilege('authenticated', 'valtrim.phase_price_recalculations', 'select')
  and has_table_privilege('authenticated', 'valtrim.phase_price_recalculation_lines', 'select'),
  'Authenticated users can read Phase price update records subject to RLS'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.phase_price_recalculations', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.phase_price_recalculations', 'update')
  and not has_table_privilege('authenticated', 'valtrim.phase_price_recalculations', 'delete')
  and not has_table_privilege('authenticated', 'valtrim.phase_price_recalculation_lines', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.phase_price_recalculation_lines', 'update')
  and not has_table_privilege('authenticated', 'valtrim.phase_price_recalculation_lines', 'delete'),
  'Browser clients cannot write Phase price update records directly'
);

select ok(
  not has_table_privilege('anon', 'valtrim.phase_price_recalculations', 'select')
  and not has_table_privilege('anon', 'valtrim.phase_price_recalculation_lines', 'select'),
  'Anonymous clients cannot read Phase price update records'
);

select col_not_null('valtrim', 'phase_price_recalculations', 'reason',
  'An update always records its reason');
select col_not_null('valtrim', 'phase_price_recalculations', 'created_by',
  'An update always records who made it');

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.phase_price_recalculations'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%btrim(%reason%'
  ),
  'A blank reason is rejected'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.phase_price_recalculation_lines'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%option_id IS NULL%new_plan_price_id IS NOT NULL%'
  ),
  'A record line moves either a Plan price or an Option price, never both'
);

select has_index('valtrim', 'phase_price_recalculation_lines',
  'phase_price_recalculation_lines_recalculation_idx',
  'Record lines are indexed by update');

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.preview_phase_price_changes(bigint,bigint,bigint,text)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'valtrim.apply_phase_price_changes(bigint,bigint[],jsonb,text)',
    'execute'
  ),
  'Authenticated users can call the role-checked Phase price RPCs'
);

select ok(
  not has_function_privilege(
    'anon',
    'valtrim.preview_phase_price_changes(bigint,bigint,bigint,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'valtrim.apply_phase_price_changes(bigint,bigint[],jsonb,text)',
    'execute'
  ),
  'Anonymous clients cannot call the Phase price RPCs'
);

select ok(
  (
    select prosecdef from pg_proc
    where oid = 'valtrim.apply_phase_price_changes(bigint,bigint[],jsonb,text)'::regprocedure
  )
  and (
    select prosecdef from pg_proc
    where oid = 'valtrim.preview_phase_price_changes(bigint,bigint,bigint,text)'::regprocedure
  ),
  'Phase price RPCs use their explicit authorization boundary'
);

select ok(
  pg_get_functiondef('valtrim.apply_phase_price_changes(bigint,bigint[],jsonb,text)'::regprocedure)
    like '%has_app_role(''ADMIN'', ''PROJECT_MANAGEMENT'')%'
  and pg_get_functiondef('valtrim.preview_phase_price_changes(bigint,bigint,bigint,text)'::regprocedure)
    like '%has_app_role(''ADMIN'', ''PROJECT_MANAGEMENT'')%',
  'Only administrators and project management can see or apply Phase price updates'
);

select ok(
  pg_get_functiondef('valtrim.apply_phase_price_changes(bigint,bigint[],jsonb,text)'::regprocedure)
    like '%not exists (select 1 from valtrim.package_draws line where line.lot_id = lot.id)%'
  and pg_get_functiondef('valtrim.apply_phase_price_changes(bigint,bigint[],jsonb,text)'::regprocedure)
    like '%from valtrim.package_options billed%',
  'A Lot or Option already billed in a Package is never moved'
);

select ok(
  pg_get_functiondef('valtrim.apply_phase_price_changes(bigint,bigint[],jsonb,text)'::regprocedure)
    like '%for update%'
  and pg_get_functiondef('valtrim.apply_phase_price_changes(bigint,bigint[],jsonb,text)'::regprocedure)
    like '%Prices or Packages changed since this list was loaded%',
  'An update locks the Job and changes nothing when the list is out of date'
);

select ok(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'valtrim' and p.proname = 'apply_phase_price_changes') = 1,
  'There is a single Phase price update entry point'
);

select * from finish();

rollback;
