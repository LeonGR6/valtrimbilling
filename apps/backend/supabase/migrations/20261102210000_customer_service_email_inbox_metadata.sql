-- Readable inbox headers and authoritative per-item refresh; no bodies/files.
begin;
alter table private.customer_service_email_missing_messages
  add column subject text check (subject is null or char_length(subject) <= 1000),
  add column sender text check (sender is null or char_length(sender) <= 1000),
  add column received_at timestamptz,
  add column metadata_updated_at timestamptz;

-- Keep the old scan signature for already deployed inventory workers. The new
-- wrapper commits the page and its projected headers in the same transaction.
create function valtrim.finish_customer_service_email_folder_scan_metadata(
  p_connection_id uuid,p_token uuid,p_message_ids text[],p_next_url text,
  p_web_links jsonb,p_message_metadata jsonb)
returns void language plpgsql security definer set search_path = '' as $function$
declare x jsonb; v_received timestamptz;
begin
  perform private.require_customer_service_email_system();
  if p_message_metadata is null or jsonb_typeof(p_message_metadata) <> 'array' then
    raise exception 'Invalid inbox header metadata' using errcode = '22023';
  end if;
  if jsonb_array_length(p_message_metadata) > 1000 or private.customer_service_import_has_binary(p_message_metadata)
    or (select count(*) from jsonb_array_elements(p_message_metadata)) <>
      (select count(distinct value ->> 'messageId') from jsonb_array_elements(p_message_metadata)) then
    raise exception 'Invalid inbox header metadata' using errcode = '22023';
  end if;
  for x in select value from jsonb_array_elements(p_message_metadata) loop
    if jsonb_typeof(x) <> 'object' or x - array['messageId','subject','sender','receivedAt'] <> '{}'
      or not (x ?& array['messageId','subject','sender','receivedAt'])
      or jsonb_typeof(x -> 'messageId') is distinct from 'string'
      or not coalesce((x ->> 'messageId') = any(p_message_ids),false)
      or jsonb_typeof(x -> 'subject') not in ('null','string')
      or jsonb_typeof(x -> 'sender') not in ('null','string')
      or jsonb_typeof(x -> 'receivedAt') not in ('null','string')
      or char_length(x ->> 'subject') > 1000 or char_length(x ->> 'sender') > 1000
      or char_length(x ->> 'receivedAt') > 80 then
      raise exception 'Invalid inbox header metadata' using errcode = '22023';
    end if;
    begin
      v_received := (x ->> 'receivedAt')::timestamptz;
      if v_received is not null and not isfinite(v_received) then raise datetime_field_overflow; end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Invalid inbox received date' using errcode = '22023';
    end;
  end loop;
  perform valtrim.finish_customer_service_email_folder_scan(p_connection_id,p_token,p_message_ids,p_next_url,
    p_web_links => p_web_links);
  for x in select value from jsonb_array_elements(p_message_metadata) loop
    update private.customer_service_email_missing_messages m set subject = x ->> 'subject',sender = x ->> 'sender',
      received_at = (x ->> 'receivedAt')::timestamptz,metadata_updated_at = clock_timestamp()
      where m.connection_id = p_connection_id and m.message_id = x ->> 'messageId'
        and row(m.subject,m.sender,m.received_at) is distinct from row(x ->> 'subject',x ->> 'sender',(x ->> 'receivedAt')::timestamptz);
  end loop;
end;
$function$;
revoke all on function valtrim.finish_customer_service_email_folder_scan_metadata(uuid,uuid,text[],text,jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function valtrim.finish_customer_service_email_folder_scan_metadata(uuid,uuid,text[],text,jsonb,jsonb) to service_role;

create or replace view private.customer_service_email_inbox_items as
select i.id,'IMPORT'::text source_kind,
  case when r.id is not null and i.status = 'PROCESSED' then 'REGISTERED'
    when i.status in ('PENDING','PROCESSING') and i.source_status <> 'REJECTED' then 'PROCESSING'
    else 'REQUIRES_ACTION' end state,
  case when r.id is not null and i.status = 'PROCESSED' then null when i.status = 'PROCESSED' then 'LINKED_REQUEST_REMOVED'
    else i.error_code end reason_code,
  i.source_payload ->> 'subject' subject,i.source_payload -> 'from' sender,
  i.source_payload ->> 'webLink' web_link,i.created_at,greatest(i.updated_at,r.updated_at) updated_at,i.last_attempt_at,
  r.id request_id,r.folio request_folio,r.workflow_stage::text request_workflow_stage,
  null::text previous_request_folio,null::uuid confirmed_by,null::timestamptz confirmed_at,0::bigint resolution_version,
  null::timestamptz received_at,i.status::text import_status,i.source_status source_status,
  i.next_attempt_at,i.updated_at import_updated_at,i.error_message
from valtrim.service_request_imports i
join private.customer_service_email_connections c on c.tenant_id = i.tenant_id
  and c.mailbox_id::text = i.mailbox_id collate "C" and (i.source_connection_id is null or i.source_connection_id = c.id)
join private.customer_service_email_automation a on a.connection_id = c.id and a.singleton
left join valtrim.service_requests r on r.id = i.request_id and r.email_import_id = i.id
union all
select m.id,'FOLDER_MESSAGE',case when r.id is not null then 'REGISTERED' else 'REQUIRES_ACTION' end,
  case when r.id is not null then 'CONFIRMED_EXISTING_REQUEST'
    when l.connection_id is not null then 'LINKED_REQUEST_REMOVED' else 'NO_IMPORT' end,
  m.subject,to_jsonb(m.sender),m.web_link,m.first_seen_at,
  greatest(l.updated_at,m.first_seen_at,m.metadata_updated_at,r.updated_at),null::timestamptz,
  r.id,r.folio,r.workflow_stage::text,l.request_folio,l.confirmed_by,l.confirmed_at,coalesce(l.version,0),m.received_at,
  null::text,null::text,null::timestamptz,null::timestamptz,null::text
from private.customer_service_email_missing_messages m
join private.customer_service_email_connections c on c.id = m.connection_id
join private.customer_service_email_automation a on a.connection_id = c.id and a.singleton
left join private.customer_service_email_message_resolutions l on l.connection_id = m.connection_id and l.message_id = m.message_id
left join valtrim.service_requests r on r.id = l.request_id
where m.first_seen_at < now() - interval '2 minutes'
  and not exists(select 1 from valtrim.service_request_imports i where i.tenant_id = c.tenant_id
    and i.mailbox_id = c.mailbox_id::text collate "C" and i.provider_message_id = m.message_id);

create function private.customer_service_email_inbox_result(v private.customer_service_email_inbox_items)
returns jsonb language sql stable set search_path = '' as $function$
  select jsonb_build_object('id',v.id,'sourceKind',v.source_kind,'state',v.state,
    'reasonCode',v.reason_code,'subject',v.subject,'sender',v.sender,'webLink',v.web_link,
    'createdAt',v.created_at,'updatedAt',v.updated_at,'lastAttemptAt',v.last_attempt_at,'receivedAt',v.received_at,
    'requestId',v.request_id,'requestFolio',v.request_folio,'requestWorkflowStage',v.request_workflow_stage,
    'previousRequestFolio',v.previous_request_folio,'confirmedBy',v.confirmed_by,'confirmedAt',v.confirmed_at,
    'resolutionVersion',v.resolution_version,'importStatus',v.import_status,'sourceStatus',v.source_status,
    'nextAttemptAt',v.next_attempt_at,'importUpdatedAt',v.import_updated_at,'errorMessage',v.error_message);
$function$;
revoke all on function private.customer_service_email_inbox_result(private.customer_service_email_inbox_items)
  from public,anon,authenticated,service_role;

create or replace function valtrim.list_customer_service_email_inbox(p_state text default null,p_limit integer default 50,p_offset integer default 0)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $function$
begin
  perform private.require_customer_service_actor();
  if p_state is not null and p_state not in ('PROCESSING','REQUIRES_ACTION','REGISTERED')
    or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset < 0 then
    raise exception 'Invalid inbox state or pagination' using errcode = '22023';
  end if;
  return query select private.customer_service_email_inbox_result(v)
    from private.customer_service_email_inbox_items v where p_state is null or v.state = p_state
    order by v.updated_at desc,v.source_kind,v.id limit p_limit offset p_offset;
end;
$function$;

create function valtrim.read_customer_service_email_inbox_item(p_source_kind text,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
begin
  perform private.require_customer_service_actor();
  if p_id is null or p_source_kind is null or p_source_kind not in ('IMPORT','FOLDER_MESSAGE') then
    raise exception 'Invalid inbox item identity' using errcode = '22023';
  end if;
  return (select private.customer_service_email_inbox_result(v) from private.customer_service_email_inbox_items v
    where v.id = p_id and v.source_kind = p_source_kind);
end;
$function$;
revoke all on function valtrim.read_customer_service_email_inbox_item(text,uuid) from public,anon,authenticated,service_role;
grant execute on function valtrim.read_customer_service_email_inbox_item(text,uuid) to authenticated;

comment on function valtrim.read_customer_service_email_inbox_item(text,uuid) is
  'Authoritative refresh after retries/confirmations. Summary metadata only; verifies current request link, not a predicted AI result.';
commit;
