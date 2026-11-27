-- Email block 4: retained per-source analysis and a validated intake proposal.
-- No mailbox connection, public inference endpoint, worker or request creation.
begin;
alter table valtrim.service_request_imports
  add column analysis_payload jsonb,
  add column analysis_created_at timestamptz,
  add constraint service_request_imports_analysis_check check (
    (analysis_payload is null and analysis_created_at is null)
    or (analysis_payload is not null and jsonb_typeof(analysis_payload) = 'object' and analysis_created_at is not null)
  );

create function private.guard_customer_service_import_analysis()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if old.request_id is not null and row(new.analysis_payload,new.analysis_created_at)
    is distinct from row(old.analysis_payload,old.analysis_created_at) then
    raise exception 'Analysis linked to an existing request cannot be replaced' using errcode = '55000';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_customer_service_import_analysis() from public,anon,authenticated,service_role;
create trigger service_request_imports_guard_analysis before update on valtrim.service_request_imports
for each row execute function private.guard_customer_service_import_analysis();

create function valtrim.record_customer_service_import_analysis(p_import_id uuid,p_report jsonb)
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
    if v_source ->> 'kind' = 'EMAIL' then
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
  if exists(select 1 from jsonb_array_elements(v_import.attachment_refs) file where not exists(
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
revoke all on function valtrim.record_customer_service_import_analysis(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function valtrim.record_customer_service_import_analysis(uuid,jsonb) to service_role;

comment on column valtrim.service_request_imports.analysis_payload is
  'Per-source OCR/vision/form facts, evidence, conflicts and proposed intake; kept separate from the block-2 extraction_payload and immutable once a request is linked.';
notify pgrst, 'reload schema';
commit;
