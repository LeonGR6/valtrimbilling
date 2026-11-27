begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Review of the email flow (23 Nov 2026): cancelling only in test mode, proposals the
-- system closes, coordinator notices and the visit reminder.

-- Privileges: the system's writes belong to the Edge Functions.
select ok(has_function_privilege('service_role', 'valtrim.close_customer_service_proposal(bigint, text, boolean)', 'execute'),
  'Edge Functions can close a proposal');
select ok(not has_function_privilege('authenticated', 'valtrim.close_customer_service_proposal(bigint, text, boolean)', 'execute'),
  'Browsers cannot close a proposal as the system');
select ok(not has_function_privilege('anon', 'valtrim.close_customer_service_proposal(bigint, text, boolean)', 'execute'),
  'Anonymous callers cannot close a proposal');
select ok(has_function_privilege('service_role', 'valtrim.mark_customer_service_proposal_notices(text, bigint[])', 'execute'),
  'Edge Functions can claim coordinator notices');
select ok(not has_function_privilege('authenticated', 'valtrim.mark_customer_service_proposal_notices(text, bigint[])', 'execute'),
  'Browsers cannot claim coordinator notices');
select ok(has_function_privilege('service_role', 'valtrim.mark_customer_service_visit_reminders(bigint[])', 'execute'),
  'Edge Functions can claim visit reminders');
select ok(not has_function_privilege('authenticated', 'valtrim.mark_customer_service_visit_reminders(bigint[])', 'execute'),
  'Browsers cannot claim visit reminders');
select ok(not has_function_privilege('anon', 'valtrim.mark_customer_service_visit_reminders(bigint[])', 'execute'),
  'Anonymous callers cannot claim visit reminders');
select is((select test_mode from valtrim.service_scheduling_settings where id = 1), true,
  'Customer Service starts in test mode');
select is((select schedule from cron.job where jobname = 'customer-service-visit-reminders'), '*/15 * * * *',
  'Visit reminders are checked every 15 minutes');
-- Read from the catalog: a new enum value cannot be used in the transaction that adds it.
select ok(exists (
    select 1 from pg_catalog.pg_enum label join pg_catalog.pg_type type on type.oid = label.enumtypid
    join pg_catalog.pg_namespace schema on schema.oid = type.typnamespace
    where schema.nspname = 'valtrim' and type.typname = 'service_communication_type'
      and label.enumlabel = 'COORDINATOR_NOTICE'),
  'Coordinator notices are a kind of communication');

-- Fixture: a coordinator, four ready requests, one technician, four proposals.
create temporary table review_fixture as select
  gen_random_uuid() as admin_id,
  (select job.id from valtrim.jobs job join valtrim.builders builder on builder.id = job.builder_id
   where job.is_active and job.status = 'ACTIVE' and builder.is_active
     and job.community_latitude between -90 and 90 and job.community_longitude between -180 and 180
   order by job.id limit 1) as job_id,
  null::bigint as request_a, null::bigint as request_b, null::bigint as request_c, null::bigint as request_d,
  null::bigint as tech_id, null::bigint as future_id, null::bigint as passed_id, null::bigint as notice_id,
  null::bigint as accepted_id, null::bigint as appointment_id;
insert into auth.users(id, email, raw_user_meta_data)
select admin_id, admin_id::text || '@example.com', '{"name":"Review Admin Test"}'::jsonb from review_fixture;
update valtrim.app_users set role = 'ADMIN' where id = (select admin_id from review_fixture);

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
  )) ->> 'requestId')::bigint from review_fixture;
$fn$;
select set_config('request.jwt.claim.sub', admin_id::text, true) from review_fixture;
update review_fixture set request_a = pg_temp.new_request();
update review_fixture set request_b = pg_temp.new_request();
update review_fixture set request_c = pg_temp.new_request();
update review_fixture set request_d = pg_temp.new_request();
select set_config('request.jwt.claim.sub', '', true);
update valtrim.service_requests set workflow_stage = 'READY_TO_PROPOSE'
where id in (select unnest(array[request_a, request_b, request_c, request_d]) from review_fixture);

with created as (
  insert into valtrim.people (name, email, is_active)
  values ('Review Tech', 'review-tech-' || gen_random_uuid() || '@example.com', true)
  returning id
), roles as (
  insert into valtrim.person_roles (person_id, role) select id, 'SERVICE_TECHNICIAN' from created returning person_id
)
update review_fixture set tech_id = (select id from created);

-- One day each, 8:00 AM in California (PST, UTC-8), in January 2030.
create function pg_temp.send(p_actor uuid, p_request bigint, p_day text) returns bigint language sql as $fn$
  select (valtrim.send_customer_service_proposal(p_actor, p_request,
    (select updated_at from valtrim.service_requests where id = p_request), '{}', '{}', 'anelda@valtriminc.com',
    jsonb_build_array(jsonb_build_object(
      'technicianIds', jsonb_build_array((select tech_id from review_fixture)),
      'windowStartsAt', (p_day || ' 08:00:00-08')::timestamptz,
      'windowEndsAt', (p_day || ' 10:00:00-08')::timestamptz,
      'startsAt', (p_day || ' 08:00:00-08')::timestamptz,
      'endsAt', (p_day || ' 08:30:00-08')::timestamptz,
      'pickupMinutes', 10)),
    '[]'::jsonb) ->> 'proposalId')::bigint;
$fn$;
update review_fixture set future_id = pg_temp.send(admin_id, request_a, '2030-01-14');
update review_fixture set passed_id = pg_temp.send(admin_id, request_b, '2030-01-15');
update review_fixture set notice_id = pg_temp.send(admin_id, request_c, '2030-01-16');
update review_fixture set accepted_id = pg_temp.send(admin_id, request_d, '2030-01-17');
-- Every offered day of this one has started: moved 20 years back.
update valtrim.service_proposal_options
set window_starts_at = window_starts_at - interval '20 years', window_ends_at = window_ends_at - interval '20 years',
    starts_at = starts_at - interval '20 years', ends_at = ends_at - interval '20 years'
where proposal_id = (select passed_id from review_fixture);
update review_fixture set appointment_id = (valtrim.accept_customer_service_proposal(admin_id, accepted_id,
  (select id from valtrim.service_proposal_options where proposal_id = accepted_id)) ->> 'appointmentId')::bigint;

-- The system closes a proposal. "Days passed" refuses one that still offers a future day.
select throws_ok(format('select valtrim.close_customer_service_proposal(%s, %L, true)', future_id, 'Days passed'), '55000',
  'This proposal still offers a day that has not started', 'A proposal with a day ahead is not closed as passed')
from review_fixture;
select is((valtrim.close_customer_service_proposal(passed_id, 'Every offered day passed', true) ->> 'alreadyClosed')::boolean,
  false, 'A proposal whose days all passed is closed') from review_fixture;
select is((select array[proposal.status::text, request.workflow_stage::text, proposal.cancel_reason::text]
    from valtrim.service_proposals proposal join valtrim.service_requests request on request.id = proposal.request_id
    where proposal.id = passed_id),
  array['CANCELLED', 'READY_TO_PROPOSE', 'Every offered day passed'],
  'The proposal is closed with its reason and the request can be planned again') from review_fixture;
select is((select array[actor_type::text, actor_name::text] from valtrim.audit_events
    where action = 'SERVICE_PROPOSAL_CANCELLED' and entity_id = passed_id::text),
  array['SYSTEM', 'System'], 'The system closed it, not a coordinator') from review_fixture;
select is((valtrim.close_customer_service_proposal(passed_id, 'Again', true) ->> 'alreadyClosed')::boolean, true,
  'Closing twice keeps the first result') from review_fixture;
select throws_ok(format('select valtrim.close_customer_service_proposal(%s, %L)', accepted_id, 'Late'), '55000',
  'This proposal was already answered', 'An answered proposal is never closed') from review_fixture;
select throws_ok('select valtrim.close_customer_service_proposal(-1, ''Missing'')', 'P0002',
  'The proposal was not found', 'An unknown proposal is reported');
select throws_ok(format('select valtrim.close_customer_service_proposal(%s, %L)', future_id, ' '), '22023',
  'Enter a closing reason of 500 characters or fewer', 'A closing reason is required') from review_fixture;
select is(current_setting('valtrim.system_actor', true), '', 'The system actor is switched off again');

-- Coordinator notices: once per proposal and kind, only while it waits.
select is(valtrim.mark_customer_service_proposal_notices('BUILDER_CALL', array[notice_id, passed_id]), array[notice_id],
  'Only the waiting proposal gets the Builder call email') from review_fixture;
select is(valtrim.mark_customer_service_proposal_notices('BUILDER_CALL', array[notice_id]), '{}'::bigint[],
  'A second run never sends it again') from review_fixture;
select is(valtrim.mark_customer_service_proposal_notices('DAYS_PASSED', array[notice_id]), array[notice_id],
  'Days passed is claimed on its own') from review_fixture;
select is((select builder_call_notified_at is not null and days_passed_notified_at is not null
    from valtrim.service_proposals where id = notice_id), true, 'Both times are stored') from review_fixture;
select throws_ok('select valtrim.mark_customer_service_proposal_notices(''OTHER'', array[1]::bigint[])', '22023',
  'Unknown proposal notice', 'Only the known notices are claimed');
select is(valtrim.mark_customer_service_proposal_notices('DAYS_PASSED', '{}'), '{}'::bigint[], 'Nothing listed, nothing marked');

-- Visit reminder: once per current scheduled appointment.
select is(valtrim.mark_customer_service_visit_reminders(array[appointment_id]), array[appointment_id],
  'The visit reminder is claimed') from review_fixture;
select is(valtrim.mark_customer_service_visit_reminders(array[appointment_id]), '{}'::bigint[],
  'A second run never reminds the same visit again') from review_fixture;
select is(current_setting('valtrim.system_actor', true), '', 'The system actor is switched off after the claim');

-- Cancelling a proposal: allowed in test mode only, in the database too. A visit is cancelled
-- live since the Reschedule block (27 Nov 2026), through the Edge Function's RPC.
update valtrim.service_scheduling_settings set test_mode = false where id = 1;
select set_config('request.jwt.claim.sub', admin_id::text, true) from review_fixture;
select throws_ok(format('select valtrim.cancel_customer_service_proposal(%s, %L)', future_id, 'Test'), '55000',
  'A sent proposal cannot be cancelled. Record the customer''s answer instead.',
  'Outside test mode a sent proposal cannot be cancelled') from review_fixture;
select set_config('request.jwt.claim.sub', '', true);
update valtrim.service_scheduling_settings set test_mode = true where id = 1;
select set_config('request.jwt.claim.sub', admin_id::text, true) from review_fixture;
select is((valtrim.cancel_customer_service_proposal(future_id, 'Test cleanup') ->> 'proposalId')::bigint, future_id,
  'In test mode a coordinator still cancels a proposal') from review_fixture;
select is((valtrim.cancel_customer_service_visit(admin_id, appointment_id,
    (select updated_at from valtrim.service_appointments where id = appointment_id), 'OTHER', 'Test cleanup') ->> 'appointmentId')::bigint,
  appointment_id, 'A coordinator cancels the visit') from review_fixture;
select set_config('request.jwt.claim.sub', '', true);
select is(valtrim.mark_customer_service_visit_reminders(array[appointment_id]), '{}'::bigint[],
  'A cancelled visit is never reminded') from review_fixture;

select * from finish();
rollback;
