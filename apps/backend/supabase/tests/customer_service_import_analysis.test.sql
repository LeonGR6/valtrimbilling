-- Linked remote only, after 20261022180000. Synthetic fixtures, all rolled back.
-- No Mistral calls, mailbox access or real Storage binary uploads.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select has_column('valtrim','service_request_imports','analysis_payload','Analysis is retained separately from the eventual intake');
select has_column('valtrim','service_request_imports','analysis_created_at','Analysis timestamp is recorded by the server');
select ok(has_function_privilege('service_role','valtrim.record_customer_service_import_analysis(uuid,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','valtrim.record_customer_service_import_analysis(uuid,jsonb)','EXECUTE')
  and not has_function_privilege('anon','valtrim.record_customer_service_import_analysis(uuid,jsonb)','EXECUTE'),
  'Only the system backend may record automatic analysis');

create temporary table analysis_fixture as select gen_random_uuid() tenant_id,gen_random_uuid() admin_id,
  gen_random_uuid() scheduler_id,gen_random_uuid() denied_id,gen_random_uuid() inactive_id,
  (select count(*) from valtrim.service_requests) baseline_requests,
  (select count(*) from valtrim.service_properties) baseline_properties,
  '{"contacts":[{"role":"PRIMARY","name":"Elena Rivera"}],"items":[{"description":"Adjust door"}]}'::jsonb payload,
  '{"bodyText":"Elena Rivera, adjust door","webLink":"https://outlook.office.com/mail/"}'::jsonb source;
insert into auth.users(id,email,raw_user_meta_data)
select actor_id,actor_id::text || '@example.com','{"name":"Analysis Test"}'::jsonb
from analysis_fixture cross join lateral (values(admin_id),(scheduler_id),(denied_id),(inactive_id)) actors(actor_id);
update valtrim.app_users set role = 'ADMIN' where id = (select admin_id from analysis_fixture);
update valtrim.app_users set role = 'SCHEDULING' where id = (select scheduler_id from analysis_fixture);
update valtrim.app_users set role = 'READ_ONLY' where id = (select denied_id from analysis_fixture);
update valtrim.app_users set role = 'ADMIN',is_active = false where id = (select inactive_id from analysis_fixture);

create temporary table analysis_cases(label text primary key,import_id uuid,report jsonb,result jsonb,request_result jsonb,snapshot jsonb);
insert into analysis_cases(label) values ('ready'),('minimum missing'),('source failure'),('unavailable'),('image');
grant select,update on analysis_fixture,analysis_cases to service_role,authenticated;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
update analysis_cases cases set import_id = (valtrim.register_customer_service_email_import(f.tenant_id,'analysis-test-mailbox',cases.label,f.source) ->> 'importId')::uuid
  from analysis_fixture f;
select valtrim.prepare_customer_service_import_source(cases.import_id,f.source,'[]')
  from analysis_cases cases cross join analysis_fixture f where cases.label not in ('unavailable','image');
-- Prepare then finalize in distinct statements: never rely on expression order.
select valtrim.finalize_customer_service_import_source(import_id) from analysis_cases where label not in ('unavailable','image');
select valtrim.prepare_customer_service_import_source(cases.import_id,f.source,
  jsonb_build_array(jsonb_build_object('attachmentId','photo','originalFilename','door.png','mimeType','image/png',
    'sizeBytes',8,'sha256',repeat('a',64),'isInline',true,'contentId','photo@id')))
  from analysis_cases cases cross join analysis_fixture f where cases.label = 'image';
reset role;
insert into storage.objects(bucket_id,name,metadata)
select 'customer-service-imports',file ->> 'objectPath','{"size":8,"mimetype":"image/png"}'::jsonb
from analysis_cases cases join valtrim.service_request_imports receipt on receipt.id = cases.import_id
cross join lateral jsonb_array_elements(receipt.source_manifest) file where cases.label = 'image';
set local role service_role;
select valtrim.finalize_customer_service_import_source(import_id) from analysis_cases where label = 'image';
update analysis_cases cases set report = jsonb_build_object(
  'schemaVersion','1.0','importId',cases.import_id,'outcome','READY_FOR_INTAKE',
  'sources',jsonb_build_array(jsonb_build_object('sourceId','email:text:1','kind','EMAIL','status','ANALYZED',
    'attachmentId',null,'fileId',null,'structuredData','{}'::jsonb,'error',null)),
  'structuredData','{}'::jsonb,'provenance','{}'::jsonb,'conflicts','[]'::jsonb,
  'excludedItemIndexes','[]'::jsonb,'warnings','[]'::jsonb,'issues','[]'::jsonb,'intakePayload',f.payload)
from analysis_fixture f;
select throws_ok(format('select valtrim.record_customer_service_import_analysis(%L,%L::jsonb)',import_id,report),
  '55000','The complete email source must be available before analysis','An unvalidated source cannot receive analysis')
  from analysis_cases where label = 'unavailable';
select throws_ok(format('select valtrim.record_customer_service_import_analysis(%L,%L::jsonb)',import_id,report),
  '22023','The analysis must account for every original attachment','An accepted attachment cannot be silently omitted')
  from analysis_cases where label = 'image';
update analysis_cases cases set report = jsonb_set(cases.report,'{sources}',jsonb_build_array(jsonb_build_object(
  'sourceId','attachment:photo','kind','IMAGE','status','ANALYZED','attachmentId','photo',
  'fileId',receipt.attachment_refs #> '{0,fileId}','filename','door.png','sha256',repeat('a',64),
  'structuredData','{}'::jsonb,'error',null))) from valtrim.service_request_imports receipt
  where receipt.id = cases.import_id and cases.label = 'image';
select throws_ok(format('select valtrim.record_customer_service_import_analysis(%L,%L::jsonb)',import_id,
  jsonb_set(report,'{sources,0,sha256}',to_jsonb(repeat('b',64)))),
  '22023','Analysis must refer to the original accepted files','A result cannot refer to replaced image bytes') from analysis_cases where label = 'image';
select throws_ok(format('select valtrim.record_customer_service_import_analysis(%L,%L::jsonb)',import_id,
  report || '{"workflowStage":"READY_TO_PROPOSE"}'),'22023','Analysis report has an invalid schema or identity',
  'Analysis cannot inject a request workflow stage') from analysis_cases where label = 'ready';
select throws_ok(format('select valtrim.record_customer_service_import_analysis(%L,%L::jsonb)',import_id,
  jsonb_set(report,'{importId}',to_jsonb(gen_random_uuid()))),'22023','Analysis report has an invalid schema or identity',
  'Report identity must match the locked import') from analysis_cases where label = 'ready';
select throws_ok(format('select valtrim.record_customer_service_import_analysis(%L,%L::jsonb)',import_id,
  jsonb_set(report,'{intakePayload}',(report -> 'intakePayload') || '{"workflowStage":"READY_TO_PROPOSE"}')),
  '22023','Import intake must contain only property, request, contacts and items',
  'Existing intake business validation also protects the proposal') from analysis_cases where label = 'ready';
select throws_ok(format('select valtrim.record_customer_service_import_analysis(%L,%L::jsonb)',import_id,
  jsonb_set(report,'{intakePayload,contacts,0,name}','null')),'22023','The homeowner name is required for an imported request',
  'A ready report cannot fake the mandatory homeowner') from analysis_cases where label = 'ready';
select throws_ok(format('select valtrim.record_customer_service_import_analysis(%L,%L::jsonb)',import_id,
  jsonb_set(report,'{sources,0,status}','"FAILED"')),'22023','A failed or empty analysis cannot be ready for intake',
  'Failed source analysis cannot be labeled ready') from analysis_cases where label = 'ready';
update analysis_cases set report = report || '{"outcome":"NEEDS_ATTENTION","issues":["MISSING_HOMEOWNER"],"intakePayload":null}'
  where label = 'minimum missing';
update analysis_cases set report = jsonb_set(report || '{"outcome":"NEEDS_ATTENTION","issues":["ANALYSIS_FAILED:email:text:1"],"intakePayload":null}',
  '{sources,0,status}','"FAILED"') where label = 'source failure';
update analysis_cases set result = valtrim.record_customer_service_import_analysis(import_id,report)
  where label <> 'unavailable';
select is((select count(*) from valtrim.service_requests),baseline_requests,'Recording analysis allocates no request or folio') from analysis_fixture;
select is((select count(*) from valtrim.service_properties),baseline_properties,'Recording analysis creates no orphan property') from analysis_fixture;
select ok(receipt.analysis_payload = cases.report and receipt.analysis_created_at is not null
  and receipt.request_id is null and receipt.source_payload ->> 'bodyText' = 'Elena Rivera, adjust door',
  cases.label || ': analysis retained separately without modifying the original source')
from valtrim.service_request_imports receipt join analysis_cases cases on cases.import_id = receipt.id where cases.label <> 'unavailable';
select is(receipt.status::text,'NEEDS_ATTENTION',cases.label || ': incomplete/failed analysis remains a technical problem')
  from valtrim.service_request_imports receipt join analysis_cases cases on cases.import_id = receipt.id where cases.label in ('minimum missing','source failure');
select is(receipt.error_code,'ANALYSIS_FAILED','Source failure has a technical error code')
  from valtrim.service_request_imports receipt join analysis_cases cases on cases.import_id = receipt.id where cases.label = 'source failure';
select is(receipt.error_code,'ANALYSIS_INCOMPLETE','Missing minimum differs from a provider/read failure')
  from valtrim.service_request_imports receipt join analysis_cases cases on cases.import_id = receipt.id where cases.label = 'minimum missing';
update analysis_cases cases set snapshot = to_jsonb(receipt) from valtrim.service_request_imports receipt where receipt.id = cases.import_id;
select is(valtrim.record_customer_service_import_analysis(import_id,report) ->> 'idempotentReplay','true',
  'Identical recording is idempotent') from analysis_cases where label = 'ready';
select is(to_jsonb(receipt),cases.snapshot,'Identical recording does not churn source timestamp or evidence')
  from valtrim.service_request_imports receipt join analysis_cases cases on cases.import_id = receipt.id where cases.label = 'ready';
update analysis_cases cases set request_result = valtrim.save_customer_service_imported_request(cases.import_id,f.payload)
  from analysis_fixture f where cases.label = 'ready';
select is((select workflow_stage::text from valtrim.service_requests where id = (cases.request_result ->> 'requestId')::bigint),
  'NEEDS_REVIEW','The existing save still creates NEEDS_REVIEW, never approval') from analysis_cases cases where label = 'ready';
select ok(receipt.analysis_payload = cases.report and receipt.extraction_payload = f.payload,
  'Block-2 intake save does not replace original per-source analysis with its intake payload')
from valtrim.service_request_imports receipt join analysis_cases cases on cases.import_id = receipt.id cross join analysis_fixture f where cases.label = 'ready';
select is(valtrim.record_customer_service_import_analysis(import_id,'{}') -> 'analysisPayload',report,
  'A late analyzer cannot overwrite evidence once a request exists') from analysis_cases where label = 'ready';
select throws_ok(format('update valtrim.service_request_imports set analysis_payload = ''{}'' where id = %L',import_id),
  '55000','Analysis linked to an existing request cannot be replaced','Direct backend update cannot replace linked analysis') from analysis_cases where label = 'ready';
reset role;

select set_config('request.jwt.claim.sub',admin_id::text,true) from analysis_fixture;
set local role authenticated;
select is(valtrim.read_customer_service_email_import(import_id) -> 'analysis_payload',report,'Active admin can read retained source evidence')
  from analysis_cases where label = 'ready';
select lives_ok(format('select valtrim.update_customer_service_request_intake(%s,%L,%L::jsonb)',
  cases.request_result ->> 'requestId',(select updated_at from valtrim.service_requests where id = (cases.request_result ->> 'requestId')::bigint),
  f.payload || '{"request":{"internalNotes":"Human review in progress"}}'),
  'Existing human partial editor remains available') from analysis_cases cases cross join analysis_fixture f where cases.label = 'ready';
select is(valtrim.read_customer_service_email_import(import_id) -> 'analysis_payload',report,'Human edits preserve extraction evidence')
  from analysis_cases where label = 'ready';
reset role;
select set_config('request.jwt.claim.sub',scheduler_id::text,true) from analysis_fixture;
set local role authenticated;
select lives_ok(format('select valtrim.read_customer_service_email_import(%L)',import_id),'Active scheduler can inspect retained analysis')
  from analysis_cases where label = 'ready';
reset role;
select set_config('request.jwt.claim.sub',denied_id::text,true) from analysis_fixture;
set local role authenticated;
select throws_ok(format('select valtrim.read_customer_service_email_import(%L)',import_id),'42501',null,
  'Read-only role cannot inspect automatic extraction data') from analysis_cases where label = 'ready';
reset role;
select set_config('request.jwt.claim.sub',inactive_id::text,true) from analysis_fixture;
set local role authenticated;
select throws_ok(format('select valtrim.read_customer_service_email_import(%L)',import_id),'42501',null,
  'Inactive admin cannot inspect automatic extraction data') from analysis_cases where label = 'ready';
reset role;
select set_config('request.jwt.claim.sub',admin_id::text,true) from analysis_fixture;
set local role service_role;
select throws_ok(format('select valtrim.record_customer_service_import_analysis(%L,%L::jsonb)',import_id,report),
  '42501','Automatic analysis requires a system context without a user identity','Worker cannot impersonate a human reviewer')
  from analysis_cases where label = 'minimum missing';
reset role;
select * from finish();
rollback;
