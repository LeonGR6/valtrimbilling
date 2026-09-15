-- Correct the manual sync snapshot to use the current Job identity. Jobs are
-- identified only by code since phase 5; the legacy name column no longer
-- exists.

begin;

create or replace function valtrim.begin_google_calendar_sync(p_user_id uuid)
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

revoke all on function valtrim.begin_google_calendar_sync(uuid)
  from public, anon, authenticated;
grant execute on function valtrim.begin_google_calendar_sync(uuid)
  to service_role;

comment on function valtrim.begin_google_calendar_sync(uuid) is
  'Service-role-only snapshot and lease for one-way manual Production-to-Google synchronization.';

notify pgrst, 'reload schema';

commit;
