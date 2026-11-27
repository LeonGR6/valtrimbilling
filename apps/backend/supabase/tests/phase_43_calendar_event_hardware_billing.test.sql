begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

select has_table(
  'valtrim', 'package_hardware_lines',
  'Calendar-triggered Separate Hardware has its own immutable Package table'
);
select has_column(
  'valtrim', 'package_hardware_lines', 'id',
  'Separate Hardware lines have a stable identity'
);
select has_column(
  'valtrim', 'package_hardware_lines', 'hardware_event_type',
  'Separate Hardware snapshots the Calendar event'
);
select has_column(
  'valtrim', 'package_hardware_lines', 'hardware_percentage',
  'Separate Hardware snapshots its configured percentage'
);
select has_column(
  'valtrim', 'package_hardware_lines', 'hardware_amount',
  'Separate Hardware snapshots its calculated amount'
);
select ok(coalesce((
  select class.relrowsecurity
  from pg_class class
  where class.oid = 'valtrim.package_hardware_lines'::regclass
), false), 'Separate Hardware lines enable RLS');
select ok(exists(
  select 1 from pg_policies
  where schemaname = 'valtrim'
    and tablename = 'package_hardware_lines'
    and policyname = 'package_hardware_lines_select'
), 'Active authenticated users can read Separate Hardware snapshots');

select has_table(
  'valtrim', 'retention_release_hardware_lines',
  'Retention Releases allocate independent Separate Hardware retention'
);
select has_column(
  'valtrim', 'retention_release_hardware_lines', 'source_hardware_line_id',
  'Retention keeps the exact source Hardware line identity'
);
select ok(exists(
  select 1 from pg_policies
  where schemaname = 'valtrim'
    and tablename = 'retention_release_hardware_lines'
    and policyname = 'retention_release_hardware_lines_select'
), 'Active authenticated users can read Hardware retention allocations');

select ok(coalesce((
  select procedure.prosrc like '%Hardware event percentages must total 100%'
    and procedure.prosrc not like '%Every Hardware allocation needs a matching Draw event%'
  from pg_proc procedure
  where procedure.oid = 'valtrim.validate_setup_version(bigint)'::regprocedure
), false), 'Separate Hardware allocation no longer depends on Billing Draw events');

select ok(to_regprocedure(
  'valtrim.create_draw_invoice_package_with_hardware_events(bigint,jsonb,jsonb,date,text)'
) is not null, 'Package RPC accepts independent Hardware event selections');

select ok(coalesce((
  select procedure.prosrc like '%This Calendar event has no Separate Hardware allocation%'
    and procedure.prosrc like '%already billed in another Package%'
    and procedure.prosrc like '%new.hardware_price - v_prior_amount%'
  from pg_proc procedure
  where procedure.oid = 'valtrim.prepare_package_hardware_line()'::regprocedure
), false), 'Hardware lines validate allocation, uniqueness and rounding server-side');

select ok(coalesce((
  select procedure.prosrc like '%valtrim.package_hardware_lines%'
    and procedure.prosrc like '%union all%'
  from pg_proc procedure
  where procedure.oid = 'valtrim.recalculate_invoice_totals()'::regprocedure
), false), 'Invoice totals include independent Separate Hardware lines');

select ok(coalesce((
  select procedure.prosrc like '%valtrim.retention_release_hardware_lines%'
    and procedure.prosrc like '%valtrim.package_hardware_lines%'
    and procedure.prosrc like '%v_inserted_hardware%'
  from pg_proc procedure
  where procedure.oid =
    'private.create_retention_release_package(bigint,bigint,text)'::regprocedure
), false), 'Retention completion and release include Separate Hardware lines');

select ok(
  has_table_privilege('authenticated', 'valtrim.package_hardware_lines', 'SELECT')
  and has_table_privilege(
    'authenticated',
    'valtrim.retention_release_hardware_lines',
    'SELECT'
  ),
  'Authenticated users receive read-only access to both new snapshots'
);

select * from finish();

rollback;
