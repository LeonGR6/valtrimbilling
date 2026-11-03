-- Graph connector: persist Retry-After across invocations and stop on expired
-- cursors. No real connection, credential, mailbox operation or cron is created.
begin;

alter table private.customer_service_email_connections
  add column retry_not_before timestamptz;

-- Historical membership is technical identity only, never an import/request.
-- Graph can emit read/unread updates even with changeType=created. Remembering
-- baseline IDs prevents those updates from importing historical messages.
create table private.customer_service_email_baseline_messages (
  connection_id uuid not null references private.customer_service_email_connections(id) on delete cascade,
  message_id text collate "C" not null,
  primary key(connection_id,message_id),
  constraint customer_service_email_baseline_message_id_check check (
    message_id = btrim(message_id) and octet_length(message_id) between 1 and 2048
    and message_id !~ '[[:cntrl:]]'
  )
);
alter table private.customer_service_email_baseline_messages enable row level security;
revoke all on private.customer_service_email_baseline_messages from public,anon,authenticated,service_role;

create or replace function valtrim.claim_customer_service_email_sync(p_connection_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_row private.customer_service_email_connections%rowtype;
begin
  perform private.require_customer_service_email_system();
  select * into v_row from private.customer_service_email_connections where id = p_connection_id for update;
  if not found then raise exception 'Email connection not found' using errcode = 'P0002'; end if;
  if not v_row.enabled or v_row.last_error_code = 'CURSOR_EXPIRED'
    or v_row.retry_not_before > clock_timestamp()
    or (v_row.sync_token is not null and v_row.sync_lease_expires_at > clock_timestamp()) then
    return null;
  end if;
  update private.customer_service_email_connections set sync_token = gen_random_uuid(),
    sync_lease_expires_at = clock_timestamp() + interval '3 minutes',
    attempt_count = attempt_count + 1,last_attempt_at = clock_timestamp(),retry_not_before = null
    where id = p_connection_id returning * into v_row;
  return to_jsonb(v_row);
end;
$function$;

create function valtrim.read_customer_service_email_baseline_matches(
  p_connection_id uuid,p_sync_token uuid,p_expected_revision bigint,p_message_ids text[]
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  perform private.lock_customer_service_email_sync(p_connection_id,p_sync_token,p_expected_revision);
  if p_message_ids is null or cardinality(p_message_ids) > 1000 or array_position(p_message_ids,null) is not null then
    raise exception 'Invalid page message identities' using errcode = '22023';
  end if;
  return (select coalesce(jsonb_agg(message_id order by message_id),'[]')
    from private.customer_service_email_baseline_messages
    where connection_id = p_connection_id and message_id = any(p_message_ids));
end;
$function$;

create function valtrim.checkpoint_customer_service_email_graph_page(
  p_connection_id uuid,p_sync_token uuid,p_expected_revision bigint,p_cursor_kind text,p_cursor_url text,
  p_import_ids uuid[],p_baseline_message_ids text[],p_removed_message_ids text[]
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_row private.customer_service_email_connections%rowtype; v_baseline boolean;
begin
  v_row := private.lock_customer_service_email_sync(p_connection_id,p_sync_token,p_expected_revision);
  v_baseline := v_row.initial_sync_mode = 'BASELINE_ONLY' and v_row.initialized_at is null;
  if p_baseline_message_ids is null or p_removed_message_ids is null
    or cardinality(p_baseline_message_ids) > 1000 or cardinality(p_removed_message_ids) > 1000
    or array_position(p_baseline_message_ids,null) is not null or array_position(p_removed_message_ids,null) is not null
    or (not v_baseline and cardinality(p_baseline_message_ids) > 0)
    or exists(select 1 from unnest(p_baseline_message_ids || p_removed_message_ids) input(id)
      where id <> btrim(id) or octet_length(id) not between 1 and 2048 or id ~ '[[:cntrl:]]') then
    raise exception 'Invalid baseline page identities' using errcode = '22023';
  end if;
  delete from private.customer_service_email_baseline_messages
    where connection_id = p_connection_id and message_id = any(p_removed_message_ids);
  insert into private.customer_service_email_baseline_messages(connection_id,message_id)
    select p_connection_id,id from unnest(p_baseline_message_ids) input(id)
    on conflict do nothing;
  -- Membership and cursor commit together. A failed/incomplete page cannot
  -- forget baseline protection or manufacture a new synchronization boundary.
  return valtrim.checkpoint_customer_service_email_sync(
    p_connection_id,p_sync_token,p_expected_revision,p_cursor_kind,p_cursor_url,p_import_ids);
end;
$function$;

create function valtrim.defer_customer_service_email_sync(
  p_connection_id uuid,p_sync_token uuid,p_expected_revision bigint,
  p_error_code text,p_retry_after_seconds integer
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_result jsonb; v_row private.customer_service_email_connections%rowtype;
begin
  if p_error_code is null or p_retry_after_seconds is null or p_retry_after_seconds < 0
    or (p_retry_after_seconds > 0 and p_error_code not in ('GRAPH_THROTTLED','GRAPH_UNAVAILABLE')) then
    raise exception 'Use a known connection error and a nonnegative retry delay' using errcode = '22023';
  end if;
  -- Existing completion validates system identity, lease, exact revision and
  -- sanitized error codes. Both updates commit together or not at all.
  v_result := valtrim.finish_customer_service_email_sync(
    p_connection_id,p_sync_token,p_expected_revision,p_error_code);
  if p_retry_after_seconds = 0 then return v_result; end if;
  update private.customer_service_email_connections
    set retry_not_before = clock_timestamp() + make_interval(secs => p_retry_after_seconds)
    where id = p_connection_id returning * into v_row;
  return to_jsonb(v_row);
end;
$function$;

revoke all on function valtrim.claim_customer_service_email_sync(uuid),
  valtrim.defer_customer_service_email_sync(uuid,uuid,bigint,text,integer),
  valtrim.read_customer_service_email_baseline_matches(uuid,uuid,bigint,text[]),
  valtrim.checkpoint_customer_service_email_graph_page(uuid,uuid,bigint,text,text,uuid[],text[],text[])
  from public,anon,authenticated,service_role;
grant execute on function valtrim.claim_customer_service_email_sync(uuid),
  valtrim.defer_customer_service_email_sync(uuid,uuid,bigint,text,integer),
  valtrim.read_customer_service_email_baseline_matches(uuid,uuid,bigint,text[]),
  valtrim.checkpoint_customer_service_email_graph_page(uuid,uuid,bigint,text,text,uuid[],text[],text[]) to service_role;
comment on column private.customer_service_email_connections.retry_not_before is
  'Provider backoff enforced by SQL before claiming a connection; disabling or replaying registration does not bypass it.';
notify pgrst, 'reload schema';
commit;
