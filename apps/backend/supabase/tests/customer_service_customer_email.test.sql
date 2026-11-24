begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Correcting the customer email from "Send to customer" (24 Nov 2026).

select ok(has_function_privilege('service_role', 'valtrim.update_customer_service_customer_email(uuid, bigint, timestamptz, text)', 'execute'),
  'The Edge Functions can correct the customer email');
select ok(not has_function_privilege('authenticated', 'valtrim.update_customer_service_customer_email(uuid, bigint, timestamptz, text)', 'execute'),
  'Browsers cannot call it directly');
select ok(not has_function_privilege('anon', 'valtrim.update_customer_service_customer_email(uuid, bigint, timestamptz, text)', 'execute'),
  'Anonymous callers cannot call it');

create temporary table email_fixture as select
  gen_random_uuid() as admin_id, gen_random_uuid() as field_id,
  (select job.id from valtrim.jobs job join valtrim.builders builder on builder.id = job.builder_id
   where job.is_active and job.status = 'ACTIVE' and builder.is_active
     and job.community_latitude between -90 and 90 and job.community_longitude between -180 and 180
   order by job.id limit 1) as job_id,
  null::bigint as request_id;
insert into auth.users(id, email, raw_user_meta_data)
select admin_id, admin_id::text || '@example.com', '{"name":"Email Admin Test"}'::jsonb from email_fixture
union all select field_id, field_id::text || '@example.com', '{"name":"Email Field Test"}'::jsonb from email_fixture;
update valtrim.app_users set role = 'ADMIN' where id = (select admin_id from email_fixture);
update valtrim.app_users set role = 'FIELD' where id = (select field_id from email_fixture);

select set_config('request.jwt.claim.sub', admin_id::text, true) from email_fixture;
update email_fixture set request_id = (valtrim.create_customer_service_request_intake(gen_random_uuid(), jsonb_build_object(
    'property', jsonb_build_object('jobId', job_id),
    'request', jsonb_build_object('reportedOn', (now() at time zone 'America/Los_Angeles')::date,
      'serviceKind', 'ADJUSTMENT', 'workCategory', 'DOORS', 'serviceTask', 'GENERAL_FIX',
      'estimatedDurationMinutes', 30, 'crewSize', 1),
    'contacts', jsonb_build_array(jsonb_build_object('role', 'PRIMARY', 'name', 'Primary Test', 'email', 'wrong@exmaple.com')),
    'items', jsonb_build_array(jsonb_build_object('itemNumber', 1, 'description', 'Item', 'materialRequired', false, 'chargeable', false)),
    'source', jsonb_build_object('sourceType', 'PDF', 'emailText', 'Original email', 'extractedText', 'Original OCR',
      'extractionPayload', '{"schemaVersion":"1.0"}'::jsonb, 'reviewNotes', jsonb_build_array())
  )) ->> 'requestId')::bigint;
select set_config('request.jwt.claim.sub', '', true);

-- Still in review: not corrected here.
select throws_ok(format('select valtrim.update_customer_service_customer_email(%L, %s, %L, %L)',
    admin_id, request_id, (select updated_at from valtrim.service_requests where id = request_id), 'right@example.com'), '55000',
  'Only an open request being planned can have its customer email corrected here', 'A request in review is not corrected here')
from email_fixture;
update valtrim.service_requests set workflow_stage = 'READY_TO_PROPOSE' where id = (select request_id from email_fixture);

select throws_ok(format('select valtrim.update_customer_service_customer_email(%L, %s, %L, %L)',
    field_id, request_id, (select updated_at from valtrim.service_requests where id = request_id), 'right@example.com'), '42501',
  'You do not have permission to change Customer Service requests', 'A FIELD user cannot correct it') from email_fixture;
select throws_ok(format('select valtrim.update_customer_service_customer_email(%L, %s, %L, %L)',
    admin_id, request_id, (select updated_at from valtrim.service_requests where id = request_id), 'not-an-email'), '22023',
  'Enter a valid customer email', 'An invalid email is refused') from email_fixture;
select throws_ok(format('select valtrim.update_customer_service_customer_email(%L, %s, %L, %L)',
    admin_id, request_id, '2000-01-01 00:00:00+00', 'right@example.com'), '40001',
  'This request changed after you opened it. Reload requests and review the plan again.', 'A stale request is refused')
from email_fixture;

select is((valtrim.update_customer_service_customer_email(admin_id, request_id,
    (select updated_at from valtrim.service_requests where id = request_id), '  Right@Example.com ') ->> 'changed')::boolean,
  true, 'The corrected email is saved') from email_fixture;
select is((select array[request.homeowner_email::text, request.workflow_stage::text, contact.email::text]
    from valtrim.service_requests request
    join valtrim.service_request_contacts contact on contact.request_id = request.id and contact.role = 'PRIMARY'
    where request.id = email_fixture.request_id),
  array['right@example.com', 'READY_TO_PROPOSE', 'right@example.com'],
  'Request and primary contact get it, trimmed and in lowercase, and no new review is needed') from email_fixture;
select is((select updated_by from valtrim.service_requests where id = request_id), admin_id,
  'The coordinator is the one who changed it') from email_fixture;
select is((valtrim.update_customer_service_customer_email(admin_id, request_id,
    (select updated_at from valtrim.service_requests where id = request_id), 'right@example.com') ->> 'changed')::boolean,
  false, 'The same email again changes nothing') from email_fixture;

select * from finish();
rollback;
