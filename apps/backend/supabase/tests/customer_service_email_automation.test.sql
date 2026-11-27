-- Rollback-only fixtures. Queued HTTP is never committed or delivered.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public,extensions;
select no_plan();
create temporary table automation_tap(result text);
create temporary table automation_fixture as select gen_random_uuid() tenant,gen_random_uuid() mailbox,
  gen_random_uuid() connection_id,gen_random_uuid() import_id,
  (select count(*) from valtrim.service_requests) requests,
  (select count(*) from storage.objects) objects;
create temporary table automation_scan(claim jsonb);
insert into automation_scan values(null);
-- Isolate the singleton dispatch state only inside this rollback transaction.
-- Existing imports, scans, cursors and requests remain untouched. No queue is
-- committed, including when this suite is repeated after operator activation.
delete from private.customer_service_email_automation;
update private.customer_service_email_dispatch set request_id = null,invocation_id = null,target_id = null,
  started_at = null,finished_at = null,last_success_at = null,retry_not_before = null,failures = 0,outcome = null,error_code = null;
insert into automation_tap select is(command,'select valtrim.tick_customer_service_email_automation()',
  'Cron invokes only the protected dispatcher, with no keys') from cron.job where jobname = 'customer-service-email-minute';
insert into automation_tap select is((select count(*) from cron.job where jobname = 'customer-service-email-minute'),1::bigint,'One stable cron job');
insert into automation_tap select is((select schedule from cron.job where jobname = 'customer-service-email-minute'),'* * * * *','One-minute schedule');
insert into automation_tap select ok(not has_table_privilege(actor,'private.customer_service_email_automation','SELECT')
  and not has_table_privilege(actor,'private.customer_service_email_folder_scan','SELECT'), 'Private configuration hidden from ' || actor)
  from unnest(array['anon','authenticated','service_role']) actor;
insert into automation_tap select ok(not has_function_privilege('authenticated','valtrim.tick_customer_service_email_automation()','EXECUTE')
  and not has_function_privilege('anon','valtrim.tick_customer_service_email_automation()','EXECUTE'),'Browser cannot dispatch work');
insert into automation_tap select ok(not has_function_privilege('authenticated','valtrim.configure_customer_service_email_automation(uuid,boolean,text)','EXECUTE'),
  'Browser cannot activate or replace the scheduler');
insert into automation_tap select ok(has_function_privilege('authenticated','valtrim.read_customer_service_email_automation_status()','EXECUTE')
  and not has_function_privilege('anon','valtrim.read_customer_service_email_automation_status()','EXECUTE'),
  'Status is restricted to authenticated callers with the actor guard');
insert into automation_tap select ok(not has_table_privilege(actor,'vault.decrypted_secrets','SELECT'),'Vault keys hidden from ' || actor)
  from unnest(array['anon','authenticated']) actor;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);
insert into private.customer_service_email_connections(id,tenant_id,mailbox_id,folder_id,enabled,initial_sync_mode,initialized_at)
  select connection_id,tenant,mailbox,'AutomationFolder',true,'BASELINE_ONLY',clock_timestamp() from automation_fixture;
-- Test Vault values only. They roll back with the queue and are never printed.
select vault.create_secret(repeat('s',40),'customer_service_email_sync_secret')
  where not exists(select 1 from vault.secrets where name = 'customer_service_email_sync_secret');
select vault.create_secret(repeat('w',40),'customer_service_email_worker_secret')
  where not exists(select 1 from vault.secrets where name = 'customer_service_email_worker_secret');
insert into automation_tap select lives_ok(format('select valtrim.configure_customer_service_email_automation(%L,false,%L)',connection_id,
  'https://aaaaaaaaaaaaaaaaaaaa.supabase.co'),'Operator can configure paused automation') from automation_fixture;
insert into automation_tap select lives_ok('select valtrim.tick_customer_service_email_automation()','Paused tick is a no-op');
insert into automation_tap select is((select count(*) from net.http_request_queue where url like 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co/%'),0::bigint,'Pause sends no HTTP');
insert into automation_tap select throws_ok(format('select valtrim.configure_customer_service_email_automation(%L,true,%L)',connection_id,'https://evil.example'),
  '22023','Explicit connection, activation and valid project URL are required','Reject non-project destinations') from automation_fixture;
insert into automation_tap select lives_ok(format('select valtrim.configure_customer_service_email_automation(%L,true)',connection_id),
  'Explicit activation is accepted') from automation_fixture;
insert into automation_tap select lives_ok('select valtrim.tick_customer_service_email_automation()','Empty queue can run synchronization and inventory');
insert into automation_tap select is((select count(*) from net.http_request_queue where url = 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co/functions/v1/customer-service-email-worker'),0::bigint,'No empty worker HTTP call');
insert into automation_tap select is((select count(*) from net.http_request_queue where url = 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co/functions/v1/customer-service-email-sync'),1::bigint,'One synchronization call');
insert into automation_tap select ok((select bool_and(timeout_milliseconds = 145000) from net.http_request_queue where url like 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co/%'),'HTTP timeout covers signature receipt and endpoint budgets');
insert into automation_tap select ok((select bool_and(not headers ? 'x-valtrim-email-sync-secret'
  and not headers ? 'x-valtrim-email-worker-secret' and headers ? 'x-valtrim-email-dispatch-signature') from net.http_request_queue where url like 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co/%'),
  'Queue contains only invocation signatures, never permanent secrets');
insert into automation_tap select is(valtrim.consume_customer_service_email_dispatch(invocation_id,kind,target_id,expires_ms),true,
  'A scheduled invocation is consumed once') from private.customer_service_email_dispatch where kind = 'SYNC';
insert into automation_tap select is(valtrim.consume_customer_service_email_dispatch(invocation_id,kind,target_id,expires_ms),false,
  'Replay cannot start another invocation') from private.customer_service_email_dispatch where kind = 'SYNC';
select valtrim.tick_customer_service_email_automation();
insert into automation_tap select is((select count(*) from net.http_request_queue where url like 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co/%'),2::bigint,'Second tick does not overlap queued requests');
-- Simulate sanitized endpoint outcomes, including a failed HTTP-200 body.
insert into net._http_response(id,status_code,timed_out,content)
  select request_id,200,false,'{"status":"FAILED","errorCode":"PRIVATE_PROVIDER_ERROR"}' from private.customer_service_email_dispatch where kind = 'SYNC';
select private.collect_customer_service_email_dispatch();
insert into automation_tap select is(error_code,'ENDPOINT_ERROR','HTTP 200 with FAILED is not success') from private.customer_service_email_dispatch where kind = 'SYNC';
insert into automation_tap select is(http_status,200,'Sanitized HTTP status remains available for diagnosis') from private.customer_service_email_dispatch where kind = 'SYNC';
insert into automation_tap select ok(retry_not_before > clock_timestamp(),'Endpoint failures back off') from private.customer_service_email_dispatch where kind = 'SYNC';
insert into automation_tap select ok(not exists(select 1 from net._http_response r join net.http_request_queue q on q.id = r.id
  where q.url like 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co/%'),'Only sanitized outcome retained');
-- A complete source is eligible. Delayed retries, active leases, rejected
-- sources and completed requests are excluded by the same worker predicates.
insert into valtrim.service_request_imports(id,tenant_id,mailbox_id,provider_message_id,source_status,source_payload,source_manifest)
  select import_id,tenant,mailbox::text,'pending-fixture','AVAILABLE','{}'::jsonb,'[]'::jsonb from automation_fixture;
insert into automation_tap select is(private.customer_service_email_eligible(connection_id),import_id,'Available source is eligible') from automation_fixture;
update valtrim.service_request_imports set next_attempt_at = clock_timestamp() + interval '5 minutes' where id = (select import_id from automation_fixture);
insert into automation_tap select is(private.customer_service_email_eligible(connection_id),null::uuid,'Future retry is not eligible') from automation_fixture;
update valtrim.service_request_imports set next_attempt_at = null where id = (select import_id from automation_fixture);
update valtrim.service_request_imports set status = 'PROCESSING',worker_token = gen_random_uuid(),
  worker_lease_expires_at = clock_timestamp() + interval '3 minutes',processing_started_at = clock_timestamp(),
  last_attempt_at = clock_timestamp(),attempt_count = 1 where id = (select import_id from automation_fixture);
insert into automation_tap select is(private.customer_service_email_eligible(connection_id),null::uuid,'Live reservation is not eligible') from automation_fixture;
update valtrim.service_request_imports set worker_lease_expires_at = clock_timestamp() - interval '1 minute',worker_failure_count = 3
  where id = (select import_id from automation_fixture);
insert into automation_tap select is(private.customer_service_email_eligible(connection_id),import_id,'Expired work stays eligible so worker can finalize exhausted retries') from automation_fixture;
update valtrim.service_request_imports set worker_token = null,worker_lease_expires_at = null,worker_failure_count = 0,
  processing_started_at = clock_timestamp() - interval '4 minutes' where id = (select import_id from automation_fixture);
insert into automation_tap select is(private.customer_service_email_eligible(connection_id),import_id,'Interrupted processing without token is recoverable') from automation_fixture;
update valtrim.service_request_imports set status = 'PENDING',next_attempt_at = clock_timestamp() + interval '5 minutes'
  where id = (select import_id from automation_fixture);
insert into valtrim.service_request_imports(tenant_id,mailbox_id,provider_message_id,source_status)
  select tenant,mailbox::text,'rejected-fixture','REJECTED' from automation_fixture;
insert into automation_tap select is(private.customer_service_email_eligible(connection_id),null::uuid,'Rejected source cannot start AI') from automation_fixture;
update valtrim.service_request_imports set next_attempt_at = null where id = (select import_id from automation_fixture);
select valtrim.tick_customer_service_email_automation();
insert into automation_tap select is((select count(*) from net.http_request_queue where url = 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co/functions/v1/customer-service-email-worker'),1::bigint,'Worker wakes when work becomes eligible without new mail');
select valtrim.tick_customer_service_email_automation();
insert into automation_tap select is((select count(*) from net.http_request_queue where url = 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co/functions/v1/customer-service-email-worker'),1::bigint,'Queued worker is reserved before it claims');
-- Independent inventory ignores registered and intentionally baseline messages.
insert into private.customer_service_email_baseline_messages(connection_id,message_id) select connection_id,'baseline-message' from automation_fixture;
update automation_scan set claim = valtrim.claim_customer_service_email_folder_scan((select connection_id from automation_fixture));
insert into automation_tap select ok(claim ->> 'token' is not null,'Metadata inventory obtains its own lease') from automation_scan;
insert into automation_tap select is(valtrim.claim_customer_service_email_folder_scan(connection_id),null::jsonb,'Concurrent metadata scan is idle') from automation_fixture;
insert into automation_tap select throws_ok(format('select valtrim.finish_customer_service_email_folder_scan(%L,%L,%L::text[],null)',
  connection_id,gen_random_uuid(),array['missing-message']),'55000','Folder scan lease is no longer valid','Wrong scan token cannot publish metadata') from automation_fixture;
insert into automation_tap select throws_ok(format('select valtrim.finish_customer_service_email_folder_scan(%L,%L,%L::text[],%L)',
  f.connection_id,s.claim ->> 'token',array['M'],'https://graph.microsoft.com/v1.0/users/' || f.mailbox || '/mailFolders/Other/messages?$skip=1'),
  '22023','Graph cursor must belong to the configured mailbox and folder','Inventory rejects a continuation for another folder') from automation_fixture f,automation_scan s;
insert into automation_tap select lives_ok(format('select valtrim.finish_customer_service_email_folder_scan(%L,%L,%L::text[],%L)',
  f.connection_id,s.claim ->> 'token',array['pending-fixture','baseline-message','missing-message'],
  'https://graph.microsoft.com/v1.0/users/' || f.mailbox || '/mailFolders/AutomationFolder/messages?$select=id&$skip=100'),
  'List continuation uses opaque $skip without touching delta') from automation_fixture f,automation_scan s;
insert into automation_tap select is((select count(*) from private.customer_service_email_missing_messages where connection_id = (select connection_id from automation_fixture)),1::bigint,'Only unregistered non-baseline ID is retained');
insert into automation_tap select ok((select cursor_url is null and sync_token is null from private.customer_service_email_connections
  where id = (select connection_id from automation_fixture)),'Inventory does not claim or reset delta');
update automation_scan set claim = valtrim.claim_customer_service_email_folder_scan((select connection_id from automation_fixture));
select valtrim.finish_customer_service_email_folder_scan(f.connection_id,(s.claim ->> 'token')::uuid,array['missing-message'],null,
  p_web_links := '{"missing-message":"https://outlook.office365.com/owa/?ItemID=original"}'::jsonb)
  from automation_fixture f,automation_scan s;
insert into automation_tap select is(web_link,'https://outlook.office365.com/owa/?ItemID=original','Missing message keeps only its permitted original link')
  from private.customer_service_email_missing_messages where connection_id = (select connection_id from automation_fixture);
insert into automation_tap select is(valtrim.claim_customer_service_email_folder_scan(connection_id),null::jsonb,'Completed inventory waits fifteen minutes') from automation_fixture;
update private.customer_service_email_missing_messages set first_seen_at = clock_timestamp() - interval '3 minutes'
  where connection_id = (select connection_id from automation_fixture);
-- Test authorized status with an existing active actor; no person is mutated.
select set_config('request.jwt.claim.sub',(select id::text from valtrim.app_users where is_active and role in ('ADMIN','SCHEDULING') order by id limit 1),true);
insert into automation_tap select ok(valtrim.read_customer_service_email_automation_status() ? 'requestRevision','Authorized status supplies a lightweight list revision');
insert into automation_tap select is(valtrim.read_customer_service_email_automation_status() ->> 'missingCount','1','Missing mail is visible after the delivery grace period');
insert into automation_tap select is(valtrim.read_customer_service_email_automation_status() #>> '{missingMessages,0,webLink}',
  'https://outlook.office365.com/owa/?ItemID=original','Authorized browser can open the original omitted email');
insert into automation_tap select ok(valtrim.read_customer_service_email_automation_status()::text !~ '(cursor_url|sync_token|worker_token|next_url|target_id|invocation_id|decrypted_secret|source_payload|checkpoint)',
  'Status exposes no credentials, reservations, cursor or original source');
select set_config('request.jwt.claim.sub','',true);
update private.customer_service_email_dispatch set started_at = clock_timestamp() - interval '4 minutes' where kind = 'RECONCILE';
select private.collect_customer_service_email_dispatch();
insert into automation_tap select ok(request_id is null and error_code = 'HTTP_TIMEOUT',
  'Lost HTTP response expires visibly without losing business queue state') from private.customer_service_email_dispatch where kind = 'RECONCILE';
select valtrim.configure_customer_service_email_automation(connection_id,false) from automation_fixture;
insert into automation_tap select ok(not active,'Operator pause disables cron') from cron.job where jobname = 'customer-service-email-minute';
insert into automation_tap select is(valtrim.consume_customer_service_email_dispatch(invocation_id,kind,target_id,expires_ms),false,
  'Pause also fences an already queued invocation') from private.customer_service_email_dispatch where kind = 'WORKER';
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
insert into automation_tap select throws_ok('select valtrim.tick_customer_service_email_automation()',
  '42501','Email connection operations require a system context','Forwarded human identity cannot dispatch');
insert into automation_tap select throws_ok('select valtrim.read_customer_service_email_automation_status()',
  '42501','You do not have permission to manage Customer Service requests','Unauthorized actor cannot read status');
select set_config('request.jwt.claim.sub','',true);
insert into automation_tap select is((select count(*) from valtrim.service_requests),requests,'No request created by scheduling or inventory') from automation_fixture;
insert into automation_tap select is((select count(*) from storage.objects),objects,'No binary object uploaded by automation') from automation_fixture;
insert into automation_tap select * from finish();
select result from automation_tap;
rollback;
