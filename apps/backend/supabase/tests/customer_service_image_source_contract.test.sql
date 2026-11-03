-- Linked remote only. All SQL/Storage metadata fixtures roll back; no binaries,
-- real queue claims, Graph/Mistral calls, pilot edits or migration-history writes.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public,extensions;
select no_plan();

select has_column('valtrim','service_request_imports','source_contract_version','Source contracts are versioned');
select has_column('valtrim','service_request_imports','source_connection_id','V2 pins its private Graph connection');
select ok(has_function_privilege('service_role',signature,'EXECUTE')
  and not has_function_privilege('authenticated',signature,'EXECUTE')
  and not has_function_privilege('anon',signature,'EXECUTE'),'Server-only operation: ' || signature)
from (values ('valtrim.prepare_customer_service_graph_source_v2(uuid,uuid,bigint,uuid,jsonb,jsonb)'),
  ('valtrim.claim_customer_service_email_import_v2(uuid)'),
  ('valtrim.read_customer_service_graph_image_source(uuid,uuid)')) signatures(signature);
select ok(has_function_privilege('authenticated','valtrim.read_customer_service_import_sources(uuid)','EXECUTE')
  and not has_function_privilege('anon','valtrim.read_customer_service_import_sources(uuid)','EXECUTE')
  and not has_function_privilege('service_role','valtrim.read_customer_service_import_sources(uuid)','EXECUTE'),
  'The viewer uses a human session, with no anonymous or system read');

create temporary table image_contract_fixture as select gen_random_uuid() tenant,gen_random_uuid() mailbox,
  gen_random_uuid() admin_id,gen_random_uuid() scheduler_id,gen_random_uuid() denied_id,gen_random_uuid() inactive_id,
  (select count(*) from valtrim.service_requests) baseline_requests,
  '{"subject":"No-retention SQL fixture","body":{"contentType":"text","content":"Homeowner Elena Rivera. Adjust entry door."},"webLink":"https://outlook.office.com/mail/fixture"}'::jsonb source,
  '{"contacts":[{"role":"PRIMARY","name":"Elena Rivera"}],"items":[{"description":"Adjust entry door"}]}'::jsonb intake;
create temporary table image_contract_connection(data jsonb,cursor text);
create temporary table image_contract_cases(label text primary key,id uuid,files jsonb,result jsonb,claim jsonb,report jsonb);
-- Hashes stay inside this transaction. Never return existing source contents.
create temporary table image_contract_history as select i.id,md5(to_jsonb(i)::text) fingerprint,
  (select md5(coalesce(jsonb_agg(to_jsonb(f) order by f.attachment_id)::text,'[]'))
    from valtrim.service_request_import_files f where f.import_id = i.id) links
  from valtrim.service_request_imports i where i.id = '70288f7b-6169-4963-af47-3f1df7cc967a';
insert into auth.users(id,email,raw_user_meta_data)
  select actor,actor::text || '@example.com','{"name":"Image Contract Test"}'::jsonb
  from image_contract_fixture cross join lateral (values(admin_id),(scheduler_id),(denied_id),(inactive_id)) actors(actor);
update valtrim.app_users set role = 'ADMIN' where id = (select admin_id from image_contract_fixture);
update valtrim.app_users set role = 'SCHEDULING' where id = (select scheduler_id from image_contract_fixture);
update valtrim.app_users set role = 'READ_ONLY' where id = (select denied_id from image_contract_fixture);
update valtrim.app_users set role = 'ADMIN',is_active = false where id = (select inactive_id from image_contract_fixture);

create function pg_temp.image_contract_file(p_id text,p_name text default 'photo.png',p_mime text default 'image/png',p_size bigint default 24)
returns jsonb language sql as $test$
  select jsonb_build_object('attachmentId',p_id,'originalFilename',p_name,'mimeType',p_mime,
    'sizeBytes',p_size,'sha256',repeat('a',64),'isInline',true,'contentId','inline@fixture');
$test$;
create function pg_temp.prepare_image_contract(p_id uuid,p_source jsonb,p_files jsonb)
returns jsonb language sql as $test$
  select valtrim.prepare_customer_service_graph_source_v2((data ->> 'id')::uuid,(data ->> 'sync_token')::uuid,
    (data ->> 'revision')::bigint,p_id,p_source,p_files) from image_contract_connection;
$test$;
create function pg_temp.image_contract_analysis(p_id uuid,p_attachment text,p_kind text default 'IMAGE')
returns jsonb language sql as $test$
  select jsonb_build_object('sourceId',case when p_kind = 'EMAIL' then 'email:body:1' else 'attachment:' || p_attachment end,
    'kind',p_kind,'attachmentId',p_attachment,'fileId',null,
    'filename',case when p_kind = 'EMAIL' then null else 'photo.png' end,
    'sha256',case when p_kind = 'EMAIL' then null else repeat('a',64) end,
    'status','ANALYZED','model','fixture','structuredData','{}'::jsonb,
    'text',case when p_kind = 'IMAGE' then 'Entry door: adjust strike plate' else 'Email text' end,
    'pages','[]'::jsonb,'formFields','[]'::jsonb,'part',null,'usageInfo','{"total_tokens":42}'::jsonb,'error',null);
$test$;
create function pg_temp.checkpoint_image_contract(p_id uuid,p_source jsonb)
returns void language sql as $test$
  select valtrim.checkpoint_customer_service_email_worker(p_id,(claim ->> 'workerToken')::uuid,p_source)
  from image_contract_cases where id = p_id;
$test$;
grant select,insert,update on image_contract_fixture,image_contract_connection,image_contract_cases,image_contract_history to service_role,authenticated;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
insert into image_contract_connection(data) select valtrim.register_customer_service_email_connection(tenant,mailbox,'ImageContractFixture','BASELINE_ONLY')
  from image_contract_fixture;
update image_contract_connection set data = valtrim.configure_customer_service_email_connection((data ->> 'id')::uuid,(data ->> 'revision')::bigint,true);
update image_contract_connection set data = valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid);
insert into image_contract_cases(label,files) values
  ('images',jsonb_build_array(pg_temp.image_contract_file('A'),pg_temp.image_contract_file('a','photo.jpeg','image/jpeg'))),
  ('mixed',jsonb_build_array(pg_temp.image_contract_file('I'),pg_temp.image_contract_file('P','order.pdf','application/pdf'))),
  ('empty','[]'),('no-text',jsonb_build_array(pg_temp.image_contract_file('N'))),
  ('partial',jsonb_build_array(pg_temp.image_contract_file('X'))),
  ('v1-ready',jsonb_build_array(pg_temp.image_contract_file('V1'))),
  ('v1-pending',jsonb_build_array(pg_temp.image_contract_file('V1P'))),
  ('invalid','[]'),('foreign','[]');
update image_contract_cases c set id = (valtrim.register_customer_service_email_import(f.tenant,f.mailbox::text,'image-contract-' || c.label,
  '{"subject":"SQL fixture","webLink":"https://outlook.office.com/mail/fixture"}') ->> 'importId')::uuid from image_contract_fixture f;
select throws_ok(format('select pg_temp.prepare_image_contract(%L,%L::jsonb,%L::jsonb)',c.id,f.source,c.files),'55000',
  'Initialize the connection before preparing a V2 source','V2 cannot import the initial historical baseline')
  from image_contract_cases c cross join image_contract_fixture f where label = 'images';
update image_contract_connection set cursor = 'https://graph.microsoft.com/v1.0/users/' || (data ->> 'mailbox_id') || '/mailFolders/ImageContractFixture/messages/delta?$deltatoken=fixture';
update image_contract_connection set data = valtrim.checkpoint_customer_service_email_sync((data ->> 'id')::uuid,(data ->> 'sync_token')::uuid,
  (data ->> 'revision')::bigint,'DELTA',cursor,array[]::uuid[]);
update image_contract_connection set data = valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid);
select throws_ok(format('select valtrim.prepare_customer_service_graph_source_v2(%L,%L,%s,%L,%L::jsonb,%L::jsonb)',
  data ->> 'id',gen_random_uuid(),data ->> 'revision',c.id,f.source,c.files),'55000','Email sync lease is no longer valid',
  'A stale/foreign sync token cannot pin sources') from image_contract_connection cross join image_contract_cases c
  cross join image_contract_fixture f where label = 'images';
select throws_ok(format('select valtrim.prepare_customer_service_graph_source_v2(%L,%L,%s,%L,%L::jsonb,%L::jsonb)',
  data ->> 'id',data ->> 'sync_token',(data ->> 'revision')::bigint - 1,c.id,f.source,c.files),'40001','Email connection changed. Read it again',
  'The connection revision fences V2 preparation') from image_contract_connection cross join image_contract_cases c
  cross join image_contract_fixture f where label = 'images';
-- Every invalid set is rejected before the source, PDF links or request exist.
select throws_ok(format('select pg_temp.prepare_image_contract(%L,%L::jsonb,%L::jsonb)',c.id,f.source,bad.files),
  '22023',null,'Invalid V2 manifest is atomic: ' || description)
from image_contract_cases c cross join image_contract_fixture f cross join lateral (values
  ('count',(select jsonb_agg(pg_temp.image_contract_file(n::text)) from generate_series(1,11) n)),
  ('file size',jsonb_build_array(pg_temp.image_contract_file('x','photo.png','image/png',10000001))),
  ('total size',(select jsonb_agg(pg_temp.image_contract_file(n::text,'photo.png','image/png',10000000)) from generate_series(1,6) n)),
  ('format',jsonb_build_array(pg_temp.image_contract_file('x','photo.webp','image/webp'))),
  ('duplicate',jsonb_build_array(pg_temp.image_contract_file('x'),pg_temp.image_contract_file('x'))),
  ('injected file',jsonb_build_array(pg_temp.image_contract_file('x') || '{"fileId":1}')),
  ('injected path',jsonb_build_array(pg_temp.image_contract_file('x') || '{"objectPath":"fake"}')),
  ('binary',jsonb_build_array(pg_temp.image_contract_file('x') || '{"contentBytes":"forbidden"}'))
) bad(description,files) where label = 'invalid';
select throws_ok(format('select pg_temp.prepare_image_contract(%L,%L::jsonb,''[]'')',c.id,
  f.source || '{"bodyHtml":"<img src=\"data:image/png;base64,forbidden\">"}'),'22023',
  'SOURCE_METADATA: V2 sources must contain metadata and text without binary images','An HTML data URI cannot bypass non-retention')
  from image_contract_cases c cross join image_contract_fixture f where label = 'invalid';
select ok(i.source_manifest is null and i.source_contract_version = 1 and i.request_id is null,
  'Rejected V2 preparation leaves the original receipt unpinned') from image_contract_cases c
  join valtrim.service_request_imports i on i.id = c.id where label = 'invalid';
select throws_ok(format('select pg_temp.prepare_image_contract(%L,%L::jsonb,''[]'')',c.id,
  f.source || '{"from":{"emailAddress":{"address":[1,2,3]}}}'),'22023','SOURCE_METADATA: Invalid V2 email address',
  'Header objects cannot carry arbitrary arrays in place of text') from image_contract_cases c cross join image_contract_fixture f where label = 'invalid';
update image_contract_cases c set id = (valtrim.register_customer_service_email_import(f.tenant,gen_random_uuid()::text,'foreign-image-source','{}') ->> 'importId')::uuid
  from image_contract_fixture f where label = 'foreign';
select throws_ok(format('select pg_temp.prepare_image_contract(%L,%L::jsonb,''[]'')',c.id,f.source),'42501',
  'The import does not belong to this connection mailbox','A connection cannot supply images for another mailbox')
  from image_contract_cases c cross join image_contract_fixture f where label = 'foreign';
select is(valtrim.reject_customer_service_import_source(id,'SOURCE_METADATA','Invalid image source; manual review required') ->> 'status',
  'NEEDS_ATTENTION','The connector can retain a durable sanitized rejection after failed preparation')
  from image_contract_cases where label = 'invalid';
select ok(i.source_manifest is null and not (i.source_payload ? 'body') and i.attachment_refs = '[]'::jsonb and i.request_id is null,
  'A rejected whole email keeps no body, partial files or automatic request')
  from image_contract_cases c join valtrim.service_request_imports i on i.id = c.id where label = 'invalid';

update image_contract_cases c set result = pg_temp.prepare_image_contract(c.id,f.source,c.files)
  from image_contract_fixture f where label in ('images','mixed','empty','no-text','partial');
select is(result ->> 'sourceContractVersion','2','V2 is explicitly pinned: ' || label)
  from image_contract_cases where label in ('images','mixed','empty','no-text','partial');
select ok(not (file ?| array['objectPath','fileId','bucketId']) and file ->> 'retention' = 'GRAPH_ONLY',
  'An image has identity/hash/inline metadata but no stored-file location')
  from image_contract_cases c join valtrim.service_request_imports i on i.id = c.id
  cross join lateral jsonb_array_elements(i.source_manifest) file where label = 'images';
select is(jsonb_array_length(result -> 'attachments'),2,'Case-sensitive IDs A and a remain separate') from image_contract_cases where label = 'images';
select is(pg_temp.prepare_image_contract(c.id,f.source,c.files) ->> 'idempotentReplay','true','Repeated preparation keeps the same immutable set')
  from image_contract_cases c cross join image_contract_fixture f where label = 'images';
select throws_ok(format('select pg_temp.prepare_image_contract(%L,%L::jsonb,%L::jsonb)',c.id,f.source,
  jsonb_build_array(pg_temp.image_contract_file('changed'))),'55000','The pinned original email source cannot be replaced',
  'A retry cannot replace pending images') from image_contract_cases c cross join image_contract_fixture f where label = 'images';
select throws_ok(format('update valtrim.service_request_imports set source_contract_version = 1,source_connection_id = null where id = %L',id),
  '55000','A pinned source contract and Graph connection cannot be replaced','V2 cannot downgrade into image storage')
  from image_contract_cases where label = 'images';
select throws_ok(format('select valtrim.finalize_customer_service_import_source(%L)',id),'P0002','An import attachment has not been uploaded',
  'A missing PDF blocks the entire mixed finalization') from image_contract_cases where label = 'mixed';
select is((select count(*) from valtrim.service_request_import_files l join image_contract_cases c on l.import_id = c.id),0::bigint,
  'Preparation and failed finalization publish no files');
update image_contract_cases set result = valtrim.finalize_customer_service_import_source(id) where label in ('images','empty','no-text','partial');
select is(result ->> 'sourceStatus','AVAILABLE','Validated set finalizes without storing images: ' || label)
  from image_contract_cases where label in ('images','empty','no-text','partial');
select is(valtrim.finalize_customer_service_import_source(id) ->> 'idempotentReplay','true','Finalization is idempotent')
  from image_contract_cases where label = 'images';
select ok(valtrim.claim_customer_service_email_import(id) is null,'The deployed V1 worker cannot claim V2 sources')
  from image_contract_cases where label = 'images';

-- V1 sources (published and interrupted) retain their existing contract.
select valtrim.prepare_customer_service_import_source(c.id,f.source,c.files) from image_contract_cases c cross join image_contract_fixture f
  where label in ('v1-ready','v1-pending');
select throws_ok(format('select pg_temp.prepare_image_contract(%L,%L::jsonb,%L::jsonb)',c.id,f.source,c.files),'55000',
  'A pinned source contract and Graph connection cannot be replaced','An interrupted V1 source is never silently converted')
  from image_contract_cases c cross join image_contract_fixture f where label = 'v1-pending';
reset role;
insert into storage.objects(bucket_id,name,metadata)
  select 'customer-service-imports',file ->> 'objectPath',jsonb_build_object('size',(file ->> 'sizeBytes')::bigint,'mimetype',file ->> 'mimeType')
  from image_contract_cases c join valtrim.service_request_imports i on i.id = c.id
  cross join lateral jsonb_array_elements(i.source_manifest) file where label in ('mixed','v1-ready') and file ? 'objectPath';
set local role service_role;
update image_contract_cases set result = valtrim.finalize_customer_service_import_source(id) where label in ('mixed','v1-ready');
select is(jsonb_array_length(result -> 'attachmentRefs'),1,'Mixed V2 stores only its PDF') from image_contract_cases where label = 'mixed';
select is(jsonb_array_length(result -> 'attachmentRefs'),1,'V1 stored image remains readable') from image_contract_cases where label = 'v1-ready';
select is((select count(*) from valtrim.stored_files s join image_contract_cases c on s.object_path like 'imports/' || c.id || '/%'
  join valtrim.service_request_imports i on i.id = c.id where i.source_contract_version = 2 and s.mime_type like 'image/%'),0::bigint,
  'No stored_files record is created for V2 images');
select is((select count(*) from storage.objects s join image_contract_cases c on s.name like 'imports/' || c.id || '/%'
  join valtrim.service_request_imports i on i.id = c.id where i.source_contract_version = 2 and s.metadata ->> 'mimetype' like 'image/%'),0::bigint,
  'No image Storage metadata is required to finalize V2');
reset role;
select throws_ok(format('insert into valtrim.service_request_imports(tenant_id,mailbox_id,provider_message_id,source_contract_version,source_connection_id,source_manifest)
  values (%L,%L,''bypass-v2'',2,%L,''[]'')',f.tenant,f.mailbox::text,c.data ->> 'id'),'55000',
  'V2 sources must be registered first and prepared through the Graph RPC','A direct insert cannot bypass V2 preparation')
  from image_contract_fixture f cross join image_contract_connection c;
select throws_ok(format('insert into valtrim.stored_files(bucket_id,object_path,original_filename,mime_type,size_bytes,sha256)
  values (''customer-service-imports'',%L,''fake.png'',''image/png'',24,%L)', 'imports/' || id || '/fake.png',repeat('a',64)),
  '22023','V2 images cannot be registered as stored files','Direct image registration under a V2 import is rejected') from image_contract_cases where label = 'images';
select throws_ok(format('insert into valtrim.service_request_import_files(import_id,attachment_id,file_id) values (%L,''A'',%s)',c.id,
  (select (result #>> '{attachmentRefs,0,fileId}')::bigint from image_contract_cases where label = 'v1-ready')),'22023',
  'V2 import file links are restricted to the pinned PDFs','A historical stored image cannot impersonate a V2 file link')
  from image_contract_cases c where label = 'images';
set local role service_role;
update image_contract_cases set claim = valtrim.claim_customer_service_email_import_v2(id) where label in ('images','empty','no-text','partial');
select ok(claim ->> 'workerToken' is not null,'An explicit V2 worker can claim source: ' || label)
  from image_contract_cases where label in ('images','empty','no-text','partial');
select ok(valtrim.claim_customer_service_email_import_v2(id) is null,'V2 preserves exclusive worker leases') from image_contract_cases where label = 'images';
select ok(not (valtrim.read_customer_service_graph_image_source(id,(claim ->> 'workerToken')::uuid) ?| array['sync_token','cursor_url','clientSecret'])
  and jsonb_array_length(valtrim.read_customer_service_graph_image_source(id,(claim ->> 'workerToken')::uuid) -> 'images') = 2,
  'The worker resolves the exact Graph origin and image descriptors without secrets or cursor') from image_contract_cases where label = 'images';
select throws_ok(format('select valtrim.read_customer_service_graph_image_source(%L,%L)',id,gen_random_uuid()),'55000',
  'Email worker lease is no longer valid','A stale worker cannot recover Graph images') from image_contract_cases where label = 'images';
select pg_temp.checkpoint_image_contract(id,pg_temp.image_contract_analysis(id,'A')) from image_contract_cases where label = 'images';
select pg_temp.checkpoint_image_contract(id,pg_temp.image_contract_analysis(id,'a') || '{"filename":"photo.jpeg","text":null}')
  from image_contract_cases where label = 'images';
select pg_temp.checkpoint_image_contract(id,pg_temp.image_contract_analysis(id,'N') || '{"text":""}') from image_contract_cases where label = 'no-text';
select pg_temp.checkpoint_image_contract(id,pg_temp.image_contract_analysis(id,null,'EMAIL')) from image_contract_cases where label = 'empty';
select throws_ok(format('select pg_temp.checkpoint_image_contract(%L,%L::jsonb)',id,
  pg_temp.image_contract_analysis(id,'A') || '{"fileId":1}'),'22023','Unretained images have no stored file, PDF pages or form fields',
  'Image checkpoints cannot invent a stored file') from image_contract_cases where label = 'images';
select throws_ok(format('select pg_temp.checkpoint_image_contract(%L,%L::jsonb)',id,
  pg_temp.image_contract_analysis(id,'A') || jsonb_build_object('sha256',repeat('b',64))),'22023',
  'V2 analysis must match the pinned attachment identity and checksum','A changed image cannot reuse another checkpoint')
  from image_contract_cases where label = 'images';
select throws_ok(format('select pg_temp.checkpoint_image_contract(%L,%L::jsonb)',id,
  pg_temp.image_contract_analysis(id,'A') || '{"usageInfo":{"unexpected":[1,2,3]}}'),'22023',
  'V2 usage information must contain known numeric counters only','Provider usage cannot carry arbitrary payloads')
  from image_contract_cases where label = 'images';
select throws_ok(format('select pg_temp.checkpoint_image_contract(%L,%L::jsonb)',id,
  pg_temp.image_contract_analysis(id,'A') || '{"text":"data:image/png;base64,forbidden"}'),'22023',
  'Invalid V2 source analysis; only extracted facts and metadata are allowed','Image text cannot contain a binary data URI')
  from image_contract_cases where label = 'images';
select throws_ok(format('update valtrim.service_request_imports set extraction_payload = %L::jsonb where id = %L',
  '{"binary":[1,2,3]}',id),'22023','Binary image content is forbidden in V2 import records',
  'Direct writes cannot bypass the binary guard') from image_contract_cases where label = 'images';
select valtrim.finish_customer_service_email_worker(id,(claim ->> 'workerToken')::uuid,'CONTINUE') from image_contract_cases where label = 'images';
update image_contract_cases set claim = valtrim.claim_customer_service_email_import_v2(id) where label = 'images';
select is(jsonb_array_length(claim #> '{checkpoint,sources}'),2,'Continuation preserves both valid image analyses')
  from image_contract_cases where label = 'images';
-- Every pinned image must be accounted for, even when the email has enough data.
update image_contract_cases c set report = jsonb_build_object('schemaVersion','1.0','importId',c.id,'outcome','READY_FOR_INTAKE',
  'sources',i.worker_checkpoint -> 'sources','structuredData','{}'::jsonb,'provenance','{}'::jsonb,'conflicts','[]'::jsonb,
  'excludedItemIndexes','[]'::jsonb,'warnings','[]'::jsonb,'issues','[]'::jsonb,'intakePayload',f.intake)
  from valtrim.service_request_imports i,image_contract_fixture f where i.id = c.id and label in ('images','empty','no-text','partial');
select throws_ok(format('select valtrim.record_customer_service_worker_analysis(%L,%L,%L::jsonb)',id,claim ->> 'workerToken',report),
  '22023','The analysis must account for every original attachment','A missing image blocks a ready analysis')
  from image_contract_cases where label = 'partial';
select pg_temp.checkpoint_image_contract(id,pg_temp.image_contract_analysis(id,'X') ||
  '{"status":"FAILED","structuredData":null,"text":null,"error":{"code":"SOURCE_UNAVAILABLE","message":"Original image unavailable"}}')
  from image_contract_cases where label = 'partial';
update image_contract_cases set report = report || jsonb_build_object('outcome','NEEDS_ATTENTION','intakePayload',null,
  'issues',jsonb_build_array('SOURCE_UNAVAILABLE:attachment:X'),
  'sources',jsonb_build_array(pg_temp.image_contract_analysis(id,'X') ||
    '{"status":"FAILED","structuredData":null,"text":null,"error":{"code":"SOURCE_UNAVAILABLE","message":"Original image unavailable"}}'))
  where label = 'partial';
select valtrim.record_customer_service_worker_analysis(id,(claim ->> 'workerToken')::uuid,report) from image_contract_cases where label = 'partial';
select is(valtrim.finish_customer_service_email_worker(id,(claim ->> 'workerToken')::uuid,'ATTENTION','SOURCE_UNAVAILABLE') ->> 'status',
  'NEEDS_ATTENTION','A missing Graph image remains a visible problem without an automatic request') from image_contract_cases where label = 'partial';
select valtrim.record_customer_service_worker_analysis(id,(claim ->> 'workerToken')::uuid,report)
  from image_contract_cases where label in ('images','empty','no-text');
update image_contract_cases set result = valtrim.finish_customer_service_email_worker(id,(claim ->> 'workerToken')::uuid,'COMMIT')
  where label in ('images','empty','no-text');
select ok(result ->> 'requestId' is not null and result ->> 'status' = 'PROCESSED','Complete source creates one request: ' || label)
  from image_contract_cases where label in ('images','empty','no-text');
select ok(r.workflow_stage = 'NEEDS_REVIEW' and r.reviewed_at is null and r.reviewed_by is null,
  'V2 intake never approves a request') from valtrim.service_requests r join image_contract_cases c on r.email_import_id = c.id;
select is(valtrim.claim_customer_service_email_import(id) ->> 'requestId',result ->> 'requestId',
  'Even a V1 caller replays the same linked V2 request without processing') from image_contract_cases where label = 'images';
select is(valtrim.claim_customer_service_email_import_v2(id) ->> 'requestId',result ->> 'requestId',
  'Repeated V2 processing returns the same request') from image_contract_cases where label = 'images';
select is((select count(*) from valtrim.service_requests),baseline_requests + 3,'Three valid fixture imports produce exactly three unapproved requests')
  from image_contract_fixture;
select is(valtrim.read_customer_service_email_connection((data ->> 'id')::uuid) ->> 'cursor_url',cursor,
  'Source preparation and worker recovery never change the delta cursor') from image_contract_connection;

reset role;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
set local role service_role;
select throws_ok(format('select valtrim.claim_customer_service_email_import_v2(%L)',id),'42501','Email worker requires a system context',
  'A human JWT cannot impersonate a V2 system worker') from image_contract_cases where label = 'partial';
reset role;
select set_config('request.jwt.claim.sub',(select admin_id::text from image_contract_fixture),true);
set local role authenticated;
select is(jsonb_array_length(valtrim.get_customer_service_import_source_files(id) -> 'attachments'),0,
  'The old signed-file endpoint offers no imaginary image files') from image_contract_cases where label = 'images';
select ok(valtrim.read_customer_service_import_sources(id) #>> '{attachments,0,retention}' = 'GRAPH_ONLY'
  and valtrim.read_customer_service_import_sources(id) #>> '{attachments,0,fileId}' is null
  and valtrim.read_customer_service_import_sources(id) #>> '{attachments,0,storedFileAvailable}' = 'false'
  and valtrim.read_customer_service_import_sources(id) #>> '{attachments,0,analysis,text}' = 'Entry door: adjust strike plate',
  'The viewer receives image extraction without claiming its file is available') from image_contract_cases where label = 'images';
select is(jsonb_array_length(valtrim.get_customer_service_import_source_files(id) -> 'attachments'),1,
  'The old signed-file endpoint still offers the mixed PDF') from image_contract_cases where label = 'mixed';
select is(valtrim.read_customer_service_import_sources(id) #>> '{attachments,0,retention}','STORED',
  'Historical images keep their original stored-file semantics') from image_contract_cases where label = 'v1-ready';
select is(valtrim.read_customer_service_import_sources(id) #>> '{attachments,0,analysis,status}','ANALYZED',
  'An image without text is a successful analysis') from image_contract_cases where label = 'no-text';
reset role;
select set_config('request.jwt.claim.sub',(select scheduler_id::text from image_contract_fixture),true);
set local role authenticated;
select lives_ok(format('select valtrim.read_customer_service_import_sources(%L)',id),'Active scheduling staff can review extracted image data')
  from image_contract_cases where label = 'images';
reset role;
select set_config('request.jwt.claim.sub',(select denied_id::text from image_contract_fixture),true);
set local role authenticated;
select throws_ok(format('select valtrim.read_customer_service_import_sources(%L)',id),'42501',
  'You do not have permission to manage Customer Service requests','Read-only users cannot read the source viewer')
  from image_contract_cases where label = 'images';
reset role;
select set_config('request.jwt.claim.sub',(select inactive_id::text from image_contract_fixture),true);
set local role authenticated;
select throws_ok(format('select valtrim.read_customer_service_import_sources(%L)',id),'42501',
  'You do not have permission to manage Customer Service requests','Inactive administrators cannot read the source viewer')
  from image_contract_cases where label = 'images';
reset role;
select ok(md5(to_jsonb(i)::text) = h.fingerprint and h.links =
  (select md5(coalesce(jsonb_agg(to_jsonb(f) order by f.attachment_id)::text,'[]')) from valtrim.service_request_import_files f where f.import_id = i.id),
  'The real CS-1876 import and its seven historical links remain unchanged')
  from image_contract_history h join valtrim.service_request_imports i on i.id = h.id;
select * from finish();
rollback;
