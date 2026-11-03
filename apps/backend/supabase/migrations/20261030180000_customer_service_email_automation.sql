-- Minute polling, conditional worker dispatch and independent metadata checks.
-- Installs PAUSED. No credentials, connection reset, import, upload or approval.
begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table private.customer_service_email_automation (
  singleton boolean primary key default true check (singleton),
  connection_id uuid not null references private.customer_service_email_connections(id),
  project_url text not null check (project_url ~ '^https://[a-z0-9]{20}[.]supabase[.]co$'),
  enabled boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  last_tick_at timestamptz,
  error_code text
);
create table private.customer_service_email_dispatch (
  kind text primary key check (kind in ('SYNC','WORKER','RECONCILE')),
  request_id bigint,
  invocation_id uuid,
  target_id uuid,
  expires_ms bigint,
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  last_success_at timestamptz,
  retry_not_before timestamptz,
  failures integer not null default 0,
  outcome text,
  http_status integer check (http_status between 100 and 599),
  error_code text
);
insert into private.customer_service_email_dispatch(kind) values ('SYNC'),('WORKER'),('RECONCILE');
create table private.customer_service_email_folder_scan (
  connection_id uuid primary key references private.customer_service_email_connections(id),
  scan_id uuid,
  next_url text check (next_url is null or octet_length(next_url) <= 16384),
  token uuid,
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  retry_not_before timestamptz,
  error_code text,
  check ((token is null) = (lease_expires_at is null))
);
create table private.customer_service_email_missing_messages (
  connection_id uuid not null references private.customer_service_email_connections(id),
  message_id text collate "C" not null check (
    octet_length(message_id) between 1 and 2048 and message_id = btrim(message_id)
    and message_id !~ '[[:cntrl:]]'
  ),
  scan_id uuid not null,
  web_link text check (web_link is null or (octet_length(web_link) <= 8192 and web_link !~ '[[:space:][:cntrl:]]'
    and web_link ~ '^https://outlook[.](office[.]com|office365[.]com|cloud[.]microsoft|live[.]com)/')),
  first_seen_at timestamptz not null default clock_timestamp(),
  primary key(connection_id,message_id)
);
alter table private.customer_service_email_automation enable row level security;
alter table private.customer_service_email_dispatch enable row level security;
alter table private.customer_service_email_folder_scan enable row level security;
alter table private.customer_service_email_missing_messages enable row level security;
revoke all on private.customer_service_email_automation,private.customer_service_email_dispatch,
  private.customer_service_email_folder_scan,private.customer_service_email_missing_messages
  from public,anon,authenticated,service_role;
-- Supabase owns pg_net and may grant PUBLIC access to its unlogged queue.
-- NEVER enqueue permanent credentials. Use a signed, expiring, single-use
-- invocation instead; the permanent secrets are read only inside the definer.

create index service_request_imports_automation_queue_idx
  on valtrim.service_request_imports(tenant_id,mailbox_id,next_attempt_at,created_at,id)
  where request_id is null and source_status = 'AVAILABLE';

-- Exactly the worker's eligibility rules, including expired reservations whose
-- failure budget must be finalized by the worker, not silently filtered out.
create function private.customer_service_email_eligible(p_connection_id uuid)
returns uuid language sql stable set search_path = '' as $function$
  select i.id from valtrim.service_request_imports i
  join private.customer_service_email_connections c on c.id = p_connection_id
  where i.tenant_id = c.tenant_id and i.mailbox_id = c.mailbox_id::text collate "C"
    and (i.source_connection_id is null or i.source_connection_id = c.id)
    and i.request_id is null and i.source_status = 'AVAILABLE'
    and ((i.worker_token is null and i.status = 'PENDING' and (i.next_attempt_at is null or i.next_attempt_at <= now()))
      or (i.worker_token is not null and i.worker_lease_expires_at <= now())
      or (i.worker_token is null and i.status = 'PROCESSING' and i.processing_started_at < now() - interval '3 minutes'))
  order by coalesce(i.next_attempt_at,i.created_at),i.created_at,i.id limit 1
$function$;
revoke all on function private.customer_service_email_eligible(uuid) from public,anon,authenticated,service_role;

create function private.collect_customer_service_email_dispatch()
returns void language plpgsql set search_path = '' as $function$
declare d private.customer_service_email_dispatch%rowtype; r record; v_body jsonb; v_status text; v_error text;
begin
  for d in select * from private.customer_service_email_dispatch where request_id is not null for update loop
    select * into r from net._http_response where id = d.request_id;
    if not found and d.started_at > clock_timestamp() - interval '3 minutes' then continue; end if;
    v_body := null; v_status := null; v_error := null;
    if r.id is null or r.timed_out then v_error := 'HTTP_TIMEOUT';
    elsif r.status_code is null or r.status_code not between 200 and 299 then v_error := 'HTTP_ERROR';
    else
      begin v_body := r.content::jsonb; exception when others then v_body := null; end;
      v_status := v_body ->> 'status';
      if v_status is null or v_status not in ('IDLE','ROUND_COMPLETE','PAGE_RETAINED','PROCESSED','PENDING',
        'PROCESSING','NEEDS_ATTENTION','SCAN_COMPLETE','SCAN_PAGE') then
        v_error := 'ENDPOINT_ERROR';
      elsif v_status = 'NEEDS_ATTENTION' then v_error := 'IMPORT_NEEDS_ATTENTION'; end if;
    end if;
    update private.customer_service_email_dispatch set request_id = null,finished_at = clock_timestamp(),
      http_status = case when r.status_code between 100 and 599 then r.status_code end,
      last_success_at = case when v_error is null then clock_timestamp() else last_success_at end,
      outcome = case when v_error is null then v_status else 'FAILED' end,error_code = v_error,
      failures = case when v_error is null then 0 else least(failures + 1,10) end,
      retry_not_before = case when v_error is null then null
        else clock_timestamp() + make_interval(secs => least(900,60 * power(2,least(d.failures,4))::integer)) end
      where kind = d.kind;
    -- Responses are not a business ledger; retain only the sanitized outcome.
    delete from net._http_response where id = d.request_id;
  end loop;
end;
$function$;
revoke all on function private.collect_customer_service_email_dispatch() from public,anon,authenticated,service_role;

create function valtrim.tick_customer_service_email_automation()
returns void language plpgsql security definer set search_path = '' as $function$
declare a private.customer_service_email_automation%rowtype;
  c private.customer_service_email_connections%rowtype; d private.customer_service_email_dispatch%rowtype;
  v_key text; v_import uuid; v_path text; v_body jsonb; v_id bigint;
  v_invocation uuid; v_target uuid; v_expires bigint; v_signature text;
begin
  perform private.require_customer_service_email_system();
  -- Serializes cron runs, manual ticks and any future event-triggered wakeup.
  if not pg_try_advisory_xact_lock(830176220) then return; end if;
  perform private.collect_customer_service_email_dispatch();
  select * into a from private.customer_service_email_automation where singleton for update;
  if not found or not a.enabled then return; end if;
  -- Bound only this job's technical history; never prune business audit/imports.
  delete from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'customer-service-email-minute')
    and end_time < clock_timestamp() - interval '7 days';
  update private.customer_service_email_automation set last_tick_at = clock_timestamp(),error_code = null where singleton;
  select * into c from private.customer_service_email_connections where id = a.connection_id;
  if not c.enabled then
    update private.customer_service_email_automation set error_code = 'CONNECTION_DISABLED' where singleton;
    return;
  end if;
  for d in select * from private.customer_service_email_dispatch order by kind for update loop
    if d.request_id is not null or d.retry_not_before > clock_timestamp() then continue; end if;
    v_import := null;
    if d.kind = 'SYNC' then
      if c.last_error_code = 'CURSOR_EXPIRED' or c.retry_not_before > clock_timestamp()
        or c.sync_lease_expires_at > clock_timestamp() then continue; end if;
      v_path := 'customer-service-email-sync';
      v_body := jsonb_build_object('connectionId',c.id);
    elsif d.kind = 'WORKER' then
      -- Wait for any live worker, including one started manually. A queued HTTP
      -- request is also reserved by dispatch.request_id until its response.
      if exists(select 1 from valtrim.service_request_imports where worker_token is not null
        and worker_lease_expires_at > clock_timestamp()) then continue; end if;
      v_import := private.customer_service_email_eligible(c.id);
      if v_import is null then continue; end if;
      v_path := 'customer-service-email-worker'; v_body := jsonb_build_object('importId',v_import);
    else
      if c.initialized_at is null or c.retry_not_before > clock_timestamp() then continue; end if;
      if exists(select 1 from private.customer_service_email_folder_scan where connection_id = c.id
        and (retry_not_before > clock_timestamp() or lease_expires_at > clock_timestamp())) then continue; end if;
      if not exists(select 1 from private.customer_service_email_folder_scan where connection_id = c.id
        and ((scan_id is not null and completed_at is null) or completed_at <= clock_timestamp() - interval '15 minutes'))
        and exists(select 1 from private.customer_service_email_folder_scan where connection_id = c.id) then continue; end if;
      v_path := 'customer-service-email-reconcile'; v_body := jsonb_build_object('connectionId',c.id);
    end if;
    select decrypted_secret into v_key from vault.decrypted_secrets where name = case
      when d.kind = 'WORKER' then 'customer_service_email_worker_secret' else 'customer_service_email_sync_secret' end;
    if v_key is null or char_length(btrim(v_key)) not between 32 and 512 then
      update private.customer_service_email_automation set error_code = 'VAULT_SECRET_MISSING' where singleton;
      continue;
    end if;
    begin
      v_invocation := gen_random_uuid();
      v_target := coalesce(v_import,c.id);
      v_expires := floor(extract(epoch from clock_timestamp() + interval '3 minutes') * 1000)::bigint;
      v_signature := encode(extensions.hmac(convert_to(v_invocation::text || ':' || d.kind || ':' ||
        v_expires::text || ':' || v_target::text,'UTF8'),convert_to(btrim(v_key),'UTF8'),'sha256'),'hex');
      v_id := net.http_post(url := a.project_url || '/functions/v1/' || v_path,
        headers := jsonb_build_object('Content-Type','application/json','x-valtrim-email-dispatch',v_invocation,
          'x-valtrim-email-dispatch-expires',v_expires::text,'x-valtrim-email-dispatch-signature',v_signature),
        body := v_body,timeout_milliseconds := 145000);
      update private.customer_service_email_dispatch set request_id = v_id,started_at = clock_timestamp(),
        invocation_id = v_invocation,target_id = v_target,expires_ms = v_expires,claimed_at = null where kind = d.kind;
    exception when others then
      update private.customer_service_email_dispatch set outcome = 'FAILED',error_code = 'DISPATCH_FAILED',
        finished_at = clock_timestamp(),retry_not_before = clock_timestamp() + interval '1 minute' where kind = d.kind;
    end;
  end loop;
end;
$function$;
revoke all on function valtrim.tick_customer_service_email_automation() from public,anon,authenticated,service_role;
grant execute on function valtrim.tick_customer_service_email_automation() to service_role;

create function valtrim.consume_customer_service_email_dispatch(p_invocation_id uuid,p_kind text,p_target_id uuid,p_expires_ms bigint)
returns boolean language plpgsql security definer set search_path = '' as $function$
begin
  perform private.require_customer_service_email_system();
  -- Fences queued calls on pause as well as signature replay. Claim commits
  -- before any Graph/Mistral access; lost calls can resume via durable leases.
  perform pg_advisory_xact_lock(830176220);
  if not exists(select 1 from private.customer_service_email_automation where singleton and enabled) then return false; end if;
  update private.customer_service_email_dispatch set claimed_at = clock_timestamp()
    where invocation_id = p_invocation_id and kind = p_kind and target_id = p_target_id and expires_ms = p_expires_ms
      and request_id is not null and claimed_at is null
      and expires_ms > floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  return found;
end;
$function$;
revoke all on function valtrim.consume_customer_service_email_dispatch(uuid,text,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function valtrim.consume_customer_service_email_dispatch(uuid,text,uuid,bigint) to service_role;

-- Called by an operator only after both deployments and Vault values are ready.
create function valtrim.configure_customer_service_email_automation(p_connection_id uuid,p_enabled boolean,p_project_url text default null)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare a private.customer_service_email_automation%rowtype; v_url text; v_job bigint;
begin
  perform private.require_customer_service_email_system();
  perform pg_advisory_xact_lock(830176220);
  select * into a from private.customer_service_email_automation where singleton for update;
  v_url := coalesce(p_project_url,a.project_url);
  if p_enabled is null or p_connection_id is null or v_url is null
    or v_url !~ '^https://[a-z0-9]{20}[.]supabase[.]co$' then
    raise exception 'Explicit connection, activation and valid project URL are required' using errcode = '22023';
  end if;
  if a.connection_id is not null and a.connection_id <> p_connection_id then
    raise exception 'Automation connection cannot be silently replaced' using errcode = '22023';
  end if;
  if p_enabled and not exists(select 1 from private.customer_service_email_connections
    where id = p_connection_id and enabled and initialized_at is not null) then
    raise exception 'Initialize and verify the connection before activation' using errcode = '55000';
  end if;
  if p_enabled and (select count(*) from vault.decrypted_secrets where name in
    ('customer_service_email_sync_secret','customer_service_email_worker_secret') and char_length(btrim(decrypted_secret)) between 32 and 512) <> 2 then
    raise exception 'Configure both scheduler secrets in Vault before activation' using errcode = '55000';
  end if;
  select jobid into v_job from cron.job where jobname = 'customer-service-email-minute';
  if v_job is null then raise exception 'Customer Service cron job is missing' using errcode = '55000'; end if;
  insert into private.customer_service_email_automation(singleton,connection_id,project_url,enabled)
    values(true,p_connection_id,v_url,p_enabled) on conflict(singleton) do update set
    enabled = excluded.enabled,project_url = excluded.project_url,updated_at = clock_timestamp(),error_code = null;
  perform cron.alter_job(v_job,active := p_enabled);
  insert into valtrim.audit_events(module,action,actor_type,actor_name,entity_type,entity_id,summary,metadata)
    values('CUSTOMER_SERVICE','SERVICE_EMAIL_AUTOMATION_CONFIGURED','SYSTEM','Email automation operator',
      'EMAIL_CONNECTION',p_connection_id::text,case when p_enabled then 'Email automation enabled' else 'Email automation paused' end,
      jsonb_build_object('enabled',p_enabled));
  return jsonb_build_object('connectionId',p_connection_id,'enabled',p_enabled,'intervalSeconds',60);
end;
$function$;
revoke all on function valtrim.configure_customer_service_email_automation(uuid,boolean,text) from public,anon,authenticated,service_role;
grant execute on function valtrim.configure_customer_service_email_automation(uuid,boolean,text) to service_role;

create function valtrim.claim_customer_service_email_folder_scan(p_connection_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare s private.customer_service_email_folder_scan%rowtype;
begin
  perform private.require_customer_service_email_system();
  if not exists(select 1 from private.customer_service_email_automation a
    join private.customer_service_email_connections c on c.id = a.connection_id
    where a.enabled and c.enabled and c.initialized_at is not null and c.id = p_connection_id
      and (c.retry_not_before is null or c.retry_not_before <= clock_timestamp())) then return null; end if;
  insert into private.customer_service_email_folder_scan(connection_id) values(p_connection_id) on conflict do nothing;
  select * into s from private.customer_service_email_folder_scan where connection_id = p_connection_id for update;
  if s.lease_expires_at > clock_timestamp() or s.retry_not_before > clock_timestamp()
    or s.completed_at > clock_timestamp() - interval '15 minutes' then return null; end if;
  update private.customer_service_email_folder_scan set token = gen_random_uuid(),lease_expires_at = clock_timestamp() + interval '3 minutes',
    scan_id = coalesce(scan_id,gen_random_uuid()),started_at = coalesce(started_at,clock_timestamp())
    where connection_id = p_connection_id returning * into s;
  return jsonb_build_object('token',s.token,'nextUrl',s.next_url);
end;
$function$;

create function valtrim.finish_customer_service_email_folder_scan(p_connection_id uuid,p_token uuid,p_message_ids text[],p_next_url text,
  p_error_code text default null,p_retry_after_seconds integer default 60,p_web_links jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $function$
declare s private.customer_service_email_folder_scan%rowtype; c private.customer_service_email_connections%rowtype;
begin
  perform private.require_customer_service_email_system();
  select * into s from private.customer_service_email_folder_scan where connection_id = p_connection_id for update;
  if s.token is distinct from p_token or p_token is null or s.lease_expires_at <= clock_timestamp() then
    raise exception 'Folder scan lease is no longer valid' using errcode = '55000'; end if;
  select * into strict c from private.customer_service_email_connections where id = p_connection_id;
  if p_error_code is not null then
    if p_error_code not in ('AUTH_FAILED','FORBIDDEN','FOLDER_NOT_FOUND','GRAPH_THROTTLED','GRAPH_UNAVAILABLE','SYNC_ERROR') then
      raise exception 'Use a sanitized folder scan error code' using errcode = '22023'; end if;
    update private.customer_service_email_folder_scan set token = null,lease_expires_at = null,error_code = p_error_code,
      retry_not_before = clock_timestamp() + make_interval(secs => greatest(60,least(coalesce(p_retry_after_seconds,60),2147483647)))
      where connection_id = p_connection_id;
    return;
  end if;
  if p_message_ids is null or cardinality(p_message_ids) > 1000 or exists(select 1 from unnest(p_message_ids) m
    where m is null or octet_length(m) not between 1 and 2048 or m <> btrim(m) or m ~ '[[:cntrl:]]') then
    raise exception 'Valid metadata message IDs are required' using errcode = '22023'; end if;
  if p_web_links is null or jsonb_typeof(p_web_links) <> 'object' or private.customer_service_import_has_binary(p_web_links) then
    raise exception 'Valid original email links are required' using errcode = '22023'; end if;
  if exists(select 1 from jsonb_each(p_web_links) link where not link.key = any(p_message_ids)
    or jsonb_typeof(link.value) <> 'string') then
    raise exception 'Original links must belong to this metadata page' using errcode = '22023'; end if;
  if p_next_url is not null then
    -- Validate only against the same mailbox/folder path. List paging uses
    -- $skip as well as $skiptoken; neither is rewritten or used as a delta.
    if octet_length(p_next_url) > 16384 or p_next_url ~ '[[:space:][:cntrl:]#\\]'
      or p_next_url !~ '/messages[?]' or p_next_url = s.next_url
      or p_next_url !~ '[?&](\$|%24)(skip|skiptoken)=[^&]+' then
      raise exception 'Invalid metadata continuation' using errcode = '22023'; end if;
    perform private.validate_customer_service_graph_cursor(c.mailbox_id,c.folder_id,'NEXT',
      split_part(p_next_url,'?',1) || '/delta?$skiptoken=metadata-path-validation');
  end if;
  insert into private.customer_service_email_missing_messages(connection_id,message_id,scan_id,web_link)
    select p_connection_id,m,s.scan_id,p_web_links ->> m from (select distinct unnest(p_message_ids) m) messages
    where not exists(select 1 from valtrim.service_request_imports i where i.tenant_id = c.tenant_id
      and i.mailbox_id = c.mailbox_id::text collate "C" and i.provider_message_id = m collate "C")
      and not exists(select 1 from private.customer_service_email_baseline_messages b where b.connection_id = c.id and b.message_id = m collate "C")
    on conflict(connection_id,message_id) do update set scan_id = excluded.scan_id,
      web_link = coalesce(excluded.web_link,private.customer_service_email_missing_messages.web_link);
  if p_next_url is null then
    delete from private.customer_service_email_missing_messages m where m.connection_id = c.id and
      (m.scan_id <> s.scan_id or exists(select 1 from valtrim.service_request_imports i where i.tenant_id = c.tenant_id
        and i.mailbox_id = c.mailbox_id::text collate "C" and i.provider_message_id = m.message_id));
  end if;
  update private.customer_service_email_folder_scan set token = null,lease_expires_at = null,next_url = p_next_url,
    scan_id = case when p_next_url is null then null else scan_id end,
    started_at = case when p_next_url is null then null else started_at end,
    completed_at = case when p_next_url is null then clock_timestamp() else null end,error_code = null,retry_not_before = null
    where connection_id = p_connection_id;
end;
$function$;
revoke all on function valtrim.claim_customer_service_email_folder_scan(uuid),
  valtrim.finish_customer_service_email_folder_scan(uuid,uuid,text[],text,text,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function valtrim.claim_customer_service_email_folder_scan(uuid),
  valtrim.finish_customer_service_email_folder_scan(uuid,uuid,text[],text,text,integer,jsonb) to service_role;

-- Small authenticated read: no mailbox IDs, raw message IDs, bodies, images, keys,
-- cursor URLs, worker checkpoints or reservations are sent to the browser.
create function valtrim.read_customer_service_email_automation_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare a private.customer_service_email_automation%rowtype; c private.customer_service_email_connections%rowtype;
  v_missing bigint; v_revision text;
begin
  perform private.require_customer_service_actor();
  select * into a from private.customer_service_email_automation where singleton;
  select * into c from private.customer_service_email_connections where id = a.connection_id;
  select count(*) into v_missing from private.customer_service_email_missing_messages m
    where m.connection_id = a.connection_id and m.first_seen_at < now() - interval '2 minutes'
      and not exists(select 1 from valtrim.service_request_imports i where i.tenant_id = c.tenant_id
        and i.mailbox_id = c.mailbox_id::text collate "C" and i.provider_message_id = m.message_id);
  select count(*)::text || ':' || coalesce(max(updated_at)::text,'') into v_revision from valtrim.service_requests;
  return jsonb_build_object('configured',a.connection_id is not null,'enabled',coalesce(a.enabled,false),
    'lastTickAt',a.last_tick_at,'lastSyncAt',c.last_success_at,'connectionError',c.last_error_code,
    'errorCode',a.error_code,'missingCount',coalesce(v_missing,0),'requestRevision',v_revision,
    'missingMessages',(select coalesce(jsonb_agg(jsonb_build_object('webLink',m.web_link,'detectedAt',m.first_seen_at)),'[]'::jsonb)
      from (select m.web_link,m.first_seen_at from private.customer_service_email_missing_messages m
        where m.connection_id = a.connection_id and m.first_seen_at < now() - interval '2 minutes'
          and not exists(select 1 from valtrim.service_request_imports i where i.tenant_id = c.tenant_id
            and i.mailbox_id = c.mailbox_id::text collate "C" and i.provider_message_id = m.message_id)
        order by m.first_seen_at,m.message_id limit 20) m),
    'problemCount',(select count(*) from valtrim.service_request_imports where status = 'NEEDS_ATTENTION'),
    'scan',(select jsonb_build_object('lastCompletedAt',completed_at,'errorCode',error_code) from private.customer_service_email_folder_scan where connection_id = a.connection_id),
    'dispatches',(select jsonb_agg(jsonb_build_object('kind',kind,'startedAt',started_at,'finishedAt',finished_at,
      'lastSuccessAt',last_success_at,'inFlight',request_id is not null,'outcome',outcome,'httpStatus',http_status,'errorCode',error_code)) from private.customer_service_email_dispatch));
end;
$function$;
revoke all on function valtrim.read_customer_service_email_automation_status() from public,anon,authenticated,service_role;
grant execute on function valtrim.read_customer_service_email_automation_status() to authenticated;

-- A stable name prevents creating additional schedules on operator retries.
select cron.schedule('customer-service-email-minute','* * * * *','select valtrim.tick_customer_service_email_automation()');
select cron.alter_job((select jobid from cron.job where jobname = 'customer-service-email-minute'),active := false);
notify pgrst, 'reload schema';
commit;
