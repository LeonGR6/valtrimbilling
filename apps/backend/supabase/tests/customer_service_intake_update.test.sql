begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_function('valtrim', 'update_customer_service_request_intake', array['bigint', 'timestamp with time zone', 'jsonb']);
select ok(has_function_privilege('authenticated',
  'valtrim.update_customer_service_request_intake(bigint,timestamptz,jsonb)', 'execute'), 'Authenticated callers can invoke the guarded RPC');
select ok(not has_function_privilege('anon',
  'valtrim.update_customer_service_request_intake(bigint,timestamptz,jsonb)', 'execute'), 'Anonymous callers cannot edit intake');
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$select valtrim.update_customer_service_request_intake(-1, now(), '{"request":{}}')$$,
  '42501', 'You do not have permission to manage Customer Service requests', 'A missing actor is rejected');

create temporary table intake_update_fixture as select
  gen_random_uuid() as actor_id, gen_random_uuid() as scheduling_id, gen_random_uuid() as denied_id,
  (select job.id from valtrim.jobs job join valtrim.builders builder on builder.id = job.builder_id
   where job.is_active and job.status = 'ACTIVE' and builder.is_active
     and job.community_latitude between -90 and 90 and job.community_longitude between -180 and 180
   order by job.id limit 1) as job_id,
  null::bigint as request_id, null::jsonb as payload, null::jsonb as record,
  null::jsonb as original_record, null::timestamptz as old_version,
  null::bigint as request_count, null::bigint as audit_count;

-- Dedicated actors disappear on rollback; no real user's permissions are changed.
insert into auth.users(id, email, raw_user_meta_data)
select actor_id, actor_id::text || '@example.com', '{"name":"Intake Admin Test"}'::jsonb from intake_update_fixture
union all select scheduling_id, scheduling_id::text || '@example.com', '{"name":"Intake Scheduling Test"}'::jsonb from intake_update_fixture
union all select denied_id, denied_id::text || '@example.com', '{"name":"Intake Read Only Test"}'::jsonb from intake_update_fixture;
update valtrim.app_users set role = 'ADMIN' where id = (select actor_id from intake_update_fixture);
update valtrim.app_users set role = 'SCHEDULING' where id = (select scheduling_id from intake_update_fixture);
select ok(job_id is not null, 'The linked project has an active Job with verified coordinates') from intake_update_fixture;
select set_config('request.jwt.claim.sub', actor_id::text, true) from intake_update_fixture;

update intake_update_fixture set payload = jsonb_build_object(
  'property', jsonb_build_object('jobId', job_id, 'lotNumber', 'EDIT-INITIAL', 'address', 'Original address'),
  'request', jsonb_build_object('reportedOn', (now() at time zone 'America/Los_Angeles')::date,
    'reportedOnSource', 'EMAIL_SENT', 'priority', 'MEDIUM', 'serviceKind', 'ADJUSTMENT',
    'workCategory', 'DOORS', 'serviceTask', 'GENERAL_FIX', 'estimatedDurationMinutes', 30, 'crewSize', 1),
  'contacts', jsonb_build_array(
    jsonb_build_object('role', 'PRIMARY', 'name', 'Primary Test', 'email', 'primary@example.com'),
    jsonb_build_object('role', 'ADDITIONAL', 'name', 'Additional Test', 'phone', '+19515550101')),
  'items', jsonb_build_array(
    jsonb_build_object('itemNumber', 1, 'description', 'First item', 'materialRequired', false, 'chargeable', false),
    jsonb_build_object('itemNumber', 2, 'description', 'Second item', 'materialRequired', true, 'chargeable', false)),
  'source', jsonb_build_object('sourceType', 'PDF', 'senderEmail', 'builder@example.com',
    'subject', 'Original subject', 'emailText', 'Original email', 'extractedText', 'Original OCR',
    'extractionPayload', jsonb_build_object('schemaVersion', '1.0'), 'reviewNotes', jsonb_build_array('Check source'))
);
update intake_update_fixture set request_id =
  (valtrim.create_customer_service_request_intake(gen_random_uuid(), payload) ->> 'requestId')::bigint;
insert into storage.objects(bucket_id, name, metadata)
select 'customer-service-sources', format('requests/%s/source.pdf', request_id),
  jsonb_build_object('mimetype', 'application/pdf', 'size', 321) from intake_update_fixture;
select valtrim.finalize_customer_service_source_pdf_upload(request_id, actor_id, 'edit-test.pdf', 321, repeat('b', 64)) from intake_update_fixture;
update intake_update_fixture set record = records.value
from valtrim.read_customer_service_request_intakes((select request_id from intake_update_fixture)) records(value);
update intake_update_fixture set original_record = record, old_version = (record #>> '{request,updated_at}')::timestamptz,
  request_count = (select count(*) from valtrim.service_requests), payload = payload - 'source';

grant select, update on intake_update_fixture to authenticated;
create function pg_temp.edit_intake(p_payload jsonb) returns jsonb language sql as $fn$
  select valtrim.update_customer_service_request_intake(request_id, (record #>> '{request,updated_at}')::timestamptz, p_payload)
  from intake_update_fixture;
$fn$;

set local role authenticated;
update intake_update_fixture set record = pg_temp.edit_intake(
  jsonb_set(jsonb_set(jsonb_set(payload, '{property,lotNumber}', '"EDIT-SAVED"'),
    '{contacts,1,name}', '"Changed Additional"'), '{items,1,chargeable}', 'true')
  || jsonb_build_object('property', (payload -> 'property') ||
    '{"lotNumber":"EDIT-SAVED","latitude":0,"longitude":0}'::jsonb)
);
select is(record #>> '{property,lot_number}', 'EDIT-SAVED', 'Property edits persist') from intake_update_fixture;
select is(record #>> '{items,1,chargeable}', 'true', 'All item flags persist') from intake_update_fixture;
select ok(exists(select 1 from jsonb_array_elements(record -> 'contacts') contact
  where contact ->> 'role' = 'ADDITIONAL' and contact ->> 'name' = 'Changed Additional'), 'The additional contact is updated') from intake_update_fixture;
select is(record #>> '{request,folio}', original_record #>> '{request,folio}', 'The folio is conserved') from intake_update_fixture;
select is(record #>> '{request,submission_key}', original_record #>> '{request,submission_key}', 'The submission key is conserved') from intake_update_fixture;
select is(record #>> '{request,created_at}', original_record #>> '{request,created_at}', 'The creation timestamp is conserved') from intake_update_fixture;
select is(record -> 'source', original_record -> 'source', 'Source, PDF metadata, OCR and JSON remain byte-for-byte unchanged') from intake_update_fixture;
select is(record #> '{property,latitude}', original_record #> '{property,latitude}', 'Client latitude cannot replace verified Job coordinates') from intake_update_fixture;
select is(record #> '{property,longitude}', original_record #> '{property,longitude}', 'Client longitude cannot replace verified Job coordinates') from intake_update_fixture;
select ok((record #>> '{request,updated_at}')::timestamptz > old_version, 'The version increases even within one transaction') from intake_update_fixture;
select throws_ok(format('select valtrim.update_customer_service_request_intake(%s,%L,%L::jsonb)',
  request_id, old_version, '{"request":{"internalNotes":"Stale tab"}}'), '40001',
  'This request changed after you opened it. Close the editor, reload requests and review the latest version before saving.',
  'A stale browser cannot overwrite another edit') from intake_update_fixture;
select throws_ok($$select pg_temp.edit_intake('{"request":{},"source":null}')$$, '22023',
  'Source, identity and workflow fields cannot be edited through intake', 'Even a null source replacement is rejected');

-- Validate malformed edits with the current version. Failed calls must be atomic.
select throws_ok(format('select pg_temp.edit_intake(%L::jsonb)', jsonb_set(payload, '{property,jobId}', '-1')),
  '22023', 'The selected Job is not active or does not exist', 'Unknown Jobs are rejected') from intake_update_fixture;
select throws_ok(format('select pg_temp.edit_intake(%L::jsonb)', jsonb_set(payload, '{contacts,1,phone}', '"invalid"')),
  '22023', 'Contact phone must use +1 or +52 followed by 10 digits', 'An invalid additional contact rejects the whole edit') from intake_update_fixture;
select throws_ok(format('select pg_temp.edit_intake(%L::jsonb)', jsonb_set(payload, '{items,0,description}', '""')),
  '22023', 'Every work item requires a description of 1000 characters or fewer', 'An empty work item rejects the whole edit') from intake_update_fixture;
select throws_ok(format('select pg_temp.edit_intake(%L::jsonb)', jsonb_set(payload, '{request,crewSize}', '0')),
  '22023', 'Crew size must be between 1 and 10', 'Invalid crew is rejected') from intake_update_fixture;
reset role;
select is((select count(*) from valtrim.service_requests), request_count, 'Editing never creates another request') from intake_update_fixture;
select ok(exists(select 1 from valtrim.audit_events audit where audit.entity_id = fixture.request_id::text
  and audit.action = 'SERVICE_REQUEST_INTAKE_UPDATED' and audit.actor_user_id = fixture.actor_id
  and audit.metadata -> 'changedFields' ? 'contacts' and audit.metadata -> 'changedFields' ? 'items'),
  'The transactional edit audit records actor and changed contacts/items') from intake_update_fixture fixture;
select is(records.value, fixture.record, 'Failed validations do not change any part of the request')
from intake_update_fixture fixture cross join lateral valtrim.read_customer_service_request_intakes(fixture.request_id) records(value);

-- Force a failure after Property and contacts have been written, not just an
-- input validation failure. The request, children and audit must all roll back.
create function pg_temp.reject_intake_test_item() returns trigger language plpgsql as $fn$
begin
  if new.description = 'FAIL_WRITE' then raise exception 'Injected late write failure' using errcode = '22023'; end if;
  return new;
end;
$fn$;
create trigger test_intake_edit_atomicity before insert or update on valtrim.service_request_items
for each row execute function pg_temp.reject_intake_test_item();
update intake_update_fixture set audit_count = (select count(*) from valtrim.audit_events);
select throws_ok(format('select pg_temp.edit_intake(%L::jsonb)',
  jsonb_set(jsonb_set(jsonb_set(payload, '{property,lotNumber}', '"SHOULD-ROLL-BACK"'),
    '{contacts,0,name}', '"Should Roll Back"'), '{items,0,description}', '"FAIL_WRITE"')),
  '22023', 'Injected late write failure', 'A late child write failure rolls back the transaction') from intake_update_fixture;
drop trigger test_intake_edit_atomicity on valtrim.service_request_items;
select is(records.value, fixture.record, 'Late failure leaves property, contacts, items, source and version intact')
from intake_update_fixture fixture cross join lateral valtrim.read_customer_service_request_intakes(fixture.request_id) records(value);
select is((select count(*) from valtrim.audit_events), audit_count, 'Late failure leaves no success audit') from intake_update_fixture;

-- Seed an approved request to test edit behavior without implementing approval.
update intake_update_fixture set payload = jsonb_set(jsonb_set(jsonb_set(payload,
  '{property,lotNumber}', '"EDIT-SAVED"'), '{contacts,1,name}', '"Changed Additional"'), '{items,1,chargeable}', 'true');
update valtrim.service_requests set workflow_stage = 'READY_TO_PROPOSE', reviewed_by = fixture.actor_id,
  reviewed_at = now(), valtrim_items_confirmed = true
from intake_update_fixture fixture where id = fixture.request_id;
update intake_update_fixture set record = records.value from
  valtrim.read_customer_service_request_intakes((select request_id from intake_update_fixture)) records(value);
select set_config('request.jwt.claim.sub', scheduling_id::text, true) from intake_update_fixture;
set local role authenticated;
update intake_update_fixture set record = pg_temp.edit_intake('{"request":{"priority":"HIGH","internalNotes":"Administrative edit"}}');
select is(record #>> '{request,workflow_stage}', 'READY_TO_PROPOSE', 'A SCHEDULING actor can edit priority/notes without invalidating review') from intake_update_fixture;
select is(record #>> '{request,reviewed_by}', actor_id::text, 'Administrative edits retain the reviewer') from intake_update_fixture;
select is(record #>> '{request,valtrim_items_confirmed}', 'true', 'Administrative edits retain Valtrim confirmation') from intake_update_fixture;
update intake_update_fixture set record = pg_temp.edit_intake(jsonb_set(payload, '{contacts,0,email}', '"corrected@example.com"'));
select is(record #>> '{request,workflow_stage}', 'READY_TO_PROPOSE', 'A valid contact correction alone retains approval') from intake_update_fixture;
select is(record #>> '{request,valtrim_items_confirmed}', 'true', 'A valid contact correction retains the explicit work confirmation') from intake_update_fixture;
update intake_update_fixture set old_version = (record #>> '{request,updated_at}')::timestamptz;
update intake_update_fixture set record = pg_temp.edit_intake('{"request":{"priority":"MEDIUM","internalNotes":null}}');
select is((record #>> '{request,updated_at}')::timestamptz, old_version, 'Saving identical administrative fields is a no-op') from intake_update_fixture;
reset role;

-- Independent scope cases prevent an unrelated item change from masking an
-- incorrect invalidation implementation for duration, crew or classification.
create temporary table intake_scope_cases(label text, path text[], replacement jsonb, result jsonb);
insert into intake_scope_cases(label, path, replacement) values
  ('location', array['property','address'], '"New address"'),
  ('service kind', array['request','serviceKind'], '"REPLACEMENT"'),
  ('work category', array['request','workCategory'], '"HARDWARE"'),
  ('service task', array['request','serviceTask'], '"EXTERIOR_DOOR_REPLACEMENT"'),
  ('duration', array['request','estimatedDurationMinutes'], '45'),
  ('crew', array['request','crewSize'], '2'),
  ('item flags', array['items','0','chargeable'], 'true'),
  ('incomplete classification', array['request','serviceKind'], 'null');
do $fn$
declare c record; f record; v_request_id bigint; version timestamptz; v_result jsonb;
begin
  select * into f from intake_update_fixture;
  for c in select * from intake_scope_cases loop
    v_request_id := (valtrim.create_customer_service_request_intake(gen_random_uuid(), f.payload) ->> 'requestId')::bigint;
    update valtrim.service_requests set workflow_stage = 'READY_TO_PROPOSE',
      reviewed_by = f.actor_id, reviewed_at = now(), valtrim_items_confirmed = true
      where id = v_request_id returning updated_at into version;
    v_result := valtrim.update_customer_service_request_intake(v_request_id, version,
      jsonb_set(f.payload, c.path, c.replacement));
    update intake_scope_cases set result = v_result where label = c.label;
  end loop;
end;
$fn$;
select is(result #>> '{request,workflow_stage}', 'NEEDS_REVIEW', label || ' changes require review') from intake_scope_cases;
select ok(result #> '{request,reviewed_by}' = 'null'::jsonb and result #> '{request,reviewed_at}' = 'null'::jsonb
  and result #>> '{request,valtrim_items_confirmed}' = 'false', label || ' changes clear approval metadata') from intake_scope_cases;

create temporary table intake_shared_property_case(result jsonb, sibling_before jsonb, sibling_after jsonb);
do $fn$
declare f record; v_a bigint; v_b bigint; v_property_id bigint; v_version timestamptz; v_before jsonb; v_after jsonb; v_result jsonb;
begin
  select * into f from intake_update_fixture;
  v_a := (valtrim.create_customer_service_request_intake(gen_random_uuid(), f.payload) ->> 'requestId')::bigint;
  v_b := (valtrim.create_customer_service_request_intake(gen_random_uuid(), f.payload) ->> 'requestId')::bigint;
  select property_id, updated_at into v_property_id, v_version from valtrim.service_requests where id = v_a;
  update valtrim.service_requests set property_id = v_property_id where id = v_b;
  select value into v_before from valtrim.read_customer_service_request_intakes(v_b) records(value);
  v_result := valtrim.update_customer_service_request_intake(v_a, v_version,
    jsonb_set(f.payload, '{property,address}', '"Only request A changes"'));
  select value into v_after from valtrim.read_customer_service_request_intakes(v_b) records(value);
  insert into intake_shared_property_case values (v_result, v_before, v_after);
end;
$fn$;
select is(sibling_after, sibling_before, 'Editing a shared legacy property does not modify its sibling request') from intake_shared_property_case;
select isnt(result #>> '{request,property_id}', sibling_after #>> '{request,property_id}',
  'A changed shared property becomes a separate snapshot for the edited request') from intake_shared_property_case;

-- Restrictions apply in the database, including legacy records with no Job.
select set_config('request.jwt.claim.sub', actor_id::text, true) from intake_update_fixture;
update valtrim.service_requests set workflow_stage = 'CONFIRMED' from intake_update_fixture fixture where id = fixture.request_id;
update valtrim.service_properties set job_id = null where id = (select (record #>> '{request,property_id}')::bigint from intake_update_fixture);
update intake_update_fixture set record = records.value from
  valtrim.read_customer_service_request_intakes((select request_id from intake_update_fixture)) records(value);
set local role authenticated;
select throws_ok(format('select pg_temp.edit_intake(%L::jsonb)', payload), '55000',
  'Only priority and internal notes can be edited after a proposal is sent or a visit is scheduled',
  'Operational edits of a confirmed request are rejected') from intake_update_fixture;
update intake_update_fixture set record = pg_temp.edit_intake('{"request":{"priority":"LOW","internalNotes":"Confirmed notes"}}');
select is(record #>> '{property,job_id}', null, 'Administrative legacy edits do not invent a Job') from intake_update_fixture;
select is(record #>> '{request,workflow_stage}', 'CONFIRMED', 'Confirmed edits preserve scheduling state') from intake_update_fixture;
reset role;
update valtrim.service_requests set workflow_stage = 'COMPLETED' from intake_update_fixture fixture where id = fixture.request_id;
update intake_update_fixture set record = records.value from
  valtrim.read_customer_service_request_intakes((select request_id from intake_update_fixture)) records(value);
set local role authenticated;
select throws_ok($$select pg_temp.edit_intake('{"request":{"priority":"HIGH"}}')$$, '55000',
  'Only internal notes can be edited on a completed request', 'Completed priority cannot change');
update intake_update_fixture set record = pg_temp.edit_intake('{"request":{"internalNotes":"Completed notes"}}');
select is(record #>> '{request,internal_notes}', 'Completed notes', 'Completed internal notes persist') from intake_update_fixture;
select is(record -> 'source', original_record -> 'source', 'All administrative edits still preserve the original source') from intake_update_fixture;
reset role;

create temporary table intake_locked_cases(stage text, blocked_code text, result jsonb);
do $fn$
declare f record; v_stage text; v_version timestamptz; v_code text; v_result jsonb;
begin
  select * into f from intake_update_fixture;
  foreach v_stage in array array['AWAITING_CUSTOMER', 'WORKING'] loop
    update valtrim.service_requests set workflow_stage = v_stage::valtrim.service_request_workflow_stage
      where id = f.request_id returning updated_at into v_version;
    v_code := null;
    begin
      perform valtrim.update_customer_service_request_intake(f.request_id, v_version, f.payload);
    exception when others then v_code := sqlstate;
    end;
    v_result := valtrim.update_customer_service_request_intake(f.request_id, v_version,
      jsonb_build_object('request', jsonb_build_object('internalNotes', v_stage || ' notes')));
    insert into intake_locked_cases values(v_stage, v_code, v_result);
  end loop;
end;
$fn$;
select is(blocked_code, '55000', stage || ' rejects operational edits') from intake_locked_cases;
select is(result #>> '{request,workflow_stage}', stage, stage || ' accepts notes without changing stage') from intake_locked_cases;

select set_config('request.jwt.claim.sub', denied_id::text, true) from intake_update_fixture;
set local role authenticated;
select throws_ok($$select pg_temp.edit_intake('{"request":{"internalNotes":"Denied"}}')$$, '42501',
  'You do not have permission to manage Customer Service requests', 'READ_ONLY cannot edit requests');
reset role;
update valtrim.app_users set is_active = false where id = (select scheduling_id from intake_update_fixture);
select set_config('request.jwt.claim.sub', scheduling_id::text, true) from intake_update_fixture;
set local role authenticated;
select throws_ok($$select pg_temp.edit_intake('{"request":{"internalNotes":"Denied"}}')$$, '42501',
  'You do not have permission to manage Customer Service requests', 'An inactive SCHEDULING actor cannot edit');
reset role;

select * from finish();
rollback;
