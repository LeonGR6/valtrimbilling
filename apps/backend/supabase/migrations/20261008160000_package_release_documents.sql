-- Phase 47: Generated Releases saved as Package documents.
--
-- A Release template (phase 44) is filled for a Package and the result is kept
-- as a Package document: a private PDF in Storage, one row in stored_files and
-- one in package_documents. Both tables already existed but were closed (no
-- grants, no policies), so this phase opens them for reading and keeps every
-- write behind a role-checked RPC, the same model as Job documents.
--
-- It also adds the read RPC that resolves the values a Release needs for a
-- Package: the cut-off date from the Builder's setup and the invoice net amount.

begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'package-documents',
  'package-documents',
  false,
  26214400,
  array['application/pdf']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Storage paths are generated as:
--   <package id>/release/<random uuid>.pdf
create policy package_documents_objects_select
on storage.objects for select to authenticated
using (
  bucket_id = 'package-documents'
  and (select private.is_active_user())
  and exists (
    select 1
    from valtrim.draw_packages package
    where package.id::text = (storage.foldername(name))[1]
  )
);

create policy package_documents_objects_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'package-documents'
  and (select private.has_app_role(
    'ADMIN',
    'ACCOUNTING',
    'PROJECT_MANAGEMENT'
  ))
  and (storage.foldername(name))[2] = 'release'
  and lower(right(name, 4)) = '.pdf'
  and exists (
    select 1
    from valtrim.draw_packages package
    where package.id::text = (storage.foldername(name))[1]
  )
);

-- Used to replace a regenerated Release and to clean up a failed registration.
create policy package_documents_objects_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'package-documents'
  and (select private.has_app_role(
    'ADMIN',
    'ACCOUNTING',
    'PROJECT_MANAGEMENT'
  ))
  and exists (
    select 1
    from valtrim.draw_packages package
    where package.id::text = (storage.foldername(name))[1]
  )
);

-- Reading follows every other Package table: any active user. Writes are not
-- granted; they happen through register_package_release.
revoke all on valtrim.stored_files from public, anon, authenticated;
revoke all on valtrim.package_documents from public, anon, authenticated;
grant select on valtrim.stored_files to authenticated;
grant select on valtrim.package_documents to authenticated;

create policy stored_files_select
on valtrim.stored_files for select to authenticated
using ((select private.is_active_user()));

create policy package_documents_select
on valtrim.package_documents for select to authenticated
using ((select private.is_active_user()));

create function private.release_type_label(p_release_type valtrim.release_type)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_release_type
    when 'ConditionalWaiverAndReleaseOnProgressPayment'
      then 'Conditional Waiver and Release on Progress Payment'
    when 'ConditionalWaiverAndReleaseOnFinalPayment'
      then 'Conditional Waiver and Release on Final Payment'
    when 'UnconditionalWaiverAndReleaseOnProgressPayment'
      then 'Unconditional Waiver and Release on Progress Payment'
    when 'UnconditionalWaiverAndReleaseOnFinalPayment'
      then 'Unconditional Waiver and Release on Final Payment'
  end;
$$;

-- Values a Release needs for a Package. The cut-off date is the first cut-off
-- of the Builder's setup on or after the Package date; a setup that bills on
-- any date has none, and the Package date is used. The amount is the invoice
-- net amount (gross minus retention and wrap).
create function private.get_package_release_values(p_package_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_package record;
  v_invoice record;
  v_cutoff date;
begin
  if (select auth.uid()) is null or not (select private.is_active_user()) then
    raise exception 'You do not have permission to read Package values'
      using errcode = '42501';
  end if;

  select package.id,
         package.job_id,
         package.package_number,
         package.package_date,
         package.setup_version_id
    into v_package
  from valtrim.draw_packages package
  where package.id = p_package_id;

  if not found then
    raise exception 'The Package is no longer available'
      using errcode = 'P0002';
  end if;

  v_cutoff := private.resolve_billing_cutoff_date(
    v_package.package_date,
    v_package.setup_version_id
  );

  select invoice.invoice_number,
         invoice.gross_amount,
         invoice.retention_amount,
         invoice.wrap_amount,
         invoice.net_amount
    into v_invoice
  from valtrim.invoices invoice
  where invoice.package_id = p_package_id;

  return jsonb_build_object(
    'package_id', v_package.id,
    'job_id', v_package.job_id,
    'package_number', v_package.package_number,
    'package_date', v_package.package_date,
    'cutoff_date', coalesce(v_cutoff, v_package.package_date),
    'cutoff_source', case
      when v_cutoff is null then 'package_date'
      else 'builder_setup'
    end,
    'invoice_number', v_invoice.invoice_number,
    'gross_amount', v_invoice.gross_amount,
    'retention_amount', v_invoice.retention_amount,
    'wrap_amount', v_invoice.wrap_amount,
    'net_amount', v_invoice.net_amount
  );
end;
$$;

create function valtrim.get_package_release_values(p_package_id bigint)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_package_release_values(p_package_id);
$$;

-- Registers a filled Release the browser already uploaded to private Storage.
-- A Package keeps one Release per type: generating it again replaces the file,
-- and the previous object path is returned so the browser can remove it.
create function private.register_package_release(
  p_package_id bigint,
  p_release_type valtrim.release_type,
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
  v_label text;
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

  if p_release_type is null then
    raise exception 'Select the Release type'
      using errcode = '23514';
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
    from valtrim.release_templates template
    where template.job_id = v_package.job_id
      and template.release_type = p_release_type
      and template.status = 'confirmed'
  ) then
    raise exception 'The Job has no confirmed template for this Release type'
      using errcode = '23514';
  end if;

  if p_storage_path is null
     or p_storage_path !~ (
       '^'
       || p_package_id::text
       || '/release/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]pdf$'
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

  v_label := private.release_type_label(p_release_type);

  select document.id, document.file_id, file.object_path
    into v_document_id, v_old_file_id, v_old_path
  from valtrim.package_documents document
  left join valtrim.stored_files file on file.id = document.file_id
  where document.package_id = p_package_id
    and document.document_type = 'RELEASE'
    and document.label = v_label
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
      'RELEASE',
      v_label,
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

    delete from valtrim.stored_files file
    where file.id = v_old_file_id;
  end if;

  return jsonb_build_object(
    'document_id', v_document_id,
    'replaced_storage_path', v_old_path
  );
end;
$$;

create function valtrim.register_package_release(
  p_package_id bigint,
  p_release_type valtrim.release_type,
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
  select private.register_package_release(
    p_package_id,
    p_release_type,
    p_storage_path,
    p_original_name,
    p_size_bytes,
    p_sha256
  );
$$;

revoke execute on function private.release_type_label(valtrim.release_type)
  from public, anon, authenticated;
revoke execute on function private.get_package_release_values(bigint)
  from public, anon, authenticated;
revoke execute on function valtrim.get_package_release_values(bigint)
  from public, anon, authenticated;
revoke execute on function private.register_package_release(
  bigint, valtrim.release_type, text, text, bigint, text
) from public, anon, authenticated;
revoke execute on function valtrim.register_package_release(
  bigint, valtrim.release_type, text, text, bigint, text
) from public, anon, authenticated;

grant execute on function private.release_type_label(valtrim.release_type)
  to authenticated, service_role;
grant execute on function private.get_package_release_values(bigint)
  to authenticated, service_role;
grant execute on function valtrim.get_package_release_values(bigint)
  to authenticated, service_role;
grant execute on function private.register_package_release(
  bigint, valtrim.release_type, text, text, bigint, text
) to authenticated, service_role;
grant execute on function valtrim.register_package_release(
  bigint, valtrim.release_type, text, text, bigint, text
) to authenticated, service_role;

comment on function valtrim.get_package_release_values(bigint) is
  'Values a Release needs for a Package: the cut-off date (Package date when the Builder bills on any date) and the invoice net amount. Active users only.';
comment on function valtrim.register_package_release(
  bigint, valtrim.release_type, text, text, bigint, text
) is
  'Registers a filled Release uploaded to private Storage as a Package document, replacing the previous Release of the same type. ADMIN, ACCOUNTING and PROJECT_MANAGEMENT only.';
comment on policy package_documents_select on valtrim.package_documents is
  'Active authenticated users can read Package documents; writes go through register_package_release.';

notify pgrst, 'reload schema';

commit;
