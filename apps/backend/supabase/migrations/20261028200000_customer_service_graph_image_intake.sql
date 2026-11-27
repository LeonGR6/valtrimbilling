-- No-retention block 2: PDF-only new uploads and explicit V2 source recovery.
-- No historical object/manifest deletion or conversion; no queue/cron activation.
begin;

do $check$
begin
  if not exists(select 1 from storage.buckets where id = 'customer-service-imports'
    and not public and file_size_limit = 10000000) then
    raise exception 'The existing private import bucket must retain its 10 MB limit' using errcode = '55000';
  end if;
end;
$check$;
-- Upload restriction only. Existing images and signed reads remain in place.
update storage.buckets set allowed_mime_types = array['application/pdf']::text[]
  where id = 'customer-service-imports';

-- IMPORT_EXISTING must retain its first-round behavior. BASELINE_ONLY still
-- cannot prepare historical sources before its initial DELTA.
create or replace function valtrim.prepare_customer_service_graph_source_v2(
  p_connection_id uuid,p_sync_token uuid,p_expected_revision bigint,
  p_import_id uuid,p_source_payload jsonb,p_attachments jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_connection private.customer_service_email_connections%rowtype;
  v_import valtrim.service_request_imports%rowtype; v_manifest jsonb; v_source jsonb;
begin
  v_connection := private.lock_customer_service_email_sync(p_connection_id,p_sync_token,p_expected_revision);
  if v_connection.initialized_at is null and v_connection.initial_sync_mode is distinct from 'IMPORT_EXISTING' then
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

create function valtrim.prepare_customer_service_graph_source_recovery_v2(
  p_connection_id uuid,p_sync_token uuid,p_expected_revision bigint,
  p_import_id uuid,p_expected_updated_at timestamptz,p_source_payload jsonb,p_attachments jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_connection private.customer_service_email_connections%rowtype;
  v_import valtrim.service_request_imports%rowtype; v_result jsonb; v_pinned boolean; v_replay boolean;
begin
  v_connection := private.lock_customer_service_email_sync(p_connection_id,p_sync_token,p_expected_revision);
  if v_connection.initialized_at is null then
    raise exception 'Initialize the connection before source recovery' using errcode = '55000';
  end if;
  select * into v_import from valtrim.service_request_imports where id = p_import_id for update;
  if not found then raise exception 'Email import not found' using errcode = 'P0002'; end if;
  if v_import.tenant_id is distinct from v_connection.tenant_id or v_import.mailbox_id is distinct from v_connection.mailbox_id::text then
    raise exception 'The import does not belong to this connection mailbox' using errcode = '42501';
  end if;
  if v_import.request_id is not null or v_import.source_status in ('AVAILABLE','LEGACY') then
    return private.customer_service_import_source_result(p_import_id,true);
  end if;
  if v_import.worker_token is not null or v_import.status = 'PROCESSING' then
    raise exception 'The import has an active processing reservation' using errcode = '55000';
  end if;
  v_pinned := v_import.source_status = 'UPLOADING' and v_import.source_contract_version = 2
    and v_import.source_connection_id = p_connection_id and v_import.source_manifest is not null;
  if v_import.source_manifest is not null and not v_pinned then
    raise exception 'Historical pinned sources cannot be converted to V2' using errcode = '55000';
  end if;
  select exists(select 1 from valtrim.audit_events where module = 'CUSTOMER_SERVICE'
    and action = 'SERVICE_EMAIL_GRAPH_SOURCE_RECOVERY' and entity_type = 'SERVICE_REQUEST_IMPORT' and entity_id = p_import_id::text
    and metadata ->> 'connectionId' = p_connection_id::text and metadata ->> 'correction' = 'GRAPH_IMAGE_NO_RETENTION'
    and metadata -> 'expectedUpdatedAt' = to_jsonb(p_expected_updated_at)) into v_replay;
  -- Only the same already-audited immutable recovery may replay its old version.
  if not (v_pinned and v_replay) and (p_expected_updated_at is null or v_import.updated_at is distinct from p_expected_updated_at) then
    raise exception 'The import changed. Read it again before recovery' using errcode = '40001';
  end if;
  if not v_pinned then
    if v_import.source_status <> 'REJECTED' or v_import.status <> 'NEEDS_ATTENTION'
      or v_import.error_code is null or v_import.error_code not in ('ATTACHMENT_SIZE','ATTACHMENT_TOTAL_SIZE')
      or v_import.source_manifest is not null or v_import.attachment_refs <> '[]'::jsonb
      or v_import.analysis_payload is not null or v_import.extraction_payload is not null
      or v_import.worker_checkpoint -> 'sources' <> '[]'::jsonb
      or exists(select 1 from valtrim.service_request_import_files where import_id = p_import_id) then
      raise exception 'Only an unpinned size rejection can use this correction' using errcode = '55000';
    end if;
    update valtrim.service_request_imports set source_status = 'PENDING',status = 'PENDING',error_code = null,error_message = null where id = p_import_id;
  end if;
  v_result := valtrim.prepare_customer_service_graph_source_v2(p_connection_id,p_sync_token,p_expected_revision,
    p_import_id,p_source_payload,p_attachments);
  if v_result ->> 'sourceStatus' is distinct from 'UPLOADING' then
    raise exception 'The complete recovered source could not be prepared' using errcode = '55000';
  end if;
  if not v_replay then
    insert into valtrim.audit_events(module,action,actor_type,actor_name,entity_type,entity_id,
      summary,previous_values,new_values,metadata)
    values ('CUSTOMER_SERVICE','SERVICE_EMAIL_GRAPH_SOURCE_RECOVERY','SYSTEM','Customer Service email connector',
      'SERVICE_REQUEST_IMPORT',p_import_id::text,'Email source validated for image analysis without stored images.',
      jsonb_build_object('status',v_import.status,'sourceStatus',v_import.source_status,'errorCode',v_import.error_code,
        'errorMessage',case when private.customer_service_import_has_binary(to_jsonb(v_import.error_message))
          then 'Original diagnostic omitted because it contained binary transport data' else v_import.error_message end,
        'updatedAt',v_import.updated_at),
      jsonb_build_object('sourceContractVersion',2,'sourceStatus','UPLOADING'),
      jsonb_build_object('importId',p_import_id,'connectionId',p_connection_id,'expectedUpdatedAt',p_expected_updated_at,
        'correction','GRAPH_IMAGE_NO_RETENTION','attachmentCount',jsonb_array_length(p_attachments)));
  end if;
  return v_result;
end;
$function$;
revoke all on function valtrim.prepare_customer_service_graph_source_recovery_v2(uuid,uuid,bigint,uuid,timestamptz,jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function valtrim.prepare_customer_service_graph_source_recovery_v2(uuid,uuid,bigint,uuid,timestamptz,jsonb,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;

