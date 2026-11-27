begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Structure and privileges: only the Edge Function (service role) applies transitions.
select has_function('valtrim', 'apply_customer_service_appointment_transitions', array['jsonb'],
  'The transition writer exists');
select ok(not has_function_privilege('authenticated', 'valtrim.apply_customer_service_appointment_transitions(jsonb)', 'execute'),
  'Browsers cannot apply transitions');
select ok(not has_function_privilege('anon', 'valtrim.apply_customer_service_appointment_transitions(jsonb)', 'execute'),
  'Anonymous callers cannot apply transitions');
select ok(has_function_privilege('service_role', 'valtrim.apply_customer_service_appointment_transitions(jsonb)', 'execute'),
  'The Edge Function can apply transitions');
select ok(exists (select 1 from cron.job where jobname = 'customer-service-appointment-transitions'
  and schedule = '* * * * *' and active), 'The transitions run every minute');

-- Fixture: a coordinator, three confirmed requests and three technicians (one each,
-- so every registration starts from an empty technician day).
create temporary table transition_fixture as select
  gen_random_uuid() as admin_id,
  (select job.id from valtrim.jobs job join valtrim.builders builder on builder.id = job.builder_id
   where job.is_active and job.status = 'ACTIVE' and builder.is_active
     and job.community_latitude between -90 and 90 and job.community_longitude between -180 and 180
   order by job.id limit 1) as job_id,
  null::bigint as started_request, null::bigint as ended_request, null::bigint as future_request,
  null::bigint as started_appointment, null::bigint as ended_appointment, null::bigint as future_appointment,
  null::bigint[] as techs;
grant select on transition_fixture to authenticated;
insert into auth.users(id, email, raw_user_meta_data)
select admin_id, admin_id::text || '@example.com', '{"name":"Transition Admin Test"}'::jsonb from transition_fixture;
update valtrim.app_users set role = 'ADMIN' where id = (select admin_id from transition_fixture);

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
  )) ->> 'requestId')::bigint from transition_fixture;
$fn$;
select set_config('request.jwt.claim.sub', admin_id::text, true) from transition_fixture;
update transition_fixture set started_request = pg_temp.new_request();
update transition_fixture set ended_request = pg_temp.new_request();
update transition_fixture set future_request = pg_temp.new_request();
select set_config('request.jwt.claim.sub', '', true);
update valtrim.service_requests set workflow_stage = 'READY_TO_PROPOSE'
where id in (select unnest(array[started_request, ended_request, future_request]) from transition_fixture);

with created as (
  insert into valtrim.people (name, email, is_active)
  select 'Transition Tech ' || n, 'transition-tech-' || n || '-' || gen_random_uuid() || '@example.com', true
  from generate_series(1, 3) n
  returning id
), roles as (
  insert into valtrim.person_roles (person_id, role) select id, 'SERVICE_TECHNICIAN' from created returning person_id
)
update transition_fixture set techs = (select array_agg(id order by id) from created);

-- A two-hour window starting p_offset from the current hour; 30 minutes of work.
create function pg_temp.visit(p_technician bigint, p_offset interval) returns jsonb language sql as $fn$
  select jsonb_build_object(
    'technicianIds', jsonb_build_array(p_technician),
    'windowStartsAt', date_trunc('hour', now()) + p_offset,
    'windowEndsAt', date_trunc('hour', now()) + p_offset + interval '2 hours',
    'startsAt', date_trunc('hour', now()) + p_offset,
    'endsAt', date_trunc('hour', now()) + p_offset + interval '30 minutes',
    'pickupMinutes', 10, 'acceptance', 'CUSTOMER_ACCEPTED_PROPOSAL');
$fn$;
create function pg_temp.register(p_request bigint, p_visit jsonb) returns bigint language sql as $fn$
  select (valtrim.register_customer_service_appointment((select admin_id from transition_fixture), p_request,
    (select updated_at from valtrim.service_requests where id = p_request), array[]::bigint[], p_visit,
    '[]'::jsonb) ->> 'appointmentId')::bigint;
$fn$;
-- Started an hour ago, ended an hour ago, and tomorrow.
update transition_fixture set
  started_appointment = pg_temp.register(started_request, pg_temp.visit(techs[1], interval '-1 hour')),
  ended_appointment = pg_temp.register(ended_request, pg_temp.visit(techs[2], interval '-3 hours')),
  future_appointment = pg_temp.register(future_request, pg_temp.visit(techs[3], interval '1 day'));

-- Apply what the Edge Function would send, plus a premature completion and a
-- premature start that the writer must skip.
create temporary table transition_result as
select valtrim.apply_customer_service_appointment_transitions(jsonb_build_array(
  jsonb_build_object('appointmentId', started_appointment, 'to', 'WORKING'),
  jsonb_build_object('appointmentId', ended_appointment, 'to', 'COMPLETED'),
  jsonb_build_object('appointmentId', started_appointment, 'to', 'COMPLETED'),
  jsonb_build_object('appointmentId', future_appointment, 'to', 'WORKING')
)) as result from transition_fixture;

select is((select result from transition_result), '{"working": 1, "completed": 1, "skipped": 2}'::jsonb,
  'Due transitions are applied and premature ones are skipped');
select is((select workflow_stage::text from valtrim.service_requests where id = (select started_request from transition_fixture)),
  'WORKING', 'A started window moves its request to WORKING');
select is((select state::text from valtrim.service_appointments where id = (select started_appointment from transition_fixture)),
  'SCHEDULED', 'A started appointment stays scheduled until its window ends');
select ok(exists (select 1 from valtrim.service_requests r, valtrim.service_appointments a, transition_fixture f
  where r.id = f.ended_request and a.id = f.ended_appointment
    and r.workflow_stage = 'COMPLETED' and a.state = 'COMPLETED' and a.is_current
    and r.completed_at = a.window_ends_at and a.completed_at = a.window_ends_at),
  'An ended window completes the appointment and its request at the window end');
select is((select workflow_stage::text from valtrim.service_requests where id = (select future_request from transition_fixture)),
  'CONFIRMED', 'A future window is not touched');

-- Attribution: the system, not the coordinator who registered the appointment.
select ok(exists (select 1 from valtrim.audit_events e, transition_fixture f
  where e.entity_id = f.ended_appointment::text and e.action = 'SERVICE_APPOINTMENT_COMPLETED'
    and e.actor_type = 'SYSTEM' and e.actor_user_id is null),
  'Completion is audited as the system');
select ok(exists (select 1 from valtrim.service_request_workflow_history h, transition_fixture f
  where h.request_id = f.started_request and h.new_stage = 'WORKING' and h.changed_by is null),
  'The WORKING stage change is recorded without a user');
select ok(exists (select 1 from valtrim.service_request_workflow_history h, transition_fixture f
  where h.request_id = f.started_request and h.new_stage = 'CONFIRMED' and h.changed_by = f.admin_id),
  'Changes made by a coordinator keep their author');
select is(coalesce(current_setting('valtrim.system_actor', true), ''), '',
  'The system attribution flag is cleared after the run');

-- Idempotent: running the same transitions again changes nothing.
select is(valtrim.apply_customer_service_appointment_transitions(jsonb_build_array(
  jsonb_build_object('appointmentId', started_appointment, 'to', 'WORKING'),
  jsonb_build_object('appointmentId', ended_appointment, 'to', 'COMPLETED'))),
  '{"working": 0, "completed": 0, "skipped": 2}'::jsonb, 'A repeated run is a no-op')
from transition_fixture;
select throws_ok($$select valtrim.apply_customer_service_appointment_transitions('{}'::jsonb)$$,
  '22023', 'Transitions must be an array', 'The writer only accepts a list');

-- Cancelling during the window returns a WORKING request to planning.
select set_config('request.jwt.claim.sub', admin_id::text, true) from transition_fixture;
set local role authenticated;
select lives_ok(format('select valtrim.cancel_customer_service_appointment(%s, %L, %L)', started_appointment,
    (select updated_at from valtrim.service_appointments where id = started_appointment), 'Customer was not home'),
  'A started appointment can still be cancelled with a reason')
from transition_fixture;
reset role;
select is((select workflow_stage::text from valtrim.service_requests where id = (select started_request from transition_fixture)),
  'READY_TO_PROPOSE', 'A cancelled WORKING request returns to Ready to propose');

select * from finish();
rollback;
