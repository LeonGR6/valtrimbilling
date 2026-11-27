-- Bound selective homeowner-name repair without invalidating paid image work.
-- Optional metadata: historical source/report/checkpoint payloads remain valid.
begin;

create or replace function private.validate_customer_service_import_source_v2(p_import_id uuid,p_source jsonb)
returns void language plpgsql set search_path = '' as $function$
declare v_import valtrim.service_request_imports%rowtype; v_file jsonb;
begin
  select * into strict v_import from valtrim.service_request_imports where id = p_import_id;
  if p_source is null or jsonb_typeof(p_source) <> 'object'
    or p_source - array['sourceId','kind','attachmentId','fileId','filename','sha256','status','model',
      'structuredData','text','pages','formFields','part','usageInfo','error','contactNameVersion'] <> '{}'
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
  if p_source ? 'contactNameVersion' then
    if p_source ->> 'kind' <> 'EMAIL' or p_source ->> 'status' <> 'ANALYZED'
      or (case when jsonb_typeof(p_source -> 'contactNameVersion') = 'number'
        and (p_source ->> 'contactNameVersion') ~ '^[1-9][0-9]{0,9}$'
        then (p_source ->> 'contactNameVersion')::numeric > 2147483647 else true end) then
      raise exception 'Contact name version requires successful email analysis and a positive integer' using errcode = '22023';
    end if;
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

comment on function private.validate_customer_service_import_source_v2(uuid,jsonb) is
  'Validates extracted V2 facts; optional EMAIL contactNameVersion bounds selective name repair without invalidating legacy checkpoints.';

commit;
