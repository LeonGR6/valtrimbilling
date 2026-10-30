-- Phase 13: manually synchronize the persisted Production calendar to the
-- dedicated Google calendar created during OAuth.
--
-- ValtrimBilling remains the source of truth. The browser can request a sync,
-- but only the Edge Function service client can read the encrypted refresh
-- token, inspect event links or persist synchronization results.

begin;

alter table valtrim.google_calendar_connections
  add column sync_started_at timestamptz,
  add column last_sync_at timestamptz,
  add column last_sync_status varchar(20) not null default 'NEVER_SYNCED'
    check (last_sync_status in ('NEVER_SYNCED', 'SUCCESS', 'PARTIAL', 'FAILED')),
  add column last_sync_created_count integer not null default 0
    check (last_sync_created_count >= 0),
  add column last_sync_updated_count integer not null default 0
    check (last_sync_updated_count >= 0),
  add column last_sync_unchanged_count integer not null default 0
    check (last_sync_unchanged_count >= 0),
  add column last_sync_deleted_count integer not null default 0
    check (last_sync_deleted_count >= 0),
  add column last_sync_failed_count integer not null default 0
    check (last_sync_failed_count >= 0);

create table valtrim.google_calendar_event_links (
  user_id uuid not null
    references valtrim.google_calendar_connections(user_id) on delete cascade,
  schedule_id bigint not null
    references valtrim.production_schedules(id) on delete cascade,
  google_event_id text,
  payload_hash char(64),
  status varchar(20) not null
    check (status in ('SYNCED', 'DELETED', 'ERROR')),
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  last_attempted_at timestamptz not null default now(),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, schedule_id),
  constraint google_calendar_event_links_event_id_check
    check (
      google_event_id is null
      or (btrim(google_event_id) <> '' and char_length(google_event_id) <= 1024)
    ),
  constraint google_calendar_event_links_payload_hash_check
    check (payload_hash is null or payload_hash ~ '^[0-9a-f]{64}$'),
  constraint google_calendar_event_links_synced_check
    check (
      status <> 'SYNCED'
      or (google_event_id is not null and payload_hash is not null and last_synced_at is not null)
    )
);

create unique index google_calendar_event_links_google_event_uq
  on valtrim.google_calendar_event_links (user_id, google_event_id)
  where google_event_id is not null;

create index google_calendar_event_links_status_idx
  on valtrim.google_calendar_event_links (user_id, status, schedule_id);

create trigger google_calendar_event_links_set_updated_at
before update on valtrim.google_calendar_event_links
for each row execute function valtrim.set_updated_at();

-- Acquire a short lease and return one server-only synchronization snapshot.
-- IDs are serialized as text so the Edge Function never loses bigint
-- precision. The refresh token is decrypted only inside this service-only RPC.
create function valtrim.begin_google_calendar_sync(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_calendar_id text;
  v_refresh_token_secret_id uuid;
  v_refresh_token text;
  v_sync_started_at timestamptz;
  v_schedules jsonb;
  v_links jsonb;
begin
  if p_user_id is null
     or not exists (
       select 1
       from valtrim.app_users app_user
       where app_user.id = p_user_id
         and app_user.is_active
         and app_user.role = 'ADMIN'
     ) then
    raise exception 'Only an active administrator can synchronize Google Calendar'
      using errcode = '42501';
  end if;

  select
    connection.google_calendar_id,
    connection.refresh_token_secret_id,
    connection.sync_started_at
  into
    v_calendar_id,
    v_refresh_token_secret_id,
    v_sync_started_at
  from valtrim.google_calendar_connections connection
  where connection.user_id = p_user_id
    and connection.status = 'CONNECTED'
  for update;

  if v_calendar_id is null then
    raise exception 'Connect Google Calendar before synchronizing'
      using errcode = 'P0002';
  end if;

  if v_sync_started_at is not null
     and v_sync_started_at > now() - interval '15 minutes' then
    raise exception 'A Google Calendar synchronization is already running'
      using errcode = '55P03';
  end if;

  select secret.decrypted_secret
  into v_refresh_token
  from vault.decrypted_secrets secret
  where secret.id = v_refresh_token_secret_id;

  if nullif(v_refresh_token, '') is null then
    raise exception 'The Google Calendar refresh token is unavailable; reconnect Google Calendar'
      using errcode = 'P0002';
  end if;

  update valtrim.google_calendar_connections connection
  set sync_started_at = now(),
      last_error = null
  where connection.user_id = p_user_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'scheduleId', schedule.id::text,
        'activityId', activity.id::text,
        'stageType', stage.stage_type::text,
        'variant', schedule.variant::text,
        'scheduledDate', schedule.scheduled_date::text,
        'dateOwner', schedule.date_owner::text,
        'scheduleNote', coalesce(schedule.note, ''),
        'activityNotes', coalesce(activity.notes, ''),
        'orderMaterial', stage.order_material,
        'jobCode', job.code,
        'jobName', job.name,
        'community', job.community,
        'builderName', builder.name,
        'phaseCode', phase.code,
        'building', coalesce(phase.building, ''),
        'supervisorName', activity.supervisor_name,
        'superintendentName', activity.superintendent_name,
        'lotNumbers', (
          select coalesce(
            jsonb_agg(lot.lot_number order by lot.display_order, lot.id),
            '[]'::jsonb
          )
          from valtrim.production_schedule_lots schedule_lot
          join valtrim.lots lot on lot.id = schedule_lot.lot_id
          where schedule_lot.schedule_id = schedule.id
        ),
        'sourceUpdatedAt', greatest(
          schedule.updated_at,
          activity.updated_at,
          job.updated_at,
          phase.updated_at,
          builder.updated_at
        )::text
      )
      order by schedule.id
    ),
    '[]'::jsonb
  )
  into v_schedules
  from valtrim.production_schedules schedule
  join valtrim.production_stages stage
    on stage.id = schedule.stage_id
   and stage.is_enabled
  join valtrim.production_activities activity
    on activity.id = schedule.activity_id
   and activity.status = 'ACTIVE'
  join valtrim.jobs job on job.id = activity.job_id
  join valtrim.phases phase on phase.id = activity.phase_id
  join valtrim.builders builder on builder.id = job.builder_id
  where schedule.is_active;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'scheduleId', link.schedule_id::text,
        'googleEventId', link.google_event_id,
        'payloadHash', link.payload_hash,
        'status', link.status
      )
      order by link.schedule_id
    ),
    '[]'::jsonb
  )
  into v_links
  from valtrim.google_calendar_event_links link
  where link.user_id = p_user_id;

  return jsonb_build_object(
    'calendarId', v_calendar_id,
    'refreshToken', v_refresh_token,
    'schedules', v_schedules,
    'links', v_links
  );
end;
$$;

-- Persist the whole outcome after the remote work finishes. A failed item keeps
-- its last known Google ID/hash so a later manual run can recover it.
create function valtrim.finish_google_calendar_sync(
  p_user_id uuid,
  p_results jsonb,
  p_created_count integer,
  p_updated_count integer,
  p_unchanged_count integer,
  p_deleted_count integer,
  p_failed_count integer,
  p_last_error text default null,
  p_connection_error boolean default false
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finished_at timestamptz := now();
  v_result_count integer;
begin
  if p_user_id is null
     or not exists (
       select 1
       from valtrim.google_calendar_connections connection
       where connection.user_id = p_user_id
     ) then
    raise exception 'The Google Calendar connection is unavailable'
      using errcode = 'P0002';
  end if;

  if p_results is null
     or jsonb_typeof(p_results) <> 'array'
     or jsonb_array_length(p_results) > 5000 then
    raise exception 'Google Calendar synchronization returned invalid results'
      using errcode = '22023';
  end if;

  if p_created_count is null or p_created_count < 0
     or p_updated_count is null or p_updated_count < 0
     or p_unchanged_count is null or p_unchanged_count < 0
     or p_deleted_count is null or p_deleted_count < 0
     or p_failed_count is null or p_failed_count < 0
     or (p_last_error is not null and char_length(p_last_error) > 1000) then
    raise exception 'Google Calendar synchronization returned invalid counters'
      using errcode = '22023';
  end if;

  select count(*) into v_result_count
  from jsonb_array_elements(p_results) result(value);

  if v_result_count <> (
    select count(distinct result.value ->> 'scheduleId')
    from jsonb_array_elements(p_results) result(value)
  ) then
    raise exception 'A Production schedule appeared more than once in the sync result'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_results) result(value)
    where jsonb_typeof(result.value) <> 'object'
      or coalesce(result.value ->> 'scheduleId', '') !~ '^[1-9][0-9]*$'
      or coalesce(result.value ->> 'status', '') not in ('SYNCED', 'DELETED', 'ERROR')
      or char_length(coalesce(result.value ->> 'googleEventId', '')) > 1024
      or (
        nullif(result.value ->> 'payloadHash', '') is not null
        and result.value ->> 'payloadHash' !~ '^[0-9a-f]{64}$'
      )
      or char_length(coalesce(result.value ->> 'lastError', '')) > 1000
      or (
        result.value ->> 'status' = 'SYNCED'
        and (
          nullif(btrim(result.value ->> 'googleEventId'), '') is null
          or coalesce(result.value ->> 'payloadHash', '') !~ '^[0-9a-f]{64}$'
        )
      )
      or (
        result.value ->> 'status' = 'ERROR'
        and nullif(btrim(result.value ->> 'lastError'), '') is null
      )
  ) then
    raise exception 'Google Calendar synchronization returned an invalid item'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_results) result(value)
    where not exists (
      select 1
      from valtrim.production_schedules schedule
      where schedule.id = (result.value ->> 'scheduleId')::bigint
    )
  ) then
    raise exception 'A synchronized Production schedule no longer exists'
      using errcode = '23503';
  end if;

  insert into valtrim.google_calendar_event_links (
    user_id,
    schedule_id,
    google_event_id,
    payload_hash,
    status,
    last_error,
    last_attempted_at,
    last_synced_at
  )
  select
    p_user_id,
    (result.value ->> 'scheduleId')::bigint,
    nullif(btrim(result.value ->> 'googleEventId'), ''),
    nullif(result.value ->> 'payloadHash', '')::char(64),
    result.value ->> 'status',
    nullif(btrim(result.value ->> 'lastError'), ''),
    v_finished_at,
    case
      when result.value ->> 'status' in ('SYNCED', 'DELETED') then v_finished_at
      else null
    end
  from jsonb_array_elements(p_results) result(value)
  on conflict (user_id, schedule_id) do update
  set google_event_id = coalesce(
        excluded.google_event_id,
        valtrim.google_calendar_event_links.google_event_id
      ),
      payload_hash = case
        when excluded.status = 'SYNCED' then excluded.payload_hash
        when excluded.status = 'DELETED' then null
        else valtrim.google_calendar_event_links.payload_hash
      end,
      status = excluded.status,
      last_error = excluded.last_error,
      last_attempted_at = excluded.last_attempted_at,
      last_synced_at = coalesce(
        excluded.last_synced_at,
        valtrim.google_calendar_event_links.last_synced_at
      );

  update valtrim.google_calendar_connections connection
  set sync_started_at = null,
      last_sync_at = v_finished_at,
      last_sync_status = case
        when p_connection_error
          or (
            p_failed_count > 0
            and p_created_count + p_updated_count + p_unchanged_count + p_deleted_count = 0
          ) then 'FAILED'
        when p_failed_count > 0 then 'PARTIAL'
        else 'SUCCESS'
      end,
      last_sync_created_count = p_created_count,
      last_sync_updated_count = p_updated_count,
      last_sync_unchanged_count = p_unchanged_count,
      last_sync_deleted_count = p_deleted_count,
      last_sync_failed_count = p_failed_count,
      last_error = nullif(btrim(p_last_error), ''),
      status = case when p_connection_error then 'ERROR' else 'CONNECTED' end
  where connection.user_id = p_user_id;

  return v_finished_at;
end;
$$;

alter table valtrim.google_calendar_event_links enable row level security;

revoke all on table valtrim.google_calendar_event_links
  from public, anon, authenticated;
revoke all on function valtrim.begin_google_calendar_sync(uuid)
  from public, anon, authenticated;
revoke all on function valtrim.finish_google_calendar_sync(
  uuid, jsonb, integer, integer, integer, integer, integer, text, boolean
) from public, anon, authenticated;

grant all on table valtrim.google_calendar_event_links to service_role;
grant execute on function valtrim.begin_google_calendar_sync(uuid)
  to service_role;
grant execute on function valtrim.finish_google_calendar_sync(
  uuid, jsonb, integer, integer, integer, integer, integer, text, boolean
) to service_role;

grant select (
  last_sync_at,
  last_sync_status,
  last_sync_created_count,
  last_sync_updated_count,
  last_sync_unchanged_count,
  last_sync_deleted_count,
  last_sync_failed_count
) on valtrim.google_calendar_connections to authenticated;

comment on table valtrim.google_calendar_event_links is
  'Server-only mapping from a persisted Production schedule to its Google Calendar event.';
comment on function valtrim.begin_google_calendar_sync(uuid) is
  'Service-role-only snapshot and lease for one-way manual Production-to-Google synchronization.';
comment on function valtrim.finish_google_calendar_sync(
  uuid, jsonb, integer, integer, integer, integer, integer, text, boolean
) is
  'Service-role-only persistence boundary for Google Calendar synchronization outcomes.';

notify pgrst, 'reload schema';

commit;
