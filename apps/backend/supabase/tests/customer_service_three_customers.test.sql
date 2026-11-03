-- Remote pgTAP only. All fixtures and approvals below are rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create temporary table three_customer_tap(id bigint generated always as identity,result text);
grant select,insert on three_customer_tap to authenticated,service_role;
grant usage on sequence three_customer_tap_id_seq to authenticated,service_role;

insert into three_customer_tap(result) select has_column('valtrim','service_request_contacts','contact_number','Contacts have a stable customer position');
insert into three_customer_tap(result) select ok(not has_function_privilege('authenticated','private.number_customer_service_contacts(jsonb)','EXECUTE')
  and not has_function_privilege('service_role','private.assign_customer_service_contact_number()','EXECUTE'),
  'Internal numbering helpers are not exposed');
create temporary table three_customer_fixture as select gen_random_uuid() actor_id,gen_random_uuid() submission_key,
  gen_random_uuid() tenant_id,null::uuid import_id,null::bigint request_id,null::bigint imported_id,
  null::jsonb payload,null::jsonb record,null::jsonb initial_contact_ids,
  (select j.id from valtrim.jobs j join valtrim.builders b on b.id=j.builder_id
   where j.is_active and j.status='ACTIVE' and b.is_active
     and j.community_latitude between -90 and 90 and j.community_longitude between -180 and 180
   order by j.id limit 1) job_id;
insert into auth.users(id,email,raw_user_meta_data)
select actor_id,actor_id::text||'@example.com','{"name":"Three Customer Test"}' from three_customer_fixture;
update valtrim.app_users set role='ADMIN' where id=(select actor_id from three_customer_fixture);
update three_customer_fixture set payload=jsonb_build_object(
  'property',jsonb_build_object('jobId',job_id),
  'request',jsonb_build_object('reportedOn',(now() at time zone 'America/Los_Angeles')::date,
    'serviceKind','ADJUSTMENT','workCategory','DOORS','serviceTask','GENERAL_FIX','estimatedDurationMinutes',30,'crewSize',1),
  'contacts','[{"role":"PRIMARY","name":"Zoe Owner","phone":"+19515550101"},{"role":"ADDITIONAL","name":"Ana Owner","phone":"+19515550102"},{"role":"ADDITIONAL","name":"Luis Owner","phone":"+19515550103"}]'::jsonb,
  'items','[{"itemNumber":1,"description":"Adjust entry door"}]'::jsonb);
grant select,update on three_customer_fixture to authenticated,service_role;
select set_config('request.jwt.claim.sub',actor_id::text,true) from three_customer_fixture;
set local role authenticated;
update three_customer_fixture set request_id=(valtrim.create_customer_service_request_intake(submission_key,payload)->>'requestId')::bigint;
update three_customer_fixture f set record=(select value from valtrim.read_customer_service_request_intakes(f.request_id) r(value));
insert into three_customer_tap(result) select is(jsonb_array_length(record->'contacts'),3,'Manual creation persists all three customers') from three_customer_fixture;
insert into three_customer_tap(result) select is(record#>>'{contacts,0,name}','Zoe Owner','The first homeowner is principal') from three_customer_fixture;
insert into three_customer_tap(result) select is(record#>>'{contacts,1,name}','Ana Owner','The second customer keeps its order') from three_customer_fixture;
insert into three_customer_tap(result) select is(record#>>'{contacts,2,name}','Luis Owner','The third customer keeps its order') from three_customer_fixture;
insert into three_customer_tap(result) select is(record#>>'{contacts,2,phone}','+19515550103','The third phone is retained') from three_customer_fixture;
insert into three_customer_tap(result) select is((valtrim.create_customer_service_request_intake(submission_key,payload)->>'requestId')::bigint,request_id,'Manual duplicate submission returns the same request') from three_customer_fixture;
insert into three_customer_tap(result) select throws_ok(format('select valtrim.create_customer_service_request_intake(gen_random_uuid(),%L::jsonb)',
  jsonb_set(payload,'{contacts}',(payload->'contacts')||'{"role":"ADDITIONAL","name":"Fourth Owner","email":"fourth@example.com"}')),
  '22023','Provide one primary contact and at most two additional contacts','A fourth customer is rejected atomically') from three_customer_fixture;
update three_customer_fixture set initial_contact_ids=(select jsonb_agg(c->'id') from jsonb_array_elements(record->'contacts') c);
update three_customer_fixture set payload=jsonb_set(payload,'{contacts,2,phone}','"+19515550199"');
update three_customer_fixture set record=valtrim.update_customer_service_request_intake(request_id,(record#>>'{request,updated_at}')::timestamptz,payload);
insert into three_customer_tap(result) select is(record#>>'{contacts,2,phone}','+19515550199','Editing updates the third customer') from three_customer_fixture;
insert into three_customer_tap(result) select is((select jsonb_agg(c->'id') from jsonb_array_elements(record->'contacts') c),initial_contact_ids,'Editing retains all contact IDs') from three_customer_fixture;
insert into three_customer_tap(result) select throws_ok(format('select valtrim.update_customer_service_request_intake(%s,%L::timestamptz,%L::jsonb)',
  request_id,'2000-01-01',payload),'40001',null,'Stale edits cannot overwrite three customers') from three_customer_fixture;
update three_customer_fixture set record=valtrim.mark_customer_service_request_ready(request_id,(record#>>'{request,updated_at}')::timestamptz,true);
insert into three_customer_tap(result) select is(record#>>'{request,workflow_stage}','READY_TO_PROPOSE','Human approval validates all three complete customers') from three_customer_fixture;
update three_customer_fixture set payload=jsonb_set(payload,'{contacts,1,name}','"Updated Ana Owner"');
update three_customer_fixture set record=valtrim.update_customer_service_request_intake(request_id,(record#>>'{request,updated_at}')::timestamptz,payload);
insert into three_customer_tap(result) select is(record#>>'{request,workflow_stage}','READY_TO_PROPOSE','A valid contact correction preserves approval') from three_customer_fixture;
-- Keep the first two contacts and only their supported external fields.
update three_customer_fixture set payload=jsonb_set(payload,'{contacts}',jsonb_build_array(record#>'{contacts,0}',record#>'{contacts,1}'));
update three_customer_fixture set payload=jsonb_set(payload,'{contacts}',(select jsonb_agg(jsonb_build_object('role',c->'role','name',c->'name','email',c->'email','phone',c->'phone')) from jsonb_array_elements(payload->'contacts') c));
update three_customer_fixture set record=valtrim.update_customer_service_request_intake(request_id,(record#>>'{request,updated_at}')::timestamptz,payload);
insert into three_customer_tap(result) select is(jsonb_array_length(record->'contacts'),2,'Removing one additional customer retains the other') from three_customer_fixture;
insert into three_customer_tap(result) select is(record#>>'{contacts,1,name}','Updated Ana Owner','Removal does not switch the remaining customer') from three_customer_fixture;
reset role;

select set_config('request.jwt.claim.sub','',true);
set local role service_role;
update three_customer_fixture set import_id=(valtrim.register_customer_service_email_import(tenant_id,'three-customer-test','three-owners','{"bodyText":"Synthetic source"}')->>'importId')::uuid;
select valtrim.prepare_customer_service_import_source(f.import_id,i.source_payload,'[]')
from three_customer_fixture f join valtrim.service_request_imports i on i.id=f.import_id;
select valtrim.finalize_customer_service_import_source(import_id) from three_customer_fixture;
reset role;
update three_customer_fixture set payload=jsonb_set(payload,'{contacts}',
  '[{"role":"PRIMARY","name":"Zoe Owner","phone":"+19515550101"},{"role":"ADDITIONAL","name":"Ana Owner","phone":"+19515550102"},{"role":"ADDITIONAL","name":"Luis Owner"}]');
set local role service_role;
update three_customer_fixture set imported_id=(valtrim.save_customer_service_imported_request(import_id,payload)->>'requestId')::bigint;
insert into three_customer_tap(result) select is((valtrim.save_customer_service_imported_request(import_id,payload)->>'requestId')::bigint,imported_id,'Import replay returns the same three-customer request') from three_customer_fixture;
reset role;
insert into three_customer_tap(result) select is((select count(*) from valtrim.service_request_contacts c where c.request_id=f.imported_id),3::bigint,'Imported partial contacts are all persisted') from three_customer_fixture f;
insert into three_customer_tap(result) select throws_ok(format('insert into valtrim.service_request_contacts(request_id,role,name,email) values(%s,''ADDITIONAL'',''Fourth'',''fourth@example.com'')',imported_id),
  '23514','A request supports up to three customers','Direct writes cannot exceed the three-customer bound') from three_customer_fixture;
select set_config('request.jwt.claim.sub',actor_id::text,true) from three_customer_fixture;
set local role authenticated;
update three_customer_fixture f set record=(select value from valtrim.read_customer_service_request_intakes(f.imported_id) r(value));
insert into three_customer_tap(result) select throws_ok(format('select valtrim.mark_customer_service_request_ready(%s,%L::timestamptz,true)',imported_id,record#>>'{request,updated_at}'),
  '22023',null,'The third customer must have a valid channel before approval') from three_customer_fixture;
update three_customer_fixture set payload=jsonb_set(payload,'{contacts,2,phone}','"+19515550103"');
update three_customer_fixture set record=valtrim.update_customer_service_request_intake(imported_id,(record#>>'{request,updated_at}')::timestamptz,payload);
insert into three_customer_tap(result) select is(jsonb_array_length(record->'contacts'),3,'Human editing of an imported request retains three customers') from three_customer_fixture;
insert into three_customer_tap(result) select is(record#>>'{contacts,2,phone}','+19515550103','Human editing fills the third imported phone') from three_customer_fixture;
insert into three_customer_tap(result) select is(record#>>'{request,workflow_stage}','NEEDS_REVIEW','Filling phones does not approve the import') from three_customer_fixture;
reset role;
insert into three_customer_tap(result) select * from finish();
select string_agg(result,E'\n' order by id) as tap from three_customer_tap;
rollback;
