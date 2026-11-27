begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Structure: proposals replace the old confirmation tokens.
select has_table('valtrim', 'service_proposals', 'Sent proposals are stored');
select has_table('valtrim', 'service_proposal_options', 'Each proposal stores its options');
select ok(to_regclass('private.service_confirmation_tokens') is null, 'The unused confirmation tokens are retired');
select has_column('valtrim', 'service_appointments', 'accepted_via', 'Appointments record how they were accepted');
select has_column('valtrim', 'service_appointments', 'proposal_id', 'Appointments link the accepted proposal');
select is((select count(*) from valtrim.service_appointments where accepted_via <> 'COORDINATOR' and proposal_id is null),
  0::bigint, 'Appointments registered before block B were recorded by a coordinator');

-- Privileges: browsers read; the Edge Functions write through the RPCs.
select ok(not has_table_privilege('authenticated', 'valtrim.service_proposals', 'insert'), 'Browsers cannot insert proposals');
select ok(not has_table_privilege('authenticated', 'valtrim.service_proposals', 'update'), 'Browsers cannot update proposals');
select ok(not has_table_privilege('authenticated', 'valtrim.service_proposal_options', 'insert'), 'Browsers cannot insert options');
select ok(not has_function_privilege('authenticated',
  'valtrim.send_customer_service_proposal(uuid,bigint,timestamptz,bigint[],bigint[],text,jsonb,jsonb)', 'execute'),
  'Browsers cannot bypass the Edge Function validation when sending');
select ok(not has_function_privilege('authenticated', 'valtrim.accept_customer_service_proposal(uuid,bigint,bigint)', 'execute'),
  'Browsers cannot accept directly');
select ok(not has_function_privilege('anon', 'valtrim.decline_customer_service_proposal(uuid,bigint,date[],text,text)', 'execute'),
  'The public page cannot decline without the Edge Function');
select ok(has_function_privilege('service_role', 'valtrim.accept_customer_service_proposal(uuid,bigint,bigint)', 'execute'),
  'The Edge Functions can record answers');
select ok(has_function_privilege('authenticated', 'valtrim.cancel_customer_service_proposal(bigint,text)', 'execute'),
  'Signed-in coordinators can call the guarded cancellation');
select ok(not has_function_privilege('anon', 'valtrim.cancel_customer_service_proposal(bigint,text)', 'execute'),
  'Anonymous callers cannot cancel');

-- Fixture: a coordinator, a field user, two ready requests and three technicians.
create temporary table proposal_fixture as select
  gen_random_uuid() as admin_id, gen_random_uuid() as field_id,
  (select job.id from valtrim.jobs job join valtrim.builders builder on builder.id = job.builder_id
   where job.is_active and job.status = 'ACTIVE' and builder.is_active
     and job.community_latitude between -90 and 90 and job.community_longitude between -180 and 180
   order by job.id limit 1) as job_id,
  null::bigint as request_a, null::bigint as request_b, null::bigint as request_c,
  null::bigint as tech_a, null::bigint as tech_b, null::bigint as tech_inactive,
  null::bigint as p1, null::bigint as p2, null::bigint as p3, null::bigint as p4,
  null::bigint as p1_option_1, null::bigint as p1_option_2, null::bigint as p2_option_1, null::bigint as p4_option_1,
  null::bigint as appointment_id, null::bigint as p5_option_1;
insert into auth.users(id, email, raw_user_meta_data)
select admin_id, admin_id::text || '@example.com', '{"name":"Proposal Admin Test"}'::jsonb from proposal_fixture
union all select field_id, field_id::text || '@example.com', '{"name":"Proposal Field Test"}'::jsonb from proposal_fixture;
update valtrim.app_users set role = 'ADMIN' where id = (select admin_id from proposal_fixture);
update valtrim.app_users set role = 'FIELD' where id = (select field_id from proposal_fixture);
select ok(job_id is not null, 'The linked project has a valid active Job') from proposal_fixture;

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
  )) ->> 'requestId')::bigint from proposal_fixture;
$fn$;
select set_config('request.jwt.claim.sub', admin_id::text, true) from proposal_fixture;
update proposal_fixture set request_a = pg_temp.new_request();
update proposal_fixture set request_b = pg_temp.new_request();
update proposal_fixture set request_c = pg_temp.new_request();
select set_config('request.jwt.claim.sub', '', true);
-- Review is covered elsewhere; here the requests only need to be ready to propose.
update valtrim.service_requests set workflow_stage = 'READY_TO_PROPOSE'
where id in (select request_a from proposal_fixture union all select request_b from proposal_fixture
  union all select request_c from proposal_fixture);

with created as (
  insert into valtrim.people (name, email, is_active)
  values ('Proposal Tech A', 'proposal-tech-a-' || gen_random_uuid() || '@example.com', true),
         ('Proposal Tech B', 'proposal-tech-b-' || gen_random_uuid() || '@example.com', true),
         ('Proposal Tech Inactive', 'proposal-tech-x-' || gen_random_uuid() || '@example.com', false)
  returning id, name
), roles as (
  insert into valtrim.person_roles (person_id, role) select id, 'SERVICE_TECHNICIAN' from created returning person_id
)
update proposal_fixture set
  tech_a = (select id from created where name = 'Proposal Tech A'),
  tech_b = (select id from created where name = 'Proposal Tech B'),
  tech_inactive = (select id from created where name = 'Proposal Tech Inactive');

-- Days in California (PST, UTC-8): Mon 14, Tue 15 and Wed 16 Jan 2030, and a past Monday.
create function pg_temp.option(p_technicians bigint[], p_day text, p_window text, p_start text, p_end text)
returns jsonb language sql as $fn$
  select jsonb_build_object(
    'technicianIds', to_jsonb(p_technicians),
    'windowStartsAt', (p_day || ' ' || p_window || ':00-08')::timestamptz,
    'windowEndsAt', (p_day || ' ' || p_window || ':00-08')::timestamptz + interval '2 hours',
    'startsAt', (p_day || ' ' || p_start || ':00-08')::timestamptz,
    'endsAt', (p_day || ' ' || p_end || ':00-08')::timestamptz,
    'pickupMinutes', 10);
$fn$;
create function pg_temp.send(p_actor uuid, p_request bigint, p_appointments bigint[], p_held bigint[], p_options jsonb)
returns jsonb language sql as $fn$
  select valtrim.send_customer_service_proposal(p_actor, p_request,
    (select updated_at from valtrim.service_requests where id = p_request), p_appointments, p_held,
    ' Anelda@ValtrimInc.com ', p_options, '[]'::jsonb);
$fn$;
create function pg_temp.register(p_actor uuid, p_request bigint, p_appointments bigint[], p_held bigint[], p_option jsonb)
returns jsonb language sql as $fn$
  select valtrim.register_customer_service_appointment(p_actor, p_request,
    (select updated_at from valtrim.service_requests where id = p_request), p_appointments,
    p_option || '{"acceptance":"CUSTOMER_ACCEPTED_PROPOSAL"}'::jsonb, '[]'::jsonb, p_held);
$fn$;

-- Sending: rejections. Each failed call rolls back as a whole.
select throws_ok(format('select pg_temp.send(%L, %s, %L, %L, %L)', field_id, request_a, '{}', '{}',
    jsonb_build_array(pg_temp.option(array[tech_a], '2030-01-14', '08:00', '08:00', '08:30'))),
  '42501', 'You do not have permission to send Customer Service proposals', 'A FIELD user cannot send')
from proposal_fixture;
select throws_ok(format('select pg_temp.send(%L, %s, %L, %L, %L)', admin_id, request_a, '{}', '{}',
    jsonb_build_array(pg_temp.option(array[tech_a], '2030-01-14', '08:00', '08:00', '08:30'),
      pg_temp.option(array[tech_a], '2030-01-15', '08:00', '08:00', '08:30'),
      pg_temp.option(array[tech_a], '2030-01-16', '08:00', '08:00', '08:30'))),
  '22023', 'A proposal offers one or two options, each with technicians and a window', 'Three options are refused')
from proposal_fixture;
select throws_ok(format('select pg_temp.send(%L, %s, %L, %L, %L)', admin_id, request_a, '{}', '{}',
    jsonb_build_array(pg_temp.option(array[tech_inactive], '2030-01-14', '08:00', '08:00', '08:30'))),
  '23514', 'Technicians must be distinct, active and have the SERVICE_TECHNICIAN role', 'An inactive technician cannot be offered')
from proposal_fixture;
select throws_ok(format('select pg_temp.send(%L, %s, %L, %L, %L)', admin_id, request_a, '{}', '{}',
    jsonb_build_array(pg_temp.option(array[tech_a], '2030-01-14', '08:00', '09:30', '09:55'))),
  '23514', null, 'Work plus pickup must end by the window close')
from proposal_fixture;
select throws_ok(format('select valtrim.send_customer_service_proposal(%L, %s, now() - interval %L, %L, %L, %L, %L, %L)',
    admin_id, request_a, '1 day', '{}', '{}', 'anelda@valtriminc.com',
    jsonb_build_array(pg_temp.option(array[tech_a], '2030-01-14', '08:00', '08:00', '08:30')), '[]'),
  '40001', 'This request changed after you opened it. Reload requests and review the plan again.', 'A stale request version is rejected')
from proposal_fixture;

-- Sending two days holds both and waits for the customer.
update proposal_fixture set p1 = (pg_temp.send(admin_id, request_a, '{}', '{}', jsonb_build_array(
  pg_temp.option(array[tech_a], '2030-01-14', '08:00', '08:00', '08:30'),
  pg_temp.option(array[tech_a], '2030-01-15', '08:00', '08:00', '08:30'))) ->> 'proposalId')::bigint;
update proposal_fixture set
  p1_option_1 = (select id from valtrim.service_proposal_options where proposal_id = p1 and option_number = 1),
  p1_option_2 = (select id from valtrim.service_proposal_options where proposal_id = p1 and option_number = 2);
select ok(exists (select 1 from valtrim.service_proposals p, proposal_fixture f
  where p.id = f.p1 and p.request_id = f.request_a and p.status = 'SENT' and p.sender_mailbox = 'anelda@valtriminc.com'
    and p.created_by = f.admin_id and p.responded_at is null and p.public_id is not null),
  'The proposal is stored as sent from the coordinator''s mailbox');
select ok(p1_option_1 is not null and p1_option_2 is not null, 'Both options are stored in order') from proposal_fixture;
select is((select workflow_stage::text from valtrim.service_requests where id = (select request_a from proposal_fixture)),
  'AWAITING_CUSTOMER', 'The request waits for the customer');
select ok(exists (select 1 from valtrim.service_request_workflow_history h, proposal_fixture f
  where h.request_id = f.request_a and h.new_stage = 'AWAITING_CUSTOMER' and h.changed_by = f.admin_id),
  'The stage change is recorded for the coordinator');
-- The sent event is written at commit, once the options exist.
set constraints all immediate;
set constraints all deferred;
select ok(exists (select 1 from valtrim.audit_events e, proposal_fixture f
  where e.entity_type = 'SERVICE_PROPOSAL' and e.entity_id = f.p1::text and e.action = 'SERVICE_PROPOSAL_SENT'
    and e.actor_user_id = f.admin_id and jsonb_array_length(e.new_values -> 'options') = 2),
  'Sending is audited with the coordinator and both options');
select throws_ok(format('select pg_temp.send(%L, %s, %L, %L, %L)', admin_id, request_a, '{}', '{}',
    jsonb_build_array(pg_temp.option(array[tech_b], '2030-01-16', '08:00', '08:00', '08:30'))),
  '55000', 'This request already has a proposal waiting for the customer. Cancel it before sending another.',
  'A request waits on one proposal at a time')
from proposal_fixture;

-- A held option counts like an appointment: a plan validated without it is refused.
select throws_ok(format('select pg_temp.send(%L, %s, %L, %L, %L)', admin_id, request_b, '{}', '{}',
    jsonb_build_array(pg_temp.option(array[tech_a], '2030-01-14', '10:00', '10:00', '10:30'))),
  '40001', 'The schedule changed. Review the plan again.', 'A plan that ignores a held option is refused')
from proposal_fixture;
select throws_ok(format('select pg_temp.register(%L, %s, %L, %L, %L)', admin_id, request_b, '{}', '{}',
    pg_temp.option(array[tech_a], '2030-01-14', '10:00', '10:00', '10:30')),
  '40001', 'The schedule changed. Review the plan again.', 'Registering also counts held options')
from proposal_fixture;
select throws_ok(format('select pg_temp.register(%L, %s, %L, %L, %L)', admin_id, request_a, '{}', '{}',
    pg_temp.option(array[tech_b], '2030-01-16', '08:00', '08:00', '08:30')),
  '55000', 'This request has a proposal waiting for the customer. Record the customer''s answer or cancel the proposal first.',
  'A request waiting on its proposal cannot be registered around it')
from proposal_fixture;
update proposal_fixture set p2 = (pg_temp.send(admin_id, request_b, '{}', array[p1_option_1],
  jsonb_build_array(pg_temp.option(array[tech_a], '2030-01-14', '10:00', '10:00', '10:30'))) ->> 'proposalId')::bigint;
update proposal_fixture set p2_option_1 = (select id from valtrim.service_proposal_options where proposal_id = p2);
select ok(p2 is not null, 'A plan validated with the held option is sent') from proposal_fixture;
select is((select array_agg(option_id order by option_id) from valtrim.service_proposal_holds
    where request_id in (select request_a from proposal_fixture union all select request_b from proposal_fixture)),
  (select array[p1_option_1, p1_option_2, p2_option_1] from proposal_fixture),
  'The holds view lists every option of the proposals waiting for the customer');

-- Accepting through the link.
select throws_ok(format('select valtrim.accept_customer_service_proposal(%L, %s, %s)', field_id, p1, p1_option_2),
  '42501', 'You do not have permission to record Customer Service proposal answers', 'A FIELD user cannot record an answer')
from proposal_fixture;
select throws_ok(format('select valtrim.accept_customer_service_proposal(null, %s, %s)', p1, p2_option_1),
  'P0002', 'This option is not part of the proposal', 'An option of another proposal cannot be accepted')
from proposal_fixture;
update proposal_fixture set appointment_id = (valtrim.accept_customer_service_proposal(null, p1, p1_option_2) ->> 'appointmentId')::bigint;
select ok(exists (select 1 from valtrim.service_appointments a, proposal_fixture f
  where a.id = f.appointment_id and a.request_id = f.request_a and a.proposal_id = f.p1
    and a.accepted_via = 'CUSTOMER_LINK' and a.acceptance = 'CUSTOMER_ACCEPTED_PROPOSAL'
    and a.technician_ids = array[f.tech_a] and a.is_current and a.state = 'SCHEDULED' and a.created_by is null
    and a.window_starts_at = timestamptz '2030-01-15 08:00:00-08' and a.ends_at = timestamptz '2030-01-15 08:30:00-08'),
  'The chosen option becomes the appointment, accepted through the link');
select ok(exists (select 1 from valtrim.service_proposals p, proposal_fixture f
  where p.id = f.p1 and p.status = 'ACCEPTED' and p.accepted_option_id = f.p1_option_2
    and p.response_via = 'CUSTOMER_LINK' and p.responded_at is not null and p.updated_by is null),
  'The proposal records the accepted option and the link');
select is((select workflow_stage::text from valtrim.service_requests where id = (select request_a from proposal_fixture)),
  'CONFIRMED', 'The request becomes CONFIRMED');
select is((select count(*) from valtrim.service_proposal_holds where proposal_id = (select p1 from proposal_fixture)),
  0::bigint, 'An answered proposal holds nothing');
select ok(exists (select 1 from valtrim.service_request_workflow_history h, proposal_fixture f
  where h.request_id = f.request_a and h.new_stage = 'CONFIRMED' and h.changed_by is null),
  'The customer''s answer is not credited to the coordinator');
select ok(exists (select 1 from valtrim.audit_events e, proposal_fixture f
  where e.entity_type = 'SERVICE_PROPOSAL' and e.entity_id = f.p1::text and e.action = 'SERVICE_PROPOSAL_ACCEPTED'
    and e.actor_type = 'SYSTEM' and e.actor_user_id is null and e.actor_name = 'Customer (proposal link)'),
  'Acceptance is audited as the customer''s');
select ok(exists (select 1 from valtrim.audit_events e, proposal_fixture f
  where e.entity_type = 'SERVICE_APPOINTMENT' and e.entity_id = f.appointment_id::text
    and e.action = 'SERVICE_APPOINTMENT_REGISTERED' and e.actor_type = 'SYSTEM'
    and e.new_values ->> 'accepted_via' = 'CUSTOMER_LINK'),
  'The appointment audit records how it was accepted');
select is((valtrim.accept_customer_service_proposal(null, p1, p1_option_2) ->> 'appointmentId')::bigint, appointment_id,
  'A repeated click returns the same appointment')
from proposal_fixture;
select throws_ok(format('select valtrim.accept_customer_service_proposal(null, %s, %s)', p1, p1_option_1),
  '55000', 'This proposal was already answered or cancelled', 'The other option cannot be accepted afterwards')
from proposal_fixture;

-- Counter-proposal recorded by a coordinator after a call.
select throws_ok(format('select valtrim.decline_customer_service_proposal(%L, %s, %L, null, null)',
    admin_id, p2, '{2030-01-20,2030-01-21,2030-01-22,2030-01-23}'),
  '22023', 'Choose one to three different dates from today on', 'At most three dates')
from proposal_fixture;
select throws_ok(format('select valtrim.decline_customer_service_proposal(%L, %s, %L, null, null)',
    admin_id, p2, '{2020-01-20}'),
  '22023', 'Choose one to three different dates from today on', 'Dates cannot be in the past')
from proposal_fixture;
select throws_ok(format('select valtrim.decline_customer_service_proposal(%L, %s, %L, %L, null)',
    admin_id, p2, '{2030-01-20}', 'EVENING'),
  '22023', 'Choose morning, midday or afternoon', 'The part of the day is one of three')
from proposal_fixture;
select throws_ok(format('select valtrim.decline_customer_service_proposal(%L, %s, null, %L, null)', admin_id, p2, 'MORNING'),
  '22023', 'A part of the day goes with counter-proposed dates', 'A rejection has no part of the day')
from proposal_fixture;
select lives_ok(format('select valtrim.decline_customer_service_proposal(%L, %s, %L, %L, %L)',
    admin_id, p2, '{2030-01-21,2030-01-20}', 'MORNING', 'Mornings only, please'),
  'A coordinator records a counter-proposal')
from proposal_fixture;
select ok(exists (select 1 from valtrim.service_proposals p, proposal_fixture f
  where p.id = f.p2 and p.status = 'COUNTER_PROPOSED' and p.counter_dates = '{2030-01-20,2030-01-21}'::date[]
    and p.counter_day_part = 'MORNING' and p.customer_note = 'Mornings only, please'
    and p.response_via = 'COORDINATOR' and p.updated_by = f.admin_id),
  'The counter-proposal keeps the sorted dates, the part of the day and the note');
select is((select workflow_stage::text from valtrim.service_requests where id = (select request_b from proposal_fixture)),
  'READY_TO_PROPOSE', 'A counter-proposal returns the request to Ready to propose');
select ok(exists (select 1 from valtrim.audit_events e, proposal_fixture f
  where e.entity_id = f.p2::text and e.action = 'SERVICE_PROPOSAL_COUNTER_PROPOSED' and e.actor_user_id = f.admin_id),
  'The counter-proposal is audited with the coordinator');

select throws_ok(format('select pg_temp.send(%L, %s, %L, %L, %L)', admin_id, request_b, '{}', '{}',
    jsonb_build_array(pg_temp.option(array[tech_a], '2030-01-15', '10:00', '10:00', '10:30'))),
  '40001', 'The schedule changed. Review the plan again.', 'The accepted day now counts as an appointment')
from proposal_fixture;

-- The released options no longer hold anyone: the same plan now needs no expected holds.
update proposal_fixture set p3 = (pg_temp.send(admin_id, request_b, '{}', '{}',
  jsonb_build_array(pg_temp.option(array[tech_a], '2030-01-14', '10:00', '10:00', '10:30'))) ->> 'proposalId')::bigint;
select ok(p3 is not null, 'Answered proposals release their options') from proposal_fixture;

-- Rejection through the link.
select lives_ok(format('select valtrim.decline_customer_service_proposal(null, %s, null, null, %L)', p3, 'Not needed anymore'),
  'The customer rejects through the link')
from proposal_fixture;
select ok(exists (select 1 from valtrim.service_proposals p, proposal_fixture f
  where p.id = f.p3 and p.status = 'REJECTED' and p.response_via = 'CUSTOMER_LINK'
    and p.customer_note = 'Not needed anymore' and p.counter_dates is null),
  'The rejection and its note are stored');
select is((select workflow_stage::text from valtrim.service_requests where id = (select request_b from proposal_fixture)),
  'NEEDS_CONTACT', 'A rejection moves the request to Needs contact');
select is((valtrim.decline_customer_service_proposal(null, p3, null, null, null) ->> 'alreadyRecorded')::boolean, true,
  'A repeated rejection returns the first answer')
from proposal_fixture;
select throws_ok(format('select valtrim.decline_customer_service_proposal(null, %s, %L, null, null)', p3, '{2030-01-20}'),
  '55000', 'This proposal was already answered or cancelled', 'A rejected proposal cannot be counter-proposed')
from proposal_fixture;

-- A day that already passed cannot be accepted; the coordinator cancels instead.
update proposal_fixture set p4 = (pg_temp.send(admin_id, request_b, '{}', '{}',
  jsonb_build_array(pg_temp.option(array[tech_b], '2020-01-13', '08:00', '08:00', '08:30'))) ->> 'proposalId')::bigint;
update proposal_fixture set p4_option_1 = (select id from valtrim.service_proposal_options where proposal_id = p4);
select throws_ok(format('select valtrim.accept_customer_service_proposal(null, %s, %s)', p4, p4_option_1),
  '55000', 'This day has already started or passed', 'A passed day cannot be accepted')
from proposal_fixture;

-- Row-level security and the guarded cancellation.
grant select on proposal_fixture to authenticated;
select set_config('request.jwt.claim.sub', field_id::text, true) from proposal_fixture;
set local role authenticated;
select is((select count(*) from valtrim.service_proposals where request_id in
  (select request_a from proposal_fixture union all select request_b from proposal_fixture)), 0::bigint,
  'Field users cannot read proposals');
select is((select count(*) from valtrim.service_proposal_options where proposal_id = (select p1 from proposal_fixture)),
  0::bigint, 'Field users cannot read options');
select is((select count(*) from valtrim.service_proposal_holds where proposal_id = (select p4 from proposal_fixture)),
  0::bigint, 'Field users cannot read holds');
select throws_ok(format('select valtrim.cancel_customer_service_proposal(%s, %L)', p4, 'Day passed'),
  '42501', 'You do not have permission to manage Customer Service requests', 'Field users cannot cancel')
from proposal_fixture;
reset role;
select set_config('request.jwt.claim.sub', admin_id::text, true) from proposal_fixture;
set local role authenticated;
select is((select count(*) from valtrim.service_proposals where request_id in
  (select request_a from proposal_fixture union all select request_b from proposal_fixture)), 4::bigint,
  'Coordinators read proposals');
select is((select count(*) from valtrim.service_proposal_options where proposal_id = (select p1 from proposal_fixture)),
  2::bigint, 'Coordinators read options');
select is((select count(*) from valtrim.service_proposal_holds where proposal_id = (select p4 from proposal_fixture)),
  1::bigint, 'Coordinators read holds');
select throws_ok($$update valtrim.service_proposals set customer_note = 'x' where id = (select p4 from proposal_fixture)$$,
  '42501', null, 'Coordinators cannot update proposals directly');
select throws_ok(format('select valtrim.cancel_customer_service_proposal(%s, %L)', p4, '  '),
  '22023', 'Enter a cancellation reason of 500 characters or fewer', 'A reason is required')
from proposal_fixture;
select lives_ok(format('select valtrim.cancel_customer_service_proposal(%s, %L)', p4, 'Both days passed without an answer'),
  'A coordinator cancels with a reason')
from proposal_fixture;
select throws_ok(format('select valtrim.cancel_customer_service_proposal(%s, %L)', p4, 'Again'),
  '55000', 'Only a proposal waiting for the customer can be cancelled', 'A cancelled proposal cannot be cancelled again')
from proposal_fixture;
reset role;
select ok(exists (select 1 from valtrim.service_proposals p, proposal_fixture f
  where p.id = f.p4 and p.status = 'CANCELLED' and p.cancelled_at is not null
    and p.cancel_reason = 'Both days passed without an answer' and p.updated_by = f.admin_id),
  'The cancelled proposal keeps its reason');
select is((select workflow_stage::text from valtrim.service_requests where id = (select request_b from proposal_fixture)),
  'READY_TO_PROPOSE', 'Cancelling returns the request to Ready to propose');
select ok(exists (select 1 from valtrim.audit_events e, proposal_fixture f
  where e.entity_id = f.p4::text and e.action = 'SERVICE_PROPOSAL_CANCELLED' and e.actor_user_id = f.admin_id),
  'Cancellation is audited');

-- A registration validated with the held option goes through, next to it.
update proposal_fixture set p5_option_1 = (pg_temp.send(admin_id, request_b, '{}', '{}',
  jsonb_build_array(pg_temp.option(array[tech_a], '2030-01-16', '08:00', '08:00', '08:30'))) -> 'optionIds' ->> 0)::bigint;
select throws_ok(format('select pg_temp.register(%L, %s, %L, %L, %L)', admin_id, request_c, '{}', '{}',
    pg_temp.option(array[tech_a], '2030-01-16', '10:00', '10:00', '10:30')),
  '40001', 'The schedule changed. Review the plan again.', 'A registration that ignores the held option is refused')
from proposal_fixture;
select lives_ok(format('select pg_temp.register(%L, %s, %L, %L, %L)', admin_id, request_c, '{}', array[p5_option_1],
    pg_temp.option(array[tech_a], '2030-01-16', '10:00', '10:00', '10:30')),
  'A registration validated with the held option is stored')
from proposal_fixture;

select * from finish();
rollback;
