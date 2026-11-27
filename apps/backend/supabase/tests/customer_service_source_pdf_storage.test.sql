begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select is(
  (
    select count(*)
    from storage.buckets bucket
    where bucket.id = 'customer-service-sources'
  ),
  1::bigint,
  'The Customer Service source bucket exists'
);

select is(
  (
    select bucket.public
    from storage.buckets bucket
    where bucket.id = 'customer-service-sources'
  ),
  false,
  'The Customer Service source bucket is private'
);

select is(
  (
    select bucket.file_size_limit
    from storage.buckets bucket
    where bucket.id = 'customer-service-sources'
  ),
  10485760::bigint,
  'The Customer Service source bucket accepts at most 10 MiB'
);

select is(
  (
    select bucket.allowed_mime_types
    from storage.buckets bucket
    where bucket.id = 'customer-service-sources'
  ),
  array['application/pdf']::text[],
  'The Customer Service source bucket accepts only application/pdf'
);

select has_function(
  'valtrim',
  'finalize_customer_service_source_pdf_upload',
  array['bigint', 'uuid', 'text', 'bigint', 'text'],
  'The source PDF finalization operation exists'
);

select has_function(
  'valtrim',
  'fail_customer_service_source_pdf_upload',
  array['bigint', 'uuid', 'text'],
  'The source PDF failure operation exists'
);

select has_function(
  'valtrim',
  'get_customer_service_source_pdf_object',
  array['bigint', 'uuid'],
  'The source PDF signed-URL lookup operation exists'
);

select ok(
  (
    select bool_and(function_record.prosecdef)
    from pg_proc function_record
    where function_record.oid in (
      'valtrim.finalize_customer_service_source_pdf_upload(bigint,uuid,text,bigint,text)'::regprocedure,
      'valtrim.fail_customer_service_source_pdf_upload(bigint,uuid,text)'::regprocedure,
      'valtrim.get_customer_service_source_pdf_object(bigint,uuid)'::regprocedure
    )
  ),
  'All source PDF operations use definer rights'
);

select ok(
  has_function_privilege(
    'service_role',
    'valtrim.finalize_customer_service_source_pdf_upload(bigint,uuid,text,bigint,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'valtrim.fail_customer_service_source_pdf_upload(bigint,uuid,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'valtrim.get_customer_service_source_pdf_object(bigint,uuid)',
    'execute'
  ),
  'service_role can execute all source PDF operations'
);

select ok(
  not has_function_privilege(
    'anon',
    'valtrim.finalize_customer_service_source_pdf_upload(bigint,uuid,text,bigint,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'valtrim.fail_customer_service_source_pdf_upload(bigint,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'valtrim.get_customer_service_source_pdf_object(bigint,uuid)',
    'execute'
  ),
  'Anonymous clients cannot execute source PDF operations'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'valtrim.finalize_customer_service_source_pdf_upload(bigint,uuid,text,bigint,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'valtrim.fail_customer_service_source_pdf_upload(bigint,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'valtrim.get_customer_service_source_pdf_object(bigint,uuid)',
    'execute'
  ),
  'Authenticated browser clients cannot execute source PDF operations'
);

create temporary table customer_service_source_pdf_fixture (
  actor_id uuid,
  job_id bigint,
  submission_key uuid not null,
  payload jsonb,
  request_id bigint,
  object_path text,
  failed_result jsonb,
  final_result jsonb,
  retry_result jsonb,
  lookup_result jsonb
) on commit drop;

insert into customer_service_source_pdf_fixture (
  actor_id,
  job_id,
  submission_key
)
select
  (
    select app_user.id
    from valtrim.app_users app_user
    where app_user.is_active
      and app_user.role in ('ADMIN', 'SCHEDULING')
    order by app_user.id
    limit 1
  ),
  (
    select job.id
    from valtrim.jobs job
    join valtrim.builders builder on builder.id = job.builder_id
    where job.is_active
      and job.status = 'ACTIVE'
      and builder.is_active
    order by job.id
    limit 1
  ),
  gen_random_uuid();

select ok(
  (
    select fixture.actor_id is not null and fixture.job_id is not null
    from customer_service_source_pdf_fixture fixture
  ),
  'The linked project has an authorized actor and active Job for the PDF test'
);

select set_config(
  'request.jwt.claim.sub',
  (
    select fixture.actor_id::text
    from customer_service_source_pdf_fixture fixture
  ),
  true
);

update customer_service_source_pdf_fixture fixture
set payload = jsonb_build_object(
  'property', jsonb_build_object(
    'jobId', fixture.job_id,
    'lotNumber', 'LOT-PDF-STORAGE',
    'address', '101 Private PDF Test Way'
  ),
  'request', jsonb_build_object(
    'reportedOn', '2026-10-20',
    'reportedOnSource', 'EMAIL_SENT',
    'priority', 'MEDIUM',
    'serviceKind', 'ADJUSTMENT',
    'workCategory', 'DOORS',
    'serviceTask', 'GENERAL_FIX',
    'estimatedDurationMinutes', 30,
    'crewSize', 1,
    'internalNotes', 'Created by the private source PDF storage test.'
  ),
  'contacts', jsonb_build_array(
    jsonb_build_object(
      'role', 'PRIMARY',
      'name', 'PDF Storage Test',
      'email', 'pdf.storage@example.com'
    )
  ),
  'items', jsonb_build_array(
    jsonb_build_object(
      'itemNumber', 1,
      'description', 'Verify the uploaded source PDF.',
      'materialRequired', false,
      'chargeable', false
    )
  ),
  'source', jsonb_build_object(
    'sourceType', 'PDF',
    'senderEmail', 'builder@example.com',
    'subject', 'Private source PDF storage test',
    'emailText', 'Original email body for the source PDF.'
  )
);

update customer_service_source_pdf_fixture fixture
set request_id = (
  valtrim.create_customer_service_request_intake(
    fixture.submission_key,
    fixture.payload
  ) ->> 'requestId'
)::bigint;

update customer_service_source_pdf_fixture fixture
set object_path = format('requests/%s/source.pdf', fixture.request_id);

select throws_ok(
  format(
    $sql$
      select valtrim.fail_customer_service_source_pdf_upload(
        %s,
        '00000000-0000-0000-0000-000000000001'::uuid,
        'Upload rejected'
      )
    $sql$,
    (
      select fixture.request_id
      from customer_service_source_pdf_fixture fixture
    )
  ),
  '42501',
  'The PDF storage operation requires an active Customer Service actor',
  'The internal operations reject an unknown audit actor'
);

update customer_service_source_pdf_fixture fixture
set failed_result = valtrim.fail_customer_service_source_pdf_upload(
  fixture.request_id,
  fixture.actor_id,
  'Simulated upload failure'
);

select ok(
  (
    select source.file_status = 'FAILED'
      and source.file_id is null
      and source.file_error = 'Simulated upload failure'
      and fixture.failed_result ->> 'fileStatus' = 'FAILED'
    from customer_service_source_pdf_fixture fixture
    join valtrim.service_request_sources source
      on source.request_id = fixture.request_id
  ),
  'A failed upload is recorded without linking a stored file'
);

insert into storage.objects (
  bucket_id,
  name,
  metadata
)
select
  'customer-service-sources',
  fixture.object_path,
  jsonb_build_object(
    'mimetype', 'application/pdf',
    'size', 321
  )
from customer_service_source_pdf_fixture fixture;

update customer_service_source_pdf_fixture fixture
set final_result = valtrim.finalize_customer_service_source_pdf_upload(
  fixture.request_id,
  fixture.actor_id,
  'builder-request.pdf',
  321,
  repeat('a', 64)
);

select ok(
  (
    select
      source.file_status = 'AVAILABLE'
      and source.file_error is null
      and source.file_id = stored_file.id
      and stored_file.bucket_id = 'customer-service-sources'
      and stored_file.object_path = fixture.object_path
      and stored_file.original_filename = 'builder-request.pdf'
      and stored_file.mime_type = 'application/pdf'
      and stored_file.size_bytes = 321
      and stored_file.sha256 = repeat('a', 64)
      and stored_file.uploaded_by = fixture.actor_id
      and fixture.final_result ->> 'fileStatus' = 'AVAILABLE'
      and (fixture.final_result ->> 'idempotentReplay')::boolean is false
    from customer_service_source_pdf_fixture fixture
    join valtrim.service_request_sources source
      on source.request_id = fixture.request_id
    join valtrim.stored_files stored_file on stored_file.id = source.file_id
  ),
  'Finalization verifies and atomically links the private PDF'
);

update customer_service_source_pdf_fixture fixture
set retry_result = valtrim.finalize_customer_service_source_pdf_upload(
  fixture.request_id,
  fixture.actor_id,
  'builder-request.pdf',
  321,
  repeat('a', 64)
);

select ok(
  (
    select
      (fixture.retry_result ->> 'fileId')::bigint =
        (fixture.final_result ->> 'fileId')::bigint
      and (fixture.retry_result ->> 'idempotentReplay')::boolean is true
    from customer_service_source_pdf_fixture fixture
  ),
  'Repeating the same finalization is idempotent'
);

update customer_service_source_pdf_fixture fixture
set lookup_result = valtrim.get_customer_service_source_pdf_object(
  fixture.request_id,
  fixture.actor_id
);

select ok(
  (
    select
      fixture.lookup_result ->> 'bucketId' = 'customer-service-sources'
      and fixture.lookup_result ->> 'objectPath' = fixture.object_path
      and fixture.lookup_result ->> 'mimeType' = 'application/pdf'
      and (fixture.lookup_result ->> 'sizeBytes')::bigint = 321
    from customer_service_source_pdf_fixture fixture
  ),
  'The signed-URL lookup returns only the verified private object coordinates'
);

select throws_ok(
  format(
    $sql$
      select valtrim.fail_customer_service_source_pdf_upload(
        %s,
        %L::uuid,
        'Late failure'
      )
    $sql$,
    (
      select fixture.request_id
      from customer_service_source_pdf_fixture fixture
    ),
    (
      select fixture.actor_id
      from customer_service_source_pdf_fixture fixture
    )
  ),
  '55000',
  'An available Customer Service source PDF cannot be marked as failed',
  'An available source cannot regress to FAILED'
);

select * from finish();

rollback;
