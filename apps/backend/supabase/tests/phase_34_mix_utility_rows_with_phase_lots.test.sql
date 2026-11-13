begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select has_column(
  'valtrim',
  'lots',
  'is_utility_building',
  'Utility Building identity belongs to each Phase row'
);

select col_type_is(
  'valtrim',
  'lots',
  'is_utility_building',
  'boolean',
  'The row-level Utility Building flag is boolean'
);

select col_not_null(
  'valtrim',
  'lots',
  'is_utility_building',
  'Every Phase row has an explicit billing type'
);

select col_default_is(
  'valtrim',
  'lots',
  'is_utility_building',
  'false',
  'Existing and ordinary rows default to Lot behavior'
);

select ok(
  has_column_privilege(
    'authenticated',
    'valtrim.lots',
    'is_utility_building',
    'select'
  ),
  'Authenticated reads can load the row billing type'
);

select ok(coalesce((
  select procedure.prosrc like '%requested.value ->> ''is_utility_building''%'
    and procedure.prosrc like '%v_has_utility%'
    and procedure.prosrc like '%An existing row cannot change between Lot and Utility Building%'
    and procedure.prosrc like '%is_utility_building, display_order%'
  from pg_proc procedure
  where procedure.oid =
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure
), false), 'Sequence Sheet persistence accepts mixed row types atomically');

select ok(coalesce((
  select procedure.prosrc like '%lot.is_utility_building%'
    and procedure.prosrc not like '%phase.is_utility_building,%'
    and procedure.prosrc like '%new.utility_amount := new.base_price%'
  from pg_proc procedure
  where procedure.oid = 'valtrim.prepare_package_draw()'::regprocedure
), false), 'Package creation calculates Utility from each selected row');

select ok(
  exists (
    select 1
    from pg_trigger trigger_record
    where trigger_record.tgrelid = 'valtrim.production_activity_lots'::regclass
      and trigger_record.tgname = 'production_activity_lots_reject_utility_row'
      and not trigger_record.tgisinternal
  ),
  'Production rejects Utility Building rows at the database boundary'
);

select ok(coalesce((
  select procedure.prosrc like '%lot.is_utility_building%'
    and procedure.prosrc like '%do not belong to Production or Calendar Lot ranges%'
  from pg_proc procedure
  where procedure.oid = 'valtrim.reject_utility_production_lot()'::regprocedure
), false), 'The Production guard checks the selected row type');

select ok(
  not exists (
    select 1
    from pg_trigger trigger_record
    where trigger_record.tgrelid = 'valtrim.production_activities'::regclass
      and trigger_record.tgname = 'production_activities_reject_utility_phase'
      and not trigger_record.tgisinternal
  ),
  'Production no longer rejects an entire mixed Phase'
);

select ok(
  not exists (
    select 1 from valtrim.phases phase where phase.is_utility_building
  ),
  'Legacy Phase-level Utility flags are retired after backfill'
);

select ok(
  not exists (
    select 1
    from valtrim.lots lot
    join valtrim.lot_options selected on selected.lot_id = lot.id
    where lot.is_utility_building
  ),
  'Utility Building rows cannot retain selected Options after migration'
);

select * from finish();

rollback;
