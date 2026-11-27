begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

select has_column(
  'valtrim', 'billing_setup_versions', 'utility_billing_mode',
  'Builder Setup versions store the Utility billing mode'
);
select has_column(
  'valtrim', 'billing_setup_versions', 'utility_ext_percentage',
  'Builder Setup versions store the EXT Utility allocation'
);
select has_column(
  'valtrim', 'billing_setup_versions', 'utility_dm_percentage',
  'Builder Setup versions store the DM Utility allocation'
);
select has_column(
  'valtrim', 'billing_setup_versions', 'utility_hw_percentage',
  'Builder Setup versions store the HW Utility allocation'
);

select ok(exists(
  select 1
  from information_schema.columns
  where table_schema = 'valtrim'
    and table_name = 'billing_setup_versions'
    and column_name = 'utility_ext_percentage'
    and domain_schema = 'valtrim'
    and domain_name = 'percentage'
    and numeric_precision = 5
    and numeric_scale = 2
), 'Utility event allocations use the percentage domain');
select col_default_is(
  'valtrim', 'billing_setup_versions', 'utility_billing_mode',
  'FULL',
  'Existing and new Builder Setup versions default Utility to FULL'
);

select has_column(
  'valtrim', 'package_draws', 'utility_billing_mode',
  'Package lines snapshot the Utility billing mode'
);
select has_column(
  'valtrim', 'package_draws', 'utility_event_type',
  'Package lines snapshot the charged Utility event'
);
select has_column(
  'valtrim', 'package_draws', 'utility_percentage',
  'Package lines snapshot the charged Utility percentage'
);
select ok(exists(
  select 1
  from information_schema.columns
  where table_schema = 'valtrim'
    and table_name = 'package_draws'
    and column_name = 'utility_percentage'
    and domain_schema = 'valtrim'
    and domain_name = 'percentage'
    and numeric_precision = 5
    and numeric_scale = 2
), 'Utility Package percentages use the percentage domain');

select ok(coalesce((
  select pg_get_constraintdef(constraint_record.oid) ilike '%BY_EVENT%'
    and pg_get_constraintdef(constraint_record.oid) ilike '%utility_event_type%'
    and pg_get_constraintdef(constraint_record.oid) ilike '%utility_percentage%'
  from pg_constraint constraint_record
  where constraint_record.conrelid = 'valtrim.package_draws'::regclass
    and constraint_record.conname = 'package_draws_utility_snapshot_check'
), false), 'Utility Package snapshots enforce FULL and BY_EVENT invariants');

select ok(coalesce((
  select procedure.prosrc like '%utilityBillingMode%'
    and procedure.prosrc like '%utilityExtPercentage%'
    and procedure.prosrc like '%utilityDmPercentage%'
    and procedure.prosrc like '%utilityHwPercentage%'
  from pg_proc procedure
  where procedure.oid =
    'valtrim.save_billing_setup_version(bigint,jsonb,jsonb,jsonb,bigint,uuid)'::regprocedure
), false), 'Builder Setup persistence saves the Utility mode and event allocations');

select ok(coalesce((
  select procedure.prosrc like '%Utility event percentages must total 100%'
    and procedure.prosrc like '%Every Utility allocation needs a matching Draw event%'
  from pg_proc procedure
  where procedure.oid = 'valtrim.validate_setup_version(bigint)'::regprocedure
), false), 'Builder Setup validation requires a complete supported Utility allocation');

select ok(coalesce((
  select procedure.prosrc like '%utility_billing_mode = ''FULL''%'
    and procedure.prosrc like '%utility_event_type = v_record.event_type%'
    and procedure.prosrc like '%Utility Building event portion was already billed%'
    and procedure.prosrc like '%new.utility_amount := new.base_price - v_prior_amount%'
  from pg_proc procedure
  where procedure.oid = 'valtrim.prepare_package_draw()'::regprocedure
), false), 'Package creation charges Utility once in full or once per configured event');

select * from finish();

rollback;
