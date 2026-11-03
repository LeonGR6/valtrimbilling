-- Email block 7.3: private configuration and durable synchronization state.
-- No real connection, credentials, Graph calls, HTTP endpoint or scheduler.
begin;

create table private.customer_service_email_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  mailbox_id uuid not null,
  folder_id text collate "C" not null,
  enabled boolean not null default false,
  initial_sync_mode text,
  initialized_at timestamptz,
  cursor_kind text,
  cursor_url text,
  revision bigint not null default 1,
  sync_token uuid,
  sync_lease_expires_at timestamptz,
  attempt_count bigint not null default 0,
  last_attempt_at timestamptz,
  last_finished_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  last_error_message text,
  last_error_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint customer_service_email_connections_identity_uq unique (tenant_id,mailbox_id,folder_id),
  constraint customer_service_email_connections_folder_check check (
    folder_id = btrim(folder_id) and char_length(folder_id) between 1 and 2048
    and folder_id !~ '[[:cntrl:]]'
  ),
  constraint customer_service_email_connections_mode_check check (
    (initial_sync_mode is null or initial_sync_mode in ('IMPORT_EXISTING','BASELINE_ONLY'))
    and (not enabled or initial_sync_mode is not null)
  ),
  constraint customer_service_email_connections_cursor_check check (
    (cursor_kind is null and cursor_url is null)
    or (cursor_kind is not null and cursor_kind in ('NEXT','DELTA') and cursor_url is not null
      and char_length(cursor_url) between 1 and 16384)
  ),
  constraint customer_service_email_connections_lease_check check (
    (sync_token is null) = (sync_lease_expires_at is null)
    and (sync_token is null or enabled)
    and revision between 1 and 9007199254740991 and attempt_count between 0 and 9007199254740991
  ),
  constraint customer_service_email_connections_error_check check (
    (last_error_code is null and last_error_message is null and last_error_at is null)
    or (last_error_code is not null and last_error_message is not null and last_error_at is not null)
  )
);
alter table private.customer_service_email_connections enable row level security;
revoke all on private.customer_service_email_connections from public,anon,authenticated,service_role;

create function private.guard_customer_service_email_connection()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if row(new.id,new.tenant_id,new.mailbox_id,new.folder_id,new.created_at)
    is distinct from row(old.id,old.tenant_id,old.mailbox_id,old.folder_id,old.created_at)
    or (old.last_attempt_at is not null and new.initial_sync_mode is distinct from old.initial_sync_mode) then
    raise exception 'Connection identity and a started initial sync mode cannot be replaced' using errcode = '22023';
  end if;
  new.revision := old.revision + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$function$;
revoke all on function private.guard_customer_service_email_connection() from public,anon,authenticated,service_role;
create trigger customer_service_email_connections_guard before update on private.customer_service_email_connections
for each row execute function private.guard_customer_service_email_connection();

create function private.require_customer_service_email_system()
returns void language plpgsql stable set search_path = '' as $function$
begin
  if (select auth.uid()) is not null then
    raise exception 'Email connection operations require a system context' using errcode = '42501';
  end if;
end;
$function$;
revoke all on function private.require_customer_service_email_system() from public,anon,authenticated,service_role;

-- Decode a path segment, NOT a query token. '+' remains literal in a path.
-- Needed to bind a verbatim Graph continuation URL to the exact opaque folder.
create function private.customer_service_graph_path_decode(p_value text)
returns text language plpgsql immutable strict set search_path = '' as $function$
declare v_bytes bytea := ''::bytea; v_index integer := 1; v_char text;
begin
  while v_index <= char_length(p_value) loop
    v_char := substr(p_value,v_index,1);
    if v_char = '%' then
      if substr(p_value,v_index + 1,2) !~ '^[0-9A-Fa-f]{2}$' then
        raise exception 'Invalid Graph cursor' using errcode = '22023';
      end if;
      v_bytes := v_bytes || decode(substr(p_value,v_index + 1,2),'hex');
      v_index := v_index + 3;
    else
      v_bytes := v_bytes || convert_to(v_char,'UTF8');
      v_index := v_index + 1;
    end if;
  end loop;
  return convert_from(v_bytes,'UTF8');
exception when others then
  raise exception 'Invalid Graph cursor' using errcode = '22023';
end;
$function$;
revoke all on function private.customer_service_graph_path_decode(text) from public,anon,authenticated,service_role;

create function private.validate_customer_service_graph_cursor(
  p_mailbox_id uuid,p_folder_id text,p_kind text,p_url text
)
returns void language plpgsql immutable set search_path = '' as $function$
declare v_path text; v_query text; v_skip integer; v_delta integer;
begin
  if p_kind is null or p_kind not in ('NEXT','DELTA') or p_url is null
    or char_length(p_url) > 16384 or p_url ~ '[[:space:][:cntrl:]#\\]'
    or p_url !~ '^https://graph[.]microsoft[.]com/v1[.]0/users/[^/?]+/mailFolders/[^/?]+/messages/delta[?].+$' then
    raise exception 'Invalid Graph cursor' using errcode = '22023';
  end if;
  v_path := split_part(p_url,'?',1);
  v_query := substr(p_url,char_length(v_path) + 2);
  if private.customer_service_graph_path_decode(split_part(v_path,'/',6)) is distinct from p_mailbox_id::text
    or private.customer_service_graph_path_decode(split_part(v_path,'/',8)) is distinct from p_folder_id then
    raise exception 'Graph cursor must belong to the configured mailbox and folder' using errcode = '22023';
  end if;
  select count(*) into v_skip from regexp_matches(v_query,'(^|&)(\$|%24)skiptoken=','g');
  select count(*) into v_delta from regexp_matches(v_query,'(^|&)(\$|%24)deltatoken=','g');
  if (p_kind = 'NEXT' and (v_skip <> 1 or v_delta <> 0))
    or (p_kind = 'DELTA' and (v_delta <> 1 or v_skip <> 0))
    or (p_kind = 'NEXT' and v_query !~ '(^|&)(\$|%24)skiptoken=[^&]+')
    or (p_kind = 'DELTA' and v_query !~ '(^|&)(\$|%24)deltatoken=[^&]+') then
    raise exception 'Graph cursor kind and continuation token must agree' using errcode = '22023';
  end if;
end;
$function$;
revoke all on function private.validate_customer_service_graph_cursor(uuid,text,text,text) from public,anon,authenticated,service_role;

create function valtrim.register_customer_service_email_connection(
  p_tenant_id uuid,p_mailbox_id uuid,p_folder_id text,p_initial_sync_mode text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_row private.customer_service_email_connections%rowtype; v_replay boolean := false;
begin
  perform private.require_customer_service_email_system();
  if p_tenant_id is null or p_mailbox_id is null or p_folder_id is null
    or p_folder_id <> btrim(p_folder_id) or char_length(p_folder_id) not between 1 and 2048
    or p_folder_id ~ '[[:cntrl:]]'
    or (p_initial_sync_mode is not null and p_initial_sync_mode not in ('IMPORT_EXISTING','BASELINE_ONLY')) then
    raise exception 'Valid tenant, mailbox object ID, folder and optional initial sync mode are required' using errcode = '22023';
  end if;
  insert into private.customer_service_email_connections(tenant_id,mailbox_id,folder_id,initial_sync_mode)
    values(p_tenant_id,p_mailbox_id,p_folder_id,p_initial_sync_mode)
    on conflict on constraint customer_service_email_connections_identity_uq do nothing returning * into v_row;
  if not found then
    v_replay := true;
    select * into strict v_row from private.customer_service_email_connections
      where tenant_id = p_tenant_id and mailbox_id = p_mailbox_id and folder_id = p_folder_id collate "C";
  end if;
  -- A duplicate registration is a read, never a reconfiguration or a reset.
  return to_jsonb(v_row) || jsonb_build_object('idempotentReplay',v_replay);
end;
$function$;

create function valtrim.read_customer_service_email_connection(p_connection_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_row private.customer_service_email_connections%rowtype;
begin
  perform private.require_customer_service_email_system();
  select * into v_row from private.customer_service_email_connections where id = p_connection_id;
  if not found then raise exception 'Email connection not found' using errcode = 'P0002'; end if;
  return to_jsonb(v_row);
end;
$function$;

create function valtrim.configure_customer_service_email_connection(
  p_connection_id uuid,p_expected_revision bigint,p_enabled boolean,p_initial_sync_mode text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_row private.customer_service_email_connections%rowtype; v_mode text;
begin
  perform private.require_customer_service_email_system();
  select * into v_row from private.customer_service_email_connections where id = p_connection_id for update;
  if not found then raise exception 'Email connection not found' using errcode = 'P0002'; end if;
  if p_expected_revision is distinct from v_row.revision then
    raise exception 'Email connection changed. Read it again' using errcode = '40001';
  end if;
  v_mode := coalesce(p_initial_sync_mode,v_row.initial_sync_mode);
  if p_enabled is null or (v_mode is not null and v_mode not in ('IMPORT_EXISTING','BASELINE_ONLY'))
    or (p_enabled and v_mode is null) then
    raise exception 'Choose an initial sync mode before enabling the connection' using errcode = '22023';
  end if;
  update private.customer_service_email_connections set enabled = p_enabled,initial_sync_mode = v_mode,
    sync_token = case when p_enabled then sync_token else null end,
    sync_lease_expires_at = case when p_enabled then sync_lease_expires_at else null end
    where id = p_connection_id returning * into v_row;
  -- Disabling fences an in-flight invocation, retaining its last durable cursor.
  return to_jsonb(v_row);
end;
$function$;

create function valtrim.claim_customer_service_email_sync(p_connection_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_row private.customer_service_email_connections%rowtype;
begin
  perform private.require_customer_service_email_system();
  select * into v_row from private.customer_service_email_connections where id = p_connection_id for update;
  if not found then raise exception 'Email connection not found' using errcode = 'P0002'; end if;
  if not v_row.enabled or (v_row.sync_token is not null and v_row.sync_lease_expires_at > clock_timestamp()) then
    return null;
  end if;
  update private.customer_service_email_connections set sync_token = gen_random_uuid(),
    sync_lease_expires_at = clock_timestamp() + interval '3 minutes',
    attempt_count = attempt_count + 1,last_attempt_at = clock_timestamp()
    where id = p_connection_id returning * into v_row;
  return to_jsonb(v_row);
end;
$function$;

create function private.lock_customer_service_email_sync(p_connection_id uuid,p_sync_token uuid,p_expected_revision bigint)
returns private.customer_service_email_connections language plpgsql set search_path = '' as $function$
declare v_row private.customer_service_email_connections%rowtype;
begin
  perform private.require_customer_service_email_system();
  select * into v_row from private.customer_service_email_connections where id = p_connection_id for update;
  if not found then raise exception 'Email connection not found' using errcode = 'P0002'; end if;
  if not v_row.enabled or p_sync_token is null or v_row.sync_token is distinct from p_sync_token
    or v_row.sync_lease_expires_at <= clock_timestamp() then
    raise exception 'Email sync lease is no longer valid' using errcode = '55000';
  end if;
  if p_expected_revision is distinct from v_row.revision then
    raise exception 'Email connection changed. Read it again' using errcode = '40001';
  end if;
  return v_row;
end;
$function$;
revoke all on function private.lock_customer_service_email_sync(uuid,uuid,bigint) from public,anon,authenticated,service_role;

create function valtrim.checkpoint_customer_service_email_sync(
  p_connection_id uuid,p_sync_token uuid,p_expected_revision bigint,p_cursor_kind text,p_cursor_url text,
  p_import_ids uuid[] default '{}'::uuid[]
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_row private.customer_service_email_connections%rowtype; v_baseline boolean;
begin
  v_row := private.lock_customer_service_email_sync(p_connection_id,p_sync_token,p_expected_revision);
  perform private.validate_customer_service_graph_cursor(v_row.mailbox_id,v_row.folder_id,p_cursor_kind,p_cursor_url);
  v_baseline := v_row.initial_sync_mode = 'BASELINE_ONLY' and v_row.initialized_at is null;
  if p_import_ids is null or cardinality(p_import_ids) > 1000 or array_position(p_import_ids,null) is not null
    or (v_baseline and cardinality(p_import_ids) > 0) then
    raise exception 'Invalid durable page import identities' using errcode = '22023';
  end if;
  -- The future connector must pass ALL non-removed messages in the page, after
  -- retaining their complete source or a durable actionable technical problem.
  if exists(select 1 from unnest(p_import_ids) input(id)
    where not exists(select 1 from valtrim.service_request_imports receipt
      where receipt.id = input.id and receipt.tenant_id = v_row.tenant_id
        and receipt.mailbox_id = v_row.mailbox_id::text collate "C"
        and (receipt.source_status in ('AVAILABLE','REJECTED','LEGACY') or receipt.status = 'NEEDS_ATTENTION'))) then
    raise exception 'Every page import must be durably retained for this tenant and mailbox' using errcode = '22023';
  end if;
  update private.customer_service_email_connections set cursor_kind = p_cursor_kind,cursor_url = p_cursor_url,
    sync_token = case when p_cursor_kind = 'DELTA' then null else sync_token end,
    sync_lease_expires_at = case when p_cursor_kind = 'DELTA' then null else clock_timestamp() + interval '3 minutes' end,
    initialized_at = coalesce(initialized_at,case when p_cursor_kind = 'DELTA' then clock_timestamp() end),
    last_success_at = case when p_cursor_kind = 'DELTA' then clock_timestamp() else last_success_at end,
    last_finished_at = case when p_cursor_kind = 'DELTA' then clock_timestamp() else last_finished_at end,
    last_error_code = case when p_cursor_kind = 'DELTA' then null else last_error_code end,
    last_error_message = case when p_cursor_kind = 'DELTA' then null else last_error_message end,
    last_error_at = case when p_cursor_kind = 'DELTA' then null else last_error_at end
    where id = p_connection_id returning * into v_row;
  return to_jsonb(v_row);
end;
$function$;

create function valtrim.finish_customer_service_email_sync(
  p_connection_id uuid,p_sync_token uuid,p_expected_revision bigint,p_error_code text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_row private.customer_service_email_connections%rowtype; v_message text;
begin
  v_row := private.lock_customer_service_email_sync(p_connection_id,p_sync_token,p_expected_revision);
  v_message := case p_error_code
    when 'AUTH_FAILED' then 'Microsoft no pudo autenticar la aplicación. Revisa sus credenciales.'
    when 'FORBIDDEN' then 'La aplicación no tiene acceso al buzón configurado.'
    when 'FOLDER_NOT_FOUND' then 'La carpeta configurada no está disponible.'
    when 'GRAPH_THROTTLED' then 'Microsoft limitó temporalmente las consultas. Reintenta más tarde.'
    when 'GRAPH_UNAVAILABLE' then 'Microsoft no está disponible temporalmente.'
    when 'CURSOR_EXPIRED' then 'La sincronización requiere reinicialización controlada. No se descartó su avance.'
    when 'SYNC_INTERRUPTED' then 'La sincronización se interrumpió. Se conserva el último avance confirmado.'
    when 'SYNC_ERROR' then 'No se pudo completar la sincronización. Revisa la conexión.'
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

revoke all on function valtrim.register_customer_service_email_connection(uuid,uuid,text,text),
  valtrim.read_customer_service_email_connection(uuid),
  valtrim.configure_customer_service_email_connection(uuid,bigint,boolean,text),
  valtrim.claim_customer_service_email_sync(uuid),
  valtrim.checkpoint_customer_service_email_sync(uuid,uuid,bigint,text,text,uuid[]),
  valtrim.finish_customer_service_email_sync(uuid,uuid,bigint,text)
  from public,anon,authenticated,service_role;
grant execute on function valtrim.register_customer_service_email_connection(uuid,uuid,text,text),
  valtrim.read_customer_service_email_connection(uuid),
  valtrim.configure_customer_service_email_connection(uuid,bigint,boolean,text),
  valtrim.claim_customer_service_email_sync(uuid),
  valtrim.checkpoint_customer_service_email_sync(uuid,uuid,bigint,text,text,uuid[]),
  valtrim.finish_customer_service_email_sync(uuid,uuid,bigint,text) to service_role;

comment on table private.customer_service_email_connections is
  'Server-only Microsoft 365 folder configuration and opaque delta progress. No client secret, access token, email body or automatic activation. Canonical mailbox Entra object UUID, not its changeable SMTP address.';
notify pgrst, 'reload schema';
commit;
