begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select has_column(
  'valtrim',
  'lots',
  'utility_name',
  'Sequence Sheet rows persist a user-defined Utility name'
);

select col_type_is(
  'valtrim',
  'lots',
  'utility_name',
  'character varying(80)',
  'Utility row names are capped at 80 characters'
);

select ok(
  exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'valtrim.lots'::regclass
      and constraint_record.conname = 'lots_utility_name_check'
      and constraint_record.contype = 'c'
  ),
  'Lot rows enforce the Utility name invariant'
);

select ok(
  has_column_privilege(
    'authenticated',
    'valtrim.lots',
    'utility_name',
    'select'
  ),
  'Authenticated Sequence Sheet reads can load Utility names'
);

select has_column(
  'valtrim',
  'package_draws',
  'utility_name',
  'Draw Package rows snapshot the Utility name'
);

select col_type_is(
  'valtrim',
  'package_draws',
  'utility_name',
  'character varying(80)',
  'Utility snapshot names use the same 80 character limit'
);

select ok(
  exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'valtrim.package_draws'::regclass
      and constraint_record.conname = 'package_draws_utility_name_snapshot_check'
      and constraint_record.contype = 'c'
  ),
  'Draw Package rows enforce the immutable Utility name invariant'
);

select ok(
  has_column_privilege(
    'authenticated',
    'valtrim.package_draws',
    'utility_name',
    'select'
  ),
  'Authenticated Draw Package reads can load Utility snapshot names'
);

select ok(coalesce((
  select procedure.prosrc like '%requested.value ->> ''utility_name''%'
    and procedure.prosrc like '%v_lot.utility_name%'
    and procedure.prosrc like '%utility_name = v_lot.utility_name%'
  from pg_proc procedure
  where procedure.oid =
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure
), false), 'Sequence Sheet persistence validates and saves Utility names atomically');

select ok(coalesce((
  select procedure.prosrc like '%lot.utility_name%'
    and procedure.prosrc like '%new.utility_name := case%'
  from pg_proc procedure
  where procedure.oid = 'valtrim.prepare_package_draw()'::regprocedure
), false), 'Package creation freezes the current Utility name in its snapshot');

select ok(
  not exists (
    select 1
    from valtrim.lots lot
    where lot.is_utility_building
      and nullif(btrim(lot.utility_name), '') is null
  ),
  'Existing Utility rows were backfilled with visible names'
);

select ok(
  not exists (
    select 1
    from valtrim.package_draws line
    where line.is_utility_building
      and nullif(btrim(line.utility_name), '') is null
  ),
  'Existing Utility Draw Package snapshots were backfilled with visible names'
);

select * from finish();

rollback;
