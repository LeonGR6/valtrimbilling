begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

select has_column(
  'valtrim',
  'phases',
  'is_utility_building',
  'Phases identify Utility Building rows explicitly'
);

select col_type_is(
  'valtrim',
  'phases',
  'is_utility_building',
  'boolean',
  'The Utility Building Phase flag is boolean'
);

select col_not_null(
  'valtrim',
  'phases',
  'is_utility_building',
  'Every Phase has an explicit Utility Building state'
);

select col_default_is(
  'valtrim',
  'phases',
  'is_utility_building',
  'false',
  'Existing and ordinary Phases default to Lot behavior'
);

select has_column(
  'valtrim',
  'package_draws',
  'is_utility_building',
  'Package Draws snapshot Utility Building identity'
);

select has_column(
  'valtrim',
  'package_draws',
  'utility_amount',
  'Package Draws snapshot the Utility Building amount'
);

select ok(
  exists (
    select 1
    from information_schema.columns column_record
    where column_record.table_schema = 'valtrim'
      and column_record.table_name = 'package_draws'
      and column_record.column_name = 'utility_amount'
      and column_record.domain_schema = 'valtrim'
      and column_record.domain_name = 'amount'
      and column_record.numeric_precision = 14
      and column_record.numeric_scale = 2
  ),
  'Utility Building amounts use the billing amount domain'
);

select ok(coalesce((
  select pg_get_constraintdef(constraint_record.oid) ilike '%gross_amount%'
    and pg_get_constraintdef(constraint_record.oid) ilike '%base_draw_amount%'
    and pg_get_constraintdef(constraint_record.oid) ilike '%hardware_amount%'
    and pg_get_constraintdef(constraint_record.oid) ilike '%options_amount%'
    and pg_get_constraintdef(constraint_record.oid) ilike '%utility_amount%'
  from pg_constraint constraint_record
  where constraint_record.conrelid = 'valtrim.package_draws'::regclass
    and constraint_record.conname = 'package_draws_gross_snapshot_check'
), false), 'Package gross amounts include the Utility Building snapshot');

select ok(coalesce((
  select pg_get_constraintdef(constraint_record.oid) ilike '%is_utility_building%'
    and pg_get_constraintdef(constraint_record.oid) ilike '%utility_amount%'
    and pg_get_constraintdef(constraint_record.oid) ilike '%base_price%'
    and pg_get_constraintdef(constraint_record.oid) ilike '%base_draw_amount%'
    and pg_get_constraintdef(constraint_record.oid) ilike '%hardware_amount%'
    and pg_get_constraintdef(constraint_record.oid) ilike '%options_amount%'
  from pg_constraint constraint_record
  where constraint_record.conrelid = 'valtrim.package_draws'::regclass
    and constraint_record.conname = 'package_draws_utility_snapshot_check'
), false), 'Utility snapshots contain only one complete Plan Price');

select has_function(
  'valtrim',
  'save_sequence_sheet_phase',
  array['bigint', 'bigint', 'text', 'text', 'jsonb', 'boolean'],
  'Sequence Sheet saves accept the Utility Building Phase flag'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)',
    'execute'
  ),
  'The new Sequence Sheet RPC preserves the authenticated authorization boundary'
);

select ok(coalesce((
  select procedure.prosrc like '%version.utility_building%'
    and procedure.prosrc like '%Utility Building rows cannot include Reverse or Options%'
    and procedure.prosrc like '%An existing row cannot change between Lot and Utility Building%'
    and procedure.prosrc like '%UTILITY-%'
  from pg_proc procedure
  where procedure.oid =
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure
), false), 'Sequence Sheet persistence enforces Utility capability and Plan-only rows');

select ok(coalesce((
  select procedure.prosrc like '%phase.is_utility_building%'
    and procedure.prosrc like '%valtrim.save_sequence_sheet_phase%'
  from pg_proc procedure
  where procedure.oid =
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb)'::regprocedure
), false), 'The legacy Sequence Sheet RPC remains available during the row-level transition');

select ok(coalesce((
  select procedure.prosrc like '%pg_advisory_xact_lock(new.lot_id)%'
    and procedure.prosrc like '%new.base_draw_amount := 0%'
    and procedure.prosrc like '%new.utility_amount := new.base_price%'
    and procedure.prosrc like '%Utility Building rows cannot charge Options%'
    and procedure.prosrc like '%Utility Building rows cannot charge Hardware%'
  from pg_proc procedure
  where procedure.oid = 'valtrim.prepare_package_draw()'::regprocedure
), false), 'Package creation charges each Utility row once at full Plan Price without extras');

select * from finish();

rollback;
