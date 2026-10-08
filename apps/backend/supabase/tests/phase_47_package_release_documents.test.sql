begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

select ok(
  exists (
    select 1
    from storage.buckets bucket
    where bucket.id = 'package-documents'
      and not bucket.public
      and bucket.file_size_limit = 26214400
      and bucket.allowed_mime_types = array['application/pdf']::text[]
  ),
  'Package documents use a private PDF bucket limited to 25 MB'
);

select set_eq(
  $$
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname like 'package_documents_objects_%'
  $$,
  $$ values
    ('package_documents_objects_select'),
    ('package_documents_objects_insert'),
    ('package_documents_objects_delete')
  $$,
  'Package Storage exposes read, upload and delete policies'
);

select ok(
  has_table_privilege('authenticated', 'valtrim.package_documents', 'select')
  and has_table_privilege('authenticated', 'valtrim.stored_files', 'select')
  and not has_table_privilege('authenticated', 'valtrim.package_documents', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.package_documents', 'update')
  and not has_table_privilege('authenticated', 'valtrim.package_documents', 'delete')
  and not has_table_privilege('authenticated', 'valtrim.stored_files', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.stored_files', 'update')
  and not has_table_privilege('authenticated', 'valtrim.stored_files', 'delete'),
  'Browsers can read Package documents and cannot write them directly'
);

select ok(
  not has_table_privilege('anon', 'valtrim.package_documents', 'select')
  and not has_table_privilege('anon', 'valtrim.stored_files', 'select'),
  'Anonymous users cannot read Package documents'
);

select set_eq(
  $$
    select tablename || ':' || policyname
    from pg_policies
    where schemaname = 'valtrim'
      and tablename in ('package_documents', 'stored_files')
  $$,
  $$ values
    ('package_documents:package_documents_select'),
    ('stored_files:stored_files_select')
  $$,
  'Each table exposes only its active-user read policy'
);

select has_function(
  'valtrim',
  'get_package_release_values',
  array['bigint'],
  'The Package values RPC is available'
);

select has_function(
  'valtrim',
  'register_package_release',
  array['bigint', 'valtrim.release_type', 'text', 'text', 'bigint', 'text'],
  'The Package Release registration RPC is available'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.get_package_release_values(bigint)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'valtrim.register_package_release(bigint,valtrim.release_type,text,text,bigint,text)',
    'execute'
  ),
  'Signed-in users can call both RPCs subject to their checks'
);

select ok(
  not has_function_privilege(
    'anon',
    'valtrim.get_package_release_values(bigint)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'valtrim.register_package_release(bigint,valtrim.release_type,text,text,bigint,text)',
    'execute'
  ),
  'Anonymous users cannot call either RPC'
);

select ok(
  (
    select prosecdef
    from pg_proc
    where oid = 'private.register_package_release(bigint,valtrim.release_type,text,text,bigint,text)'::regprocedure
  )
  and not (
    select prosecdef
    from pg_proc
    where oid = 'valtrim.register_package_release(bigint,valtrim.release_type,text,text,bigint,text)'::regprocedure
  ),
  'Registration uses definer rights only behind its role check'
);

select ok(
  (
    select prosecdef
    from pg_proc
    where oid = 'private.get_package_release_values(bigint)'::regprocedure
  )
  and not (
    select prosecdef
    from pg_proc
    where oid = 'valtrim.get_package_release_values(bigint)'::regprocedure
  ),
  'The values RPC reaches the private cut-off rule through a definer implementation'
);

select ok(
  coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'private.register_package_release(bigint,valtrim.release_type,text,text,bigint,text)'::regprocedure
  ), false)
  and coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'private.get_package_release_values(bigint)'::regprocedure
  ), false),
  'Both private functions pin an empty search path'
);

select ok(
  coalesce((
    select procedure.prosrc like '%has_app_role%'
      and procedure.prosrc like '%''confirmed''%'
      and procedure.prosrc like '%package-documents%'
      and procedure.prosrc like '%replaced_storage_path%'
      and procedure.prosrc like '%owner_id%'
    from pg_proc procedure
    where procedure.oid =
      'private.register_package_release(bigint,valtrim.release_type,text,text,bigint,text)'::regprocedure
  ), false),
  'Registration checks the role, a confirmed template and the uploaded object, and reports a replaced file'
);

select ok(
  coalesce((
    select procedure.prosrc like '%resolve_billing_cutoff_date%'
      and procedure.prosrc like '%net_amount%'
      and procedure.prosrc like '%coalesce(v_cutoff, v_package.package_date)%'
    from pg_proc procedure
    where procedure.oid = 'private.get_package_release_values(bigint)'::regprocedure
  ), false),
  'The values use the setup cut-off, fall back to the Package date, and read the invoice net amount'
);

select is(
  private.release_type_label('ConditionalWaiverAndReleaseOnProgressPayment'),
  'Conditional Waiver and Release on Progress Payment',
  'A Release type has a readable label'
);

select is(
  private.release_type_label('UnconditionalWaiverAndReleaseOnFinalPayment'),
  'Unconditional Waiver and Release on Final Payment',
  'The label keeps the Unconditional prefix'
);

select is(
  (
    select count(distinct private.release_type_label(type))
    from unnest(enum_range(null::valtrim.release_type)) type
  ),
  4::bigint,
  'The four Release types have four different labels'
);

select throws_ok(
  $$ select private.get_package_release_values(1) $$,
  '42501',
  'You do not have permission to read Package values',
  'Package values need a signed-in user'
);

select throws_ok(
  $$
    select private.register_package_release(
      1,
      'ConditionalWaiverAndReleaseOnProgressPayment',
      '1/release/6f1f6d4e-7d4b-4a37-9f4e-2b8f4f3c9a10.pdf',
      'Release.pdf',
      1000
    )
  $$,
  '42501',
  'You do not have permission to save Package documents',
  'Saving a Package Release needs a signed-in user with a role'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.package_documents'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (package_id, document_type, label)'
  ),
  'A Package keeps one document per type and label, so one Release per type'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.package_documents'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%COMPLETE%file_id IS NOT NULL%'
  ),
  'A COMPLETE Package document always has its file'
);

select is(
  (select data_type from information_schema.columns
   where table_schema = 'valtrim' and table_name = 'package_documents' and column_name = 'document_type'),
  'USER-DEFINED',
  'The document type is the existing billing document enum'
);

select ok(
  'RELEASE' = any (enum_range(null::valtrim.billing_document_type)::text[]),
  'The billing document type includes RELEASE'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.package_documents'::regclass
      and confrelid = 'valtrim.stored_files'::regclass
      and contype = 'f'
  ),
  'A Package document points to its stored file'
);

select * from finish();

rollback;
