begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Structure: legacy generator output and the fixed buffer are gone.
select hasnt_table('valtrim', 'service_schedule_proposals', 'Legacy schedule proposals are retired');
select hasnt_table('valtrim', 'service_schedule_proposal_stops', 'Legacy proposal stops are retired');
select hasnt_column('valtrim', 'service_scheduling_settings', 'travel_buffer_minutes', 'The fixed travel buffer is retired');
select ok(to_regprocedure('private.supersede_service_schedule_proposals()') is null, 'The supersede trigger function is retired');
select hasnt_column('valtrim', 'service_appointments', 'technician_id', 'The single technician column is replaced by the crew');
select has_column('valtrim', 'service_appointments', 'technician_ids', 'Appointments store every assigned technician');
select has_table('valtrim', 'service_travel_estimates', 'Travel minutes are stored per pair of visits');

-- Privileges: browsers read; only the Edge Function (service role) registers.
select ok(not has_table_privilege('authenticated', 'valtrim.service_appointments', 'insert'), 'Browsers cannot insert appointments');
select ok(not has_table_privilege('authenticated', 'valtrim.service_appointments', 'update'), 'Browsers cannot update appointments');
select ok(not has_table_privilege('authenticated', 'valtrim.service_travel_estimates', 'insert'), 'Browsers cannot insert travel estimates');
select ok(not has_function_privilege('authenticated', 'valtrim.register_customer_service_appointment(uuid,bigint,timestamptz,bigint[],jsonb,jsonb)', 'execute'),
  'Browsers cannot bypass the Edge Function validation');
select ok(has_function_privilege('service_role', 'valtrim.register_customer_service_appointment(uuid,bigint,timestamptz,bigint[],jsonb,jsonb)', 'execute'),
  'The Edge Function can register');
select ok(has_function_privilege('authenticated', 'valtrim.cancel_customer_service_appointment(bigint,timestamptz,text)', 'execute'),
  'Signed-in coordinators can call the guarded cancellation');
select ok(not has_function_privilege('anon', 'valtrim.cancel_customer_service_appointment(bigint,timestamptz,text)', 'execute'),
  'Anonymous callers cannot cancel');

-- Fixture: one coordinator, one field user, two ready requests and three technicians.
create temporary table appointment_fixture as select
  gen_random_uuid() as admin_id, gen_random_uuid() as field_id,
  (select job.id from valtrim.jobs job join valtrim.builders builder on builder.id = job.builder_id
   where job.is_active and job.status = 'ACTIVE' and builder.is_active
     and job.community_latitude between -90 and 90 and job.community_longitude between -180 and 180
   order by job.id limit 1) as job_id,
  null::bigint as first_request, null::bigint as second_request,
  null::bigint as tech_a, null::bigint as tech_b, null::bigint as tech_inactive,
  null::bigint as first_appointment, null::bigint as second_appointment;
insert into auth.users(id, email, raw_user_meta_data)
select admin_id, admin_id::text || '@example.com', '{"name":"Appointment Admin Test"}'::jsonb from appointment_fixture
union all select field_id, field_id::text || '@example.com', '{"name":"Appointment Field Test"}'::jsonb from appointment_fixture;
update valtrim.app_users set role = 'ADMIN' where id = (select admin_id from appointment_fixture);
update valtrim.app_users set role = 'FIELD' where id = (select field_id from appointment_fixture);
select ok(job_id is not null, 'The linked project has a valid active Job') from appointment_fixture;

create function pg_temp.new_request() returns bigint language sql as $fn$
  select (valtrim.create_customer_service_request_intake(gen_random_uuid(), jsonb_build_object(
    'property', jsonb_build_object('jobId', job_id),
    'request', jsonb_build_object('reportedOn', (now() at time zone 'America/Los_Angeles')::date,
      'serviceKind', 'ADJUSTMENT', 'workCategory', 'DOORS', 'serviceTask', 'GENERAL_FIX',
      'estimatedDurationMinutes', 30, 'crewSize', 1),
    'contacts', jsonb_build_array(jsonb_build_object('role', 'PRIMARY', 'name', 'Primary Test', 'email', 'primary@example.com')),
    'items', jsonb_build_array(jsonb_build_object('itemNumber', 1, 'description', 'Item', 'materialRequired', false, 'chargeable', false)),
    'source', jsonb_build_object('sourceType', 'PDF', 'emailText', 'Original email', 'extractedText', 'Original OCR',
      'extractionPayload', '{"schemaVersion":"1.0"}'::jsonb, 'reviewNotes', jsonb_build_array())
  )) ->> 'requestId')::bigint from appointment_fixture;
$fn$;
select set_config('request.jwt.claim.sub', admin_id::text, true) from appointment_fixture;
update appointment_fixture set first_request = pg_temp.new_request();
update appointment_fixture set second_request = pg_temp.new_request();
select set_config('request.jwt.claim.sub', '', true);
-- Review is covered elsewhere; here the requests only need to be ready to propose.
update valtrim.service_requests set workflow_stage = 'READY_TO_PROPOSE'
where id in (select first_request from appointment_fixture union all select second_request from appointment_fixture);

with created as (
  insert into valtrim.people (name, email, is_active)
  values ('Appointment Tech A', 'appointment-tech-a-' || gen_random_uuid() || '@example.com', true),
         ('Appointment Tech B', 'appointment-tech-b-' || gen_random_uuid() || '@example.com', true),
         ('Appointment Tech Inactive', 'appointment-tech-x-' || gen_random_uuid() || '@example.com', false)
  returning id, name
), roles as (
  insert into valtrim.person_roles (person_id, role) select id, 'SERVICE_TECHNICIAN' from created returning person_id
)
update appointment_fixture set
  tech_a = (select id from created where name = 'Appointment Tech A'),
  tech_b = (select id from created where name = 'Appointment Tech B'),
  tech_inactive = (select id from created where name = 'Appointment Tech Inactive');

-- Monday 2027-01-11 in California (PST, UTC-8).
create function pg_temp.visit(p_technicians bigint[], p_window text, p_start text, p_end text,
  p_acceptance text default 'CUSTOMER_ACCEPTED_PROPOSAL') returns jsonb language sql as $fn$
  select jsonb_build_object(
    'technicianIds', to_jsonb(p_technicians),
    'windowStartsAt', ('2027-01-11 ' || p_window || ':00-08')::timestamptz,
    'windowEndsAt', ('2027-01-11 ' || p_window || ':00-08')::timestamptz + interval '2 hours',
    'startsAt', ('2027-01-11 ' || p_start || ':00-08')::timestamptz,
    'endsAt', ('2027-01-11 ' || p_end || ':00-08')::timestamptz,
    'pickupMinutes', 10, 'acceptance', p_acceptance);
$fn$;
create function pg_temp.register(p_actor uuid, p_request bigint, p_expected bigint[], p_visit jsonb,
  p_travel jsonb default '[]'::jsonb) returns jsonb language sql as $fn$
  select valtrim.register_customer_service_appointment(p_actor, p_request,
    (select updated_at from valtrim.service_requests where id = p_request), p_expected, p_visit, p_travel);
$fn$;

-- Rejections. Each failed call rolls back as a whole.
select throws_ok(format('select pg_temp.register(%L, %s, %L, pg_temp.visit(array[%s]::bigint[], %L, %L, %L))',
    field_id, first_request, '{}', tech_a, '08:00', '08:00', '08:30'),
  '42501', 'You do not have permission to register Customer Service appointments', 'A FIELD user cannot register')
from appointment_fixture;
select throws_ok(format('select valtrim.register_customer_service_appointment(%L, %s, now() - interval %L, %L, pg_temp.visit(array[%s]::bigint[], %L, %L, %L), %L)',
    admin_id, first_request, '1 day', '{}', tech_a, '08:00', '08:00', '08:30', '[]'),
  '40001', 'This request changed after you opened it. Reload requests and review the plan again.', 'A stale request version is rejected')
from appointment_fixture;
select throws_ok(format('select pg_temp.register(%L, %s, %L, pg_temp.visit(array[%s]::bigint[], %L, %L, %L))',
    admin_id, first_request, '{}', tech_inactive, '08:00', '08:00', '08:30'),
  '23514', 'Technicians must be distinct, active and have the SERVICE_TECHNICIAN role', 'An inactive technician cannot be assigned')
from appointment_fixture;
select throws_ok(format('select pg_temp.register(%L, %s, %L, pg_temp.visit(array[%s]::bigint[], %L, %L, %L))',
    admin_id, first_request, '{}', tech_a, '08:00', '09:30', '09:55'),
  '23514', null, 'Work plus pickup must end by the window close')
from appointment_fixture;

-- Registration stores the appointment, the travel leg, the stage, history and audit.
update appointment_fixture set first_appointment = (pg_temp.register(admin_id, first_request, '{}',
  pg_temp.visit(array[tech_a], '08:00', '08:00', '08:30'),
  jsonb_build_array(jsonb_build_object('fromRequestId', first_request, 'toRequestId', second_request, 'minutes', 15))
) ->> 'appointmentId')::bigint;
select ok(first_appointment is not null, 'An accepted appointment is registered') from appointment_fixture;
select ok(exists (select 1 from valtrim.service_appointments a, appointment_fixture f
  where a.id = f.first_appointment and a.technician_ids = array[f.tech_a] and a.is_current and a.state = 'SCHEDULED'
    and a.confirmation_status = 'CONFIRMED' and a.confirmed_at is not null
    and a.acceptance = 'CUSTOMER_ACCEPTED_PROPOSAL' and a.pickup_minutes = 10 and a.created_by = f.admin_id
    and a.window_starts_at = timestamptz '2027-01-11 08:00:00-08' and a.ends_at = timestamptz '2027-01-11 08:30:00-08'),
  'The appointment keeps window, work, pickup, crew, acceptance and actor');
select is((select workflow_stage::text from valtrim.service_requests where id = (select first_request from appointment_fixture)),
  'CONFIRMED', 'The request becomes CONFIRMED');
select ok(exists (select 1 from valtrim.service_request_workflow_history h, appointment_fixture f
  where h.request_id = f.first_request and h.new_stage = 'CONFIRMED' and h.changed_by = f.admin_id),
  'The stage change is recorded for the coordinator');
select ok(exists (select 1 from valtrim.audit_events e, appointment_fixture f
  where e.entity_type = 'SERVICE_APPOINTMENT' and e.entity_id = f.first_appointment::text
    and e.action = 'SERVICE_APPOINTMENT_REGISTERED' and e.actor_user_id = f.admin_id),
  'Registration is audited with the coordinator');
select ok(exists (select 1 from valtrim.service_travel_estimates t, appointment_fixture f
  where t.from_request_id = f.first_request and t.to_request_id = f.second_request
    and t.minutes = 15 and t.source = 'MANUAL' and t.created_by = f.admin_id),
  'The manual travel estimate is stored');

-- The technician's day changed: a write validated against the old day is refused.
select throws_ok(format('select pg_temp.register(%L, %s, %L, pg_temp.visit(array[%s]::bigint[], %L, %L, %L))',
    admin_id, second_request, '{}', tech_a, '10:00', '10:00', '10:30'),
  '40001', 'The schedule changed. Review the plan again.', 'A stale technician day is rejected')
from appointment_fixture;
update appointment_fixture set second_appointment = (pg_temp.register(admin_id, second_request, array[first_appointment],
  pg_temp.visit(array[tech_a, tech_b], '10:00', '10:00', '10:30', 'COUNTER_PROPOSAL_ACCEPTED')) ->> 'appointmentId')::bigint;
select ok(exists (select 1 from valtrim.service_appointments a, appointment_fixture f
  where a.id = f.second_appointment and a.technician_ids = (select array_agg(x order by x) from unnest(array[f.tech_a, f.tech_b]) x)
    and a.acceptance = 'COUNTER_PROPOSAL_ACCEPTED'),
  'A crew of two registered technicians is stored for an accepted counter-proposal');
select throws_ok(format('select pg_temp.register(%L, %s, array[%s, %s]::bigint[], pg_temp.visit(array[%s]::bigint[], %L, %L, %L))',
    admin_id, first_request, first_appointment, second_appointment, tech_a, '12:00', '12:00', '12:30'),
  '55000', 'Only an open request waiting for a proposal can get an appointment', 'A confirmed request cannot be registered twice')
from appointment_fixture;

-- Row-level security: coordinators read, field users do not.
grant select on appointment_fixture to authenticated;
select set_config('request.jwt.claim.sub', field_id::text, true) from appointment_fixture;
set local role authenticated;
select is((select count(*) from valtrim.service_appointments where request_id in
  (select first_request from appointment_fixture union all select second_request from appointment_fixture)), 0::bigint,
  'Field users cannot read appointments');
select is((select count(*) from valtrim.service_travel_estimates where from_request_id = (select first_request from appointment_fixture)),
  0::bigint, 'Field users cannot read travel estimates');
reset role;
select set_config('request.jwt.claim.sub', admin_id::text, true) from appointment_fixture;
set local role authenticated;
select is((select count(*) from valtrim.service_appointments where request_id in
  (select first_request from appointment_fixture union all select second_request from appointment_fixture)), 2::bigint,
  'Coordinators read appointments');
select throws_ok($$update valtrim.service_appointments set notes = 'x' where id = (select first_appointment from appointment_fixture)$$,
  '42501', null, 'Coordinators cannot update appointments directly');

-- Cancellation releases the slot and returns the request to planning.
select throws_ok(format('select valtrim.cancel_customer_service_appointment(%s, now(), %L)', first_appointment, '  '),
  '22023', 'Enter a cancellation reason of 500 characters or fewer', 'A reason is required')
from appointment_fixture;
select throws_ok(format('select valtrim.cancel_customer_service_appointment(%s, now() - interval %L, %L)', first_appointment, '1 day', 'Customer asked'),
  '40001', 'This appointment changed after you opened it. Reload and try again.', 'A stale appointment version is rejected')
from appointment_fixture;
select lives_ok(format('select valtrim.cancel_customer_service_appointment(%s, %L, %L)', first_appointment,
    (select updated_at from valtrim.service_appointments where id = first_appointment), 'Customer asked for another day'),
  'A coordinator cancels with a reason')
from appointment_fixture;
reset role;
select ok(exists (select 1 from valtrim.service_appointments a, appointment_fixture f
  where a.id = f.first_appointment and a.state = 'CANCELLED' and not a.is_current
    and a.cancelled_at is not null and a.cancel_reason = 'Customer asked for another day' and a.updated_by = f.admin_id),
  'The cancelled appointment is kept with its reason and no longer current');
select is((select workflow_stage::text from valtrim.service_requests where id = (select first_request from appointment_fixture)),
  'READY_TO_PROPOSE', 'The request returns to Ready to propose');
select ok(exists (select 1 from valtrim.audit_events e, appointment_fixture f
  where e.entity_id = f.first_appointment::text and e.action = 'SERVICE_APPOINTMENT_CANCELLED' and e.actor_user_id = f.admin_id),
  'Cancellation is audited');
select set_config('request.jwt.claim.sub', admin_id::text, true) from appointment_fixture;
set local role authenticated;
select throws_ok(format('select valtrim.cancel_customer_service_appointment(%s, %L, %L)', first_appointment,
    (select updated_at from valtrim.service_appointments where id = first_appointment), 'Again'),
  '55000', 'Only a scheduled appointment can be cancelled', 'A cancelled appointment cannot be cancelled again')
from appointment_fixture;
reset role;

-- The released request can be registered again against the technician's current day.
select lives_ok(format('select pg_temp.register(%L, %s, array[%s]::bigint[], pg_temp.visit(array[%s]::bigint[], %L, %L, %L))',
    admin_id, first_request, second_appointment, tech_a, '12:00', '12:00', '12:30'),
  'A released request can be registered again')
from appointment_fixture;

select * from finish();
rollback;
