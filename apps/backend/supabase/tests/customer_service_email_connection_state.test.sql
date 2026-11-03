-- Run against the linked project, or with --preview-migration before installation.
-- Isolated UUIDs and rollback only; no Graph, secrets, Storage or real requests.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
create temporary table connection_tap(result text);
grant select,insert on connection_tap to service_role,authenticated,anon;

create temporary table connection_fixture as select gen_random_uuid() tenant_id,gen_random_uuid() mailbox_id,
  gen_random_uuid() other_tenant_id,gen_random_uuid() other_mailbox_id,
  (select count(*) from valtrim.service_requests) baseline_requests;
create temporary table connection_cases(label text primary key,data jsonb,old_data jsonb,import_id uuid);
insert into connection_cases(label) values('main'),('baseline'),('other tenant'),('other mailbox'),('case sensitive');
create temporary table connection_urls(label text primary key,url text);
insert into connection_urls values
  ('NEXT','https://graph.microsoft.com/v1.0/users/' || (select mailbox_id from connection_fixture) || '/mailFolders/Folder%2b%2f%3d/messages/delta?%24skiptoken=opaque%2Bvalue&%24select=id'),
  ('DELTA','https://graph.microsoft.com/v1.0/users/' || (select mailbox_id from connection_fixture) || '/mailFolders/Folder%2B%2F%3D/messages/delta?$deltatoken=opaque-end');
grant select,update on connection_fixture,connection_cases,connection_urls to service_role,authenticated,anon;

insert into connection_tap select ok((select relrowsecurity from pg_class where oid = 'private.customer_service_email_connections'::regclass),'Connection table has RLS');
insert into connection_tap select ok(not has_table_privilege(actor,'private.customer_service_email_connections','SELECT')
  and not has_table_privilege(actor,'private.customer_service_email_connections','INSERT')
  and not has_table_privilege(actor,'private.customer_service_email_connections','UPDATE')
  and not has_table_privilege(actor,'private.customer_service_email_connections','DELETE'),
  actor || ' cannot directly access connection rows') from unnest(array['anon','authenticated','service_role']) actor;
insert into connection_tap select ok(has_function_privilege('service_role',signature,'EXECUTE')
  and not has_function_privilege('anon',signature,'EXECUTE')
  and not has_function_privilege('authenticated',signature,'EXECUTE'),'Server-only RPC: ' || signature)
from unnest(array[
  'valtrim.register_customer_service_email_connection(uuid,uuid,text,text)',
  'valtrim.read_customer_service_email_connection(uuid)',
  'valtrim.configure_customer_service_email_connection(uuid,bigint,boolean,text)',
  'valtrim.claim_customer_service_email_sync(uuid)',
  'valtrim.checkpoint_customer_service_email_sync(uuid,uuid,bigint,text,text,uuid[])',
  'valtrim.finish_customer_service_email_sync(uuid,uuid,bigint,text)']) signature;
insert into connection_tap select ok(not has_function_privilege('service_role','private.lock_customer_service_email_sync(uuid,uuid,bigint)','EXECUTE'),
  'Private locking helper cannot bypass the public server-only contract');
insert into connection_tap select is((select count(*) from pg_attribute where attrelid = 'private.customer_service_email_connections'::regclass
  and attnum > 0 and not attisdropped and attname ~ '(client_secret|access_token|refresh_token|password|body)'),0::bigint,
  'The table has no provider credential or email body columns');

select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
insert into connection_tap select throws_ok('select valtrim.register_customer_service_email_connection(null,null,null)', '22023',
  'Valid tenant, mailbox object ID, folder and optional initial sync mode are required','Invalid registration is rejected');
update connection_cases set data = valtrim.register_customer_service_email_connection(f.tenant_id,f.mailbox_id,'Folder+/=')
  from connection_fixture f where label = 'main';
update connection_cases set data = valtrim.register_customer_service_email_connection(f.tenant_id,f.mailbox_id,'Baseline','BASELINE_ONLY')
  from connection_fixture f where label = 'baseline';
update connection_cases set data = valtrim.register_customer_service_email_connection(f.tenant_id,f.mailbox_id,'folder+/=')
  from connection_fixture f where label = 'case sensitive';
insert into connection_tap select isnt((select data ->> 'id' from connection_cases where label = 'main'),
  (select data ->> 'id' from connection_cases where label = 'case sensitive'),'Folder IDs remain case-sensitive');
insert into connection_tap select is(data ->> 'enabled','false','New connections are disabled') from connection_cases where label = 'main';
insert into connection_tap select ok(data -> 'initial_sync_mode' = 'null'::jsonb and data -> 'cursor_url' = 'null'::jsonb
  and data -> 'last_success_at' = 'null'::jsonb,'No initial history policy, cursor or success is invented') from connection_cases where label = 'main';
insert into connection_tap select ok(valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid) is null,'Disabled connections cannot be claimed') from connection_cases where label = 'main';
insert into connection_tap select throws_ok(format('select valtrim.configure_customer_service_email_connection(%L,%s,true)',data ->> 'id',data ->> 'revision'),
  '22023','Choose an initial sync mode before enabling the connection','History import decision is required before activation') from connection_cases where label = 'main';
update connection_cases set old_data = data,data = valtrim.register_customer_service_email_connection(f.tenant_id,f.mailbox_id,'Folder+/=','IMPORT_EXISTING')
  from connection_fixture f where label = 'main';
insert into connection_tap select ok(data ->> 'id' = old_data ->> 'id' and data ->> 'revision' = old_data ->> 'revision'
  and data -> 'initial_sync_mode' = 'null'::jsonb and data ->> 'idempotentReplay' = 'true',
  'Re-registering preserves configuration and does not silently select a history policy') from connection_cases where label = 'main';

update connection_cases set data = valtrim.configure_customer_service_email_connection((data ->> 'id')::uuid,(data ->> 'revision')::bigint,true,'IMPORT_EXISTING') where label = 'main';
insert into connection_tap select throws_ok(format('select valtrim.configure_customer_service_email_connection(%L,1,false)',data ->> 'id'),
  '40001','Email connection changed. Read it again','Stale configuration writes are rejected') from connection_cases where label = 'main';
update connection_cases set data = valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid) where label = 'main';
insert into connection_tap select ok(data ->> 'sync_token' is not null and (data ->> 'attempt_count')::int = 1,'Claim records one fenced attempt') from connection_cases where label = 'main';
insert into connection_tap select ok(valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid) is null,'Another invocation cannot take an active reservation') from connection_cases where label = 'main';
insert into connection_tap select throws_ok(format('select valtrim.finish_customer_service_email_sync(%L,%L,%s)',data ->> 'id',gen_random_uuid(),data ->> 'revision'),
  '55000','Email sync lease is no longer valid','A wrong reservation cannot write') from connection_cases where label = 'main';
insert into connection_tap select throws_ok(format('select valtrim.checkpoint_customer_service_email_sync(%L,%L,1,%L,%L)',data ->> 'id',data ->> 'sync_token','NEXT',u.url),
  '40001','Email connection changed. Read it again','A stale page revision cannot advance the cursor') from connection_cases c cross join connection_urls u where c.label = 'main' and u.label = 'NEXT';

insert into connection_tap select throws_ok(format('select valtrim.checkpoint_customer_service_email_sync(%L,%L,%s,%L,%L)',data ->> 'id',data ->> 'sync_token',data ->> 'revision','NEXT',replace(u.url,'Folder%2b%2f%3d','Other')),
  '22023','Graph cursor must belong to the configured mailbox and folder','Another folder cannot replace the cursor') from connection_cases c cross join connection_urls u where c.label = 'main' and u.label = 'NEXT';
insert into connection_tap select throws_ok(format('select valtrim.checkpoint_customer_service_email_sync(%L,%L,%s,%L,%L)',data ->> 'id',data ->> 'sync_token',data ->> 'revision','NEXT',replace(u.url,'https:','http:')),
  '22023','Invalid Graph cursor','Insecure continuation URLs are rejected') from connection_cases c cross join connection_urls u where c.label = 'main' and u.label = 'NEXT';
insert into connection_tap select throws_ok(format('select valtrim.checkpoint_customer_service_email_sync(%L,%L,%s,%L,%L)',data ->> 'id',data ->> 'sync_token',data ->> 'revision','NEXT',u.url || '&$deltatoken='),
  '22023','Graph cursor kind and continuation token must agree','Even an empty contradictory token is rejected') from connection_cases c cross join connection_urls u where c.label = 'main' and u.label = 'NEXT';
insert into connection_tap select throws_ok(format('select valtrim.checkpoint_customer_service_email_sync(%L,%L,%s,%L,%L)',
  data ->> 'id',data ->> 'sync_token',data ->> 'revision','NEXT',bad.url),
  '22023',null,'Reject unsafe cursor: ' || bad.label)
  from connection_cases c cross join connection_urls u cross join lateral (values
    ('different host',replace(u.url,'graph.microsoft.com','graph.microsoft.com.evil.test')),
    ('URL credentials',replace(u.url,'graph.microsoft.com','user:password@graph.microsoft.com')),
    ('different mailbox',replace(u.url,(select mailbox_id::text from connection_fixture),(select other_mailbox_id::text from connection_fixture))),
    ('fragment',u.url || '#fragment'),
    ('raw newline',u.url || E'\n'),
    ('raw backslash',u.url || chr(92)),
    ('invalid path escape',replace(u.url,'%2b','%ZZ')),
    ('invalid UTF8 path',replace(u.url,'%2b','%FF')),
    ('duplicate token',u.url || '&$skiptoken=duplicate'),
    ('empty duplicate token',u.url || '&$skiptoken='),
    ('empty token',split_part(u.url,'?',1) || '?$skiptoken='),
    ('wrong cursor kind',replace(u.url,'skiptoken','deltatoken'))
  ) bad(label,url) where c.label = 'main' and u.label = 'NEXT';

update connection_cases set import_id = (valtrim.register_customer_service_email_import(f.tenant_id,f.mailbox_id::text,'main-message') ->> 'importId')::uuid
  from connection_fixture f where label = 'main';
update connection_cases set import_id = (valtrim.register_customer_service_email_import(f.other_tenant_id,f.mailbox_id::text,'other-tenant') ->> 'importId')::uuid
  from connection_fixture f where label = 'other tenant';
update connection_cases set import_id = (valtrim.register_customer_service_email_import(f.tenant_id,f.other_mailbox_id::text,'other-mailbox') ->> 'importId')::uuid
  from connection_fixture f where label = 'other mailbox';
insert into connection_tap select throws_ok(format('select valtrim.checkpoint_customer_service_email_sync(%L,%L,%s,%L,%L,ARRAY[%L]::uuid[])',
  data ->> 'id',data ->> 'sync_token',data ->> 'revision','NEXT',u.url,import_id),
  '22023','Every page import must be durably retained for this tenant and mailbox','A receipt with source still pending cannot be skipped')
  from connection_cases c cross join connection_urls u where c.label = 'main' and u.label = 'NEXT';
select valtrim.reject_customer_service_import_source(import_id,'ATTACHMENT_FORMAT','Synthetic invalid attachment') from connection_cases where import_id is not null;
insert into connection_tap select throws_ok(format('select valtrim.checkpoint_customer_service_email_sync(%L,%L,%s,%L,%L,ARRAY[%L]::uuid[])',
  main.data ->> 'id',main.data ->> 'sync_token',main.data ->> 'revision','NEXT',u.url,foreign_case.import_id),
  '22023','Every page import must be durably retained for this tenant and mailbox','Receipt from ' || foreign_case.label || ' cannot acknowledge this page')
  from connection_cases main cross join connection_cases foreign_case cross join connection_urls u
  where main.label = 'main' and foreign_case.label in('other tenant','other mailbox') and u.label = 'NEXT';
insert into connection_tap select throws_ok(format('select valtrim.checkpoint_customer_service_email_sync(%L,%L,%s,%L,%L,ARRAY[%L]::uuid[])',
  data ->> 'id',data ->> 'sync_token',data ->> 'revision','NEXT',u.url,gen_random_uuid()),
  '22023','Every page import must be durably retained for this tenant and mailbox','Nonexistent receipt cannot acknowledge a page')
  from connection_cases c cross join connection_urls u where c.label = 'main' and u.label = 'NEXT';

update connection_cases c set old_data = data,data = valtrim.checkpoint_customer_service_email_sync(
  (data ->> 'id')::uuid,(data ->> 'sync_token')::uuid,(data ->> 'revision')::bigint,'NEXT',u.url,array[import_id])
  from connection_urls u where c.label = 'main' and u.label = 'NEXT';
insert into connection_tap select ok(data ->> 'cursor_url' = u.url and data ->> 'cursor_kind' = 'NEXT' and data -> 'last_success_at' = 'null'::jsonb
  and data ->> 'sync_token' = old_data ->> 'sync_token','A complete retained page advances verbatim, without claiming full sync success')
  from connection_cases c cross join connection_urls u where c.label = 'main' and u.label = 'NEXT';
insert into connection_tap select throws_ok(format('select valtrim.finish_customer_service_email_sync(%L,%L,%s)',old_data ->> 'id',old_data ->> 'sync_token',old_data ->> 'revision'),
  '40001','Email connection changed. Read it again','An older page response cannot release the updated reservation') from connection_cases where label = 'main';
insert into connection_tap select throws_ok(format('select valtrim.finish_customer_service_email_sync(%L,%L,%s,%L)',data ->> 'id',data ->> 'sync_token',data ->> 'revision','Bearer raw-secret'),
  '22023','Use a known sanitized connection error code','Raw provider errors or credentials cannot be stored') from connection_cases where label = 'main';
update connection_cases set data = valtrim.finish_customer_service_email_sync((data ->> 'id')::uuid,(data ->> 'sync_token')::uuid,(data ->> 'revision')::bigint,'AUTH_FAILED') where label = 'main';
insert into connection_tap select ok(data ->> 'cursor_url' = u.url and data -> 'sync_token' = 'null'::jsonb and data ->> 'last_error_code' = 'AUTH_FAILED'
  and data ->> 'last_error_message' = 'Microsoft no pudo autenticar la aplicación. Revisa sus credenciales.'
  and data -> 'last_success_at' = 'null'::jsonb,'Failure preserves last durable page and stores only a fixed diagnostic')
  from connection_cases c cross join connection_urls u where c.label = 'main' and u.label = 'NEXT';
update connection_cases set data = valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid) where label = 'main';
insert into connection_tap select ok(data ->> 'cursor_url' = u.url and data ->> 'last_error_code' = 'AUTH_FAILED','A later invocation resumes the durable cursor without erasing the last error')
  from connection_cases c cross join connection_urls u where c.label = 'main' and u.label = 'NEXT';
update connection_cases c set data = valtrim.checkpoint_customer_service_email_sync((data ->> 'id')::uuid,(data ->> 'sync_token')::uuid,(data ->> 'revision')::bigint,'DELTA',u.url)
  from connection_urls u where c.label = 'main' and u.label = 'DELTA';
insert into connection_tap select ok(data ->> 'cursor_url' = u.url and data -> 'sync_token' = 'null'::jsonb
  and data ->> 'last_success_at' is not null and data ->> 'initialized_at' is not null
  and data -> 'last_error_code' = 'null'::jsonb,'Only DELTA completes synchronization and clears its error')
  from connection_cases c cross join connection_urls u where c.label = 'main' and u.label = 'DELTA';
insert into connection_tap select throws_ok(format('select valtrim.configure_customer_service_email_connection(%L,%s,true,%L)',data ->> 'id',data ->> 'revision','BASELINE_ONLY'),
  '22023','Connection identity and a started initial sync mode cannot be replaced','A started import cannot silently become a baseline that skips messages') from connection_cases where label = 'main';

update connection_cases set old_data = data,data = valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid) where label = 'main';
reset role;
update private.customer_service_email_connections set sync_lease_expires_at = clock_timestamp() - interval '1 second'
  where id = (select (data ->> 'id')::uuid from connection_cases where label = 'main');
set local role service_role;
update connection_cases set old_data = data,data = valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid) where label = 'main';
insert into connection_tap select ok(data ->> 'sync_token' <> old_data ->> 'sync_token' and data ->> 'cursor_url' = old_data ->> 'cursor_url',
  'An expired execution gets a new fencing token without losing progress') from connection_cases where label = 'main';
insert into connection_tap select throws_ok(format('select valtrim.finish_customer_service_email_sync(%L,%L,%s,%L)',old_data ->> 'id',old_data ->> 'sync_token',old_data ->> 'revision','SYNC_ERROR'),
  '55000','Email sync lease is no longer valid','An expired execution cannot overwrite the replacement') from connection_cases where label = 'main';
update connection_cases set old_data = data,data = valtrim.configure_customer_service_email_connection((data ->> 'id')::uuid,(data ->> 'revision')::bigint,false) where label = 'main';
insert into connection_tap select ok(data ->> 'enabled' = 'false' and data -> 'sync_token' = 'null'::jsonb and data ->> 'cursor_url' = old_data ->> 'cursor_url',
  'Disabling revokes the current lease but preserves progress') from connection_cases where label = 'main';
insert into connection_tap select throws_ok(format('select valtrim.finish_customer_service_email_sync(%L,%L,%s)',old_data ->> 'id',old_data ->> 'sync_token',old_data ->> 'revision'),
  '55000','Email sync lease is no longer valid','Disabled execution cannot commit a late page') from connection_cases where label = 'main';
update connection_cases set old_data = data,data = valtrim.register_customer_service_email_connection(f.tenant_id,f.mailbox_id,'Folder+/=','BASELINE_ONLY')
  from connection_fixture f where label = 'main';
insert into connection_tap select ok(data ->> 'id' = old_data ->> 'id' and data ->> 'revision' = old_data ->> 'revision'
  and data ->> 'cursor_url' = old_data ->> 'cursor_url' and data ->> 'enabled' = 'false'
  and data ->> 'initial_sync_mode' = 'IMPORT_EXISTING','Registration replay cannot reset progress, change policy or re-enable a disabled connection') from connection_cases where label = 'main';

update connection_cases set data = valtrim.configure_customer_service_email_connection((data ->> 'id')::uuid,(data ->> 'revision')::bigint,true) where label = 'baseline';
update connection_cases set data = valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid) where label = 'baseline';
insert into connection_tap select throws_ok(format('select valtrim.checkpoint_customer_service_email_sync(%L,%L,%s,%L,%L,ARRAY[%L]::uuid[])',
  b.data ->> 'id',b.data ->> 'sync_token',b.data ->> 'revision','DELTA',replace(u.url,'Folder%2B%2F%3D','Baseline'),main.import_id),
  '22023','Invalid durable page import identities','An initial baseline cannot pretend to import historical messages')
  from connection_cases b cross join connection_cases main cross join connection_urls u where b.label = 'baseline' and main.label = 'main' and u.label = 'DELTA';
update connection_cases c set data = valtrim.checkpoint_customer_service_email_sync((data ->> 'id')::uuid,(data ->> 'sync_token')::uuid,(data ->> 'revision')::bigint,'DELTA',replace(u.url,'Folder%2B%2F%3D','Baseline'))
  from connection_urls u where c.label = 'baseline' and u.label = 'DELTA';
insert into connection_tap select ok(data ->> 'initialized_at' is not null and data -> 'sync_token' = 'null'::jsonb,'An explicitly selected baseline can retain the initial delta boundary') from connection_cases where label = 'baseline';
update connection_cases set old_data = data,data = valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid) where label = 'baseline';
update connection_cases set data = valtrim.finish_customer_service_email_sync((data ->> 'id')::uuid,(data ->> 'sync_token')::uuid,(data ->> 'revision')::bigint) where label = 'baseline';
insert into connection_tap select ok(data ->> 'last_success_at' = old_data ->> 'last_success_at' and data ->> 'cursor_url' = old_data ->> 'cursor_url'
  and data ->> 'cursor_kind' = 'DELTA','Yielding preserves the exact previous success without inventing a new cursor') from connection_cases where label = 'baseline';

select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
insert into connection_tap select throws_ok(format('select valtrim.read_customer_service_email_connection(%L)',data ->> 'id'),
  '42501','Email connection operations require a system context','A service client forwarding a human identity cannot access private configuration') from connection_cases where label = 'main';
select set_config('request.jwt.claim.sub','',true);
reset role;
set local role authenticated;
insert into connection_tap select throws_ok(format('select valtrim.read_customer_service_email_connection(%L)',data ->> 'id'),
  '42501',null,'Even an authenticated application caller cannot read configuration or cursors') from connection_cases where label = 'main';
reset role;
set local role anon;
insert into connection_tap select throws_ok(format('select valtrim.claim_customer_service_email_sync(%L)',data ->> 'id'),
  '42501',null,'Anonymous callers cannot start synchronization') from connection_cases where label = 'main';
reset role;
insert into connection_tap select throws_ok(format('update private.customer_service_email_connections set tenant_id = %L where id = %L',gen_random_uuid(),data ->> 'id'),
  '22023','Connection identity and a started initial sync mode cannot be replaced','Even direct maintenance cannot relabel a cursor for another tenant') from connection_cases where label = 'main';
insert into connection_tap select is((select count(*) from valtrim.service_requests),baseline_requests,'Configuration and sync state create no requests') from connection_fixture;
insert into connection_tap select * from finish();
select result from connection_tap;
rollback;
