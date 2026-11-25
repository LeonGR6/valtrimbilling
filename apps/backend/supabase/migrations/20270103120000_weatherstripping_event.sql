-- Weatherstripping: another event of the HW stage, scheduled like Lock up.
--
-- It is one more schedule variant of the HW stage: one date with its owner and
-- note, covering every Lot of the activity, at most one per activity. EXT, Shutter
-- and DM do not take it. Nothing about billing changes: like the Baseboard
-- install, it is no billing event, so the Lot event dates leave it out.

alter type valtrim.production_schedule_variant add value if not exists 'WEATHERSTRIPPING';

begin;

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'private.save_production_activity(bigint,bigint,bigint[],jsonb,text)'::regprocedure
  ) into v_definition;

  -- 1) A known variant.
  v_updated := replace(
    v_definition,
    '''BASE'', ''DIVISION'', ''INSTALL_ONLY'', ''BASEBOARD_INSTALL'', ''LOCK_UP'')',
    '''BASE'', ''DIVISION'', ''INSTALL_ONLY'', ''BASEBOARD_INSTALL'', ''LOCK_UP'', ''WEATHERSTRIPPING'')'
  );
  if v_updated = v_definition then
    raise exception 'save_production_activity variant list did not match the expected definition';
  end if;
  v_definition := v_updated;

  -- 2) Only the HW stage supports it.
  v_updated := replace(
    v_definition,
    'and schedule.value ->> ''variant'' not in (''BASE'', ''DIVISION'', ''LOCK_UP''))',
    'and schedule.value ->> ''variant'' not in (''BASE'', ''DIVISION'', ''LOCK_UP'', ''WEATHERSTRIPPING''))'
  );
  if v_updated = v_definition then
    raise exception 'save_production_activity HW variants did not match the expected definition';
  end if;
  v_definition := v_updated;

  -- 3) Count it per stage: at most one on HW, none anywhere else.
  v_updated := replace(
    v_definition,
    'count(*) filter (where schedule.value ->> ''variant'' = ''BASEBOARD_INSTALL'') as baseboard_count',
    'count(*) filter (where schedule.value ->> ''variant'' = ''BASEBOARD_INSTALL'') as baseboard_count,
        count(*) filter (where schedule.value ->> ''variant'' = ''WEATHERSTRIPPING'') as weatherstripping_count'
  );
  if v_updated = v_definition then
    raise exception 'save_production_activity counts did not match the expected definition';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    'where (schedule_counts.baseboard_count',
    'where (schedule_counts.weatherstripping_count
             > case when schedule_counts.stage_type = ''HW'' then 1 else 0 end)
       or (schedule_counts.baseboard_count'
  );
  if v_updated = v_definition then
    raise exception 'save_production_activity stage rules did not match the expected definition';
  end if;
  v_definition := v_updated;

  -- 4) Like lock-up, it covers every Lot of the activity.
  v_updated := replace(
    v_definition,
    'schedule.variant in (''INSTALL_ONLY'', ''BASEBOARD_INSTALL'', ''LOCK_UP'')',
    'schedule.variant in (''INSTALL_ONLY'', ''BASEBOARD_INSTALL'', ''LOCK_UP'', ''WEATHERSTRIPPING'')'
  );
  if v_updated = v_definition then
    raise exception 'save_production_activity lot coverage did not match the expected definition';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    'Install-only, Baseboard install and Lock-up schedules must include every activity Lot',
    'Install-only, Baseboard install, Lock-up and Weatherstripping schedules must include every activity Lot'
  );
  if v_updated = v_definition then
    raise exception 'save_production_activity lot coverage message did not match the expected definition';
  end if;

  execute v_updated;
end;
$migration$;

-- The date of an event for a Lot (Extra / CO cut-offs) is never the Weatherstripping one.
create or replace function private.lot_event_dates(p_lot_ids bigint[])
returns table(lot_id bigint, event_type text, scheduled_date date, date_owner text)
language sql
stable
set search_path to ''
as $function$
  select distinct on (schedule_lot.lot_id, stage.stage_type)
    schedule_lot.lot_id,
    stage.stage_type::text,
    schedule.scheduled_date,
    schedule.date_owner::text
  from valtrim.production_schedule_lots schedule_lot
  join valtrim.production_schedules schedule
    on schedule.id = schedule_lot.schedule_id
   and schedule.is_active
   and schedule.variant not in ('BASEBOARD_INSTALL', 'WEATHERSTRIPPING')
  join valtrim.production_stages stage
    on stage.id = schedule.stage_id
   and stage.is_enabled
   and stage.stage_type in ('EXT', 'DM', 'HW')
  join valtrim.production_activities activity
    on activity.id = schedule.activity_id
   and activity.status = 'ACTIVE'
  where schedule_lot.lot_id = any (p_lot_ids)
  order by schedule_lot.lot_id, stage.stage_type, schedule.scheduled_date, schedule.id;
$function$;

notify pgrst, 'reload schema';

commit;
