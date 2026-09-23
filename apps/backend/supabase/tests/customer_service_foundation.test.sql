begin;

create extension if not exists pgtap with schema extensions;

select plan(47);

select ok(
  to_regtype('valtrim.service_work_type') is not null,
  'Customer Service has an HW/WS work type'
);

select ok(
  to_regtype('valtrim.service_confirmation_status') is not null,
  'Customer confirmation states exist'
);

select ok(
  to_regtype('valtrim.service_resolution_status') is not null,
  'Single-visit resolution states exist'
);

select has_table(
  'valtrim',
  'service_scheduling_settings',
  'Scheduling settings are persisted'
);

select has_table(
  'valtrim',
  'service_request_availability',
  'Customer availability windows are persisted'
);

select has_table(
  'valtrim',
  'service_communications',
  'Customer communications are persisted'
);

select has_table(
  'private',
  'service_confirmation_tokens',
  'Appointment confirmation tokens stay in the private schema'
);

select has_column(
  'valtrim',
  'service_scheduling_settings',
  'company_address',
  'Scheduling settings store the company address'
);

select has_column(
  'valtrim',
  'service_properties',
  'latitude',
  'Service properties store latitude'
);

select has_column(
  'valtrim',
  'service_properties',
  'longitude',
  'Service properties store longitude'
);

select has_column(
  'valtrim',
  'service_requests',
  'work_type',
  'Service requests identify HW, WS or both'
);

select has_column(
  'valtrim',
  'service_requests',
  'estimated_duration_minutes',
  'Service requests store the administrative duration estimate'
);

select has_column(
  'valtrim',
  'service_requests',
  'due_on',
  'Service requests store the five-business-day deadline'
);

select has_column(
  'valtrim',
  'service_requests',
  'resolution_status',
  'Service requests store the single-visit outcome'
);

select has_column(
  'valtrim',
  'service_appointments',
  'confirmation_status',
  'Appointments store the customer confirmation state'
);

select has_function(
  'valtrim',
  'calculate_business_due_date',
  array['date', 'integer'],
  'The business deadline calculator exists'
);

select is(
  valtrim.calculate_business_due_date(date '2026-09-21', 5),
  date '2026-09-25',
  'A Monday request is due on Friday when the reported day counts as day one'
);

select is(
  valtrim.calculate_business_due_date(date '2026-09-19', 5),
  date '2026-09-25',
  'A weekend request begins counting on the following Monday'
);

select is(
  (
    select settings.business_days_to_complete
    from valtrim.service_scheduling_settings settings
    where settings.id = 1
  ),
  5::smallint,
  'The initial completion window is five business days'
);

select is(
  (
    select settings.reminder_after_hours
    from valtrim.service_scheduling_settings settings
    where settings.id = 1
  ),
  24::smallint,
  'The initial customer reminder is configured for 24 hours'
);

select is(
  (
    select settings.distance_green_max_miles
    from valtrim.service_scheduling_settings settings
    where settings.id = 1
  ),
  10.00::numeric,
  'The green proximity threshold is ten miles'
);

select is(
  (
    select settings.distance_yellow_max_miles
    from valtrim.service_scheduling_settings settings
    where settings.id = 1
  ),
  20.00::numeric,
  'The yellow proximity threshold ends at twenty miles'
);

select is(
  (
    select settings.company_address
    from valtrim.service_scheduling_settings settings
    where settings.id = 1
  ),
  '1526 Seventh St, Riverside, CA 92507, United States'::varchar,
  'The Riverside office is the dispatch origin'
);

select ok(
  obj_description('valtrim.service_request_parts'::regclass, 'pg_class')
    like 'Optional informational%',
  'Parts are documented as informational and do not block scheduling'
);

select ok(
  (
    select table_record.relrowsecurity
    from pg_class table_record
    join pg_namespace schema_record
      on schema_record.oid = table_record.relnamespace
    where schema_record.nspname = 'valtrim'
      and table_record.relname = 'service_request_availability'
  ),
  'Availability windows have RLS enabled'
);

select ok(
  (
    select table_record.relrowsecurity
    from pg_class table_record
    join pg_namespace schema_record
      on schema_record.oid = table_record.relnamespace
    where schema_record.nspname = 'valtrim'
      and table_record.relname = 'service_communications'
  ),
  'Communication history has RLS enabled'
);

select ok(
  (
    select table_record.relrowsecurity
    from pg_class table_record
    join pg_namespace schema_record
      on schema_record.oid = table_record.relnamespace
    where schema_record.nspname = 'private'
      and table_record.relname = 'service_confirmation_tokens'
  ),
  'Confirmation tokens have RLS enabled in the private schema'
);

select ok(
  has_table_privilege(
    'authenticated',
    'valtrim.service_requests',
    'select'
  ),
  'Authenticated users can read requests when RLS allows it'
);

select ok(
  has_column_privilege(
    'authenticated',
    'valtrim.service_requests',
    'work_type',
    'insert'
  ),
  'Authorized clients can register the Customer Service work type'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'valtrim.service_requests',
    'due_on',
    'update'
  ),
  'Browser clients cannot forge the five-day deadline'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'valtrim.service_communications',
    'insert'
  ),
  'Browser clients cannot forge sent email history'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'private.service_confirmation_tokens',
    'select'
  ),
  'Browser clients cannot read confirmation token hashes'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'valtrim.service_requests',
    'delete'
  ),
  'Service requests cannot be deleted from the browser'
);

select ok(
  (
    select count(*)
    from pg_policies policy
    where policy.schemaname = 'valtrim'
      and policy.tablename in (
        'service_properties',
        'service_requests',
        'service_request_status_history',
        'service_appointments',
        'service_request_notes',
        'service_request_parts',
        'service_request_attachments',
        'service_request_availability',
        'service_communications',
        'service_scheduling_settings'
      )
  ) >= 21,
  'Customer Service tables have at least the required RLS policies'
);

select ok(
  exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'valtrim.service_properties'::regclass
      and constraint_record.conname =
        'service_properties_coordinates_pair_check'
  ),
  'Latitude and longitude must be supplied together'
);

select ok(
  exists (
    select 1
    from pg_indexes index_record
    where index_record.schemaname = 'valtrim'
      and index_record.indexname =
        'service_appointments_one_completed_visit_uq'
  ),
  'A request can have only one completed visit'
);

select has_trigger(
  'valtrim',
  'service_requests',
  'service_requests_set_due_on',
  'Requests calculate their deadline in the database'
);

select has_trigger(
  'valtrim',
  'service_requests',
  'customer_service_requests_audit',
  'Request changes are connected to Activity History'
);

select has_trigger(
  'valtrim',
  'service_appointments',
  'customer_service_appointments_audit',
  'Appointment changes are connected to Activity History'
);

insert into valtrim.service_properties (
  address,
  city,
  state,
  postal_code,
  latitude,
  longitude
)
values (
  'Foundation test property',
  'Murrieta',
  'CA',
  '92562',
  33.553900,
  -117.213900
);

insert into valtrim.service_requests (
  property_id,
  reported_on,
  homeowner_name,
  homeowner_email,
  request_type,
  description,
  work_type,
  estimated_duration_minutes
)
select
  property.id,
  date '2026-09-21',
  'Foundation Customer',
  'foundation.customer@example.com',
  'SERVICE_CALL',
  'Foundation scheduling test',
  'HW',
  60
from valtrim.service_properties property
where property.address = 'Foundation test property';

select is(
  (
    select request.due_on
    from valtrim.service_requests request
    where request.description = 'Foundation scheduling test'
  ),
  date '2026-09-25',
  'The request trigger persists the calculated business deadline'
);

select is(
  (
    select overview.is_ready_to_schedule
    from valtrim.service_request_overview overview
    where overview.description = 'Foundation scheduling test'
  ),
  false,
  'A request without customer availability is not ready to schedule'
);

insert into valtrim.service_request_availability (
  request_id,
  available_from,
  available_until,
  notes
)
select
  request.id,
  timestamptz '2026-09-22 09:00:00-07',
  timestamptz '2026-09-22 12:00:00-07',
  'Customer prefers the morning'
from valtrim.service_requests request
where request.description = 'Foundation scheduling test';

select is(
  (
    select overview.is_ready_to_schedule
    from valtrim.service_request_overview overview
    where overview.description = 'Foundation scheduling test'
  ),
  true,
  'Coordinates, duration, email and availability make a request ready'
);

select ok(
  exists (
    select 1
    from valtrim.service_request_status_history history
    join valtrim.service_requests request on request.id = history.request_id
    where request.description = 'Foundation scheduling test'
      and history.new_status = 'NEW'
  ),
  'Creating a request records its initial workflow status'
);

select ok(
  exists (
    select 1
    from valtrim.audit_events event
    join valtrim.service_requests request
      on request.id::text = event.entity_id
    where request.description = 'Foundation scheduling test'
      and event.module = 'CUSTOMER_SERVICE'
      and event.action = 'SERVICE_REQUEST_CREATED'
  ),
  'Creating a request records a business Activity History event'
);

insert into valtrim.service_appointments (
  request_id,
  starts_at,
  ends_at,
  notes
)
select
  request.id,
  timestamptz '2026-09-22 09:00:00-07',
  timestamptz '2026-09-22 10:00:00-07',
  'Foundation appointment proposal'
from valtrim.service_requests request
where request.description = 'Foundation scheduling test';

select ok(
  exists (
    select 1
    from valtrim.audit_events event
    join valtrim.service_appointments appointment
      on appointment.id::text = event.entity_id
    where appointment.notes = 'Foundation appointment proposal'
      and event.module = 'CUSTOMER_SERVICE'
      and event.action = 'SERVICE_APPOINTMENT_PROPOSED'
  ),
  'Creating a proposal records an appointment Activity History event'
);

select ok(
  exists (
    select 1
    from information_schema.columns column_record
    where column_record.table_schema = 'valtrim'
      and column_record.table_name = 'service_request_overview'
      and column_record.column_name = 'is_ready_to_schedule'
  ),
  'The overview exposes scheduling readiness'
);

select ok(
  exists (
    select 1
    from information_schema.columns column_record
    where column_record.table_schema = 'valtrim'
      and column_record.table_name = 'service_request_overview'
      and column_record.column_name = 'is_overdue'
  ),
  'The overview exposes the SLA overdue indicator'
);

select * from finish();

rollback;
