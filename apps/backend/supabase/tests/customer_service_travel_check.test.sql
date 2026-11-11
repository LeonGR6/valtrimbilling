begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

select has_table('valtrim', 'service_travel_check_runs', 'The day-before traffic check keeps a run log');

select col_is_pk('valtrim', 'service_travel_check_runs', 'target_date', 'One run per visit date');

select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.service_travel_check_runs'::regclass),
  'Row level security is enabled on the run log'
);

select ok(
  has_table_privilege('authenticated', 'valtrim.service_travel_check_runs', 'SELECT')
    and not has_table_privilege('authenticated', 'valtrim.service_travel_check_runs', 'INSERT')
    and not has_table_privilege('authenticated', 'valtrim.service_travel_check_runs', 'UPDATE')
    and not has_table_privilege('authenticated', 'valtrim.service_travel_check_runs', 'DELETE'),
  'Signed-in users can only read the run log; the Edge Function writes it'
);

select ok(
  not has_table_privilege('anon', 'valtrim.service_travel_check_runs', 'SELECT'),
  'Anonymous users cannot read the run log'
);

select policies_are(
  'valtrim', 'service_travel_check_runs', array['service_travel_check_runs_select'],
  'Only the scheduling read policy exists'
);

select is(
  (select schedule from cron.job where jobname = 'customer-service-travel-check'),
  '0 0 * * *',
  'The traffic check runs every day at 00:00 UTC (4 or 5 PM in California)'
);

select * from finish();

rollback;
