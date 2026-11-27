begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_function('valtrim', 'read_customer_service_request_intakes', array['bigint']);
select ok(has_function_privilege('authenticated',
  'valtrim.read_customer_service_request_intakes(bigint)', 'execute'),
  'Authenticated users can invoke the read operation subject to its role check');
select ok(not has_function_privilege('anon',
  'valtrim.read_customer_service_request_intakes(bigint)', 'execute'),
  'Anonymous users cannot read request sources');

select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$select * from valtrim.read_customer_service_request_intakes()$$,
  '42501', 'You do not have permission to manage Customer Service requests',
  'A caller without an authorized user is rejected');

create temporary table intake_read_fixture as
select
  (select id from valtrim.app_users where is_active and role in ('ADMIN', 'SCHEDULING') order by id limit 1) as actor_id,
  (select job.id from valtrim.jobs job join valtrim.builders builder on builder.id = job.builder_id
   where job.is_active and job.status = 'ACTIVE' and builder.is_active
     and job.community_latitude is not null and job.community_longitude is not null
   order by job.id limit 1) as job_id,
  null::bigint as request_id,
  null::jsonb as record;

select ok(actor_id is not null and job_id is not null,
  'The linked project has an authorized actor and a Job with verified coordinates') from intake_read_fixture;
select set_config('request.jwt.claim.sub', actor_id::text, true) from intake_read_fixture;

update intake_read_fixture set request_id = (
  valtrim.create_customer_service_request_intake(gen_random_uuid(), jsonb_build_object(
    'property', jsonb_build_object('jobId', job_id, 'lotNumber', 'READ-TEST'),
    'request', jsonb_build_object('reportedOn', (now() at time zone 'America/Los_Angeles')::date,
      'reportedOnSource', 'EMAIL_SENT', 'serviceKind', 'PAID_EXTRA',
      'workCategory', 'MULTIPLE_WORK_TYPES'),
    'contacts', jsonb_build_array(
      jsonb_build_object('role', 'PRIMARY', 'name', 'Read Primary', 'email', 'read.primary@example.com'),
      jsonb_build_object('role', 'ADDITIONAL', 'name', 'Read Additional', 'phone', '+19515550101')),
    'items', jsonb_build_array(
      jsonb_build_object('itemNumber', 1, 'description', 'First item', 'materialRequired', true),
      jsonb_build_object('itemNumber', 2, 'description', 'Second item', 'chargeable', true)),
    'source', jsonb_build_object('sourceType', 'PDF', 'emailText', 'Original email',
      'extractedText', 'Original OCR', 'extractionPayload', jsonb_build_object('schemaVersion', '1.0'),
      'reviewNotes', jsonb_build_array('Check source'))
  )) ->> 'requestId'
)::bigint;

-- Use the same DB finalization contract as Storage; all metadata rolls back.
insert into storage.objects(bucket_id, name, metadata)
select 'customer-service-sources', format('requests/%s/source.pdf', request_id),
  jsonb_build_object('mimetype', 'application/pdf', 'size', 321) from intake_read_fixture;
select valtrim.finalize_customer_service_source_pdf_upload(request_id, actor_id,
  'read-test.pdf', 321, repeat('a', 64)) from intake_read_fixture;

-- Run the read as an actual browser database role, rather than as postgres.
grant select, update on intake_read_fixture to authenticated;
set local role authenticated;
update intake_read_fixture fixture set record = records.value
from valtrim.read_customer_service_request_intakes(
  (select request_id from intake_read_fixture)
) records(value);

select is((record #>> '{request,id}')::bigint, request_id, 'Canonical read preserves request identity') from intake_read_fixture;
select is(record #>> '{request,workflow_stage}', 'NEEDS_REVIEW', 'Reading does not approve the request') from intake_read_fixture;
select is((record #>> '{property,job_id}')::bigint, job_id, 'The selected Job survives reload') from intake_read_fixture;
select ok(nullif(record ->> 'builderName', '') is not null and nullif(record ->> 'community', '') is not null,
  'Builder and Community resolve through Job, not the legacy Community FK') from intake_read_fixture;
select is(jsonb_array_length(record -> 'contacts'), 2, 'Both contacts are returned') from intake_read_fixture;
select is(record #>> '{items,0,description}', 'First item', 'The first item retains its order') from intake_read_fixture;
select is(record #>> '{items,1,description}', 'Second item', 'The second item retains its order') from intake_read_fixture;
select is(record #>> '{items,0,material_required}', 'true', 'Material flag survives reading') from intake_read_fixture;
select is(record #>> '{items,1,chargeable}', 'true', 'Chargeable flag survives reading') from intake_read_fixture;
select is(record #>> '{source,email_text}', 'Original email', 'Original email survives reading') from intake_read_fixture;
select is(record #>> '{source,extracted_text}', 'Original OCR', 'Original OCR survives reading') from intake_read_fixture;
select is(record #>> '{source,extraction_payload,schemaVersion}', '1.0', 'Structured extraction survives reading') from intake_read_fixture;
select is(record #>> '{source,file,original_filename}', 'read-test.pdf', 'Private PDF metadata survives reading') from intake_read_fixture;
select is(record #>> '{source,file,object_path}', format('requests/%s/source.pdf', request_id),
  'The source references the same private Storage object') from intake_read_fixture;
select is(jsonb_array_length(record -> 'workflowHistory'), 1, 'Creation history is returned without adding events') from intake_read_fixture;
select is((select count(*) from valtrim.read_customer_service_request_intakes(-1)), 0::bigint,
  'An unknown request produces a real empty result');
select is((select count(*) from valtrim.read_customer_service_request_intakes() records(value)
  where (value #>> '{request,id}')::bigint = (select request_id from intake_read_fixture)),
  1::bigint, 'List reading includes the same request exactly once');

reset role;
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select throws_ok($$select * from valtrim.read_customer_service_request_intakes()$$,
  '42501', 'You do not have permission to manage Customer Service requests',
  'An unknown authenticated identity cannot read requests or sources');

select * from finish();
rollback;
