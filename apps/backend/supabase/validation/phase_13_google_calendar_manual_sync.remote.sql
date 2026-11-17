begin;

do $$
declare
  v_admin_id uuid;
  v_snapshot jsonb;
  v_schedule_id bigint;
  v_expected_schedule_count integer;
  v_finished_at timestamptz;
begin
  if not (select relrowsecurity from pg_class where oid =
    'valtrim.google_calendar_event_links'::regclass) then
    raise exception 'Phase 13 event mappings must have RLS enabled';
  end if;

  if has_table_privilege(
    'authenticated',
    'valtrim.google_calendar_event_links',
    'select'
  ) then
    raise exception 'Authenticated clients can read Google event mappings';
  end if;

  if has_function_privilege(
    'authenticated',
    'valtrim.begin_google_calendar_sync(uuid)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'valtrim.finish_google_calendar_sync(uuid,jsonb,integer,integer,integer,integer,integer,text,boolean)',
    'execute'
  ) then
    raise exception 'Authenticated clients can call service-only sync RPCs';
  end if;

  select connection.user_id
  into v_admin_id
  from valtrim.google_calendar_connections connection
  join valtrim.app_users app_user on app_user.id = connection.user_id
  where connection.status = 'CONNECTED'
    and app_user.role = 'ADMIN'
    and app_user.is_active
  order by connection.connected_at
  limit 1;

  if v_admin_id is null then
    raise exception 'Remote validation needs one connected active ADMIN';
  end if;

  select count(*)
  into v_expected_schedule_count
  from valtrim.production_schedules schedule
  join valtrim.production_stages stage
    on stage.id = schedule.stage_id
   and stage.is_enabled
  join valtrim.production_activities activity
    on activity.id = schedule.activity_id
   and activity.status = 'ACTIVE'
  where schedule.is_active;

  select valtrim.begin_google_calendar_sync(v_admin_id)
  into v_snapshot;

  if nullif(v_snapshot ->> 'calendarId', '') is null
     or nullif(v_snapshot ->> 'refreshToken', '') is null
     or jsonb_typeof(v_snapshot -> 'schedules') <> 'array'
     or jsonb_typeof(v_snapshot -> 'links') <> 'array'
     or jsonb_array_length(v_snapshot -> 'schedules') <> v_expected_schedule_count then
    raise exception 'The service sync snapshot is incomplete';
  end if;

  begin
    perform valtrim.begin_google_calendar_sync(v_admin_id);
    raise exception 'A concurrent synchronization acquired the same lease';
  exception
    when lock_not_available then
      if sqlerrm <> 'A Google Calendar synchronization is already running' then
        raise;
      end if;
  end;

  if v_expected_schedule_count > 0 then
    v_schedule_id := (v_snapshot -> 'schedules' -> 0 ->> 'scheduleId')::bigint;
    select valtrim.finish_google_calendar_sync(
      v_admin_id,
      jsonb_build_array(jsonb_build_object(
        'scheduleId', v_schedule_id::text,
        'googleEventId', 'phase13-validation-google-event',
        'payloadHash', repeat('a', 64),
        'status', 'SYNCED',
        'lastError', null
      )),
      0,
      0,
      1,
      0,
      0,
      null,
      false
    ) into v_finished_at;
  else
    select valtrim.finish_google_calendar_sync(
      v_admin_id,
      '[]'::jsonb,
      0,
      0,
      0,
      0,
      0,
      null,
      false
    ) into v_finished_at;
  end if;

  if v_finished_at is null
     or not exists (
       select 1
       from valtrim.google_calendar_connections connection
       where connection.user_id = v_admin_id
         and connection.sync_started_at is null
         and connection.last_sync_status = 'SUCCESS'
         and connection.last_sync_at = v_finished_at
     ) then
    raise exception 'The sync result did not release its lease and update metadata';
  end if;

  if v_schedule_id is not null
     and not exists (
       select 1
       from valtrim.google_calendar_event_links link
       where link.user_id = v_admin_id
         and link.schedule_id = v_schedule_id
         and link.google_event_id = 'phase13-validation-google-event'
         and link.status = 'SYNCED'
         and link.payload_hash = repeat('a', 64)
         and link.last_synced_at = v_finished_at
     ) then
    raise exception 'The Production-to-Google event mapping was not persisted';
  end if;
end;
$$;

rollback;

select 'phase_13_google_calendar_manual_sync_remote_ok' as result;
