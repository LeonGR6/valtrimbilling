-- Apply through 20261028200000 first. Linked remote only; every fixture rolls back.
-- Storage rows below are METADATA fixtures, not real binary uploads. Byte/signature
-- and lost transport response tests live in customerServiceEmailAttachments.test.ts.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select is((select public from storage.buckets where id = 'customer-service-imports'),false,'Imported source bucket is private');
select is((select file_size_limit from storage.buckets where id = 'customer-service-imports'),10000000::bigint,'Import file limit is decimal 10 MB');
select is((select allowed_mime_types from storage.buckets where id = 'customer-service-imports'),
  array['application/pdf'],'New import uploads are PDF-only; historical image fixtures below remain readable');
select is((select allowed_mime_types from storage.buckets where id = 'customer-service-sources'),
  array['application/pdf'],'The manual PDF bucket remains PDF-only');
select is((select file_size_limit from storage.buckets where id = 'customer-service-sources'),10485760::bigint,'The existing manual PDF byte limit is unchanged');
select has_table('valtrim','service_request_import_files','Import files have a relational link before a request exists');
select ok((select relrowsecurity from pg_class where oid = 'valtrim.service_request_import_files'::regclass),'Import file relation enables RLS');
select ok(exists(select 1 from pg_policy where polrelid = 'storage.objects'::regclass
  and polname = 'customer_service_imports_server_only' and not polpermissive),'A restrictive policy excludes browser access to the private import bucket');
select ok(not has_table_privilege('authenticated','valtrim.service_request_import_files','INSERT')
  and not has_table_privilege('authenticated','valtrim.service_request_import_files','UPDATE')
  and not has_table_privilege('anon','valtrim.service_request_import_files','SELECT'),'Browser cannot mutate source-file links and anonymous users cannot read them');
select ok(has_function_privilege('service_role',signature,'EXECUTE')
  and not has_function_privilege('authenticated',signature,'EXECUTE')
  and not has_function_privilege('anon',signature,'EXECUTE'),'Backend-only source operation: ' || signature)
from (values
  ('valtrim.prepare_customer_service_import_source(uuid,jsonb,jsonb)'),
  ('valtrim.reject_customer_service_import_source(uuid,text,text)'),
  ('valtrim.finalize_customer_service_import_source(uuid)'),
  ('valtrim.fail_customer_service_import_source(uuid,text)')
) signatures(signature);
select ok(not has_function_privilege('service_role','private.save_customer_service_imported_request(uuid,jsonb)','EXECUTE'),
  'The block-2 implementation cannot bypass the new source gate');
select ok(not has_function_privilege('anon','valtrim.get_customer_service_import_source_files(uuid)','EXECUTE')
  and not has_function_privilege('service_role','valtrim.get_customer_service_import_source_files(uuid)','EXECUTE'),
  'Source URL lookup requires the human caller, not an anonymous or unscoped system context');

create temporary table source_fixture as select gen_random_uuid() tenant_id,gen_random_uuid() admin_id,
  gen_random_uuid() scheduler_id,gen_random_uuid() denied_id,gen_random_uuid() inactive_id,
  (select count(*) from valtrim.service_requests) baseline_requests,
  (select count(*) from valtrim.service_properties) baseline_properties,
  '{"subject":"Work order","bodyText":"Original body","webLink":"https://outlook.office.com/mail/","from":{"emailAddress":{"address":"builder@example.com"}}}'::jsonb source,
  '{"contacts":[{"role":"PRIMARY","name":"Elena Rivera"}],"items":[{"description":"Adjust door"}]}'::jsonb payload;
insert into auth.users(id,email,raw_user_meta_data)
select actor_id,actor_id::text || '@example.com','{"name":"Import Source Test"}'::jsonb
from source_fixture cross join lateral (values(admin_id),(scheduler_id),(denied_id),(inactive_id)) actors(actor_id);
update valtrim.app_users set role = 'ADMIN' where id = (select admin_id from source_fixture);
update valtrim.app_users set role = 'SCHEDULING' where id = (select scheduler_id from source_fixture);
update valtrim.app_users set role = 'READ_ONLY' where id = (select denied_id from source_fixture);
update valtrim.app_users set role = 'ADMIN',is_active = false where id = (select inactive_id from source_fixture);

create function pg_temp.import_file(p_id text,p_name text default 'order.pdf',p_mime text default 'application/pdf',p_size bigint default 24)
returns jsonb language sql as $fixture$
  select jsonb_build_object('attachmentId',p_id,'originalFilename',p_name,'mimeType',p_mime,
    'sizeBytes',p_size,'sha256',repeat('a',64),'isInline',false,'contentId',null);
$fixture$;
create temporary table source_cases(label text primary key,import_id uuid,files jsonb,result jsonb,snapshot jsonb);
insert into source_cases(label,files) values
  ('no files','[]'),
  ('mixed',jsonb_build_array(pg_temp.import_file('pdf'),
    pg_temp.import_file('image','photo.png','image/png') || '{"isInline":true,"contentId":"inline@id"}')),
  ('ten files',(select jsonb_agg(pg_temp.import_file(n::text) || '{"isInline":true}') from generate_series(1,10) n)),
  ('50 MB',(select jsonb_agg(pg_temp.import_file(n::text,'order.pdf','application/pdf',10000000)) from generate_series(1,5) n)),
  ('over count',(select jsonb_agg(pg_temp.import_file(n::text)) from generate_series(1,11) n)),
  ('over file',jsonb_build_array(pg_temp.import_file('a','order.pdf','application/pdf',10000001))),
  ('over total',(select jsonb_agg(pg_temp.import_file(n::text,'order.pdf','application/pdf',10000000)) from generate_series(1,6) n)),
  ('unsupported',jsonb_build_array(pg_temp.import_file('valid'),pg_temp.import_file('invalid','photo.webp','image/webp'))),
  ('mime mismatch',jsonb_build_array(pg_temp.import_file('a','photo.png','application/pdf'))),
  ('empty',jsonb_build_array(pg_temp.import_file('a','order.pdf','application/pdf',0))),
  ('duplicate',jsonb_build_array(pg_temp.import_file('a'),pg_temp.import_file('a'))),
  ('bad checksum',jsonb_build_array(pg_temp.import_file('a') || '{"sha256":"invalid"}')),
  ('injected path',jsonb_build_array(pg_temp.import_file('a') || '{"objectPath":"other/import/file.pdf"}')),
  ('fraction size',jsonb_build_array(pg_temp.import_file('a') || '{"sizeBytes":1.5}')),
  ('missing size',jsonb_build_array(pg_temp.import_file('a') - 'sizeBytes')),
  ('scalar file','["not an object"]'),
  ('null manifest',null),
  ('invalid source','[]'),
  ('unprepared','[]'),
  ('source conflict',jsonb_build_array(pg_temp.import_file('a')));
grant select,update on source_fixture,source_cases to service_role,authenticated;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
update source_cases cases set import_id = (valtrim.register_customer_service_email_import(
  f.tenant_id,'source-test-mailbox',cases.label,f.source) ->> 'importId')::uuid from source_fixture f;
update source_cases cases set result = valtrim.prepare_customer_service_import_source(
  cases.import_id,case when cases.label = 'invalid source' then f.source || '{"contentBytes":"not allowed"}' else f.source end,cases.files)
from source_fixture f where cases.label <> 'unprepared';
select is(result ->> 'sourceStatus','UPLOADING',label || ': valid source is pinned before upload')
  from source_cases where label in ('no files','mixed','ten files','50 MB','source conflict');
select is(result ->> 'sourceStatus','REJECTED',label || ': invalid whole email is rejected')
  from source_cases where label not in ('no files','mixed','ten files','50 MB','source conflict','unprepared');
select ok(receipt.status = 'NEEDS_ATTENTION' and receipt.request_id is null
  and receipt.attachment_refs = '[]' and receipt.source_manifest is null
  and receipt.extraction_payload is null and nullif(receipt.error_message,'') is not null
  and receipt.source_payload ->> 'webLink' = 'https://outlook.office.com/mail/'
  and not (receipt.source_payload ? 'bodyText'),cases.label || ': retain technical error/link, not body, request or files')
from valtrim.service_request_imports receipt join source_cases cases on cases.import_id = receipt.id where receipt.source_status = 'REJECTED';
select is((select count(*) from valtrim.service_request_import_files files join source_cases cases on cases.import_id = files.import_id),
  0::bigint,'Preflight does not publish any file links');
select is((select count(*) from storage.objects object join source_cases cases
  on object.name like 'imports/' || cases.import_id || '/%' where object.bucket_id = 'customer-service-imports'),
  0::bigint,'Preflight does not create Storage objects');
select is((valtrim.save_customer_service_imported_request(cases.import_id,f.payload) ->> 'requestId'),
  null::text,'No request can be created before source is available: ' || cases.label)
from source_cases cases cross join source_fixture f where cases.label in ('mixed','unsupported','unprepared');
select is((select count(*) from valtrim.service_requests),baseline_requests,'Blocked saves create no requests') from source_fixture;
select is((select count(*) from valtrim.service_properties),baseline_properties,'Blocked saves create no orphan properties') from source_fixture;
select throws_ok(format('update valtrim.service_request_imports set source_status = ''AVAILABLE'',source_manifest = ''[]'' where id = %L',import_id),
  '55000','Only the complete prepared file set can become available',
  'A direct status flag cannot skip source preparation and finalization') from source_cases where label = 'unprepared';
select is((valtrim.prepare_customer_service_import_source(cases.import_id,f.source,'[]') ->> 'sourceStatus'),'REJECTED',
  'Dropping an invalid attachment cannot silently turn its email into success')
from source_cases cases cross join source_fixture f where cases.label = 'unsupported';
select is((valtrim.register_customer_service_email_import(f.tenant_id,'source-test-mailbox',cases.label,'{}') ->> 'importId'),
  cases.import_id::text,'Duplicate rejected email reuses the same receipt') from source_cases cases cross join source_fixture f where cases.label = 'unsupported';
select throws_ok(format('select valtrim.prepare_customer_service_import_source(%L,%L::jsonb,%L::jsonb)',cases.import_id,
  f.source || '{"bodyText":"Changed original"}',cases.files),'55000','The pinned original email source cannot be replaced',
  'A retry cannot overwrite the original body') from source_cases cases cross join source_fixture f where cases.label = 'source conflict';
select throws_ok(format('select valtrim.prepare_customer_service_import_source(%L,%L::jsonb,%L::jsonb)',cases.import_id,
  f.source,jsonb_build_array(pg_temp.import_file('different'))),'55000','The pinned original email source cannot be replaced',
  'A retry cannot replace the original attachment set') from source_cases cases cross join source_fixture f where cases.label = 'source conflict';
select throws_ok(format('select valtrim.finalize_customer_service_import_source(%L)',import_id),'P0002',
  'An import attachment has not been uploaded','Missing object blocks publication') from source_cases where label = 'mixed';
reset role;

-- Synthetic Storage metadata, scoped to these random import IDs only.
insert into storage.objects(bucket_id,name,metadata)
select 'customer-service-imports',file ->> 'objectPath',jsonb_build_object('size',(file ->> 'sizeBytes')::bigint,'mimetype',file ->> 'mimeType')
from source_cases cases join valtrim.service_request_imports receipt on receipt.id = cases.import_id
cross join lateral jsonb_array_elements(receipt.source_manifest) file where cases.label in ('mixed','ten files','50 MB');
update storage.objects object set metadata = jsonb_set(metadata,'{size}','999') from source_cases cases
where cases.label = 'mixed' and object.bucket_id = 'customer-service-imports' and object.name = cases.result #>> '{attachments,1,objectPath}';
set local role service_role;
select throws_ok(format('select valtrim.finalize_customer_service_import_source(%L)',import_id),'22023',
  'The uploaded attachment metadata does not match the pinned manifest',
  'One mismatching object prevents the entire finalization') from source_cases where label = 'mixed';
select is((select count(*) from valtrim.service_request_import_files files join source_cases cases on cases.import_id = files.import_id),
  0::bigint,'Failed finalization leaves no partially committed file links');
select is((select count(*) from valtrim.stored_files file join source_cases cases
  on file.object_path like 'imports/' || cases.import_id || '/%' where file.bucket_id = 'customer-service-imports'),
  0::bigint,'Failed finalization rolls back all stored_files records');
select is(valtrim.fail_customer_service_import_source(import_id,'Storage incomplete') ->> 'status','NEEDS_ATTENTION',
  'Storage failure stays visible without a request') from source_cases where label = 'mixed';
select is(valtrim.prepare_customer_service_import_source(cases.import_id,f.source,cases.files) ->> 'sourceStatus','UPLOADING',
  'Exact manifest can resume without replacing any source') from source_cases cases cross join source_fixture f where cases.label = 'mixed';
reset role;
update storage.objects object set metadata = jsonb_set(metadata,'{size}','24') from source_cases cases
where cases.label = 'mixed' and object.bucket_id = 'customer-service-imports' and object.name = cases.result #>> '{attachments,1,objectPath}';
set local role service_role;
update source_cases set result = valtrim.finalize_customer_service_import_source(import_id)
  where label in ('no files','mixed','ten files','50 MB');
select is(result ->> 'sourceStatus','AVAILABLE',label || ': complete original can be read before creating request')
  from source_cases where label in ('no files','mixed','ten files','50 MB');
select is((select count(*) from valtrim.service_request_import_files files join source_cases cases on cases.import_id = files.import_id),
  17::bigint,'Each accepted attachment has one relational file link');
select ok((result #>> '{attachmentRefs,0,objectPath}') like 'imports/' || import_id || '/%',
  'Object paths are server-generated within the import identity') from source_cases where label = 'mixed';
select ok((select bool_and(stored.uploaded_by is null) from valtrim.stored_files stored
  join valtrim.service_request_import_files files on files.file_id = stored.id join source_cases cases on cases.import_id = files.import_id),
  'System ingestion does not impersonate a human uploader');
select ok(receipt.error_code is null and receipt.error_message is null and receipt.status = 'PENDING',
  'Successful storage retry clears only its source-operation error') from valtrim.service_request_imports receipt
  join source_cases cases on cases.import_id = receipt.id where cases.label = 'mixed';
select is(valtrim.finalize_customer_service_import_source(import_id) ->> 'idempotentReplay','true',
  'A repeated finalizer publishes no additional file rows') from source_cases where label = 'mixed';
select is(valtrim.fail_customer_service_import_source(import_id,'Lost success response') ->> 'sourceStatus','AVAILABLE',
  'Lost finalizer response cannot degrade AVAILABLE') from source_cases where label = 'mixed';
select is((select count(*) from valtrim.service_request_import_files files join source_cases cases on cases.import_id = files.import_id),
  17::bigint,'Retries keep the same file identities');
select throws_ok(format('update valtrim.service_request_imports set source_payload = ''{}'' where id = %L',import_id),
  '55000','The pinned original email source cannot be replaced','Direct backend writes cannot replace an accepted original')
  from source_cases where label = 'mixed';
select throws_ok(format('select valtrim.reject_customer_service_import_source(%L,''ATTACHMENT_FORMAT'',''Contradictory delivery'')',import_id),
  '55000','This email source is already pinned; conflicting delivery requires reconciliation',
  'A late rejection cannot remove accepted files') from source_cases where label = 'mixed';
update source_cases cases set snapshot = valtrim.save_customer_service_imported_request(cases.import_id,f.payload)
  from source_fixture f where cases.label = 'mixed';
select is(snapshot ->> 'status','PROCESSED','Only a complete source can reach structured intake') from source_cases where label = 'mixed';
select is((select workflow_stage::text from valtrim.service_requests where id = (cases.snapshot ->> 'requestId')::bigint),
  'NEEDS_REVIEW','Source persistence never approves the created request') from source_cases cases where label = 'mixed';
select is((valtrim.save_customer_service_imported_request(import_id,'{}') ->> 'requestId'),snapshot ->> 'requestId',
  'Request retry preserves the same linked request') from source_cases where label = 'mixed';
reset role;

select throws_ok(format('insert into valtrim.service_requests(property_id,email_import_id,submission_key,homeowner_name,description)
  select property_id,%L,%L,''Elena Rivera'',''Adjust door'' from valtrim.service_requests where id = %s',
  blocked.import_id,blocked.import_id,accepted.snapshot ->> 'requestId'),'55000',
  'An imported request requires a complete available source',
  'A direct insert cannot bypass the source gate even with database owner privileges')
from source_cases blocked cross join source_cases accepted where blocked.label = 'unprepared' and accepted.label = 'mixed';

select set_config('request.jwt.claim.sub',admin_id::text,true) from source_fixture;
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id = 'customer-service-imports'),0::bigint,
  'Even active admins cannot read private import objects directly through Storage RLS');
select throws_ok(format('insert into storage.objects(bucket_id,name) values (''customer-service-imports'',%L)',
  'imports/' || import_id || '/browser-upload.pdf'),'42501',null,
  'Even active admins cannot upload import files directly through Storage RLS') from source_cases where label = 'mixed';
select is(jsonb_array_length(valtrim.get_customer_service_import_source_files(import_id) -> 'attachments'),2,
  'Active admin can retrieve accepted metadata for short-lived URLs') from source_cases where label = 'mixed';
select is((select value #>> '{emailImport,source_payload,bodyText}' from valtrim.read_customer_service_request_intakes((cases.snapshot ->> 'requestId')::bigint) records(value)),
  'Original body','Canonical request read restores the immutable original email') from source_cases cases where label = 'mixed';
select throws_ok(format('select valtrim.get_customer_service_import_source_files(%L)',import_id),'55000',
  'The complete email source is not available','Rejected source has no downloadable partial files') from source_cases where label = 'unsupported';
reset role;
select set_config('request.jwt.claim.sub',scheduler_id::text,true) from source_fixture;
set local role authenticated;
select lives_ok(format('select valtrim.get_customer_service_import_source_files(%L)',import_id),'Active scheduling can read accepted source metadata')
  from source_cases where label = 'mixed';
reset role;
select set_config('request.jwt.claim.sub',denied_id::text,true) from source_fixture;
set local role authenticated;
select throws_ok(format('select valtrim.get_customer_service_import_source_files(%L)',import_id),'42501',null,
  'Read-only actor cannot obtain source URLs') from source_cases where label = 'mixed';
select is((select count(*) from valtrim.service_request_import_files),0::bigint,'RLS hides source file links from read-only users');
reset role;
select set_config('request.jwt.claim.sub',inactive_id::text,true) from source_fixture;
set local role authenticated;
select throws_ok(format('select valtrim.get_customer_service_import_source_files(%L)',import_id),'42501',null,
  'Inactive admin cannot obtain source URLs') from source_cases where label = 'mixed';
reset role;
select set_config('request.jwt.claim.sub',admin_id::text,true) from source_fixture;
set local role service_role;
select throws_ok(format('select valtrim.prepare_customer_service_import_source(%L,''{}'',''[]'')',import_id),'42501',
  'Email source writes require a system context','Backend source writes reject an impersonated human JWT') from source_cases where label = 'no files';
reset role;
select * from finish();
rollback;
