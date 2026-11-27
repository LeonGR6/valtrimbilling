-- Baseboard install: another event of the DM stage, scheduled like DM install only.
--
-- It is one more schedule variant of the DM stage: one date with its owner and
-- note, covering every Lot of the activity, at most one per activity. EXT, Shutter
-- and HW do not take it. Nothing about billing changes: the billing events stay
-- EXT, DM and HW.

alter type valtrim.production_schedule_variant add value if not exists 'BASEBOARD_INSTALL';

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
    '''BASE'', ''DIVISION'', ''INSTALL_ONLY'', ''LOCK_UP'')',
    '''BASE'', ''DIVISION'', ''INSTALL_ONLY'', ''BASEBOARD_INSTALL'', ''LOCK_UP'')'
  );
  if v_updated = v_definition then
    raise exception 'save_production_activity variant list did not match the expected definition';
  end if;
  v_definition := v_updated;

  -- 2) Only the DM stage supports it.
  v_updated := replace(
    v_definition,
    'and schedule.value ->> ''variant'' not in (''BASE'', ''DIVISION'', ''INSTALL_ONLY''))',
    'and schedule.value ->> ''variant'' not in (''BASE'', ''DIVISION'', ''INSTALL_ONLY'', ''BASEBOARD_INSTALL''))'
  );
  if v_updated = v_definition then
    raise exception 'save_production_activity DM variants did not match the expected definition';
  end if;
  v_definition := v_updated;

  -- 3) Count it per stage: at most one on DM, none anywhere else.
  v_updated := replace(
    v_definition,
    'count(*) filter (where schedule.value ->> ''variant'' = ''LOCK_UP'') as lock_up_count',
    'count(*) filter (where schedule.value ->> ''variant'' = ''LOCK_UP'') as lock_up_count,
        count(*) filter (where schedule.value ->> ''variant'' = ''BASEBOARD_INSTALL'') as baseboard_count'
  );
  if v_updated = v_definition then
    raise exception 'save_production_activity counts did not match the expected definition';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    'where (schedule_counts.stage_type = ''EXT''',
    'where (schedule_counts.baseboard_count
             > case when schedule_counts.stage_type = ''DM'' then 1 else 0 end)
       or (schedule_counts.stage_type = ''EXT'''
  );
  if v_updated = v_definition then
    raise exception 'save_production_activity stage rules did not match the expected definition';
  end if;
  v_definition := v_updated;

  -- 4) Like install only and lock-up, it covers every Lot of the activity.
  v_updated := replace(
    v_definition,
    'schedule.variant in (''INSTALL_ONLY'', ''LOCK_UP'')',
    'schedule.variant in (''INSTALL_ONLY'', ''BASEBOARD_INSTALL'', ''LOCK_UP'')'
  );
  if v_updated = v_definition then
    raise exception 'save_production_activity lot coverage did not match the expected definition';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    'Install-only and Lock-up schedules must include every activity Lot',
    'Install-only, Baseboard install and Lock-up schedules must include every activity Lot'
  );
  if v_updated = v_definition then
    raise exception 'save_production_activity lot coverage message did not match the expected definition';
  end if;

  execute v_updated;
end;
$migration$;

notify pgrst, 'reload schema';

commit;
