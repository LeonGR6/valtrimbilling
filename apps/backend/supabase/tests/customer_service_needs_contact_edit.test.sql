begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- A request in Needs contact can be edited like one in Ready to propose (24 Nov 2026).

create temporary table contact_edit_fixture as select
  gen_random_uuid() as actor_id,
  (select job.id from valtrim.jobs job join valtrim.builders builder on builder.id = job.builder_id
   where job.is_active and job.status = 'ACTIVE' and builder.is_active
     and job.community_latitude between -90 and 90 and job.community_longitude between -180 and 180
   order by job.id limit 1) as job_id,
  null::bigint as request_id, null::jsonb as payload;
insert into auth.users(id, email, raw_user_meta_data)
select actor_id, actor_id::text || '@example.com', '{"name":"Contact Edit Admin Test"}'::jsonb from contact_edit_fixture;
update valtrim.app_users set role = 'ADMIN' where id = (select actor_id from contact_edit_fixture);
select set_config('request.jwt.claim.sub', actor_id::text, true) from contact_edit_fixture;

update contact_edit_fixture set payload = jsonb_build_object(
  'property', jsonb_build_object('jobId', job_id, 'lotNumber', 'CONTACT-1', 'address', '1 Contact Way'),
  'request', jsonb_build_object('reportedOn', (now() at time zone 'America/Los_Angeles')::date,
    'reportedOnSource', 'EMAIL_SENT', 'priority', 'MEDIUM', 'serviceKind', 'ADJUSTMENT',
    'workCategory', 'DOORS', 'serviceTask', 'GENERAL_FIX', 'estimatedDurationMinutes', 30, 'crewSize', 1),
  'contacts', jsonb_build_array(jsonb_build_object('role', 'PRIMARY', 'name', 'Primary Test', 'email', 'primary@example.com')),
  'items', jsonb_build_array(jsonb_build_object('itemNumber', 1, 'description', 'First item', 'materialRequired', false, 'chargeable', false)),
  'source', jsonb_build_object('sourceType', 'PDF', 'emailText', 'Original email', 'extractedText', 'Original OCR',
    'extractionPayload', jsonb_build_object('schemaVersion', '1.0'), 'reviewNotes', jsonb_build_array())
);
update contact_edit_fixture set request_id =
  (valtrim.create_customer_service_request_intake(gen_random_uuid(), payload) ->> 'requestId')::bigint;
update contact_edit_fixture set payload = payload - 'source';
-- The customer declined a proposal: the request needs contact.
update valtrim.service_requests set workflow_stage = 'NEEDS_CONTACT', reviewed_at = now(), valtrim_items_confirmed = true
where id = (select request_id from contact_edit_fixture);

create function pg_temp.edit(p_payload jsonb) returns jsonb language sql as $fn$
  select valtrim.update_customer_service_request_intake(request_id,
    (select updated_at from valtrim.service_requests where id = request_id), p_payload)
  from contact_edit_fixture;
$fn$;

-- Adding the phone keeps it in Needs contact and keeps the review.
select lives_ok(format('select pg_temp.edit(%L::jsonb)',
    (select jsonb_set(payload, '{contacts,0,phone}', '"+19515550101"') from contact_edit_fixture)),
  'A Needs contact request can be edited');
select is((select array[request.workflow_stage::text, request.valtrim_items_confirmed::text, contact.phone::text]
    from valtrim.service_requests request
    join valtrim.service_request_contacts contact on contact.request_id = request.id and contact.role = 'PRIMARY'
    where request.id = contact_edit_fixture.request_id),
  array['NEEDS_CONTACT', 'true', '+19515550101'], 'A contact change keeps it in Needs contact, still reviewed')
from contact_edit_fixture;

-- Changing the work sends it back to review, as in Ready to propose.
select lives_ok(format('select pg_temp.edit(%L::jsonb)',
    (select jsonb_set(jsonb_set(payload, '{contacts,0,phone}', '"+19515550101"'), '{request,crewSize}', '2') from contact_edit_fixture)),
  'The work can be changed too');
select is((select array[workflow_stage::text, valtrim_items_confirmed::text, (reviewed_at is null)::text]
    from valtrim.service_requests where id = contact_edit_fixture.request_id),
  array['NEEDS_REVIEW', 'false', 'true'], 'A work change needs a new review') from contact_edit_fixture;

select set_config('request.jwt.claim.sub', '', true);
select * from finish();
rollback;
