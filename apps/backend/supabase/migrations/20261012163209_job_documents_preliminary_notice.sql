-- Every Job now has a Preliminary Notice PDF to upload. It is a Job document
-- type like the others (the Builder's Billing Setup does not ask for it), so
-- the table check, the Storage insert policy and the registration function
-- learn the new type and its folder. The enum value was committed by the
-- previous migration.

begin;

do $$
declare
  v_constraint text;
begin
  select conname into v_constraint
  from pg_constraint
  where conrelid = 'valtrim.job_documents'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%PURCHASE_ORDER%';

  if v_constraint is null then
    raise exception 'The Job document type check was not found';
  end if;

  execute format('alter table valtrim.job_documents drop constraint %I', v_constraint);
end;
$$;

alter table valtrim.job_documents
  add constraint job_documents_document_type_check
  check (
    document_type in (
      'PURCHASE_ORDER',
      'PAYMENT_SCHEDULE',
      'RELEASE',
      'BACKUP',
      'PRELIMINARY_NOTICE'
    )
  );

drop policy job_documents_objects_insert on storage.objects;

create policy job_documents_objects_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'job-documents'
  and (select private.has_app_role(
    'ADMIN',
    'ACCOUNTING',
    'PROJECT_MANAGEMENT'
  ))
  and (storage.foldername(name))[2] in (
    'purchase_order',
    'payment_schedule',
    'release',
    'backup',
    'preliminary_notice'
  )
  and lower(right(name, 4)) = '.pdf'
  and exists (
    select 1
    from valtrim.jobs job
    where job.id::text = (storage.foldername(name))[1]
      and job.is_active
  )
);

create or replace function private.register_job_document(
  p_job_id bigint,
  p_document_type valtrim.billing_document_type,
  p_storage_path text,
  p_original_name text,
  p_size_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_document_id uuid;
  v_storage_folder text;
begin
  if v_actor_id is null
     or not (select private.has_app_role(
       'ADMIN',
       'ACCOUNTING',
       'PROJECT_MANAGEMENT'
     )) then
    raise exception 'You do not have permission to upload Job documents'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from valtrim.jobs job
    where job.id = p_job_id
      and job.is_active
  ) then
    raise exception 'Select an active Job'
      using errcode = '23503';
  end if;

  v_storage_folder := case p_document_type
    when 'PURCHASE_ORDER' then 'purchase_order'
    when 'PAYMENT_SCHEDULE' then 'payment_schedule'
    when 'RELEASE' then 'release'
    when 'BACKUP' then 'backup'
    when 'PRELIMINARY_NOTICE' then 'preliminary_notice'
    else null
  end;

  if v_storage_folder is null then
    raise exception 'Select a supported Job document type'
      using errcode = '23514';
  end if;

  if p_storage_path is null
     or p_storage_path !~ (
       '^'
       || p_job_id::text
       || '/'
       || v_storage_folder
       || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]pdf$'
     ) then
    raise exception 'The Storage path does not match the Job and document type'
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

  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'job-documents'
      and object.name = p_storage_path
      and object.owner_id = v_actor_id::text
  ) then
    raise exception 'The uploaded PDF could not be found in private Storage'
      using errcode = '23503';
  end if;

  insert into valtrim.job_documents (
    job_id,
    document_type,
    storage_path,
    original_name,
    size_bytes,
    uploaded_by
  ) values (
    p_job_id,
    p_document_type,
    p_storage_path,
    btrim(p_original_name),
    p_size_bytes,
    v_actor_id
  )
  returning id into v_document_id;

  return v_document_id;
end;
$$;

notify pgrst, 'reload schema';

commit;
