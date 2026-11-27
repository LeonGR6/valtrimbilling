-- Voiding a Package's QuickBooks invoice, and keeping QuickBooks' own PDF of it
-- as the Package's INVOICE document.
--
-- * void_quickbooks_invoice_sync marks the Package's invoice as voided after the
--   Edge Function voided it in QuickBooks. The Package can then be cancelled
--   (deleted as a draft); a voided invoice is kept in QuickBooks with its number.
-- * register_quickbooks_invoice_pdf stores the PDF the Edge Function downloaded
--   from QuickBooks. Unlike Releases and Payment Schedules, which the browser
--   uploads, this one is uploaded by the service role, so it is service-only.
-- * Four checks let nothing through once a Package had touched QuickBooks. They
--   now accept a Package whose invoice was voided, so its Release and Payment
--   Schedule can be removed and the draft cancelled (deleted). Editing and moving
--   cells still require that QuickBooks was never touched.
--
-- The UPDATEs and DELETEs filter on keys because pg_safeupdate, loaded for the
-- API roles, rejects them without a WHERE clause.

begin;

alter table valtrim.quickbooks_invoice_syncs
  drop constraint quickbooks_invoice_syncs_status_check;

alter table valtrim.quickbooks_invoice_syncs
  add constraint quickbooks_invoice_syncs_status_check
    check (status in ('CREATING', 'CREATED', 'FAILED', 'VOIDED'));

alter table valtrim.quickbooks_invoice_syncs
  add column voided_at timestamptz,
  add column voided_by uuid references valtrim.app_users(id) on delete set null;

-- Returns {voided, already, removed_storage_path}. The path is the saved invoice
-- PDF, which the caller must delete from Storage (SQL cannot).
create function valtrim.void_quickbooks_invoice_sync(
  p_package_id bigint,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package record;
  v_old_file_id bigint;
  v_old_path text;
begin
  select package.status,
         package.quickbooks_status,
         package.workflow_status,
         package.submission_status,
         package.submitted_at,
         invoice.paid_amount
    into v_package
  from valtrim.draw_packages package
  join valtrim.invoices invoice on invoice.package_id = package.id
  where package.id = p_package_id
  for update of package;

  if not found then
    raise exception 'The Package no longer exists' using errcode = 'P0002';
  end if;

  -- Voiding twice is harmless: the second call just reports it.
  if v_package.quickbooks_status = 'VOIDED' then
    return jsonb_build_object('voided', true, 'already', true, 'removed_storage_path', null);
  end if;

  if v_package.quickbooks_status <> 'CREATED' then
    raise exception 'Only a Package with a QuickBooks invoice can have it voided'
      using errcode = '23514';
  end if;

  if v_package.status <> 'DRAFT'
     or v_package.workflow_status not in ('DRAFT', 'READY_TO_SUBMIT')
     or v_package.submission_status <> 'NOT_SUBMITTED'
     or v_package.submitted_at is not null
     or v_package.paid_amount <> 0
     or exists (
       select 1
       from valtrim.invoice_payments payment
       join valtrim.invoices invoice on invoice.id = payment.invoice_id
       where invoice.package_id = p_package_id
     ) then
    raise exception 'Only an unpaid Package that was not submitted can have its invoice voided'
      using errcode = '23514';
  end if;

  update valtrim.quickbooks_invoice_syncs sync
  set status = 'VOIDED',
      voided_at = now(),
      voided_by = p_user_id
  where sync.package_id = p_package_id
    and sync.status = 'CREATED';

  if not found then
    raise exception 'The Package has no created QuickBooks invoice to void'
      using errcode = '55000';
  end if;

  update valtrim.draw_packages package
  set quickbooks_status = 'VOIDED',
      updated_by = p_user_id
  where package.id = p_package_id;

  -- The saved PDF shows an invoice that no longer stands.
  select document.file_id, file.object_path
    into v_old_file_id, v_old_path
  from valtrim.package_documents document
  left join valtrim.stored_files file on file.id = document.file_id
  where document.package_id = p_package_id
    and document.document_type = 'INVOICE'
  for update of document;

  if found then
    delete from valtrim.package_documents document
    where document.package_id = p_package_id
      and document.document_type = 'INVOICE';

    if v_old_file_id is not null then
      delete from valtrim.stored_files file
      where file.id = v_old_file_id;
    end if;
  end if;

  return jsonb_build_object('voided', true, 'already', false, 'removed_storage_path', v_old_path);
end;
$$;

-- Returns {document_id, replaced_storage_path}; the caller deletes the replaced
-- file from Storage.
create function valtrim.register_quickbooks_invoice_pdf(
  p_package_id bigint,
  p_user_id uuid,
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
  v_quickbooks_status valtrim.quickbooks_status;
  v_document_id bigint;
  v_old_file_id bigint;
  v_old_path text;
  v_file_id bigint;
begin
  select package.quickbooks_status
    into v_quickbooks_status
  from valtrim.draw_packages package
  where package.id = p_package_id;

  if not found then
    raise exception 'The Package is no longer available' using errcode = '23503';
  end if;

  if v_quickbooks_status <> 'CREATED' then
    raise exception 'The Package has no QuickBooks invoice to save'
      using errcode = '23514';
  end if;

  if p_storage_path is null
     or p_storage_path !~ (
       '^'
       || p_package_id::text
       || '/invoice/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]pdf$'
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
  ) then
    raise exception 'The uploaded PDF could not be found in private Storage'
      using errcode = '23503';
  end if;

  select document.id, document.file_id, file.object_path
    into v_document_id, v_old_file_id, v_old_path
  from valtrim.package_documents document
  left join valtrim.stored_files file on file.id = document.file_id
  where document.package_id = p_package_id
    and document.document_type = 'INVOICE'
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
    p_user_id
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
      'INVOICE',
      'Invoice',
      false,
      'COMPLETE',
      v_file_id,
      now(),
      p_user_id
    )
    returning id into v_document_id;
  else
    update valtrim.package_documents document
    set status = 'COMPLETE',
        file_id = v_file_id,
        completed_at = now(),
        completed_by = p_user_id,
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

revoke all on function valtrim.void_quickbooks_invoice_sync(bigint, uuid)
  from public, anon, authenticated;
revoke all on function valtrim.register_quickbooks_invoice_pdf(
  bigint, uuid, text, text, bigint, text
) from public, anon, authenticated;
grant execute on function valtrim.void_quickbooks_invoice_sync(bigint, uuid)
  to service_role;
grant execute on function valtrim.register_quickbooks_invoice_pdf(
  bigint, uuid, text, text, bigint, text
) to service_role;

comment on function valtrim.void_quickbooks_invoice_sync(bigint, uuid) is
  'Service-role-only: records that the Package''s QuickBooks invoice was voided and drops its saved PDF.';
comment on function valtrim.register_quickbooks_invoice_pdf(
  bigint, uuid, text, text, bigint, text
) is
  'Service-role-only: saves the PDF downloaded from QuickBooks as the Package INVOICE document.';

-- The checks are patched in place, so every other rule they carry stays exactly
-- as it is. A patch that no longer matches fails the migration instead of
-- silently doing nothing.
do $migration$
declare
  v_patch record;
  v_definition text;
  v_updated text;
begin
  for v_patch in
    select *
    from (values
      (
        'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,text)',
        E'     or v_target.quickbooks_status <> \'NOT_CREATED\'\n     or v_target.quickbooks_reference is not null\n',
        E'     or (\n       (v_target.quickbooks_status <> \'NOT_CREATED\' or v_target.quickbooks_reference is not null)\n       and not (p_action = \'CANCEL\' and v_target.quickbooks_status = \'VOIDED\')\n     )\n'
      ),
      (
        'private.delete_package_release(bigint)',
        E'     or v_package.quickbooks_status <> \'NOT_CREATED\'\n     or v_package.quickbooks_reference is not null\n',
        E'     or (\n       (v_package.quickbooks_status <> \'NOT_CREATED\' or v_package.quickbooks_reference is not null)\n       and v_package.quickbooks_status <> \'VOIDED\'\n     )\n'
      ),
      (
        'private.delete_package_payment_schedule(bigint)',
        E'     or v_package.quickbooks_status <> \'NOT_CREATED\'\n     or v_package.quickbooks_reference is not null\n',
        E'     or (\n       (v_package.quickbooks_status <> \'NOT_CREATED\' or v_package.quickbooks_reference is not null)\n       and v_package.quickbooks_status <> \'VOIDED\'\n     )\n'
      ),
      (
        'valtrim.reject_package_line_change()',
        E'         and package.quickbooks_status = \'NOT_CREATED\'\n         and package.quickbooks_reference is null\n',
        E'         and (\n           (package.quickbooks_status = \'NOT_CREATED\' and package.quickbooks_reference is null)\n           or package.quickbooks_status = \'VOIDED\'\n         )\n'
      )
    ) as patch(signature, old_text, new_text)
  loop
    select pg_get_functiondef(v_patch.signature::regprocedure) into v_definition;
    v_updated := replace(v_definition, v_patch.old_text, v_patch.new_text);

    if v_updated = v_definition then
      raise exception 'The definition of % did not match the expected text', v_patch.signature;
    end if;

    execute v_updated;
  end loop;
end;
$migration$;

notify pgrst, 'reload schema';

commit;
