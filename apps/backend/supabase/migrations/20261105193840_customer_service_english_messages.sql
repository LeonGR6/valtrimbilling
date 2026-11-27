-- Translate the user-visible messages of the Customer Service email functions
-- to English (CLAUDE.md: all code and UI text is English).
--
-- Each body below is the definition live on the linked project
-- (pg_get_functiondef, 2026-11-05) with ONLY its Spanish string literals
-- replaced. Signatures, security, search_path and logic are unchanged, and
-- CREATE OR REPLACE keeps existing grants and ownership.
--
-- Machine prefixes (ATTACHMENT_COUNT:, ATTACHMENT_SIZE:, ATTACHMENT_TOTAL_SIZE:)
-- are preserved. Rows already holding a Spanish error_message are not rewritten.
-- valtrim.validate_service_appointment is intentionally excluded: migration
-- 20261105120000 replaces it with an English, technician_ids-based version.

-- private.normalize_customer_service_import_files
CREATE OR REPLACE FUNCTION private.normalize_customer_service_import_files(p_import_id uuid, p_files jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    raise exception 'ATTACHMENT_COUNT: The email exceeds 10 files including inline images' using errcode = '22023';
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
      raise exception 'ATTACHMENT_SIZE: The file is empty or exceeds 10 MB' using errcode = '22023';
    end if;
    v_total := v_total + (v_file ->> 'sizeBytes')::bigint;
    if v_total > 50000000 then
      raise exception 'ATTACHMENT_TOTAL_SIZE: The attachments exceed 50 MB per email' using errcode = '22023';
    end if;
    v_position := v_position + 1;
    v_extension := case v_mime when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' else 'png' end;
    v_manifest := v_manifest || jsonb_build_array(v_file || jsonb_build_object('objectPath',
      format('imports/%s/%s-%s.%s',p_import_id,lpad(v_position::text,2,'0'),v_file ->> 'sha256',v_extension)));
  end loop;
  return v_manifest;
end;
$function$;

-- private.record_customer_service_import_analysis
CREATE OR REPLACE FUNCTION private.record_customer_service_import_analysis(p_import_id uuid, p_report jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    error_message = case when v_outcome = 'NEEDS_ATTENTION' then 'An automatic request could not be prepared. Review the analysis details and the original email.'
      when error_code in ('ANALYSIS_FAILED','ANALYSIS_INCOMPLETE') then null else error_message end
  where id = p_import_id;
  return jsonb_build_object('importId',p_import_id,'requestId',null,'idempotentReplay',false,'analysisPayload',p_report);
end;
$function$;

-- private.save_customer_service_imported_request_with_source
CREATE OR REPLACE FUNCTION private.save_customer_service_imported_request_with_source(p_import_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      error_message = 'The email and all its attachments must be validated and stored before the request is created.'
      where id = p_import_id;
  end if;
  return private.customer_service_import_source_result(p_import_id);
end;
$function$;

-- valtrim.claim_customer_service_email_import
CREATE OR REPLACE FUNCTION valtrim.claim_customer_service_email_import(p_import_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        error_code = 'WORKER_RETRIES_EXHAUSTED',error_message = 'Processing was repeatedly interrupted. It requires review or an authorized retry.'
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

-- valtrim.claim_customer_service_email_import_v2
CREATE OR REPLACE FUNCTION valtrim.claim_customer_service_email_import_v2(p_import_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        error_code = 'WORKER_RETRIES_EXHAUSTED',error_message = 'Processing was repeatedly interrupted. It requires review or an authorized retry.'
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

-- valtrim.finish_customer_service_email_sync
CREATE OR REPLACE FUNCTION valtrim.finish_customer_service_email_sync(p_connection_id uuid, p_sync_token uuid, p_expected_revision bigint, p_error_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_row private.customer_service_email_connections%rowtype; v_message text;
begin
  v_row := private.lock_customer_service_email_sync(p_connection_id,p_sync_token,p_expected_revision);
  v_message := case p_error_code
    when 'AUTH_FAILED' then 'Microsoft could not authenticate the application. Review its credentials.'
    when 'FORBIDDEN' then 'The application does not have access to the configured mailbox.'
    when 'FOLDER_NOT_FOUND' then 'The configured folder is unavailable.'
    when 'GRAPH_THROTTLED' then 'Microsoft temporarily throttled requests. Try again later.'
    when 'GRAPH_UNAVAILABLE' then 'Microsoft is temporarily unavailable.'
    when 'CURSOR_EXPIRED' then 'The sync requires a controlled reinitialization. Its progress was not discarded.'
    when 'SYNC_INTERRUPTED' then 'The sync was interrupted. The last confirmed progress is kept.'
    when 'SYNC_ERROR' then 'The sync could not be completed. Review the connection.'
    else null end;
  if p_error_code is not null and v_message is null then
    raise exception 'Use a known sanitized connection error code' using errcode = '22023';
  end if;
  -- Null means yield, NOT success. Never accept raw provider diagnostics/tokens.
  update private.customer_service_email_connections set sync_token = null,sync_lease_expires_at = null,
    last_finished_at = clock_timestamp(),
    last_error_code = coalesce(p_error_code,last_error_code),
    last_error_message = coalesce(v_message,last_error_message),
    last_error_at = case when p_error_code is not null then clock_timestamp() else last_error_at end
    where id = p_connection_id returning * into v_row;
  return to_jsonb(v_row);
end;
$function$;

-- valtrim.finish_customer_service_email_worker
CREATE OR REPLACE FUNCTION valtrim.finish_customer_service_email_worker(p_import_id uuid, p_worker_token uuid, p_action text, p_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      error_message = case when v_retry then 'Temporary failure. A new processing attempt was scheduled.'
        else 'The automatic import could not be completed. Review the analysis and the original email.' end
      where id = p_import_id;
  end if;
  select * into v_import from valtrim.service_request_imports where id = p_import_id;
  return jsonb_build_object('importId',p_import_id,'requestId',v_import.request_id,'status',v_import.status,
    'errorCode',v_import.error_code,'nextAttemptAt',v_import.next_attempt_at,'idempotentReplay',false);
end;
$function$;

-- valtrim.hold_customer_service_email_retry
CREATE OR REPLACE FUNCTION valtrim.hold_customer_service_email_retry(p_import_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        then 'Temporary failure. Progress was kept; continue after the indicated wait.'
        else 'The analysis kept its progress. Select Continue analysis to process the remaining sources.' end
    where id = p_import_id returning * into v_import;
  end if;
  return jsonb_build_object('importId',p_import_id,'requestId',v_import.request_id,'status',v_import.status,
    'errorCode',v_import.error_code,'nextAttemptAt',v_import.next_attempt_at);
end;
$function$;

-- valtrim.recover_customer_service_email_import
CREATE OR REPLACE FUNCTION valtrim.recover_customer_service_email_import(p_import_id uuid, p_expected_updated_at timestamp with time zone, p_payload jsonb, p_source jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    error_message = case when v_pdf then 'The request was saved. The recovery PDF upload still needs to be completed.' else null end,
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
