-- Block 2, linked remote only. Metadata fixtures and DDL preview roll back;
-- no Graph, Mistral, real Storage uploads, queue claims or history cleanup.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public,extensions;
select no_plan();
select is((select allowed_mime_types from storage.buckets where id = 'customer-service-imports'),array['application/pdf'],
  'The import bucket rejects new image uploads at the Storage boundary');
select ok((select not public and file_size_limit = 10000000 from storage.buckets where id = 'customer-service-imports'),
  'The private bucket and decimal PDF byte limit are unchanged');
select is((select allowed_mime_types from storage.buckets where id = 'customer-service-sources'),array['application/pdf'],
  'The separate manual PDF bucket is unchanged');
select ok(has_function_privilege('service_role','valtrim.prepare_customer_service_graph_source_recovery_v2(uuid,uuid,bigint,uuid,timestamptz,jsonb,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','valtrim.prepare_customer_service_graph_source_recovery_v2(uuid,uuid,bigint,uuid,timestamptz,jsonb,jsonb)','EXECUTE')
  and not has_function_privilege('anon','valtrim.prepare_customer_service_graph_source_recovery_v2(uuid,uuid,bigint,uuid,timestamptz,jsonb,jsonb)','EXECUTE'),
  'Only the server can reopen or resume a source with the V2 recovery RPC');

create temporary table image_intake_fixture as select gen_random_uuid() tenant,gen_random_uuid() mailbox,
  (select count(*) from valtrim.service_requests) request_count,
  '{"body":{"contentType":"text","content":"Original complete source"}}'::jsonb source,
  jsonb_build_array(jsonb_build_object('attachmentId','I','originalFilename','inline.png','mimeType','image/png',
    'sizeBytes',24,'sha256',repeat('a',64),'isInline',true,'contentId','inline@fixture')) files;
create temporary table image_intake_connection(label text primary key,data jsonb,cursor text);
create temporary table image_intake_cases(label text primary key,id uuid,version timestamptz,result jsonb);
create temporary table image_intake_history as select i.id,md5(to_jsonb(i)::text) fingerprint,
  (select md5(coalesce(jsonb_agg(to_jsonb(f) order by f.attachment_id)::text,'[]')) from valtrim.service_request_import_files f where f.import_id = i.id) links,
  (select md5(coalesce(jsonb_agg(to_jsonb(o) order by o.name)::text,'[]')) from storage.objects o where o.bucket_id = 'customer-service-imports' and o.name like 'imports/' || i.id || '/%') objects
  from valtrim.service_request_imports i where i.id = '70288f7b-6169-4963-af47-3f1df7cc967a';
grant select,insert,update on image_intake_fixture,image_intake_connection,image_intake_cases,image_intake_history to service_role;
create function pg_temp.recover_image_intake(p_id uuid,p_version timestamptz,p_source jsonb default null,p_files jsonb default null)
returns jsonb language sql as $test$
  select valtrim.prepare_customer_service_graph_source_recovery_v2((c.data ->> 'id')::uuid,(c.data ->> 'sync_token')::uuid,
    (c.data ->> 'revision')::bigint,p_id,p_version,coalesce(p_source,f.source),coalesce(p_files,f.files))
  from image_intake_connection c cross join image_intake_fixture f where c.label = 'baseline';
$test$;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
insert into image_intake_connection(label,data)
  select label,valtrim.register_customer_service_email_connection(f.tenant,f.mailbox,'ImageIntake-' || label,mode)
  from image_intake_fixture f cross join (values ('baseline','BASELINE_ONLY'),('existing','IMPORT_EXISTING')) modes(label,mode);
update image_intake_connection set data = valtrim.configure_customer_service_email_connection((data ->> 'id')::uuid,(data ->> 'revision')::bigint,true);
update image_intake_connection set data = valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid);
insert into image_intake_cases(label,id) select label,(valtrim.register_customer_service_email_import(f.tenant,f.mailbox::text,'image-intake-' || label,
  '{"subject":"SQL fixture","webLink":"https://outlook.office.com/mail/fixture"}') ->> 'importId')::uuid
  from image_intake_fixture f cross join unnest(array['valid','stale','format','invalid','ordinary','historical','existing-round','baseline-round','unsafe-error']) label;
select throws_ok(format('select valtrim.prepare_customer_service_graph_source_v2(%L,%L,%s,%L,%L::jsonb,%L::jsonb)',
  c.data ->> 'id',c.data ->> 'sync_token',c.data ->> 'revision',i.id,f.source,f.files),'55000',
  'Initialize the connection before preparing a V2 source','BASELINE_ONLY cannot retain initial historical messages')
  from image_intake_connection c,image_intake_cases i,image_intake_fixture f where c.label = 'baseline' and i.label = 'baseline-round';
select lives_ok(format('select valtrim.prepare_customer_service_graph_source_v2(%L,%L,%s,%L,%L::jsonb,''[]'')',
  c.data ->> 'id',c.data ->> 'sync_token',c.data ->> 'revision',i.id,f.source),'IMPORT_EXISTING can prepare its first round before the first DELTA')
  from image_intake_connection c,image_intake_cases i,image_intake_fixture f where c.label = 'existing' and i.label = 'existing-round';
select ok(valtrim.read_customer_service_email_connection((data ->> 'id')::uuid) ->> 'initialized_at' is null,
  'Preparing first-round sources does not invent initialization or a cursor') from image_intake_connection where label = 'existing';
update image_intake_connection set cursor = 'https://graph.microsoft.com/v1.0/users/' || (data ->> 'mailbox_id') || '/mailFolders/ImageIntake-baseline/messages/delta?$deltatoken=original'
  where label = 'baseline';
update image_intake_connection set data = valtrim.checkpoint_customer_service_email_sync((data ->> 'id')::uuid,(data ->> 'sync_token')::uuid,
  (data ->> 'revision')::bigint,'DELTA',cursor,array[]::uuid[]) where label = 'baseline';
update image_intake_connection set data = valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid) where label = 'baseline';
select valtrim.reject_customer_service_import_source(id,case when label = 'format' then 'ATTACHMENT_FORMAT' else 'ATTACHMENT_SIZE' end,'Original isolated rejection')
  from image_intake_cases where label in ('valid','stale','format','invalid');
select valtrim.reject_customer_service_import_source(id,'ATTACHMENT_SIZE','Filename contained data:image/png;base64,PRIVATE_BINARY_DIAGNOSTIC')
  from image_intake_cases where label = 'unsafe-error';
update image_intake_cases c set version = i.updated_at from valtrim.service_request_imports i where i.id = c.id;
select throws_ok(format('select pg_temp.recover_image_intake(%L,%L)',id,version + interval '1 second'),'40001',
  'The import changed. Read it again before recovery','A stale version cannot reopen a rejection') from image_intake_cases where label = 'stale';
select throws_ok(format('select pg_temp.recover_image_intake(%L,%L)',id,version),'55000',
  'Only an unpinned size rejection can use this correction','V2 does not broaden the allowed rejection types') from image_intake_cases where label = 'format';
select throws_ok(format('select pg_temp.recover_image_intake(%L,%L,%L::jsonb)',id,version,'{"bodyText":"data:image/png;base64,forbidden"}'),'22023',
  'SOURCE_METADATA: V2 sources must contain metadata and text without binary images','Binary source recovery rolls back reopening atomically')
  from image_intake_cases where label = 'invalid';
select ok(i.source_status = 'REJECTED' and i.error_message = 'Original isolated rejection' and i.source_manifest is null,
  'Failed recovery preserves the original technical rejection') from image_intake_cases c join valtrim.service_request_imports i on i.id = c.id where label = 'invalid';
select pg_temp.recover_image_intake(id,version) from image_intake_cases where label = 'unsafe-error';
select ok(not exists(select 1 from valtrim.audit_events a where a.entity_id = c.id::text and to_jsonb(a)::text like '%PRIVATE_BINARY_DIAGNOSTIC%'),
  'Recovery does not copy historical binary diagnostics into new audit JSON') from image_intake_cases c where label = 'unsafe-error';
update image_intake_cases set result = pg_temp.recover_image_intake(id,version) where label = 'valid';
select ok(result ->> 'sourceStatus' = 'UPLOADING' and result ->> 'sourceContractVersion' = '2',
  'An allowed unpinned rejection reopens directly into V2') from image_intake_cases where label = 'valid';
select ok(i.source_manifest #>> '{0,retention}' = 'GRAPH_ONLY' and not (i.source_manifest -> 0 ? 'objectPath')
  and i.attachment_refs = '[]'::jsonb and i.request_id is null and i.attempt_count = 0,
  'Recovered images have no stored-file path, link, request or worker attempt')
  from image_intake_cases c join valtrim.service_request_imports i on i.id = c.id where label = 'valid';
select ok(a.actor_type = 'SYSTEM' and a.previous_values ->> 'errorCode' = 'ATTACHMENT_SIZE'
  and a.previous_values ->> 'errorMessage' = 'Original isolated rejection' and a.metadata ->> 'correction' = 'GRAPH_IMAGE_NO_RETENTION',
  'The original rejection and explicit V2 recovery are audited without a human impersonation')
  from valtrim.audit_events a join image_intake_cases c on a.entity_id = c.id::text where c.label = 'valid' and a.action = 'SERVICE_EMAIL_GRAPH_SOURCE_RECOVERY';
select is(pg_temp.recover_image_intake(id,version) ->> 'idempotentReplay','true','A lost prepare response resumes the same audited source') from image_intake_cases where label = 'valid';
select valtrim.fail_customer_service_import_source(id,'PDF/source preparation interrupted') from image_intake_cases where label = 'valid';
select is(pg_temp.recover_image_intake(id,version) ->> 'sourceStatus','UPLOADING','The same audited recovery survives a later infrastructure failure')
  from image_intake_cases where label = 'valid';
select throws_ok(format('select pg_temp.recover_image_intake(%L,%L,%L::jsonb)',id,version,'{"bodyText":"Changed source"}'),'55000',
  'The pinned original email source cannot be replaced','An audited recovery still cannot replace a body or manifest') from image_intake_cases where label = 'valid';
select is((select count(*) from valtrim.audit_events a where a.entity_id = c.id::text and a.action = 'SERVICE_EMAIL_GRAPH_SOURCE_RECOVERY'),
  1::bigint,'Repeated recovery does not duplicate its audit') from image_intake_cases c where label = 'valid';
select valtrim.finalize_customer_service_import_source(id) from image_intake_cases where label = 'valid';
select is(pg_temp.recover_image_intake(id,version) ->> 'sourceStatus','AVAILABLE','Accepted sources replay without new image records') from image_intake_cases where label = 'valid';
select ok(valtrim.claim_customer_service_email_import(id) is null,'The deployed V1 worker leaves V2 queued for block 3') from image_intake_cases where label = 'valid';
select valtrim.prepare_customer_service_graph_source_v2((c.data ->> 'id')::uuid,(c.data ->> 'sync_token')::uuid,(c.data ->> 'revision')::bigint,i.id,f.source,f.files)
  from image_intake_connection c,image_intake_cases i,image_intake_fixture f where c.label = 'baseline' and i.label = 'ordinary';
select valtrim.fail_customer_service_import_source(id,'Interrupted ordinary V2 source') from image_intake_cases where label = 'ordinary';
update image_intake_cases c set version = i.updated_at from valtrim.service_request_imports i where i.id = c.id and c.label = 'ordinary';
select is(pg_temp.recover_image_intake(id,version) ->> 'sourceStatus','UPLOADING','An ordinary V2 PDF-preparation failure can be resumed explicitly')
  from image_intake_cases where label = 'ordinary';
select valtrim.prepare_customer_service_import_source(i.id,f.source,f.files) from image_intake_cases i,image_intake_fixture f where i.label = 'historical';
update image_intake_cases c set version = i.updated_at from valtrim.service_request_imports i where i.id = c.id and c.label = 'historical';
select throws_ok(format('select pg_temp.recover_image_intake(%L,%L)',id,version),'55000','Historical pinned sources cannot be converted to V2',
  'A historical staged image is not silently converted or newly published') from image_intake_cases where label = 'historical';
select is((select count(*) from valtrim.service_request_import_files l join image_intake_cases c on l.import_id = c.id),0::bigint,
  'No recovery publishes an image file link');
select is((select count(*) from storage.objects o join image_intake_cases c on o.name like 'imports/' || c.id || '/%'),0::bigint,
  'No image Storage object is needed for V2 recovery');
select is((select count(*) from valtrim.service_requests),request_count,'Block 2 does not create requests or approve them') from image_intake_fixture;
select is(valtrim.read_customer_service_email_connection((data ->> 'id')::uuid) ->> 'cursor_url',cursor,
  'Recovery never advances or resets the Graph delta cursor') from image_intake_connection where label = 'baseline';
select throws_ok(format('select valtrim.prepare_customer_service_graph_source_recovery_v2(%L,%L,%s,%L,%L,''{}'',''[]'')',
  c.data ->> 'id',gen_random_uuid(),c.data ->> 'revision',i.id,i.version),'55000','Email sync lease is no longer valid',
  'A lost sync lease cannot mutate even an accepted source') from image_intake_connection c,image_intake_cases i where c.label = 'baseline' and i.label = 'valid';
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
select throws_ok(format('select pg_temp.recover_image_intake(%L,%L)',id,version),'42501','Email connection operations require a system context',
  'A human JWT cannot act as the Graph recovery server') from image_intake_cases where label = 'valid';
reset role;
select ok(md5(to_jsonb(i)::text) = h.fingerprint and h.links =
  (select md5(coalesce(jsonb_agg(to_jsonb(f) order by f.attachment_id)::text,'[]')) from valtrim.service_request_import_files f where f.import_id = i.id)
  and h.objects = (select md5(coalesce(jsonb_agg(to_jsonb(o) order by o.name)::text,'[]')) from storage.objects o
    where o.bucket_id = 'customer-service-imports' and o.name like 'imports/' || i.id || '/%'),
  'The real pilot import, historical links and image objects remain unchanged')
  from image_intake_history h join valtrim.service_request_imports i on i.id = h.id;
select * from finish();
rollback;
