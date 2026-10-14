begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

select has_column(
  'valtrim', 'billing_setup_versions', 'hardware_billing_mode',
  'Builder Setup versions store the Hardware billing mode'
);
select has_column(
  'valtrim', 'billing_setup_versions', 'hardware_ext_percentage',
  'Builder Setup versions store the EXT Hardware allocation'
);
select has_column(
  'valtrim', 'billing_setup_versions', 'hardware_dm_percentage',
  'Builder Setup versions store the DM Hardware allocation'
);
select has_column(
  'valtrim', 'billing_setup_versions', 'hardware_hw_percentage',
  'Builder Setup versions store the HW Hardware allocation'
);
select col_default_is(
  'valtrim', 'billing_setup_versions', 'hardware_billing_mode',
  'FULL',
  'Historic Builder Setup versions remain FULL compatible'
);
select ok(exists(
  select 1
  from information_schema.columns
  where table_schema = 'valtrim'
    and table_name = 'billing_setup_versions'
    and column_name = 'hardware_ext_percentage'
    and domain_schema = 'valtrim'
    and domain_name = 'percentage'
), 'Hardware allocations use the percentage domain');

select has_column(
  'valtrim', 'package_draws', 'hardware_billing_mode',
  'Package lines snapshot the Hardware billing mode'
);
select has_column(
  'valtrim', 'package_draws', 'hardware_event_type',
  'Package lines snapshot the charged Hardware event'
);
select has_column(
  'valtrim', 'package_draws', 'hardware_percentage',
  'Package lines snapshot the charged Hardware percentage'
);
select ok(exists(
  select 1
  from information_schema.columns
  where table_schema = 'valtrim'
    and table_name = 'package_draws'
    and column_name = 'hardware_percentage'
    and domain_schema = 'valtrim'
    and domain_name = 'percentage'
), 'Hardware Package percentages use the percentage domain');

select ok(coalesce((
  select pg_get_constraintdef(constraint_record.oid) ilike '%BY_EVENT%'
    and pg_get_constraintdef(constraint_record.oid) ilike '%hardware_event_type%'
    and pg_get_constraintdef(constraint_record.oid) ilike '%hardware_percentage%'
  from pg_constraint constraint_record
  where constraint_record.conrelid = 'valtrim.package_draws'::regclass
    and constraint_record.conname = 'package_draws_hardware_snapshot_check'
), false), 'Hardware Package snapshots enforce FULL and BY_EVENT invariants');

select ok(coalesce((
  select procedure.prosrc like '%hardwareBillingMode%'
    and procedure.prosrc like '%hardwareExtPercentage%'
    and procedure.prosrc like '%hardwareDmPercentage%'
    and procedure.prosrc like '%hardwareHwPercentage%'
  from pg_proc procedure
  where procedure.oid =
    'valtrim.save_billing_setup_version(bigint,jsonb,jsonb,jsonb,bigint,uuid)'::regprocedure
), false), 'Builder Setup persistence saves Hardware event allocations');

select ok(coalesce((
  select procedure.prosrc like '%Hardware event percentages must total 100%'
    and procedure.prosrc like '%New Separate Hardware setups must allocate 100 percent by Draw event%'
    and procedure.prosrc not like '%Every Hardware allocation needs a matching Draw event%'
  from pg_proc procedure
  where procedure.oid = 'valtrim.validate_setup_version(bigint)'::regprocedure
), false), 'Builder Setup validation requires 100 percent without requiring matching Draws');

select ok(coalesce((
  select procedure.prosrc like '%This Hardware event portion was already billed%'
    and procedure.prosrc like '%new.hardware_event_type := v_record.event_type%'
    and procedure.prosrc like '%new.hardware_amount := new.hardware_price - v_prior_amount%'
  from pg_proc procedure
  where procedure.oid = 'valtrim.prepare_package_draw()'::regprocedure
), false), 'Package creation charges each Hardware event portion once');

select ok(coalesce((
  select procedure.prosrc like '%count(distinct line.hardware_event_type)%'
    and procedure.prosrc like '%v_hardware_mode = ''BY_EVENT''%'
    and procedure.prosrc like '%line.hardware_percentage > 0%'
  from pg_proc procedure
  where procedure.oid =
    'private.create_retention_release_package(bigint,bigint,text)'::regprocedure
), false), 'Retention waits for all configured Hardware event portions');

select * from finish();

rollback;
