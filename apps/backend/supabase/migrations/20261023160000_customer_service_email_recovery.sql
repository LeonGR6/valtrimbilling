-- Email block 6: authorized retry and human recovery of the SAME receipt.
-- Original email/manifests/analysis are never replaced; no automatic approval.
begin;

alter table valtrim.service_request_sources
  add column recovery_pdf_sha256 text,
  add column recovery_pdf_size_bytes bigint,
  add column recovery_pdf_filename varchar(255),
  add constraint service_request_sources_recovery_pdf_check check (
    (recovery_pdf_sha256 is null and recovery_pdf_size_bytes is null and recovery_pdf_filename is null)
    or (recovery_pdf_sha256 is not null and recovery_pdf_size_bytes is not null and recovery_pdf_filename is not null
      and source_type = 'PDF' and recovery_pdf_sha256 ~ '^[0-9a-f]{64}$'
      and recovery_pdf_size_bytes between 1 and 10485760
      and btrim(recovery_pdf_filename) <> '' and recovery_pdf_filename = btrim(recovery_pdf_filename))
  );
create function private.guard_customer_service_recovery_pdf()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if old.recovery_pdf_sha256 is not null and row(new.recovery_pdf_sha256,new.recovery_pdf_size_bytes,new.recovery_pdf_filename)
    is distinct from row(old.recovery_pdf_sha256,old.recovery_pdf_size_bytes,old.recovery_pdf_filename) then
    raise exception 'The pinned recovery PDF cannot be replaced' using errcode = '55000';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_customer_service_recovery_pdf() from public,anon,authenticated,service_role;
create trigger service_request_sources_guard_recovery_pdf before update on valtrim.service_request_sources
for each row execute function private.guard_customer_service_recovery_pdf();

alter function valtrim.finalize_customer_service_source_pdf_upload(bigint,uuid,text,bigint,text) set schema private;
revoke all on function private.finalize_customer_service_source_pdf_upload(bigint,uuid,text,bigint,text)
  from public,anon,authenticated,service_role;
create function valtrim.finalize_customer_service_source_pdf_upload(
  p_request_id bigint,p_actor_id uuid,p_original_filename text,p_size_bytes bigint,p_sha256 text
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_source valtrim.service_request_sources%rowtype;
begin
  select * into v_source from valtrim.service_request_sources where request_id = p_request_id for update;
  if v_source.recovery_pdf_sha256 is not null and
    (v_source.recovery_pdf_sha256 is distinct from lower(btrim(p_sha256))
      or v_source.recovery_pdf_size_bytes is distinct from p_size_bytes
      or v_source.recovery_pdf_filename is distinct from btrim(p_original_filename)) then
    raise exception 'The uploaded PDF differs from the pinned recovery source' using errcode = '55000';
  end if;
  return private.finalize_customer_service_source_pdf_upload(p_request_id,p_actor_id,p_original_filename,p_size_bytes,p_sha256);
end;
$function$;
revoke all on function valtrim.finalize_customer_service_source_pdf_upload(bigint,uuid,text,bigint,text)
  from public,anon,authenticated,service_role;
grant execute on function valtrim.finalize_customer_service_source_pdf_upload(bigint,uuid,text,bigint,text) to service_role;

-- Keep the automatic source gate intact. The sole exception is an authenticated
-- human insert attributed to that actor, awaiting review, on an unreserved error.
-- Browser roles have no INSERT privilege on email_import_id/submission_key and
-- cannot call the private writer; manual capture cannot inject an import link.
create or replace function private.require_customer_service_import_source()
returns trigger language plpgsql set search_path = '' as $function$
declare v_import valtrim.service_request_imports%rowtype; v_actor uuid := auth.uid();
begin
  select * into v_import from valtrim.service_request_imports where id = new.email_import_id for update;
  if v_import.source_status is distinct from 'AVAILABLE' then
    if v_actor is not null and new.created_by = v_actor and new.workflow_stage = 'NEEDS_REVIEW'
      and new.submission_key = new.email_import_id and v_import.status = 'NEEDS_ATTENTION'
      and v_import.request_id is null and v_import.worker_token is null then
      perform private.require_customer_service_actor();
      return new;
    end if;
    raise exception 'An imported request requires a complete available source' using errcode = '55000';
  end if;
  return new;
end;
$function$;

create function valtrim.retry_customer_service_email_import(p_import_id uuid,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_actor uuid := private.require_customer_service_actor();
  v_import valtrim.service_request_imports%rowtype;
begin
  select * into v_import from valtrim.service_request_imports where id = p_import_id for update;
  if not found then raise exception 'Email import not found' using errcode = 'P0002'; end if;
  -- A lost response must not recreate/reopen an associated business request.
  if v_import.request_id is not null then
    return jsonb_build_object('importId',p_import_id,'requestId',v_import.request_id,'status',v_import.status,'idempotentReplay',true);
  end if;
  if v_import.source_status <> 'AVAILABLE' then
    raise exception 'Original source unavailable: recover with a valid PDF or the form' using errcode = '55000';
  end if;
  if v_import.worker_token is not null and v_import.worker_lease_expires_at <= clock_timestamp() then
    -- Claim, rather than this human RPC, replaces the expired token and counts
    -- the abandoned execution. This also covers a crash after analysis retention.
    return jsonb_build_object('importId',p_import_id,'requestId',null,'status','PENDING','idempotentReplay',true);
  end if;
  -- Replays/continuations do not reset the bounded failure budget or bypass due time.
  if v_import.status in ('PENDING','PROCESSING') then
    return jsonb_build_object('importId',p_import_id,'requestId',null,
      'status',case when v_import.status = 'PROCESSING' and
        ((v_import.worker_token is not null and v_import.worker_lease_expires_at <= clock_timestamp())
          or (v_import.worker_token is null and v_import.processing_started_at < clock_timestamp() - interval '3 minutes'))
        then 'PENDING'::valtrim.service_request_import_status else v_import.status end,
      'nextAttemptAt',v_import.next_attempt_at,'idempotentReplay',true);
  end if;
  if p_expected_updated_at is null or v_import.updated_at is distinct from p_expected_updated_at then
    raise exception 'The import changed. Refresh before retrying' using errcode = '40001';
  end if;
  if v_import.status <> 'NEEDS_ATTENTION' or v_import.worker_token is not null then
    raise exception 'The import cannot be retried in its current state' using errcode = '55000';
  end if;
  if v_import.error_code in ('WORKER_CONTINUATION_REQUIRED','WORKER_TEMPORARY_FAILURE')
    and v_import.next_attempt_at > clock_timestamp() then
    return jsonb_build_object('importId',p_import_id,'requestId',null,'status','NEEDS_ATTENTION',
      'errorCode',v_import.error_code,'nextAttemptAt',v_import.next_attempt_at,'idempotentReplay',true);
  end if;
  update valtrim.service_request_imports set status = 'PENDING',
    worker_failure_count = case when v_import.error_code in ('WORKER_CONTINUATION_REQUIRED','WORKER_TEMPORARY_FAILURE')
      then worker_failure_count else 0 end,
    next_attempt_at = clock_timestamp(),error_code = null,error_message = null where id = p_import_id;
  insert into valtrim.audit_events(module,action,actor_type,actor_user_id,actor_name,actor_email,actor_role,
    entity_type,entity_id,summary,previous_values,metadata)
  select 'CUSTOMER_SERVICE','SERVICE_EMAIL_IMPORT_RETRY_REQUESTED','USER',id,name,email,role::text,
    'SERVICE_REQUEST_IMPORT',p_import_id::text,'Email import retry authorized.',
    jsonb_build_object('status',v_import.status,'errorCode',v_import.error_code,'errorMessage',v_import.error_message),
    jsonb_build_object('importId',p_import_id)
  from valtrim.app_users where id = v_actor;
  return jsonb_build_object('importId',p_import_id,'requestId',null,'status','PENDING','idempotentReplay',false);
end;
$function$;

-- Only the human-triggered endpoint parks unfinished work for explicit continuation.
-- The automatic worker keeps its existing PENDING/backoff behavior unchanged.
create function valtrim.hold_customer_service_email_retry(p_import_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_actor uuid := private.require_customer_service_actor();
  v_import valtrim.service_request_imports%rowtype;
begin
  select * into v_import from valtrim.service_request_imports where id = p_import_id for update;
  if not found then raise exception 'Email import not found' using errcode = 'P0002'; end if;
  if v_import.status = 'PENDING' and v_import.request_id is null and v_import.worker_token is null
    and v_import.source_status = 'AVAILABLE' then
    update valtrim.service_request_imports set status = 'NEEDS_ATTENTION',
      error_code = case when error_code = 'WORKER_TEMPORARY_FAILURE' then error_code else 'WORKER_CONTINUATION_REQUIRED' end,
      error_message = case when error_code = 'WORKER_TEMPORARY_FAILURE'
        then 'Fallo temporal. Conservamos los avances; continúa después de la espera indicada.'
        else 'El análisis conserva avances. Pulsa Continuar análisis para procesar las fuentes restantes.' end
    where id = p_import_id returning * into v_import;
  end if;
  return jsonb_build_object('importId',p_import_id,'requestId',v_import.request_id,'status',v_import.status,
    'errorCode',v_import.error_code,'nextAttemptAt',v_import.next_attempt_at);
end;
$function$;

create function valtrim.recover_customer_service_email_import(
  p_import_id uuid,p_expected_updated_at timestamptz,p_payload jsonb,p_source jsonb default null
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_actor uuid := private.require_customer_service_actor();
  v_import valtrim.service_request_imports%rowtype;
  v_data jsonb;
  v_request_id bigint;
  v_pdf boolean := p_source is not null and p_source <> 'null'::jsonb;
begin
  select * into v_import from valtrim.service_request_imports where id = p_import_id for update;
  if not found then raise exception 'Email import not found' using errcode = 'P0002'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_import_id::text,0));
  if v_import.request_id is not null then
    -- Never apply stale human form values to the winner of a concurrent save.
    return (select value from valtrim.read_customer_service_request_intakes(v_import.request_id) records(value));
  end if;
  if p_expected_updated_at is null or v_import.updated_at is distinct from p_expected_updated_at then
    raise exception 'The import changed. Refresh before recovering' using errcode = '40001';
  end if;
  if v_import.status <> 'NEEDS_ATTENTION' or v_import.worker_token is not null then
    raise exception 'Only an unreserved import requiring attention can be recovered' using errcode = '55000';
  end if;
  v_data := private.normalize_customer_service_import_intake(p_payload);
  if v_pdf then
    if jsonb_typeof(p_source) <> 'object' or p_source ->> 'sourceType' is distinct from 'PDF'
      or (p_source - array['sourceType','extractedText','extractionPayload','extractionModel','reviewNotes','sha256','sizeBytes','originalFilename']) <> '{}'::jsonb
      or jsonb_typeof(p_source -> 'sha256') is distinct from 'string'
      or (p_source ->> 'sha256') !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(p_source -> 'sizeBytes') is distinct from 'number'
      or (p_source ->> 'sizeBytes') !~ '^[0-9]{1,8}$'
      or (p_source ->> 'sizeBytes')::bigint not between 1 and 10485760
      or jsonb_typeof(p_source -> 'originalFilename') is distinct from 'string'
      or nullif(btrim(p_source ->> 'originalFilename'),'') is null
      or char_length(p_source ->> 'originalFilename') > 255
      or p_source ->> 'originalFilename' <> btrim(p_source ->> 'originalFilename')
      or (p_source -> 'extractedText' <> 'null'::jsonb and jsonb_typeof(p_source -> 'extractedText') <> 'string')
      or (p_source -> 'extractionModel' <> 'null'::jsonb and jsonb_typeof(p_source -> 'extractionModel') <> 'string')
      or char_length(p_source ->> 'extractionModel') > 120
      or (p_source -> 'extractionPayload' <> 'null'::jsonb and jsonb_typeof(p_source -> 'extractionPayload') <> 'object')
      or (p_source ? 'reviewNotes' and (jsonb_typeof(p_source -> 'reviewNotes') <> 'array'
        or jsonb_path_exists(p_source,'$.reviewNotes[*] ? (@.type() != "string")'))) then
      raise exception 'Invalid recovery PDF metadata' using errcode = '22023';
    end if;
  end if;
  -- Intentionally bypass the automatic AVAILABLE-source gate, without changing
  -- a REJECTED source into an accepted one. The new human PDF is a separate source.
  v_request_id := private.write_customer_service_import_intake(p_import_id,v_data,null,v_actor);
  if v_pdf then
    insert into valtrim.service_request_sources(request_id,source_type,file_status,extracted_text,
      extraction_payload,extraction_model,review_notes,created_by,updated_by,
      recovery_pdf_sha256,recovery_pdf_size_bytes,recovery_pdf_filename)
    values (v_request_id,'PDF','PENDING',nullif(p_source ->> 'extractedText',''),
      nullif(p_source -> 'extractionPayload','null'::jsonb),nullif(btrim(p_source ->> 'extractionModel'),''),
      coalesce((select array_agg(value #>> '{}') from jsonb_array_elements(coalesce(p_source -> 'reviewNotes','[]'::jsonb))),'{}'),
      v_actor,v_actor,p_source ->> 'sha256',(p_source ->> 'sizeBytes')::bigint,p_source ->> 'originalFilename');
  end if;
  update valtrim.service_request_imports set request_id = v_request_id,
    status = case when v_pdf then 'NEEDS_ATTENTION'::valtrim.service_request_import_status else 'PROCESSED'::valtrim.service_request_import_status end,
    processed_at = case when v_pdf then null else clock_timestamp() end,
    error_code = case when v_pdf then 'RECOVERY_PDF_PENDING' else null end,
    error_message = case when v_pdf then 'La request fue guardada. Falta completar la carga del PDF de recuperación.' else null end,
    worker_token = null,worker_lease_expires_at = null,next_attempt_at = null where id = p_import_id;
  insert into valtrim.audit_events(module,action,actor_type,actor_user_id,actor_name,actor_email,actor_role,
    entity_type,entity_id,summary,previous_values,new_values,metadata)
  select 'CUSTOMER_SERVICE','SERVICE_EMAIL_IMPORT_RECOVERED','USER',id,name,email,role::text,
    'SERVICE_REQUEST_IMPORT',p_import_id::text,'Email import recovered as a request awaiting human review.',
    jsonb_build_object('status',v_import.status,'errorCode',v_import.error_code,'errorMessage',v_import.error_message),
    jsonb_build_object('requestId',v_request_id,'workflowStage','NEEDS_REVIEW'),
    jsonb_build_object('importId',p_import_id,'recoveryPdf',v_pdf)
  from valtrim.app_users where id = v_actor;
  return (select value from valtrim.read_customer_service_request_intakes(v_request_id) records(value));
end;
$function$;

create function valtrim.complete_customer_service_email_recovery(p_import_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_actor uuid := private.require_customer_service_actor();
  v_import valtrim.service_request_imports%rowtype;
begin
  select * into v_import from valtrim.service_request_imports where id = p_import_id for update;
  if not found or v_import.request_id is null then
    raise exception 'A linked recovery request is required' using errcode = '55000';
  end if;
  if v_import.error_code = 'RECOVERY_PDF_PENDING' then
    if not exists(select 1 from valtrim.service_request_sources source
      join valtrim.service_requests request on request.id = source.request_id
      where source.request_id = v_import.request_id and request.email_import_id = p_import_id
        and source.source_type = 'PDF' and source.file_status = 'AVAILABLE' and source.file_id is not null) then
      raise exception 'The recovery PDF is not available yet' using errcode = '55000';
    end if;
    update valtrim.service_request_imports set status = 'PROCESSED',processed_at = clock_timestamp(),
      error_code = null,error_message = null where id = p_import_id;
    insert into valtrim.audit_events(module,action,actor_type,actor_user_id,actor_name,actor_email,actor_role,
      entity_type,entity_id,summary,metadata)
    select 'CUSTOMER_SERVICE','SERVICE_EMAIL_IMPORT_RECOVERY_COMPLETED','USER',id,name,email,role::text,
      'SERVICE_REQUEST_IMPORT',p_import_id::text,'Recovery PDF retained; email import recovery completed.',
      jsonb_build_object('importId',p_import_id,'requestId',v_import.request_id)
    from valtrim.app_users where id = v_actor;
  elsif v_import.status <> 'PROCESSED' then
    raise exception 'This problem is not a pending recovery PDF' using errcode = '55000';
  end if;
  return (select value from valtrim.read_customer_service_request_intakes(v_import.request_id) records(value));
end;
$function$;

revoke all on function valtrim.retry_customer_service_email_import(uuid,timestamptz),
  valtrim.hold_customer_service_email_retry(uuid),
  valtrim.recover_customer_service_email_import(uuid,timestamptz,jsonb,jsonb),
  valtrim.complete_customer_service_email_recovery(uuid) from public,anon,authenticated,service_role;
grant execute on function valtrim.retry_customer_service_email_import(uuid,timestamptz),
  valtrim.hold_customer_service_email_retry(uuid),
  valtrim.recover_customer_service_email_import(uuid,timestamptz,jsonb,jsonb),
  valtrim.complete_customer_service_email_recovery(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
