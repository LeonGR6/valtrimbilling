begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

select has_table(
  'valtrim',
  'job_documents',
  'Job document metadata table is available'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.job_documents'::regclass),
  'Job documents have RLS enabled'
);

select ok(
  has_column_privilege(
    'authenticated',
    'valtrim.job_documents',
    'storage_path',
    'select'
  ),
  'Authenticated users can select document metadata subject to RLS'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.job_documents', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.job_documents', 'update')
  and not has_table_privilege('authenticated', 'valtrim.job_documents', 'delete'),
  'Browser clients cannot mutate document metadata directly'
);

select ok(
  exists (
    select 1
    from storage.buckets bucket
    where bucket.id = 'job-documents'
      and not bucket.public
  ),
  'Job documents use a private Storage bucket'
);

select ok(
  exists (
    select 1
    from storage.buckets bucket
    where bucket.id = 'job-documents'
      and bucket.file_size_limit = 26214400
      and bucket.allowed_mime_types = array['application/pdf']::text[]
  ),
  'The bucket accepts only PDF files up to 25 MB'
);

select has_function(
  'valtrim',
  'register_job_document',
  array['bigint', 'valtrim.billing_document_type', 'text', 'text', 'bigint'],
  'Role-checked document registration RPC is available'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.register_job_document(bigint,valtrim.billing_document_type,text,text,bigint)',
    'execute'
  ),
  'Authenticated users can call document registration subject to its role check'
);

select ok(
  not has_function_privilege(
    'anon',
    'valtrim.register_job_document(bigint,valtrim.billing_document_type,text,text,bigint)',
    'execute'
  ),
  'Anonymous users cannot register Job documents'
);

select ok(
  (
    select prosecdef
    from pg_proc
    where oid =
      'private.register_job_document(bigint,valtrim.billing_document_type,text,text,bigint)'::regprocedure
  ),
  'The private registration implementation uses definer rights after role checks'
);

select ok(
  not (
    select prosecdef
    from pg_proc
    where oid =
      'valtrim.register_job_document(bigint,valtrim.billing_document_type,text,text,bigint)'::regprocedure
  ),
  'The exposed document registration wrapper runs as the caller'
);

select ok(
  coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid =
      'private.register_job_document(bigint,valtrim.billing_document_type,text,text,bigint)'::regprocedure
  ), false),
  'The private registration function pins an empty search path'
);

select set_eq(
  $$
    select policyname
    from pg_policies
    where schemaname = 'valtrim'
      and tablename = 'job_documents'
  $$,
  $$ values ('job_documents_select') $$,
  'Document metadata exposes only its active-user read policy'
);

select set_eq(
  $$
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname like 'job_documents_objects_%'
  $$,
  $$ values
    ('job_documents_objects_select'),
    ('job_documents_objects_insert'),
    ('job_documents_objects_delete')
  $$,
  'Private Storage exposes read, upload and compensating-delete policies'
);

select has_trigger(
  'valtrim',
  'job_documents',
  'stamp_and_validate_actor',
  'Job document audit actors are validated'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.job_documents'::regclass
      and confrelid = 'valtrim.jobs'::regclass
      and contype = 'f'
  ),
  'Every document belongs to a real Job'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.job_documents'::regclass
      and confrelid = 'valtrim.app_users'::regclass
      and contype = 'f'
  ),
  'Every document preserves its uploader identity'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'valtrim'
      and tablename = 'job_documents'
      and indexname = 'job_documents_job_type_created_idx'
  ),
  'Job and document type lookups are indexed'
);

select has_function(
  'valtrim',
  'delete_job_document',
  array['uuid'],
  'Role-checked document deletion RPC is available'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.delete_job_document(uuid)',
    'execute'
  ),
  'Authenticated users can call document deletion subject to its role check'
);

select ok(
  not has_function_privilege(
    'anon',
    'valtrim.delete_job_document(uuid)',
    'execute'
  ),
  'Anonymous users cannot delete Job documents'
);

select ok(
  (
    select prosecdef
    from pg_proc
    where oid = 'private.delete_job_document(uuid)'::regprocedure
  ),
  'The private deletion implementation uses definer rights after role checks'
);

select ok(
  not (
    select prosecdef
    from pg_proc
    where oid = 'valtrim.delete_job_document(uuid)'::regprocedure
  ),
  'The exposed document deletion wrapper runs as the caller'
);

select ok(
  coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'private.delete_job_document(uuid)'::regprocedure
  ), false),
  'The private deletion function pins an empty search path'
);

select * from finish();

rollback;
