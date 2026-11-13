-- A Preliminary Notice only counts once it was saved as filled in.
--
-- The editor already refuses to save a notice with blank required fields, but
-- the database only checked that a PRELIMINARY_NOTICE document existed, so a
-- notice saved blank (before that rule) or a PDF registered by another client
-- still unlocked Package creation.
--
-- job_documents gets an is_complete flag. The registration function takes it as
-- p_is_complete (default false): the editor sends true only when every required
-- blank has text, and any other upload of a notice stays incomplete. Documents
-- of the other types are always complete. Package creation now needs a
-- completed notice.
--
-- Notices saved before this migration are kept as complete: the database cannot
-- read them, and blocking the Jobs that already bill would be worse than the gap.

begin;

alter table valtrim.job_documents
  add column is_complete boolean not null default false;

update valtrim.job_documents set is_complete = true;

grant select (is_complete) on valtrim.job_documents to authenticated;

comment on column valtrim.job_documents.is_complete is
  'False for a Preliminary Notice saved with required blanks still empty; always true for other document types.';

drop function valtrim.register_job_document(bigint, valtrim.billing_document_type, text, text, bigint);
drop function private.register_job_document(bigint, valtrim.billing_document_type, text, text, bigint);

create function private.register_job_document(
  p_job_id bigint,
  p_document_type valtrim.billing_document_type,
  p_storage_path text,
  p_original_name text,
  p_size_bytes bigint,
  p_is_complete boolean default false
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
    uploaded_by,
    is_complete
  ) values (
    p_job_id,
    p_document_type,
    p_storage_path,
    btrim(p_original_name),
    p_size_bytes,
    v_actor_id,
    p_document_type <> 'PRELIMINARY_NOTICE' or coalesce(p_is_complete, false)
  )
  returning id into v_document_id;

  return v_document_id;
end;
$$;

revoke execute on function private.register_job_document(
  bigint, valtrim.billing_document_type, text, text, bigint, boolean
) from public, anon;
grant execute on function private.register_job_document(
  bigint, valtrim.billing_document_type, text, text, bigint, boolean
) to authenticated, service_role;

create function valtrim.register_job_document(
  p_job_id bigint,
  p_document_type valtrim.billing_document_type,
  p_storage_path text,
  p_original_name text,
  p_size_bytes bigint,
  p_is_complete boolean default false
)
returns uuid
language sql
set search_path = ''
as $$
  select private.register_job_document(
    p_job_id,
    p_document_type,
    p_storage_path,
    p_original_name,
    p_size_bytes,
    p_is_complete
  );
$$;

revoke execute on function valtrim.register_job_document(
  bigint, valtrim.billing_document_type, text, text, bigint, boolean
) from public, anon;
grant execute on function valtrim.register_job_document(
  bigint, valtrim.billing_document_type, text, text, bigint, boolean
) to authenticated, service_role;

comment on function valtrim.register_job_document(
  bigint, valtrim.billing_document_type, text, text, bigint, boolean
) is 'Registers an authenticated user-owned PDF after its private Storage upload. ADMIN, ACCOUNTING and PROJECT_MANAGEMENT only. A Preliminary Notice counts as complete only when p_is_complete is true.';

create or replace function private.require_preliminary_notice_for_package()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if exists (
    select 1
    from valtrim.job_documents document
    where document.job_id = new.job_id
      and document.document_type = 'PRELIMINARY_NOTICE'
      and document.is_complete
  ) then
    return new;
  end if;

  raise exception 'Fill in the Preliminary Notice of this Job before creating a Package'
    using errcode = '23514',
          hint = 'Open Draw & Invoice > Documents and fill in the Job''s Preliminary Notice.';
end;
$$;

comment on function private.require_preliminary_notice_for_package() is
  'Blocks a signed-in user from creating a Package for a Job that has no completed Preliminary Notice document.';

notify pgrst, 'reload schema';

commit;
