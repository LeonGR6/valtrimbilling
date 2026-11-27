-- Explicit server recovery after correcting Graph raw attachment size validation.
-- No cursor reset, automatic reopening, request creation or change to applied SQL.
begin;

create function valtrim.prepare_customer_service_graph_source_recovery(
  p_connection_id uuid,p_sync_token uuid,p_expected_revision bigint,
  p_import_id uuid,p_expected_updated_at timestamptz,
  p_source_payload jsonb,p_attachments jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_connection private.customer_service_email_connections%rowtype;
  v_import valtrim.service_request_imports%rowtype;
  v_result jsonb;
begin
  v_connection := private.lock_customer_service_email_sync(p_connection_id,p_sync_token,p_expected_revision);
  if v_connection.initialized_at is null then
    raise exception 'Initialize the connection before source recovery' using errcode = '55000';
  end if;
  select * into v_import from valtrim.service_request_imports where id = p_import_id for update;
  if not found then raise exception 'Email import not found' using errcode = 'P0002'; end if;
  if v_import.tenant_id is distinct from v_connection.tenant_id
    or v_import.mailbox_id is distinct from v_connection.mailbox_id::text then
    raise exception 'The import does not belong to this connection mailbox' using errcode = '42501';
  end if;
  -- Lost responses/repeated calls can never overwrite accepted sources or a request.
  if v_import.request_id is not null or v_import.source_status in ('AVAILABLE','LEGACY') then
    return private.customer_service_import_source_result(p_import_id,true);
  end if;
  if v_import.worker_token is not null or v_import.status = 'PROCESSING' then
    raise exception 'The import has an active processing reservation' using errcode = '55000';
  end if;
  if v_import.source_status = 'UPLOADING' and exists (
    select 1 from valtrim.audit_events where module = 'CUSTOMER_SERVICE'
      and action = 'SERVICE_EMAIL_GRAPH_SOURCE_RECOVERY' and entity_type = 'SERVICE_REQUEST_IMPORT'
      and entity_id = p_import_id::text and metadata ->> 'connectionId' = p_connection_id::text
  ) then
    -- Resume only the same immutable snapshot. The existing prepare RPC compares
    -- the full body and canonical manifest; a changed file cannot replace it.
    return valtrim.prepare_customer_service_import_source(p_import_id,p_source_payload,p_attachments);
  end if;
  if p_expected_updated_at is null or v_import.updated_at is distinct from p_expected_updated_at then
    raise exception 'The import changed. Read it again before recovery' using errcode = '40001';
  end if;
  if v_import.source_status <> 'REJECTED' or v_import.status <> 'NEEDS_ATTENTION'
    or v_import.error_code not in ('ATTACHMENT_SIZE','ATTACHMENT_TOTAL_SIZE')
    or v_import.error_code is null or v_import.source_manifest is not null
    or v_import.attachment_refs <> '[]'::jsonb or v_import.extraction_payload is not null
    or exists (select 1 from valtrim.service_request_import_files where import_id = p_import_id) then
    raise exception 'Only an unpinned size rejection can use this correction' using errcode = '55000';
  end if;
  -- The caller has re-read the message in the configured folder and validated
  -- every raw file. Reopen and pin together: no unpinned PENDING recovery window.
  update valtrim.service_request_imports set source_status = 'PENDING',status = 'PENDING',
    error_code = null,error_message = null where id = p_import_id;
  v_result := valtrim.prepare_customer_service_import_source(p_import_id,p_source_payload,p_attachments);
  if v_result ->> 'sourceStatus' is distinct from 'UPLOADING' then
    raise exception 'The complete recovered source could not be prepared' using errcode = '55000';
  end if;
  insert into valtrim.audit_events(module,action,actor_type,actor_name,entity_type,entity_id,
    summary,previous_values,new_values,metadata)
  values ('CUSTOMER_SERVICE','SERVICE_EMAIL_GRAPH_SOURCE_RECOVERY','SYSTEM','Customer Service email connector',
    'SERVICE_REQUEST_IMPORT',p_import_id::text,'Email source revalidated after the Graph size validation correction.',
    jsonb_build_object('status',v_import.status,'sourceStatus',v_import.source_status,
      'errorCode',v_import.error_code,'errorMessage',v_import.error_message,'updatedAt',v_import.updated_at),
    jsonb_build_object('status','PENDING','sourceStatus','UPLOADING'),
    jsonb_build_object('importId',p_import_id,'connectionId',p_connection_id,
      'correction','GRAPH_RAW_ATTACHMENT_SIZE','attachmentCount',jsonb_array_length(p_attachments)));
  return v_result;
end;
$function$;

revoke all on function valtrim.prepare_customer_service_graph_source_recovery(uuid,uuid,bigint,uuid,timestamptz,jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function valtrim.prepare_customer_service_graph_source_recovery(uuid,uuid,bigint,uuid,timestamptz,jsonb,jsonb)
  to service_role;

commit;
