begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

select has_table('valtrim', 'package_price_differences',
  'Pending price differences of issued Packages are recorded');

select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.package_price_differences'::regclass)
  and has_any_column_privilege('authenticated', 'valtrim.package_price_differences', 'select')
  and not has_table_privilege('authenticated', 'valtrim.package_price_differences', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.package_price_differences', 'update')
  and not has_table_privilege('authenticated', 'valtrim.package_price_differences', 'delete')
  and not has_table_privilege('anon', 'valtrim.package_price_differences', 'select'),
  'Differences are readable but never written from the browser'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'valtrim'
      and tablename = 'package_price_differences'
      and cmd = 'SELECT'
      and qual like '%has_app_role%ADMIN%PROJECT_MANAGEMENT%'
  ),
  'Only administrators and project management can read the differences'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.package_price_differences'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%PENDING%COLLECTED%DISMISSED%'
  ),
  'A difference is pending, collected or dismissed'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'valtrim'
      and tablename = 'package_price_differences'
      and indexname = 'package_price_differences_pending_cell_uq'
      and indexdef like '%UNIQUE%'
      and indexdef like '%PENDING%'
  ),
  'A Package cell has at most one pending difference: a new calculation replaces it'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.package_price_differences'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%HARDWARE_EVENT%'
      and pg_get_constraintdef(oid) like '%DRAW%'
  ),
  'A line is a Draw or a Hardware event, never both'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'valtrim.draw_packages'::regclass
      and tgname = 'draw_packages_dismiss_price_differences'
      and not tgisinternal
  ),
  'Cancelling a Package dismisses what it was pending'
);

select ok(
  not has_function_privilege('authenticated', 'private.record_package_price_differences(bigint,bigint[])', 'execute')
  and not has_function_privilege('authenticated', 'private.package_line_new_amounts(valtrim.package_draws)', 'execute')
  and not has_function_privilege('authenticated', 'private.package_hardware_line_new_amounts(valtrim.package_hardware_lines)', 'execute')
  and not has_function_privilege('authenticated', 'private.event_allocation(numeric,text,numeric,numeric,numeric)', 'execute')
  and not has_function_privilege('authenticated', 'private.draw_allocation(numeric,bigint,smallint,numeric)', 'execute'),
  'The difference calculation cannot be called from the browser'
);

-- The arithmetic of the Package calculation, on small known numbers.
select is(
  private.event_allocation(1000, 'EXT', 40, 30, 30),
  400.00::numeric,
  'The first event takes its percentage'
);
select is(
  private.event_allocation(1000, 'HW', 40, 30, 30),
  300.00::numeric,
  'The last event takes what is left'
);
select is(
  private.event_allocation(100.01, 'HW', 33.33, 33.33, 33.34),
  100.01::numeric - round(100.01 * 33.33 / 100, 2) - round(100.01 * 33.33 / 100, 2),
  'The last event absorbs the rounding so the events add up to the total'
);
select is(
  private.event_allocation(1000, 'EXT', 60, 40, 0),
  600.00::numeric,
  'An event with no later share is not the last one'
);
select is(
  private.event_allocation(1000, 'DM', 60, 40, 0),
  400.00::numeric,
  'The last event with a share takes what the earlier ones left'
);
select is(
  private.event_allocation(1000, 'HW', 60, 40, 0),
  0::numeric,
  'An event with no share bills nothing'
);

select ok(
  pg_get_functiondef('private.package_line_new_amounts(valtrim.package_draws)'::regprocedure)
    like '%phase_price_recalculation_lines%'
  and pg_get_functiondef('private.package_hardware_line_new_amounts(valtrim.package_hardware_lines)'::regprocedure)
    like '%phase_price_recalculation_lines%',
  'Only Lots and Options an administrator moved on purpose owe a difference'
);

select ok(
  pg_get_functiondef('private.record_package_price_differences(bigint,bigint[])'::regprocedure)
    like '%delete from valtrim.package_price_differences%'
  and pg_get_functiondef('private.record_package_price_differences(bigint,bigint[])'::regprocedure)
    like '%status = ''PENDING''%',
  'A new calculation replaces what was pending instead of adding to it'
);

select ok(
  pg_get_functiondef('valtrim.apply_phase_price_changes(bigint,bigint[],jsonb,text,boolean)'::regprocedure)
    like '%private.record_package_price_differences%'
  and pg_get_functiondef('valtrim.apply_phase_price_changes(bigint,bigint[],jsonb,text,boolean)'::regprocedure)
    like '%package_id = any (v_draft_ids)%',
  'Differences are recorded for issued Packages and cleared for Draft ones'
);

select ok(
  pg_get_functiondef('private.lot_billing_packages(bigint)'::regprocedure) like '%workflow_status%'
  and pg_get_functiondef('private.lot_option_billing_packages(bigint,bigint)'::regprocedure) like '%workflow_status%',
  'The preview says in which state each Package that bills a price is'
);

select is(
  (select count(*)::integer from valtrim.package_price_differences difference
   join valtrim.draw_packages package on package.id = difference.package_id
   where difference.status = 'PENDING' and package.status = 'VOIDED'),
  0,
  'No cancelled Package is pending anything'
);

select is(
  (select count(*)::integer from valtrim.package_price_differences
   where delta_gross - delta_retention - delta_wrap <> delta_net),
  0,
  'Every difference adds up: gross minus Retention and WRAP is the net'
);

select * from finish();

rollback;
