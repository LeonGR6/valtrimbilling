-- Human-confirmed email/request links. No import, Graph call, binary or approval.
begin;

alter table private.customer_service_email_missing_messages
  add column id uuid not null default gen_random_uuid(),
  add constraint customer_service_email_missing_messages_id_uq unique(id);

create table private.customer_service_email_message_resolutions (
  connection_id uuid not null references private.customer_service_email_connections(id),
  message_id text collate "C" not null check (octet_length(message_id) between 1 and 2048
    and message_id = btrim(message_id) and message_id !~ '[[:cntrl:]]'),
  request_id bigint references valtrim.service_requests(id) on delete set null,
  request_folio text not null,
  confirmed_by uuid references valtrim.app_users(id) on delete set null,
  confirmed_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  version bigint not null default 1 check (version > 0),
  primary key(connection_id,message_id)
);
alter table private.customer_service_email_message_resolutions enable row level security;
revoke all on private.customer_service_email_message_resolutions from public,anon,authenticated,service_role;
create index customer_service_email_message_resolutions_request_idx
  on private.customer_service_email_message_resolutions(request_id) where request_id is not null;

create function private.version_customer_service_email_resolution()
returns trigger language plpgsql set search_path = '' as $function$
begin
  new.version := old.version + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$function$;
revoke all on function private.version_customer_service_email_resolution() from public,anon,authenticated,service_role;
create trigger customer_service_email_resolution_version before update
  on private.customer_service_email_message_resolutions for each row
  execute function private.version_customer_service_email_resolution();

-- One projection for the future inbox: successful request creation is distinct
-- from the human review/approval stage. No provider IDs, bodies or files leave it.
create view private.customer_service_email_inbox_items as
select i.id,'IMPORT'::text source_kind,
  case when r.id is not null and i.status = 'PROCESSED' then 'REGISTERED'
    when i.status in ('PENDING','PROCESSING') and i.source_status <> 'REJECTED' then 'PROCESSING'
    else 'REQUIRES_ACTION' end state,
  case when r.id is not null and i.status = 'PROCESSED' then null when i.status = 'PROCESSED' then 'LINKED_REQUEST_REMOVED'
    else i.error_code end reason_code,
  i.source_payload ->> 'subject' subject,i.source_payload -> 'from' sender,
  i.source_payload ->> 'webLink' web_link,i.created_at,greatest(i.updated_at,r.updated_at) updated_at,i.last_attempt_at,
  r.id request_id,r.folio request_folio,r.workflow_stage::text request_workflow_stage,
  null::text previous_request_folio,null::uuid confirmed_by,null::timestamptz confirmed_at,0::bigint resolution_version
from valtrim.service_request_imports i
join private.customer_service_email_connections c on c.tenant_id = i.tenant_id
  and c.mailbox_id::text = i.mailbox_id collate "C" and (i.source_connection_id is null or i.source_connection_id = c.id)
join private.customer_service_email_automation a on a.connection_id = c.id and a.singleton
left join valtrim.service_requests r on r.id = i.request_id and r.email_import_id = i.id
union all
select m.id,'FOLDER_MESSAGE',case when r.id is not null then 'REGISTERED' else 'REQUIRES_ACTION' end,
  case when r.id is not null then 'CONFIRMED_EXISTING_REQUEST'
    when l.connection_id is not null then 'LINKED_REQUEST_REMOVED' else 'NO_IMPORT' end,
  null::text,null::jsonb,m.web_link,m.first_seen_at,greatest(l.updated_at,m.first_seen_at,r.updated_at),null::timestamptz,
  r.id,r.folio,r.workflow_stage::text,l.request_folio,l.confirmed_by,l.confirmed_at,coalesce(l.version,0)
from private.customer_service_email_missing_messages m
join private.customer_service_email_connections c on c.id = m.connection_id
join private.customer_service_email_automation a on a.connection_id = c.id and a.singleton
left join private.customer_service_email_message_resolutions l on l.connection_id = m.connection_id and l.message_id = m.message_id
left join valtrim.service_requests r on r.id = l.request_id
where m.first_seen_at < now() - interval '2 minutes'
  and not exists(select 1 from valtrim.service_request_imports i where i.tenant_id = c.tenant_id
    and i.mailbox_id = c.mailbox_id::text collate "C" and i.provider_message_id = m.message_id);
revoke all on private.customer_service_email_inbox_items from public,anon,authenticated,service_role;

create function valtrim.list_customer_service_email_inbox(p_state text default null,p_limit integer default 50,p_offset integer default 0)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $function$
begin
  perform private.require_customer_service_actor();
  if p_state is not null and p_state not in ('PROCESSING','REQUIRES_ACTION','REGISTERED')
    or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset < 0 then
    raise exception 'Invalid inbox state or pagination' using errcode = '22023';
  end if;
  return query select jsonb_build_object('id',v.id,'sourceKind',v.source_kind,'state',v.state,
    'reasonCode',v.reason_code,'subject',v.subject,'sender',v.sender,'webLink',v.web_link,
    'createdAt',v.created_at,'updatedAt',v.updated_at,'lastAttemptAt',v.last_attempt_at,
    'requestId',v.request_id,'requestFolio',v.request_folio,'requestWorkflowStage',v.request_workflow_stage,
    'previousRequestFolio',v.previous_request_folio,'confirmedBy',v.confirmed_by,'confirmedAt',v.confirmed_at,
    'resolutionVersion',v.resolution_version)
    from private.customer_service_email_inbox_items v where p_state is null or v.state = p_state
    order by v.updated_at desc,v.source_kind,v.id limit p_limit offset p_offset;
end;
$function$;

create function valtrim.count_customer_service_email_inbox()
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
begin
  perform private.require_customer_service_actor();
  return (select jsonb_build_object('processing',count(*) filter(where state = 'PROCESSING'),
    'requiresAction',count(*) filter(where state = 'REQUIRES_ACTION'),
    'registered',count(*) filter(where state = 'REGISTERED'),'total',count(*),
    'revision',count(*)::text || ':' || coalesce(max(updated_at)::text,''))
    from private.customer_service_email_inbox_items);
end;
$function$;

create function valtrim.confirm_customer_service_email_request(p_message_id uuid,p_request_id bigint,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_actor uuid := private.require_customer_service_actor();
  m private.customer_service_email_missing_messages%rowtype;
  c private.customer_service_email_connections%rowtype;
  l private.customer_service_email_message_resolutions%rowtype;
  r valtrim.service_requests%rowtype;
  v_previous_request bigint; v_previous_version bigint; v_previous_folio text;
begin
  if p_message_id is null or p_request_id is null or p_expected_version is null or p_expected_version < 0 then
    raise exception 'Email, existing request and expected version are required' using errcode = '22023';
  end if;
  select * into m from private.customer_service_email_missing_messages where id = p_message_id;
  if not found then raise exception 'Folder message not found. Refresh the inbox' using errcode = 'P0002'; end if;
  select * into c from private.customer_service_email_connections where id = m.connection_id for update;
  if not exists(select 1 from private.customer_service_email_automation where singleton and connection_id = c.id) then
    raise exception 'Email does not belong to the configured inbox' using errcode = '42501';
  end if;
  if c.sync_token is not null and c.sync_lease_expires_at > clock_timestamp() then
    raise exception 'Synchronization is active. Refresh and try again' using errcode = '55000';
  end if;
  -- Same per-message lock as the insert guard; concurrent registration cannot
  -- slip between the no-import check and this human confirmation.
  perform pg_advisory_xact_lock(hashtextextended(c.tenant_id::text || ':' || c.mailbox_id::text || ':' || m.message_id,830176221));
  select * into m from private.customer_service_email_missing_messages where id = p_message_id for update;
  if not found then raise exception 'Folder message not found. Refresh the inbox' using errcode = 'P0002'; end if;
  if exists(select 1 from valtrim.service_request_imports i where i.tenant_id = c.tenant_id
    and i.mailbox_id = c.mailbox_id::text collate "C" and i.provider_message_id = m.message_id) then
    raise exception 'Email already has an import. Use its current result' using errcode = '55000';
  end if;
  select * into r from valtrim.service_requests where id = p_request_id for key share;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if r.email_import_id is not null and not exists(select 1 from valtrim.service_request_imports i
    where i.id = r.email_import_id and i.tenant_id = c.tenant_id and i.mailbox_id = c.mailbox_id::text collate "C"
      and (i.source_connection_id is null or i.source_connection_id = c.id)) then
    raise exception 'Request belongs to another mailbox or connection' using errcode = '42501';
  end if;
  select * into l from private.customer_service_email_message_resolutions
    where connection_id = c.id and message_id = m.message_id for update;
  if l.request_id = r.id then
    return jsonb_build_object('id',m.id,'state','REGISTERED','requestId',r.id,'requestFolio',r.folio,
      'requestWorkflowStage',r.workflow_stage,'resolutionVersion',l.version,'idempotentReplay',true);
  end if;
  if coalesce(l.version,0) <> p_expected_version then
    raise exception 'Email resolution changed. Refresh before confirming' using errcode = '40001';
  end if;
  if l.request_id is not null then
    raise exception 'Email is already linked to another request' using errcode = '55000';
  end if;
  v_previous_request := l.request_id; v_previous_version := coalesce(l.version,0); v_previous_folio := l.request_folio;
  insert into private.customer_service_email_message_resolutions(connection_id,message_id,request_id,request_folio,confirmed_by)
    values(c.id,m.message_id,r.id,r.folio,v_actor)
    on conflict(connection_id,message_id) do update set request_id = excluded.request_id,request_folio = excluded.request_folio,
      confirmed_by = excluded.confirmed_by,confirmed_at = clock_timestamp() returning * into l;
  insert into valtrim.audit_events(module,action,actor_type,actor_user_id,actor_name,actor_email,actor_role,
    entity_type,entity_id,summary,previous_values,new_values,metadata)
    select 'CUSTOMER_SERVICE','SERVICE_EMAIL_EXISTING_REQUEST_CONFIRMED','USER',id,name,email,role::text,
      'SERVICE_EMAIL_FOLDER_MESSAGE',m.id::text,'Email confirmed as corresponding to an existing request.',
      jsonb_build_object('requestId',v_previous_request,'requestFolio',v_previous_folio,'resolutionVersion',v_previous_version),
      jsonb_build_object('requestId',r.id,'requestFolio',r.folio,'resolutionVersion',l.version),
      jsonb_build_object('messageId',m.id,'reason','EXISTING_REQUEST_CONFIRMED')
      from valtrim.app_users where id = v_actor;
  return jsonb_build_object('id',m.id,'state','REGISTERED','requestId',r.id,'requestFolio',r.folio,
    'requestWorkflowStage',r.workflow_stage,'resolutionVersion',l.version,'idempotentReplay',false);
end;
$function$;

-- Defense for older/manual registrars as well as the new delta adapter.
create function private.guard_customer_service_resolved_email_import()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || ':' || new.mailbox_id || ':' || new.provider_message_id,830176221));
  if exists(select 1 from private.customer_service_email_message_resolutions l
    join private.customer_service_email_connections c on c.id = l.connection_id
    join valtrim.service_requests r on r.id = l.request_id
    where c.tenant_id = new.tenant_id and c.mailbox_id::text = new.mailbox_id collate "C"
      and l.message_id = new.provider_message_id) then
    raise exception 'Email is linked to an existing request' using errcode = '23505';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_customer_service_resolved_email_import() from public,anon,authenticated,service_role;
create trigger customer_service_resolved_email_import_guard before insert on valtrim.service_request_imports
  for each row execute function private.guard_customer_service_resolved_email_import();

create function valtrim.read_customer_service_email_resolved_matches(
  p_connection_id uuid,p_sync_token uuid,p_expected_revision bigint,p_message_ids text[])
returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  perform private.lock_customer_service_email_sync(p_connection_id,p_sync_token,p_expected_revision);
  if p_message_ids is null or cardinality(p_message_ids) > 1000 or exists(select 1 from unnest(p_message_ids) m
    where m is null or octet_length(m) not between 1 and 2048 or m <> btrim(m) or m ~ '[[:cntrl:]]') then
    raise exception 'Invalid page message identities' using errcode = '22023';
  end if;
  return (select coalesce(jsonb_agg(l.message_id order by l.message_id),'[]')
    from private.customer_service_email_message_resolutions l join valtrim.service_requests r on r.id = l.request_id
    where l.connection_id = p_connection_id and l.message_id = any(p_message_ids));
end;
$function$;

-- Preserve the existing status response while removing resolved messages from
-- its pending count. The new UUID is opaque; Graph identities remain private.
create or replace function valtrim.read_customer_service_email_automation_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare a private.customer_service_email_automation%rowtype; c private.customer_service_email_connections%rowtype;
  v_missing bigint; v_revision text;
begin
  perform private.require_customer_service_actor();
  select * into a from private.customer_service_email_automation where singleton;
  select * into c from private.customer_service_email_connections where id = a.connection_id;
  select count(*) into v_missing from private.customer_service_email_inbox_items
    where source_kind = 'FOLDER_MESSAGE' and state = 'REQUIRES_ACTION';
  select count(*)::text || ':' || coalesce(max(updated_at)::text,'') into v_revision from valtrim.service_requests;
  return jsonb_build_object('configured',a.connection_id is not null,'enabled',coalesce(a.enabled,false),
    'lastTickAt',a.last_tick_at,'lastSyncAt',c.last_success_at,'connectionError',c.last_error_code,
    'errorCode',a.error_code,'missingCount',coalesce(v_missing,0),'requestRevision',v_revision,
    'missingMessages',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'webLink',m.web_link,'detectedAt',m.created_at,
      'reasonCode',m.reason_code,'resolutionVersion',m.resolution_version)),'[]'::jsonb)
      from (select * from private.customer_service_email_inbox_items
        where source_kind = 'FOLDER_MESSAGE' and state = 'REQUIRES_ACTION' order by created_at,id limit 20) m),
    'problemCount',(select count(*) from valtrim.service_request_imports where status = 'NEEDS_ATTENTION'),
    'inboxCounts',valtrim.count_customer_service_email_inbox(),
    'scan',(select jsonb_build_object('lastCompletedAt',completed_at,'errorCode',error_code) from private.customer_service_email_folder_scan where connection_id = a.connection_id),
    'dispatches',(select jsonb_agg(jsonb_build_object('kind',kind,'startedAt',started_at,'finishedAt',finished_at,
      'lastSuccessAt',last_success_at,'inFlight',request_id is not null,'outcome',outcome,'httpStatus',http_status,'errorCode',error_code)) from private.customer_service_email_dispatch));
end;
$function$;

revoke all on function valtrim.list_customer_service_email_inbox(text,integer,integer),
  valtrim.count_customer_service_email_inbox(),valtrim.confirm_customer_service_email_request(uuid,bigint,bigint)
  from public,anon,authenticated,service_role;
grant execute on function valtrim.list_customer_service_email_inbox(text,integer,integer),
  valtrim.count_customer_service_email_inbox(),valtrim.confirm_customer_service_email_request(uuid,bigint,bigint) to authenticated;
revoke all on function valtrim.read_customer_service_email_resolved_matches(uuid,uuid,bigint,text[])
  from public,anon,authenticated,service_role;
grant execute on function valtrim.read_customer_service_email_resolved_matches(uuid,uuid,bigint,text[]) to service_role;

comment on table private.customer_service_email_message_resolutions is
  'Human-confirmed links only. No inference by subject/address, email bodies, files, approval or bulk resolution. A deleted target reopens the item.';
commit;
