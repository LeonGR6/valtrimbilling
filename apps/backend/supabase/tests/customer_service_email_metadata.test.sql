begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temporary table email_metadata_fixture as select
  gen_random_uuid() actor_id, gen_random_uuid() denied_id,
  (select j.id from valtrim.jobs j join valtrim.builders b on b.id = j.builder_id
   where j.is_active and j.status = 'ACTIVE' and b.is_active
     and j.community_latitude is not null and j.community_longitude is not null order by j.id limit 1) job_id,
  null::jsonb payload;
select ok(job_id is not null, 'An active Job with verified coordinates is available') from email_metadata_fixture;
insert into auth.users(id, email, raw_user_meta_data)
select actor_id, actor_id::text || '@example.com', '{"name":"Email Metadata Test"}'::jsonb from email_metadata_fixture
union all select denied_id, denied_id::text || '@example.com', '{"name":"Email Metadata Read Only"}'::jsonb from email_metadata_fixture;
update valtrim.app_users set role = 'ADMIN' where id = (select actor_id from email_metadata_fixture);
update valtrim.app_users set role = 'READ_ONLY' where id = (select denied_id from email_metadata_fixture);
select set_config('request.jwt.claim.sub', actor_id::text, true) from email_metadata_fixture;
update email_metadata_fixture set payload = jsonb_build_object(
  'property', jsonb_build_object('jobId',job_id),
  'request', jsonb_build_object('reportedOn',(now() at time zone 'America/Los_Angeles')::date,
    'serviceKind','ADJUSTMENT','workCategory','DOORS','serviceTask','GENERAL_FIX','estimatedDurationMinutes',30,'crewSize',1),
  'contacts', jsonb_build_array(jsonb_build_object('role','PRIMARY','name','Metadata Contact','email','contact@example.com')),
  'items', jsonb_build_array(jsonb_build_object('itemNumber',1,'description','Adjust door')));

create temporary table email_metadata_cases(label text, source jsonb, submission_key uuid default gen_random_uuid(),
  request_id bigint, record jsonb, original_source jsonb);
insert into email_metadata_cases(label,source) values
 ('sender only','{"sourceType":"EMAIL_METADATA","senderEmail":" Builder@Example.com "}'),
 ('subject only','{"sourceType":"EMAIL_METADATA","subject":" Service request "}'),
 ('both','{"sourceType":"EMAIL_METADATA","senderEmail":"builder@example.com","subject":"Work order"}'),
 ('neither',null),
 ('pdf','{"sourceType":"PDF","senderEmail":"pdf@example.com","subject":"PDF source"}'),
 ('text','{"sourceType":"EMAIL_TEXT","senderEmail":"text@example.com","subject":"Text source","emailText":"Original message"}');
grant select, update on email_metadata_fixture, email_metadata_cases to authenticated;
set local role authenticated;
update email_metadata_cases c set request_id = (valtrim.create_customer_service_request_intake(c.submission_key,
  f.payload || jsonb_build_object('source',c.source)) ->> 'requestId')::bigint from email_metadata_fixture f;
update email_metadata_cases c set record = (select r.value from valtrim.read_customer_service_request_intakes(c.request_id) r(value));
update email_metadata_cases set original_source = record -> 'source';

select is(record #>> '{source,sender_email}', 'builder@example.com', 'Sender without PDF/text is normalized, saved and read back')
from email_metadata_cases where label = 'sender only';
select is(record #>> '{source,subject}', null, 'Subject remains optional') from email_metadata_cases where label = 'sender only';
select is(record #>> '{source,subject}', 'Service request', 'Subject without a sender, PDF or text is saved and read back')
from email_metadata_cases where label = 'subject only';
select is(record #>> '{source,sender_email}', null, 'Sender remains optional') from email_metadata_cases where label = 'subject only';
select is(record #>> '{source,sender_email}', 'builder@example.com', 'Both optional details survive creation') from email_metadata_cases where label = 'both';
select is(record #>> '{source,subject}', 'Work order', 'The supplied subject survives creation') from email_metadata_cases where label = 'both';
select is(record -> 'source', 'null'::jsonb, 'Blank optional details do not require or invent a source') from email_metadata_cases where label = 'neither';
select is(record #>> '{source,file_status}', 'PENDING', 'An actual PDF keeps its upload lifecycle') from email_metadata_cases where label = 'pdf';
select is(record #>> '{source,email_text}', 'Original message', 'An actual email body is preserved') from email_metadata_cases where label = 'text';
select ok(record #>> '{source,source_type}' = 'EMAIL_METADATA'
  and record #>> '{source,file_status}' = 'NOT_APPLICABLE'
  and record #> '{source,file}' = 'null'::jsonb and record #> '{source,email_text}' = 'null'::jsonb
  and record #> '{source,extraction_payload}' = 'null'::jsonb and record #> '{source,extracted_text}' = 'null'::jsonb,
  label || ' has no fictitious file, body or extraction') from email_metadata_cases where label in ('sender only','subject only','both');

select is((valtrim.create_customer_service_request_intake(c.submission_key,
  f.payload || '{"source":{"sourceType":"EMAIL_METADATA","senderEmail":"changed@example.com","subject":"Changed"}}'::jsonb) ->> 'requestId')::bigint,
  c.request_id, label || ': retrying returns the same request') from email_metadata_cases c cross join email_metadata_fixture f;
select is((select r.value -> 'source' from valtrim.read_customer_service_request_intakes(c.request_id) r(value)),
  original_source, label || ': retrying does not overwrite original metadata') from email_metadata_cases c;

create function pg_temp.create_with_email_source(p_source jsonb) returns jsonb language sql as $fn$
  select valtrim.create_customer_service_request_intake(gen_random_uuid(), payload || jsonb_build_object('source',p_source))
  from email_metadata_fixture;
$fn$;
select throws_ok($$select pg_temp.create_with_email_source('{"sourceType":"EMAIL_METADATA","senderEmail":"invalid"}')$$,
  '22023','Source sender email is invalid','Invalid sender data is rejected rather than silently discarded');
select throws_ok($$select pg_temp.create_with_email_source('{"sourceType":"EMAIL_METADATA"}')$$,
  '22023','Provide a sender or subject for email details','An empty metadata-only record is rejected');
select throws_ok(format('select pg_temp.create_with_email_source(%L::jsonb)',
  '{"sourceType":"EMAIL_METADATA","subject":"Subject"}'::jsonb || extra),
  '22023','Email details cannot include a document, body or extraction', label || ' cannot be disguised as metadata-only')
from (values
 ('{"emailText":"Body"}'::jsonb,'A message body'),
 ('{"extractedText":"OCR"}'::jsonb,'Extracted text'),
 ('{"extractionPayload":{"schemaVersion":"1.0"}}'::jsonb,'An extraction payload'),
 ('{"extractionModel":"test"}'::jsonb,'An extraction model'),
 ('{"extractedAt":"2026-10-21T12:00:00Z"}'::jsonb,'An extraction timestamp'),
 ('{"reviewNotes":["Extraction note"]}'::jsonb,'Extraction review notes'),
 ('{"fileId":1}'::jsonb,'A file reference')
) invalid_sources(extra,label);
select throws_ok($$select pg_temp.create_with_email_source('{"sourceType":"EMAIL_TEXT","subject":"Subject"}')$$,
  '22023','Email text is required for an EMAIL_TEXT source','EMAIL_TEXT still requires a real message body');

update email_metadata_cases set record = valtrim.update_customer_service_request_intake(request_id,
  (record #>> '{request,updated_at}')::timestamptz, '{"request":{"internalNotes":"Reviewed details"}}') where label = 'both';
select is(record -> 'source', original_source, 'Editing the request preserves its original email details') from email_metadata_cases where label = 'both';
select throws_ok(format('select valtrim.update_customer_service_request_intake(%s,%L,%L::jsonb)',
  request_id, record #>> '{request,updated_at}', '{"request":{},"source":{"senderEmail":"changed@example.com"}}'),
  '22023','Source, identity and workflow fields cannot be edited through intake','The fix does not permit source edits')
from email_metadata_cases where label = 'both';
update email_metadata_cases set record = valtrim.mark_customer_service_request_ready(request_id,
  (record #>> '{request,updated_at}')::timestamptz, true) where label = 'both';
select is(record #>> '{request,workflow_stage}', 'READY_TO_PROPOSE', 'Metadata-only requests remain eligible for human review')
from email_metadata_cases where label = 'both';
select is(record -> 'source', original_source, 'Approval preserves the original email details') from email_metadata_cases where label = 'both';

reset role;
select throws_ok(format('update valtrim.service_request_sources set file_status = %L where request_id = %s', 'PENDING', request_id),
  '23514', null, 'The database prevents metadata from acquiring a fictitious pending PDF') from email_metadata_cases where label = 'both';
select throws_ok(format('update valtrim.service_request_sources set email_text = %L where request_id = %s', 'Hidden body', request_id),
  '23514', null, 'The database enforces metadata-only contents on direct writes too') from email_metadata_cases where label = 'both';
select set_config('request.jwt.claim.sub', denied_id::text, true) from email_metadata_fixture;
set local role authenticated;
select throws_ok($$select pg_temp.create_with_email_source('{"sourceType":"EMAIL_METADATA","subject":"Denied"}')$$,
  '42501','You do not have permission to manage Customer Service requests','Saving email details does not bypass role checks');
reset role;

select * from finish();
rollback;
