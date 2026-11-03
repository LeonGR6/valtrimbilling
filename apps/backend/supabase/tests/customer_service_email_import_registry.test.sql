-- Run only after the new migration is applied to the linked remote project:
-- npm run db:test -- customer_service_email_import_registry.test.sql
-- Self-contained fixtures; all writes roll back. No mailbox, Storage or AI calls.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('valtrim', 'service_request_imports', 'Email receipts have a separate registry');
select col_is_null('valtrim', 'service_request_imports', 'request_id', 'A failure can exist before a request');
select is(enum_range(null::valtrim.service_request_import_status)::text[],
  array['PENDING','PROCESSING','NEEDS_ATTENTION','PROCESSED'], 'Import statuses are technical and explicit');
select ok(not ('NEEDS_ATTENTION' = any(enum_range(null::valtrim.service_request_workflow_stage)::text[])),
  'Import failure is not a request workflow stage');
select ok((select relrowsecurity from pg_class where oid = 'valtrim.service_request_imports'::regclass),
  'The registry enables RLS');
select ok(has_table_privilege('authenticated', 'valtrim.service_request_imports', 'SELECT')
  and not has_table_privilege('authenticated', 'valtrim.service_request_imports', 'INSERT')
  and not has_table_privilege('authenticated', 'valtrim.service_request_imports', 'UPDATE')
  and not has_table_privilege('authenticated', 'valtrim.service_request_imports', 'DELETE'),
  'Browser users cannot mutate imports directly');
select ok(not has_table_privilege('anon', 'valtrim.service_request_imports', 'SELECT'),
  'Anonymous users cannot read email sources');
select ok(has_table_privilege('service_role', 'valtrim.service_request_imports', 'INSERT')
  and has_table_privilege('service_role', 'valtrim.service_request_imports', 'UPDATE')
  and not has_table_privilege('service_role', 'valtrim.service_request_imports', 'DELETE')
  and not has_table_privilege('service_role', 'valtrim.service_request_imports', 'TRUNCATE'),
  'The backend can persist work but cannot delete receipts through its table grant');
select ok(has_function_privilege('service_role',
  'valtrim.register_customer_service_email_import(uuid,text,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated',
    'valtrim.register_customer_service_email_import(uuid,text,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon',
    'valtrim.register_customer_service_email_import(uuid,text,text,jsonb)', 'EXECUTE'),
  'Only the trusted backend can register email receipts');
select ok(not has_function_privilege('anon', 'valtrim.read_customer_service_email_import(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'valtrim.count_customer_service_email_imports()', 'EXECUTE')
  and not has_function_privilege('anon',
    'valtrim.list_customer_service_email_imports(valtrim.service_request_import_status,integer,integer)', 'EXECUTE'),
  'Anonymous users cannot call the read operations');

create temporary table import_fixture as select
  gen_random_uuid() tenant_id, gen_random_uuid() other_tenant_id,
  gen_random_uuid() admin_id, gen_random_uuid() scheduler_id,
  gen_random_uuid() denied_id, gen_random_uuid() inactive_id,
  null::jsonb baseline_counts, null::jsonb snapshot,
  null::bigint property_id, null::bigint request_id,
  (select count(*) from valtrim.service_requests) baseline_requests,
  (select count(*) from valtrim.service_request_sources) baseline_sources;

insert into auth.users(id, email, raw_user_meta_data)
select actor_id, actor_id::text || '@example.com', '{"name":"Import Registry Test"}'::jsonb
from import_fixture cross join lateral
  (values (admin_id), (scheduler_id), (denied_id), (inactive_id)) actors(actor_id);
update valtrim.app_users set role = 'ADMIN' where id = (select admin_id from import_fixture);
update valtrim.app_users set role = 'SCHEDULING' where id = (select scheduler_id from import_fixture);
update valtrim.app_users set role = 'READ_ONLY' where id = (select denied_id from import_fixture);
update valtrim.app_users set role = 'ADMIN', is_active = false where id = (select inactive_id from import_fixture);
select set_config('request.jwt.claim.sub', admin_id::text, true) from import_fixture;
update import_fixture set baseline_counts = valtrim.count_customer_service_email_imports();

-- Equal message IDs in different tenants/mailboxes are distinct. Graph IDs are
-- opaque and case-sensitive; conversation identity must never collapse replies.
create temporary table import_cases (
  label text primary key, tenant_id uuid, mailbox_id text, message_id text,
  payload jsonb, result jsonb
);
insert into import_cases(label, tenant_id, mailbox_id, message_id, payload)
select c.label, case when c.label = 'other tenant' then f.other_tenant_id else f.tenant_id end,
  c.mailbox_id, c.message_id, c.payload
from import_fixture f cross join (values
  ('main', 'mailbox-A', 'message-Aa', '{"subject":"Service work order","from":{"emailAddress":{"name":"Builder","address":"builder@example.com"}},"bodyText":"Original email text","bodyHtml":"<p>Original email text</p>","sentDateTime":"2026-10-20T17:00:00Z","receivedDateTime":"2026-10-21T12:00:00Z","internetMessageId":"<original@example.com>","conversationId":"same-thread","webLink":"https://outlook.office.com/mail/","attachments":[{"id":"pdf-1","name":"work-order.pdf","contentType":"application/pdf"},{"id":"image-1","name":"photo.jpg","contentType":"image/jpeg"}]}'::jsonb),
  ('message case', 'mailbox-A', 'message-aa', '{}'::jsonb),
  ('mailbox case', 'mailbox-a', 'message-Aa', '{}'::jsonb),
  ('other tenant', 'mailbox-A', 'message-Aa', '{}'::jsonb),
  ('thread reply', 'mailbox-A', 'message-reply', '{"subject":"Service work order","conversationId":"same-thread"}'::jsonb),
  ('metadata only', 'mailbox-A', 'message-metadata', '{}'::jsonb)
) c(label, mailbox_id, message_id, payload);
grant select, update on import_fixture, import_cases to authenticated, service_role;

-- No coordinator JWT is available to the future worker. Do not impersonate one.
select set_config('request.jwt.claim.sub', '', true);
set local role service_role;
update import_cases set result = valtrim.register_customer_service_email_import(
  tenant_id, mailbox_id, message_id, payload);
select is((result ->> 'idempotentReplay')::boolean, false, label || ': first registration is new') from import_cases;
select is(result ->> 'status', 'PENDING', label || ': registration only queues work') from import_cases;
select is(result ->> 'submissionKey', result ->> 'importId', label || ': retry key is the persistent import identity') from import_cases;
select is((select count(distinct result ->> 'importId') from import_cases), 6::bigint,
  'Tenant, mailbox, message case and separate replies retain distinct identities');
select ok((select bool_and(result -> 'requestId' = 'null'::jsonb) from import_cases),
  'Receipt registration does not fabricate any request');

select is(valtrim.register_customer_service_email_import(tenant_id, mailbox_id, message_id,
  '{"subject":"Changed on retry","bodyText":"Do not overwrite originals"}') ->> 'importId',
  result ->> 'importId', label || ': repeating the same email returns the existing identity') from import_cases;
select is((valtrim.register_customer_service_email_import(tenant_id, mailbox_id, message_id, payload)
  ->> 'idempotentReplay')::boolean, true, label || ': repeat registration is reported as replay') from import_cases;
select is((select receipt.source_payload from valtrim.service_request_imports receipt
    where receipt.id = (c.result ->> 'importId')::uuid), c.payload,
  c.label || ': replay preserves the original email snapshot') from import_cases c;

select throws_ok(format('select valtrim.register_customer_service_email_import(null,%L,%L,%L::jsonb)',
  'mailbox-A','new-message','{}'), '22023',
  'Tenant, mailbox and stable message identity are required without surrounding spaces', 'Tenant is mandatory');
select throws_ok(format('select valtrim.register_customer_service_email_import(%L,%L,%L,%L::jsonb)',
  tenant_id, mailbox, message, '{}'), '22023',
  'Tenant, mailbox and stable message identity are required without surrounding spaces', label)
from import_fixture cross join (values
  (null::text, 'new-message', 'Null mailbox is rejected'),
  ('', 'new-message', 'Empty mailbox is rejected'),
  (' mailbox-A', 'new-message', 'Mailbox identity is not silently normalized'),
  ('mailbox-A', null::text, 'Null message identity is rejected'),
  ('mailbox-A', '', 'Empty message identity is rejected'),
  ('mailbox-A', 'message-Aa ', 'Message identity is not silently normalized')
) invalid(mailbox, message, label);
select throws_ok(format('select valtrim.register_customer_service_email_import(%L,%L,%L,%s)',
  tenant_id, 'mailbox-A', 'new-message', payload), '22023',
  'Email source payload must be an object', label)
from import_fixture cross join (values
  ('null'::text, 'SQL null payload is rejected'),
  ($$'null'::jsonb$$, 'JSON null payload is rejected'),
  ($$'[]'::jsonb$$, 'Array payload is rejected'),
  ($$'"body"'::jsonb$$, 'Scalar payload is rejected')
) invalid(payload, label);

update valtrim.service_request_imports set status = 'PROCESSING', attempt_count = 1,
  last_attempt_at = now(), processing_started_at = now()
where id = (select (result ->> 'importId')::uuid from import_cases where label = 'main');
update valtrim.service_request_imports set status = 'NEEDS_ATTENTION',
  error_code = 'EXTRACTION_FAILED', error_message = 'Could not read the PDF',
  extraction_payload = '{"reviewNotes":["Unreadable PDF"]}'
where id = (select (result ->> 'importId')::uuid from import_cases where label = 'main');
update import_fixture set snapshot = (select to_jsonb(receipt) from valtrim.service_request_imports receipt
  where receipt.id = (select (result ->> 'importId')::uuid from import_cases where label = 'main'));
select is(valtrim.register_customer_service_email_import(tenant_id, mailbox_id, message_id, '{}') ->> 'status',
  'NEEDS_ATTENTION', 'A duplicate delivery does not silently retry or clear an error') from import_cases where label = 'main';
select is((select to_jsonb(receipt) from valtrim.service_request_imports receipt
    where receipt.id = (select (result ->> 'importId')::uuid from import_cases where label = 'main')),
  snapshot, 'Replay preserves attempts, errors, extraction and timestamps too') from import_fixture;
reset role;

select is((select count(*) from valtrim.service_requests), baseline_requests,
  'Registering/replaying emails allocates no business request') from import_fixture;
select is((select count(*) from valtrim.service_request_sources), baseline_sources,
  'Registering/replaying emails does not alter existing request sources') from import_fixture;
select is((select count(*) from valtrim.service_request_imports where tenant_id in (f.tenant_id, f.other_tenant_id)),
  6::bigint, 'Duplicate deliveries never add extra receipt rows') from import_fixture f;

-- Direct backend writes must respect identity, JSON shape and state invariants.
select throws_ok(format('insert into valtrim.service_request_imports(tenant_id,mailbox_id,provider_message_id) values (%L,%L,%L)',
  tenant_id, mailbox_id, message_id), '23505', null, 'The unique constraint also rejects a direct duplicate')
from import_cases where label = 'main';
select throws_ok(format('update valtrim.service_request_imports set %s where id = %L',
  assignment, result ->> 'importId'), invalid.sqlstate, null, invalid.label)
from import_cases cross join (values
  ('attempt_count = -1', '23514', 'Negative attempt counts are rejected'),
  ($$source_payload = '[]'$$, '23514', 'Original source must be an object'),
  ($$attachment_refs = '{}'$$, '23514', 'Attachment references must be an array'),
  ($$attachment_refs = '[null]'$$, '23514', 'Attachment references cannot contain JSON null'),
  ($$attachment_refs = '["binary"]'$$, '23514', 'Attachment references cannot contain scalar entries'),
  ($$extraction_payload = '[]'$$, '23514', 'Extraction must be a separate object'),
  ($$status = 'PROCESSING'$$, '23514', 'Processing requires an actual attempt and start time'),
  ($$status = 'NEEDS_ATTENTION'$$, '23514', 'Attention requires a readable error reason'),
  ($$status = 'NEEDS_ATTENTION', error_message = ' '$$, '23514', 'Blank error messages cannot hide a failure'),
  ($$status = 'PROCESSED', processed_at = now()$$, '23514', 'An import without a request cannot be marked processed'),
  ($$request_id = -1$$, '23503', 'An import cannot link to a nonexistent request'),
  ($$id = gen_random_uuid()$$, '22023', 'Receipt identity cannot be replaced'),
  ($$tenant_id = gen_random_uuid()$$, '22023', 'Tenant identity cannot be replaced'),
  ($$mailbox_id = 'replacement'$$, '22023', 'Mailbox identity cannot be replaced'),
  ($$provider_message_id = 'replacement'$$, '22023', 'Message identity cannot be replaced'),
  ($$created_at = created_at + interval '1 second'$$, '22023', 'Original registration time cannot be replaced')
) invalid(assignment, sqlstate, label) where import_cases.label = 'metadata only';

-- Simulate a later save using private test fixtures, not production requests.
with property as (insert into valtrim.service_properties default values returning id)
update import_fixture set property_id = property.id from property;
with request as (
  insert into valtrim.service_requests(property_id, homeowner_name, description)
  select property_id, 'Import registry fixture', 'Adjust the door' from import_fixture returning id
)
update import_fixture set request_id = request.id from request;
set local role service_role;
update valtrim.service_request_imports set request_id = f.request_id
from import_fixture f where id = (select (result ->> 'importId')::uuid from import_cases where label = 'main');
reset role;
select is((select status::text from valtrim.service_request_imports
  where id = (select (result ->> 'importId')::uuid from import_cases where label = 'main')),
  'NEEDS_ATTENTION', 'A partial import can need attention even after request creation');
select throws_ok(format('update valtrim.service_request_imports set request_id = null where id = %L', result ->> 'importId'),
  '22023', 'Email import identity and an associated request cannot be replaced',
  'A retry cannot detach the request it already created') from import_cases where label = 'main';
select throws_ok(format('update valtrim.service_request_imports set request_id = -1 where id = %L', result ->> 'importId'),
  '22023', 'Email import identity and an associated request cannot be replaced',
  'A retry cannot redirect an import to another request') from import_cases where label = 'main';
select throws_ok(format('delete from valtrim.service_requests where id = %s', request_id), '23503', null,
  'Deleting a linked request cannot orphan the email registry') from import_fixture;
select throws_ok(format('update valtrim.service_request_imports set status = %L where id = %L',
  'PROCESSED', result ->> 'importId'), '23514', null, 'Processed also requires completion time')
from import_cases where label = 'main';
set local role service_role;
update valtrim.service_request_imports set status = 'PROCESSED', processed_at = now(),
  error_code = null, error_message = null,
  attachment_refs = '[{"attachmentId":"pdf-1","bucketId":"customer-service-sources","objectPath":"imports/test/work-order.pdf"}]'
where id = (select (result ->> 'importId')::uuid from import_cases where label = 'main');
update valtrim.service_request_imports set status = 'NEEDS_ATTENTION', error_message = 'Needs manual recovery'
where id = (select (result ->> 'importId')::uuid from import_cases where label = 'thread reply');
update valtrim.service_request_imports set status = 'PROCESSING', attempt_count = 1,
  last_attempt_at = now(), processing_started_at = now()
where id = (select (result ->> 'importId')::uuid from import_cases where label = 'metadata only');
select is((valtrim.register_customer_service_email_import(tenant_id, mailbox_id, message_id, '{}')
    ->> 'requestId')::bigint,
  (select request_id from import_fixture), 'Replay returns the already-linked request') from import_cases where label = 'main';
reset role;
select is((select workflow_stage::text from valtrim.service_requests where id = f.request_id),
  'NEEDS_REVIEW', 'Technical success does not approve the business request') from import_fixture f;

-- Authorized read operations: complete detail, bounded summary and counts.
select set_config('request.jwt.claim.sub', admin_id::text, true) from import_fixture;
set local role authenticated;
select is(valtrim.read_customer_service_email_import((result ->> 'importId')::uuid) -> 'source_payload',
  payload, 'The complete original email and attachment metadata remain available') from import_cases where label = 'main';
select is(jsonb_array_length(valtrim.read_customer_service_email_import((result ->> 'importId')::uuid) -> 'attachment_refs'),
  1, 'Detail exposes private storage references without creating or verifying a Storage object') from import_cases where label = 'main';
select is(valtrim.read_customer_service_email_import((result ->> 'importId')::uuid) -> 'extraction_payload',
  '{"reviewNotes":["Unreadable PDF"]}'::jsonb, 'Detail preserves extraction separately from the source') from import_cases where label = 'main';
-- pgTAP is(anyelement, anyelement, text) requires matching argument types;
-- JSON ->> returns text, while the persisted folio column is varchar.
select is(valtrim.read_customer_service_email_import((result ->> 'importId')::uuid) ->> 'request_folio',
  (select folio::text from valtrim.service_requests where id = f.request_id), 'Detail identifies the existing request by its folio')
from import_cases cross join import_fixture f where label = 'main';
select ok((select count(*) = 6 from valtrim.service_request_imports where tenant_id in (f.tenant_id, f.other_tenant_id)),
  'Active ADMIN can read fixture rows through RLS') from import_fixture f;
select is((valtrim.count_customer_service_email_imports() ->> 'total')::bigint,
  (baseline_counts ->> 'total')::bigint + 6, 'Counter includes each distinct receipt only once') from import_fixture;
select is((valtrim.count_customer_service_email_imports() ->> key)::bigint,
  (baseline_counts ->> key)::bigint + delta, key || ': counts reflect current technical statuses')
from import_fixture cross join (values ('pending',3),('processing',1),('needsAttention',1),('processed',1)) expected(key,delta);
select ok((select bool_and(not (entry ?| array['source_payload','attachment_refs','extraction_payload']))
  from valtrim.list_customer_service_email_imports() entry), 'Listing omits large original bodies, references and extractions');
select ok((select bool_and(entry ->> 'status' = 'NEEDS_ATTENTION')
  from valtrim.list_customer_service_email_imports('NEEDS_ATTENTION') entry), 'Listing supports the future errors panel filter');
select is((select count(*) from valtrim.list_customer_service_email_imports(null, 2, 0)),
  2::bigint, 'List page size is bounded');
select is((select array_agg((entry ->> 'id')::uuid order by ordinal)
    from valtrim.list_customer_service_email_imports(null, 2, 1) with ordinality rows(entry,ordinal)),
  (select array_agg(id order by created_at desc, id desc) from (
    select id, created_at from valtrim.service_request_imports order by created_at desc, id desc limit 2 offset 1
  ) expected), 'Pagination uses stable registration time and identity ordering');
select throws_ok(format('select valtrim.list_customer_service_email_imports(null,%s,%s)', page_size, page_offset),
  '22023', 'Import page size must be between 1 and 100 and offset must be nonnegative', label)
from (values ('0','0','Zero page size is rejected'),('101','0','Excessive page size is rejected'),
  ('null','0','Null page size is rejected'),('1','-1','Negative offset is rejected'),('1','null','Null offset is rejected')
) invalid(page_size,page_offset,label);
select throws_ok('select valtrim.read_customer_service_email_import(null)', '22023',
  'Import identity is required', 'Detail requires an import identity');
select throws_ok(format('select valtrim.read_customer_service_email_import(%L)', gen_random_uuid()), 'P0002',
  'Email import not found', 'A missing import is reported explicitly');
select throws_ok(format('select valtrim.register_customer_service_email_import(%L,%L,%L)', tenant_id,'mailbox-A','new-message'),
  '42501', null, 'A browser user cannot call the backend registration RPC') from import_fixture;
select throws_ok(format('update valtrim.service_request_imports set error_message = %L where id = %L',
  'Forged', result ->> 'importId'), '42501', null, 'Even an ADMIN cannot directly edit import state from the browser')
from import_cases where label = 'main';
reset role;

select set_config('request.jwt.claim.sub', scheduler_id::text, true) from import_fixture;
set local role authenticated;
select lives_ok('select valtrim.count_customer_service_email_imports()', 'Active SCHEDULING can read counts');
select lives_ok('select valtrim.list_customer_service_email_imports()', 'Active SCHEDULING can list receipts');
select lives_ok(format('select valtrim.read_customer_service_email_import(%L)', result ->> 'importId'),
  'Active SCHEDULING can read original email detail') from import_cases where label = 'main';
select is((select count(*) from valtrim.service_request_imports where tenant_id in (f.tenant_id, f.other_tenant_id)),
  6::bigint, 'Active SCHEDULING can read through RLS') from import_fixture f;
reset role;

-- All read paths, including SECURITY DEFINER RPCs, reject denied/inactive users.
create temporary table denied_actors as
select 'READ_ONLY' label, denied_id actor_id from import_fixture
union all select 'inactive ADMIN', inactive_id from import_fixture
union all select 'missing authenticated identity', null::uuid;
grant select on denied_actors to authenticated;
create function pg_temp.assert_import_reads_denied(p_actor_id uuid, p_label text)
returns setof text language plpgsql as $function$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_actor_id::text, ''), true);
  return next is((select count(*) from valtrim.service_request_imports), 0::bigint,
    p_label || ': RLS hides all email sources');
  return next throws_ok('select valtrim.list_customer_service_email_imports()', '42501',
    'You do not have permission to manage Customer Service requests', p_label || ': list RPC rejects access');
  return next throws_ok('select valtrim.count_customer_service_email_imports()', '42501',
    'You do not have permission to manage Customer Service requests', p_label || ': count RPC rejects access');
  return next throws_ok(format('select valtrim.read_customer_service_email_import(%L)',
    (select result ->> 'importId' from import_cases where label = 'main')), '42501',
    'You do not have permission to manage Customer Service requests', p_label || ': detail RPC rejects access');
end;
$function$;
set local role authenticated;
select assertions.* from denied_actors cross join lateral pg_temp.assert_import_reads_denied(actor_id,label) assertions;
reset role;
set local role anon;
select throws_ok('select valtrim.count_customer_service_email_imports()', '42501', null, 'Anonymous count RPC is denied');
select throws_ok('select * from valtrim.service_request_imports', '42501', null, 'Anonymous source reads are denied');
reset role;

select * from finish();
rollback;
