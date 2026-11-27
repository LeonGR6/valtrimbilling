-- Block 3: in-memory Graph image analysis and resumable worker delays.
begin;

create or replace function private.validate_customer_service_import_source_v2(p_import_id uuid,p_source jsonb)
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
    if (p_source -> 'error') - array['code','message','retryable','providerStatus','diagnosticCode','validationPath','retryAfterSeconds'] <> '{}'
      or exists(select 1 from jsonb_each(p_source -> 'error') where
        (key in ('code','message','diagnosticCode','validationPath') and jsonb_typeof(value) <> 'string')
        or (key = 'retryAfterSeconds' and case
          when jsonb_typeof(value) = 'number' and value::text ~ '^[0-9]+$' and length(value::text) <= 10
          then value::text::numeric > 2147483647 else true end)
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

create or replace function valtrim.read_customer_service_graph_image_source(p_import_id uuid,p_worker_token uuid)
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
  if not found or not v_connection.enabled or (v_connection.initialized_at is null and v_connection.initial_sync_mode is distinct from 'IMPORT_EXISTING')
    or v_connection.tenant_id is distinct from v_import.tenant_id or v_connection.mailbox_id::text is distinct from v_import.mailbox_id then
    return jsonb_build_object('importId',v_import.id,'connectionId',v_import.source_connection_id,'connectionAvailable',false);
  end if;
  return jsonb_build_object('importId',v_import.id,'connectionId',v_connection.id,'connectionAvailable',true,
    'tenantId',v_connection.tenant_id,'mailboxId',v_connection.mailbox_id,'folderId',v_connection.folder_id,
    'messageId',v_import.provider_message_id,'retryNotBefore',v_connection.retry_not_before,
    'images',(select coalesce(jsonb_agg(file),'[]'::jsonb) from jsonb_array_elements(v_import.source_manifest) file
      where file ->> 'retention' = 'GRAPH_ONLY'));
end;
$function$;

-- Keep the legacy finalizer and its transactional writer, attempt budget and
-- token fencing. A provider delay may lengthen, never shorten, its backoff.
create function valtrim.finish_customer_service_email_worker_v2(
  p_import_id uuid,p_worker_token uuid,p_action text,p_code text default null,p_retry_after_seconds integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_result jsonb; v_next timestamptz;
begin
  if p_retry_after_seconds is null or p_retry_after_seconds < 0 then
    raise exception 'Invalid worker retry delay' using errcode = '22023';
  end if;
  v_result := valtrim.finish_customer_service_email_worker(p_import_id,p_worker_token,p_action,p_code);
  if p_action in ('RETRY','CONTINUE') and p_retry_after_seconds > 0
    and v_result ->> 'status' = 'PENDING' and v_result ->> 'requestId' is null then
    update valtrim.service_request_imports
      set next_attempt_at = greatest(next_attempt_at,clock_timestamp() + make_interval(secs => p_retry_after_seconds))
      where id = p_import_id returning next_attempt_at into v_next;
    v_result := jsonb_set(v_result,'{nextAttemptAt}',to_jsonb(v_next));
  end if;
  return v_result;
end;
$function$;
revoke all on function valtrim.finish_customer_service_email_worker_v2(uuid,uuid,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function valtrim.finish_customer_service_email_worker_v2(uuid,uuid,text,text,integer) to service_role;
comment on function valtrim.finish_customer_service_email_worker_v2(uuid,uuid,text,text,integer) is
  'Worker completion with durable provider Retry-After. Preserves existing failure limits, human approval and historical contracts.';
notify pgrst, 'reload schema';
commit;
