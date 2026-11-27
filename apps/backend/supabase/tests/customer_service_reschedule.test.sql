begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Reschedule block, part R1 (27 Nov 2026): move or cancel a confirmed visit and close a
-- request without one. Only the Edge Function (service role) calls these RPCs.
select has_type('valtrim', 'service_change_reason', 'Visit changes and closings have a reason list');
select has_column('valtrim', 'service_appointments', 'change_reason', 'A cancelled or moved visit keeps its reason');
select has_column('valtrim', 'service_appointments', 'rescheduled_from_id', 'A moved visit points to the one it replaced');
select has_column('valtrim', 'service_requests', 'close_reason_code', 'A closed request keeps its reason');
select has_column('valtrim', 'service_requests', 'duplicate_of_request_id', 'A duplicate points to the original request');
-- Read from the catalog: a value added in this transaction cannot be used yet.
select is((select count(*)::int from pg_catalog.pg_enum e join pg_catalog.pg_type t on t.oid = e.enumtypid
  join pg_catalog.pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'valtrim' and t.typname = 'service_communication_type' and e.enumlabel in ('VISIT_MOVED', 'VISIT_CANCELLED')),
  2, 'The moved and cancelled emails have communication types');
select ok(not has_function_privilege('authenticated',
  'valtrim.reschedule_customer_service_appointment(uuid,bigint,timestamptz,timestamptz,bigint[],bigint[],jsonb,jsonb,valtrim.service_change_reason,text)', 'execute'),
  'Browsers cannot move a visit without the Edge Function');
select ok(has_function_privilege('service_role',
  'valtrim.reschedule_customer_service_appointment(uuid,bigint,timestamptz,timestamptz,bigint[],bigint[],jsonb,jsonb,valtrim.service_change_reason,text)', 'execute'),
  'The Edge Function can move a visit');
select ok(not has_function_privilege('authenticated',
  'valtrim.cancel_customer_service_visit(uuid,bigint,timestamptz,valtrim.service_change_reason,text,boolean,bigint)', 'execute'),
  'Browsers cannot cancel a visit without the Edge Function');
select ok(has_function_privilege('service_role',
  'valtrim.cancel_customer_service_visit(uuid,bigint,timestamptz,valtrim.service_change_reason,text,boolean,bigint)', 'execute'),
  'The Edge Function can cancel a visit');
select ok(not has_function_privilege('authenticated',
  'valtrim.close_customer_service_request(uuid,bigint,timestamptz,valtrim.service_change_reason,text,bigint)', 'execute'),
  'Browsers cannot close a request without the Edge Function');
select ok(has_function_privilege('service_role',
  'valtrim.close_customer_service_request(uuid,bigint,timestamptz,valtrim.service_change_reason,text,bigint)', 'execute'),
  'The Edge Function can close a request');

-- Fixture: a coordinator, a field user, five requests and two technicians.
create temporary table move_fixture as select
  gen_random_uuid() as admin_id, gen_random_uuid() as field_id,
  (select job.id from valtrim.jobs job join valtrim.builders builder on builder.id = job.builder_id
   where job.is_active and job.status = 'ACTIVE' and builder.is_active
     and job.community_latitude between -90 and 90 and job.community_longitude between -180 and 180
   order by job.id limit 1) as job_id,
  null::bigint as request_a, null::bigint as request_b, null::bigint as request_c,
  null::bigint as request_d, null::bigint as request_e,
  null::bigint as tech_a, null::bigint as tech_b,
  null::bigint as visit_a, null::bigint as visit_b, null::bigint as visit_e, null::bigint as moved_a;
insert into auth.users(id, email, raw_user_meta_data)
select admin_id, admin_id::text || '@example.com', '{"name":"Reschedule Admin Test"}'::jsonb from move_fixture
union all select field_id, field_id::text || '@example.com', '{"name":"Reschedule Field Test"}'::jsonb from move_fixture;
update valtrim.app_users set role = 'ADMIN' where id = (select admin_id from move_fixture);
update valtrim.app_users set role = 'FIELD' where id = (select field_id from move_fixture);
select ok(job_id is not null, 'The linked project has a valid active Job') from move_fixture;

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
  )) ->> 'requestId')::bigint from move_fixture;
$fn$;
select set_config('request.jwt.claim.sub', admin_id::text, true) from move_fixture;
update move_fixture set request_a = pg_temp.new_request();
update move_fixture set request_b = pg_temp.new_request();
update move_fixture set request_c = pg_temp.new_request();
update move_fixture set request_d = pg_temp.new_request();
update move_fixture set request_e = pg_temp.new_request();
select set_config('request.jwt.claim.sub', '', true);
update valtrim.service_requests set workflow_stage = 'READY_TO_PROPOSE'
where id in (select unnest(array[request_a, request_b, request_c, request_d, request_e]) from move_fixture);

with created as (
  insert into valtrim.people (name, email, is_active)
  values ('Reschedule Tech A', 'reschedule-tech-a-' || gen_random_uuid() || '@example.com', true),
         ('Reschedule Tech B', 'reschedule-tech-b-' || gen_random_uuid() || '@example.com', true)
  returning id, name
), roles as (
  insert into valtrim.person_roles (person_id, role) select id, 'SERVICE_TECHNICIAN' from created returning person_id
)
update move_fixture set
  tech_a = (select id from created where name = 'Reschedule Tech A'),
  tech_b = (select id from created where name = 'Reschedule Tech B');

-- Days in California (PST, UTC-8): Mon 4 and Tue 5 Feb 2030, and a Monday already past.
create function pg_temp.visit(p_technicians bigint[], p_day text, p_window text, p_start text, p_end text)
returns jsonb language sql as $fn$
  select jsonb_build_object(
    'technicianIds', to_jsonb(p_technicians),
    'windowStartsAt', (p_day || ' ' || p_window || ':00-08')::timestamptz,
    'windowEndsAt', (p_day || ' ' || p_window || ':00-08')::timestamptz + interval '2 hours',
    'startsAt', (p_day || ' ' || p_start || ':00-08')::timestamptz,
    'endsAt', (p_day || ' ' || p_end || ':00-08')::timestamptz,
    'pickupMinutes', 10, 'acceptance', 'CUSTOMER_ACCEPTED_PROPOSAL');
$fn$;
create function pg_temp.register(p_actor uuid, p_request bigint, p_expected bigint[], p_visit jsonb)
returns bigint language sql as $fn$
  select (valtrim.register_customer_service_appointment(p_actor, p_request,
    (select updated_at from valtrim.service_requests where id = p_request), p_expected, p_visit, '[]'::jsonb) ->> 'appointmentId')::bigint;
$fn$;
create function pg_temp.move(p_actor uuid, p_visit bigint, p_expected bigint[], p_new jsonb,
  p_reason text default 'CUSTOMER_ASKED', p_note text default null)
returns jsonb language sql as $fn$
  select valtrim.reschedule_customer_service_appointment(p_actor, p_visit,
    (select updated_at from valtrim.service_appointments where id = p_visit),
    (select r.updated_at from valtrim.service_requests r join valtrim.service_appointments a on a.request_id = r.id where a.id = p_visit),
    p_expected, '{}'::bigint[], p_new, '[]'::jsonb, p_reason::valtrim.service_change_reason, p_note);
$fn$;
create function pg_temp.cancel(p_actor uuid, p_visit bigint, p_reason text, p_note text default null,
  p_close boolean default false, p_duplicate_of bigint default null)
returns jsonb language sql as $fn$
  select valtrim.cancel_customer_service_visit(p_actor, p_visit,
    (select updated_at from valtrim.service_appointments where id = p_visit),
    p_reason::valtrim.service_change_reason, p_note, p_close, p_duplicate_of);
$fn$;
create function pg_temp.close(p_actor uuid, p_request bigint, p_reason text, p_note text default null,
  p_duplicate_of bigint default null)
returns jsonb language sql as $fn$
  select valtrim.close_customer_service_request(p_actor, p_request,
    (select updated_at from valtrim.service_requests where id = p_request),
    p_reason::valtrim.service_change_reason, p_note, p_duplicate_of);
$fn$;

update move_fixture set visit_a = pg_temp.register(admin_id, request_a, '{}', pg_temp.visit(array[tech_a], '2030-02-04', '08:00', '08:00', '08:30'));
update move_fixture set visit_b = pg_temp.register(admin_id, request_b, '{}', pg_temp.visit(array[tech_b], '2030-02-04', '10:00', '10:00', '10:30'));
update move_fixture set visit_e = pg_temp.register(admin_id, request_e, '{}', pg_temp.visit(array[tech_b], '2026-01-05', '08:00', '08:00', '08:30'));
select ok(visit_a is not null and visit_b is not null and visit_e is not null, 'Three confirmed visits to work with') from move_fixture;

-- Moving: rejections. Each failed call rolls back as a whole.
select throws_ok(format('select pg_temp.move(%L, %s, %L, pg_temp.visit(array[%s]::bigint[], %L, %L, %L, %L))',
    field_id, visit_a, '{}', tech_a, '2030-02-05', '10:00', '10:00', '10:30'),
  '42501', 'You do not have permission to change Customer Service visits or requests', 'A FIELD user cannot move a visit')
from move_fixture;
select throws_ok(format('select pg_temp.move(%L, %s, %L, pg_temp.visit(array[%s]::bigint[], %L, %L, %L, %L), %L)',
    admin_id, visit_a, '{}', tech_a, '2030-02-05', '10:00', '10:00', '10:30', 'CUSTOMER_CANCELLED'),
  '22023', 'Choose why the visit moves', 'A cancellation reason does not move a visit')
from move_fixture;
select throws_ok(format('select pg_temp.move(%L, %s, %L, pg_temp.visit(array[%s]::bigint[], %L, %L, %L, %L), %L, %L)',
    admin_id, visit_a, '{}', tech_a, '2030-02-05', '10:00', '10:00', '10:30', 'OTHER', '  '),
  '22023', 'Describe the reason in 500 characters or fewer', 'Other needs a note')
from move_fixture;
select throws_ok(format('select valtrim.reschedule_customer_service_appointment(%L, %s, now() - interval %L, (select updated_at from valtrim.service_requests where id = %s), %L, %L, pg_temp.visit(array[%s]::bigint[], %L, %L, %L, %L), %L, %L)',
    admin_id, visit_a, '1 day', request_a, '{}', '{}', tech_a, '2030-02-05', '10:00', '10:00', '10:30', '[]', 'CUSTOMER_ASKED'),
  '40001', 'This visit changed after you opened it. Reload and try again.', 'A stale visit version is rejected')
from move_fixture;
select throws_ok(format('select valtrim.reschedule_customer_service_appointment(%L, %s, (select updated_at from valtrim.service_appointments where id = %s), now() - interval %L, %L, %L, pg_temp.visit(array[%s]::bigint[], %L, %L, %L, %L), %L, %L)',
    admin_id, visit_a, visit_a, '1 day', '{}', '{}', tech_a, '2030-02-05', '10:00', '10:00', '10:30', '[]', 'CUSTOMER_ASKED'),
  '40001', 'This request changed after you opened it. Reload requests and review the plan again.', 'A stale request version is rejected')
from move_fixture;
select throws_ok(format('select pg_temp.move(%L, %s, %L, pg_temp.visit(array[%s]::bigint[], %L, %L, %L, %L))',
    admin_id, visit_a, '{}', tech_b, '2030-02-04', '08:00', '08:00', '08:30'),
  '40001', 'The schedule changed. Review the plan again.', 'A move checked against an outdated day is refused')
from move_fixture;
select throws_ok(format('select pg_temp.move(%L, %s, %L, pg_temp.visit(array[%s]::bigint[], %L, %L, %L, %L))',
    admin_id, visit_e, '{}', tech_b, '2030-02-05', '08:00', '08:00', '08:30'),
  '55000', 'This visit already ended and cannot be moved', 'A visit whose window ended cannot move')
from move_fixture;

-- Moving: the old visit is cancelled with its reason and the new one registered.
update move_fixture set moved_a = (pg_temp.move(admin_id, visit_a, '{}',
  pg_temp.visit(array[tech_a], '2030-02-05', '10:00', '10:00', '10:30')) ->> 'appointmentId')::bigint;
select ok(exists (select 1 from valtrim.service_appointments a, move_fixture f
  where a.id = f.visit_a and a.state = 'CANCELLED' and not a.is_current and a.cancelled_at is not null
    and a.change_reason = 'CUSTOMER_ASKED' and a.cancel_reason = 'Customer asked' and a.updated_by = f.admin_id),
  'The old visit is cancelled with the reason, worded when there is no note');
select ok(exists (select 1 from valtrim.service_appointments a, move_fixture f
  where a.id = f.moved_a and a.is_current and a.state = 'SCHEDULED' and a.rescheduled_from_id = f.visit_a
    and a.accepted_via = 'COORDINATOR' and a.proposal_id is null and a.acceptance = 'CUSTOMER_ACCEPTED_PROPOSAL'
    and a.technician_ids = array[f.tech_a] and a.window_starts_at = timestamptz '2030-02-05 10:00:00-08'
    and a.visit_reminder_sent_at is null and a.created_by = f.admin_id),
  'The new visit is current, points to the old one and waits for its own reminder');
select is((select workflow_stage::text from valtrim.service_requests where id = (select request_a from move_fixture)),
  'CONFIRMED', 'The request stays CONFIRMED');
select ok(exists (select 1 from valtrim.audit_events e, move_fixture f
  where e.entity_id = f.visit_a::text and e.action = 'SERVICE_APPOINTMENT_MOVED' and e.actor_user_id = f.admin_id),
  'The old visit is audited as moved');
select ok(exists (select 1 from valtrim.audit_events e, move_fixture f
  where e.entity_id = f.moved_a::text and e.action = 'SERVICE_APPOINTMENT_RESCHEDULED' and e.actor_user_id = f.admin_id),
  'The new visit is audited as rescheduled');
select is(coalesce(current_setting('valtrim.appointment_change', true), ''), '', 'The move marker does not outlive the move');
select throws_ok(format('select pg_temp.move(%L, %s, %L, pg_temp.visit(array[%s]::bigint[], %L, %L, %L, %L))',
    admin_id, visit_a, '{}', tech_a, '2030-02-05', '08:00', '08:00', '08:30'),
  '55000', 'Only a scheduled visit can be moved', 'A moved visit cannot move again')
from move_fixture;

-- Its own slot is free: the visit moves 15 minutes later in the same window.
select lives_ok(format('select pg_temp.move(%L, %s, %L, pg_temp.visit(array[%s]::bigint[], %L, %L, %L, %L), %L, %L)',
    admin_id, moved_a, '{}', tech_a, '2030-02-05', '10:00', '10:15', '10:45', 'TECHNICIAN_UNAVAILABLE', 'Jorge starts late'),
  'A visit can move within its own window') from move_fixture;
select ok(exists (select 1 from valtrim.service_appointments a, move_fixture f
  where a.id = f.moved_a and a.change_reason = 'TECHNICIAN_UNAVAILABLE' and a.cancel_reason = 'Jorge starts late'),
  'The note is kept as the reason of the replaced visit');
update move_fixture set moved_a = (select id from valtrim.service_appointments a where a.request_id = move_fixture.request_a and a.is_current);

-- A visit under way (WORKING) can still move until its window ends (P2).
update valtrim.service_requests set workflow_stage = 'WORKING' where id = (select request_a from move_fixture);
select lives_ok(format('select pg_temp.move(%L, %s, %L, pg_temp.visit(array[%s]::bigint[], %L, %L, %L, %L), %L)',
    admin_id, moved_a, '{}', tech_a, '2030-02-05', '12:00', '12:00', '12:30', 'WEATHER'),
  'A visit under way moves') from move_fixture;
select is((select workflow_stage::text from valtrim.service_requests where id = (select request_a from move_fixture)),
  'CONFIRMED', 'A request under way waits again for its new window');
update move_fixture set moved_a = (select id from valtrim.service_appointments a where a.request_id = move_fixture.request_a and a.is_current);

-- Cancelling: rejections.
select throws_ok(format('select pg_temp.cancel(%L, %s, %L)', admin_id, visit_b, 'CUSTOMER_ASKED'),
  '22023', 'Choose why the visit is cancelled', 'A move reason does not cancel a visit')
from move_fixture;
select throws_ok(format('select pg_temp.cancel(%L, %s, %L, null, false, %s)', admin_id, visit_b, 'DUPLICATE', request_a),
  '22023', 'A duplicate closes the request', 'A duplicate must close the request')
from move_fixture;
select throws_ok(format('select pg_temp.cancel(%L, %s, %L, null, true)', admin_id, visit_b, 'DUPLICATE'),
  '22023', 'A duplicate needs the original request, and only a duplicate has one', 'A duplicate names the original')
from move_fixture;
select throws_ok(format('select pg_temp.cancel(%L, %s, %L)', admin_id, visit_e, 'CUSTOMER_CANCELLED'),
  '55000', 'This visit already ended and cannot be cancelled', 'A visit whose window ended cannot be cancelled')
from move_fixture;

-- Cancelling live: the request goes back to Ready to propose, open.
update valtrim.service_scheduling_settings set test_mode = false where id = 1;
select lives_ok(format('select pg_temp.cancel(%L, %s, %L)', admin_id, visit_b, 'CUSTOMER_CANCELLED'),
  'A visit is cancelled outside test mode') from move_fixture;
select ok(exists (select 1 from valtrim.service_appointments a, move_fixture f
  where a.id = f.visit_b and a.state = 'CANCELLED' and not a.is_current
    and a.change_reason = 'CUSTOMER_CANCELLED' and a.cancel_reason = 'Customer cancelled'),
  'The cancelled visit keeps its reason');
select ok(exists (select 1 from valtrim.service_requests r, move_fixture f
  where r.id = f.request_b and r.workflow_stage = 'READY_TO_PROPOSE' and r.closed_at is null),
  'Propose another day: the request is ready to propose again');
select ok(exists (select 1 from valtrim.audit_events e, move_fixture f
  where e.entity_id = f.visit_b::text and e.action = 'SERVICE_APPOINTMENT_CANCELLED' and e.actor_user_id = f.admin_id),
  'The cancellation is audited with the coordinator');

-- Cancelling and closing: the Builder cancelled the work.
update move_fixture set visit_b = pg_temp.register(admin_id, request_b, '{}', pg_temp.visit(array[tech_b], '2030-02-04', '10:00', '10:00', '10:30'));
select lives_ok(format('select pg_temp.cancel(%L, %s, %L, %L, true)', admin_id, visit_b, 'BUILDER_CANCELLED', 'PO 1234 cancelled by the superintendent'),
  'A visit is cancelled and its request closed') from move_fixture;
select ok(exists (select 1 from valtrim.service_requests r, move_fixture f
  where r.id = f.request_b and r.closed_at is not null and r.closed_by = f.admin_id
    and r.close_reason_code = 'BUILDER_CANCELLED' and r.close_reason = 'PO 1234 cancelled by the superintendent'
    and r.duplicate_of_request_id is null and r.workflow_stage = 'READY_TO_PROPOSE'),
  'The closed request keeps who, when, the reason and the note');
select ok(exists (select 1 from valtrim.audit_events e, move_fixture f
  where e.entity_type = 'SERVICE_REQUEST' and e.entity_id = f.request_b::text and e.action = 'SERVICE_REQUEST_CLOSED'),
  'Closing is audited');
select throws_ok(format('select pg_temp.register(%L, %s, %L, pg_temp.visit(array[%s]::bigint[], %L, %L, %L, %L))',
    admin_id, request_b, '{}', tech_b, '2030-02-05', '14:00', '14:00', '14:30'),
  '55000', 'Only an open request waiting for a proposal can get an appointment', 'A closed request cannot be scheduled again')
from move_fixture;
update valtrim.service_scheduling_settings set test_mode = true where id = 1;

-- Closing a request without a visit (D2).
select throws_ok(format('select pg_temp.close(%L, %s, %L)', field_id, request_c, 'NOT_VALTRIM_WORK'),
  '42501', 'You do not have permission to change Customer Service visits or requests', 'A FIELD user cannot close a request')
from move_fixture;
select throws_ok(format('select pg_temp.close(%L, %s, %L)', admin_id, request_c, 'WEATHER'),
  '22023', 'Choose why the request closes', 'A move reason does not close a request')
from move_fixture;
select throws_ok(format('select pg_temp.close(%L, %s, %L, null, %s)', admin_id, request_c, 'DUPLICATE', request_c),
  'P0002', 'The original request was not found', 'A request is not a duplicate of itself')
from move_fixture;
select throws_ok(format('select pg_temp.close(%L, %s, %L)', admin_id, request_a, 'NOT_VALTRIM_WORK'),
  '55000', 'This request has a confirmed visit. Cancel the visit and choose Close the request.',
  'A request with a confirmed visit closes from its visit')
from move_fixture;
select lives_ok(format('select pg_temp.close(%L, %s, %L, null, %s)', admin_id, request_c, 'DUPLICATE', request_a),
  'A request is closed as a duplicate') from move_fixture;
select ok(exists (select 1 from valtrim.service_requests r, move_fixture f
  where r.id = f.request_c and r.closed_at is not null and r.close_reason_code = 'DUPLICATE'
    and r.close_reason = 'Duplicate request' and r.duplicate_of_request_id = f.request_a
    and r.workflow_stage = 'READY_TO_PROPOSE'),
  'The duplicate keeps the original request and its stage');
select throws_ok(format('select pg_temp.close(%L, %s, %L)', admin_id, request_c, 'NOT_VALTRIM_WORK'),
  '55000', 'This request is already closed', 'A closed request cannot close again')
from move_fixture;

-- A request waiting for the customer: the system closes its proposal and frees the days.
select lives_ok(format($sql$select valtrim.send_customer_service_proposal(%L, %s,
    (select updated_at from valtrim.service_requests where id = %s), '{}', '{}', 'anelda@valtriminc.com',
    jsonb_build_array(pg_temp.visit(array[%s]::bigint[], '2030-02-05', '14:00', '14:00', '14:30') - 'acceptance'), '[]'::jsonb)$sql$,
    admin_id, request_d, request_d, tech_b),
  'A proposal is sent for the fourth request') from move_fixture;
select lives_ok(format('select pg_temp.close(%L, %s, %L)', admin_id, request_d, 'NOT_VALTRIM_WORK'),
  'A request waiting for the customer is closed') from move_fixture;
select ok(exists (select 1 from valtrim.service_proposals p, move_fixture f
  where p.request_id = f.request_d and p.status = 'CANCELLED' and p.cancelled_at is not null
    and p.cancel_reason = 'Request closed: Not Valtrim work' and p.updated_by = f.admin_id),
  'Its waiting proposal is closed with the reason');
select ok(exists (select 1 from valtrim.service_requests r, move_fixture f
  where r.id = f.request_d and r.closed_at is not null and r.workflow_stage = 'READY_TO_PROPOSE'),
  'The request is closed and no longer waits for the customer');

-- The table keeps closing coherent even outside the RPCs.
select throws_ok(format('update valtrim.service_requests set closed_at = now(), close_reason = %L where id = %s',
    'No code', request_e),
  '23514', null, 'A closed request needs a reason code')
from move_fixture;
select throws_ok(format('update valtrim.service_appointments set change_reason = %L where id = %s', 'WEATHER', moved_a),
  '23514', null, 'Only a cancelled visit has a change reason')
from move_fixture;

select * from finish();
rollback;
