begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_function('valtrim', 'mark_customer_service_request_ready', array['bigint', 'timestamp with time zone', 'boolean']);
select ok(has_function_privilege('authenticated', 'valtrim.mark_customer_service_request_ready(bigint,timestamptz,boolean)', 'execute'), 'Authenticated callers can invoke the guarded approval');
select ok(not has_function_privilege('anon', 'valtrim.mark_customer_service_request_ready(bigint,timestamptz,boolean)', 'execute'), 'Anonymous callers cannot approve');
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$select valtrim.mark_customer_service_request_ready(-1, now(), true)$$,
  '42501', 'You do not have permission to manage Customer Service requests', 'Approval requires a signed-in actor');

create temporary table ready_fixture as select gen_random_uuid() as actor_id,
  gen_random_uuid() as scheduling_id, gen_random_uuid() as denied_id,
  (select job.id from valtrim.jobs job join valtrim.builders builder on builder.id = job.builder_id
   where job.is_active and job.status = 'ACTIVE' and builder.is_active
     and job.community_latitude between -90 and 90 and job.community_longitude between -180 and 180
   order by job.id limit 1) as job_id,
  null::bigint as request_id, null::jsonb as payload, null::jsonb as record, null::jsonb as original,
  null::bigint as request_count, null::bigint as appointment_count, null::bigint as audit_count;
insert into auth.users(id, email, raw_user_meta_data)
select actor_id, actor_id::text || '@example.com', '{"name":"Ready Admin Test"}'::jsonb from ready_fixture
union all select scheduling_id, scheduling_id::text || '@example.com', '{"name":"Ready Scheduling Test"}'::jsonb from ready_fixture
union all select denied_id, denied_id::text || '@example.com', '{"name":"Ready Read Only Test"}'::jsonb from ready_fixture;
update valtrim.app_users set role = 'ADMIN' where id = (select actor_id from ready_fixture);
update valtrim.app_users set role = 'SCHEDULING' where id = (select scheduling_id from ready_fixture);
select ok(job_id is not null, 'The linked project has a valid active Job') from ready_fixture;
select set_config('request.jwt.claim.sub', actor_id::text, true) from ready_fixture;
update ready_fixture set payload = jsonb_build_object(
  'property', jsonb_build_object('jobId', job_id),
  'request', jsonb_build_object('reportedOn', (now() at time zone 'America/Los_Angeles')::date,
    'serviceKind', 'ADJUSTMENT', 'workCategory', 'DOORS', 'serviceTask', 'GENERAL_FIX',
    'estimatedDurationMinutes', 47, 'crewSize', 1),
  'contacts', jsonb_build_array(
    jsonb_build_object('role', 'PRIMARY', 'name', 'Primary Test', 'email', 'primary@example.com'),
    jsonb_build_object('role', 'ADDITIONAL', 'name', 'Additional Test', 'phone', '+19515550101')),
  'items', jsonb_build_array(
    jsonb_build_object('itemNumber', 1, 'description', 'First item', 'materialRequired', true, 'chargeable', false),
    jsonb_build_object('itemNumber', 2, 'description', 'Second item', 'materialRequired', false, 'chargeable', true)),
  'source', jsonb_build_object('sourceType', 'PDF', 'emailText', 'Original email', 'extractedText', 'Original OCR',
    'extractionPayload', '{"schemaVersion":"1.0"}'::jsonb, 'reviewNotes', jsonb_build_array('Check source')));
update ready_fixture set request_id = (valtrim.create_customer_service_request_intake(gen_random_uuid(), payload) ->> 'requestId')::bigint;
insert into storage.objects(bucket_id, name, metadata)
select 'customer-service-sources', format('requests/%s/source.pdf', request_id),
  jsonb_build_object('mimetype', 'application/pdf', 'size', 321) from ready_fixture;
select valtrim.finalize_customer_service_source_pdf_upload(request_id, actor_id, 'ready-test.pdf', 321, repeat('c', 64)) from ready_fixture;
update ready_fixture set original = records.value from
  valtrim.read_customer_service_request_intakes((select request_id from ready_fixture)) records(value);
update ready_fixture set record = original, request_count = (select count(*) from valtrim.service_requests),
  appointment_count = (select count(*) from valtrim.service_appointments), audit_count = (select count(*) from valtrim.audit_events);
grant select, update on ready_fixture to authenticated;
create function pg_temp.approve_ready(p_confirmed boolean default true) returns jsonb language sql as $fn$
  select valtrim.mark_customer_service_request_ready(request_id, (record #>> '{request,updated_at}')::timestamptz, p_confirmed) from ready_fixture;
$fn$;

set local role authenticated;
select throws_ok($$select valtrim.mark_customer_service_request_ready(-1, now(), true)$$,
  'P0002', 'The Customer Service request was not found', 'An unknown request is rejected');
select throws_ok($$select pg_temp.approve_ready(false)$$, '22023',
  'Confirm that the requested work items belong to Valtrim before approving', 'False is not explicit confirmation');
select throws_ok($$select pg_temp.approve_ready(null)$$, '22023',
  'Confirm that the requested work items belong to Valtrim before approving', 'Null is not explicit confirmation');
select throws_ok(format('select valtrim.mark_customer_service_request_ready(%s,null,true)', request_id),
  '40001', 'This request changed after you opened it. Close the review, reload requests and review the latest version before approving.',
  'A missing version cannot approve') from ready_fixture;
select set_config('request.jwt.claim.sub', denied_id::text, true) from ready_fixture;
select throws_ok($$select pg_temp.approve_ready()$$, '42501',
  'You do not have permission to manage Customer Service requests', 'READ_ONLY cannot approve');
reset role;
update valtrim.app_users set is_active = false where id = (select scheduling_id from ready_fixture);
select set_config('request.jwt.claim.sub', scheduling_id::text, true) from ready_fixture;
set local role authenticated;
select throws_ok($$select pg_temp.approve_ready()$$, '42501',
  'You do not have permission to manage Customer Service requests', 'Inactive SCHEDULING cannot approve');
reset role;
update valtrim.app_users set is_active = true where id = (select scheduling_id from ready_fixture);
select set_config('request.jwt.claim.sub', actor_id::text, true) from ready_fixture;

-- Corruption is seeded only inside the statement caught by throws_ok. The failed
-- RPC rolls back the seed too, including any temporary Job/Builder changes.
create function pg_temp.invalid_ready(p_mutation text) returns jsonb language plpgsql as $fn$
declare v_id bigint;
begin
  execute p_mutation;
  select request_id into v_id from ready_fixture;
  return valtrim.mark_customer_service_request_ready(v_id,
    (select updated_at from valtrim.service_requests where id = v_id), true);
end;
$fn$;
select throws_ok(format('select pg_temp.invalid_ready(%L)',
  'update valtrim.service_requests set ' || field || ' = null where id = (select request_id from ready_fixture)'),
  '22023', 'Complete Service kind, Work type and Service task before approving', field || ' is mandatory for approval')
from unnest(array['service_kind','work_category','service_task']) fields(field);
select throws_ok($$select pg_temp.invalid_ready('update valtrim.service_requests set estimated_duration_minutes = null where id = (select request_id from ready_fixture)')$$,
  '22023', 'Duration must be between 15 and 720 minutes before approving', 'Missing duration is rejected');
select throws_ok($$select pg_temp.invalid_ready('update valtrim.service_requests set crew_size = null where id = (select request_id from ready_fixture)')$$,
  '22023', 'Crew size must be between 1 and 10 before approving', 'Missing crew is rejected');
select throws_ok($$select pg_temp.invalid_ready('update valtrim.service_requests set reported_on = (now() at time zone ''America/Los_Angeles'')::date + 1 where id = (select request_id from ready_fixture)')$$,
  '22023', 'A valid, non-future Reported on date is required', 'Approval revalidates the operational date in California');
select throws_ok($$select pg_temp.invalid_ready('update valtrim.service_requests set service_task = ''SHUTTER_REPLACEMENT'', crew_size = 1 where id = (select request_id from ready_fixture)')$$,
  '22023', 'Shutter replacement requires at least 2 people', 'Shutter replacement cannot approve a one-person crew');
select throws_ok($$select pg_temp.invalid_ready('delete from valtrim.service_request_contacts where request_id = (select request_id from ready_fixture) and role = ''PRIMARY''')$$,
  '22023', 'Provide exactly one primary contact and at most two additional contacts', 'Missing primary contact is rejected');
select throws_ok($$select pg_temp.invalid_ready('update valtrim.service_request_contacts set phone = ''+449999999999'' where request_id = (select request_id from ready_fixture) and role = ''ADDITIONAL''')$$,
  '23514', 'value for domain valtrim.phone_number violates check constraint "phone_number_check"', 'Database constraints also reject invalid additional contact phones');
select throws_ok($$select pg_temp.invalid_ready('delete from valtrim.service_request_items where request_id = (select request_id from ready_fixture)')$$,
  '22023', 'Provide between 1 and 25 work items before approving', 'A request without items is rejected');
select throws_ok($$select pg_temp.invalid_ready('delete from valtrim.service_request_items where request_id = (select request_id from ready_fixture) and item_number = 1')$$,
  '22023', 'Every work item requires a description, flags and consecutive numbering', 'Every item and its order are revalidated');
select throws_ok($$select pg_temp.invalid_ready('update valtrim.service_properties set job_id = null where id = (select (original #>> ''{property,id}'')::bigint from ready_fixture)')$$,
  '22023', 'The selected Job is not active or does not exist', 'Legacy requests without a Job cannot be approved');
select throws_ok($$select pg_temp.invalid_ready('update valtrim.jobs set is_active = false where id = (select job_id from ready_fixture)')$$,
  '22023', 'The selected Job is not active or does not exist', 'Inactive Jobs cannot be approved');
select throws_ok($$select pg_temp.invalid_ready('update valtrim.builders set is_active = false where id = (select builder_id from valtrim.jobs where id = (select job_id from ready_fixture))')$$,
  '22023', 'The selected Job is not active or does not exist', 'Inactive Builders cannot be approved');
select throws_ok($$select pg_temp.invalid_ready('update valtrim.service_properties set latitude = 0 where id = (select (original #>> ''{property,id}'')::bigint from ready_fixture)')$$,
  '40001', 'Job coordinates changed. Edit and save the request, then review its current location before approving.', 'A stale location snapshot must be saved and reviewed again');
select throws_ok(format('select pg_temp.invalid_ready(%L)',
  'update valtrim.service_requests set workflow_stage = ' || quote_literal(stage) || ' where id = (select request_id from ready_fixture)'),
  '55000', 'Only a request awaiting review without an active appointment can be approved', stage || ' cannot be approved')
from unnest(array['READY_TO_PROPOSE','AWAITING_CUSTOMER','NEEDS_CONTACT','CONFIRMED','WORKING','COMPLETED']) stages(stage);
select throws_ok($$select pg_temp.invalid_ready('update valtrim.service_requests set closed_at = now(), close_reason = ''Test closure'' where id = (select request_id from ready_fixture)')$$,
  '55000', 'Only a request awaiting review without an active appointment can be approved', 'Closed requests cannot be approved');
select is(records.value, original, 'Rejected approvals preserve the complete aggregate and its version')
from ready_fixture cross join lateral valtrim.read_customer_service_request_intakes(request_id) records(value);
select is((select count(*) from valtrim.audit_events), audit_count, 'Rejected validations leave no success audit') from ready_fixture;

create function pg_temp.approve_stale_review() returns jsonb language plpgsql as $fn$
begin
  perform valtrim.update_customer_service_request_intake(request_id,
    (record #>> '{request,updated_at}')::timestamptz, '{"request":{"internalNotes":"Edited in another tab"}}') from ready_fixture;
  return pg_temp.approve_ready();
end;
$fn$;
set local role authenticated;
select throws_ok($$select pg_temp.approve_stale_review()$$, '40001',
  'This request changed after you opened it. Close the review, reload requests and review the latest version before approving.',
  'An edit in another tab invalidates the version used for approval');
reset role;

-- Fail after the request and history writes: the whole approval must roll back.
create function pg_temp.reject_ready_audit() returns trigger language plpgsql as $fn$
begin
  if new.action = 'SERVICE_REQUEST_READY_TO_PROPOSE' then
    raise exception 'Injected review audit failure' using errcode = '22023';
  end if;
  return new;
end;
$fn$;
create trigger test_ready_atomicity before insert on valtrim.audit_events for each row execute function pg_temp.reject_ready_audit();
set local role authenticated;
select throws_ok($$select pg_temp.approve_ready()$$, '22023', 'Injected review audit failure', 'A late audit failure aborts approval');
reset role;
drop trigger test_ready_atomicity on valtrim.audit_events;
select is(records.value, original, 'Late failure rolls back stage, review, version and history')
from ready_fixture cross join lateral valtrim.read_customer_service_request_intakes(request_id) records(value);
select is((select count(*) from valtrim.audit_events), audit_count, 'Late failure leaves no success audit') from ready_fixture;

select set_config('request.jwt.claim.sub', scheduling_id::text, true) from ready_fixture;
set local role authenticated;
update ready_fixture set record = pg_temp.approve_ready();
select is(record #>> '{request,workflow_stage}', 'READY_TO_PROPOSE', 'SCHEDULING can approve a complete request') from ready_fixture;
select is(record #>> '{request,reviewed_by}', scheduling_id::text, 'The reviewer comes from the authenticated actor') from ready_fixture;
select is(record ->> 'reviewerName', 'Ready Scheduling Test', 'The canonical record includes the server reviewer name') from ready_fixture;
select ok((record #>> '{request,reviewed_at}')::timestamptz between transaction_timestamp() and clock_timestamp(), 'The server supplies review time') from ready_fixture;
select is(record #>> '{request,valtrim_items_confirmed}', 'true', 'Explicit confirmation is persisted') from ready_fixture;
select ok((record #>> '{request,updated_at}')::timestamptz > (original #>> '{request,updated_at}')::timestamptz, 'Approval advances the exact version') from ready_fixture;
select is(record #>> '{request,estimated_duration_minutes}', '47', 'A manual duration is not replaced by a suggestion') from ready_fixture;
select is(record -> 'source', original -> 'source', 'PDF, OCR, extraction, warnings and source metadata remain unchanged') from ready_fixture;
select is(record -> 'contacts', original -> 'contacts', 'Both contacts and their channels remain unchanged') from ready_fixture;
select is(record -> 'items', original -> 'items', 'Multiple item descriptions, flags and identity remain unchanged') from ready_fixture;
select is(record -> 'property', original -> 'property', 'Approval does not change property or location') from ready_fixture;
select is(record #> array['request', field], original #> array['request', field], field || ' remains unchanged')
from ready_fixture cross join unnest(array['id','folio','submission_key','created_at','created_by','coordinator_user_id']) fields(field);
select is(jsonb_array_length(record -> 'workflowHistory'), jsonb_array_length(original -> 'workflowHistory') + 1, 'Exactly one transition is appended') from ready_fixture;
select is(record #>> '{workflowHistory,1,changed_by}', scheduling_id::text, 'History records the authenticated reviewer') from ready_fixture;
select is(records.value, record, 'A fresh read restores the same persisted approval')
from ready_fixture cross join lateral valtrim.read_customer_service_request_intakes(request_id) records(value);
select throws_ok(format('select valtrim.mark_customer_service_request_ready(%s,%L,true)', request_id, original #>> '{request,updated_at}'),
  '40001', 'This request changed after you opened it. Close the review, reload requests and review the latest version before approving.', 'An old tab or duplicate submission cannot approve again') from ready_fixture;
select throws_ok($$select pg_temp.approve_ready()$$, '55000',
  'Only a request awaiting review without an active appointment can be approved', 'Even the current version cannot repeat an approval');
reset role;
select is((select count(*) from valtrim.service_requests), request_count, 'Approval never creates another request') from ready_fixture;
select is((select count(*) from valtrim.service_appointments), appointment_count, 'Approval does not create an appointment') from ready_fixture;
select is((select count(*) from valtrim.audit_events where action = 'SERVICE_REQUEST_READY_TO_PROPOSE' and entity_id = request_id::text),
  1::bigint, 'A single dedicated approval audit is written') from ready_fixture;
select ok(exists(select 1 from valtrim.audit_events a where a.action = 'SERVICE_REQUEST_READY_TO_PROPOSE'
  and a.entity_id = f.request_id::text and a.actor_user_id = f.scheduling_id
  and a.previous_values ->> 'workflowStage' = 'NEEDS_REVIEW' and a.new_values ->> 'valtrimItemsConfirmed' = 'true'
  and a.metadata ->> 'operation' = 'mark_customer_service_request_ready'
  and (a.metadata::text || a.new_values::text) !~ 'Original email|Original OCR|primary@example.com'),
  'Audit includes the actor/transition/confirmation without copying source or customer channels') from ready_fixture f;

-- A request without a source and with only a primary phone is also valid.
select set_config('request.jwt.claim.sub', actor_id::text, true) from ready_fixture;
update ready_fixture set request_id = (valtrim.create_customer_service_request_intake(gen_random_uuid(),
  (payload - 'source') || '{"contacts":[{"role":"PRIMARY","name":"Phone Only","phone":"+529511234567"}]}'::jsonb) ->> 'requestId')::bigint;
update ready_fixture set record = records.value from
  valtrim.read_customer_service_request_intakes((select request_id from ready_fixture)) records(value);
set local role authenticated;
update ready_fixture set record = pg_temp.approve_ready();
select is(record #>> '{request,reviewed_by}', actor_id::text, 'ADMIN can approve with a primary phone and no additional contact') from ready_fixture;
select is(record -> 'source', 'null'::jsonb, 'A source PDF or email is not required for approval') from ready_fixture;
reset role;

-- An unavailable optional PDF and review warnings do not replace human review.
update ready_fixture set request_id = (valtrim.create_customer_service_request_intake(gen_random_uuid(), payload) ->> 'requestId')::bigint;
update valtrim.service_request_sources set file_status = 'FAILED', file_error = 'Upload interrupted'
where request_id = (select request_id from ready_fixture);
update ready_fixture set record = records.value from
  valtrim.read_customer_service_request_intakes((select request_id from ready_fixture)) records(value);
set local role authenticated;
update ready_fixture set record = pg_temp.approve_ready();
select is(record #>> '{request,workflow_stage}', 'READY_TO_PROPOSE', 'AI warnings and an optional failed PDF do not block a complete reviewed request') from ready_fixture;
select is(record #>> '{source,file_status}', 'FAILED', 'Approval does not misrepresent or modify the PDF status') from ready_fixture;
reset role;
select * from finish();
rollback;
