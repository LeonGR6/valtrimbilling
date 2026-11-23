begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Block B, step B7: the 24-hour reminder claim and "Builder contacted".

-- Privileges: the reminder claim is the Edge Function's; the coordinator records the call.
select ok(has_function_privilege('service_role', 'valtrim.mark_customer_service_proposal_reminders(bigint[])', 'execute'),
  'The reminder Edge Function can claim reminders');
select ok(not has_function_privilege('authenticated', 'valtrim.mark_customer_service_proposal_reminders(bigint[])', 'execute'),
  'Browsers cannot mark reminders');
select ok(not has_function_privilege('anon', 'valtrim.mark_customer_service_proposal_reminders(bigint[])', 'execute'),
  'Anonymous callers cannot mark reminders');
select ok(has_function_privilege('authenticated', 'valtrim.mark_customer_service_proposal_builder_contacted(bigint)', 'execute'),
  'Signed-in coordinators can record the Builder call');
select ok(not has_function_privilege('anon', 'valtrim.mark_customer_service_proposal_builder_contacted(bigint)', 'execute'),
  'Anonymous callers cannot record the Builder call');
select is((select schedule from cron.job where jobname = 'customer-service-proposal-reminders'), '*/15 * * * *',
  'Reminders are checked every 15 minutes');

-- Fixture: a coordinator, a field user, two ready requests, one technician, two proposals.
create temporary table follow_up_fixture as select
  gen_random_uuid() as admin_id, gen_random_uuid() as field_id,
  (select job.id from valtrim.jobs job join valtrim.builders builder on builder.id = job.builder_id
   where job.is_active and job.status = 'ACTIVE' and builder.is_active
     and job.community_latitude between -90 and 90 and job.community_longitude between -180 and 180
   order by job.id limit 1) as job_id,
  null::bigint as request_a, null::bigint as request_b, null::bigint as tech_id,
  null::bigint as sent_id, null::bigint as cancelled_id;
insert into auth.users(id, email, raw_user_meta_data)
select admin_id, admin_id::text || '@example.com', '{"name":"Follow-up Admin Test"}'::jsonb from follow_up_fixture
union all select field_id, field_id::text || '@example.com', '{"name":"Follow-up Field Test"}'::jsonb from follow_up_fixture;
update valtrim.app_users set role = 'ADMIN' where id = (select admin_id from follow_up_fixture);
update valtrim.app_users set role = 'FIELD' where id = (select field_id from follow_up_fixture);

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
  )) ->> 'requestId')::bigint from follow_up_fixture;
$fn$;
select set_config('request.jwt.claim.sub', admin_id::text, true) from follow_up_fixture;
update follow_up_fixture set request_a = pg_temp.new_request();
update follow_up_fixture set request_b = pg_temp.new_request();
select set_config('request.jwt.claim.sub', '', true);
update valtrim.service_requests set workflow_stage = 'READY_TO_PROPOSE'
where id in (select request_a from follow_up_fixture union all select request_b from follow_up_fixture);

with created as (
  insert into valtrim.people (name, email, is_active)
  values ('Follow-up Tech', 'follow-up-tech-' || gen_random_uuid() || '@example.com', true)
  returning id
), roles as (
  insert into valtrim.person_roles (person_id, role) select id, 'SERVICE_TECHNICIAN' from created returning person_id
)
update follow_up_fixture set tech_id = (select id from created);

-- Mon 14 and Tue 15 Jan 2030, 8:00 AM in California (PST, UTC-8).
create function pg_temp.send(p_actor uuid, p_request bigint, p_day text) returns bigint language sql as $fn$
  select (valtrim.send_customer_service_proposal(p_actor, p_request,
    (select updated_at from valtrim.service_requests where id = p_request), '{}', '{}', 'anelda@valtriminc.com',
    jsonb_build_array(jsonb_build_object(
      'technicianIds', jsonb_build_array((select tech_id from follow_up_fixture)),
      'windowStartsAt', (p_day || ' 08:00:00-08')::timestamptz,
      'windowEndsAt', (p_day || ' 10:00:00-08')::timestamptz,
      'startsAt', (p_day || ' 08:00:00-08')::timestamptz,
      'endsAt', (p_day || ' 08:30:00-08')::timestamptz,
      'pickupMinutes', 10)),
    '[]'::jsonb) ->> 'proposalId')::bigint;
$fn$;
update follow_up_fixture set sent_id = pg_temp.send(admin_id, request_a, '2030-01-14');
update follow_up_fixture set cancelled_id = pg_temp.send(admin_id, request_b, '2030-01-15');
select set_config('request.jwt.claim.sub', admin_id::text, true) from follow_up_fixture;
select valtrim.cancel_customer_service_proposal(cancelled_id, 'Follow-up test') from follow_up_fixture;
select set_config('request.jwt.claim.sub', '', true);

-- Reminder claim: once per proposal, only while it waits, credited to the system.
select is(valtrim.mark_customer_service_proposal_reminders('{}'), '{}'::bigint[], 'Nothing listed, nothing marked');
select is(valtrim.mark_customer_service_proposal_reminders(array[sent_id, cancelled_id]), array[sent_id],
  'Only the proposal still waiting is marked') from follow_up_fixture;
select ok((select reminder_sent_at is not null from valtrim.service_proposals where id = sent_id),
  'The reminder time is stored') from follow_up_fixture;
select is(valtrim.mark_customer_service_proposal_reminders(array[sent_id]), '{}'::bigint[],
  'A second run never reminds the same proposal again') from follow_up_fixture;
select is((select reminder_sent_at from valtrim.service_proposals where id = cancelled_id), null,
  'A cancelled proposal is never reminded') from follow_up_fixture;
select is((select array[actor_type::text, actor_name::text] from valtrim.audit_events
    where action = 'SERVICE_PROPOSAL_REMINDER_SENT' and entity_id = sent_id::text),
  array['SYSTEM', 'System'], 'The reminder is the system''s, not the coordinator''s') from follow_up_fixture;
select is(current_setting('valtrim.system_actor', true), '', 'The system actor is switched off again') ;

-- Builder contacted: a coordinator records it once; a field user cannot.
select set_config('request.jwt.claim.sub', field_id::text, true) from follow_up_fixture;
select throws_ok(format('select valtrim.mark_customer_service_proposal_builder_contacted(%s)', sent_id), '42501',
  'You do not have permission to manage Customer Service requests', 'A FIELD user cannot record the Builder call')
from follow_up_fixture;
select set_config('request.jwt.claim.sub', admin_id::text, true) from follow_up_fixture;
select is((valtrim.mark_customer_service_proposal_builder_contacted(sent_id) ->> 'alreadyRecorded')::boolean, false,
  'The Builder call is recorded') from follow_up_fixture;
select is((select builder_contacted_at is not null and updated_by = admin_id from valtrim.service_proposals where id = sent_id),
  true, 'The call time and the coordinator are stored') from follow_up_fixture;
select is((valtrim.mark_customer_service_proposal_builder_contacted(sent_id) ->> 'alreadyRecorded')::boolean, true,
  'A second click keeps the first time') from follow_up_fixture;
select is((select count(*) from valtrim.audit_events
    where action = 'SERVICE_PROPOSAL_BUILDER_CONTACTED' and entity_id = sent_id::text and actor_user_id = admin_id),
  1::bigint, 'The call is audited once, as the coordinator') from follow_up_fixture;
select throws_ok(format('select valtrim.mark_customer_service_proposal_builder_contacted(%s)', cancelled_id), '55000',
  'Only a proposal waiting for the customer can be followed up', 'A cancelled proposal is not followed up')
from follow_up_fixture;
select throws_ok('select valtrim.mark_customer_service_proposal_builder_contacted(-1)', 'P0002',
  'The proposal was not found', 'An unknown proposal is reported');
select set_config('request.jwt.claim.sub', '', true);

select * from finish();
rollback;
