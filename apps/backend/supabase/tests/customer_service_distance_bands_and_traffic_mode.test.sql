begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

select has_column(
  'valtrim',
  'service_scheduling_settings',
  'distance_orange_max_miles',
  'Scheduling settings store the orange distance band'
);

select has_column(
  'valtrim',
  'service_scheduling_settings',
  'travel_traffic_mode',
  'Scheduling settings store the travel traffic mode'
);

select is(
  (select settings.distance_green_max_miles from valtrim.service_scheduling_settings settings where settings.id = 1),
  5.00::numeric,
  'The near band ends at five miles'
);

select is(
  (select settings.distance_yellow_max_miles from valtrim.service_scheduling_settings settings where settings.id = 1),
  10.00::numeric,
  'The medium band ends at ten miles'
);

select is(
  (select settings.distance_orange_max_miles from valtrim.service_scheduling_settings settings where settings.id = 1),
  20.00::numeric,
  'The far band ends at twenty miles'
);

select ok(
  (
    select pg_get_expr(column_default.adbin, column_default.adrelid)
    from pg_attrdef column_default
    join pg_attribute attribute
      on attribute.attrelid = column_default.adrelid and attribute.attnum = column_default.adnum
    where column_default.adrelid = 'valtrim.service_scheduling_settings'::regclass
      and attribute.attname = 'travel_traffic_mode'
  ) like '''OFF''::%',
  'Traffic-aware travel defaults to OFF until it is enabled on purpose'
);

select throws_ok(
  $$update valtrim.service_scheduling_settings set distance_orange_max_miles = 10 where id = 1$$,
  '23514'
);

select throws_ok(
  $$update valtrim.service_scheduling_settings set distance_green_max_miles = 12 where id = 1$$,
  '23514'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.service_scheduling_settings', 'distance_orange_max_miles', 'UPDATE'),
  'Authenticated users can update the orange band through the settings grant'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.service_scheduling_settings', 'travel_traffic_mode', 'UPDATE'),
  'Authenticated users can update the traffic mode through the settings grant'
);

select has_column(
  'valtrim',
  'service_travel_estimates',
  'departure_at',
  'Travel estimates store the departure time they were calculated for'
);

select has_column(
  'valtrim',
  'service_travel_estimates',
  'static_minutes',
  'Traffic estimates keep the minutes without traffic'
);

select has_column(
  'valtrim',
  'service_travel_estimates',
  'traffic_model',
  'Travel estimates record the traffic model used'
);

select has_column(
  'valtrim',
  'service_travel_estimates',
  'distance_miles',
  'Travel estimates store the road distance in miles'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.service_travel_estimates'::regclass
      and conname = 'service_travel_estimates_traffic_needs_departure'
  ),
  'A traffic estimate must record its departure time'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.service_scheduling_settings'::regclass
      and conname = 'service_scheduling_settings_orange_after_yellow'
  ),
  'The orange band must stay beyond the medium band'
);

select ok(
  (select array_agg(enumlabel::text order by enumsortorder) from pg_enum
    where enumtypid = 'valtrim.service_travel_traffic_mode'::regtype)
  = array['OFF', 'BEST_GUESS', 'PESSIMISTIC']::text[],
  'The traffic mode enum has the three approved values'
);

select ok(
  (select array_agg(enumlabel::text order by enumsortorder) from pg_enum
    where enumtypid = 'valtrim.service_travel_traffic_model'::regtype)
  = array['BEST_GUESS', 'PESSIMISTIC']::text[],
  'The traffic model enum has BEST_GUESS and PESSIMISTIC'
);

select col_is_null(
  'valtrim',
  'service_travel_estimates',
  'traffic_model',
  'Estimates without traffic (and earlier ones) keep no traffic model'
);

select * from finish();

rollback;
