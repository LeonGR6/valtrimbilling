begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select hasnt_column('valtrim', 'service_requests', field, field || ' is retired')
from unnest(array['request_type','work_type','status','tag','status_note']) fields(field);
select has_column('valtrim', 'service_requests', field, field || ' remains available')
from unnest(array['workflow_stage','work_category','submission_key','updated_at',
  'homeowner_name','homeowner_email','homeowner_phone','description',
  'customer_unavailable_dates','customer_needs_contact','customer_availability_notes',
  'closed_at','closed_by','close_reason','status_before_close']) fields(field);
select has_table('valtrim', 'service_request_status_history', 'Legacy history is preserved');
select has_table('valtrim', 'service_request_workflow_history', 'Current history is preserved');
select has_table('valtrim', 'audit_events', 'Global audit is preserved');
select ok(to_regprocedure(signature) is null, signature || ' cannot bypass the current intake/review contract')
from unnest(array[
 'valtrim.create_customer_service_request(jsonb,jsonb,jsonb)',
 'valtrim.update_customer_service_request(bigint,jsonb,jsonb,jsonb)',
 'valtrim.close_customer_service_request(bigint,text)',
 'valtrim.reopen_customer_service_request(bigint,text)',
 'valtrim.generate_service_schedule_proposals(bigint,integer)',
 'valtrim.approve_service_schedule_proposal(bigint,jsonb,text)',
 'valtrim.replace_current_service_appointment(bigint,timestamptz,timestamptz,bigint,text,uuid)',
 'valtrim.close_service_request(bigint,text,uuid)',
 'valtrim.reopen_service_request(bigint,text,uuid)',
 'private.find_service_schedule_candidates(bigint)'
]) endpoints(signature);
select ok(to_regclass('valtrim.service_request_detail') is null, 'The old detail view is retired');
select ok(to_regclass('valtrim.service_request_overview') is null, 'The old overview view is retired');
select ok(not exists(select 1 from pg_trigger where tgrelid = 'valtrim.service_requests'::regclass
  and tgname in ('service_requests_normalize', 'service_requests_history')), 'Old state triggers no longer execute');

create temporary table cleanup_fixture as select gen_random_uuid() actor_id, gen_random_uuid() submission_key,
  (select job.id from valtrim.jobs job join valtrim.builders builder on builder.id = job.builder_id
   where job.is_active and job.status = 'ACTIVE' and builder.is_active
     and job.community_latitude is not null and job.community_longitude is not null order by job.id limit 1) job_id,
  null::bigint request_id, null::jsonb payload, null::jsonb record,
  (select count(*) from valtrim.service_request_status_history) legacy_history_count,
  (select count(*) from valtrim.service_appointments) appointment_count;
select ok(job_id is not null, 'A valid remote Job is available for the behavior checks') from cleanup_fixture;
insert into auth.users(id, email, raw_user_meta_data)
select actor_id, actor_id::text || '@example.com', '{"name":"Cleanup Test"}'::jsonb from cleanup_fixture;
update valtrim.app_users set role = 'ADMIN' where id = (select actor_id from cleanup_fixture);
select set_config('request.jwt.claim.sub', actor_id::text, true) from cleanup_fixture;
update cleanup_fixture set payload = jsonb_build_object(
  'property', jsonb_build_object('jobId', job_id),
  'request', jsonb_build_object('reportedOn', (now() at time zone 'America/Los_Angeles')::date,
    'serviceKind','ADJUSTMENT','workCategory','DOORS','serviceTask','GENERAL_FIX',
    'estimatedDurationMinutes',45,'crewSize',1),
  'contacts', jsonb_build_array(jsonb_build_object('role','PRIMARY','name','Cleanup Contact','email','cleanup@example.com')),
  'items', jsonb_build_array(jsonb_build_object('itemNumber',1,'description','Adjust door','materialRequired',false,'chargeable',false)));
grant select, update on cleanup_fixture to authenticated;
set local role authenticated;
update cleanup_fixture set request_id = (valtrim.create_customer_service_request_intake(submission_key, payload) ->> 'requestId')::bigint;
update cleanup_fixture set record = records.value from
  valtrim.read_customer_service_request_intakes((select request_id from cleanup_fixture)) records(value);
select is(record #>> '{request,workflow_stage}', 'NEEDS_REVIEW', 'Creation succeeds without the retired columns') from cleanup_fixture;
select ok(not (record -> 'request' ?| array['request_type','work_type','status','tag','status_note']),
  'The canonical response does not expose retired columns') from cleanup_fixture;
select is((valtrim.create_customer_service_request_intake(submission_key, payload) ->> 'requestId')::bigint,
  request_id, 'Retrying the same submission keeps the same request') from cleanup_fixture;
update cleanup_fixture set record = valtrim.update_customer_service_request_intake(request_id,
  (record #>> '{request,updated_at}')::timestamptz, '{"request":{"internalNotes":"After cleanup"}}');
select is(record #>> '{request,internal_notes}', 'After cleanup', 'Editing and its audit execute without old row references') from cleanup_fixture;
select throws_ok(format('select valtrim.update_customer_service_request_intake(%s,%L,%L::jsonb)',
  request_id, record #>> '{request,updated_at}', '{"request":{"status":"CONFIRMED"}}'),
  '22023', 'The request contains unsupported edit fields', 'A retired state cannot be submitted through intake') from cleanup_fixture;
update cleanup_fixture set record = valtrim.mark_customer_service_request_ready(request_id,
  (record #>> '{request,updated_at}')::timestamptz, true);
select is(record #>> '{request,workflow_stage}', 'READY_TO_PROPOSE', 'Approval uses the canonical workflow') from cleanup_fixture;
reset role;
select is((select count(*) from valtrim.service_request_status_history), legacy_history_count,
  'New intake operations do not generate the old status history') from cleanup_fixture;
select is((select count(*) from valtrim.service_appointments), appointment_count,
  'Cleanup and approval do not integrate scheduling or create appointments') from cleanup_fixture;
select ok(exists(select 1 from valtrim.audit_events a where a.entity_id = f.request_id::text
  and a.new_values ->> 'workflow_stage' = 'READY_TO_PROPOSE'), 'The request trigger audits the current workflow') from cleanup_fixture f;
select ok(exists(select 1 from valtrim.audit_events a where a.entity_id = f.request_id::text
  and a.new_values ->> 'work_category' = 'DOORS'), 'Creation audit uses the current classification') from cleanup_fixture f;

-- Existing closed-record metadata still prevents edits without inventing CLOSED.
update valtrim.service_requests set closed_at = now(), close_reason = 'Guard test'
where id = (select request_id from cleanup_fixture);
select throws_ok(format('select valtrim.update_customer_service_request_intake(%s,%L,%L::jsonb)',
  r.id, r.updated_at, '{"request":{"internalNotes":"Must reject"}}'), '55000',
  'A closed request cannot be edited through intake', 'Closed-record edit protection survives dropping status')
from valtrim.service_requests r join cleanup_fixture f on f.request_id = r.id;

select * from finish();
rollback;
