-- Phase 21: Job-scoped submission documents backed by private Supabase Storage.
--
-- A Job keeps the immutable Billing Setup version selected when it was created.
-- Required-document readiness therefore resolves through
-- jobs.billing_setup_version_id instead of the Builder's newest active setup.

begin;

create table valtrim.job_documents (
  id uuid primary key default gen_random_uuid(),
  job_id bigint not null references valtrim.jobs(id) on delete restrict,
  document_type valtrim.billing_document_type not null,
  storage_bucket text not null default 'job-documents'
    check (storage_bucket = 'job-documents'),
  storage_path text not null unique
    check (btrim(storage_path) = storage_path and storage_path <> ''),
  original_name varchar(255) not null
    check (
      btrim(original_name) = original_name
      and original_name <> ''
      and position('/' in original_name) = 0
      and position(chr(92) in original_name) = 0
      and lower(right(original_name, 4)) = '.pdf'
    ),
  mime_type varchar(100) not null default 'application/pdf'
    check (mime_type = 'application/pdf'),
  size_bytes bigint not null
    check (size_bytes between 1 and 26214400),
  uploaded_by uuid not null references valtrim.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (
    document_type in (
      'PURCHASE_ORDER',
      'PAYMENT_SCHEDULE',
      'RELEASE',
      'BACKUP'
    )
  )
);

create index job_documents_job_type_created_idx
  on valtrim.job_documents (job_id, document_type, created_at desc);

create index job_documents_uploaded_by_idx
  on valtrim.job_documents (uploaded_by);

create trigger stamp_and_validate_actor
before insert or update on valtrim.job_documents
for each row execute function private.stamp_and_validate_actor();

alter table valtrim.job_documents enable row level security;

revoke all on valtrim.job_documents from public, anon, authenticated;

grant select (
  id,
  job_id,
  document_type,
  storage_bucket,
  storage_path,
  original_name,
  mime_type,
  size_bytes,
  uploaded_by,
  created_at
) on valtrim.job_documents to authenticated;

create policy job_documents_select
on valtrim.job_documents for select to authenticated
using ((select private.is_active_user()));

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'job-documents',
  'job-documents',
  false,
  26214400,
  array['application/pdf']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Storage paths are generated as:
--   <job id>/<document folder>/<random uuid>.pdf
-- Object policies resolve the first segment back to a real Job. The private
-- bucket can never be listed or read anonymously.
create policy job_documents_objects_select
on storage.objects for select to authenticated
using (
  bucket_id = 'job-documents'
  and (select private.is_active_user())
  and exists (
    select 1
    from valtrim.jobs job
    where job.id::text = (storage.foldername(name))[1]
  )
);

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
    'backup'
  )
  and lower(right(name, 4)) = '.pdf'
  and exists (
    select 1
    from valtrim.jobs job
    where job.id::text = (storage.foldername(name))[1]
      and job.is_active
  )
);

-- DELETE is used by the frontend only as a compensating cleanup when Storage
-- succeeds but the metadata registration RPC fails. No delete UI is opened in
-- this phase.
create policy job_documents_objects_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'job-documents'
  and (select private.has_app_role(
    'ADMIN',
    'ACCOUNTING',
    'PROJECT_MANAGEMENT'
  ))
  and exists (
    select 1
    from valtrim.jobs job
    where job.id::text = (storage.foldername(name))[1]
  )
);

create function private.register_job_document(
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

create function valtrim.register_job_document(
  p_job_id bigint,
  p_document_type valtrim.billing_document_type,
  p_storage_path text,
  p_original_name text,
  p_size_bytes bigint
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.register_job_document(
    p_job_id,
    p_document_type,
    p_storage_path,
    p_original_name,
    p_size_bytes
  );
$$;

revoke execute on function private.register_job_document(
  bigint,
  valtrim.billing_document_type,
  text,
  text,
  bigint
) from public, anon, authenticated;

revoke execute on function valtrim.register_job_document(
  bigint,
  valtrim.billing_document_type,
  text,
  text,
  bigint
) from public, anon, authenticated;

grant execute on function private.register_job_document(
  bigint,
  valtrim.billing_document_type,
  text,
  text,
  bigint
) to authenticated, service_role;

grant execute on function valtrim.register_job_document(
  bigint,
  valtrim.billing_document_type,
  text,
  text,
  bigint
) to authenticated, service_role;

comment on table valtrim.job_documents is
  'Immutable metadata for private PDF submission documents uploaded for a Job.';

comment on function valtrim.register_job_document(
  bigint,
  valtrim.billing_document_type,
  text,
  text,
  bigint
) is
  'Registers an authenticated user-owned PDF after its private Storage upload. ADMIN, ACCOUNTING and PROJECT_MANAGEMENT only.';

comment on policy job_documents_select on valtrim.job_documents is
  'Active authenticated users can read Job document metadata.';

notify pgrst, 'reload schema';

commit;
