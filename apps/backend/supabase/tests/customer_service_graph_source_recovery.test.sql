-- Remote rollback-only fixtures: no real mailbox, Storage upload or AI.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
create temporary table source_recovery_tap(result text);
create temporary table source_recovery_identity as select gen_random_uuid() tenant,gen_random_uuid() mailbox;
create temporary table source_recovery_connection(data jsonb,original_cursor text);
create temporary table source_recovery_imports(label text,id uuid,version timestamptz);
create temporary table source_recovery_counts as select count(*) requests from valtrim.service_requests;
grant select,insert,update on source_recovery_tap,source_recovery_identity,source_recovery_connection,source_recovery_imports,source_recovery_counts to service_role,authenticated;
create function pg_temp.recover_source(p_import uuid,p_version timestamptz,
  p_source jsonb default '{"body":{"contentType":"text","content":"Original recovery test body"}}',p_files jsonb default '[]')
returns jsonb language sql as $test$
  select valtrim.prepare_customer_service_graph_source_recovery(
    (data ->> 'id')::uuid,(data ->> 'sync_token')::uuid,(data ->> 'revision')::bigint,
    p_import,p_version,p_source,p_files) from source_recovery_connection;
$test$;
insert into source_recovery_tap select ok(has_function_privilege('service_role',
  'valtrim.prepare_customer_service_graph_source_recovery(uuid,uuid,bigint,uuid,timestamptz,jsonb,jsonb)','EXECUTE')
  and not has_function_privilege('anon','valtrim.prepare_customer_service_graph_source_recovery(uuid,uuid,bigint,uuid,timestamptz,jsonb,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','valtrim.prepare_customer_service_graph_source_recovery(uuid,uuid,bigint,uuid,timestamptz,jsonb,jsonb)','EXECUTE'),
  'Source correction is server-only, never an authenticated browser RPC');
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
insert into source_recovery_connection(data) select valtrim.register_customer_service_email_connection(tenant,mailbox,'RecoveryFixture','BASELINE_ONLY') from source_recovery_identity;
update source_recovery_connection set data = valtrim.configure_customer_service_email_connection((data ->> 'id')::uuid,(data ->> 'revision')::bigint,true);
update source_recovery_connection set data = valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid);
insert into source_recovery_imports(label,id)
  select label,(valtrim.register_customer_service_email_import(tenant,mailbox::text,'recovery-' || label,
    '{"subject":"Isolated correction fixture","webLink":"https://outlook.office.com/mail/fixture"}') ->> 'importId')::uuid
  from source_recovery_identity cross join unnest(array['valid','stale','invalid','format','reserved','ordinary-pin','foreign']) label;
select valtrim.reject_customer_service_import_source(id,'ATTACHMENT_SIZE','Original Graph metadata mismatch') from source_recovery_imports;
update source_recovery_imports f set version = i.updated_at from valtrim.service_request_imports i where i.id = f.id;
insert into source_recovery_tap select throws_ok(format('select pg_temp.recover_source(%L,%L)',id,version),
  '55000','Initialize the connection before source recovery','Recovery cannot bypass BASELINE_ONLY initialization') from source_recovery_imports where label = 'valid';
update source_recovery_connection set original_cursor = 'https://graph.microsoft.com/v1.0/users/' || (data ->> 'mailbox_id') || '/mailFolders/RecoveryFixture/messages/delta?$deltatoken=original';
update source_recovery_connection set data = valtrim.checkpoint_customer_service_email_sync((data ->> 'id')::uuid,(data ->> 'sync_token')::uuid,(data ->> 'revision')::bigint,
  'DELTA',original_cursor,array[]::uuid[]);
update source_recovery_connection set data = valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid);
insert into source_recovery_tap select throws_ok(format('select pg_temp.recover_source(%L,%L)',id,version + interval '1 second'),
  '40001','The import changed. Read it again before recovery','Stale import versions cannot reopen a rejection') from source_recovery_imports where label = 'stale';
insert into source_recovery_tap select throws_ok(format('select pg_temp.recover_source(%L,null)',id),
  '40001','The import changed. Read it again before recovery','A version is required') from source_recovery_imports where label = 'stale';
insert into source_recovery_tap select throws_ok(format('select valtrim.prepare_customer_service_graph_source_recovery(%L,%L,%s,%L,%L,%L::jsonb,%L::jsonb)',
  data ->> 'id',gen_random_uuid(),data ->> 'revision',i.id,i.version,'{}','[]'),
  '55000','Email sync lease is no longer valid','A competing reservation cannot reopen a source')
  from source_recovery_connection cross join source_recovery_imports i where label = 'valid';
insert into source_recovery_tap select throws_ok(format('select valtrim.prepare_customer_service_graph_source_recovery(%L,%L,%s,%L,%L,%L::jsonb,%L::jsonb)',
  data ->> 'id',data ->> 'sync_token',(data ->> 'revision')::bigint - 1,i.id,i.version,'{}','[]'),
  '40001','Email connection changed. Read it again','Connection revision fences stale executions')
  from source_recovery_connection cross join source_recovery_imports i where label = 'valid';
insert into source_recovery_tap select throws_ok(format('select pg_temp.recover_source(%L,%L,%L::jsonb,%L::jsonb)',id,version,
  '{"unexpected":"Do not retain"}','[]'),'55000','The complete recovered source could not be prepared',
  'Invalid complete-source payload rolls the reopening back') from source_recovery_imports where label = 'invalid';
insert into source_recovery_tap select throws_ok(format('select pg_temp.recover_source(%L,%L,%L::jsonb,%L::jsonb)',id,version,
  '{"bodyText":"Original"}','[{}]'),'55000','The complete recovered source could not be prepared',
  'Invalid file metadata rolls the reopening back') from source_recovery_imports where label = 'invalid';
insert into source_recovery_tap select ok(i.source_status = 'REJECTED' and i.status = 'NEEDS_ATTENTION'
  and i.error_message = 'Original Graph metadata mismatch' and i.source_manifest is null,
  'Failed preparation preserves the original rejection and minimal source')
  from source_recovery_imports f join valtrim.service_request_imports i on i.id = f.id where label = 'invalid';
update valtrim.service_request_imports set error_code = 'ATTACHMENT_FORMAT' where id = (select id from source_recovery_imports where label = 'format');
insert into source_recovery_tap select throws_ok(format('select pg_temp.recover_source(%L,%L)',id,version),
  '55000','Only an unpinned size rejection can use this correction','Format rejections cannot be silently reopened') from source_recovery_imports where label = 'format';
update valtrim.service_request_imports set worker_token = gen_random_uuid(),worker_lease_expires_at = clock_timestamp() + interval '3 minutes'
  where id = (select id from source_recovery_imports where label = 'reserved');
insert into source_recovery_tap select throws_ok(format('select pg_temp.recover_source(%L,%L)',id,version),
  '55000','The import has an active processing reservation','Worker reservations prevent source recovery') from source_recovery_imports where label = 'reserved';
-- An unrelated prepared import cannot use the recovery replay branch.
update valtrim.service_request_imports set source_status = 'PENDING',status = 'PENDING',error_code = null,error_message = null
  where id = (select id from source_recovery_imports where label = 'ordinary-pin');
select valtrim.prepare_customer_service_import_source(id,'{"bodyText":"Ordinary pinned source"}','[]') from source_recovery_imports where label = 'ordinary-pin';
insert into source_recovery_tap select throws_ok(format('select pg_temp.recover_source(%L,%L)',id,version),
  '55000','Only an unpinned size rejection can use this correction','An unrelated pinned snapshot cannot become a recovery') from source_recovery_imports where label = 'ordinary-pin';
-- Register a different mailbox rather than modifying an immutable identity.
insert into source_recovery_imports(label,id) select 'wrong-mailbox',
  (valtrim.register_customer_service_email_import(tenant,gen_random_uuid()::text,'foreign-mailbox','{}') ->> 'importId')::uuid from source_recovery_identity;
select valtrim.reject_customer_service_import_source(id,'ATTACHMENT_SIZE','Other mailbox') from source_recovery_imports where label = 'wrong-mailbox';
update source_recovery_imports f set version = i.updated_at from valtrim.service_request_imports i where i.id = f.id;
insert into source_recovery_tap select throws_ok(format('select pg_temp.recover_source(%L,%L)',id,version),
  '42501','The import does not belong to this connection mailbox','The recovery is bound to the connection mailbox') from source_recovery_imports where label = 'wrong-mailbox';
insert into source_recovery_tap select is(pg_temp.recover_source(id,version) ->> 'sourceStatus','UPLOADING',
  'A size rejection is reopened and pinned atomically on the SAME receipt') from source_recovery_imports where label = 'valid';
insert into source_recovery_tap select ok(i.status = 'PENDING' and i.request_id is null and i.attachment_refs = '[]'::jsonb
  and i.source_manifest = '[]'::jsonb and i.error_code is null and i.attempt_count = 0,
  'Recovery prepares the validated body without creating a request, files or worker attempt')
  from source_recovery_imports f join valtrim.service_request_imports i on i.id = f.id where label = 'valid';
insert into source_recovery_tap select ok(a.actor_type = 'SYSTEM' and a.previous_values ->> 'errorCode' = 'ATTACHMENT_SIZE'
  and a.previous_values ->> 'errorMessage' = 'Original Graph metadata mismatch'
  and a.metadata ->> 'correction' = 'GRAPH_RAW_ATTACHMENT_SIZE'
  and a.metadata ->> 'connectionId' = c.data ->> 'id',
  'Audit retains the original rejection, correction and connection without impersonating a person')
  from valtrim.audit_events a join source_recovery_imports f on a.entity_id = f.id::text cross join source_recovery_connection c
  where label = 'valid' and a.action = 'SERVICE_EMAIL_GRAPH_SOURCE_RECOVERY';
insert into source_recovery_tap select is(pg_temp.recover_source(id,version) ->> 'sourceStatus','UPLOADING',
  'Lost prepare responses resume the same immutable snapshot with the original version') from source_recovery_imports where label = 'valid';
insert into source_recovery_tap select throws_ok(format('select pg_temp.recover_source(%L,%L,%L::jsonb)',id,version,'{"bodyText":"Changed body"}'),
  '55000','The pinned original email source cannot be replaced','A resumed recovery cannot replace the pinned source') from source_recovery_imports where label = 'valid';
insert into source_recovery_tap select is((select count(*) from valtrim.audit_events where action = 'SERVICE_EMAIL_GRAPH_SOURCE_RECOVERY'
  and entity_id = f.id::text),1::bigint,'Replay does not duplicate the correction audit') from source_recovery_imports f where label = 'valid';
select valtrim.finalize_customer_service_import_source(id) from source_recovery_imports where label = 'valid';
insert into source_recovery_tap select is(pg_temp.recover_source(id,version,'{"bodyText":"Do not overwrite"}') ->> 'sourceStatus','AVAILABLE',
  'Accepted-source replay returns the original without replacing its body') from source_recovery_imports where label = 'valid';
insert into source_recovery_tap select ok(i.source_payload #>> '{body,content}' = 'Original recovery test body'
  and i.request_id is null and i.tenant_id = x.tenant and i.mailbox_id = x.mailbox::text,
  'Recovery preserves identity and the first accepted source')
  from source_recovery_imports f join valtrim.service_request_imports i on i.id = f.id cross join source_recovery_identity x where label = 'valid';
insert into source_recovery_tap select is(valtrim.read_customer_service_email_connection((data ->> 'id')::uuid) ->> 'cursor_url',original_cursor,
  'Source recovery never resets or advances the Graph cursor') from source_recovery_connection;
insert into source_recovery_tap select is((select count(*) from valtrim.service_requests),requests,
  'No request is created before the separately executed worker') from source_recovery_counts;
update source_recovery_connection set data = valtrim.finish_customer_service_email_sync((data ->> 'id')::uuid,(data ->> 'sync_token')::uuid,(data ->> 'revision')::bigint);
insert into source_recovery_tap select throws_ok(format('select pg_temp.recover_source(%L,%L)',id,version),
  '55000','Email sync lease is no longer valid','A released reservation cannot mutate even an accepted source') from source_recovery_imports where label = 'valid';
reset role;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
set local role service_role;
insert into source_recovery_tap select throws_ok(format('select pg_temp.recover_source(%L,%L)',id,version),
  '42501','Email connection operations require a system context','A human JWT cannot impersonate the system recovery') from source_recovery_imports where label = 'valid';
reset role;
select result from source_recovery_tap;
select * from finish();
rollback;
