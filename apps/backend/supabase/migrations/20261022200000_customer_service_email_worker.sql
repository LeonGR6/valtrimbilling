-- Email block 5. Durable processing of already validated sources; no cron,
-- mailbox connector, inference call, new request workflow or human approval.
begin;
alter table valtrim.service_request_imports
  add column worker_token uuid,
  add column worker_lease_expires_at timestamptz,
  add column worker_failure_count integer not null default 0,
  add column next_attempt_at timestamptz,
  add column worker_checkpoint jsonb not null default '{"schemaVersion":"1.0","sources":[]}',
  add constraint service_request_imports_worker_check check (
    (worker_token is null) = (worker_lease_expires_at is null)
    and worker_failure_count >= 0
    and jsonb_typeof(worker_checkpoint) = 'object'
    and worker_checkpoint ->> 'schemaVersion' = '1.0'
    and jsonb_typeof(worker_checkpoint -> 'sources') = 'array'
  );
create index service_request_imports_worker_due_idx on valtrim.service_request_imports
  (next_attempt_at,created_at,id) where request_id is null and source_status = 'AVAILABLE';

create function private.lock_customer_service_email_worker(p_import_id uuid,p_worker_token uuid)
returns void language plpgsql security definer set search_path = '' as $function$
declare v_import valtrim.service_request_imports%rowtype;
begin
  if (select auth.uid()) is not null then
    raise exception 'Email worker requires a system context' using errcode = '42501';
  end if;
  select * into v_import from valtrim.service_request_imports where id = p_import_id for update;
  if not found then raise exception 'Email import not found' using errcode = 'P0002'; end if;
  if p_worker_token is null or v_import.worker_token is distinct from p_worker_token
    or v_import.worker_lease_expires_at <= clock_timestamp() or v_import.request_id is not null then
    raise exception 'Email worker lease is no longer valid' using errcode = '55000';
  end if;
end;
$function$;
revoke all on function private.lock_customer_service_email_worker(uuid,uuid) from public,anon,authenticated,service_role;

-- Keep existing block-2/4 contracts for non-worker callers, but prevent bypass
-- of an active or abandoned worker reservation. Worker writes check its token
-- and hold the SAME row lock as these original transactional implementations.
alter function valtrim.record_customer_service_import_analysis(uuid,jsonb) set schema private;
revoke all on function private.record_customer_service_import_analysis(uuid,jsonb) from public,anon,authenticated,service_role;
create function valtrim.record_customer_service_import_analysis(p_import_id uuid,p_report jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_token uuid;
begin
  select worker_token into v_token from valtrim.service_request_imports where id = p_import_id for update;
  if v_token is not null then raise exception 'Reserved imports require a worker token' using errcode = '55000'; end if;
  return private.record_customer_service_import_analysis(p_import_id,p_report);
end;
$function$;
alter function valtrim.save_customer_service_imported_request(uuid,jsonb) rename to save_customer_service_imported_request_with_source;
alter function valtrim.save_customer_service_imported_request_with_source(uuid,jsonb) set schema private;
revoke all on function private.save_customer_service_imported_request_with_source(uuid,jsonb) from public,anon,authenticated,service_role;
create function valtrim.save_customer_service_imported_request(p_import_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_import valtrim.service_request_imports%rowtype;
begin
  select * into v_import from valtrim.service_request_imports where id = p_import_id for update;
  if v_import.worker_token is not null and v_import.request_id is null then
    raise exception 'Reserved imports require a worker token' using errcode = '55000';
  end if;
  return private.save_customer_service_imported_request_with_source(p_import_id,p_payload);
end;
$function$;
revoke all on function valtrim.record_customer_service_import_analysis(uuid,jsonb),
  valtrim.save_customer_service_imported_request(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function valtrim.record_customer_service_import_analysis(uuid,jsonb),
  valtrim.save_customer_service_imported_request(uuid,jsonb) to service_role;

create function valtrim.claim_customer_service_email_import(p_import_id uuid default null)
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

create function valtrim.renew_customer_service_email_worker(p_import_id uuid,p_worker_token uuid)
returns void language plpgsql security definer set search_path = '' as $function$
begin
  perform private.lock_customer_service_email_worker(p_import_id,p_worker_token);
  update valtrim.service_request_imports set worker_lease_expires_at = clock_timestamp() + interval '3 minutes' where id = p_import_id;
end;
$function$;

create function valtrim.checkpoint_customer_service_email_worker(p_import_id uuid,p_worker_token uuid,p_source jsonb)
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
  if p_source ->> 'kind' = 'EMAIL' then
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

create function valtrim.record_customer_service_worker_analysis(p_import_id uuid,p_worker_token uuid,p_report jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  perform private.lock_customer_service_email_worker(p_import_id,p_worker_token);
  return private.record_customer_service_import_analysis(p_import_id,p_report);
end;
$function$;

create function valtrim.finish_customer_service_email_worker(p_import_id uuid,p_worker_token uuid,p_action text,p_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_import valtrim.service_request_imports%rowtype; v_result jsonb; v_failures integer; v_retry boolean;
begin
  if (select auth.uid()) is not null then raise exception 'Email worker requires a system context' using errcode = '42501'; end if;
  select * into v_import from valtrim.service_request_imports where id = p_import_id for update;
  if not found then raise exception 'Email import not found' using errcode = 'P0002'; end if;
  if v_import.request_id is not null then
    return jsonb_build_object('importId',v_import.id,'requestId',v_import.request_id,'status','PROCESSED','idempotentReplay',true);
  end if;
  perform private.lock_customer_service_email_worker(p_import_id,p_worker_token);
  if p_action is null or p_action not in ('COMMIT','CONTINUE','RETRY','ATTENTION') then
    raise exception 'Invalid worker completion action' using errcode = '22023';
  end if;
  if p_action = 'COMMIT' then
    if v_import.analysis_payload ->> 'outcome' is distinct from 'READY_FOR_INTAKE' then
      raise exception 'A complete ready analysis is required before creating a request' using errcode = '22023';
    end if;
    v_result := private.save_customer_service_imported_request_with_source(p_import_id,v_import.analysis_payload -> 'intakePayload');
    -- The existing writer records invalid intake as NEEDS_ATTENTION without
    -- partial business rows. Never label any JSON response as successful save.
    update valtrim.service_request_imports set worker_token = null,worker_lease_expires_at = null,next_attempt_at = null
      where id = p_import_id;
    return v_result;
  elsif p_action = 'CONTINUE' then
    update valtrim.service_request_imports set status = 'PENDING',worker_token = null,worker_lease_expires_at = null,
      next_attempt_at = clock_timestamp(),error_code = null,error_message = null where id = p_import_id;
  else
    v_failures := v_import.worker_failure_count + case when p_action = 'RETRY' then 1 else 0 end;
    v_retry := p_action = 'RETRY' and v_failures < 3;
    update valtrim.service_request_imports set status = case when v_retry then 'PENDING'::valtrim.service_request_import_status else 'NEEDS_ATTENTION'::valtrim.service_request_import_status end,
      worker_token = null,worker_lease_expires_at = null,worker_failure_count = v_failures,
      next_attempt_at = case when v_retry then clock_timestamp() + case when v_failures = 1 then interval '1 minute' else interval '5 minutes' end else null end,
      error_code = case when p_action = 'RETRY' then case when v_retry then 'WORKER_TEMPORARY_FAILURE' else 'WORKER_RETRIES_EXHAUSTED' end
        when p_code in ('ANALYSIS_FAILED','ANALYSIS_INCOMPLETE','SOURCE_UNAVAILABLE') then p_code else 'WORKER_ERROR' end,
      error_message = case when v_retry then 'Fallo temporal. Se programó un nuevo intento de procesamiento.'
        else 'No se pudo completar la importación automática. Revisa el análisis y el correo original.' end
      where id = p_import_id;
  end if;
  select * into v_import from valtrim.service_request_imports where id = p_import_id;
  return jsonb_build_object('importId',p_import_id,'requestId',v_import.request_id,'status',v_import.status,
    'errorCode',v_import.error_code,'nextAttemptAt',v_import.next_attempt_at,'idempotentReplay',false);
end;
$function$;

revoke all on function valtrim.claim_customer_service_email_import(uuid),valtrim.renew_customer_service_email_worker(uuid,uuid),
  valtrim.checkpoint_customer_service_email_worker(uuid,uuid,jsonb),valtrim.record_customer_service_worker_analysis(uuid,uuid,jsonb),
  valtrim.finish_customer_service_email_worker(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function valtrim.claim_customer_service_email_import(uuid),valtrim.renew_customer_service_email_worker(uuid,uuid),
  valtrim.checkpoint_customer_service_email_worker(uuid,uuid,jsonb),valtrim.record_customer_service_worker_analysis(uuid,uuid,jsonb),
  valtrim.finish_customer_service_email_worker(uuid,uuid,text,text) to service_role;
comment on column valtrim.service_request_imports.worker_checkpoint is 'Immutable-source progress and sanitized source errors; only successes are reused. Server-only writes with lease fencing. No approval or binary.';
notify pgrst, 'reload schema';
commit;
