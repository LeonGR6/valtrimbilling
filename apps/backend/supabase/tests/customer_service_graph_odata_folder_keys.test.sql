-- Isolated identities, no real connection/Graph/Storage/requests. Rollback only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
create temporary table odata_tap(result text);
create temporary table odata_fixture as select gen_random_uuid() tenant_id,gen_random_uuid() mailbox_id,
  (select count(*) from valtrim.service_requests) request_count;
create temporary table odata_urls(label text,kind text,folder_id text,url text);
create temporary table odata_state(data jsonb);
insert into odata_urls select 'slash NEXT','NEXT','Folder+/=',
  'https://graph.microsoft.com/v1.0/users/' || mailbox_id || '/mailFolders/Folder%2B%2F%3D/messages/delta?%24skiptoken=Opaque%2Bexact&$select=id' from odata_fixture;
insert into odata_urls select 'key NEXT','NEXT','Folder+/=',
  'https://graph.microsoft.com/v1.0/users/' || mailbox_id || $url$/mailFolders('Folder%2B%2F%3D')/messages/delta?%24skiptoken=Opaque%2Bexact&$select=id$url$ from odata_fixture;
insert into odata_urls select 'key DELTA','DELTA','Folder+/=',
  'https://graph.microsoft.com/v1.0/users/' || mailbox_id || $url$/mailFolders('Folder%2B%2F%3D')/messages/delta?$deltatoken=Opaque%2Fexact%3D$url$ from odata_fixture;
insert into odata_urls select 'encoded key quotes','DELTA','Folder+/=',
  'https://graph.microsoft.com/v1.0/users/' || mailbox_id || '/mailFolders(%27Folder%2b%2f%3d%27)/messages/delta?$deltatoken=Opaque%2Fexact%3D' from odata_fixture;
insert into odata_urls select 'escaped literal apostrophe','DELTA',$folder$Folder's+/=$folder$,
  'https://graph.microsoft.com/v1.0/users/' || mailbox_id || $url$/mailFolders('Folder''s%2B%2F%3D')/messages/delta?$deltatoken=Opaque%2Fexact%3D$url$ from odata_fixture;

insert into odata_tap select lives_ok(format('select private.validate_customer_service_graph_cursor(%L,%L,%L,%L)',f.mailbox_id,u.folder_id,u.kind,u.url),
  'Accept and bind ' || u.label) from odata_urls u cross join odata_fixture f;
insert into odata_tap select throws_ok(format('select private.validate_customer_service_graph_cursor(%L,%L,%L,%L)',f.mailbox_id,'Folder+/=','NEXT',bad.url),
  '22023',null,'Reject unsafe key URL: ' || bad.label)
  from odata_fixture f cross join odata_urls u cross join lateral (values
    ('other mailbox',replace(u.url,f.mailbox_id::text,f.tenant_id::text)),
    ('folder case changed',replace(u.url,'Folder','folder')),
    ('other folder',replace(u.url,'Folder%2B%2F%3D','Other')),
    ('different host',replace(u.url,'graph.microsoft.com','graph.microsoft.com.evil.test')),
    ('URL credentials',replace(u.url,'graph.microsoft.com','user:password@graph.microsoft.com')),
    ('explicit port',replace(u.url,'graph.microsoft.com','graph.microsoft.com:443')),
    ('http',replace(u.url,'https:','http:')),
    ('missing quote',replace(u.url,$part$')/messages$part$,$part$)/messages$part$)),
    ('suffix after key',replace(u.url,$part$')/messages$part$,$part$')suffix/messages$part$)),
    ('unescaped quote',replace(u.url,'Folder%2B%2F%3D',$part$Folder'Injected$part$)),
    ('extra path',replace(u.url,'/messages/delta','/messages/delta/extra')),
    ('path traversal',replace(u.url,'/messages/delta','/../messages/delta')),
    ('encoded traversal',replace(u.url,'/messages/delta','/%2e/messages/delta')),
    ('double encoding',replace(u.url,'Folder%2B%2F%3D','Folder%252B%252F%253D')),
    ('bad path escape',replace(u.url,'%2B','%ZZ')),
    ('bad path UTF8',replace(u.url,'%2B','%FF')),
    ('fragment',u.url || '#fragment'),
    ('whitespace',u.url || E'\n'),
    ('duplicate token',u.url || '&$skiptoken=duplicate'),
    ('conflicting token',u.url || '&$deltatoken=other'),
    ('wrong kind',replace(u.url,'skiptoken','deltatoken')),
    ('empty token',split_part(u.url,'?',1) || '?$skiptoken=')
  ) bad(label,url) where u.label = 'key NEXT';

insert into odata_tap select ok(not has_function_privilege(actor,'private.validate_customer_service_graph_cursor(uuid,text,text,text)','EXECUTE'),
  'Private cursor validator remains inaccessible to ' || actor) from unnest(array['anon','authenticated','service_role']) actor;
grant select,insert on odata_tap to service_role;
grant select on odata_fixture,odata_urls to service_role;
grant select,insert,update on odata_state to service_role;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
insert into odata_state select valtrim.register_customer_service_email_connection(tenant_id,mailbox_id,'Folder+/=','BASELINE_ONLY') from odata_fixture;
update odata_state set data = valtrim.configure_customer_service_email_connection((data ->> 'id')::uuid,(data ->> 'revision')::bigint,true);
update odata_state set data = valtrim.claim_customer_service_email_sync((data ->> 'id')::uuid);
update odata_state s set data = valtrim.checkpoint_customer_service_email_graph_page((data ->> 'id')::uuid,(data ->> 'sync_token')::uuid,(data ->> 'revision')::bigint,u.kind,u.url,
  array[]::uuid[],array['historical-fixture'],array[]::text[]) from odata_urls u where u.label='key NEXT';
insert into odata_tap select is(data ->> 'cursor_url',u.url,'NEXT stores the exact OData URL and opaque query') from odata_state cross join odata_urls u where u.label='key NEXT';
update odata_state s set data = valtrim.checkpoint_customer_service_email_graph_page((data ->> 'id')::uuid,(data ->> 'sync_token')::uuid,(data ->> 'revision')::bigint,u.kind,u.url,
  array[]::uuid[],array[]::text[],array[]::text[]) from odata_urls u where u.label='key DELTA';
insert into odata_tap select is(data ->> 'cursor_url',u.url,'DELTA stores the exact OData URL and opaque token') from odata_state cross join odata_urls u where u.label='key DELTA';
insert into odata_tap select ok(data ->> 'initialized_at' is not null and data -> 'sync_token' = 'null'::jsonb,'A bound OData DELTA completes the baseline and releases its reservation') from odata_state;
reset role;
insert into odata_tap select is((select count(*) from private.customer_service_email_baseline_messages where connection_id=(data ->> 'id')::uuid),1::bigint,'Baseline identities and the OData cursor commit together') from odata_state;
insert into odata_tap select is((select count(*) from valtrim.service_requests),request_count,'Cursor handling creates no business requests') from odata_fixture;
insert into odata_tap select * from finish();
select result from odata_tap;
rollback;
