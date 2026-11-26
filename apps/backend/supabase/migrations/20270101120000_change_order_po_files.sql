-- Extras / Change Orders, Documents (stage 1): the builders' Purchase Order PDFs, uploaded per Job.
--
-- A PDF is kept as it came; later stages read the POs inside it and link each one to an Extra / CO of
-- the Job. Here a PDF is only uploaded, opened and deleted.
--
-- Storage: private bucket 'change-order-pos', paths "<job id>/<random uuid>.pdf".
-- The same PDF (same SHA-256) cannot be uploaded twice to the same Job.
-- Reading: every active user (like Extras / COs). Uploading and deleting: ADMIN, PROJECT_MANAGEMENT and
-- SCHEDULING, the roles that work Extras / COs.

begin;

create table valtrim.change_order_po_files (
  id uuid primary key default gen_random_uuid(),
  job_id bigint not null references valtrim.jobs(id) on delete restrict,
  storage_bucket text not null default 'change-order-pos'
    check (storage_bucket = 'change-order-pos'),
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
  size_bytes bigint not null check (size_bytes between 1 and 26214400),
  content_sha256 char(64) not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid not null references valtrim.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (job_id, content_sha256)
);

create index change_order_po_files_job_created_idx
  on valtrim.change_order_po_files (job_id, created_at desc);

create index change_order_po_files_uploaded_by_idx
  on valtrim.change_order_po_files (uploaded_by);

create trigger stamp_and_validate_actor
before insert or update on valtrim.change_order_po_files
for each row execute function private.stamp_and_validate_actor();

alter table valtrim.change_order_po_files enable row level security;

revoke all on valtrim.change_order_po_files from public, anon, authenticated;

grant select (
  id,
  job_id,
  storage_bucket,
  storage_path,
  original_name,
  size_bytes,
  content_sha256,
  uploaded_by,
  created_at
) on valtrim.change_order_po_files to authenticated;

create policy change_order_po_files_select
on valtrim.change_order_po_files for select to authenticated
using ((select private.is_active_user()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('change-order-pos', 'change-order-pos', false, 26214400, array['application/pdf']::text[])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy change_order_pos_objects_select
on storage.objects for select to authenticated
using (
  bucket_id = 'change-order-pos'
  and (select private.is_active_user())
  and exists (
    select 1 from valtrim.jobs job
    where job.id::text = (storage.foldername(name))[1]
  )
);

create policy change_order_pos_objects_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'change-order-pos'
  and (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT', 'SCHEDULING'))
  and lower(right(name, 4)) = '.pdf'
  and exists (
    select 1 from valtrim.jobs job
    where job.id::text = (storage.foldername(name))[1]
      and job.is_active
  )
);

create policy change_order_pos_objects_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'change-order-pos'
  and (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT', 'SCHEDULING'))
  and exists (
    select 1 from valtrim.jobs job
    where job.id::text = (storage.foldername(name))[1]
  )
);

-- Registers a PDF after the browser uploaded it to Storage. A copy already uploaded to the Job is
-- refused (23505) and its name is in the message.
create function private.register_change_order_po_file(
  p_job_id bigint,
  p_storage_path text,
  p_original_name text,
  p_size_bytes bigint,
  p_content_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_file_id uuid;
  v_existing_name text;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT', 'SCHEDULING')) then
    raise exception 'You do not have permission to upload Purchase Orders'
      using errcode = '42501';
  end if;

  if not exists (select 1 from valtrim.jobs job where job.id = p_job_id and job.is_active) then
    raise exception 'Select an active Job'
      using errcode = '23503';
  end if;

  if p_storage_path is null
     or p_storage_path !~ (
       '^' || p_job_id::text
       || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]pdf$'
     ) then
    raise exception 'The Storage path does not match the Job'
      using errcode = '23514';
  end if;

  if p_original_name is null
     or btrim(p_original_name) = ''
     or char_length(btrim(p_original_name)) > 255
     or position('/' in p_original_name) > 0
     or position(chr(92) in p_original_name) > 0
     or lower(right(btrim(p_original_name), 4)) <> '.pdf' then
    raise exception 'Use a valid PDF file name with 255 characters or fewer'
      using errcode = '23514';
  end if;

  if p_size_bytes is null or p_size_bytes not between 1 and 26214400 then
    raise exception 'PDF files must be 25 MB or smaller'
      using errcode = '23514';
  end if;

  if p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'The PDF fingerprint is not valid'
      using errcode = '23514';
  end if;

  select file.original_name into v_existing_name
  from valtrim.change_order_po_files file
  where file.job_id = p_job_id and file.content_sha256 = p_content_sha256;

  if found then
    raise exception 'This PDF was already uploaded to this Job as %', v_existing_name
      using errcode = '23505';
  end if;

  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'change-order-pos'
      and object.name = p_storage_path
      and object.owner_id = v_actor_id::text
  ) then
    raise exception 'The uploaded PDF could not be found in private Storage'
      using errcode = '23503';
  end if;

  insert into valtrim.change_order_po_files (
    job_id, storage_path, original_name, size_bytes, content_sha256, uploaded_by
  ) values (
    p_job_id, p_storage_path, btrim(p_original_name), p_size_bytes, p_content_sha256, v_actor_id
  )
  returning id into v_file_id;

  return v_file_id;
end;
$$;

create function valtrim.register_change_order_po_file(
  p_job_id bigint,
  p_storage_path text,
  p_original_name text,
  p_size_bytes bigint,
  p_content_sha256 text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.register_change_order_po_file(
    p_job_id, p_storage_path, p_original_name, p_size_bytes, p_content_sha256
  );
$$;

-- Deletes the record once the browser removed the PDF from Storage (a PDF still there is refused, so a
-- failed removal can be tried again).
create function private.delete_change_order_po_file(p_file_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_file valtrim.change_order_po_files%rowtype;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT', 'SCHEDULING')) then
    raise exception 'You do not have permission to delete Purchase Orders'
      using errcode = '42501';
  end if;

  select file.* into v_file
  from valtrim.change_order_po_files file
  where file.id = p_file_id
  for update;

  if not found then
    raise exception 'The Purchase Order PDF is no longer available'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1 from storage.objects object
    where object.bucket_id = v_file.storage_bucket
      and object.name = v_file.storage_path
  ) then
    raise exception 'Remove the PDF from private Storage before deleting its record'
      using errcode = '55000';
  end if;

  delete from valtrim.change_order_po_files file where file.id = v_file.id;
  return v_file.id;
end;
$$;

create function valtrim.delete_change_order_po_file(p_file_id uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.delete_change_order_po_file(p_file_id);
$$;

revoke execute on function private.register_change_order_po_file(bigint, text, text, bigint, text)
  from public, anon, authenticated;
revoke execute on function valtrim.register_change_order_po_file(bigint, text, text, bigint, text)
  from public, anon, authenticated;
revoke execute on function private.delete_change_order_po_file(uuid)
  from public, anon, authenticated;
revoke execute on function valtrim.delete_change_order_po_file(uuid)
  from public, anon, authenticated;

grant execute on function private.register_change_order_po_file(bigint, text, text, bigint, text)
  to authenticated, service_role;
grant execute on function valtrim.register_change_order_po_file(bigint, text, text, bigint, text)
  to authenticated, service_role;
grant execute on function private.delete_change_order_po_file(uuid)
  to authenticated, service_role;
grant execute on function valtrim.delete_change_order_po_file(uuid)
  to authenticated, service_role;

comment on table valtrim.change_order_po_files is
  'Builder Purchase Order PDFs uploaded to a Job for its Extras / Change Orders.';
comment on function valtrim.register_change_order_po_file(bigint, text, text, bigint, text) is
  'Registers a Purchase Order PDF after its private Storage upload. ADMIN, PROJECT_MANAGEMENT and SCHEDULING only.';
comment on function valtrim.delete_change_order_po_file(uuid) is
  'Deletes a Purchase Order PDF record after its Storage object was removed. ADMIN, PROJECT_MANAGEMENT and SCHEDULING only.';

notify pgrst, 'reload schema';

commit;
