-- Run after 20261022140000 is applied by the operator; linked remote only.
-- npm run db:test -- customer_service_imported_request_intake.test.sql
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_column('valtrim','service_requests','email_import_id','Requests retain their import origin');
select ok(has_function_privilege('service_role','valtrim.save_customer_service_imported_request(uuid,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','valtrim.save_customer_service_imported_request(uuid,jsonb)','EXECUTE')
  and not has_function_privilege('anon','valtrim.save_customer_service_imported_request(uuid,jsonb)','EXECUTE'),
  'Only the trusted backend can create imported requests');
select ok(not has_function_privilege('authenticated','private.normalize_customer_service_import_intake(jsonb)','EXECUTE')
  and not has_function_privilege('service_role','private.write_customer_service_import_intake(uuid,jsonb,bigint,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','private.update_customer_service_request_intake(bigint,timestamptz,jsonb)','EXECUTE'),
  'Private validators/writers and the standard editor cannot be called directly');

create temporary table imported_intake_fixture as select
  gen_random_uuid() tenant_id,gen_random_uuid() admin_id,gen_random_uuid() scheduler_id,
  gen_random_uuid() denied_id,gen_random_uuid() inactive_id,
  (select job.id from valtrim.jobs job join valtrim.builders builder on builder.id = job.builder_id
    where job.is_active and job.status = 'ACTIVE' and builder.is_active
      and job.community_latitude is not null and job.community_longitude is not null order by job.id limit 1) job_id,
  (select count(*) from valtrim.service_requests) baseline_requests,
  (select count(*) from valtrim.service_properties) baseline_properties,
  null::jsonb complete_payload,null::jsonb original_source,null::jsonb original_extraction,
  null::jsonb snapshot,null::bigint manual_id;
select ok(job_id is not null,'An active Job with verified coordinates is available for approval regression') from imported_intake_fixture;
insert into auth.users(id,email,raw_user_meta_data)
select actor_id,actor_id::text || '@example.com','{"name":"Imported Intake Test"}'::jsonb
from imported_intake_fixture cross join lateral
  (values(admin_id),(scheduler_id),(denied_id),(inactive_id)) actors(actor_id);
update valtrim.app_users set role = 'ADMIN' where id = (select admin_id from imported_intake_fixture);
update valtrim.app_users set role = 'SCHEDULING' where id = (select scheduler_id from imported_intake_fixture);
update valtrim.app_users set role = 'READ_ONLY' where id = (select denied_id from imported_intake_fixture);
update valtrim.app_users set role = 'ADMIN',is_active = false where id = (select inactive_id from imported_intake_fixture);
update imported_intake_fixture set complete_payload = jsonb_build_object(
  'property',jsonb_build_object('jobId',job_id,'lotNumber','12','latitude',0,'longitude',0),
  'request',jsonb_build_object('reportedOn',(now() at time zone 'America/Los_Angeles')::date,
    'reportedOnSource','EMAIL_SENT','priority','MEDIUM','serviceKind','ADJUSTMENT',
    'workCategory','DOORS','serviceTask','GENERAL_FIX','estimatedDurationMinutes',30,'crewSize',1),
  'contacts','[{"role":"PRIMARY","name":"Elena Rivera","email":"owner@example.com"}]'::jsonb,
  'items','[{"itemNumber":1,"description":"Adjust the entry door","materialRequired":false,"chargeable":false}]'::jsonb);
create temporary table imported_intake_cases(
  label text primary key,import_id uuid,payload jsonb,result jsonb,record jsonb
);
insert into imported_intake_cases(label,payload)
select 'minimal','{"contacts":[{"role":"PRIMARY","name":"Elena Rivera"}],"items":[{"description":"Adjust the entry door"}]}'::jsonb
union all select 'complete',complete_payload from imported_intake_fixture
union all select 'missing date',jsonb_set(complete_payload,'{request,reportedOn}','null') from imported_intake_fixture
union all select 'missing channel',jsonb_set(complete_payload,'{contacts,0,email}','null') from imported_intake_fixture
union all select 'missing owner','{"contacts":[{"role":"PRIMARY"}],"items":[{"description":"Adjust door"}]}'::jsonb
union all select 'missing items','{"contacts":[{"role":"PRIMARY","name":"Elena Rivera"}],"items":[]}'::jsonb
union all select 'invalid email',jsonb_set(complete_payload,'{contacts,0,email}','"invalid"') from imported_intake_fixture
union all select 'invalid date',jsonb_set(complete_payload,'{request,reportedOn}','"2026-02-30"') from imported_intake_fixture
union all select 'invalid job',jsonb_set(complete_payload,'{property,jobId}','-1') from imported_intake_fixture
union all select 'invalid coordinates',jsonb_set(complete_payload,'{property,latitude}','95') from imported_intake_fixture
union all select 'invalid number',jsonb_set(complete_payload,'{items,0,itemNumber}','"wrong"') from imported_intake_fixture
union all select 'invalid flags',jsonb_set(complete_payload,'{items,0,chargeable}','"true"') from imported_intake_fixture
union all select 'workflow injection',complete_payload || '{"workflowStage":"READY_TO_PROPOSE"}' from imported_intake_fixture
union all select 'incomplete additional',complete_payload || '{"contacts":[{"role":"PRIMARY","name":"Elena Rivera","email":"owner@example.com"},{"role":"ADDITIONAL","email":"other@example.com"}]}' from imported_intake_fixture;
grant select,update on imported_intake_fixture,imported_intake_cases to authenticated,service_role;

select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
update imported_intake_cases cases set import_id = (valtrim.register_customer_service_email_import(
  fixture.tenant_id,'test-mailbox',cases.label,
  '{"subject":"Original work order","from":{"emailAddress":{"address":"builder@example.com"}},"bodyText":"Original email body","webLink":"https://outlook.office.com/mail/"}') ->> 'importId')::uuid
from imported_intake_fixture fixture;
-- Block 3 adds a source gate. These fixtures exercise structured intake, not
-- binary uploads, so finalize an email-only source when that migration exists.
-- The regression can still run against the previously deployed block-2 schema.
do $fixture$
declare v_case record;
begin
  if to_regprocedure('valtrim.prepare_customer_service_import_source(uuid,jsonb,jsonb)') is not null then
    for v_case in select receipt.id,receipt.source_payload from valtrim.service_request_imports receipt
      join imported_intake_cases cases on cases.import_id = receipt.id loop
      perform valtrim.prepare_customer_service_import_source(v_case.id,v_case.source_payload,'[]');
      perform valtrim.finalize_customer_service_import_source(v_case.id);
    end loop;
  end if;
end;
$fixture$;
update imported_intake_cases set result = valtrim.save_customer_service_imported_request(import_id,payload);
select is(result ->> 'status','PROCESSED',label || ': valid input creates a linked request')
  from imported_intake_cases where label in ('minimal','complete','incomplete additional','missing date','missing channel');
select is(result ->> 'status','NEEDS_ATTENTION',label || ': invalid/missing minimum is retained as a problem')
  from imported_intake_cases where label not in ('minimal','complete','incomplete additional','missing date','missing channel');
select ok(result -> 'requestId' = 'null'::jsonb and nullif(result ->> 'errorMessage','') is not null,
  label || ': an error never fabricates a request')
  from imported_intake_cases where result ->> 'status' = 'NEEDS_ATTENTION';
select is((select count(*) from valtrim.service_requests),baseline_requests + 5,
  'Only successful imports allocate requests') from imported_intake_fixture;
select is((select count(*) from valtrim.service_properties),baseline_properties + 5,
  'Failed saves leave no orphan properties') from imported_intake_fixture;
select ok((select bool_and(request_id = (cases.result ->> 'requestId')::bigint)
  from valtrim.service_request_imports receipt join imported_intake_cases cases on cases.import_id = receipt.id
  where cases.result ->> 'status' = 'PROCESSED'), 'Request links commit in the same transaction');
reset role;

select set_config('request.jwt.claim.sub',admin_id::text,true) from imported_intake_fixture;
set local role authenticated;
update imported_intake_cases set record = (select value from valtrim.read_customer_service_request_intakes((result ->> 'requestId')::bigint) records(value))
  where result ->> 'status' = 'PROCESSED';
select is(record #>> '{request,workflow_stage}','NEEDS_REVIEW',label || ': automatic save never approves')
  from imported_intake_cases where record is not null;
select ok(record #> '{request,reviewed_at}' = 'null'::jsonb and record #> '{request,reviewed_by}' = 'null'::jsonb
  and record #> '{request,coordinator_user_id}' = 'null'::jsonb and record #> '{request,created_by}' = 'null'::jsonb
  and record #> '{request,valtrim_items_confirmed}' = 'false'::jsonb,
  label || ': the worker does not impersonate a coordinator or reviewer') from imported_intake_cases where record is not null;
select is(record #>> '{request,email_import_id}',import_id::text,label || ': origin and submission key are stable')
  from imported_intake_cases where record is not null;
select ok(record #> '{request,reported_on}' = 'null'::jsonb and record #> '{request,due_on}' = 'null'::jsonb
  and record #> '{property,job_id}' = 'null'::jsonb and record #> '{property,latitude}' = 'null'::jsonb
  and record #> '{property,longitude}' = 'null'::jsonb and record #> '{contacts,0,email}' = 'null'::jsonb
  and record #> '{contacts,0,phone}' = 'null'::jsonb,'Missing dates, location and contact methods stay absent, not invented')
  from imported_intake_cases where label = 'minimal';
select is((record #>> '{property,latitude}')::numeric,(select community_latitude from valtrim.jobs where id = f.job_id),
  'An identified Job supplies verified latitude instead of caller-provided coordinates')
  from imported_intake_cases cross join imported_intake_fixture f where label = 'complete';
select is(record #>> '{emailImport,source_payload,bodyText}','Original email body','Canonical read restores the original email')
  from imported_intake_cases where label = 'minimal';
select is(record -> 'source','null'::jsonb,'No fictitious PDF/source row is created') from imported_intake_cases where label = 'minimal';
update imported_intake_fixture set original_source = (select record #> '{emailImport,source_payload}' from imported_intake_cases where label = 'minimal'),
  original_extraction = (select record #> '{emailImport,extraction_payload}' from imported_intake_cases where label = 'minimal');
select throws_ok(format('select valtrim.mark_customer_service_request_ready(%s,%L,true)',
  result ->> 'requestId',record #>> '{request,updated_at}'),'22023','The selected Job is not active or does not exist',
  'An incomplete import cannot be approved') from imported_intake_cases where label = 'minimal';
select throws_ok(format('select valtrim.mark_customer_service_request_ready(%s,%L,true)',
  result ->> 'requestId',record #>> '{request,updated_at}'),'22023','A valid, non-future Reported on date is required',
  'Approval requires a source date even when Job, classification and contacts are complete')
  from imported_intake_cases where label = 'missing date';
select throws_ok(format('select valtrim.mark_customer_service_request_ready(%s,%L,true)',
  result ->> 'requestId',record #>> '{request,updated_at}'),'22023','Every contact requires an email or phone number',
  'Approval requires a contact method even when all other fields are complete')
  from imported_intake_cases where label = 'missing channel';
select throws_ok(format('select valtrim.mark_customer_service_request_ready(%s,%L,true)',
  result ->> 'requestId',record #>> '{request,updated_at}'),'22023','Every contact requires a name of 100 characters or fewer',
  'An incomplete additional contact blocks approval too') from imported_intake_cases where label = 'incomplete additional';

-- Human edits can advance incrementally without rewriting source/extraction.
update imported_intake_cases set record = valtrim.update_customer_service_request_intake(
  (result ->> 'requestId')::bigint,(record #>> '{request,updated_at}')::timestamptz,
  payload || '{"request":{"internalNotes":"Waiting for contact information"}}') where label = 'minimal';
select is(record #>> '{request,internal_notes}','Waiting for contact information','An incremental human edit is persisted')
  from imported_intake_cases where label = 'minimal';
select is(record #> '{emailImport,source_payload}',original_source,'Human edits preserve original source')
  from imported_intake_cases cross join imported_intake_fixture where label = 'minimal';
select is(record #> '{emailImport,extraction_payload}',original_extraction,'Human edits preserve machine proposal')
  from imported_intake_cases cross join imported_intake_fixture where label = 'minimal';
select is(valtrim.update_customer_service_request_intake((result ->> 'requestId')::bigint,
  (record #>> '{request,updated_at}')::timestamptz,payload || '{"request":{"internalNotes":"Waiting for contact information"}}'),
  record,'Identical partial edits do not churn identity, child rows or version') from imported_intake_cases where label = 'minimal';
select throws_ok(format('select valtrim.update_customer_service_request_intake(%s,%L,%L::jsonb)',
  result ->> 'requestId',record #>> '{request,created_at}',payload),'40001',
  'This request changed after you opened it. Close the editor, reload requests and review the latest version before saving.',
  'A stale partial edit cannot overwrite current data') from imported_intake_cases where label = 'minimal';
select throws_ok(format('select valtrim.update_customer_service_request_intake(%s,%L,%L::jsonb)',
  result ->> 'requestId',record #>> '{request,updated_at}',payload || '{"source":{"subject":"Overwrite"}}'),
  '22023','Import intake must contain only property, request, contacts and items',
  'The partial edit branch also rejects source/identity/workflow injection') from imported_intake_cases where label = 'minimal';
update imported_intake_cases set record = valtrim.update_customer_service_request_intake(
  (result ->> 'requestId')::bigint,(record #>> '{request,updated_at}')::timestamptz,'{"request":{"priority":"HIGH"}}') where label = 'minimal';
select is(record #>> '{request,priority}','HIGH','Administrative edits still work without completing the import')
  from imported_intake_cases where label = 'minimal';
reset role;

-- A duplicate delivery must not undo a human edit, even with a changed payload.
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select is((valtrim.save_customer_service_imported_request(import_id,'{"request":{"workflowStage":"READY_TO_PROPOSE"}}')
  ->> 'idempotentReplay')::boolean,true,'A linked import is replayed, never reapplied')
  from imported_intake_cases where label = 'minimal';
reset role;
select set_config('request.jwt.claim.sub',admin_id::text,true) from imported_intake_fixture;
set local role authenticated;
select is((select value from valtrim.read_customer_service_request_intakes((result ->> 'requestId')::bigint) records(value)),record,
  'Replaying leaves human changes, original source and exact version unchanged') from imported_intake_cases where label = 'minimal';

-- Completion and explicit human review use the deployed approval operation.
update imported_intake_cases cases set record = valtrim.update_customer_service_request_intake(
  (cases.result ->> 'requestId')::bigint,(cases.record #>> '{request,updated_at}')::timestamptz,f.complete_payload)
  from imported_intake_fixture f where cases.label = 'minimal';
select is(record #>> '{request,workflow_stage}','NEEDS_REVIEW','Completing fields alone does not approve')
  from imported_intake_cases where label = 'minimal';
select throws_ok(format('select valtrim.mark_customer_service_request_ready(%s,%L,false)',
  result ->> 'requestId',record #>> '{request,updated_at}'),'22023',
  'Confirm that the requested work items belong to Valtrim before approving','Human confirmation remains mandatory')
  from imported_intake_cases where label = 'minimal';
update imported_intake_cases set record = valtrim.mark_customer_service_request_ready(
  (result ->> 'requestId')::bigint,(record #>> '{request,updated_at}')::timestamptz,true) where label = 'minimal';
select is(record #>> '{request,workflow_stage}','READY_TO_PROPOSE','Only explicit human approval advances the request')
  from imported_intake_cases where label = 'minimal';
select is(record #>> '{request,reviewed_by}',admin_id::text,'Reviewer is the authenticated actor, not a payload value')
  from imported_intake_cases cross join imported_intake_fixture where label = 'minimal';
select is(record #> '{emailImport,source_payload}',original_source,'Approval preserves original email')
  from imported_intake_cases cross join imported_intake_fixture where label = 'minimal';
reset role;

select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select is((valtrim.save_customer_service_imported_request(import_id,payload) ->> 'requestId')::bigint,
  (result ->> 'requestId')::bigint,'A replay after human approval returns the same request')
  from imported_intake_cases where label = 'minimal';
reset role;
select is((select to_jsonb(request) from valtrim.service_requests request where request.id = (cases.result ->> 'requestId')::bigint),
  record -> 'request','A replay cannot reset approval or overwrite approved content') from imported_intake_cases cases where label = 'minimal';

-- Recovering an import without a request reuses its original identity.
set local role service_role;
update imported_intake_cases cases set result = valtrim.save_customer_service_imported_request(cases.import_id,minimal.payload),
  payload = minimal.payload
  from imported_intake_cases minimal where cases.label = 'missing owner' and minimal.label = 'minimal';
select is(result ->> 'status','PROCESSED','A corrected minimum can recover a problem on the same import')
  from imported_intake_cases where label = 'missing owner';
select ok(receipt.error_message is null and receipt.error_code is null and receipt.request_id is not null,
  'Successful recovery clears the active error and links the request')
  from valtrim.service_request_imports receipt join imported_intake_cases cases on cases.import_id = receipt.id
  where cases.label = 'missing owner';
reset role;

-- Completed/manual states must never acquire incomplete data through direct
-- backend table access or through the existing human/manual operations.
select throws_ok(format('update valtrim.service_requests set reported_on = null where id = %s',result ->> 'requestId'),
  '23514',null,'Approved requests cannot lose their source date') from imported_intake_cases where label = 'minimal';
select throws_ok(format('update valtrim.service_requests set email_import_id = null where id = %s',result ->> 'requestId'),
  '22023','A request import link and its submission key cannot be replaced','A request cannot lose its import origin')
  from imported_intake_cases where label = 'minimal';
select throws_ok(format('update valtrim.service_requests set submission_key = gen_random_uuid() where id = %s',result ->> 'requestId'),
  '22023','A request import link and its submission key cannot be replaced','A retry key cannot be replaced')
  from imported_intake_cases where label = 'minimal';
select throws_ok(format('update valtrim.service_request_contacts set email = null,phone = null where request_id = %s',result ->> 'requestId'),
  '23514',null,'Approved contacts cannot lose all contact methods') from imported_intake_cases where label = 'minimal';

select set_config('request.jwt.claim.sub',admin_id::text,true) from imported_intake_fixture;
set local role authenticated;
update imported_intake_fixture set manual_id = (valtrim.create_customer_service_request_intake(gen_random_uuid(),complete_payload) ->> 'requestId')::bigint;
select throws_ok(format('select valtrim.create_customer_service_request_intake(gen_random_uuid(),%L::jsonb)',payload),
  '22023',null,'The minimum for imports does not relax manual creation') from imported_intake_cases where label = 'minimal';
select throws_ok(format('select valtrim.save_customer_service_imported_request(%L,%L::jsonb)',import_id,payload),
  '42501',null,'Even an active ADMIN cannot use the automatic save from the browser') from imported_intake_cases where label = 'complete';
reset role;
select throws_ok(format('update valtrim.service_requests set reported_on = null where id = %s',manual_id),
  '23514',null,'A manual request cannot have a missing date') from imported_intake_fixture;
select throws_ok(format('update valtrim.service_request_contacts set email = null,phone = null where request_id = %s',manual_id),
  '23514',null,'A manual contact still requires a contact method') from imported_intake_fixture;
select throws_ok(format('update valtrim.service_request_contacts set name = null where request_id = %s',manual_id),
  '23514',null,'A manual contact still requires a name') from imported_intake_fixture;

-- An operational change after approval still uses the standard editor and
-- invalidates human review rather than keeping an out-of-date approval.
set local role authenticated;
update imported_intake_cases cases set record = valtrim.update_customer_service_request_intake(
  (cases.result ->> 'requestId')::bigint,(cases.record #>> '{request,updated_at}')::timestamptz,
  jsonb_set(f.complete_payload,'{items,0,description}','"Changed after approval"'))
  from imported_intake_fixture f where cases.label = 'minimal';
select ok(record #>> '{request,workflow_stage}' = 'NEEDS_REVIEW' and record #> '{request,reviewed_at}' = 'null'::jsonb
  and record #> '{request,valtrim_items_confirmed}' = 'false'::jsonb,
  'A post-approval scope edit requires a new human review') from imported_intake_cases where label = 'minimal';
reset role;

select set_config('request.jwt.claim.sub',scheduler_id::text,true) from imported_intake_fixture;
set local role authenticated;
update imported_intake_cases set record = (select value from valtrim.read_customer_service_request_intakes((result ->> 'requestId')::bigint) records(value))
  where label = 'missing owner';
update imported_intake_cases set record = valtrim.update_customer_service_request_intake(
  (result ->> 'requestId')::bigint,(record #>> '{request,updated_at}')::timestamptz,
  payload || '{"request":{"internalNotes":"Scheduler reviewed partial data"}}') where label = 'missing owner';
select is(record #>> '{request,internal_notes}','Scheduler reviewed partial data','Active SCHEDULING can edit partial imports')
  from imported_intake_cases where label = 'missing owner';
reset role;

select set_config('request.jwt.claim.sub',denied_id::text,true) from imported_intake_fixture;
set local role authenticated;
select throws_ok(format('select valtrim.update_customer_service_request_intake(%s,%L,%L::jsonb)',
  result ->> 'requestId',record #>> '{request,updated_at}',payload),'42501',
  'You do not have permission to manage Customer Service requests','READ_ONLY cannot edit imported requests')
  from imported_intake_cases where label = 'minimal';
select throws_ok(format('select * from valtrim.read_customer_service_request_intakes(%s)',result ->> 'requestId'),
  '42501','You do not have permission to manage Customer Service requests','READ_ONLY cannot read original import content')
  from imported_intake_cases where label = 'minimal';
reset role;
select set_config('request.jwt.claim.sub',inactive_id::text,true) from imported_intake_fixture;
set local role authenticated;
select throws_ok(format('select valtrim.update_customer_service_request_intake(%s,%L,%L::jsonb)',
  result ->> 'requestId',record #>> '{request,updated_at}',payload),'42501',
  'You do not have permission to manage Customer Service requests','Inactive ADMIN cannot edit imported requests')
  from imported_intake_cases where label = 'minimal';
reset role;
set local role service_role;
select throws_ok(format('select valtrim.save_customer_service_imported_request(%L,%L::jsonb)',import_id,payload),
  '42501','Automatic import requires a system context without a user identity',
  'The backend save never impersonates a human session') from imported_intake_cases where label = 'complete';
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select throws_ok('select valtrim.save_customer_service_imported_request(null,''{}'')','22023','Import identity is required',
  'A save must identify its receipt');
select throws_ok(format('select valtrim.save_customer_service_imported_request(%L,''{}'')',gen_random_uuid()),
  'P0002','Email import not found','Unknown receipts cannot create requests');
reset role;
set local role anon;
select throws_ok('select valtrim.save_customer_service_imported_request(null,''{}'')','42501',null,
  'Anonymous callers cannot import requests');
reset role;

select * from finish();
rollback;
