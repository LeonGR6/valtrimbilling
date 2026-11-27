-- Email import block 3. Apply separately after reviewing the linked dry-run.
-- No Graph connector, AI calls, UI recovery or change to the manual PDF bucket.
begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('customer-service-imports','customer-service-imports',false,10000000,
  array['application/pdf','image/jpeg','image/png']::text[])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit,allowed_mime_types = excluded.allowed_mime_types;

-- Even an unrelated permissive Storage policy must not expose this bucket.
create policy customer_service_imports_server_only on storage.objects
as restrictive for all to anon,authenticated
using (bucket_id <> 'customer-service-imports')
with check (bucket_id <> 'customer-service-imports');

alter table valtrim.service_request_imports
  add column source_status text not null default 'PENDING',
  add column source_manifest jsonb;

-- Do not certify missing historical files, or block replay of an existing request.
update valtrim.service_request_imports set source_status = 'LEGACY' where request_id is not null;
alter table valtrim.service_request_imports
  add constraint service_request_imports_source_status_check check (
    source_status in ('PENDING','UPLOADING','AVAILABLE','REJECTED','LEGACY')
    and (source_status <> 'LEGACY' or request_id is not null)
    and (source_status not in ('UPLOADING','AVAILABLE') or source_manifest is not null)
    and (source_manifest is null or jsonb_typeof(source_manifest) = 'array')
  );

create table valtrim.service_request_import_files (
  import_id uuid not null references valtrim.service_request_imports(id) on delete restrict,
  attachment_id text collate "C" not null,
  file_id bigint not null references valtrim.stored_files(id) on delete restrict,
  primary key(import_id,attachment_id),
  unique(file_id)
);
alter table valtrim.service_request_import_files enable row level security;
revoke all on valtrim.service_request_import_files from public,anon,authenticated,service_role;
grant select on valtrim.service_request_import_files to authenticated,service_role;
create policy service_request_import_files_select on valtrim.service_request_import_files
for select to authenticated using ((select private.has_app_role('ADMIN','SCHEDULING')));

create function private.guard_customer_service_import_source()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if new.source_status = 'AVAILABLE' and old.source_status <> 'AVAILABLE' then
    if old.source_status <> 'UPLOADING' or new.source_manifest is null
      or jsonb_array_length(new.source_manifest) is distinct from jsonb_array_length(new.attachment_refs)
      or (select count(*) from valtrim.service_request_import_files where import_id = new.id)
        is distinct from jsonb_array_length(new.source_manifest)::bigint then
      raise exception 'Only the complete prepared file set can become available' using errcode = '55000';
    end if;
  end if;
  if old.source_manifest is not null and (
      new.source_manifest is distinct from old.source_manifest
      or new.source_payload is distinct from old.source_payload) then
    raise exception 'The pinned original email source cannot be replaced' using errcode = '55000';
  end if;
  if old.source_status in ('AVAILABLE','LEGACY') and (
      new.source_status is distinct from old.source_status
      or new.source_payload is distinct from old.source_payload
      or new.attachment_refs is distinct from old.attachment_refs) then
    raise exception 'An available or historical email source cannot be replaced' using errcode = '55000';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_customer_service_import_source()
  from public,anon,authenticated,service_role;
create trigger service_request_imports_guard_source before update on valtrim.service_request_imports
for each row execute function private.guard_customer_service_import_source();

create function private.customer_service_import_source_result(p_import_id uuid,p_replay boolean default false)
returns jsonb language sql stable set search_path = '' as $function$
  select jsonb_build_object('importId',id,'sourceStatus',source_status,'status',status,
    'requestId',request_id,'attachments',coalesce(source_manifest,'[]'::jsonb),
    'attachmentRefs',attachment_refs,'errorCode',error_code,'errorMessage',error_message,
    'idempotentReplay',p_replay)
  from valtrim.service_request_imports where id = p_import_id;
$function$;
revoke all on function private.customer_service_import_source_result(uuid,boolean)
  from public,anon,authenticated,service_role;

-- Minimal technical error only. The caller must register the provider's webLink
-- with the receipt before validation; never invent a URL from an opaque ID.
create function valtrim.reject_customer_service_import_source(
  p_import_id uuid,p_error_code text,p_error_message text
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_import valtrim.service_request_imports%rowtype;
begin
  if (select auth.uid()) is not null then
    raise exception 'Email source writes require a system context' using errcode = '42501';
  end if;
  if p_error_code is null or p_error_code not in ('ATTACHMENT_FORMAT','ATTACHMENT_COUNT',
    'ATTACHMENT_SIZE','ATTACHMENT_TOTAL_SIZE','ATTACHMENT_METADATA','ATTACHMENT_SIGNATURE','SOURCE_METADATA')
    or nullif(btrim(p_error_message),'') is null then
    raise exception 'A known rejection code and reason are required' using errcode = '22023';
  end if;
  select * into v_import from valtrim.service_request_imports where id = p_import_id for update;
  if not found then raise exception 'Email import not found' using errcode = 'P0002'; end if;
  -- A contradictory delivery cannot erase a pinned/uploaded/linked source.
  if v_import.source_status not in ('PENDING','REJECTED') or v_import.request_id is not null then
    raise exception 'This email source is already pinned; conflicting delivery requires reconciliation'
      using errcode = '55000';
  end if;
  update valtrim.service_request_imports set source_status = 'REJECTED',status = 'NEEDS_ATTENTION',
    error_code = p_error_code,error_message = left(btrim(p_error_message),1000),
    source_payload = (select coalesce(jsonb_object_agg(key,value),'{}'::jsonb)
      from jsonb_each(v_import.source_payload)
      where key in ('subject','from','webLink','sentDateTime','receivedDateTime','internetMessageId','conversationId')),
    attachment_refs = '[]',extraction_payload = null
  where id = p_import_id;
  return private.customer_service_import_source_result(p_import_id);
end;
$function$;

create function private.normalize_customer_service_import_files(p_import_id uuid,p_files jsonb)
returns jsonb language plpgsql set search_path = '' as $function$
declare
  v_file jsonb;
  v_manifest jsonb := '[]';
  v_total bigint := 0;
  v_position integer := 0;
  v_mime text;
  v_extension text;
  v_id text;
  v_ids text[] := array[]::text[];
begin
  if p_files is null or jsonb_typeof(p_files) <> 'array' then
    raise exception 'ATTACHMENT_METADATA: Attachment manifest must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_files) > 10 then
    raise exception 'ATTACHMENT_COUNT: El correo supera 10 archivos incluyendo imágenes inline' using errcode = '22023';
  end if;
  for v_file in select value from jsonb_array_elements(p_files) order by value ->> 'attachmentId' collate "C" loop
    if jsonb_typeof(v_file) <> 'object' then
      raise exception 'ATTACHMENT_METADATA: Each attachment must be an object' using errcode = '22023';
    end if;
    if (v_file - array['attachmentId','originalFilename',
      'mimeType','sizeBytes','sha256','isInline','contentId']) <> '{}'::jsonb then
      raise exception 'ATTACHMENT_METADATA: Invalid attachment fields' using errcode = '22023';
    end if;
    v_id := v_file ->> 'attachmentId';
    if jsonb_typeof(v_file -> 'attachmentId') is distinct from 'string' or nullif(btrim(v_id),'') is null
      or v_id <> btrim(v_id) or v_id = any(v_ids)
      or jsonb_typeof(v_file -> 'originalFilename') is distinct from 'string'
      or nullif(btrim(v_file ->> 'originalFilename'),'') is null
      or char_length(v_file ->> 'originalFilename') > 255
      or (v_file ->> 'originalFilename') ~ '[[:cntrl:]]'
      or jsonb_typeof(v_file -> 'isInline') is distinct from 'boolean'
      or jsonb_typeof(v_file -> 'contentId') is null
      or jsonb_typeof(v_file -> 'contentId') not in ('null','string')
      or jsonb_typeof(v_file -> 'sha256') is distinct from 'string'
      or (v_file ->> 'sha256') !~ '^[0-9a-f]{64}$' then
      raise exception 'ATTACHMENT_METADATA: Invalid attachment identity, name or checksum' using errcode = '22023';
    end if;
    v_ids := array_append(v_ids,v_id);
    v_mime := v_file ->> 'mimeType';
    if jsonb_typeof(v_file -> 'mimeType') is distinct from 'string'
      or v_mime not in ('application/pdf','image/jpeg','image/png')
      or not (lower(v_file ->> 'originalFilename') ~ case v_mime
        when 'application/pdf' then '\.pdf$' when 'image/jpeg' then '\.jpe?g$' else '\.png$' end) then
      raise exception 'ATTACHMENT_FORMAT: Solo se admiten PDF, JPG/JPEG y PNG' using errcode = '22023';
    end if;
    if jsonb_typeof(v_file -> 'sizeBytes') is distinct from 'number'
      or (v_file ->> 'sizeBytes') !~ '^[0-9]{1,8}$' then
      raise exception 'ATTACHMENT_SIZE: Invalid attachment size' using errcode = '22023';
    end if;
    if (v_file ->> 'sizeBytes')::bigint not between 1 and 10000000 then
      raise exception 'ATTACHMENT_SIZE: El archivo está vacío o supera 10 MB' using errcode = '22023';
    end if;
    v_total := v_total + (v_file ->> 'sizeBytes')::bigint;
    if v_total > 50000000 then
      raise exception 'ATTACHMENT_TOTAL_SIZE: Los adjuntos superan 50 MB por correo' using errcode = '22023';
    end if;
    v_position := v_position + 1;
    v_extension := case v_mime when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' else 'png' end;
    v_manifest := v_manifest || jsonb_build_array(v_file || jsonb_build_object('objectPath',
      format('imports/%s/%s-%s.%s',p_import_id,lpad(v_position::text,2,'0'),v_file ->> 'sha256',v_extension)));
  end loop;
  return v_manifest;
end;
$function$;
revoke all on function private.normalize_customer_service_import_files(uuid,jsonb)
  from public,anon,authenticated,service_role;

create function valtrim.prepare_customer_service_import_source(
  p_import_id uuid,p_source_payload jsonb,p_attachments jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_import valtrim.service_request_imports%rowtype;
  v_manifest jsonb;
  v_source jsonb;
  v_error text;
begin
  if (select auth.uid()) is not null then
    raise exception 'Email source writes require a system context' using errcode = '42501';
  end if;
  select * into v_import from valtrim.service_request_imports where id = p_import_id for update;
  if not found then raise exception 'Email import not found' using errcode = 'P0002'; end if;
  if v_import.source_status = 'LEGACY' or v_import.request_id is not null then
    return private.customer_service_import_source_result(p_import_id,true);
  end if;
  if v_import.source_status = 'REJECTED' then
    -- A rejected email requires the separately authorized PDF/manual recovery
    -- flow, not silent dropping/replacement of its original attachment set.
    return private.customer_service_import_source_result(p_import_id,true);
  end if;
  begin
    v_manifest := private.normalize_customer_service_import_files(p_import_id,p_attachments);
    if p_source_payload is null or jsonb_typeof(p_source_payload) <> 'object' then
      raise exception 'SOURCE_METADATA: Email source must be an object' using errcode = '22023';
    end if;
    if (p_source_payload - array['subject','from','toRecipients','ccRecipients','bccRecipients',
        'sentDateTime','receivedDateTime','internetMessageId','conversationId','webLink','body','bodyText','bodyHtml']) <> '{}'
      or jsonb_path_exists(p_source_payload,'$.**.contentBytes') then
      raise exception 'SOURCE_METADATA: Email source must contain metadata and body, never binary attachments'
        using errcode = '22023';
    end if;
    -- Attachments are generated from the authoritative manifest, never copied
    -- from a provider payload that could omit or contain base64 file bytes.
    select p_source_payload || jsonb_build_object('attachments',coalesce(jsonb_agg(jsonb_build_object(
      'id',value -> 'attachmentId','name',value -> 'originalFilename','contentType',value -> 'mimeType',
      'size',value -> 'sizeBytes','isInline',value -> 'isInline','contentId',value -> 'contentId')),'[]'::jsonb))
    into v_source from jsonb_array_elements(v_manifest);
  exception when sqlstate '22023' then
    v_error := sqlerrm;
    return valtrim.reject_customer_service_import_source(p_import_id,split_part(v_error,':',1),v_error);
  end;
  if v_import.source_manifest is not null then
    if v_import.source_manifest is distinct from v_manifest or v_import.source_payload is distinct from v_source then
      raise exception 'The pinned original email source cannot be replaced' using errcode = '55000';
    end if;
    return private.customer_service_import_source_result(p_import_id,true);
  end if;
  update valtrim.service_request_imports set source_status = 'UPLOADING',source_manifest = v_manifest,
    source_payload = v_source where id = p_import_id;
  return private.customer_service_import_source_result(p_import_id);
end;
$function$;

create function valtrim.finalize_customer_service_import_source(p_import_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_import valtrim.service_request_imports%rowtype;
  v_file jsonb;
  v_object jsonb;
  v_stored valtrim.stored_files%rowtype;
  v_refs jsonb := '[]';
begin
  if (select auth.uid()) is not null then
    raise exception 'Email source writes require a system context' using errcode = '42501';
  end if;
  select * into v_import from valtrim.service_request_imports where id = p_import_id for update;
  if not found then raise exception 'Email import not found' using errcode = 'P0002'; end if;
  if v_import.source_status in ('AVAILABLE','LEGACY') then
    return private.customer_service_import_source_result(p_import_id,true);
  end if;
  if v_import.source_status <> 'UPLOADING' then
    raise exception 'The complete source manifest must be prepared first' using errcode = '55000';
  end if;
  for v_file in select value from jsonb_array_elements(v_import.source_manifest) loop
    select metadata into v_object from storage.objects
      where bucket_id = 'customer-service-imports' and name = v_file ->> 'objectPath' for update;
    if not found then raise exception 'An import attachment has not been uploaded' using errcode = 'P0002'; end if;
    if v_object ->> 'mimetype' is distinct from v_file ->> 'mimeType'
      or v_object ->> 'size' is distinct from v_file ->> 'sizeBytes' then
      raise exception 'The uploaded attachment metadata does not match the pinned manifest' using errcode = '22023';
    end if;
    insert into valtrim.stored_files(bucket_id,object_path,original_filename,mime_type,size_bytes,sha256,uploaded_by)
    values ('customer-service-imports',v_file ->> 'objectPath',v_file ->> 'originalFilename',
      v_file ->> 'mimeType',(v_file ->> 'sizeBytes')::bigint,v_file ->> 'sha256',null)
    on conflict(bucket_id,object_path) do nothing returning * into v_stored;
    if not found then
      select * into strict v_stored from valtrim.stored_files
      where bucket_id = 'customer-service-imports' and object_path = v_file ->> 'objectPath';
      if row(v_stored.original_filename,v_stored.mime_type,v_stored.size_bytes,btrim(v_stored.sha256))
        is distinct from row(v_file ->> 'originalFilename',v_file ->> 'mimeType',
          (v_file ->> 'sizeBytes')::bigint,v_file ->> 'sha256') then
        raise exception 'An import file record cannot be replaced' using errcode = '55000';
      end if;
    end if;
    insert into valtrim.service_request_import_files(import_id,attachment_id,file_id)
      values (p_import_id,v_file ->> 'attachmentId',v_stored.id);
    v_refs := v_refs || jsonb_build_array(v_file || jsonb_build_object('fileId',v_stored.id,
      'bucketId','customer-service-imports'));
  end loop;
  -- One SQL transaction publishes all relational files/references or none.
  -- Storage itself is not transactional; interrupted immutable objects are
  -- recoverable staging, never an accepted partial source or a request.
  update valtrim.service_request_imports set source_status = 'AVAILABLE',attachment_refs = v_refs,
    status = case when error_code in ('SOURCE_STORAGE_FAILED','SOURCE_NOT_AVAILABLE') then 'PENDING' else status end,
    error_message = case when error_code in ('SOURCE_STORAGE_FAILED','SOURCE_NOT_AVAILABLE') then null else error_message end,
    error_code = case when error_code in ('SOURCE_STORAGE_FAILED','SOURCE_NOT_AVAILABLE') then null else error_code end
  where id = p_import_id;
  return private.customer_service_import_source_result(p_import_id);
end;
$function$;

create function valtrim.fail_customer_service_import_source(p_import_id uuid,p_error_message text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_import valtrim.service_request_imports%rowtype;
begin
  if (select auth.uid()) is not null then
    raise exception 'Email source writes require a system context' using errcode = '42501';
  end if;
  select * into v_import from valtrim.service_request_imports where id = p_import_id for update;
  if not found then raise exception 'Email import not found' using errcode = 'P0002'; end if;
  if v_import.source_status in ('AVAILABLE','LEGACY') or v_import.request_id is not null then
    return private.customer_service_import_source_result(p_import_id,true);
  end if;
  if v_import.source_status <> 'UPLOADING' or nullif(btrim(p_error_message),'') is null then
    raise exception 'A prepared source and failure reason are required' using errcode = '22023';
  end if;
  update valtrim.service_request_imports set status = 'NEEDS_ATTENTION',error_code = 'SOURCE_STORAGE_FAILED',
    error_message = left(btrim(p_error_message),1000) where id = p_import_id;
  return private.customer_service_import_source_result(p_import_id);
end;
$function$;

revoke all on function valtrim.reject_customer_service_import_source(uuid,text,text),
  valtrim.prepare_customer_service_import_source(uuid,jsonb,jsonb),
  valtrim.finalize_customer_service_import_source(uuid),
  valtrim.fail_customer_service_import_source(uuid,text) from public,anon,authenticated,service_role;
grant execute on function valtrim.reject_customer_service_import_source(uuid,text,text),
  valtrim.prepare_customer_service_import_source(uuid,jsonb,jsonb),
  valtrim.finalize_customer_service_import_source(uuid),
  valtrim.fail_customer_service_import_source(uuid,text) to service_role;

-- Reuse the block-2 implementation, with an explicit source gate before creation.
-- Its private normalizer/writer, human editor and approval are left unchanged.
alter function valtrim.save_customer_service_imported_request(uuid,jsonb) set schema private;
revoke all on function private.save_customer_service_imported_request(uuid,jsonb)
  from public,anon,authenticated,service_role;
create function valtrim.save_customer_service_imported_request(p_import_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_import valtrim.service_request_imports%rowtype;
begin
  if (select auth.uid()) is not null then
    raise exception 'Automatic import requires a system context without a user identity' using errcode = '42501';
  end if;
  if p_import_id is null then raise exception 'Import identity is required' using errcode = '22023'; end if;
  select * into v_import from valtrim.service_request_imports where id = p_import_id for update;
  if not found then raise exception 'Email import not found' using errcode = 'P0002'; end if;
  if v_import.request_id is not null or v_import.source_status = 'AVAILABLE' then
    return private.save_customer_service_imported_request(p_import_id,p_payload);
  end if;
  if v_import.status <> 'NEEDS_ATTENTION' then
    update valtrim.service_request_imports set status = 'NEEDS_ATTENTION',error_code = 'SOURCE_NOT_AVAILABLE',
      error_message = 'El correo y todos sus adjuntos deben validarse y almacenarse antes de crear la request.'
      where id = p_import_id;
  end if;
  return private.customer_service_import_source_result(p_import_id);
end;
$function$;
revoke all on function valtrim.save_customer_service_imported_request(uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function valtrim.save_customer_service_imported_request(uuid,jsonb) to service_role;

create function private.require_customer_service_import_source()
returns trigger language plpgsql set search_path = '' as $function$
declare v_status text;
begin
  select source_status into v_status from valtrim.service_request_imports where id = new.email_import_id for update;
  if v_status is distinct from 'AVAILABLE' then
    raise exception 'An imported request requires a complete available source' using errcode = '55000';
  end if;
  return new;
end;
$function$;
revoke all on function private.require_customer_service_import_source()
  from public,anon,authenticated,service_role;
create trigger service_requests_require_import_source before insert on valtrim.service_requests
for each row when (new.email_import_id is not null)
execute function private.require_customer_service_import_source();

-- Staff may request short-lived URLs via the authenticated Edge Function, but
-- cannot directly upload/read objects or turn an arbitrary path into a URL.
create function valtrim.get_customer_service_import_source_files(p_import_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_import valtrim.service_request_imports%rowtype;
begin
  perform private.require_customer_service_actor();
  select * into v_import from valtrim.service_request_imports where id = p_import_id;
  if not found then raise exception 'Email import not found' using errcode = 'P0002'; end if;
  if v_import.source_status <> 'AVAILABLE' then
    raise exception 'The complete email source is not available' using errcode = '55000';
  end if;
  return jsonb_build_object('importId',p_import_id,'attachments',v_import.attachment_refs);
end;
$function$;
revoke all on function valtrim.get_customer_service_import_source_files(uuid)
  from public,anon,authenticated,service_role;
grant execute on function valtrim.get_customer_service_import_source_files(uuid) to authenticated;

commit;
