-- Phase 56: Generated Payment Schedules saved as Package documents.
--
-- A confirmed Payment Schedule template (phase 54) is highlighted for a Package
-- and the result is kept as a Package document, the same model as a generated
-- Release (phase 47): a private PDF in Storage, one row in stored_files and one
-- in package_documents. A Package keeps ONE Payment Schedule document, because
-- package_documents allows one row per fixed document type; a Package that
-- touches several schedules gets them merged into that one PDF.
--
-- The builder's Billing Setup may already require a Payment Schedule for every
-- Package, which creates a MISSING package_documents row when the Package is
-- made. Generating completes that row instead of adding another, and removing
-- the generated file puts a required row back to MISSING instead of deleting it.
--
-- A completed document with a file already blocks correcting or deleting its
-- Package (phase 14), so a generated Payment Schedule protects the Package lines
-- it highlights in the same way a Release does.

begin;

-- Package documents are written to <package id>/<kind>/<uuid>.pdf. Releases use
-- "release"; Payment Schedules use "payment_schedule".
drop policy package_documents_objects_insert on storage.objects;

create policy package_documents_objects_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'package-documents'
  and (select private.has_app_role(
    'ADMIN',
    'ACCOUNTING',
    'PROJECT_MANAGEMENT'
  ))
  and (storage.foldername(name))[2] in ('release', 'payment_schedule')
  and lower(right(name, 4)) = '.pdf'
  and exists (
    select 1
    from valtrim.draw_packages package
    where package.id::text = (storage.foldername(name))[1]
  )
);

-- Registers a highlighted Payment Schedule the browser already uploaded to
-- private Storage. Generating again replaces the file, and the previous object
-- path is returned so the browser can remove it.
create function private.register_package_payment_schedule(
  p_package_id bigint,
  p_storage_path text,
  p_original_name text,
  p_size_bytes bigint,
  p_sha256 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_package valtrim.draw_packages%rowtype;
  v_document_id bigint;
  v_old_file_id bigint;
  v_old_path text;
  v_file_id bigint;
begin
  if v_actor_id is null
     or not (select private.has_app_role(
       'ADMIN',
       'ACCOUNTING',
       'PROJECT_MANAGEMENT'
     )) then
    raise exception 'You do not have permission to save Package documents'
      using errcode = '42501';
  end if;

  select package.*
    into v_package
  from valtrim.draw_packages package
  where package.id = p_package_id;

  if not found then
    raise exception 'The Package is no longer available'
      using errcode = '23503';
  end if;

  if not exists (
    select 1
    from valtrim.payment_schedule_templates template
    where template.job_id = v_package.job_id
      and template.status = 'confirmed'
  ) then
    raise exception 'The Job has no confirmed Payment Schedule'
      using errcode = '23514';
  end if;

  if p_storage_path is null
     or p_storage_path !~ (
       '^'
       || p_package_id::text
       || '/payment_schedule/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]pdf$'
     ) then
    raise exception 'The Storage path does not match the Package'
      using errcode = '23514';
  end if;

  if p_original_name is null
     or btrim(p_original_name) = ''
     or char_length(p_original_name) > 255
     or position('/' in p_original_name) > 0
     or position(chr(92) in p_original_name) > 0
     or lower(right(p_original_name, 4)) <> '.pdf' then
    raise exception 'Use a valid PDF file name with 255 characters or fewer'
      using errcode = '23514';
  end if;

  if p_size_bytes is null or p_size_bytes not between 1 and 26214400 then
    raise exception 'PDF files must be 25 MB or smaller'
      using errcode = '23514';
  end if;

  if p_sha256 is not null and p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'The file checksum is not valid'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'package-documents'
      and object.name = p_storage_path
      and object.owner_id = v_actor_id::text
  ) then
    raise exception 'The uploaded PDF could not be found in private Storage'
      using errcode = '23503';
  end if;

  select document.id, document.file_id, file.object_path
    into v_document_id, v_old_file_id, v_old_path
  from valtrim.package_documents document
  left join valtrim.stored_files file on file.id = document.file_id
  where document.package_id = p_package_id
    and document.document_type = 'PAYMENT_SCHEDULE'
  for update of document;

  insert into valtrim.stored_files (
    bucket_id,
    object_path,
    original_filename,
    mime_type,
    size_bytes,
    sha256,
    uploaded_by
  ) values (
    'package-documents',
    p_storage_path,
    btrim(p_original_name),
    'application/pdf',
    p_size_bytes,
    p_sha256,
    v_actor_id
  )
  returning id into v_file_id;

  if v_document_id is null then
    insert into valtrim.package_documents (
      package_id,
      document_type,
      label,
      is_required,
      status,
      file_id,
      completed_at,
      completed_by
    ) values (
      p_package_id,
      'PAYMENT_SCHEDULE',
      'Payment Schedule',
      false,
      'COMPLETE',
      v_file_id,
      now(),
      v_actor_id
    )
    returning id into v_document_id;
  else
    update valtrim.package_documents document
    set status = 'COMPLETE',
        file_id = v_file_id,
        completed_at = now(),
        completed_by = v_actor_id,
        updated_at = now()
    where document.id = v_document_id;

    if v_old_file_id is not null then
      delete from valtrim.stored_files file
      where file.id = v_old_file_id;
    end if;
  end if;

  return jsonb_build_object(
    'document_id', v_document_id,
    'replaced_storage_path', v_old_path
  );
end;
$$;

create function valtrim.register_package_payment_schedule(
  p_package_id bigint,
  p_storage_path text,
  p_original_name text,
  p_size_bytes bigint,
  p_sha256 text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.register_package_payment_schedule(
    p_package_id,
    p_storage_path,
    p_original_name,
    p_size_bytes,
    p_sha256
  );
$$;

-- Removes a generated Payment Schedule from an unissued, unsynced draft Package,
-- under the same rule as removing a Release. A document the Builder's setup
-- requires goes back to MISSING; any other row is deleted. The Storage path is
-- returned so the browser can remove the PDF (Storage objects cannot be deleted
-- from SQL).
create function private.delete_package_payment_schedule(p_document_id bigint)
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
    and document.document_type = 'PAYMENT_SCHEDULE';

  if not found then
    raise exception 'The Payment Schedule is no longer available'
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
    raise exception 'A Payment Schedule can only be removed from an unissued, unsynced draft Package'
      using errcode = '23514';
  end if;

  select file.object_path
    into v_path
  from valtrim.stored_files file
  where file.id = v_document.file_id;

  if v_document.is_required then
    update valtrim.package_documents document
    set status = 'MISSING',
        file_id = null,
        completed_at = null,
        completed_by = null,
        updated_at = now()
    where document.id = v_document.id;
  else
    delete from valtrim.package_documents document
    where document.id = v_document.id;
  end if;

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

create function valtrim.delete_package_payment_schedule(p_document_id bigint)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.delete_package_payment_schedule(p_document_id);
$$;

revoke execute on function private.register_package_payment_schedule(
  bigint, text, text, bigint, text
) from public, anon, authenticated;
revoke execute on function valtrim.register_package_payment_schedule(
  bigint, text, text, bigint, text
) from public, anon, authenticated;
revoke execute on function private.delete_package_payment_schedule(bigint)
  from public, anon, authenticated;
revoke execute on function valtrim.delete_package_payment_schedule(bigint)
  from public, anon, authenticated;

grant execute on function private.register_package_payment_schedule(
  bigint, text, text, bigint, text
) to authenticated, service_role;
grant execute on function valtrim.register_package_payment_schedule(
  bigint, text, text, bigint, text
) to authenticated, service_role;
grant execute on function private.delete_package_payment_schedule(bigint)
  to authenticated, service_role;
grant execute on function valtrim.delete_package_payment_schedule(bigint)
  to authenticated, service_role;

comment on function valtrim.register_package_payment_schedule(
  bigint, text, text, bigint, text
) is
  'Registers a highlighted Payment Schedule uploaded to private Storage as the Package document, replacing the previous one. ADMIN, ACCOUNTING and PROJECT_MANAGEMENT only.';
comment on function valtrim.delete_package_payment_schedule(bigint) is
  'Removes a generated Payment Schedule from an unissued, unsynced draft Package and returns the Storage path to delete; a required document goes back to MISSING. ADMIN, ACCOUNTING and PROJECT_MANAGEMENT only.';

notify pgrst, 'reload schema';

commit;
