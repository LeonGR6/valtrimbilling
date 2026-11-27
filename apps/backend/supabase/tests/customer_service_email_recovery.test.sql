begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
create temporary table recovery_fixture as select gen_random_uuid() tenant_id,gen_random_uuid() admin_id,
  gen_random_uuid() scheduler_id,gen_random_uuid() denied_id,gen_random_uuid() inactive_id,
  (select count(*) from valtrim.service_requests) baseline_requests,
  (select count(*) from valtrim.service_properties) baseline_properties;
insert into auth.users(id,email,raw_user_meta_data)
select actor,actor::text || '@example.com','{"name":"Email recovery test"}'::jsonb
from recovery_fixture cross join lateral (values(admin_id),(scheduler_id),(denied_id),(inactive_id)) actors(actor);
update valtrim.app_users set role = 'ADMIN' where id = (select admin_id from recovery_fixture);
update valtrim.app_users set role = 'SCHEDULING' where id = (select scheduler_id from recovery_fixture);
update valtrim.app_users set role = 'READ_ONLY' where id = (select denied_id from recovery_fixture);
update valtrim.app_users set role = 'ADMIN',is_active = false where id = (select inactive_id from recovery_fixture);
create temporary table recovery_cases(label text primary key,id uuid,original jsonb,result jsonb);
insert into recovery_cases(label) values ('manual'),('pdf'),('invalid'),('retry'),('reserved'),('continuation');
grant select,update on recovery_fixture,recovery_cases to authenticated,service_role;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
update recovery_cases set id = (valtrim.register_customer_service_email_import(f.tenant_id,'recovery-test',label,
  '{"subject":"Original","webLink":"https://outlook.office.com/mail/test","from":"builder@example.com","bodyText":"Original text"}') ->> 'importId')::uuid
from recovery_fixture f;
select valtrim.reject_customer_service_import_source(id,'ATTACHMENT_FORMAT','Original attachment rejected')
from recovery_cases where label in ('manual','pdf','invalid');
do $fixture$
declare r record;
begin
  for r in select cases.id,receipt.source_payload from recovery_cases cases
    join valtrim.service_request_imports receipt on receipt.id = cases.id
    where label in ('retry','reserved','continuation') loop
    perform valtrim.prepare_customer_service_import_source(r.id,r.source_payload,'[]');
    perform valtrim.finalize_customer_service_import_source(r.id);
  end loop;
end;
$fixture$;
update valtrim.service_request_imports set status = 'NEEDS_ATTENTION',error_code = 'ANALYSIS_FAILED',
  error_message = 'Original analysis failure',worker_failure_count = 3 where id in (select id from recovery_cases where label in ('retry','reserved','continuation'));
update recovery_cases c set original = jsonb_build_object('source',r.source_payload,'manifest',r.source_manifest,
  'analysis',r.analysis_payload,'refs',r.attachment_refs,'sourceStatus',r.source_status)
from valtrim.service_request_imports r where r.id = c.id;
reset role;
select set_config('request.jwt.claim.sub',admin_id::text,true) from recovery_fixture;
set local role authenticated;
select ok(has_function_privilege('authenticated','valtrim.recover_customer_service_email_import(uuid,timestamptz,jsonb,jsonb)','EXECUTE'),
  'Human recovery is available to authenticated actors');
select ok(not has_column_privilege('authenticated','valtrim.service_requests','email_import_id','INSERT')
  and not has_column_privilege('authenticated','valtrim.service_requests','submission_key','INSERT'),
  'The browser cannot bypass the recovery RPC by forging an imported request insert');
select ok(not has_function_privilege('anon','valtrim.recover_customer_service_email_import(uuid,timestamptz,jsonb,jsonb)','EXECUTE')
  and not has_function_privilege('service_role','valtrim.retry_customer_service_email_import(uuid,timestamptz)','EXECUTE'),
  'Anonymous and system callers cannot impersonate a human retry');
select throws_ok(format('select valtrim.retry_customer_service_email_import(%L,%L)',id,r.updated_at),
  '55000','Original source unavailable: recover with a valid PDF or the form','Rejected attachments cannot be requeued')
from recovery_cases c join valtrim.service_request_imports r using(id) where label = 'manual';
select throws_ok(format('select valtrim.recover_customer_service_email_import(%L,%L,%L)',c.id,r.updated_at - interval '1 second','{}'),
  '40001','The import changed. Refresh before recovering','Recovery rejects a stale form version')
from recovery_cases c join valtrim.service_request_imports r using(id) where label = 'manual';
select throws_ok(format('select valtrim.recover_customer_service_email_import(%L,%L,%L)',c.id,r.updated_at,
  '{"contacts":[{"role":"PRIMARY"}],"items":[{"description":"Adjust door"}]}'),
  '22023','The homeowner name is required for an imported request','Homeowner minimum is enforced')
from recovery_cases c join valtrim.service_request_imports r using(id) where label = 'invalid';
select throws_ok(format('select valtrim.recover_customer_service_email_import(%L,%L,%L)',c.id,r.updated_at,
  '{"contacts":[{"role":"PRIMARY","name":"Elena Rivera"}],"items":[]}'),
  '22023','Provide between 1 and 25 described work items','Described item minimum is enforced')
from recovery_cases c join valtrim.service_request_imports r using(id) where label = 'invalid';
select throws_ok(format('select valtrim.recover_customer_service_email_import(%L,%L,%L)',c.id,r.updated_at,
  '{"workflowStage":"READY_TO_PROPOSE"}'), '22023',
  'Import intake must contain only property, request, contacts and items','Recovery cannot inject approval')
from recovery_cases c join valtrim.service_request_imports r using(id) where label = 'invalid';
select is((select count(*) from valtrim.service_requests),baseline_requests,'Invalid recovery creates no request') from recovery_fixture;
select is((select count(*) from valtrim.service_properties),baseline_properties,'Invalid recovery creates no orphan property') from recovery_fixture;
update recovery_cases c set result = valtrim.recover_customer_service_email_import(c.id,r.updated_at,
  '{"contacts":[{"role":"PRIMARY","name":"Elena Rivera"}],"items":[{"description":"Adjust door"}]}')
from valtrim.service_request_imports r where c.id = r.id and c.label = 'manual';
select is(result #>> '{request,workflow_stage}','NEEDS_REVIEW','Manual recovery never approves') from recovery_cases where label = 'manual';
select is(result #>> '{request,email_import_id}',id::text,'Manual recovery links the original receipt') from recovery_cases where label = 'manual';
select is(result #>> '{request,submission_key}',id::text,'Recovery uses the same stable submission key') from recovery_cases where label = 'manual';
select ok(result #> '{request,reviewed_at}' = 'null'::jsonb and result #> '{request,reviewed_by}' = 'null'::jsonb
  and result #> '{request,valtrim_items_confirmed}' = 'false'::jsonb,'Human recovery is not human approval') from recovery_cases where label = 'manual';
select is(result #>> '{request,created_by}',f.admin_id::text,'The real authenticated recovery actor is recorded')
from recovery_cases cross join recovery_fixture f where label = 'manual';
select is(r.status::text,'PROCESSED','Manual recovery resolves the technical import')
from recovery_cases c join valtrim.service_request_imports r using(id) where label = 'manual';
select is(r.source_status,'REJECTED','Recovery does not certify rejected original files')
from recovery_cases c join valtrim.service_request_imports r using(id) where label = 'manual';
select is(jsonb_build_object('source',r.source_payload,'manifest',r.source_manifest,'analysis',r.analysis_payload,
  'refs',r.attachment_refs,'sourceStatus',r.source_status),original,'Original email, analysis and file manifest remain immutable')
from recovery_cases c join valtrim.service_request_imports r using(id) where label = 'manual';
select is((valtrim.recover_customer_service_email_import(id,null,'{}') #>> '{request,id}'),result #>> '{request,id}',
  'Lost response / concurrent winner returns the existing request without applying stale values') from recovery_cases where label = 'manual';
select is((select count(*) from valtrim.service_requests),baseline_requests + 1,'Replay never duplicates the request') from recovery_fixture;
select throws_ok(format('select valtrim.recover_customer_service_email_import(%L,%L,%L,%L)',c.id,r.updated_at,
  '{"contacts":[{"role":"PRIMARY","name":"Elena Rivera"}],"items":[{"description":"Adjust door"}]}',
  '{"sourceType":"PDF","objectPath":"forged/path"}'), '22023','Invalid recovery PDF metadata','PDF paths cannot be supplied by the browser')
from recovery_cases c join valtrim.service_request_imports r using(id) where label = 'pdf';
update recovery_cases c set result = valtrim.recover_customer_service_email_import(c.id,r.updated_at,
  '{"contacts":[{"role":"PRIMARY","name":"Elena Rivera"}],"items":[{"description":"Adjust door"}]}',
  jsonb_build_object('sourceType','PDF','extractedText','Recovery OCR','extractionPayload','{"test":true}'::jsonb,
    'reviewNotes','["Review"]'::jsonb,'sha256',repeat('a',64),'sizeBytes',6,'originalFilename','recovery.pdf'))
from valtrim.service_request_imports r where c.id = r.id and c.label = 'pdf';
select is(result #>> '{source,file_status}','PENDING','Recovery PDF starts pending, not falsely available') from recovery_cases where label = 'pdf';
select is(result #>> '{source,extracted_text}','Recovery OCR','Recovery extraction is retained separately from the original') from recovery_cases where label = 'pdf';
select is(r.error_code,'RECOVERY_PDF_PENDING','Interrupted PDF upload remains visible as a technical problem')
from recovery_cases c join valtrim.service_request_imports r using(id) where label = 'pdf';
select is((select recovery_pdf_sha256 from valtrim.service_request_sources where request_id = (result #>> '{request,id}')::bigint),
  repeat('a',64),'The chosen PDF identity is pinned at the same time as request creation') from recovery_cases where label = 'pdf';
select throws_ok(format('select valtrim.complete_customer_service_email_recovery(%L)',id),
  '55000','The recovery PDF is not available yet','A pending PDF cannot be dismissed as completed') from recovery_cases where label = 'pdf';
reset role;
-- Storage metadata fixture only; no binary upload or provider call is implied.
insert into storage.objects(bucket_id,name,metadata)
select 'customer-service-sources',format('requests/%s/source.pdf',result #>> '{request,id}'),
  '{"mimetype":"application/pdf","size":6}' from recovery_cases where label = 'pdf';
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select throws_ok(format('select valtrim.finalize_customer_service_source_pdf_upload(%s,%L,%L,6,%L)',
  result #>> '{request,id}',f.admin_id,'recovery.pdf',repeat('b',64)),'55000',
  'The uploaded PDF differs from the pinned recovery source','A competing PDF cannot finalize even through the storage RPC')
from recovery_cases cross join recovery_fixture f where label = 'pdf';
select valtrim.finalize_customer_service_source_pdf_upload((result #>> '{request,id}')::bigint,f.admin_id,'recovery.pdf',6,repeat('a',64))
from recovery_cases cross join recovery_fixture f where label = 'pdf';
reset role;
select set_config('request.jwt.claim.sub',scheduler_id::text,true) from recovery_fixture;
set local role authenticated;
update recovery_cases set result = valtrim.complete_customer_service_email_recovery(id) where label = 'pdf';
select is(result #>> '{source,file_status}','AVAILABLE','Confirmed PDF metadata completes recovery') from recovery_cases where label = 'pdf';
select is(r.status::text,'PROCESSED','The resolved PDF problem leaves the errors counter')
from recovery_cases c join valtrim.service_request_imports r using(id) where label = 'pdf';
select is(result #>> '{request,workflow_stage}','NEEDS_REVIEW','Completing storage does not approve the request') from recovery_cases where label = 'pdf';
select lives_ok(format('select valtrim.complete_customer_service_email_recovery(%L)',id),'Finalization is idempotent') from recovery_cases where label = 'pdf';
select is(jsonb_build_object('source',r.source_payload,'manifest',r.source_manifest,'analysis',r.analysis_payload,
  'refs',r.attachment_refs,'sourceStatus',r.source_status),original,'Recovery PDF never replaces the rejected original')
from recovery_cases c join valtrim.service_request_imports r using(id) where label = 'pdf';
select throws_ok(format('select valtrim.retry_customer_service_email_import(%L,%L)',c.id,r.updated_at - interval '1 second'),
  '40001','The import changed. Refresh before retrying','Retry rejects stale versions')
from recovery_cases c join valtrim.service_request_imports r using(id) where label = 'retry';
update recovery_cases c set result = valtrim.retry_customer_service_email_import(c.id,r.updated_at)
from valtrim.service_request_imports r where c.id = r.id and c.label = 'retry';
select is(result ->> 'status','PENDING','Authorized retry queues the same receipt') from recovery_cases where label = 'retry';
select is(r.worker_failure_count,0,'A fresh authorized retry resets its bounded failure budget')
from recovery_cases c join valtrim.service_request_imports r using(id) where label = 'retry';
select is((valtrim.retry_customer_service_email_import(c.id,null) ->> 'idempotentReplay')::boolean,true,
  'Queue replay does not enqueue a second import') from recovery_cases c where label = 'retry';
select is(valtrim.hold_customer_service_email_retry(id) ->> 'errorCode','WORKER_CONTINUATION_REQUIRED',
  'Manual budget continuation stays visible without relying on a scheduler') from recovery_cases where label = 'retry';
select is(r.status::text,'NEEDS_ATTENTION','Continuation is available after a browser reload')
from recovery_cases c join valtrim.service_request_imports r using(id) where label = 'retry';
reset role;
update valtrim.service_request_imports set status = 'PENDING',error_code = 'WORKER_TEMPORARY_FAILURE',
  error_message = 'Temporary',worker_failure_count = 1,next_attempt_at = clock_timestamp() + interval '5 minutes'
where id = (select id from recovery_cases where label = 'continuation');
select set_config('request.jwt.claim.sub',admin_id::text,true) from recovery_fixture;
set local role authenticated;
select is(valtrim.hold_customer_service_email_retry(id) ->> 'errorCode','WORKER_TEMPORARY_FAILURE',
  'Temporary manual retry preserves backoff reason') from recovery_cases where label = 'continuation';
select is(valtrim.retry_customer_service_email_import(c.id,r.updated_at) ->> 'status','NEEDS_ATTENTION',
  'Continue cannot bypass a future retry time') from recovery_cases c join valtrim.service_request_imports r using(id) where label = 'continuation';
select is(r.worker_failure_count,1,'Waiting does not reset the failure budget')
from recovery_cases c join valtrim.service_request_imports r using(id) where label = 'continuation';
reset role;
update valtrim.service_request_imports set next_attempt_at = clock_timestamp() - interval '1 second'
where id = (select id from recovery_cases where label = 'continuation');
select set_config('request.jwt.claim.sub',admin_id::text,true) from recovery_fixture;
set local role authenticated;
select is(valtrim.retry_customer_service_email_import(c.id,r.updated_at) ->> 'status','PENDING',
  'Due continuation can be processed') from recovery_cases c join valtrim.service_request_imports r using(id) where label = 'continuation';
select is(r.worker_failure_count,1,'Due continuation still preserves the bounded failure budget')
from recovery_cases c join valtrim.service_request_imports r using(id) where label = 'continuation';
reset role;
update valtrim.service_request_imports set status = 'PROCESSING',attempt_count = 1,last_attempt_at = clock_timestamp(),
  processing_started_at = clock_timestamp(),worker_token = gen_random_uuid(),worker_lease_expires_at = clock_timestamp() + interval '3 minutes'
where id = (select id from recovery_cases where label = 'reserved');
select set_config('request.jwt.claim.sub',admin_id::text,true) from recovery_fixture;
set local role authenticated;
select throws_ok(format('select valtrim.recover_customer_service_email_import(%L,%L,%L)',c.id,r.updated_at,'{}'),
  '55000','Only an unreserved import requiring attention can be recovered','Human recovery cannot steal an active worker lease')
from recovery_cases c join valtrim.service_request_imports r using(id) where label = 'reserved';
select is(valtrim.hold_customer_service_email_retry(id) ->> 'status','PROCESSING','A late hold cannot overwrite an active worker')
from recovery_cases where label = 'reserved';
select is(valtrim.retry_customer_service_email_import(c.id,r.updated_at) ->> 'status','PROCESSING',
  'A second human retry cannot steal an active reservation') from recovery_cases c join valtrim.service_request_imports r using(id) where label = 'reserved';
reset role;
update valtrim.service_request_imports set worker_lease_expires_at = clock_timestamp() - interval '1 second'
where id = (select id from recovery_cases where label = 'reserved');
select set_config('request.jwt.claim.sub',admin_id::text,true) from recovery_fixture;
set local role authenticated;
select is(valtrim.retry_customer_service_email_import(c.id,r.updated_at) ->> 'status','PENDING',
  'An expired reservation can resume through the worker fencing protocol') from recovery_cases c join valtrim.service_request_imports r using(id) where label = 'reserved';
select ok((select count(*) >= 4 from valtrim.audit_events where entity_id in(select id::text from recovery_cases)
  and actor_type = 'USER' and actor_user_id in(f.admin_id,f.scheduler_id)),'Recovery and retry have authenticated audit events') from recovery_fixture f;
reset role;
select set_config('request.jwt.claim.sub',denied_id::text,true) from recovery_fixture;
set local role authenticated;
select throws_ok(format('select valtrim.recover_customer_service_email_import(%L,null,%L)',id,'{}'),
  '42501','You do not have permission to manage Customer Service requests','READ_ONLY recovery is denied') from recovery_cases where label = 'invalid';
select throws_ok(format('select valtrim.retry_customer_service_email_import(%L,null)',id),
  '42501','You do not have permission to manage Customer Service requests','READ_ONLY retry is denied') from recovery_cases where label = 'invalid';
reset role;
select set_config('request.jwt.claim.sub',inactive_id::text,true) from recovery_fixture;
set local role authenticated;
select throws_ok(format('select valtrim.complete_customer_service_email_recovery(%L)',id),
  '42501','You do not have permission to manage Customer Service requests','Inactive actor cannot finalize recovery') from recovery_cases where label = 'pdf';
reset role;
select is((select count(*) from valtrim.service_requests),baseline_requests + 2,'All retries and replays leave exactly two recovered requests') from recovery_fixture;
select * from finish();
rollback;
