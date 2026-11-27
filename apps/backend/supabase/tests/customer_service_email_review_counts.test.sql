-- Linked remote, rollback-only metadata fixtures. No requests, files or AI calls.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public,extensions;
select no_plan();
create temporary table review_counts_tap(result text);
create temporary table review_counts_fixture as select gen_random_uuid() tenant,gen_random_uuid() mailbox,
  gen_random_uuid() connection_id,gen_random_uuid() actor,null::uuid import_id;
insert into auth.users(id,email,raw_user_meta_data)
  select actor,actor::text || '@example.com','{"name":"Review counts fixture"}' from review_counts_fixture;
update valtrim.app_users set role = 'ADMIN' where id = (select actor from review_counts_fixture);
delete from private.customer_service_email_automation;
insert into private.customer_service_email_connections(id,tenant_id,mailbox_id,folder_id,enabled,initial_sync_mode,initialized_at)
  select connection_id,tenant,mailbox,'ReviewCountsFixture',true,'BASELINE_ONLY',clock_timestamp() from review_counts_fixture;
insert into private.customer_service_email_automation(connection_id,project_url,enabled)
  select connection_id,'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',false from review_counts_fixture;
insert into private.customer_service_email_missing_messages(connection_id,message_id,scan_id,first_seen_at)
  select connection_id,message_id,gen_random_uuid(),clock_timestamp() - interval '5 minutes'
    from review_counts_fixture cross join (values('Original A'),('Original B')) m(message_id);
grant select,update on review_counts_fixture to authenticated,service_role;
grant select,insert on review_counts_tap to authenticated,service_role;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub',actor::text,true) from review_counts_fixture;
set local role authenticated;
insert into review_counts_tap select is(valtrim.count_customer_service_email_inbox() ->> 'unmatched','2','Two unmatched originals are emails to match');
insert into review_counts_tap select is(valtrim.count_customer_service_email_inbox() ->> 'importIssues','0','Unmatched emails are not failed imports');
insert into review_counts_tap select is(valtrim.count_customer_service_email_inbox() ->> 'requiresAction','2','Legacy review total remains compatible');
insert into review_counts_tap select is(valtrim.read_customer_service_email_automation_status() -> 'inboxCounts' ->> 'unmatched','2','Automation metadata includes separate counts');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
update review_counts_fixture set import_id = (valtrim.register_customer_service_email_import(tenant,mailbox::text,'New import',
  '{"subject":"New warranty email","bodyText":"Adjust bathroom door"}') ->> 'importId')::uuid;
reset role;
update valtrim.service_request_imports set status = 'NEEDS_ATTENTION',error_code = 'ANALYSIS_INCOMPLETE',error_message = 'Fixture incomplete'
  where id = (select import_id from review_counts_fixture);
select set_config('request.jwt.claim.sub',actor::text,true) from review_counts_fixture;
set local role authenticated;
insert into review_counts_tap select is(valtrim.count_customer_service_email_inbox() ->> 'importIssues','1','A real import issue has its own count');
insert into review_counts_tap select is(valtrim.count_customer_service_email_inbox() ->> 'unmatched','2','A failed import does not change unrelated unmatched emails');
insert into review_counts_tap select is(valtrim.count_customer_service_email_inbox() ->> 'requiresAction','3','Review total includes both categories');
insert into review_counts_tap select ok((c ->> 'unmatched')::int + (c ->> 'importIssues')::int = (c ->> 'requiresAction')::int
  and (c ->> 'processing')::int + (c ->> 'requiresAction')::int + (c ->> 'registered')::int = (c ->> 'total')::int,
  'Counter categories are complete and disjoint') from (select valtrim.count_customer_service_email_inbox() c) x;
reset role;
insert into review_counts_tap select ok(not has_function_privilege(actor,'valtrim.count_customer_service_email_inbox()','EXECUTE'),
  actor || ' cannot read guarded counts') from unnest(array['anon','service_role']) actor;
update valtrim.app_users set role = 'READ_ONLY' where id = (select actor from review_counts_fixture);
set local role authenticated;
insert into review_counts_tap select throws_ok('select valtrim.count_customer_service_email_inbox()','42501',null::text,'Read-only users cannot read counts');
reset role;
select result from review_counts_tap;
select * from finish();
rollback;
