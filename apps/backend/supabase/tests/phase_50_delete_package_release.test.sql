begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select has_function(
  'valtrim',
  'delete_package_release',
  array['bigint'],
  'The Release removal RPC is available'
);

select ok(
  has_function_privilege('authenticated', 'valtrim.delete_package_release(bigint)', 'execute')
  and not has_function_privilege('anon', 'valtrim.delete_package_release(bigint)', 'execute'),
  'Signed-in users can call the removal RPC and anonymous users cannot'
);

select ok(
  (
    select prosecdef
    from pg_proc
    where oid = 'private.delete_package_release(bigint)'::regprocedure
  )
  and not (
    select prosecdef
    from pg_proc
    where oid = 'valtrim.delete_package_release(bigint)'::regprocedure
  ),
  'Removal uses definer rights only behind its role check'
);

select ok(
  coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'private.delete_package_release(bigint)'::regprocedure
  ), false),
  'The private function pins an empty search path'
);

select ok(
  coalesce((
    select procedure.prosrc like '%has_app_role%'
      and procedure.prosrc like '%''RELEASE''%'
      and procedure.prosrc like '%quickbooks_status <> ''NOT_CREATED''%'
      and procedure.prosrc like '%submission_status <> ''NOT_SUBMITTED''%'
      and procedure.prosrc like '%removed_storage_path%'
    from pg_proc procedure
    where procedure.oid = 'private.delete_package_release(bigint)'::regprocedure
  ), false),
  'Removal checks the role, only touches Releases of unissued, unsynced drafts and reports the Storage path'
);

select throws_ok(
  $$ select private.delete_package_release(1) $$,
  '42501',
  'You do not have permission to remove Package documents',
  'Anonymous callers cannot remove a Release'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.package_documents', 'delete')
  and not has_table_privilege('authenticated', 'valtrim.stored_files', 'delete'),
  'Browsers still cannot delete Package documents directly'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'package_documents_objects_delete'
  ),
  'Role-checked Storage deletion stays available for the removed PDF'
);

select * from finish();

rollback;
