-- Linked remote, rollback-only synthetic fixtures. No Graph/Mistral or files.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public,extensions;
select no_plan();
create temporary table resolution_tap(result text);
create temporary table resolution_fixture as select gen_random_uuid() tenant,gen_random_uuid() mailbox,
  gen_random_uuid() connection_id,gen_random_uuid() foreign_connection,gen_random_uuid() foreign_tenant,gen_random_uuid() foreign_mailbox,
  gen_random_uuid() admin_id,gen_random_uuid() scheduler_id,gen_random_uuid() denied_id,gen_random_uuid() inactive_id,
  null::jsonb claim,null::jsonb scan_claim,null::bigint request_count,null::bigint manual_id,
  (select j.id from valtrim.jobs j join valtrim.builders b on b.id = j.builder_id where j.is_active and j.status = 'ACTIVE'
    and b.is_active and j.community_latitude is not null and j.community_longitude is not null order by j.id limit 1) job_id;
create temporary table resolution_requests(label text,id uuid,request_id bigint);
create temporary table resolution_messages(label text,id uuid,result jsonb);
insert into auth.users(id,email,raw_user_meta_data)
  select actor,actor::text || '@example.com','{"name":"Email resolution fixture"}'::jsonb from resolution_fixture
  cross join lateral (values(admin_id),(scheduler_id),(denied_id),(inactive_id)) users(actor);
update valtrim.app_users set role = 'ADMIN' where id = (select admin_id from resolution_fixture);
update valtrim.app_users set role = 'SCHEDULING' where id = (select scheduler_id from resolution_fixture);
update valtrim.app_users set role = 'READ_ONLY' where id = (select denied_id from resolution_fixture);
update valtrim.app_users set role = 'ADMIN',is_active = false where id = (select inactive_id from resolution_fixture);
-- Isolate the active inbox only in this rollback transaction; no tick is called.
delete from private.customer_service_email_automation;
insert into private.customer_service_email_connections(id,tenant_id,mailbox_id,folder_id,enabled,initial_sync_mode,initialized_at)
  select connection_id,tenant,mailbox,'ResolutionFixture',true,'BASELINE_ONLY',clock_timestamp() from resolution_fixture
  union all select foreign_connection,foreign_tenant,foreign_mailbox,'ForeignFixture',true,'BASELINE_ONLY',clock_timestamp() from resolution_fixture;
insert into private.customer_service_email_automation(singleton,connection_id,project_url,enabled)
  select true,connection_id,'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',false from resolution_fixture;
insert into resolution_requests(label) values ('target'),('alternative'),('foreign'),('processing'),('problem');
grant select,update on resolution_fixture,resolution_requests,resolution_messages to service_role,authenticated;
grant select,insert on resolution_tap to service_role,authenticated;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
update resolution_requests c set id = (valtrim.register_customer_service_email_import(
  case when c.label = 'foreign' then f.foreign_tenant else f.tenant end,
  case when c.label = 'foreign' then f.foreign_mailbox else f.mailbox end::text,c.label,
  '{"subject":"Same subject is not proof of duplication","bodyText":"Homeowner Elena Rivera. Adjust door."}') ->> 'importId')::uuid from resolution_fixture f;
select valtrim.prepare_customer_service_import_source(id,'{"subject":"Same subject is not proof of duplication","bodyText":"Homeowner Elena Rivera. Adjust door."}','[]') from resolution_requests;
select valtrim.finalize_customer_service_import_source(id) from resolution_requests;
update resolution_requests set request_id = (valtrim.save_customer_service_imported_request(id,
  '{"contacts":[{"role":"PRIMARY","name":"Elena Rivera"}],"items":[{"description":"Adjust door"}]}') ->> 'requestId')::bigint
  where label in ('target','alternative','foreign');
reset role;
update resolution_fixture set request_count = (select count(*) from valtrim.service_requests);
update valtrim.service_request_imports set status = 'NEEDS_ATTENTION',error_code = 'ANALYSIS_INCOMPLETE',error_message = 'Fixture needs a homeowner'
  where id = (select id from resolution_requests where label = 'problem');
insert into resolution_messages(label) values ('A'),('B'),('already-imported'),('foreign-folder');
update resolution_messages set id = gen_random_uuid();
insert into private.customer_service_email_missing_messages(id,connection_id,message_id,scan_id,web_link,first_seen_at)
  select m.id,case when m.label = 'foreign-folder' then f.foreign_connection else f.connection_id end,
    case when m.label = 'already-imported' then 'target' else m.label end,gen_random_uuid(),
    'https://outlook.office.com/mail/fixture',clock_timestamp() - interval '5 minutes'
    from resolution_messages m cross join resolution_fixture f;
insert into resolution_tap select ok(not has_table_privilege(actor,'private.customer_service_email_message_resolutions','SELECT')
  and not has_table_privilege(actor,'private.customer_service_email_message_resolutions','INSERT')
  and not has_table_privilege(actor,'private.customer_service_email_inbox_items','SELECT'),'Private ledger is hidden from ' || actor)
  from unnest(array['anon','authenticated','service_role']) actor;
insert into resolution_tap select ok(not has_function_privilege(actor,'valtrim.confirm_customer_service_email_request(uuid,bigint,bigint)','EXECUTE'),
  actor || ' cannot impersonate human confirmation') from unnest(array['anon','service_role']) actor;
insert into resolution_tap select ok(not has_function_privilege('authenticated','valtrim.read_customer_service_email_resolved_matches(uuid,uuid,bigint,text[])','EXECUTE'),
  'Browser cannot read raw provider identities');
select set_config('request.jwt.claim.sub',admin_id::text,true) from resolution_fixture;
set local role authenticated;
update resolution_fixture f set manual_id = (valtrim.create_customer_service_request_intake(gen_random_uuid(),jsonb_build_object(
  'property',jsonb_build_object('jobId',f.job_id,'lotNumber','12'),
  'request',jsonb_build_object('reportedOn',(now() at time zone 'America/Los_Angeles')::date,'reportedOnSource','EMAIL_SENT',
    'priority','MEDIUM','serviceKind','ADJUSTMENT','workCategory','DOORS','serviceTask','GENERAL_FIX','estimatedDurationMinutes',30,'crewSize',1),
  'contacts','[{"role":"PRIMARY","name":"Elena Rivera","email":"owner@example.com"}]'::jsonb,
  'items','[{"itemNumber":1,"description":"Adjust door","materialRequired":false,"chargeable":false}]'::jsonb)) ->> 'requestId')::bigint;
update resolution_fixture set request_count = (select count(*) from valtrim.service_requests);
insert into resolution_tap select is((valtrim.count_customer_service_email_inbox() ->> 'registered')::integer,2,'Actual linked requests count as registered even in NEEDS_REVIEW');
insert into resolution_tap select is((valtrim.count_customer_service_email_inbox() ->> 'processing')::integer,1,'Pending source has processing state');
insert into resolution_tap select is((valtrim.count_customer_service_email_inbox() ->> 'requiresAction')::integer,3,'One failed import and two missing messages require action');
insert into resolution_tap select is((valtrim.count_customer_service_email_inbox() ->> 'unmatched')::integer,2,'Existing registered requests do not implicitly match original emails');
insert into resolution_tap select is((valtrim.count_customer_service_email_inbox() ->> 'importIssues')::integer,1,'Import issues are separate from original emails to match');
insert into resolution_tap select is((valtrim.read_customer_service_email_automation_status() ->> 'missingCount')::integer,2,'Missing count excludes foreign connection and already imported message');
insert into resolution_tap select is((select count(*) from valtrim.list_customer_service_email_inbox(null,1,0)),1::bigint,'Inbox pagination is bounded');
insert into resolution_tap select throws_ok('select valtrim.list_customer_service_email_inbox(''UNKNOWN'',10,0)','22023','Invalid inbox state or pagination','Unknown state rejected');
insert into resolution_tap select throws_ok('select valtrim.list_customer_service_email_inbox(null,101,0)','22023','Invalid inbox state or pagination','Oversized page rejected');
insert into resolution_tap select ok(not exists(select 1 from valtrim.list_customer_service_email_inbox() x where x ?| array['message_id','provider_message_id','tenant_id','mailbox_id','bodyText','bodyHtml','worker_checkpoint']),
  'Inbox exposes opaque IDs and summaries, not provider IDs or source bodies');
insert into resolution_tap select throws_ok(format('select valtrim.confirm_customer_service_email_request(%L,%L,0)',m.id,r.request_id),
  '42501','Email does not belong to the configured inbox','Another folder cannot be resolved through this inbox') from resolution_messages m cross join resolution_requests r where m.label = 'foreign-folder' and r.label = 'target';
insert into resolution_tap select throws_ok(format('select valtrim.confirm_customer_service_email_request(%L,%L,0)',m.id,r.request_id),
  '42501','Request belongs to another mailbox or connection','Foreign request cannot resolve this email') from resolution_messages m cross join resolution_requests r where m.label = 'A' and r.label = 'foreign';
insert into resolution_tap select throws_ok(format('select valtrim.confirm_customer_service_email_request(%L,9223372036854775807,0)',id),
  'P0002','Request not found','A request must actually exist') from resolution_messages where label = 'A';
insert into resolution_tap select throws_ok(format('select valtrim.confirm_customer_service_email_request(%L,%L,0)',m.id,r.request_id),
  '55000','Email already has an import. Use its current result','Registered imports cannot acquire a competing link') from resolution_messages m cross join resolution_requests r where m.label = 'already-imported' and r.label = 'target';
insert into resolution_tap select throws_ok(format('select valtrim.confirm_customer_service_email_request(%L,%L,9)',m.id,r.request_id),
  '40001','Email resolution changed. Refresh before confirming','Stale resolution version rejected') from resolution_messages m cross join resolution_requests r where m.label = 'A' and r.label = 'target';
reset role;
update private.customer_service_email_connections set sync_token = gen_random_uuid(),sync_lease_expires_at = clock_timestamp() + interval '3 minutes'
  where id = (select connection_id from resolution_fixture);
set local role authenticated;
insert into resolution_tap select throws_ok(format('select valtrim.confirm_customer_service_email_request(%L,%L,0)',m.id,r.request_id),
  '55000','Synchronization is active. Refresh and try again','Resolution cannot race an active sync reservation') from resolution_messages m cross join resolution_requests r where m.label = 'A' and r.label = 'target';
reset role;
update private.customer_service_email_connections set sync_token = null,sync_lease_expires_at = null where id = (select connection_id from resolution_fixture);
set local role authenticated;
update resolution_messages m set result = valtrim.confirm_customer_service_email_request(m.id,r.request_id,0) from resolution_requests r where m.label = 'A' and r.label = 'target';
insert into resolution_tap select is(result ->> 'state','REGISTERED','Human confirmation resolves the email') from resolution_messages where label = 'A';
insert into resolution_tap select is((valtrim.read_customer_service_email_automation_status() ->> 'missingCount')::integer,1,'Pending count updates immediately after confirmation');
insert into resolution_tap select is((valtrim.count_customer_service_email_inbox() ->> 'requiresAction')::integer,2,'Failed import stays visible after unrelated email resolution');
insert into resolution_tap select is((valtrim.count_customer_service_email_inbox() ->> 'unmatched')::integer,1,'Confirming a valid match immediately clears that email from review');
insert into resolution_tap select is((valtrim.count_customer_service_email_inbox() ->> 'importIssues')::integer,1,'A confirmed match does not hide a real import issue');
reset role;
update valtrim.service_request_imports set status = 'NEEDS_ATTENTION',error_code = 'RECOVERY_PDF_PENDING',error_message = 'Fixture PDF recovery pending'
  where id = (select id from resolution_requests where label = 'target');
set local role authenticated;
insert into resolution_tap select is(x ->> 'state','REQUIRES_ACTION','A request with unfinished PDF recovery still requires action')
  from valtrim.list_customer_service_email_inbox() x where x ->> 'id' = (select id::text from resolution_requests where label = 'target');
reset role;
update valtrim.service_request_imports set status = 'PROCESSED',error_code = null,error_message = null where id = (select id from resolution_requests where label = 'target');
set local role authenticated;
insert into resolution_tap select is((valtrim.confirm_customer_service_email_request(m.id,r.request_id,0) ->> 'idempotentReplay')::boolean,true,
  'Lost response replays the same confirmation') from resolution_messages m cross join resolution_requests r where m.label = 'A' and r.label = 'target';
insert into resolution_tap select throws_ok(format('select valtrim.confirm_customer_service_email_request(%L,%L,0)',m.id,r.request_id),
  '40001','Email resolution changed. Refresh before confirming','Concurrent different target cannot overwrite the first confirmation') from resolution_messages m cross join resolution_requests r where m.label = 'A' and r.label = 'alternative';
insert into resolution_tap select throws_ok(format('select valtrim.confirm_customer_service_email_request(%L,%L,1)',m.id,r.request_id),
  '55000','Email is already linked to another request','An active link cannot be silently reassigned') from resolution_messages m cross join resolution_requests r where m.label = 'A' and r.label = 'alternative';
reset role;
insert into resolution_tap select is((select count(*) from valtrim.audit_events where action = 'SERVICE_EMAIL_EXISTING_REQUEST_CONFIRMED' and entity_id = m.id::text),1::bigint,'Confirmation replay writes no second audit event') from resolution_messages m where label = 'A';
insert into resolution_tap select ok(l.confirmed_by = f.admin_id and l.request_id = r.request_id and l.version = 1,'Ledger retains human actor, actual target and version')
  from private.customer_service_email_message_resolutions l cross join resolution_fixture f cross join resolution_requests r where l.connection_id = f.connection_id and l.message_id = 'A' and r.label = 'target';
select set_config('request.jwt.claim.sub',scheduler_id::text,true) from resolution_fixture;
set local role authenticated;
update resolution_messages m set result = valtrim.confirm_customer_service_email_request(m.id,r.request_id,0) from resolution_requests r where m.label = 'B' and r.label = 'alternative';
insert into resolution_tap select is((valtrim.read_customer_service_email_automation_status() ->> 'missingCount')::integer,0,'Both human-confirmed messages leave the missing list');
reset role;
insert into resolution_tap select ok(l.confirmed_by = f.scheduler_id,'Active scheduling actor can confirm') from private.customer_service_email_message_resolutions l cross join resolution_fixture f where l.connection_id = f.connection_id and l.message_id = 'B';
do $tests$
declare a uuid; x uuid; target bigint;
begin
  select id into x from resolution_messages where label = 'A';
  select request_id into target from resolution_requests where label = 'target';
  for a in select denied_id from resolution_fixture union all select inactive_id from resolution_fixture loop
    perform set_config('request.jwt.claim.sub',a::text,true);
    insert into resolution_tap select throws_ok(format('select valtrim.confirm_customer_service_email_request(%L,%L,0)',x,target),
      '42501','You do not have permission to manage Customer Service requests','Denied/inactive actor cannot replay a privileged confirmation');
    insert into resolution_tap select throws_ok('select valtrim.list_customer_service_email_inbox()',
      '42501','You do not have permission to manage Customer Service requests','Denied/inactive actor cannot read inbox');
  end loop;
end;
$tests$;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
update resolution_fixture set claim = valtrim.claim_customer_service_email_sync(connection_id);
insert into resolution_tap select is(valtrim.read_customer_service_email_resolved_matches(connection_id,(claim ->> 'sync_token')::uuid,(claim ->> 'revision')::bigint,array['A','a','B','Other']),
  '["A","B"]'::jsonb,'Delta excludes exact confirmed identities only') from resolution_fixture;
insert into resolution_tap select throws_ok(format('select valtrim.read_customer_service_email_resolved_matches(%L,%L,%L,ARRAY[''A''])',connection_id,gen_random_uuid(),claim ->> 'revision'),
  '55000','Email sync lease is no longer valid','Resolved lookup requires the live sync token') from resolution_fixture;
insert into resolution_tap select throws_ok(format('select valtrim.register_customer_service_email_import(%L,%L,''A'',''{}'')',tenant,mailbox),
  '23505','Email is linked to an existing request','Even an older registrar cannot create a duplicate import') from resolution_fixture;
select valtrim.finish_customer_service_email_sync(connection_id,(claim ->> 'sync_token')::uuid,(claim ->> 'revision')::bigint) from resolution_fixture;
reset role;
-- Inventory removes its transient rows; durable confirmation must survive.
delete from private.customer_service_email_missing_messages where connection_id = (select connection_id from resolution_fixture) and message_id in ('A','B');
insert into private.customer_service_email_missing_messages(connection_id,message_id,scan_id,first_seen_at)
  select connection_id,'A',gen_random_uuid(),clock_timestamp() - interval '5 minutes' from resolution_fixture;
update resolution_messages set id = (select id from private.customer_service_email_missing_messages where connection_id = (select connection_id from resolution_fixture) and message_id = 'A') where label = 'A';
select set_config('request.jwt.claim.sub',admin_id::text,true) from resolution_fixture;
set local role authenticated;
insert into resolution_tap select is((valtrim.read_customer_service_email_automation_status() ->> 'missingCount')::integer,0,'A returning message remains resolved after inventory recreates its row');
reset role;
-- A manual request can be linked too. Delete only this synthetic target; the
-- existing protection of imported requests and their origins stays unchanged.
insert into private.customer_service_email_missing_messages(connection_id,message_id,scan_id,first_seen_at)
  select connection_id,'C',gen_random_uuid(),clock_timestamp() - interval '5 minutes' from resolution_fixture;
insert into resolution_messages(label,id) select 'C',id from private.customer_service_email_missing_messages where connection_id = (select connection_id from resolution_fixture) and message_id = 'C';
set local role authenticated;
insert into resolution_tap select is(valtrim.confirm_customer_service_email_request(m.id,f.manual_id,0) ->> 'state','REGISTERED',
  'A manual request is also a valid human-confirmed target') from resolution_messages m cross join resolution_fixture f where m.label = 'C';
reset role;
delete from valtrim.service_requests where id = (select manual_id from resolution_fixture);
insert into resolution_tap select ok(l.request_id is null and l.version = 2,'Deleting the target invalidates and versions the link') from private.customer_service_email_message_resolutions l cross join resolution_fixture f where l.connection_id = f.connection_id and message_id = 'C';
select set_config('request.jwt.claim.sub',admin_id::text,true) from resolution_fixture;
set local role authenticated;
insert into resolution_tap select is((valtrim.read_customer_service_email_automation_status() ->> 'missingCount')::integer,1,'Deleted target makes the warning actionable again');
insert into resolution_tap select is(x ->> 'reasonCode','LINKED_REQUEST_REMOVED','The inbox explains the missing target') from valtrim.list_customer_service_email_inbox('REQUIRES_ACTION') x where x ->> 'sourceKind' = 'FOLDER_MESSAGE';
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
update resolution_fixture set claim = valtrim.claim_customer_service_email_sync(connection_id);
insert into resolution_tap select is(valtrim.read_customer_service_email_resolved_matches(connection_id,(claim ->> 'sync_token')::uuid,(claim ->> 'revision')::bigint,array['A','B','C']),
  '["A","B"]'::jsonb,'Deleted request can no longer cause a skip in synchronization') from resolution_fixture;
select valtrim.finish_customer_service_email_sync(connection_id,(claim ->> 'sync_token')::uuid,(claim ->> 'revision')::bigint) from resolution_fixture;
reset role;
select set_config('request.jwt.claim.sub',admin_id::text,true) from resolution_fixture;
set local role authenticated;
insert into resolution_tap select throws_ok(format('select valtrim.confirm_customer_service_email_request(%L,%L,1)',m.id,r.request_id),
  '40001','Email resolution changed. Refresh before confirming','A form opened before target deletion is stale') from resolution_messages m cross join resolution_requests r where m.label = 'C' and r.label = 'alternative';
insert into resolution_tap select is(valtrim.confirm_customer_service_email_request(m.id,r.request_id,2) ->> 'state','REGISTERED',
  'A fresh human confirmation can resolve the reopened message') from resolution_messages m cross join resolution_requests r where m.label = 'C' and r.label = 'alternative';
reset role;
insert into resolution_tap select is((select count(*) from valtrim.service_requests),request_count - 1,'Linking creates no additional request') from resolution_fixture;
insert into resolution_tap select ok(r.workflow_stage = 'NEEDS_REVIEW' and r.reviewed_at is null,'Confirmation never approves or edits the target') from valtrim.service_requests r join resolution_requests q on q.request_id = r.id where label = 'alternative';
insert into resolution_tap select is((select count(*) from valtrim.stored_files s join resolution_requests q on s.object_path like 'imports/' || q.id || '/%'),0::bigint,'No stored image records');
insert into resolution_tap select is((select count(*) from storage.objects s join resolution_requests q on s.name like 'imports/' || q.id || '/%'),0::bigint,'No Storage objects');
insert into resolution_tap select ok(not private.customer_service_import_has_binary(to_jsonb(l)),'Resolution retains metadata only') from private.customer_service_email_message_resolutions l cross join resolution_fixture f where l.connection_id = f.connection_id;
insert into resolution_tap select * from finish();
select result from resolution_tap;
rollback;
