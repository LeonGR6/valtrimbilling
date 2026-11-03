-- Linked remote; synthetic metadata only, scoped claims, no providers or files.
-- Preview the pending migration with npm run db:test -- --preview-migration ...
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public,extensions;
select no_plan();

create temporary table text_repair_fixture as select gen_random_uuid() tenant,gen_random_uuid() mailbox,
  '{"bodyText":"Homeowner Elena Rivera. Adjust door."}'::jsonb source,
  '{"contacts":[{"role":"PRIMARY","name":"Elena Rivera"}],"items":[{"description":"Adjust door"}]}'::jsonb intake;
create temporary table text_repair_connection(data jsonb);
create temporary table text_repair_cases(label text,id uuid,claim jsonb,result jsonb);
create function pg_temp.repair_image(p_id text) returns jsonb language sql as $test$
  select jsonb_build_object('attachmentId',p_id,'originalFilename','photo.png','mimeType','image/png',
    'sizeBytes',24,'sha256',repeat('a',64),'isInline',true,'contentId','inline@fixture');
$test$;
create function pg_temp.repair_source(p_kind text,p_id text default null) returns jsonb language sql as $test$
  select jsonb_build_object('sourceId',case when p_kind = 'EMAIL' then 'email:text:1' else 'attachment:' || p_id end,
    'kind',p_kind,'attachmentId',p_id,'fileId',null,'filename',case when p_kind = 'IMAGE' then 'photo.png' end,
    'sha256',case when p_kind = 'IMAGE' then repeat('a',64) end,'status','ANALYZED','model','fixture',
    'structuredData','{}'::jsonb,'text',case when p_kind = 'EMAIL' then 'Homeowner Elena Rivera. Adjust door.' end,
    'pages','[]'::jsonb,'formFields','[]'::jsonb,'part',null,'usageInfo',null,'error',null);
$test$;
grant select,insert,update on text_repair_fixture,text_repair_connection,text_repair_cases to service_role;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
insert into text_repair_connection select valtrim.register_customer_service_email_connection(tenant,mailbox,'TextRepairFixture','IMPORT_EXISTING') from text_repair_fixture;
update text_repair_connection set data = valtrim.configure_customer_service_email_connection((data ->> 'id')::uuid,(data ->> 'revision')::bigint,true);
update text_repair_connection set data = valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid);
insert into text_repair_cases(label) values ('v1'),('v2');
update text_repair_cases c set id = (valtrim.register_customer_service_email_import(f.tenant,f.mailbox::text,'text-repair-' || c.label,'{}') ->> 'importId')::uuid from text_repair_fixture f;
select valtrim.prepare_customer_service_import_source(c.id,f.source,'[]') from text_repair_cases c,text_repair_fixture f where label = 'v1';
select valtrim.prepare_customer_service_graph_source_v2((c.data ->> 'id')::uuid,(c.data ->> 'sync_token')::uuid,(c.data ->> 'revision')::bigint,
  i.id,f.source,jsonb_build_array(pg_temp.repair_image('A'),pg_temp.repair_image('B')))
  from text_repair_cases i,text_repair_connection c,text_repair_fixture f where label = 'v2';
select valtrim.finalize_customer_service_import_source(id) from text_repair_cases;
update text_repair_cases set claim = valtrim.claim_customer_service_email_import_v2(id);

select lives_ok(format('select valtrim.checkpoint_customer_service_email_worker(%L,%L,%L::jsonb)',id,claim ->> 'workerToken',pg_temp.repair_source('EMAIL')),
  label || ': historical email checkpoint without version remains accepted') from text_repair_cases;
select valtrim.checkpoint_customer_service_email_worker(id,(claim ->> 'workerToken')::uuid,pg_temp.repair_source('IMAGE','A')) from text_repair_cases where label = 'v2';
select valtrim.checkpoint_customer_service_email_worker(id,(claim ->> 'workerToken')::uuid,pg_temp.repair_source('IMAGE','B')) from text_repair_cases where label = 'v2';

select lives_ok(format('select valtrim.checkpoint_customer_service_email_worker(%L,%L,%L::jsonb)',id,claim ->> 'workerToken',pg_temp.repair_source('EMAIL') || '{"contactNameVersion":1}'),
  label || ': successful email repair version can be checkpointed') from text_repair_cases;
select is((select count(*) from jsonb_array_elements(i.worker_checkpoint -> 'sources') s where s ->> 'sourceId' = 'email:text:1'),1::bigint,
  label || ': repair replaces the same source identity') from text_repair_cases c join valtrim.service_request_imports i on i.id = c.id;
select is((select s ->> 'contactNameVersion' from jsonb_array_elements(i.worker_checkpoint -> 'sources') s where s ->> 'kind' = 'EMAIL'),'1',
  label || ': policy version survives the checkpoint') from text_repair_cases c join valtrim.service_request_imports i on i.id = c.id;
select is((select count(*) from jsonb_array_elements(i.worker_checkpoint -> 'sources') s where s = pg_temp.repair_source('IMAGE','A') or s = pg_temp.repair_source('IMAGE','B')),2::bigint,
  'Both successful image checkpoints remain identical') from text_repair_cases c join valtrim.service_request_imports i on i.id = c.id where label = 'v2';

select throws_ok(format('select valtrim.checkpoint_customer_service_email_worker(%L,%L,%L::jsonb)',id,claim ->> 'workerToken',
  pg_temp.repair_source('EMAIL') || jsonb_build_object('contactNameVersion',bad.version)),
  '22023','Contact name version requires successful email analysis and a positive integer','Invalid text policy version is rejected: ' || bad.version::text)
  from text_repair_cases cross join lateral (values ('null'::jsonb),('0'::jsonb),('-1'::jsonb),('0.5'::jsonb),('2147483648'::jsonb),('"1"'::jsonb),('true'::jsonb),('{}'::jsonb)) bad(version) where label = 'v2';
select throws_ok(format('select valtrim.checkpoint_customer_service_email_worker(%L,%L,%L::jsonb)',id,claim ->> 'workerToken',
  pg_temp.repair_source('IMAGE','A') || '{"contactNameVersion":1}'),
  '22023','Contact name version requires successful email analysis and a positive integer','Image cannot claim text repair version') from text_repair_cases where label = 'v2';
select throws_ok(format('select valtrim.checkpoint_customer_service_email_worker(%L,%L,%L::jsonb)',id,claim ->> 'workerToken',
  pg_temp.repair_source('EMAIL') || '{"contactNameVersion":1,"status":"FAILED","structuredData":null,"error":{"code":"ANALYSIS_FAILED","message":"Retry required"}}'),
  '22023','Contact name version requires successful email analysis and a positive integer','Failed text cannot be marked as successfully repaired') from text_repair_cases where label = 'v2';
select throws_ok(format('select valtrim.checkpoint_customer_service_email_worker(%L,%L,%L::jsonb)',id,claim ->> 'workerToken',
  pg_temp.repair_source('EMAIL') || '{"contactNameVersion":1,"bytes":[1,2,3]}'),
  '22023','Invalid V2 source analysis; only extracted facts and metadata are allowed','Version metadata cannot hide binary data') from text_repair_cases where label = 'v2';
select throws_ok(format('select valtrim.checkpoint_customer_service_email_worker(%L,%L,%L::jsonb)',id,claim ->> 'workerToken',
  pg_temp.repair_source('EMAIL') || '{"contactNameVersion":1,"unknown":true}'),
  '22023','Invalid V2 source analysis; only extracted facts and metadata are allowed','Unknown fields remain rejected') from text_repair_cases where label = 'v2';
select throws_ok(format('select valtrim.checkpoint_customer_service_email_worker(%L,%L,%L::jsonb)',id,gen_random_uuid(),pg_temp.repair_source('EMAIL') || '{"contactNameVersion":1}'),
  '55000','Email worker lease is no longer valid','Repair cannot bypass worker fencing') from text_repair_cases where label = 'v2';

update text_repair_cases set result = valtrim.finish_customer_service_email_worker_v2(id,(claim ->> 'workerToken')::uuid,'CONTINUE') where label = 'v2';
reset role;
-- Only this synthetic import becomes eligible again; never consume the live queue.
update valtrim.service_request_imports set next_attempt_at = clock_timestamp() - interval '1 second' where id = (select id from text_repair_cases where label = 'v2');
set local role service_role;
update text_repair_cases set claim = valtrim.claim_customer_service_email_import_v2(id) where label = 'v2';
select is((select s ->> 'contactNameVersion' from jsonb_array_elements(claim #> '{checkpoint,sources}') s where s ->> 'kind' = 'EMAIL'),'1',
  'Continuation restores the successful text version') from text_repair_cases where label = 'v2';
select is(jsonb_array_length(claim #> '{checkpoint,sources}'),3,'Continuation retains text and both images') from text_repair_cases where label = 'v2';
select is(i.worker_failure_count,0,'Repair continuation consumes no provider failure budget') from valtrim.service_request_imports i join text_repair_cases c on c.id = i.id where label = 'v2';

select valtrim.record_customer_service_worker_analysis(c.id,(c.claim ->> 'workerToken')::uuid,jsonb_build_object(
  'schemaVersion','1.0','importId',c.id,'outcome','READY_FOR_INTAKE','sources',i.worker_checkpoint -> 'sources',
  'structuredData','{}'::jsonb,'provenance','{}'::jsonb,'conflicts','[]'::jsonb,'excludedItemIndexes','[]'::jsonb,
  'warnings','[]'::jsonb,'issues','[]'::jsonb,'intakePayload',f.intake))
  from text_repair_cases c join valtrim.service_request_imports i on i.id = c.id cross join text_repair_fixture f;
update text_repair_cases set result = valtrim.finish_customer_service_email_worker_v2(id,(claim ->> 'workerToken')::uuid,'COMMIT');
select ok(result ->> 'requestId' is not null,label || ': repaired report creates its request') from text_repair_cases;
select ok(r.workflow_stage = 'NEEDS_REVIEW' and r.reviewed_at is null and r.reviewed_by is null,
  label || ': approval remains human') from valtrim.service_requests r join text_repair_cases c on r.email_import_id = c.id;
select is(valtrim.claim_customer_service_email_import_v2(id) ->> 'requestId',result ->> 'requestId',
  label || ': repeated processing returns the same request') from text_repair_cases;
select is((select count(*) from valtrim.service_requests r where r.email_import_id = c.id),1::bigint,
  label || ': only one request belongs to this import') from text_repair_cases c;
select is((select count(*) from valtrim.stored_files s join text_repair_cases c on s.object_path like 'imports/' || c.id || '/%'),0::bigint,'No stored image records');
select is((select count(*) from valtrim.service_request_import_files f join text_repair_cases c on f.import_id = c.id),0::bigint,'No image file links');
select is((select count(*) from storage.objects o join text_repair_cases c on o.name like 'imports/' || c.id || '/%'),0::bigint,'No image Storage objects');
reset role;
select ok(not private.customer_service_import_has_binary(to_jsonb(i)),'Import retains extracted data without binaries') from valtrim.service_request_imports i join text_repair_cases c on c.id = i.id;
select * from finish();
rollback;
