begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select ok(
  to_regtype('valtrim.service_request_workflow_stage') is not null,
  'The New Request workflow enum exists'
);

select ok(
  enum_range(null::valtrim.service_request_workflow_stage)::text[] = array[
    'NEEDS_REVIEW',
    'READY_TO_PROPOSE',
    'AWAITING_CUSTOMER',
    'NEEDS_CONTACT',
    'CONFIRMED',
    'WORKING',
    'COMPLETED'
  ]::text[],
  'Workflow stages exactly match the confirmed Customer Service flow'
);

select ok(
  enum_range(null::valtrim.service_kind)::text[] = array[
    'ADJUSTMENT', 'REPLACEMENT', 'PAID_EXTRA'
  ]::text[],
  'Service kinds exactly match the request form'
);

select ok(
  enum_range(null::valtrim.service_work_category)::text[] = array[
    'EXTERIOR_FRAMES',
    'DOORS',
    'MOLDINGS',
    'HARDWARE',
    'WEATHERSTRIPPING',
    'SHELVING',
    'MULTIPLE_WORK_TYPES'
  ]::text[],
  'Work categories exactly match the request and calendar catalog'
);

select ok(
  enum_range(null::valtrim.service_task)::text[] = array[
    'GENERAL_FIX',
    'EXTERIOR_DOOR_REPLACEMENT',
    'EXTERIOR_FRAME_REPLACEMENT',
    'SHUTTER_REPLACEMENT',
    'SHELVING_REPLACEMENT'
  ]::text[],
  'Service tasks exactly match the planning catalog'
);

select ok(
  enum_range(null::valtrim.service_request_contact_role)::text[] =
    array['PRIMARY', 'ADDITIONAL']::text[],
  'Requests support one primary and one additional contact role'
);

select ok(
  enum_range(null::valtrim.service_reported_on_source)::text[] = array[
    'EMAIL_SENT', 'ORDER_DATE', 'SCHEDULED_DATE', 'MANUAL'
  ]::text[],
  'Reported on preserves its confirmed source'
);

select ok(
  enum_range(null::valtrim.service_request_source_type)::text[] =
    array['PDF', 'EMAIL_TEXT', 'EMAIL_METADATA']::text[],
  'Sources distinguish PDF, email text and email details without a document'
);

select ok(
  enum_range(null::valtrim.service_request_source_file_status)::text[] = array[
    'NOT_APPLICABLE', 'PENDING', 'AVAILABLE', 'FAILED'
  ]::text[],
  'Source file persistence has explicit lifecycle states'
);

select has_column(
  'valtrim', 'service_properties', 'job_id',
  'Service properties can reference the selected Job'
);

select col_type_is(
  'valtrim', 'service_properties', 'job_id', 'bigint',
  'The property Job reference uses the Jobs bigint identity'
);

select col_is_null(
  'valtrim', 'service_properties', 'job_id',
  'Legacy service properties may remain without a Job during migration'
);

select col_is_null(
  'valtrim', 'service_properties', 'address',
  'Address is optional when a Job supplies verified coordinates'
);

select ok(
  exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'valtrim.service_properties'::regclass
      and constraint_record.confrelid = 'valtrim.jobs'::regclass
      and constraint_record.contype = 'f'
      and pg_get_constraintdef(constraint_record.oid) like
        '%FOREIGN KEY (job_id)%'
  ),
  'Service properties reference the selected Job without reviving community_id'
);

select has_index(
  'valtrim', 'service_properties', 'service_properties_job_idx',
  'Service property lookups by Job are indexed'
);

select has_column(
  'valtrim', 'service_requests', 'submission_key',
  'Requests store a client idempotency key'
);

select has_column(
  'valtrim', 'service_requests', 'workflow_stage',
  'Requests store the new workflow stage'
);

select has_column(
  'valtrim', 'service_requests', 'reported_on_source',
  'Requests preserve the source of Reported on'
);

select has_column(
  'valtrim', 'service_requests', 'service_kind',
  'Requests store the service kind'
);

select has_column(
  'valtrim', 'service_requests', 'work_category',
  'Requests store the current work category'
);

select has_column(
  'valtrim', 'service_requests', 'service_task',
  'Requests store the planning task'
);

select has_column(
  'valtrim', 'service_requests', 'crew_size',
  'Requests store the reviewed crew size'
);

select has_column(
  'valtrim', 'service_requests', 'reviewed_at',
  'Requests store the review timestamp'
);

select has_column(
  'valtrim', 'service_requests', 'reviewed_by',
  'Requests store the reviewing user'
);

select has_column(
  'valtrim', 'service_requests', 'valtrim_items_confirmed',
  'Requests store explicit Valtrim scope confirmation'
);

select is(
  (
    select column_record.column_default::text
    from information_schema.columns column_record
    where column_record.table_schema = 'valtrim'
      and column_record.table_name = 'service_requests'
      and column_record.column_name = 'workflow_stage'
  ),
  '''NEEDS_REVIEW''::valtrim.service_request_workflow_stage'::text,
  'New requests start in Needs review'
);

select is(
  (
    select column_record.column_default::text
    from information_schema.columns column_record
    where column_record.table_schema = 'valtrim'
      and column_record.table_name = 'service_requests'
      and column_record.column_name = 'reported_on_source'
  ),
  '''MANUAL''::valtrim.service_reported_on_source'::text,
  'Legacy requests receive a safe manual Reported on source'
);

select is(
  (
    select column_record.column_default::text
    from information_schema.columns column_record
    where column_record.table_schema = 'valtrim'
      and column_record.table_name = 'service_requests'
      and column_record.column_name = 'valtrim_items_confirmed'
  ),
  'false'::text,
  'Valtrim scope is never confirmed implicitly'
);

select has_index(
  'valtrim', 'service_requests', 'service_requests_submission_key_uq',
  'Request idempotency keys are uniquely indexed'
);

select has_index(
  'valtrim', 'service_requests', 'service_requests_workflow_inbox_idx',
  'Workflow inbox queries have a supporting index'
);

select has_table(
  'valtrim', 'service_request_contacts',
  'Request contacts are persisted separately'
);

select has_table(
  'valtrim', 'service_request_items',
  'Request work items are persisted separately'
);

select has_table(
  'valtrim', 'service_request_sources',
  'The immutable request source is persisted separately'
);

select has_table(
  'valtrim', 'service_request_workflow_history',
  'The new workflow has an independent history table'
);

select ok(
  exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid =
      'valtrim.service_request_contacts'::regclass
      and constraint_record.conname =
        'service_request_contacts_nonempty_check'
  ),
  'Contacts cannot be entirely empty; the completeness trigger requires name and channel outside imported NEEDS_REVIEW'
);

select ok(
  exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid =
      'valtrim.service_request_contacts'::regclass
      and constraint_record.conname =
        'service_request_contacts_number_uq'
      and constraint_record.contype = 'u'
  ),
  'A request cannot duplicate a customer position; additional contacts share their role'
);

select ok(
  exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid =
      'valtrim.service_request_items'::regclass
      and constraint_record.conname = 'service_request_items_number_check'
  ),
  'Work item numbers are limited to the supported 1 through 25 range'
);

select ok(
  exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid =
      'valtrim.service_request_sources'::regclass
      and constraint_record.conname = 'service_request_sources_input_check'
  ),
  'Source type, text, file, and lifecycle state must agree'
);

select has_trigger(
  'valtrim',
  'service_request_contacts',
  'service_request_contacts_stamp_actor',
  'Contact changes stamp the authenticated actor'
);

select has_trigger(
  'valtrim',
  'service_request_items',
  'service_request_items_stamp_actor',
  'Work item changes stamp the authenticated actor'
);

select has_trigger(
  'valtrim',
  'service_request_sources',
  'service_request_sources_stamp_actor',
  'Source changes stamp the authenticated actor'
);

select has_trigger(
  'valtrim',
  'service_requests',
  'service_requests_record_workflow_stage',
  'Request creation and workflow transitions are recorded'
);

select ok(
  (
    select bool_and(table_record.relrowsecurity)
    from pg_class table_record
    join pg_namespace schema_record
      on schema_record.oid = table_record.relnamespace
    where schema_record.nspname = 'valtrim'
      and table_record.relname in (
        'service_request_contacts',
        'service_request_items',
        'service_request_sources',
        'service_request_workflow_history'
      )
  ),
  'Every New Request child table has RLS enabled'
);

select is(
  (
    select count(*)
    from pg_policies policy
    where policy.schemaname = 'valtrim'
      and policy.tablename in (
        'service_request_contacts',
        'service_request_items',
        'service_request_sources',
        'service_request_workflow_history'
      )
      and policy.cmd = 'SELECT'
  ),
  4::bigint,
  'Each New Request child table has one authenticated read policy'
);

select ok(
  has_table_privilege(
    'authenticated', 'valtrim.service_request_contacts', 'select'
  )
  and has_table_privilege(
    'authenticated', 'valtrim.service_request_items', 'select'
  )
  and has_table_privilege(
    'authenticated', 'valtrim.service_request_sources', 'select'
  )
  and has_table_privilege(
    'authenticated', 'valtrim.service_request_workflow_history', 'select'
  ),
  'Authenticated Customer Service users receive read grants'
);

select ok(
  not has_table_privilege(
    'authenticated', 'valtrim.service_request_contacts', 'insert'
  )
  and not has_table_privilege(
    'authenticated', 'valtrim.service_request_items', 'insert'
  )
  and not has_table_privilege(
    'authenticated', 'valtrim.service_request_sources', 'insert'
  )
  and not has_table_privilege(
    'authenticated', 'valtrim.service_request_workflow_history', 'insert'
  ),
  'Browser clients cannot bypass the future transactional RPC'
);

select ok(
  not has_sequence_privilege(
    'authenticated', 'valtrim.service_request_contacts_id_seq', 'usage'
  )
  and not has_sequence_privilege(
    'authenticated', 'valtrim.service_request_items_id_seq', 'usage'
  )
  and not has_sequence_privilege(
    'authenticated', 'valtrim.service_request_sources_id_seq', 'usage'
  )
  and not has_sequence_privilege(
    'authenticated',
    'valtrim.service_request_workflow_history_id_seq',
    'usage'
  ),
  'Browser clients cannot allocate child identities directly'
);

create temporary table request_intake_fixture (
  request_id bigint primary key
);

insert into valtrim.service_properties (
  lot_number,
  address
)
values (
  'PGTAP-INTAKE-LOT',
  null
);

with inserted_request as (
  insert into valtrim.service_requests (
    property_id,
    reported_on,
    homeowner_name,
    homeowner_email,
    description,
    submission_key
  )
  select
    property.id,
    current_date,
    'Intake Test Customer',
    'intake.customer@example.com',
    'Customer Service intake schema test',
    '10000000-0000-4000-8000-000000000001'::uuid
  from valtrim.service_properties property
  where property.lot_number = 'PGTAP-INTAKE-LOT'
  returning id
)
insert into request_intake_fixture (request_id)
select id
from inserted_request;

select is(
  (
    select request.workflow_stage
    from valtrim.service_requests request
    join request_intake_fixture fixture on fixture.request_id = request.id
  ),
  'NEEDS_REVIEW'::valtrim.service_request_workflow_stage,
  'A persisted request starts in Needs review'
);

select ok(
  exists (
    select 1
    from valtrim.service_request_workflow_history history
    join request_intake_fixture fixture
      on fixture.request_id = history.request_id
    where history.previous_stage is null
      and history.new_stage = 'NEEDS_REVIEW'
  ),
  'Creating a request records its initial workflow stage'
);

insert into valtrim.service_request_contacts (
  request_id,
  role,
  name,
  email
)
select
  fixture.request_id,
  'PRIMARY',
  'Primary Customer',
  'primary.customer@example.com'
from request_intake_fixture fixture;

insert into valtrim.service_request_contacts (
  request_id,
  role,
  name,
  phone
)
select
  fixture.request_id,
  'ADDITIONAL',
  'Additional Customer',
  '+19515550102'
from request_intake_fixture fixture;

select is(
  (
    select count(*)
    from valtrim.service_request_contacts contact
    join request_intake_fixture fixture
      on fixture.request_id = contact.request_id
  ),
  2::bigint,
  'A request accepts a primary and additional contact using different methods'
);

insert into valtrim.service_request_items (
  request_id,
  item_number,
  description,
  material_required,
  chargeable
)
select
  fixture.request_id,
  1,
  'Adjust the front entry door.',
  false,
  false
from request_intake_fixture fixture;

insert into valtrim.service_request_items (
  request_id,
  item_number,
  description,
  material_required,
  chargeable
)
select
  fixture.request_id,
  2,
  'Replace damaged weatherstripping.',
  true,
  false
from request_intake_fixture fixture;

select is(
  (
    select array_agg(item.item_number order by item.item_number)
    from valtrim.service_request_items item
    join request_intake_fixture fixture
      on fixture.request_id = item.request_id
  ),
  array[1, 2]::smallint[],
  'A request preserves the ordered list of work items'
);

insert into valtrim.service_request_sources (
  request_id,
  source_type,
  sender_email,
  subject,
  email_text,
  file_status,
  extraction_payload,
  review_notes
)
select
  fixture.request_id,
  'EMAIL_TEXT',
  'builder@example.com',
  'Warranty request',
  'Please review the attached service details.',
  'NOT_APPLICABLE',
  '{"version":"1.0"}'::jsonb,
  array['Confirm the extracted work category.']::text[]
from request_intake_fixture fixture;

select is(
  (
    select source.file_status
    from valtrim.service_request_sources source
    join request_intake_fixture fixture
      on fixture.request_id = source.request_id
  ),
  'NOT_APPLICABLE'::valtrim.service_request_source_file_status,
  'Pasted email text does not claim to have a persisted file'
);

update valtrim.service_requests request
set workflow_stage = 'READY_TO_PROPOSE',
    reviewed_at = now(),
    valtrim_items_confirmed = true
from request_intake_fixture fixture
where request.id = fixture.request_id;

select ok(
  exists (
    select 1
    from valtrim.service_request_workflow_history history
    join request_intake_fixture fixture
      on fixture.request_id = history.request_id
    where history.previous_stage = 'NEEDS_REVIEW'
      and history.new_stage = 'READY_TO_PROPOSE'
  ),
  'Changing workflow stage appends a separate history entry'
);

select * from finish();

rollback;
