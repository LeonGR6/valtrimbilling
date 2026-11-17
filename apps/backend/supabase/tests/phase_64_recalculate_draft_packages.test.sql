begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

select has_table('valtrim', 'phase_price_recalculation_packages',
  'Each Package recalculated by a Phase price update is recorded');

select ok(
  (select relrowsecurity from pg_class
   where oid = 'valtrim.phase_price_recalculation_packages'::regclass)
  and has_any_column_privilege('authenticated', 'valtrim.phase_price_recalculation_packages', 'select')
  and not has_table_privilege('authenticated', 'valtrim.phase_price_recalculation_packages', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.phase_price_recalculation_packages', 'update')
  and not has_table_privilege('authenticated', 'valtrim.phase_price_recalculation_packages', 'delete')
  and not has_table_privilege('anon', 'valtrim.phase_price_recalculation_packages', 'select'),
  'Recalculated Package records are readable but never written from the browser'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.draw_package_corrections'::regclass
      and conname = 'draw_package_corrections_action_check'
      and pg_get_constraintdef(oid) like '%RECALCULATE%'
  ),
  'A price recalculation is recorded in the Package correction history'
);

select ok(
  not has_function_privilege('authenticated', 'private.recalculate_draft_package(bigint,text,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'private.draw_package_can_be_recalculated(bigint)', 'execute')
  and not has_function_privilege('authenticated', 'private.lot_billing_packages(bigint)', 'execute')
  and not has_function_privilege('authenticated', 'private.lot_option_billing_packages(bigint,bigint)', 'execute'),
  'The recalculation helpers cannot be called from the browser'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.apply_phase_price_changes(bigint,bigint[],jsonb,text,boolean)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'valtrim.apply_phase_price_changes(bigint,bigint[],jsonb,text,boolean)',
    'execute'
  ),
  'Only signed-in users can call the Phase price update'
);

select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'valtrim' and p.proname = 'apply_phase_price_changes'),
  1,
  'The old four-argument Phase price update is gone'
);

select ok(
  (select prosecdef from pg_proc
   where oid = 'private.recalculate_draft_package(bigint,text,boolean)'::regprocedure),
  'A Package is recalculated inside the same privileged transaction as the price update'
);

select ok(
  pg_get_functiondef('private.draw_package_can_be_recalculated(bigint)'::regprocedure)
    like '%quickbooks_status = ''NOT_CREATED''%'
  and pg_get_functiondef('private.draw_package_can_be_recalculated(bigint)'::regprocedure)
    like '%invoice.invoice_number is null%'
  and pg_get_functiondef('private.draw_package_can_be_recalculated(bigint)'::regprocedure)
    like '%invoice.paid_amount = 0%'
  and pg_get_functiondef('private.draw_package_can_be_recalculated(bigint)'::regprocedure)
    like '%retention_release_lines%',
  'Only an unissued, unsynced, unpaid Draft Package without a Retention Release can be recalculated'
);

select ok(
  pg_get_functiondef('private.draw_package_can_be_recalculated(bigint)'::regprocedure)
    like '%document.document_type in (''RELEASE'', ''PAYMENT_SCHEDULE'')%',
  'A generated Release or Payment Schedule does not stop it, any other document does'
);

select ok(
  pg_get_functiondef('private.recalculate_draft_package(bigint,text,boolean)'::regprocedure)
    like '%raise exception ''This Package has a generated Release or Payment Schedule%'
  and pg_get_functiondef('private.recalculate_draft_package(bigint,text,boolean)'::regprocedure)
    like '%errcode = ''P0003''%',
  'Removing a Release or Payment Schedule needs the caller to say so'
);

select ok(
  pg_get_functiondef('private.recalculate_draft_package(bigint,text,boolean)'::regprocedure)
    like '%private.delete_package_release%'
  and pg_get_functiondef('private.recalculate_draft_package(bigint,text,boolean)'::regprocedure)
    like '%private.delete_package_payment_schedule%',
  'The documents are removed in the same transaction as the recalculation'
);

select ok(
  pg_get_functiondef('private.recalculate_draft_package(bigint,text,boolean)'::regprocedure)
    like '%valtrim.draw_package_option_charge%'
  and pg_get_functiondef('private.recalculate_draft_package(bigint,text,boolean)'::regprocedure)
    like '%valtrim.draw_package_hardware_charge%',
  'Each cell goes back with the Option and Hardware selection it was created with'
);

select ok(
  pg_get_functiondef('private.recalculate_draft_package(bigint,text,boolean)'::regprocedure)
    like '%new Plan price has no hardware price%',
  'A Package that bills hardware cannot move to a price without a hardware price'
);

select ok(
  pg_get_functiondef('valtrim.apply_phase_price_changes(bigint,bigint[],jsonb,text,boolean)'::regprocedure)
    like '%private.recalculate_draft_package%'
  and pg_get_functiondef('valtrim.apply_phase_price_changes(bigint,bigint[],jsonb,text,boolean)'::regprocedure)
    like '%phase_price_recalculation_packages%',
  'Updating a Phase price recalculates and records the Draft Packages that bill it'
);

select ok(
  pg_get_functiondef('valtrim.preview_phase_price_changes(bigint,bigint,bigint,text)'::regprocedure)
    like '%private.lot_billing_packages%'
  and pg_get_functiondef('valtrim.preview_phase_price_changes(bigint,bigint,bigint,text)'::regprocedure)
    like '%private.lot_option_billing_packages%'
  and pg_get_functiondef('valtrim.preview_phase_price_changes(bigint,bigint,bigint,text)'::regprocedure)
    like '%''locked''%',
  'The preview says which Packages bill each price and whether they can change'
);

select ok(
  not exists (
    select 1
    from valtrim.phase_price_recalculation_packages recalculated
    join valtrim.draw_packages package on package.id = recalculated.package_id
    where package.package_type <> 'DRAW'
  ),
  'Only Draw Packages are ever recalculated'
);

select * from finish();

rollback;
