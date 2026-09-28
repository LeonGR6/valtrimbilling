-- Phase 21 follow-up: role-checked deletion for Job submission documents.
--
-- The browser removes the private Storage object first. This RPC deletes the
-- matching metadata only after PostgreSQL confirms that the object is gone.
-- A failed Storage removal therefore leaves metadata untouched and retryable.

begin;

create function private.delete_job_document(p_document_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_document valtrim.job_documents%rowtype;
begin
  if v_actor_id is null
     or not (select private.has_app_role(
       'ADMIN',
       'ACCOUNTING',
       'PROJECT_MANAGEMENT'
     )) then
    raise exception 'You do not have permission to delete Job documents'
      using errcode = '42501';
  end if;

  select document.*
    into v_document
  from valtrim.job_documents document
  where document.id = p_document_id
  for update;

  if not found then
    raise exception 'The Job document is no longer available'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from storage.objects object
    where object.bucket_id = v_document.storage_bucket
      and object.name = v_document.storage_path
  ) then
    raise exception 'Remove the PDF from private Storage before deleting its metadata'
      using errcode = '55000';
  end if;

  delete from valtrim.job_documents document
  where document.id = v_document.id;

  return v_document.id;
end;
$$;

create function valtrim.delete_job_document(p_document_id uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.delete_job_document(p_document_id);
$$;

revoke execute on function private.delete_job_document(uuid)
  from public, anon, authenticated;
revoke execute on function valtrim.delete_job_document(uuid)
  from public, anon, authenticated;

grant execute on function private.delete_job_document(uuid)
  to authenticated, service_role;
grant execute on function valtrim.delete_job_document(uuid)
  to authenticated, service_role;

comment on function valtrim.delete_job_document(uuid) is
  'Deletes Job document metadata after its private Storage object has been removed. ADMIN, ACCOUNTING and PROJECT_MANAGEMENT only.';

comment on policy job_documents_objects_delete on storage.objects is
  'ADMIN, ACCOUNTING and PROJECT_MANAGEMENT can delete Job PDFs for compensating cleanup or confirmed user deletion.';

notify pgrst, 'reload schema';

commit;
