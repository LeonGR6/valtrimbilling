-- Preview with the pending migration against the linked project. No real data,
-- Graph requests, Storage objects or sequences are used; all fixtures roll back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
create temporary table graph_retry_tap(result text);
create temporary table graph_retry_fixture as select gen_random_uuid() tenant,gen_random_uuid() mailbox;
create temporary table graph_retry_state(data jsonb,previous jsonb);
create temporary table graph_delivery_state(data jsonb,import_id uuid,worker jsonb);
grant select,insert,update on graph_retry_state,graph_retry_fixture,graph_retry_tap,graph_delivery_state to service_role,authenticated;
insert into graph_retry_tap select ok(has_function_privilege('service_role','valtrim.defer_customer_service_email_sync(uuid,uuid,bigint,text,integer)','EXECUTE')
  and not has_function_privilege('anon','valtrim.defer_customer_service_email_sync(uuid,uuid,bigint,text,integer)','EXECUTE')
  and not has_function_privilege('authenticated','valtrim.defer_customer_service_email_sync(uuid,uuid,bigint,text,integer)','EXECUTE'),'Graph backoff RPC is server-only');
insert into graph_retry_tap select ok(not has_table_privilege(actor,'private.customer_service_email_baseline_messages','SELECT')
  and not has_table_privilege(actor,'private.customer_service_email_baseline_messages','INSERT'),'Baseline IDs are private to the system RPCs: ' || actor)
  from unnest(array['anon','authenticated','service_role']) actor;
insert into graph_retry_tap select ok(has_function_privilege('service_role',signature,'EXECUTE') and not has_function_privilege('authenticated',signature,'EXECUTE')
  and not has_function_privilege('anon',signature,'EXECUTE'),'Server-only baseline RPC: ' || signature)
  from unnest(array['valtrim.read_customer_service_email_baseline_matches(uuid,uuid,bigint,text[])',
    'valtrim.checkpoint_customer_service_email_graph_page(uuid,uuid,bigint,text,text,uuid[],text[],text[])']) signature;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
insert into graph_retry_state(data) select valtrim.register_customer_service_email_connection(tenant,mailbox,'GraphRetryFixture','BASELINE_ONLY') from graph_retry_fixture;
insert into graph_retry_tap select ok(data ->> 'enabled' = 'false' and data -> 'retry_not_before' = 'null'::jsonb,'Registration is disabled without invented delay') from graph_retry_state;
update graph_retry_state set data = valtrim.configure_customer_service_email_connection((data ->> 'id')::uuid,(data ->> 'revision')::bigint,true);
update graph_retry_state set data = valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid);
update graph_retry_state set previous = data,data = valtrim.defer_customer_service_email_sync((data ->> 'id')::uuid,(data ->> 'sync_token')::uuid,(data ->> 'revision')::bigint,'GRAPH_THROTTLED',120);
insert into graph_retry_tap select ok(data -> 'sync_token' = 'null'::jsonb and data -> 'cursor_url' = 'null'::jsonb and data -> 'last_success_at' = 'null'::jsonb,'Backoff releases the lease without inventing a cursor or success') from graph_retry_state;
insert into graph_retry_tap select ok((data ->> 'retry_not_before')::timestamptz > clock_timestamp() + interval '110 seconds' and data ->> 'last_error_code' = 'GRAPH_THROTTLED','Provider retry delay is durable and uses server time') from graph_retry_state;
insert into graph_retry_tap select ok(valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid) is null,'SQL rejects an early retry') from graph_retry_state;
insert into graph_retry_tap select throws_ok(format('select valtrim.defer_customer_service_email_sync(%L,%L,%s,%L,120)',previous ->> 'id',previous ->> 'sync_token',previous ->> 'revision','GRAPH_THROTTLED'),'55000','Email sync lease is no longer valid','An old invocation cannot extend another retry delay') from graph_retry_state;
update graph_retry_state set previous = data,data = valtrim.register_customer_service_email_connection(f.tenant,f.mailbox,'GraphRetryFixture','IMPORT_EXISTING') from graph_retry_fixture f;
insert into graph_retry_tap select ok(data ->> 'initial_sync_mode' = 'BASELINE_ONLY' and data -> 'retry_not_before' = previous -> 'retry_not_before','Duplicate registration preserves the chosen policy and backoff') from graph_retry_state;
update graph_retry_state set data = valtrim.configure_customer_service_email_connection((data ->> 'id')::uuid,(data ->> 'revision')::bigint,false);
update graph_retry_state set data = valtrim.configure_customer_service_email_connection((data ->> 'id')::uuid,(data ->> 'revision')::bigint,true);
insert into graph_retry_tap select ok(valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid) is null,'Toggling activation does not bypass provider backoff') from graph_retry_state;
reset role;
update private.customer_service_email_connections set retry_not_before = clock_timestamp() - interval '1 second' where id = (select (data ->> 'id')::uuid from graph_retry_state);
set local role service_role;
update graph_retry_state set data = valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid);
insert into graph_retry_tap select ok(data ->> 'sync_token' is not null and data -> 'retry_not_before' = 'null'::jsonb,'A due retry acquires a fresh lease and clears the delay') from graph_retry_state;
insert into graph_retry_tap select throws_ok(format('select valtrim.defer_customer_service_email_sync(%L,%L,%s,%L,-1)',data ->> 'id',data ->> 'sync_token',data ->> 'revision','GRAPH_THROTTLED'),'22023','Use a known connection error and a nonnegative retry delay','Negative delay is rejected') from graph_retry_state;
insert into graph_retry_tap select throws_ok(format('select valtrim.defer_customer_service_email_sync(%L,%L,%s,%L,1)',data ->> 'id',data ->> 'sync_token',data ->> 'revision','AUTH_FAILED'),'22023','Use a known connection error and a nonnegative retry delay','Only transient provider errors can impose a retry delay') from graph_retry_state;
update graph_retry_state set data = valtrim.defer_customer_service_email_sync((data ->> 'id')::uuid,(data ->> 'sync_token')::uuid,(data ->> 'revision')::bigint,'CURSOR_EXPIRED',0);
insert into graph_retry_tap select ok(valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid) is null,'An expired delta cursor cannot restart silently') from graph_retry_state;
insert into graph_retry_tap select ok(data ->> 'initial_sync_mode' = 'BASELINE_ONLY' and data -> 'initialized_at' = 'null'::jsonb,'Expired state preserves the chosen mode without manufacturing initialization') from graph_retry_state;

-- Exercise the handoff through the actual RPCs: baseline, retain a complete
-- body-only source, checkpoint it, then let the existing worker claim it.
insert into graph_delivery_state(data) select valtrim.register_customer_service_email_connection(tenant,mailbox,'GraphDeliveryFixture','BASELINE_ONLY') from graph_retry_fixture;
update graph_delivery_state set data = valtrim.configure_customer_service_email_connection((data ->> 'id')::uuid,(data ->> 'revision')::bigint,true);
update graph_delivery_state set data = valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid);
update graph_delivery_state set data = valtrim.checkpoint_customer_service_email_graph_page((data ->> 'id')::uuid,(data ->> 'sync_token')::uuid,(data ->> 'revision')::bigint,'DELTA',
  'https://graph.microsoft.com/v1.0/users/' || (data ->> 'mailbox_id') || '/mailFolders/GraphDeliveryFixture/messages/delta?$deltatoken=baseline-fixture',
  array[]::uuid[],array['Historical','historical'],array[]::text[]);
update graph_delivery_state set data = valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid);
insert into graph_retry_tap select is(valtrim.read_customer_service_email_baseline_matches((data ->> 'id')::uuid,(data ->> 'sync_token')::uuid,(data ->> 'revision')::bigint,array['Historical','historical','HISTORICAL']),
  '["Historical","historical"]'::jsonb,'Historical membership is durable and case-sensitive without creating imports') from graph_delivery_state;
insert into graph_retry_tap select throws_ok(format('select valtrim.checkpoint_customer_service_email_graph_page(%L,%L,%s,%L,%L,array[%L]::uuid[],array[]::text[],array[%L]::text[])',
  data ->> 'id',data ->> 'sync_token',data ->> 'revision','DELTA',data ->> 'cursor_url',gen_random_uuid(),'Historical'),
  '22023','Every page import must be durably retained for this tenant and mailbox','A failed page cannot remove baseline protection') from graph_delivery_state;
insert into graph_retry_tap select is(valtrim.read_customer_service_email_baseline_matches((data ->> 'id')::uuid,(data ->> 'sync_token')::uuid,(data ->> 'revision')::bigint,array['Historical']),
  '["Historical"]'::jsonb,'Baseline membership rolled back together with the failed checkpoint') from graph_delivery_state;
update graph_delivery_state set import_id = (valtrim.register_customer_service_email_import((data ->> 'tenant_id')::uuid,data ->> 'mailbox_id','graph-delivery-fixture',
  '{"webLink":"https://outlook.office.com/mail/fixture"}') ->> 'importId')::uuid;
insert into graph_retry_tap select ok(valtrim.prepare_customer_service_import_source(import_id,
  '{"subject":"Isolated Graph fixture","body":{"contentType":"text","content":"Owner: Test Homeowner. Item: repair door."}}','[]') ->> 'sourceStatus' = 'UPLOADING','Complete source is pinned using the existing intake contract') from graph_delivery_state;
insert into graph_retry_tap select ok(valtrim.finalize_customer_service_import_source(import_id) ->> 'sourceStatus' = 'AVAILABLE','Body-only email becomes available without creating Storage objects') from graph_delivery_state;
update graph_delivery_state set data = valtrim.checkpoint_customer_service_email_graph_page((data ->> 'id')::uuid,(data ->> 'sync_token')::uuid,(data ->> 'revision')::bigint,'DELTA',
  'https://graph.microsoft.com/v1.0/users/' || (data ->> 'mailbox_id') || '/mailFolders/GraphDeliveryFixture/messages/delta?$deltatoken=delivery-fixture',array[import_id],array[]::text[],array['Historical']);
update graph_delivery_state set data = valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid);
insert into graph_retry_tap select is(valtrim.read_customer_service_email_baseline_matches((data ->> 'id')::uuid,(data ->> 'sync_token')::uuid,(data ->> 'revision')::bigint,array['Historical','historical']),
  '["historical"]'::jsonb,'An observed folder exit removes only that baseline membership, allowing a later reentry') from graph_delivery_state;
update graph_delivery_state set data = valtrim.finish_customer_service_email_sync((data ->> 'id')::uuid,(data ->> 'sync_token')::uuid,(data ->> 'revision')::bigint);
update graph_delivery_state set worker = valtrim.claim_customer_service_email_import(import_id);
insert into graph_retry_tap select ok(worker ->> 'status' = 'PROCESSING' and worker -> 'requestId' = 'null'::jsonb,'Existing worker can claim the retained Graph source without an invented request') from graph_delivery_state;
insert into graph_retry_tap select ok(valtrim.finish_customer_service_email_worker(import_id,(worker ->> 'workerToken')::uuid,'CONTINUE') ->> 'status' = 'PENDING','Worker continuation remains durable without IA, a request or human approval') from graph_delivery_state;
reset role;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
set local role service_role;
insert into graph_retry_tap select throws_ok(format('select valtrim.claim_customer_service_email_sync(%L)',data ->> 'id'),'42501','Email connection operations require a system context','Human impersonation is still rejected') from graph_retry_state;
reset role;
select result from graph_retry_tap;
select * from finish();
rollback;
