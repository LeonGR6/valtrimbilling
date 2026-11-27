-- Linked remote, synthetic fixtures, rollback. No Graph/Mistral or files.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public,extensions;
select no_plan();
create temporary table inbox_metadata_tap(result text);
create temporary table inbox_metadata_fixture as select gen_random_uuid() tenant,gen_random_uuid() mailbox,
  gen_random_uuid() connection_id,gen_random_uuid() actor,gen_random_uuid() import_id,
  null::jsonb scan,null::uuid message_id,null::jsonb before_result,null::jsonb saved;
insert into auth.users(id,email,raw_user_meta_data) select actor,actor::text || '@example.com','{"name":"Inbox metadata test"}' from inbox_metadata_fixture;
update valtrim.app_users set role = 'ADMIN' where id = (select actor from inbox_metadata_fixture);
delete from private.customer_service_email_automation;
insert into private.customer_service_email_connections(id,tenant_id,mailbox_id,folder_id,enabled,initial_sync_mode,initialized_at)
  select connection_id,tenant,mailbox,'InboxMetadataFixture',true,'BASELINE_ONLY',clock_timestamp() from inbox_metadata_fixture;
insert into private.customer_service_email_automation(connection_id,project_url,enabled)
  select connection_id,'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',true from inbox_metadata_fixture;
grant select,update on inbox_metadata_fixture to authenticated,service_role;
grant select,insert on inbox_metadata_tap to authenticated,service_role;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
update inbox_metadata_fixture set import_id = (valtrim.register_customer_service_email_import(tenant,mailbox::text,'Imported',
  '{"subject":"Retry this email","bodyText":"Homeowner Elena Rivera. Adjust door."}') ->> 'importId')::uuid;
select valtrim.prepare_customer_service_import_source(import_id,'{"subject":"Retry this email","bodyText":"Homeowner Elena Rivera. Adjust door."}','[]') from inbox_metadata_fixture;
select valtrim.finalize_customer_service_import_source(import_id) from inbox_metadata_fixture;
update inbox_metadata_fixture set scan = valtrim.claim_customer_service_email_folder_scan(connection_id);
insert into inbox_metadata_tap select throws_ok(format('select valtrim.finish_customer_service_email_folder_scan_metadata(%L,%L,ARRAY[''M''],null,''{}'',%L::jsonb)',
  connection_id,scan ->> 'token',bad.metadata),'22023','Invalid inbox header metadata','Reject unsafe or unrelated header metadata')
  from inbox_metadata_fixture cross join lateral (values
    ('[{"messageId":"Other","subject":"Wrong message","sender":null,"receivedAt":null}]'::jsonb),
    ('[{"messageId":"M","subject":"Title","sender":null,"receivedAt":null,"body":"not allowed"}]'::jsonb),
    ('[{"messageId":"M","subject":"data:image/png;base64,forbidden","sender":null,"receivedAt":null}]'::jsonb),
    ('[{"messageId":"M","subject":"Title","sender":{"bytes":[1]},"receivedAt":null}]'::jsonb),
    ('[{"messageId":"M","subject":"Title","sender":null,"receivedAt":null},{"messageId":"M","subject":"Title","sender":null,"receivedAt":null}]'::jsonb)
  ) bad(metadata);
insert into inbox_metadata_tap select throws_ok(format('select valtrim.finish_customer_service_email_folder_scan_metadata(%L,%L,ARRAY[''M''],null,''{}'',%L::jsonb)',
  connection_id,scan ->> 'token','[{"messageId":"M","subject":"Title","sender":null,"receivedAt":"invalid"}]'),
  '22023','Invalid inbox received date','Received date is validated before publishing the page') from inbox_metadata_fixture;
select valtrim.finish_customer_service_email_folder_scan_metadata(connection_id,(scan ->> 'token')::uuid,array['M'],null,
  '{"M":"https://outlook.office.com/mail/metadata-fixture"}',
  '[{"messageId":"M","subject":"Dayspring warranty request","sender":"Builder · builder@example.com","receivedAt":"2026-10-14T20:20:15Z"}]') from inbox_metadata_fixture;
reset role;
update private.customer_service_email_missing_messages set first_seen_at = clock_timestamp() - interval '5 minutes'
  where connection_id = (select connection_id from inbox_metadata_fixture);
update inbox_metadata_fixture set message_id = (select id from private.customer_service_email_missing_messages where connection_id = (select connection_id from inbox_metadata_fixture) and message_id = 'M');
select set_config('request.jwt.claim.sub',actor::text,true) from inbox_metadata_fixture;
set local role authenticated;
update inbox_metadata_fixture set before_result = valtrim.read_customer_service_email_inbox_item('FOLDER_MESSAGE',message_id);
insert into inbox_metadata_tap select is(before_result ->> 'subject','Dayspring warranty request','Folder row has an identifiable subject') from inbox_metadata_fixture;
insert into inbox_metadata_tap select is(before_result ->> 'sender','Builder · builder@example.com','Folder row has its safe sender label') from inbox_metadata_fixture;
insert into inbox_metadata_tap select ok((before_result ->> 'receivedAt')::timestamptz = '2026-10-14T20:20:15Z'::timestamptz,'Folder row preserves received date') from inbox_metadata_fixture;
insert into inbox_metadata_tap select is(before_result ->> 'state','REQUIRES_ACTION','Adding readable headers does not resolve a case') from inbox_metadata_fixture;
insert into inbox_metadata_tap select ok(not before_result ?| array['message_id','provider_message_id','body','attachments','worker_checkpoint'],
  'Single-item read exposes neither provider IDs nor bodies/checkpoints') from inbox_metadata_fixture;
insert into inbox_metadata_tap select is(valtrim.read_customer_service_email_inbox_item('FOLDER_MESSAGE',gen_random_uuid()),null::jsonb,'Missing item remains unconfirmed, never a fabricated success');
insert into inbox_metadata_tap select is(valtrim.read_customer_service_email_inbox_item('FOLDER_MESSAGE',import_id),null::jsonb,'Item identity includes its source kind') from inbox_metadata_fixture;
insert into inbox_metadata_tap select is(valtrim.read_customer_service_email_inbox_item('IMPORT',import_id) ->> 'state','PROCESSING','Pending import is visible as processing') from inbox_metadata_fixture;
insert into inbox_metadata_tap select ok(valtrim.read_customer_service_email_inbox_item('IMPORT',import_id) ->> 'importUpdatedAt' is not null,
  'Protected retry receives its exact import timestamp') from inbox_metadata_fixture;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
update inbox_metadata_fixture set saved = valtrim.save_customer_service_imported_request(import_id,
  '{"contacts":[{"role":"PRIMARY","name":"Elena Rivera"}],"items":[{"description":"Adjust door"}]}');
reset role;
select set_config('request.jwt.claim.sub',actor::text,true) from inbox_metadata_fixture;
set local role authenticated;
insert into inbox_metadata_tap select ok(valtrim.read_customer_service_email_inbox_item('IMPORT',import_id) ->> 'state' = 'REGISTERED'
  and valtrim.read_customer_service_email_inbox_item('IMPORT',import_id) ->> 'requestFolio' is not null
  and valtrim.read_customer_service_email_inbox_item('IMPORT',import_id) ->> 'requestWorkflowStage' = 'NEEDS_REVIEW',
  'Authoritative refresh confirms actual folio without implying human approval') from inbox_metadata_fixture;
insert into inbox_metadata_tap select is(valtrim.confirm_customer_service_email_request(message_id,(saved ->> 'requestId')::bigint,0) ->> 'state','REGISTERED',
  'Header enrichment remains compatible with human confirmation') from inbox_metadata_fixture;
insert into inbox_metadata_tap select is(valtrim.read_customer_service_email_inbox_item('FOLDER_MESSAGE',message_id) ->> 'requestFolio',
  valtrim.read_customer_service_email_inbox_item('IMPORT',import_id) ->> 'requestFolio','Both emails link to the same real request') from inbox_metadata_fixture;
insert into inbox_metadata_tap select ok(not has_function_privilege('anon','valtrim.read_customer_service_email_inbox_item(text,uuid)','EXECUTE')
  and not has_function_privilege('service_role','valtrim.read_customer_service_email_inbox_item(text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','valtrim.finish_customer_service_email_folder_scan_metadata(uuid,uuid,text[],text,jsonb,jsonb)','EXECUTE'),
  'Read and system-only publication boundaries stay separate');
reset role;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
set local role authenticated;
insert into inbox_metadata_tap select throws_ok('select valtrim.read_customer_service_email_inbox_item(''IMPORT'',gen_random_uuid())',
  '42501','You do not have permission to manage Customer Service requests','Unrecognized actor cannot read item metadata');
reset role;
insert into inbox_metadata_tap select ok(not private.customer_service_import_has_binary(to_jsonb(m)),'Stored inventory retains headers without binary data')
  from private.customer_service_email_missing_messages m where connection_id = (select connection_id from inbox_metadata_fixture);
insert into inbox_metadata_tap select ok(cursor_url is null and sync_token is null,'Header inventory never resets or advances delta') from private.customer_service_email_connections where id = (select connection_id from inbox_metadata_fixture);
insert into inbox_metadata_tap select is((select count(*) from valtrim.stored_files where object_path like 'imports/' || f.import_id || '/%'),0::bigint,'No image files are stored') from inbox_metadata_fixture f;
insert into inbox_metadata_tap select * from finish();
select result from inbox_metadata_tap;
rollback;
