begin;

-- The original Customer Service PDF is private and limited to one 10 MiB PDF.
-- Objects use the deterministic path requests/{request_id}/source.pdf so that
-- retries cannot create additional files for the same request.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'customer-service-sources',
  'customer-service-sources',
  false,
  10485760,
  array['application/pdf']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create function valtrim.finalize_customer_service_source_pdf_upload(
  p_request_id bigint,
  p_actor_id uuid,
  p_original_filename text,
  p_size_bytes bigint,
  p_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_source record;
  v_file valtrim.stored_files%rowtype;
  v_object_metadata jsonb;
  v_object_size_text text;
  v_object_size bigint;
  v_object_path text;
  v_original_filename text := btrim(p_original_filename);
  v_sha256 text := lower(btrim(p_sha256));
begin
  if p_request_id is null or p_request_id <= 0 then
    raise exception 'A valid Customer Service request id is required'
      using errcode = '22023';
  end if;

  if p_actor_id is null or not exists (
    select 1
    from valtrim.app_users app_user
    where app_user.id = p_actor_id
      and app_user.is_active
      and app_user.role in ('ADMIN', 'SCHEDULING')
  ) then
    raise exception 'The PDF storage operation requires an active Customer Service actor'
      using errcode = '42501';
  end if;

  if v_original_filename is null
     or v_original_filename = ''
     or char_length(v_original_filename) > 255 then
    raise exception 'The original PDF filename must contain 1 to 255 characters'
      using errcode = '22023';
  end if;

  if p_size_bytes is null
     or p_size_bytes <= 0
     or p_size_bytes > 10485760 then
    raise exception 'The source PDF must contain between 1 and 10485760 bytes'
      using errcode = '22023';
  end if;

  if v_sha256 is null or v_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'The source PDF SHA-256 must contain 64 hexadecimal characters'
      using errcode = '22023';
  end if;

  v_object_path := format('requests/%s/source.pdf', p_request_id);

  select
    source.id,
    source.source_type,
    source.file_status,
    source.file_id
  into v_source
  from valtrim.service_request_sources source
  where source.request_id = p_request_id
  for update;

  if not found then
    raise exception 'The Customer Service request does not have a source record'
      using errcode = 'P0002';
  end if;

  if v_source.source_type <> 'PDF' then
    raise exception 'The Customer Service request source is not a PDF'
      using errcode = '22023';
  end if;

  if v_source.file_status not in ('PENDING', 'FAILED', 'AVAILABLE') then
    raise exception 'The Customer Service source PDF is not in an uploadable state'
      using errcode = '55000';
  end if;

  select storage_object.metadata
  into v_object_metadata
  from storage.objects storage_object
  where storage_object.bucket_id = 'customer-service-sources'
    and storage_object.name = v_object_path
  for update;

  if not found then
    raise exception 'The uploaded Customer Service source PDF was not found'
      using errcode = 'P0002';
  end if;

  if lower(coalesce(v_object_metadata ->> 'mimetype', ''))
       <> 'application/pdf' then
    raise exception 'The uploaded Customer Service source must be application/pdf'
      using errcode = '22023';
  end if;

  v_object_size_text := v_object_metadata ->> 'size';

  if v_object_size_text is null
     or v_object_size_text !~ '^[0-9]+$'
     or char_length(v_object_size_text) > 8 then
    raise exception 'The uploaded Customer Service source has invalid size metadata'
      using errcode = '22023';
  end if;

  v_object_size := v_object_size_text::bigint;

  if v_object_size <> p_size_bytes then
    raise exception 'The uploaded Customer Service source size does not match the finalized size'
      using errcode = '22023';
  end if;

  if v_source.file_status = 'AVAILABLE' then
    select stored_file.*
    into v_file
    from valtrim.stored_files stored_file
    where stored_file.id = v_source.file_id;

    if found
       and v_file.bucket_id = 'customer-service-sources'
       and v_file.object_path = v_object_path
       and v_file.original_filename = v_original_filename
       and v_file.mime_type = 'application/pdf'
       and v_file.size_bytes = p_size_bytes
       and v_file.sha256 = v_sha256 then
      return jsonb_build_object(
        'requestId', p_request_id,
        'sourceId', v_source.id,
        'fileId', v_file.id,
        'fileStatus', 'AVAILABLE',
        'bucketId', v_file.bucket_id,
        'objectPath', v_file.object_path,
        'originalFilename', v_file.original_filename,
        'mimeType', v_file.mime_type,
        'sizeBytes', v_file.size_bytes,
        'sha256', btrim(v_file.sha256),
        'idempotentReplay', true
      );
    end if;

    raise exception 'The Customer Service source PDF is already available and cannot be replaced'
      using errcode = '55000';
  end if;

  insert into valtrim.stored_files (
    bucket_id,
    object_path,
    original_filename,
    mime_type,
    size_bytes,
    sha256,
    uploaded_by
  ) values (
    'customer-service-sources',
    v_object_path,
    v_original_filename,
    'application/pdf',
    p_size_bytes,
    v_sha256,
    p_actor_id
  )
  returning * into v_file;

  update valtrim.service_request_sources source
  set
    file_id = v_file.id,
    file_status = 'AVAILABLE',
    file_error = null,
    updated_by = p_actor_id
  where source.id = v_source.id;

  return jsonb_build_object(
    'requestId', p_request_id,
    'sourceId', v_source.id,
    'fileId', v_file.id,
    'fileStatus', 'AVAILABLE',
    'bucketId', v_file.bucket_id,
    'objectPath', v_file.object_path,
    'originalFilename', v_file.original_filename,
    'mimeType', v_file.mime_type,
    'sizeBytes', v_file.size_bytes,
    'sha256', btrim(v_file.sha256),
    'idempotentReplay', false
  );
end;
$function$;

create function valtrim.fail_customer_service_source_pdf_upload(
  p_request_id bigint,
  p_actor_id uuid,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_source record;
  v_error text := btrim(p_error);
begin
  if p_request_id is null or p_request_id <= 0 then
    raise exception 'A valid Customer Service request id is required'
      using errcode = '22023';
  end if;

  if p_actor_id is null or not exists (
    select 1
    from valtrim.app_users app_user
    where app_user.id = p_actor_id
      and app_user.is_active
      and app_user.role in ('ADMIN', 'SCHEDULING')
  ) then
    raise exception 'The PDF storage operation requires an active Customer Service actor'
      using errcode = '42501';
  end if;

  if v_error is null or v_error = '' or char_length(v_error) > 1000 then
    raise exception 'The PDF upload error must contain 1 to 1000 characters'
      using errcode = '22023';
  end if;

  select
    source.id,
    source.source_type,
    source.file_status,
    source.file_id
  into v_source
  from valtrim.service_request_sources source
  where source.request_id = p_request_id
  for update;

  if not found then
    raise exception 'The Customer Service request does not have a source record'
      using errcode = 'P0002';
  end if;

  if v_source.source_type <> 'PDF' then
    raise exception 'The Customer Service request source is not a PDF'
      using errcode = '22023';
  end if;

  if v_source.file_status = 'AVAILABLE' or v_source.file_id is not null then
    raise exception 'An available Customer Service source PDF cannot be marked as failed'
      using errcode = '55000';
  end if;

  update valtrim.service_request_sources source
  set
    file_status = 'FAILED',
    file_error = v_error,
    updated_by = p_actor_id
  where source.id = v_source.id;

  return jsonb_build_object(
    'requestId', p_request_id,
    'sourceId', v_source.id,
    'fileStatus', 'FAILED',
    'fileError', v_error
  );
end;
$function$;

create function valtrim.get_customer_service_source_pdf_object(
  p_request_id bigint,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $function$
declare
  v_source record;
  v_expected_path text;
begin
  if p_request_id is null or p_request_id <= 0 then
    raise exception 'A valid Customer Service request id is required'
      using errcode = '22023';
  end if;

  if p_actor_id is null or not exists (
    select 1
    from valtrim.app_users app_user
    where app_user.id = p_actor_id
      and app_user.is_active
      and app_user.role in ('ADMIN', 'SCHEDULING')
  ) then
    raise exception 'The PDF storage operation requires an active Customer Service actor'
      using errcode = '42501';
  end if;

  v_expected_path := format('requests/%s/source.pdf', p_request_id);

  select
    source.id as source_id,
    source.source_type,
    source.file_status,
    stored_file.id as file_id,
    stored_file.bucket_id,
    stored_file.object_path,
    stored_file.original_filename,
    stored_file.mime_type,
    stored_file.size_bytes,
    stored_file.sha256
  into v_source
  from valtrim.service_request_sources source
  left join valtrim.stored_files stored_file on stored_file.id = source.file_id
  where source.request_id = p_request_id;

  if not found then
    raise exception 'The Customer Service request does not have a source record'
      using errcode = 'P0002';
  end if;

  if v_source.source_type <> 'PDF' then
    raise exception 'The Customer Service request source is not a PDF'
      using errcode = '22023';
  end if;

  if v_source.file_status <> 'AVAILABLE' or v_source.file_id is null then
    raise exception 'The Customer Service source PDF is not available'
      using errcode = '55000';
  end if;

  if v_source.bucket_id <> 'customer-service-sources'
     or v_source.object_path <> v_expected_path
     or v_source.mime_type <> 'application/pdf' then
    raise exception 'The Customer Service source PDF storage record is inconsistent'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from storage.objects storage_object
    where storage_object.bucket_id = v_source.bucket_id
      and storage_object.name = v_source.object_path
  ) then
    raise exception 'The Customer Service source PDF object is missing'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'requestId', p_request_id,
    'sourceId', v_source.source_id,
    'fileId', v_source.file_id,
    'bucketId', v_source.bucket_id,
    'objectPath', v_source.object_path,
    'originalFilename', v_source.original_filename,
    'mimeType', v_source.mime_type,
    'sizeBytes', v_source.size_bytes,
    'sha256', btrim(v_source.sha256)
  );
end;
$function$;

revoke all on function valtrim.finalize_customer_service_source_pdf_upload(
  bigint,
  uuid,
  text,
  bigint,
  text
) from public, anon, authenticated;
grant execute on function valtrim.finalize_customer_service_source_pdf_upload(
  bigint,
  uuid,
  text,
  bigint,
  text
) to service_role;

revoke all on function valtrim.fail_customer_service_source_pdf_upload(
  bigint,
  uuid,
  text
) from public, anon, authenticated;
grant execute on function valtrim.fail_customer_service_source_pdf_upload(
  bigint,
  uuid,
  text
) to service_role;

revoke all on function valtrim.get_customer_service_source_pdf_object(
  bigint,
  uuid
) from public, anon, authenticated;
grant execute on function valtrim.get_customer_service_source_pdf_object(
  bigint,
  uuid
) to service_role;

comment on function valtrim.finalize_customer_service_source_pdf_upload(
  bigint,
  uuid,
  text,
  bigint,
  text
) is
  'Service-role-only operation that verifies an uploaded source PDF and atomically marks it AVAILABLE.';

comment on function valtrim.fail_customer_service_source_pdf_upload(
  bigint,
  uuid,
  text
) is
  'Service-role-only operation that records a source PDF upload failure.';

comment on function valtrim.get_customer_service_source_pdf_object(
  bigint,
  uuid
) is
  'Service-role-only operation that returns the private object coordinates needed to create a signed URL.';

notify pgrst, 'reload schema';

commit;
