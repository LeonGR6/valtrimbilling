-- Images without retention, block 1: database contract only.
-- V1 remains the deployed runtime contract. V2 requires explicit Graph prepare
-- and a V2-capable worker claim; installing this SQL does not activate it.
begin;

alter table valtrim.service_request_imports
  add column source_contract_version integer not null default 1,
  add column source_connection_id uuid references private.customer_service_email_connections(id) on delete restrict,
  add constraint service_request_imports_source_contract_check check (
    (source_contract_version = 1 and source_connection_id is null)
    or (source_contract_version = 2 and source_connection_id is not null and source_manifest is not null)
  );

-- Reject binary transport fields and image data URIs before they can enter any
-- V2 snapshot, report, checkpoint or diagnostic. Text is never silently cut.
-- Typed/allowlisted source records below complement this recursive check.
create function private.customer_service_import_has_binary(p_value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $function$
declare v_key text; v_value jsonb; v_text text;
begin
  if p_value is null then return false; end if;
  if jsonb_typeof(p_value) = 'object' then
    for v_key,v_value in select key,value from jsonb_each(p_value) loop
      if lower(replace(v_key,'_','')) in
        ('contentbytes','imageurl','base64','imagebase64','bytes','binary','buffer','arraybuffer','blob')
        or private.customer_service_import_has_binary(v_value) then return true; end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_value in select value from jsonb_array_elements(p_value) loop
      if private.customer_service_import_has_binary(v_value) then return true; end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'string' then
    v_text := p_value #>> '{}';
    return v_text ~* 'data:[^,[:space:]]*;base64[[:space:]]*,'
      or v_text ~ '(^|[^A-Za-z0-9+/])(iVBORw0KGgo|/9j/)[A-Za-z0-9+/]{32,}={0,2}';
  end if;
  return false;
end;
$function$;
revoke all on function private.customer_service_import_has_binary(jsonb) from public,anon,authenticated,service_role;

create function private.normalize_customer_service_import_files_v2(p_import_id uuid,p_files jsonb)
returns jsonb language plpgsql set search_path = '' as $function$
declare v_files jsonb;
begin
  -- Reuse ALL existing metadata, count and decimal-byte limits. No caller may
  -- supply retention flags, paths or file IDs. Signature/hash calculation stays
  -- in the server downloader, as in V1; SQL cannot inspect an unretained binary.
  if private.customer_service_import_has_binary(p_files) then
    raise exception 'ATTACHMENT_METADATA: Binary attachment payloads are forbidden' using errcode = '22023';
  end if;
  v_files := private.normalize_customer_service_import_files(p_import_id,p_files);
  return (select coalesce(jsonb_agg(case when file ->> 'mimeType' = 'application/pdf'
    then file || '{"retention":"STORED"}'::jsonb
    else (file - 'objectPath') || '{"retention":"GRAPH_ONLY"}'::jsonb end order by position),'[]'::jsonb)
    from jsonb_array_elements(v_files) with ordinality files(file,position));
end;
$function$;
revoke all on function private.normalize_customer_service_import_files_v2(uuid,jsonb) from public,anon,authenticated,service_role;

create function private.validate_customer_service_email_payload_v2(p_source jsonb)
returns void language plpgsql set search_path = '' as $function$
declare v_key text; v_value jsonb; v_recipient jsonb;
begin
  if p_source is null or jsonb_typeof(p_source) <> 'object'
    or p_source - array['subject','from','toRecipients','ccRecipients','bccRecipients','sentDateTime',
      'receivedDateTime','internetMessageId','conversationId','webLink','body','bodyText','bodyHtml'] <> '{}'
    or private.customer_service_import_has_binary(p_source) then
    raise exception 'SOURCE_METADATA: V2 sources must contain metadata and text without binary images' using errcode = '22023';
  end if;
  for v_key,v_value in select key,value from jsonb_each(p_source) loop
    if v_key = 'body' then
      if jsonb_typeof(v_value) <> 'object' or v_value - array['contentType','content'] <> '{}'
        or coalesce(v_value ->> 'contentType','') not in ('text','html')
        or jsonb_typeof(v_value -> 'content') is distinct from 'string' then
        raise exception 'SOURCE_METADATA: Invalid V2 email body' using errcode = '22023';
      end if;
    elsif v_key in ('from','toRecipients','ccRecipients','bccRecipients') then
      if v_key <> 'from' and jsonb_typeof(v_value) <> 'array' then
        raise exception 'SOURCE_METADATA: Invalid V2 email recipients' using errcode = '22023';
      end if;
      for v_recipient in select value from jsonb_array_elements(case when v_key = 'from' then jsonb_build_array(v_value) else v_value end) loop
        if jsonb_typeof(v_recipient) in ('string','null') then continue; end if;
        if jsonb_typeof(v_recipient) <> 'object' or v_recipient - 'emailAddress' <> '{}'
          or jsonb_typeof(v_recipient -> 'emailAddress') is distinct from 'object' then
          raise exception 'SOURCE_METADATA: Invalid V2 email address' using errcode = '22023';
        end if;
        if (v_recipient -> 'emailAddress') - array['name','address'] <> '{}'
          or exists(select 1 from jsonb_each(v_recipient -> 'emailAddress') where jsonb_typeof(value) not in ('string','null')) then
          raise exception 'SOURCE_METADATA: Invalid V2 email address' using errcode = '22023';
        end if;
      end loop;
    elsif jsonb_typeof(v_value) not in ('string','null') then
      raise exception 'SOURCE_METADATA: V2 header and body fields must be text' using errcode = '22023';
    end if;
  end loop;
end;
$function$;
revoke all on function private.validate_customer_service_email_payload_v2(jsonb) from public,anon,authenticated,service_role;

create function private.validate_customer_service_import_source_v2(p_import_id uuid,p_source jsonb)
returns void language plpgsql set search_path = '' as $function$
declare v_import valtrim.service_request_imports%rowtype; v_file jsonb;
begin
  select * into strict v_import from valtrim.service_request_imports where id = p_import_id;
  if p_source is null or jsonb_typeof(p_source) <> 'object'
    or p_source - array['sourceId','kind','attachmentId','fileId','filename','sha256','status','model',
      'structuredData','text','pages','formFields','part','usageInfo','error'] <> '{}'
    or not (p_source ?& array['sourceId','kind','attachmentId','fileId','status','structuredData','error'])
    or jsonb_typeof(p_source -> 'sourceId') is distinct from 'string'
    or nullif(p_source ->> 'sourceId','') is null
    or coalesce(p_source ->> 'kind','') not in ('EMAIL','IMAGE','PDF','PDF_FIELDS')
    or coalesce(p_source ->> 'status','') not in ('ANALYZED','FAILED')
    or (p_source ->> 'status' = 'ANALYZED' and
      (jsonb_typeof(p_source -> 'structuredData') is distinct from 'object' or p_source -> 'error' is distinct from 'null'::jsonb))
    or (p_source ->> 'status' = 'FAILED' and
      (p_source -> 'structuredData' is distinct from 'null'::jsonb or jsonb_typeof(p_source -> 'error') is distinct from 'object'
        or jsonb_typeof(p_source #> '{error,code}') is distinct from 'string'
        or jsonb_typeof(p_source #> '{error,message}') is distinct from 'string'))
    or (p_source ? 'text' and jsonb_typeof(p_source -> 'text') not in ('null','string'))
    or (p_source ? 'pages' and jsonb_typeof(p_source -> 'pages') <> 'array')
    or (p_source ? 'formFields' and jsonb_typeof(p_source -> 'formFields') <> 'array')
    or private.customer_service_import_has_binary(p_source) then
    raise exception 'Invalid V2 source analysis; only extracted facts and metadata are allowed' using errcode = '22023';
  end if;
  if p_source -> 'usageInfo' is not null and p_source -> 'usageInfo' <> 'null'::jsonb then
    if jsonb_typeof(p_source -> 'usageInfo') <> 'object' then
      raise exception 'V2 usage information must contain known numeric counters only' using errcode = '22023';
    end if;
    if exists(select 1 from jsonb_each(p_source -> 'usageInfo') where key not in
      ('prompt_tokens','completion_tokens','total_tokens','pages_processed','doc_size_bytes')
      or jsonb_typeof(value) <> 'number' or value::text !~ '^[0-9]+$') then
      raise exception 'V2 usage information must contain known numeric counters only' using errcode = '22023';
    end if;
  end if;
  if p_source -> 'part' is not null and p_source -> 'part' <> 'null'::jsonb then
    if jsonb_typeof(p_source -> 'part') <> 'object'
      or (p_source -> 'part') - array['start','end'] <> '{}'
      or jsonb_typeof(p_source #> '{part,start}') is distinct from 'number'
      or jsonb_typeof(p_source #> '{part,end}') is distinct from 'number'
      or (p_source #>> '{part,start}') !~ '^[0-9]+$' or (p_source #>> '{part,end}') !~ '^[0-9]+$' then
      raise exception 'V2 text offsets must be integer positions' using errcode = '22023';
    end if;
    if (p_source #>> '{part,start}')::numeric > (p_source #>> '{part,end}')::numeric then
      raise exception 'V2 text offsets must be integer positions' using errcode = '22023';
    end if;
  end if;
  if p_source ->> 'status' = 'FAILED' then
    if (p_source -> 'error') - array['code','message','retryable','providerStatus','diagnosticCode','validationPath'] <> '{}'
      or exists(select 1 from jsonb_each(p_source -> 'error') where
        (key in ('code','message','diagnosticCode','validationPath') and jsonb_typeof(value) <> 'string')
        or (key = 'retryable' and jsonb_typeof(value) <> 'boolean')
        or (key = 'providerStatus' and (jsonb_typeof(value) <> 'number' or value::text !~ '^[1-5][0-9]{2}$'))) then
      raise exception 'V2 errors must contain known diagnostic fields only' using errcode = '22023';
    end if;
  end if;
  if p_source ->> 'kind' = 'EMAIL' then
    if p_source -> 'attachmentId' is distinct from 'null'::jsonb or p_source -> 'fileId' is distinct from 'null'::jsonb
      or p_source ->> 'sourceId' not like 'email:%' then
      raise exception 'Email checkpoint cannot impersonate a file' using errcode = '22023';
    end if;
    return;
  end if;
  select file into v_file from jsonb_array_elements(v_import.source_manifest) file
    where file ->> 'attachmentId' = p_source ->> 'attachmentId' collate "C";
  if v_file is null or v_file ->> 'sha256' is distinct from p_source ->> 'sha256'
    or v_file ->> 'originalFilename' is distinct from p_source ->> 'filename'
    or (p_source ->> 'kind' in ('PDF','IMAGE')
      and p_source ->> 'sourceId' is distinct from 'attachment:' || (v_file ->> 'attachmentId'))
    or (p_source ->> 'kind' = 'PDF_FIELDS'
      and left(p_source ->> 'sourceId',char_length('attachment:' || (v_file ->> 'attachmentId') || ':fields:'))
        is distinct from 'attachment:' || (v_file ->> 'attachmentId') || ':fields:') then
    raise exception 'V2 analysis must match the pinned attachment identity and checksum' using errcode = '22023';
  end if;
  if v_file ->> 'retention' = 'GRAPH_ONLY' then
    if p_source ->> 'kind' <> 'IMAGE' or p_source -> 'fileId' is distinct from 'null'::jsonb
      or coalesce(p_source -> 'pages','[]'::jsonb) <> '[]'::jsonb
      or coalesce(p_source -> 'formFields','[]'::jsonb) <> '[]'::jsonb then
      raise exception 'Unretained images have no stored file, PDF pages or form fields' using errcode = '22023';
    end if;
  elsif p_source ->> 'kind' not in ('PDF','PDF_FIELDS') or not exists(
    select 1 from jsonb_array_elements(v_import.attachment_refs) file
      where file ->> 'attachmentId' = p_source ->> 'attachmentId'
        and file ->> 'fileId' = p_source ->> 'fileId' and file ->> 'sha256' = p_source ->> 'sha256') then
    raise exception 'PDF analysis requires its original stored file' using errcode = '22023';
  end if;
end;
$function$;
revoke all on function private.validate_customer_service_import_source_v2(uuid,jsonb) from public,anon,authenticated,service_role;

-- This guard also protects direct service-role updates, not only RPC callers.
create or replace function private.guard_customer_service_import_source()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_expected bigint; v_connection private.customer_service_email_connections%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.source_contract_version <> 1 or new.source_connection_id is not null then
      raise exception 'V2 sources must be registered first and prepared through the Graph RPC' using errcode = '55000';
    end if;
    return new;
  end if;
  if old.source_manifest is not null or old.source_status in ('AVAILABLE','LEGACY') then
    if row(new.source_contract_version,new.source_connection_id) is distinct from
      row(old.source_contract_version,old.source_connection_id) then
      raise exception 'A pinned source contract and Graph connection cannot be replaced' using errcode = '55000';
    end if;
  end if;
  if new.source_contract_version = 2 then
    select * into v_connection from private.customer_service_email_connections where id = new.source_connection_id;
    if not found or new.tenant_id is distinct from v_connection.tenant_id
      or new.mailbox_id is distinct from v_connection.mailbox_id::text then
      raise exception 'The import does not belong to this connection mailbox' using errcode = '42501';
    end if;
    if private.customer_service_import_has_binary(jsonb_build_object('source',new.source_payload,
      'manifest',new.source_manifest,'refs',new.attachment_refs,'analysis',new.analysis_payload,
      'checkpoint',new.worker_checkpoint,'extraction',new.extraction_payload,'error',new.error_message)) then
      raise exception 'Binary image content is forbidden in V2 import records' using errcode = '22023';
    end if;
    perform private.validate_customer_service_email_payload_v2(new.source_payload - 'attachments');
    if new.source_manifest is distinct from private.normalize_customer_service_import_files_v2(new.id,
      (select coalesce(jsonb_agg(file - array['objectPath','retention']),'[]'::jsonb)
        from jsonb_array_elements(new.source_manifest) file)) then
      raise exception 'V2 source descriptors must match their validated retention contract' using errcode = '22023';
    end if;
  end if;
  if new.source_status = 'AVAILABLE' and old.source_status <> 'AVAILABLE' then
    select count(*) into v_expected from jsonb_array_elements(new.source_manifest) file
      where new.source_contract_version = 1 or file ->> 'retention' = 'STORED';
    if old.source_status <> 'UPLOADING' or new.source_manifest is null
      or v_expected is distinct from jsonb_array_length(new.attachment_refs)::bigint
      or (select count(*) from valtrim.service_request_import_files where import_id = new.id) is distinct from v_expected then
      raise exception 'Only the complete prepared file set can become available' using errcode = '55000';
    end if;
  end if;
  if old.source_manifest is not null and (new.source_manifest is distinct from old.source_manifest
    or new.source_payload is distinct from old.source_payload) then
    raise exception 'The pinned original email source cannot be replaced' using errcode = '55000';
  end if;
  if old.source_status in ('AVAILABLE','LEGACY') and (new.source_status is distinct from old.source_status
    or new.source_payload is distinct from old.source_payload or new.attachment_refs is distinct from old.attachment_refs) then
    raise exception 'An available or historical email source cannot be replaced' using errcode = '55000';
  end if;
  return new;
end;
$function$;
create trigger service_request_imports_guard_source_insert before insert on valtrim.service_request_imports
  for each row execute function private.guard_customer_service_import_source();

create function valtrim.prepare_customer_service_graph_source_v2(
  p_connection_id uuid,p_sync_token uuid,p_expected_revision bigint,
  p_import_id uuid,p_source_payload jsonb,p_attachments jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_connection private.customer_service_email_connections%rowtype;
  v_import valtrim.service_request_imports%rowtype; v_manifest jsonb; v_source jsonb;
begin
  v_connection := private.lock_customer_service_email_sync(p_connection_id,p_sync_token,p_expected_revision);
  if v_connection.initialized_at is null then
    raise exception 'Initialize the connection before preparing a V2 source' using errcode = '55000';
  end if;
  select * into v_import from valtrim.service_request_imports where id = p_import_id for update;
  if not found then raise exception 'Email import not found' using errcode = 'P0002'; end if;
  if v_import.tenant_id is distinct from v_connection.tenant_id or v_import.mailbox_id is distinct from v_connection.mailbox_id::text then
    raise exception 'The import does not belong to this connection mailbox' using errcode = '42501';
  end if;
  if v_import.request_id is not null or v_import.source_status = 'LEGACY' then
    return private.customer_service_import_source_result(p_import_id,true);
  end if;
  if v_import.source_status = 'REJECTED' then
    -- Keep explicit human/size-correction recovery separate. V2 is not a new
    -- authorization to reopen rejections or reinterpret already pinned V1 data.
    return private.customer_service_import_source_result(p_import_id,true);
  end if;
  if (v_import.source_manifest is not null and v_import.source_contract_version <> 2)
    or (v_import.source_connection_id is not null and v_import.source_connection_id <> p_connection_id) then
    raise exception 'A pinned source contract and Graph connection cannot be replaced' using errcode = '55000';
  end if;
  if v_import.worker_token is not null then
    raise exception 'The import has an active processing reservation' using errcode = '55000';
  end if;
  if v_import.source_manifest is null and (v_import.attachment_refs <> '[]'::jsonb
    or v_import.analysis_payload is not null or v_import.extraction_payload is not null
    or v_import.worker_checkpoint -> 'sources' <> '[]'::jsonb
    or exists(select 1 from valtrim.service_request_import_files where import_id = p_import_id)) then
    raise exception 'V2 preparation cannot reinterpret existing files or extraction' using errcode = '55000';
  end if;
  v_manifest := private.normalize_customer_service_import_files_v2(p_import_id,p_attachments);
  perform private.validate_customer_service_email_payload_v2(p_source_payload);
  select p_source_payload || jsonb_build_object('attachments',coalesce(jsonb_agg(jsonb_build_object(
    'id',file -> 'attachmentId','name',file -> 'originalFilename','contentType',file -> 'mimeType',
    'size',file -> 'sizeBytes','isInline',file -> 'isInline','contentId',file -> 'contentId')),'[]'::jsonb))
    into v_source from jsonb_array_elements(v_manifest) file;
  if v_import.source_manifest is not null then
    if v_import.source_manifest is distinct from v_manifest or v_import.source_payload is distinct from v_source then
      raise exception 'The pinned original email source cannot be replaced' using errcode = '55000';
    end if;
    return private.customer_service_import_source_result(p_import_id,true) || jsonb_build_object('sourceContractVersion',2);
  end if;
  update valtrim.service_request_imports set source_contract_version = 2,source_connection_id = p_connection_id,
    source_status = 'UPLOADING',source_manifest = v_manifest,source_payload = v_source where id = p_import_id;
  return private.customer_service_import_source_result(p_import_id) || jsonb_build_object('sourceContractVersion',2);
end;
$function$;
revoke all on function valtrim.prepare_customer_service_graph_source_v2(uuid,uuid,bigint,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function valtrim.prepare_customer_service_graph_source_v2(uuid,uuid,bigint,uuid,jsonb,jsonb) to service_role;

create function private.guard_customer_service_v2_file_link()
returns trigger language plpgsql set search_path = '' as $function$
declare v_import valtrim.service_request_imports%rowtype; v_file valtrim.stored_files%rowtype;
begin
  select * into v_import from valtrim.service_request_imports where id = new.import_id for update;
  if v_import.source_contract_version = 2 then
    select * into v_file from valtrim.stored_files where id = new.file_id;
    if not exists(select 1 from jsonb_array_elements(v_import.source_manifest) file
      where file ->> 'attachmentId' = new.attachment_id collate "C" and file ->> 'retention' = 'STORED'
        and file ->> 'mimeType' = 'application/pdf' and v_file.mime_type = 'application/pdf'
        and v_file.bucket_id = 'customer-service-imports' and file ->> 'objectPath' = v_file.object_path
        and file ->> 'sha256' = btrim(v_file.sha256) and (file ->> 'sizeBytes')::bigint = v_file.size_bytes
        and file ->> 'originalFilename' = v_file.original_filename) then
      raise exception 'V2 import file links are restricted to the pinned PDFs' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_customer_service_v2_file_link() from public,anon,authenticated,service_role;
create trigger service_request_import_files_guard_v2 before insert or update on valtrim.service_request_import_files
  for each row execute function private.guard_customer_service_v2_file_link();

create function private.guard_customer_service_v2_stored_file()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if new.bucket_id = 'customer-service-imports' and exists(select 1 from valtrim.service_request_imports i
    where i.source_contract_version = 2 and left(new.object_path,char_length('imports/' || i.id || '/')) = 'imports/' || i.id || '/')
    and new.mime_type <> 'application/pdf' then
    raise exception 'V2 images cannot be registered as stored files' using errcode = '22023';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_customer_service_v2_stored_file() from public,anon,authenticated,service_role;
create trigger stored_files_guard_customer_service_v2 before insert or update on valtrim.stored_files
  for each row execute function private.guard_customer_service_v2_stored_file();

-- The compatible finalizer, checkpoint, analysis validator and claim definitions
-- follow below. V1 signatures and response shapes remain supported.

create or replace function valtrim.finalize_customer_service_import_source(p_import_id uuid)
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
  for v_file in select value from jsonb_array_elements(v_import.source_manifest)
    where v_import.source_contract_version = 1 or value ->> 'retention' = 'STORED' loop
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

create or replace function valtrim.checkpoint_customer_service_email_worker(p_import_id uuid,p_worker_token uuid,p_source jsonb)
returns void language plpgsql security definer set search_path = '' as $function$
declare v_import valtrim.service_request_imports%rowtype;
begin
  perform private.lock_customer_service_email_worker(p_import_id,p_worker_token);
  select * into v_import from valtrim.service_request_imports where id = p_import_id;
  if p_source is null or jsonb_typeof(p_source) <> 'object' or nullif(p_source ->> 'sourceId','') is null
    or p_source ->> 'status' is null or p_source ->> 'status' not in ('ANALYZED','FAILED')
    or p_source ->> 'kind' is null or p_source ->> 'kind' not in ('EMAIL','PDF','PDF_FIELDS','IMAGE')
    or (p_source ->> 'status' = 'ANALYZED' and (jsonb_typeof(p_source -> 'structuredData') is distinct from 'object' or p_source -> 'error' is distinct from 'null'::jsonb))
    or (p_source ->> 'status' = 'FAILED' and (p_source -> 'structuredData' is distinct from 'null'::jsonb
      or jsonb_typeof(p_source -> 'error') is distinct from 'object'
      or jsonb_typeof(p_source #> '{error,code}') is distinct from 'string'
      or jsonb_typeof(p_source #> '{error,message}') is distinct from 'string'))
    or jsonb_path_exists(p_source,'$.**.contentBytes') or jsonb_path_exists(p_source,'$.**.image_url') then
    raise exception 'Invalid source checkpoint' using errcode = '22023';
  end if;
  if v_import.source_contract_version = 2 then
    perform private.validate_customer_service_import_source_v2(p_import_id,p_source);
  elsif p_source ->> 'kind' = 'EMAIL' then
    if p_source ->> 'attachmentId' is not null or p_source ->> 'fileId' is not null then
      raise exception 'Email checkpoint cannot impersonate a file' using errcode = '22023';
    end if;
  elsif not exists(select 1 from jsonb_array_elements(v_import.attachment_refs) file
    where file ->> 'attachmentId' = p_source ->> 'attachmentId' and file ->> 'fileId' = p_source ->> 'fileId'
      and file ->> 'sha256' = p_source ->> 'sha256' and file ->> 'originalFilename' = p_source ->> 'filename'
      and ((file ->> 'mimeType' = 'application/pdf' and p_source ->> 'kind' in ('PDF','PDF_FIELDS'))
        or (file ->> 'mimeType' in ('image/png','image/jpeg') and p_source ->> 'kind' = 'IMAGE'))) then
    raise exception 'Checkpoint must refer to an original accepted file' using errcode = '22023';
  end if;
  update valtrim.service_request_imports set worker_checkpoint = jsonb_build_object('schemaVersion','1.0','sources',
    coalesce((select jsonb_agg(value) from jsonb_array_elements(worker_checkpoint -> 'sources')
      where value ->> 'sourceId' <> p_source ->> 'sourceId'),'[]') || jsonb_build_array(p_source)),
    worker_lease_expires_at = clock_timestamp() + interval '3 minutes' where id = p_import_id;
end;
$function$;

create or replace function private.record_customer_service_import_analysis(p_import_id uuid,p_report jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_import valtrim.service_request_imports%rowtype;
  v_source jsonb;
  v_outcome text;
  v_failed boolean;
begin
  if (select auth.uid()) is not null then
    raise exception 'Automatic analysis requires a system context without a user identity' using errcode = '42501';
  end if;
  if p_import_id is null then raise exception 'Import identity is required' using errcode = '22023'; end if;
  select * into v_import from valtrim.service_request_imports where id = p_import_id for update;
  if not found then raise exception 'Email import not found' using errcode = 'P0002'; end if;
  if v_import.request_id is not null then
    return jsonb_build_object('importId',p_import_id,'requestId',v_import.request_id,'idempotentReplay',true,
      'analysisPayload',v_import.analysis_payload);
  end if;
  if v_import.source_status <> 'AVAILABLE' then
    raise exception 'The complete email source must be available before analysis' using errcode = '55000';
  end if;
  if p_report is null or jsonb_typeof(p_report) <> 'object' then
    raise exception 'Analysis report must be an object' using errcode = '22023';
  end if;
  if p_report - array['schemaVersion','importId','outcome','sources','structuredData','provenance','conflicts',
    'excludedItemIndexes','warnings','issues','intakePayload'] <> '{}'
    or p_report ->> 'schemaVersion' is distinct from '1.0'
    or p_report ->> 'importId' is distinct from p_import_id::text
    or jsonb_typeof(p_report -> 'outcome') is distinct from 'string'
    or p_report ->> 'outcome' not in ('READY_FOR_INTAKE','NEEDS_ATTENTION')
    or jsonb_typeof(p_report -> 'sources') is distinct from 'array'
    or jsonb_typeof(p_report -> 'structuredData') is distinct from 'object'
    or jsonb_typeof(p_report -> 'provenance') is distinct from 'object'
    or jsonb_typeof(p_report -> 'conflicts') is distinct from 'array'
    or jsonb_typeof(p_report -> 'excludedItemIndexes') is distinct from 'array'
    or jsonb_typeof(p_report -> 'warnings') is distinct from 'array'
    or jsonb_typeof(p_report -> 'issues') is distinct from 'array'
    or jsonb_path_exists(p_report,'$.**.contentBytes')
    or jsonb_path_exists(p_report,'$.**.image_url') then
    raise exception 'Analysis report has an invalid schema or identity' using errcode = '22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_report -> 'sources') source
    where jsonb_typeof(source) <> 'object' or jsonb_typeof(source -> 'sourceId') is distinct from 'string'
      or nullif(btrim(source ->> 'sourceId'),'') is null)
    or (select count(*) from jsonb_array_elements(p_report -> 'sources')) <>
      (select count(distinct source ->> 'sourceId') from jsonb_array_elements(p_report -> 'sources') source) then
    raise exception 'Analysis source identities must be unique and nonempty' using errcode = '22023';
  end if;
  for v_source in select value from jsonb_array_elements(p_report -> 'sources') loop
    if v_source ->> 'status' is null or v_source ->> 'status' not in ('ANALYZED','FAILED')
      or v_source ->> 'kind' is null or v_source ->> 'kind' not in ('EMAIL','PDF','PDF_FIELDS','IMAGE') then
      raise exception 'Analysis source status or kind is invalid' using errcode = '22023';
    end if;
    if v_import.source_contract_version = 2 then
      perform private.validate_customer_service_import_source_v2(p_import_id,v_source);
    elsif v_source ->> 'kind' = 'EMAIL' then
      if v_source ->> 'attachmentId' is not null or v_source ->> 'fileId' is not null then
        raise exception 'Email text cannot impersonate a file source' using errcode = '22023';
      end if;
    elsif not exists (select 1 from jsonb_array_elements(v_import.attachment_refs) file
      where file ->> 'attachmentId' = v_source ->> 'attachmentId'
        and file ->> 'fileId' = v_source ->> 'fileId'
        and file ->> 'sha256' = v_source ->> 'sha256'
        and file ->> 'originalFilename' = v_source ->> 'filename'
        and ((file ->> 'mimeType' = 'application/pdf' and v_source ->> 'kind' in ('PDF','PDF_FIELDS'))
          or (file ->> 'mimeType' in ('image/jpeg','image/png') and v_source ->> 'kind' = 'IMAGE'))) then
      raise exception 'Analysis must refer to the original accepted files' using errcode = '22023';
    end if;
  end loop;
  -- Every original attachment needs its main analysis, not merely form fields
  -- from a PDF whose OCR failed or was silently omitted.
  if exists(select 1 from jsonb_array_elements(case when v_import.source_contract_version = 2 then v_import.source_manifest
    else v_import.attachment_refs end) file where not exists(
    select 1 from jsonb_array_elements(p_report -> 'sources') source
      where source ->> 'attachmentId' = file ->> 'attachmentId'
        and source ->> 'kind' in ('PDF','IMAGE'))) then
    raise exception 'The analysis must account for every original attachment' using errcode = '22023';
  end if;
  v_outcome := p_report ->> 'outcome';
  select exists(select 1 from jsonb_array_elements(p_report -> 'sources') source where source ->> 'status' = 'FAILED') into v_failed;
  if v_outcome = 'READY_FOR_INTAKE' then
    if v_failed or jsonb_array_length(p_report -> 'issues') > 0
      or jsonb_array_length(p_report -> 'sources') = 0 then
      raise exception 'A failed or empty analysis cannot be ready for intake' using errcode = '22023';
    end if;
    -- Reuse the existing business validator; this operation does NOT call its
    -- writer and does not allocate a request, folio, property or human approval.
    perform private.normalize_customer_service_import_intake(p_report -> 'intakePayload');
  elsif jsonb_typeof(p_report -> 'intakePayload') is distinct from 'null'
    or jsonb_array_length(p_report -> 'issues') = 0 then
    raise exception 'A problem analysis must retain issues and no intake payload' using errcode = '22023';
  end if;
  if v_import.analysis_payload = p_report then
    return jsonb_build_object('importId',p_import_id,'requestId',null,'idempotentReplay',true,'analysisPayload',v_import.analysis_payload);
  end if;
  update valtrim.service_request_imports set analysis_payload = p_report,analysis_created_at = clock_timestamp(),
    status = case when v_outcome = 'NEEDS_ATTENTION' then 'NEEDS_ATTENTION'::valtrim.service_request_import_status
      when error_code in ('ANALYSIS_FAILED','ANALYSIS_INCOMPLETE') then 'PENDING'::valtrim.service_request_import_status else status end,
    error_code = case when v_outcome = 'NEEDS_ATTENTION' then case when v_failed then 'ANALYSIS_FAILED' else 'ANALYSIS_INCOMPLETE' end
      when error_code in ('ANALYSIS_FAILED','ANALYSIS_INCOMPLETE') then null else error_code end,
    error_message = case when v_outcome = 'NEEDS_ATTENTION' then 'No se pudo preparar una request automática. Revisa los detalles del análisis y el correo original.'
      when error_code in ('ANALYSIS_FAILED','ANALYSIS_INCOMPLETE') then null else error_message end
  where id = p_import_id;
  return jsonb_build_object('importId',p_import_id,'requestId',null,'idempotentReplay',false,'analysisPayload',p_report);
end;
$function$;

-- The installed worker still uses the V1 signature. It cannot consume V2 data.
create or replace function valtrim.claim_customer_service_email_import(p_import_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_import valtrim.service_request_imports%rowtype; v_failures integer; v_token uuid;
begin
  if (select auth.uid()) is not null then
    raise exception 'Email worker requires a system context' using errcode = '42501';
  end if;
  -- Read-only replay after a lost commit response; never reopen the request.
  if p_import_id is not null then
    select * into v_import from valtrim.service_request_imports where id = p_import_id;
    if v_import.request_id is not null then
      return jsonb_build_object('importId',v_import.id,'requestId',v_import.request_id,'status','PROCESSED','idempotentReplay',true);
    end if;
  end if;
  loop
    select * into v_import from valtrim.service_request_imports
      where source_contract_version = 1 and request_id is null and source_status = 'AVAILABLE'
        and (p_import_id is null or id = p_import_id)
        and ((worker_token is null and status = 'PENDING' and (next_attempt_at is null or next_attempt_at <= clock_timestamp()))
          or (worker_token is not null and worker_lease_expires_at <= clock_timestamp())
          or (worker_token is null and status = 'PROCESSING' and processing_started_at < clock_timestamp() - interval '3 minutes'))
      order by coalesce(next_attempt_at,created_at),created_at,id
      limit 1 for update skip locked;
    if not found then return null; end if;
    v_failures := v_import.worker_failure_count + case when v_import.status = 'PROCESSING' or v_import.worker_token is not null then 1 else 0 end;
    if v_failures >= 3 then
      update valtrim.service_request_imports set status = 'NEEDS_ATTENTION',worker_failure_count = v_failures,
        worker_token = null,worker_lease_expires_at = null,next_attempt_at = null,
        error_code = 'WORKER_RETRIES_EXHAUSTED',error_message = 'El procesamiento se interrumpió repetidamente. Requiere revisión o reintento autorizado.'
        where id = v_import.id;
      continue;
    end if;
    v_token := gen_random_uuid();
    update valtrim.service_request_imports set status = 'PROCESSING',worker_token = v_token,
      worker_lease_expires_at = clock_timestamp() + interval '3 minutes',worker_failure_count = v_failures,
      attempt_count = attempt_count + 1,last_attempt_at = clock_timestamp(),processing_started_at = clock_timestamp(),
      next_attempt_at = null,error_code = null,error_message = null where id = v_import.id;
    return jsonb_build_object('importId',v_import.id,'requestId',null,'workerToken',v_token,
      'checkpoint',v_import.worker_checkpoint,'status','PROCESSING','idempotentReplay',false);
  end loop;
end;
$function$;

-- Future worker explicitly opts into a contract it knows how to read. Existing
-- V1 work remains eligible, and linked-request replays still precede all work.
create function valtrim.claim_customer_service_email_import_v2(p_import_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_import valtrim.service_request_imports%rowtype; v_failures integer; v_token uuid;
begin
  if (select auth.uid()) is not null then
    raise exception 'Email worker requires a system context' using errcode = '42501';
  end if;
  -- Read-only replay after a lost commit response; never reopen the request.
  if p_import_id is not null then
    select * into v_import from valtrim.service_request_imports where id = p_import_id;
    if v_import.request_id is not null then
      return jsonb_build_object('importId',v_import.id,'requestId',v_import.request_id,'status','PROCESSED','idempotentReplay',true);
    end if;
  end if;
  loop
    select * into v_import from valtrim.service_request_imports
      where request_id is null and source_status = 'AVAILABLE'
        and (p_import_id is null or id = p_import_id)
        and ((worker_token is null and status = 'PENDING' and (next_attempt_at is null or next_attempt_at <= clock_timestamp()))
          or (worker_token is not null and worker_lease_expires_at <= clock_timestamp())
          or (worker_token is null and status = 'PROCESSING' and processing_started_at < clock_timestamp() - interval '3 minutes'))
      order by coalesce(next_attempt_at,created_at),created_at,id
      limit 1 for update skip locked;
    if not found then return null; end if;
    v_failures := v_import.worker_failure_count + case when v_import.status = 'PROCESSING' or v_import.worker_token is not null then 1 else 0 end;
    if v_failures >= 3 then
      update valtrim.service_request_imports set status = 'NEEDS_ATTENTION',worker_failure_count = v_failures,
        worker_token = null,worker_lease_expires_at = null,next_attempt_at = null,
        error_code = 'WORKER_RETRIES_EXHAUSTED',error_message = 'El procesamiento se interrumpió repetidamente. Requiere revisión o reintento autorizado.'
        where id = v_import.id;
      continue;
    end if;
    v_token := gen_random_uuid();
    update valtrim.service_request_imports set status = 'PROCESSING',worker_token = v_token,
      worker_lease_expires_at = clock_timestamp() + interval '3 minutes',worker_failure_count = v_failures,
      attempt_count = attempt_count + 1,last_attempt_at = clock_timestamp(),processing_started_at = clock_timestamp(),
      next_attempt_at = null,error_code = null,error_message = null where id = v_import.id;
    return jsonb_build_object('importId',v_import.id,'requestId',null,'workerToken',v_token,
      'checkpoint',v_import.worker_checkpoint,'status','PROCESSING','idempotentReplay',false);
  end loop;
end;
$function$;
revoke all on function valtrim.claim_customer_service_email_import_v2(uuid) from public,anon,authenticated,service_role;
grant execute on function valtrim.claim_customer_service_email_import_v2(uuid) to service_role;

-- Resolve only the connection pinned by the connector, under the worker's own
-- lease. Reading images does not claim/advance/reset the Graph delta cursor.
create function valtrim.read_customer_service_graph_image_source(p_import_id uuid,p_worker_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_import valtrim.service_request_imports%rowtype;
  v_connection private.customer_service_email_connections%rowtype;
begin
  perform private.lock_customer_service_email_worker(p_import_id,p_worker_token);
  select * into strict v_import from valtrim.service_request_imports where id = p_import_id;
  if v_import.source_contract_version <> 2 or v_import.source_status <> 'AVAILABLE' then
    raise exception 'A complete V2 source is required for Graph image recovery' using errcode = '55000';
  end if;
  select * into v_connection from private.customer_service_email_connections where id = v_import.source_connection_id;
  if not found or not v_connection.enabled or v_connection.initialized_at is null
    or v_connection.tenant_id is distinct from v_import.tenant_id or v_connection.mailbox_id::text is distinct from v_import.mailbox_id then
    raise exception 'The original Graph connection is unavailable' using errcode = '55000';
  end if;
  return jsonb_build_object('importId',v_import.id,'connectionId',v_connection.id,
    'tenantId',v_connection.tenant_id,'mailboxId',v_connection.mailbox_id,'folderId',v_connection.folder_id,
    'messageId',v_import.provider_message_id,'retryNotBefore',v_connection.retry_not_before,
    'images',(select coalesce(jsonb_agg(file),'[]'::jsonb) from jsonb_array_elements(v_import.source_manifest) file
      where file ->> 'retention' = 'GRAPH_ONLY'));
end;
$function$;
revoke all on function valtrim.read_customer_service_graph_image_source(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function valtrim.read_customer_service_graph_image_source(uuid,uuid) to service_role;

-- Existing get_*_files and signed-URL endpoints still return only real stored
-- files. The future viewer opts into this separate metadata/extraction read.
create function valtrim.read_customer_service_import_sources(p_import_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_import valtrim.service_request_imports%rowtype; v_files jsonb;
begin
  perform private.require_customer_service_actor();
  select * into v_import from valtrim.service_request_imports where id = p_import_id;
  if not found then raise exception 'Email import not found' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'attachmentId',file -> 'attachmentId','originalFilename',file -> 'originalFilename',
    'mimeType',file -> 'mimeType','sizeBytes',file -> 'sizeBytes','sha256',file -> 'sha256',
    'isInline',file -> 'isInline','contentId',file -> 'contentId',
    'retention',case when v_import.source_contract_version = 2 then file ->> 'retention' else 'STORED' end,
    'fileId',ref -> 'fileId','storedFileAvailable',ref is not null,
    'analysis',case when analyzed is null then null else jsonb_build_object('sourceId',analyzed -> 'sourceId',
      'status',analyzed -> 'status','model',analyzed -> 'model','text',analyzed -> 'text',
      'structuredData',analyzed -> 'structuredData','error',analyzed -> 'error') end
    ) order by position),'[]'::jsonb) into v_files
  from jsonb_array_elements(coalesce(v_import.source_manifest,v_import.attachment_refs)) with ordinality files(file,position)
  left join lateral (select value ref from jsonb_array_elements(v_import.attachment_refs)
    where value ->> 'attachmentId' = file ->> 'attachmentId') refs on true
  left join lateral (select value analyzed from (
      select value,1 priority from jsonb_array_elements(v_import.worker_checkpoint -> 'sources')
      union all select value,2 priority from jsonb_array_elements(coalesce(v_import.analysis_payload -> 'sources','[]'::jsonb))
    ) sources where value ->> 'attachmentId' = file ->> 'attachmentId' and value ->> 'kind' in ('IMAGE','PDF')
    order by priority limit 1) analysis on true;
  return jsonb_build_object('importId',p_import_id,'sourceContractVersion',v_import.source_contract_version,
    'sourceStatus',v_import.source_status,'webLink',v_import.source_payload -> 'webLink','attachments',v_files);
end;
$function$;
revoke all on function valtrim.read_customer_service_import_sources(uuid) from public,anon,authenticated,service_role;
grant execute on function valtrim.read_customer_service_import_sources(uuid) to authenticated;

comment on column valtrim.service_request_imports.source_contract_version is
  '1: existing stored originals, unchanged. 2: pinned PDFs in Storage and Graph-only images; explicit V2 prepare and worker opt-in. Does not activate runtime processing.';
comment on column valtrim.service_request_imports.source_connection_id is
  'Immutable V2 Graph origin. No credentials, access tokens or continuation URLs. Existing V1 sources retain NULL.';
comment on function valtrim.read_customer_service_import_sources(uuid) is
  'Human read of original attachment metadata and per-source extraction. Unretained images have no file ID or stored-file availability; no signed URLs or worker/connection secrets.';
notify pgrst, 'reload schema';
commit;

