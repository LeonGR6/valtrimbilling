-- Linked remote only; install 20261022200000 first. All fixtures roll back.
-- No mailbox, provider calls, Storage binaries, cron or real queue consumption.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select has_column('valtrim','service_request_imports','worker_token','Worker fencing token exists');
select has_column('valtrim','service_request_imports','worker_checkpoint','Successful source checkpoints are durable');
select ok(has_function_privilege('service_role','valtrim.claim_customer_service_email_import(uuid)','EXECUTE')
  and not has_function_privilege('authenticated','valtrim.claim_customer_service_email_import(uuid)','EXECUTE')
  and not has_function_privilege('anon','valtrim.claim_customer_service_email_import(uuid)','EXECUTE'),'Only backend can claim work');
select ok(not has_function_privilege('service_role','private.record_customer_service_import_analysis(uuid,jsonb)','EXECUTE')
  and not has_function_privilege('service_role','private.save_customer_service_imported_request_with_source(uuid,jsonb)','EXECUTE'),
  'Backend cannot bypass the leased wrappers through private implementations');

create temporary table worker_fixture as select gen_random_uuid() tenant_id,
  (select count(*) from valtrim.service_requests) baseline_requests,
  '{"contacts":[{"role":"PRIMARY","name":"Elena Rivera"}],"items":[{"description":"Adjust entry door"}]}'::jsonb intake,
  '{"bodyText":"Homeowner Elena Rivera; adjust entry door","webLink":"https://outlook.office.com/mail/"}'::jsonb source;
create temporary table worker_cases(label text primary key,import_id uuid,claim jsonb,old_claim jsonb,report jsonb,result jsonb);
insert into worker_cases(label) values ('ready'),('retry'),('resume'),('expired'),('attention'),('unavailable'),('rejected'),('invalid save');
grant select,update on worker_fixture,worker_cases to service_role;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
update worker_cases cases set import_id = (valtrim.register_customer_service_email_import(f.tenant_id,'worker-test',cases.label,f.source) ->> 'importId')::uuid
  from worker_fixture f;
select valtrim.prepare_customer_service_import_source(cases.import_id,f.source,'[]') from worker_cases cases cross join worker_fixture f
  where cases.label not in ('unavailable','rejected');
select valtrim.finalize_customer_service_import_source(import_id) from worker_cases where label not in ('unavailable','rejected');
select valtrim.reject_customer_service_import_source(import_id,'ATTACHMENT_FORMAT','Unsupported attachment') from worker_cases where label = 'rejected';
select ok(valtrim.claim_customer_service_email_import(import_id) is null,'Unavailable source is not claimed') from worker_cases where label = 'unavailable';
-- Functions returning SQL NULL are tested explicitly, not confused with JSON null.
select ok(valtrim.claim_customer_service_email_import(import_id) is null,'Rejected source is not claimed') from worker_cases where label = 'rejected';
update worker_cases set claim = valtrim.claim_customer_service_email_import(import_id) where label not in ('unavailable','rejected');
select ok(claim ->> 'workerToken' is not null and claim ->> 'status' = 'PROCESSING',label || ': complete source claimed')
  from worker_cases where label not in ('unavailable','rejected');
select ok(valtrim.claim_customer_service_email_import(import_id) is null,'Occupied import is not processed concurrently') from worker_cases where label = 'ready';
select is((select count(*) from valtrim.service_requests),baseline_requests,'Claiming work creates no request') from worker_fixture;
update worker_cases cases set report = jsonb_build_object('schemaVersion','1.0','importId',cases.import_id,'outcome','READY_FOR_INTAKE',
  'sources',jsonb_build_array(jsonb_build_object('sourceId','email:text:1','kind','EMAIL','status','ANALYZED','attachmentId',null,
    'fileId',null,'structuredData','{}'::jsonb,'error',null)),
  'structuredData','{}'::jsonb,'provenance','{}'::jsonb,'conflicts','[]'::jsonb,'excludedItemIndexes','[]'::jsonb,
  'warnings','[]'::jsonb,'issues','[]'::jsonb,'intakePayload',f.intake) from worker_fixture f;
select throws_ok(format('select valtrim.record_customer_service_import_analysis(%L,%L::jsonb)',import_id,report),
  '55000','Reserved imports require a worker token','Original analysis endpoint cannot bypass worker fencing') from worker_cases where label = 'ready';
select throws_ok(format('select valtrim.save_customer_service_imported_request(%L,%L::jsonb)',import_id,report -> 'intakePayload'),
  '55000','Reserved imports require a worker token','Original intake endpoint cannot bypass worker fencing') from worker_cases where label = 'ready';
select throws_ok(format('select valtrim.finish_customer_service_email_worker(%L,%L,''COMMIT'')',import_id,claim ->> 'workerToken'),
  '22023','A complete ready analysis is required before creating a request','Worker cannot commit without a retained complete analysis') from worker_cases where label = 'ready';
select throws_ok(format('select valtrim.checkpoint_customer_service_email_worker(%L,%L,%L::jsonb)',import_id,claim ->> 'workerToken',
  (report #> '{sources,0}') || '{"status":"FAILED"}'),'22023','Invalid source checkpoint','Failed extraction cannot contain successful facts') from worker_cases where label = 'resume';
select valtrim.checkpoint_customer_service_email_worker(import_id,(claim ->> 'workerToken')::uuid,report #> '{sources,0}') from worker_cases where label = 'resume';
select valtrim.checkpoint_customer_service_email_worker(import_id,(claim ->> 'workerToken')::uuid,report #> '{sources,0}') from worker_cases where label = 'resume';
select is(jsonb_array_length(receipt.worker_checkpoint -> 'sources'),1,'Repeated checkpoint retains one source identity')
  from valtrim.service_request_imports receipt join worker_cases cases on cases.import_id = receipt.id where cases.label = 'resume';
update worker_cases set result = valtrim.finish_customer_service_email_worker(import_id,(claim ->> 'workerToken')::uuid,'CONTINUE') where label = 'resume';
select is(result ->> 'status','PENDING','Budget continuation is pending, not an error') from worker_cases where label = 'resume';
select is(receipt.worker_failure_count,0,'Continuation does not consume failure budget') from valtrim.service_request_imports receipt join worker_cases cases on cases.import_id = receipt.id where cases.label = 'resume';
update worker_cases set old_claim = claim,claim = valtrim.claim_customer_service_email_import(import_id) where label = 'resume';
select ok(claim ->> 'workerToken' <> old_claim ->> 'workerToken' and jsonb_array_length(claim #> '{checkpoint,sources}') = 1,
  'Continuation has a new reservation and retains successful source work') from worker_cases where label = 'resume';

update valtrim.service_request_imports receipt set worker_lease_expires_at = clock_timestamp() - interval '1 second'
  from worker_cases cases where cases.import_id = receipt.id and cases.label = 'expired';
update worker_cases set old_claim = claim,claim = valtrim.claim_customer_service_email_import(import_id) where label = 'expired';
select ok(claim ->> 'workerToken' <> old_claim ->> 'workerToken','An abandoned lease can be recovered with a new token') from worker_cases where label = 'expired';
select is(receipt.worker_failure_count,1,'Interrupted execution consumes a failure attempt') from valtrim.service_request_imports receipt join worker_cases cases on cases.import_id = receipt.id where cases.label = 'expired';
select throws_ok(format('select valtrim.renew_customer_service_email_worker(%L,%L)',import_id,old_claim ->> 'workerToken'),
  '55000','Email worker lease is no longer valid','Old worker cannot renew replacement reservation') from worker_cases where label = 'expired';
select throws_ok(format('select valtrim.record_customer_service_worker_analysis(%L,%L,%L::jsonb)',import_id,old_claim ->> 'workerToken',report),
  '55000','Email worker lease is no longer valid','Old worker cannot replace analysis') from worker_cases where label = 'expired';
select throws_ok(format('select valtrim.finish_customer_service_email_worker(%L,%L,''ATTENTION'')',import_id,old_claim ->> 'workerToken'),
  '55000','Email worker lease is no longer valid','Old worker cannot overwrite replacement result') from worker_cases where label = 'expired';

update worker_cases set result = valtrim.finish_customer_service_email_worker(import_id,(claim ->> 'workerToken')::uuid,'RETRY') where label = 'retry';
select is(result ->> 'status','PENDING','First temporary failure schedules retry') from worker_cases where label = 'retry';
select ok(receipt.next_attempt_at > clock_timestamp() + interval '50 seconds' and receipt.next_attempt_at < clock_timestamp() + interval '70 seconds',
  'First retry waits approximately one minute') from valtrim.service_request_imports receipt join worker_cases cases on cases.import_id = receipt.id where cases.label = 'retry';
select ok(valtrim.claim_customer_service_email_import(import_id) is null,'A future retry is not claimed early') from worker_cases where label = 'retry';
update valtrim.service_request_imports receipt set next_attempt_at = clock_timestamp() - interval '1 second' from worker_cases cases where cases.import_id = receipt.id and cases.label = 'retry';
update worker_cases set claim = valtrim.claim_customer_service_email_import(import_id) where label = 'retry';
update worker_cases set result = valtrim.finish_customer_service_email_worker(import_id,(claim ->> 'workerToken')::uuid,'RETRY') where label = 'retry';
select ok(receipt.next_attempt_at > clock_timestamp() + interval '290 seconds' and receipt.next_attempt_at < clock_timestamp() + interval '310 seconds',
  'Second retry backs off approximately five minutes') from valtrim.service_request_imports receipt join worker_cases cases on cases.import_id = receipt.id where cases.label = 'retry';
update valtrim.service_request_imports receipt set next_attempt_at = clock_timestamp() - interval '1 second' from worker_cases cases where cases.import_id = receipt.id and cases.label = 'retry';
update worker_cases set claim = valtrim.claim_customer_service_email_import(import_id) where label = 'retry';
update worker_cases set result = valtrim.finish_customer_service_email_worker(import_id,(claim ->> 'workerToken')::uuid,'RETRY') where label = 'retry';
select is(result ->> 'status','NEEDS_ATTENTION','Third temporary failure stops automatic retries') from worker_cases where label = 'retry';
select is(result ->> 'errorCode','WORKER_RETRIES_EXHAUSTED','Retry exhaustion has an operational reason') from worker_cases where label = 'retry';
select ok(valtrim.claim_customer_service_email_import(import_id) is null,'Exhausted imports do not loop forever') from worker_cases where label = 'retry';

update worker_cases set report = report || '{"outcome":"NEEDS_ATTENTION","issues":["MISSING_HOMEOWNER"],"intakePayload":null}' where label = 'attention';
select valtrim.record_customer_service_worker_analysis(import_id,(claim ->> 'workerToken')::uuid,report) from worker_cases where label in ('ready','attention','invalid save');
update worker_cases set result = valtrim.finish_customer_service_email_worker(import_id,(claim ->> 'workerToken')::uuid,'ATTENTION','ANALYSIS_INCOMPLETE') where label = 'attention';
select ok(receipt.status = 'NEEDS_ATTENTION' and receipt.request_id is null and receipt.analysis_payload = cases.report
  and receipt.worker_token is null and receipt.error_code = 'ANALYSIS_INCOMPLETE','Missing minimum retains evidence without automatic request')
  from valtrim.service_request_imports receipt join worker_cases cases on cases.import_id = receipt.id where cases.label = 'attention';
update worker_cases set result = valtrim.finish_customer_service_email_worker(import_id,(claim ->> 'workerToken')::uuid,'COMMIT') where label = 'ready';
select ok(result ->> 'requestId' is not null and result ->> 'status' = 'PROCESSED','Complete worker processing confirms the linked request') from worker_cases where label = 'ready';
select ok(request.workflow_stage = 'NEEDS_REVIEW' and request.reviewed_at is null and request.reviewed_by is null,
  'Automatic worker cannot approve the request') from valtrim.service_requests request join worker_cases cases on request.email_import_id = cases.import_id where cases.label = 'ready';
select ok(receipt.worker_token is null and receipt.analysis_payload = cases.report and receipt.extraction_payload = f.intake,
  'Commit clears reservation and retains source analysis separately from intake') from valtrim.service_request_imports receipt
  join worker_cases cases on cases.import_id = receipt.id cross join worker_fixture f where cases.label = 'ready';
select is(valtrim.finish_customer_service_email_worker(import_id,gen_random_uuid(),'COMMIT') ->> 'idempotentReplay','true',
  'Lost commit response replays the same linked request') from worker_cases where label = 'ready';
select is(valtrim.claim_customer_service_email_import(import_id) ->> 'requestId',result ->> 'requestId',
  'Repeated invocation reconciles existing request without inference') from worker_cases where label = 'ready';
select is((select count(*) from valtrim.service_requests),baseline_requests + 1,'All retries and continuations produced only one request') from worker_fixture;

-- Simulate a business/catalog change between validated analysis and save. The
-- existing writer must reject it transactionally rather than claim success.
update valtrim.service_request_imports receipt set analysis_payload = jsonb_set(receipt.analysis_payload,'{intakePayload,contacts,0,name}','null')
  from worker_cases cases where receipt.id = cases.import_id and cases.label = 'invalid save';
update worker_cases set result = valtrim.finish_customer_service_email_worker(import_id,(claim ->> 'workerToken')::uuid,'COMMIT') where label = 'invalid save';
select ok(result ->> 'status' = 'NEEDS_ATTENTION' and result ->> 'requestId' is null,'Invalid saver result is never processing success') from worker_cases where label = 'invalid save';
select is((select count(*) from valtrim.service_requests),baseline_requests + 1,'Failed save leaves no partial business request') from worker_fixture;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
select throws_ok('select valtrim.claim_customer_service_email_import(null)','42501','Email worker requires a system context','Worker does not impersonate a signed-in human');
reset role;
select * from finish();
rollback;
