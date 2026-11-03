begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select has_function(
  'valtrim',
  'create_customer_service_request_intake',
  array['uuid', 'jsonb'],
  'The atomic New Request intake RPC exists'
);

select has_function(
  'private',
  'create_customer_service_request_intake_internal',
  array['uuid', 'jsonb'],
  'The privileged intake implementation remains private'
);

select ok(
  (
    select function_record.prosecdef
    from pg_proc function_record
    where function_record.oid =
      'valtrim.create_customer_service_request_intake(uuid, jsonb)'::regprocedure
  ),
  'The exposed intake RPC uses definer rights for its atomic writes'
);

select ok(
  (
    select function_record.prosecdef
    from pg_proc function_record
    where function_record.oid =
      'private.create_customer_service_request_intake_internal(uuid, jsonb)'::regprocedure
  ),
  'The private intake implementation uses definer rights'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.create_customer_service_request_intake(uuid, jsonb)',
    'execute'
  ),
  'Authenticated users can invoke intake subject to its app-role check'
);

select ok(
  not has_function_privilege(
    'anon',
    'valtrim.create_customer_service_request_intake(uuid, jsonb)',
    'execute'
  ),
  'Anonymous clients cannot invoke the intake RPC'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.create_customer_service_request_intake_internal(uuid, jsonb)',
    'execute'
  ),
  'Authenticated clients cannot invoke the private intake implementation'
);

-- PDF/body compatibility is checked below against the source actually saved
-- by the RPC. A pattern over the constraint text also matched later branches.

select throws_ok(
  $$
    select valtrim.create_customer_service_request_intake(
      '30000000-0000-4000-8000-000000000000'::uuid,
      '{}'::jsonb
    )
  $$,
  '42501',
  'You do not have permission to manage Customer Service requests',
  'The intake RPC rejects callers without an authorized app user'
);

create temporary table customer_service_intake_fixture (
  actor_id uuid,
  job_id bigint,
  submission_key uuid not null,
  invalid_submission_key uuid not null,
  payload jsonb,
  first_result jsonb,
  replay_result jsonb,
  request_id bigint,
  requests_before bigint,
  properties_before bigint
) on commit drop;

insert into customer_service_intake_fixture (
  actor_id,
  job_id,
  submission_key,
  invalid_submission_key,
  requests_before,
  properties_before
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
  gen_random_uuid(),
  gen_random_uuid(),
  (select count(*) from valtrim.service_requests),
  (select count(*) from valtrim.service_properties);

select ok(
  (
    select fixture.actor_id is not null
      and fixture.job_id is not null
    from customer_service_intake_fixture fixture
  ),
  'The linked project has an authorized actor and an active Job for intake tests'
);

select set_config(
  'request.jwt.claim.sub',
  (select fixture.actor_id::text from customer_service_intake_fixture fixture),
  true
);

update customer_service_intake_fixture fixture
set payload = jsonb_build_object(
  'property', jsonb_build_object(
    'jobId', fixture.job_id,
    'lotNumber', 'LOT-RPC-01',
    'address', '101 Atomic Test Way',
    'latitude', 0,
    'longitude', 0
  ),
  'request', jsonb_build_object(
    'reportedOn', '2026-10-16',
    'reportedOnSource', 'EMAIL_SENT',
    'priority', 'HIGH',
    'serviceKind', 'ADJUSTMENT',
    'workCategory', 'DOORS',
    'serviceTask', 'GENERAL_FIX',
    'estimatedDurationMinutes', 45,
    'crewSize', 2,
    'internalNotes', 'Created by the point 3 transactional RPC test.'
  ),
  'contacts', jsonb_build_array(
    jsonb_build_object(
      'role', 'PRIMARY',
      'name', 'Primary RPC Test',
      'email', 'primary.rpc@example.com'
    ),
    jsonb_build_object(
      'role', 'ADDITIONAL',
      'name', 'Additional RPC Test',
      'phone', '+19515550101'
    )
  ),
  'items', jsonb_build_array(
    jsonb_build_object(
      'itemNumber', 1,
      'description', 'Adjust the front door.',
      'materialRequired', false,
      'chargeable', false
    ),
    jsonb_build_object(
      'itemNumber', 2,
      'description', 'Replace the damaged hinge.',
      'materialRequired', true,
      'chargeable', true
    )
  ),
  'source', jsonb_build_object(
    'sourceType', 'PDF',
    'senderEmail', 'builder@example.com',
    'subject', 'Service request RPC test',
    'emailText', 'Original builder email retained with its PDF.',
    'extractedText', 'Extracted PDF text.',
    'extractionPayload', jsonb_build_object('provider', 'test'),
    'extractionModel', 'test-model',
    'extractedAt', '2026-10-16T18:00:00Z',
    'reviewNotes', jsonb_build_array('Verify the hinge model.')
  )
);

update customer_service_intake_fixture fixture
set first_result = valtrim.create_customer_service_request_intake(
  fixture.submission_key,
  fixture.payload
);

update customer_service_intake_fixture fixture
set request_id = (fixture.first_result ->> 'requestId')::bigint;

select ok(
  (
    select fixture.first_result ->> 'folio' ~ '^CS-[0-9]{4,}$'
      and (fixture.first_result ->> 'idempotentReplay')::boolean is false
      and fixture.first_result ->> 'workflowStage' = 'NEEDS_REVIEW'
    from customer_service_intake_fixture fixture
  ),
  'Creation returns the persisted CS folio and initial review stage'
);

select ok(
  (
    select
      request.submission_key = fixture.submission_key
      and request.reported_on = date '2026-10-16'
      and request.reported_on_source = 'EMAIL_SENT'
      and request.priority = 'HIGH'
      and request.service_kind = 'ADJUSTMENT'
      and request.work_category = 'DOORS'
      and request.service_task = 'GENERAL_FIX'
      and request.estimated_duration_minutes = 45
      and request.crew_size = 2
      and request.workflow_stage = 'NEEDS_REVIEW'
      and request.valtrim_items_confirmed is false
      and request.created_by = fixture.actor_id
      and request.coordinator_user_id = fixture.actor_id
      and request.due_on = valtrim.calculate_business_due_date(
        request.reported_on,
        5
      )
    from customer_service_intake_fixture fixture
    join valtrim.service_requests request on request.id = fixture.request_id
  ),
  'The RPC persists request metadata, audit actor, workflow, and due date'
);

select ok(
  (
    select
      property.job_id = fixture.job_id
      and property.latitude = job.community_latitude
      and property.longitude = job.community_longitude
      and (property.latitude <> 0 or property.longitude <> 0)
    from customer_service_intake_fixture fixture
    join valtrim.service_requests request on request.id = fixture.request_id
    join valtrim.service_properties property on property.id = request.property_id
    join valtrim.jobs job on job.id = fixture.job_id
  ),
  'The selected Job, not client-supplied coordinates, is authoritative'
);

select is(
  (
    select count(*)
    from customer_service_intake_fixture fixture
    join valtrim.service_request_contacts contact
      on contact.request_id = fixture.request_id
  ),
  2::bigint,
  'The RPC creates the primary and additional contacts'
);

select ok(
  (
    select
      count(*) filter (
        where contact.role = 'PRIMARY'
          and contact.name = 'Primary RPC Test'
          and contact.email = 'primary.rpc@example.com'
          and contact.phone is null
      ) = 1
      and count(*) filter (
        where contact.role = 'ADDITIONAL'
          and contact.name = 'Additional RPC Test'
          and contact.email is null
          and contact.phone = '+19515550101'
      ) = 1
    from customer_service_intake_fixture fixture
    join valtrim.service_request_contacts contact
      on contact.request_id = fixture.request_id
  ),
  'Each contact accepts name plus email or phone without requiring both'
);

select results_eq(
  $$
    select
      item.item_number::integer,
      item.description::text,
      item.material_required,
      item.chargeable
    from customer_service_intake_fixture fixture
    join valtrim.service_request_items item on item.request_id = fixture.request_id
    order by item.item_number
  $$,
  $$
    values
      (1, 'Adjust the front door.'::text, false, false),
      (2, 'Replace the damaged hinge.'::text, true, true)
  $$,
  'The RPC preserves ordered work items and their two flags'
);

select ok(
  (
    select
      source.source_type = 'PDF'
      and source.file_status = 'PENDING'
      and source.file_id is null
      and source.email_text = 'Original builder email retained with its PDF.'
      and source.extracted_text = 'Extracted PDF text.'
      and source.extraction_payload = '{"provider":"test"}'::jsonb
      and source.review_notes = array['Verify the hinge model.']::text[]
    from customer_service_intake_fixture fixture
    join valtrim.service_request_sources source
      on source.request_id = fixture.request_id
  ),
  'A PDF source starts pending while preserving email and extraction metadata'
);

select is(
  (
    select count(*)
    from customer_service_intake_fixture fixture
    join valtrim.service_request_workflow_history history
      on history.request_id = fixture.request_id
    where history.previous_stage is null
      and history.new_stage = 'NEEDS_REVIEW'
      and history.changed_by = fixture.actor_id
  ),
  1::bigint,
  'The initial workflow stage is recorded once in history'
);

select is(
  (
    select count(*)
    from customer_service_intake_fixture fixture
    join valtrim.service_request_availability availability
      on availability.request_id = fixture.request_id
  ),
  0::bigint,
  'New Request does not collect or create customer availability'
);

update customer_service_intake_fixture fixture
set replay_result = valtrim.create_customer_service_request_intake(
  fixture.submission_key,
  fixture.payload
);

select ok(
  (
    select
      (fixture.replay_result ->> 'requestId')::bigint = fixture.request_id
      and (fixture.replay_result ->> 'idempotentReplay')::boolean is true
    from customer_service_intake_fixture fixture
  ),
  'Retrying the same submission key returns the original request'
);

select is(
  (
    select count(*)
    from customer_service_intake_fixture fixture
    join valtrim.service_requests request
      on request.submission_key = fixture.submission_key
  ),
  1::bigint,
  'An idempotent retry does not create a duplicate request'
);

select throws_ok(
  $$
    select valtrim.create_customer_service_request_intake(
      fixture.invalid_submission_key,
      jsonb_set(fixture.payload, '{items,1,itemNumber}', '3'::jsonb)
    )
    from customer_service_intake_fixture fixture
  $$,
  '22023',
  'Work item numbers must be consecutive starting at 1',
  'Invalid child data rejects the complete intake operation'
);

select ok(
  (
    select
      (select count(*) from valtrim.service_requests) =
        fixture.requests_before + 1
      and (select count(*) from valtrim.service_properties) =
        fixture.properties_before + 1
      and not exists (
        select 1
        from valtrim.service_requests request
        where request.submission_key = fixture.invalid_submission_key
      )
    from customer_service_intake_fixture fixture
  ),
  'A rejected intake leaves no partial request or property row'
);

select * from finish();

rollback;
