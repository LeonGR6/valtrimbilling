begin;

create extension if not exists pgtap with schema extensions;

select plan(21);

select has_table(
  'valtrim',
  'service_technician_profiles',
  'Technician operational profiles are persisted'
);

select has_view(
  'valtrim',
  'service_technician_roster',
  'The technician roster exposes contact and operational data together'
);

select has_column(
  'valtrim',
  'service_scheduling_settings',
  'travel_buffer_minutes',
  'Scheduling settings store the travel buffer'
);

select has_column(
  'valtrim',
  'service_scheduling_settings',
  'default_duration_minutes',
  'Scheduling settings store the default job duration'
);

select has_column(
  'valtrim',
  'service_scheduling_settings',
  'requires_dispatcher_approval',
  'Scheduling settings require human approval'
);

select has_function(
  'valtrim',
  'create_service_technician',
  array[
    'text', 'text', 'text', 'time without time zone',
    'time without time zone', 'numeric', 'numeric'
  ],
  'Technician creation accepts work hours and coordinates'
);

select has_function(
  'valtrim',
  'update_service_technician',
  array[
    'bigint', 'text', 'text', 'text', 'boolean',
    'time without time zone', 'time without time zone', 'numeric', 'numeric'
  ],
  'Technician updates are atomic'
);

select has_function(
  'private',
  'create_service_technician_internal',
  array[
    'text', 'text', 'text', 'time without time zone',
    'time without time zone', 'numeric', 'numeric'
  ],
  'The privileged technician creation implementation stays private'
);

select has_function(
  'private',
  'update_service_technician_internal',
  array[
    'bigint', 'text', 'text', 'text', 'boolean',
    'time without time zone', 'time without time zone', 'numeric', 'numeric'
  ],
  'The privileged technician update implementation stays private'
);

select ok(
  (
    select table_record.relrowsecurity
    from pg_class table_record
    join pg_namespace schema_record
      on schema_record.oid = table_record.relnamespace
    where schema_record.nspname = 'valtrim'
      and table_record.relname = 'service_technician_profiles'
  ),
  'Technician profiles have RLS enabled'
);

select ok(
  has_table_privilege(
    'authenticated',
    'valtrim.service_technician_profiles',
    'select'
  ),
  'Authenticated schedulers can read profiles subject to RLS'
);

select ok(
  not has_table_privilege(
    'anon',
    'valtrim.service_technician_roster',
    'select'
  ),
  'Anonymous users cannot read the technician roster'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.create_service_technician(text,text,text,time without time zone,time without time zone,numeric,numeric)',
    'execute'
  ),
  'Authenticated users can call technician creation subject to its role check'
);

select ok(
  not has_function_privilege(
    'anon',
    'valtrim.create_service_technician(text,text,text,time without time zone,time without time zone,numeric,numeric)',
    'execute'
  ),
  'Anonymous users cannot create technicians'
);

select is(
  (select business_days_to_complete from valtrim.service_scheduling_settings where id = 1),
  5::smallint,
  'The Customer Service deadline remains five business days'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'valtrim.service_scheduling_settings',
    'business_days_to_complete',
    'update'
  ),
  'Browser clients cannot change the fixed five-day deadline'
);

select is(
  (select travel_buffer_minutes from valtrim.service_scheduling_settings where id = 1),
  30::smallint,
  'The minimum travel buffer is thirty minutes'
);

select is(
  (select default_duration_minutes from valtrim.service_scheduling_settings where id = 1),
  60::smallint,
  'The initial default job duration is sixty minutes'
);

select is(
  (select requires_dispatcher_approval from valtrim.service_scheduling_settings where id = 1),
  true,
  'Dispatcher approval is enabled by default'
);

select ok(
  exists (
    select 1
    from pg_indexes index_record
    where index_record.schemaname = 'valtrim'
      and index_record.indexname = 'service_appointments_technician_idx'
  ),
  'The existing appointment index supports technician schedule lookups'
);

select throws_ok(
  $$
    select valtrim.create_service_technician(
      'Unauthorized Technician',
      null,
      null,
      time '08:00',
      time '17:00',
      33.986588,
      -117.343021
    )
  $$,
  '42501',
  'You do not have permission to manage Customer Service requests',
  'Technician creation rejects callers without a scheduling role'
);

select * from finish();

rollback;
