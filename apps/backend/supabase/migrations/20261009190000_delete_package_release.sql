-- Phase 50: Remove a generated Release from a Package.
--
-- A Package with a generated Release (a package_documents row with a file)
-- cannot be corrected or cancelled, and phase 47 left no way to remove that
-- Release. This adds one: while the Package is still unissued and unsynced the
-- Release row and its stored_files row are deleted, and the Storage path is
-- returned so the browser can remove the PDF (the same two-step model as
-- register_package_release, since Storage objects cannot be deleted from SQL).

begin;

create or replace function private.delete_package_release(p_document_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_document valtrim.package_documents%rowtype;
  v_package record;
  v_path text;
begin
  if v_actor_id is null
     or not (select private.has_app_role(
       'ADMIN',
       'ACCOUNTING',
       'PROJECT_MANAGEMENT'
     )) then
    raise exception 'You do not have permission to remove Package documents'
      using errcode = '42501';
  end if;

  select document.*
    into v_document
  from valtrim.package_documents document
  where document.id = p_document_id
    and document.document_type = 'RELEASE';

  if not found then
    raise exception 'The Release is no longer available'
      using errcode = 'P0002';
  end if;

  select package.id, package.status, package.workflow_status,
         package.quickbooks_status, package.quickbooks_reference,
         package.submission_status, package.submitted_at,
         invoice.status as invoice_status, invoice.invoice_number,
         invoice.invoice_date, invoice.paid_amount
    into v_package
  from valtrim.draw_packages package
  join valtrim.invoices invoice on invoice.package_id = package.id
  where package.id = v_document.package_id
  for update of package;

  if v_package.id is null
     or v_package.status <> 'DRAFT'
     or v_package.workflow_status not in ('DRAFT', 'READY_TO_SUBMIT')
     or v_package.quickbooks_status <> 'NOT_CREATED'
     or v_package.quickbooks_reference is not null
     or v_package.submission_status <> 'NOT_SUBMITTED'
     or v_package.submitted_at is not null
     or v_package.invoice_status <> 'DRAFT'
     or v_package.invoice_number is not null
     or v_package.invoice_date is not null
     or v_package.paid_amount <> 0 then
    raise exception 'A Release can only be removed from an unissued, unsynced draft Package'
      using errcode = '23514';
  end if;

  select file.object_path
    into v_path
  from valtrim.stored_files file
  where file.id = v_document.file_id;

  delete from valtrim.package_documents document
  where document.id = v_document.id;

  if v_document.file_id is not null then
    delete from valtrim.stored_files file
    where file.id = v_document.file_id;
  end if;

  return jsonb_build_object(
    'document_id', v_document.id,
    'removed_storage_path', v_path
  );
end;
$$;

create or replace function valtrim.delete_package_release(p_document_id bigint)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.delete_package_release(p_document_id);
$$;

revoke execute on function private.delete_package_release(bigint)
  from public, anon, authenticated;
revoke execute on function valtrim.delete_package_release(bigint)
  from public, anon, authenticated;
grant execute on function private.delete_package_release(bigint)
  to authenticated, service_role;
grant execute on function valtrim.delete_package_release(bigint)
  to authenticated, service_role;

comment on function valtrim.delete_package_release(bigint) is
  'Removes a generated Release from an unissued, unsynced draft Package and returns the Storage path to delete. ADMIN, ACCOUNTING and PROJECT_MANAGEMENT only.';

notify pgrst, 'reload schema';

commit;
