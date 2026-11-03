-- Linked remote only; synthetic metadata rolls back. No Graph/Mistral calls,
-- binary objects, live queue claims or migration-history changes.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public,extensions;
select no_plan();
select ok(has_function_privilege('service_role','valtrim.finish_customer_service_email_worker_v2(uuid,uuid,text,text,integer)','EXECUTE')
  and not has_function_privilege('authenticated','valtrim.finish_customer_service_email_worker_v2(uuid,uuid,text,text,integer)','EXECUTE')
  and not has_function_privilege('anon','valtrim.finish_customer_service_email_worker_v2(uuid,uuid,text,text,integer)','EXECUTE'),
  'The delayed finalizer is server-only');

create temporary table image_worker_fixture as select gen_random_uuid() tenant,gen_random_uuid() mailbox,
  '{"subject":"Image worker fixture","bodyText":"Homeowner Elena Rivera. Adjust door."}'::jsonb source,
  '{"contacts":[{"role":"PRIMARY","name":"Elena Rivera"}],"items":[{"description":"Adjust door"}]}'::jsonb intake;
create temporary table image_worker_connection(data jsonb);
create temporary table image_worker_cases(label text,id uuid,claim jsonb,result jsonb);
create temporary table image_worker_history as select id,md5(to_jsonb(i)::text) fingerprint,
  (select md5(coalesce(jsonb_agg(to_jsonb(f) order by attachment_id)::text,'[]')) from valtrim.service_request_import_files f where f.import_id = i.id) links
  from valtrim.service_request_imports i where id = '70288f7b-6169-4963-af47-3f1df7cc967a';
create function pg_temp.worker_image(p_id text) returns jsonb language sql as $test$
  select jsonb_build_object('attachmentId',p_id,'originalFilename','photo.png','mimeType','image/png',
    'sizeBytes',24,'sha256',repeat('a',64),'isInline',true,'contentId','inline@fixture');
$test$;
create function pg_temp.worker_image_analysis(p_id text) returns jsonb language sql as $test$
  select jsonb_build_object('sourceId','attachment:' || p_id,'kind','IMAGE','attachmentId',p_id,'fileId',null,
    'filename','photo.png','sha256',repeat('a',64),'status','ANALYZED','model','fixture',
    'structuredData','{}'::jsonb,'text','Adjust door','pages','[]'::jsonb,'formFields','[]'::jsonb,
    'part',null,'usageInfo','{"total_tokens":5}'::jsonb,'error',null);
$test$;
grant select,insert,update on image_worker_fixture,image_worker_connection,image_worker_cases to service_role;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
insert into image_worker_connection select valtrim.register_customer_service_email_connection(tenant,mailbox,'ImageWorkerFixture','IMPORT_EXISTING') from image_worker_fixture;
update image_worker_connection set data = valtrim.configure_customer_service_email_connection((data ->> 'id')::uuid,(data ->> 'revision')::bigint,true);
update image_worker_connection set data = valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid);
insert into image_worker_cases(label) values ('retry'),('continue'),('complete');
update image_worker_cases c set id = (valtrim.register_customer_service_email_import(f.tenant,f.mailbox::text,'image-worker-' || c.label,'{}') ->> 'importId')::uuid from image_worker_fixture f;
select valtrim.prepare_customer_service_graph_source_v2((c.data ->> 'id')::uuid,(c.data ->> 'sync_token')::uuid,(c.data ->> 'revision')::bigint,
  i.id,f.source,jsonb_build_array(pg_temp.worker_image('I'))) from image_worker_cases i,image_worker_connection c,image_worker_fixture f;
select valtrim.finalize_customer_service_import_source(id) from image_worker_cases;
update image_worker_cases set claim = valtrim.claim_customer_service_email_import_v2(id);
select is(valtrim.read_customer_service_graph_image_source(id,(claim ->> 'workerToken')::uuid) ->> 'connectionAvailable','true',
  'IMPORT_EXISTING images can be read before the first delta finishes') from image_worker_cases where label = 'retry';
select throws_ok(format('select valtrim.read_customer_service_graph_image_source(%L,%L)',id,gen_random_uuid()),'55000',
  'Email worker lease is no longer valid','A stale worker cannot read Graph origin') from image_worker_cases where label = 'retry';
reset role;
update private.customer_service_email_connections set enabled = false,sync_token = null,sync_lease_expires_at = null where id = (select (data ->> 'id')::uuid from image_worker_connection);
set local role service_role;
select is(valtrim.read_customer_service_graph_image_source(id,(claim ->> 'workerToken')::uuid) ->> 'connectionAvailable','false',
  'Disabled origin is a visible source problem, not a lost worker lease') from image_worker_cases where label = 'retry';
reset role;
update private.customer_service_email_connections set enabled = true where id = (select (data ->> 'id')::uuid from image_worker_connection);
set local role service_role;
select lives_ok(format('select valtrim.checkpoint_customer_service_email_worker(%L,%L,%L::jsonb)',id,claim ->> 'workerToken',
  pg_temp.worker_image_analysis('I') || '{"status":"FAILED","structuredData":null,"text":null,"error":{"code":"SOURCE_UNAVAILABLE","message":"Temporary Graph error","retryable":true,"diagnosticCode":"GRAPH_THROTTLED","retryAfterSeconds":1200}}'),
  'A sanitized Graph Retry-After can be checkpointed') from image_worker_cases where label = 'retry';
select throws_ok(format('select valtrim.checkpoint_customer_service_email_worker(%L,%L,%L::jsonb)',id,claim ->> 'workerToken',
  pg_temp.worker_image_analysis('I') || jsonb_build_object('status','FAILED','structuredData',null,
    'error',jsonb_build_object('code','SOURCE_UNAVAILABLE','message','Invalid delay','retryAfterSeconds',bad.delay))),
  '22023','V2 errors must contain known diagnostic fields only','Malformed retry delay is rejected: ' || bad.delay::text)
  from image_worker_cases cross join lateral (values ('-1'::jsonb),('0.5'::jsonb),('2147483648'::jsonb),('"raw secret"'::jsonb)) bad(delay) where label = 'retry';
update image_worker_cases set result = valtrim.finish_customer_service_email_worker_v2(id,(claim ->> 'workerToken')::uuid,'RETRY','SOURCE_UNAVAILABLE',1200) where label = 'retry';
select is(result ->> 'status','PENDING','A transient Graph failure does not create a partial request') from image_worker_cases where label = 'retry';
select ok((result ->> 'nextAttemptAt')::timestamptz >= clock_timestamp() + interval '1199 seconds','Retry-After is retained beyond the ordinary one-minute backoff') from image_worker_cases where label = 'retry';
select ok(valtrim.claim_customer_service_email_import_v2(id) is null,'A repeated worker cannot bypass Graph Retry-After') from image_worker_cases where label = 'retry';
select throws_ok(format('select valtrim.finish_customer_service_email_worker_v2(%L,%L,''CONTINUE'',null,0)',id,claim ->> 'workerToken'),'55000',
  'Email worker lease is no longer valid','An old finalizer cannot replace a scheduled delay') from image_worker_cases where label = 'retry';
select valtrim.checkpoint_customer_service_email_worker(id,(claim ->> 'workerToken')::uuid,pg_temp.worker_image_analysis('I')) from image_worker_cases where label in ('continue','complete');
update image_worker_cases set result = valtrim.finish_customer_service_email_worker_v2(id,(claim ->> 'workerToken')::uuid,'CONTINUE',null,600) where label = 'continue';
select ok((result ->> 'nextAttemptAt')::timestamptz >= clock_timestamp() + interval '599 seconds','A connection cooldown defers cooperative continuation') from image_worker_cases where label = 'continue';
select is(i.worker_failure_count,0,'Cooperative continuation consumes no failure budget') from valtrim.service_request_imports i join image_worker_cases c on i.id = c.id where label = 'continue';
select is(jsonb_array_length(i.worker_checkpoint -> 'sources'),1,'Completed image extraction survives a continuation') from valtrim.service_request_imports i join image_worker_cases c on i.id = c.id where label = 'continue';
reset role;
-- Advance only synthetic fixture timestamps, never sleep or claim the live queue.
update valtrim.service_request_imports set next_attempt_at = clock_timestamp() - interval '1 second' where id in (select id from image_worker_cases where label in ('continue','retry'));
set local role service_role;
update image_worker_cases set claim = valtrim.claim_customer_service_email_import_v2(id) where label in ('continue','retry');
select is(jsonb_array_length(claim #> '{checkpoint,sources}'),1,'Reclaim preserves per-source identity and extraction') from image_worker_cases where label = 'continue';
select valtrim.finish_customer_service_email_worker_v2(id,(claim ->> 'workerToken')::uuid,'RETRY',null,1) from image_worker_cases where label = 'retry';
select ok(i.next_attempt_at >= clock_timestamp() + interval '299 seconds','A short provider delay cannot reduce the ordinary second backoff') from valtrim.service_request_imports i join image_worker_cases c on c.id = i.id where label = 'retry';
reset role;
update valtrim.service_request_imports set next_attempt_at = clock_timestamp() - interval '1 second' where id = (select id from image_worker_cases where label = 'retry');
set local role service_role;
update image_worker_cases set claim = valtrim.claim_customer_service_email_import_v2(id) where label = 'retry';
update image_worker_cases set result = valtrim.finish_customer_service_email_worker_v2(id,(claim ->> 'workerToken')::uuid,'RETRY',null,1200) where label = 'retry';
select is(result ->> 'status','NEEDS_ATTENTION','Three transient failures still exhaust the attempt budget') from image_worker_cases where label = 'retry';
select is(result ->> 'nextAttemptAt',null,'Exhausted work does not schedule an unbounded retry') from image_worker_cases where label = 'retry';
select valtrim.record_customer_service_worker_analysis(c.id,(c.claim ->> 'workerToken')::uuid,jsonb_build_object(
  'schemaVersion','1.0','importId',c.id,'outcome','READY_FOR_INTAKE','sources',i.worker_checkpoint -> 'sources',
  'structuredData','{}'::jsonb,'provenance','{}'::jsonb,'conflicts','[]'::jsonb,'excludedItemIndexes','[]'::jsonb,
  'warnings','[]'::jsonb,'issues','[]'::jsonb,'intakePayload',f.intake))
  from image_worker_cases c join valtrim.service_request_imports i on i.id = c.id cross join image_worker_fixture f where label = 'complete';
update image_worker_cases set result = valtrim.finish_customer_service_email_worker_v2(id,(claim ->> 'workerToken')::uuid,'COMMIT') where label = 'complete';
select ok(result ->> 'requestId' is not null,'Complete V2 image analysis creates a request') from image_worker_cases where label = 'complete';
select ok(r.workflow_stage = 'NEEDS_REVIEW' and r.reviewed_at is null and r.reviewed_by is null,'The worker still requires human approval')
  from valtrim.service_requests r join image_worker_cases c on r.email_import_id = c.id where label = 'complete';
select is(valtrim.finish_customer_service_email_worker_v2(id,gen_random_uuid(),'COMMIT') ->> 'requestId',result ->> 'requestId','A lost commit response replays the same request') from image_worker_cases where label = 'complete';
select is(valtrim.claim_customer_service_email_import_v2(id) ->> 'requestId',result ->> 'requestId','Duplicate processing never creates another request') from image_worker_cases where label = 'complete';
select is((select count(*) from valtrim.stored_files s join image_worker_cases c on s.object_path like 'imports/' || c.id || '/%'),0::bigint,'Image-only worker creates no stored-file records');
select is((select count(*) from valtrim.service_request_import_files f join image_worker_cases c on f.import_id = c.id),0::bigint,'Image-only worker creates no file links');
select is((select count(*) from storage.objects o join image_worker_cases c on o.name like 'imports/' || c.id || '/%'),0::bigint,'Image-only worker creates no Storage objects');
reset role;
select ok(not private.customer_service_import_has_binary(to_jsonb(i)),'No fixture import record contains image transport bytes') from valtrim.service_request_imports i join image_worker_cases c on c.id = i.id;
select ok(md5(to_jsonb(i)::text) = h.fingerprint and h.links =
  (select md5(coalesce(jsonb_agg(to_jsonb(f) order by attachment_id)::text,'[]')) from valtrim.service_request_import_files f where f.import_id = i.id),
  'The real CS-1876 import and its historical file links remain unchanged') from image_worker_history h join valtrim.service_request_imports i on i.id = h.id;
select * from finish();
rollback;
