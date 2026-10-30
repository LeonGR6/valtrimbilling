-- Phase 10: persist the Production calendar and Builder date configuration.
-- Customer Service and Extra / Change Orders remain closed.
--
-- Active authenticated users can read Production activities. ADMIN,
-- PROJECT_MANAGEMENT and SCHEDULING save a complete Production group through
-- one role-checked RPC. Browser clients cannot mutate activity, stage,
-- schedule, schedule-Lot or date-history rows directly.

begin;

-- The baseline already owns the Builder defaults used by the current UI:
-- EXT -> DM 4 weeks, Shutter 1 week before DM, and DM -> HW 1 week. A focused
-- RPC lets Scheduling manage only these fields without granting general
-- Builder catalogue writes.
create function private.save_builder_date_configuration(
  p_builder_id bigint,
  p_ext_to_dm_weeks smallint,
  p_shutter_before_dm_weeks smallint,
  p_dm_to_hw_weeks smallint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_builder_id bigint;
begin
  if v_actor_id is null
     or not (select private.has_app_role(
       'ADMIN',
       'PROJECT_MANAGEMENT',
       'SCHEDULING'
     )) then
    raise exception 'You do not have permission to change Builder date configuration'
      using errcode = '42501';
  end if;

  if p_builder_id is null or p_builder_id <= 0 then
    raise exception 'Select an active Builder'
      using errcode = '23503';
  end if;

  if p_ext_to_dm_weeks is null
     or p_ext_to_dm_weeks not between 0 and 52
     or p_shutter_before_dm_weeks is null
     or p_shutter_before_dm_weeks not between 1 and 52
     or p_dm_to_hw_weeks is null
     or p_dm_to_hw_weeks not between 0 and 52 then
    raise exception 'Review the Builder week spacing'
      using errcode = '23514';
  end if;

  update valtrim.builders builder
  set ext_to_dm_weeks = p_ext_to_dm_weeks,
      shutter_before_dm_weeks = p_shutter_before_dm_weeks,
      dm_to_hw_weeks = p_dm_to_hw_weeks,
      updated_by = v_actor_id
  where builder.id = p_builder_id
    and builder.is_active
  returning builder.id into v_builder_id;

  if v_builder_id is null then
    raise exception 'The Builder is no longer available'
      using errcode = 'P0002';
  end if;

  return v_builder_id;
end;
$$;

create function valtrim.save_builder_date_configuration(
  p_builder_id bigint,
  p_ext_to_dm_weeks smallint,
  p_shutter_before_dm_weeks smallint,
  p_dm_to_hw_weeks smallint
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.save_builder_date_configuration(
    p_builder_id,
    p_ext_to_dm_weeks,
    p_shutter_before_dm_weeks,
    p_dm_to_hw_weeks
  );
$$;

-- Store the previous and replacement note alongside the existing date/owner
-- audit. Historical baseline rows are preserved; their old note was not
-- available before this phase.
alter table valtrim.production_date_history
  add column previous_note varchar(100),
  add column new_note varchar(100);

alter table valtrim.production_schedules
  add constraint production_schedules_note_length_check
    check (note is null or char_length(note) <= 100)
    not valid;

create index production_activities_created_by_idx
  on valtrim.production_activities (created_by)
  where created_by is not null;
create index production_activities_updated_by_idx
  on valtrim.production_activities (updated_by)
  where updated_by is not null;
create index production_schedules_created_by_idx
  on valtrim.production_schedules (created_by)
  where created_by is not null;
create index production_schedules_updated_by_idx
  on valtrim.production_schedules (updated_by)
  where updated_by is not null;
create index production_date_history_changed_by_idx
  on valtrim.production_date_history (changed_by)
  where changed_by is not null;

create or replace function valtrim.record_production_date_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.scheduled_date is distinct from old.scheduled_date
     or new.date_owner is distinct from old.date_owner then
    insert into valtrim.production_date_history (
      schedule_id,
      previous_date,
      new_date,
      previous_owner,
      new_owner,
      previous_note,
      new_note,
      changed_by
    ) values (
      old.id,
      old.scheduled_date,
      new.scheduled_date,
      old.date_owner,
      new.date_owner,
      old.note,
      new.note,
      new.updated_by
    );
  end if;

  return new;
end;
$$;

-- p_stages example:
-- [{"type":"EXT","orderMaterial":false,"schedules":[
--   {"id":null,"variant":"BASE","date":"2026-09-10",
--    "dateOwner":"TENTATIVE","note":null,"lotIds":[1,2]}]}]
create function private.save_production_activity(
  p_activity_id bigint,
  p_phase_id bigint,
  p_lot_ids bigint[],
  p_stages jsonb,
  p_notes text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_activity_id bigint;
  v_job_id bigint;
  v_supervisor_id bigint;
  v_superintendent_id bigint;
  v_supervisor_name text;
  v_superintendent_name text;
  v_stage jsonb;
  v_stage_type valtrim.production_stage_type;
  v_stage_id bigint;
  v_schedule jsonb;
  v_schedule_id bigint;
  v_requested_schedule_id bigint;
  v_schedule_lot_ids bigint[];
  v_expected integer;
  v_found integer;
  v_primary_count integer;
begin
  if v_actor_id is null
     or not (select private.has_app_role(
       'ADMIN',
       'PROJECT_MANAGEMENT',
       'SCHEDULING'
     )) then
    raise exception 'You do not have permission to change Production calendar activities'
      using errcode = '42501';
  end if;

  if p_phase_id is null or p_phase_id <= 0 then
    raise exception 'Select an active Phase'
      using errcode = '23503';
  end if;

  if p_activity_id is not null and p_activity_id <= 0 then
    raise exception 'Select a valid Production activity'
      using errcode = '23503';
  end if;

  if p_notes is not null and char_length(btrim(p_notes)) > 500 then
    raise exception 'Production notes must contain 500 characters or fewer'
      using errcode = '23514';
  end if;

  if p_lot_ids is null
     or cardinality(p_lot_ids) < 1
     or cardinality(p_lot_ids) > 500 then
    raise exception 'Select between 1 and 500 Lots'
      using errcode = '23514';
  end if;

  select count(distinct requested), count(*)
  into v_expected, v_found
  from unnest(p_lot_ids) requested;

  if v_expected <> v_found
     or exists (select 1 from unnest(p_lot_ids) requested where requested <= 0) then
    raise exception 'Every selected Lot must be unique and valid'
      using errcode = '23514';
  end if;

  if p_stages is null
     or jsonb_typeof(p_stages) <> 'array'
     or jsonb_array_length(p_stages) not between 3 and 4 then
    raise exception 'Production must include EXT, DM and HW, with optional Shutter'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_stages) requested(value)
    where jsonb_typeof(requested.value) <> 'object'
      or coalesce(requested.value ->> 'type', '') not in ('EXT', 'SHUTTER', 'DM', 'HW')
      or jsonb_typeof(coalesce(requested.value -> 'schedules', '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(requested.value -> 'schedules', '[]'::jsonb)) < 1
  ) then
    raise exception 'Review every Production stage and schedule'
      using errcode = '23514';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(p_stages) requested(value)
  ) <> (
    select count(distinct requested.value ->> 'type')
    from jsonb_array_elements(p_stages) requested(value)
  ) then
    raise exception 'Each Production stage can appear only once'
      using errcode = '23505';
  end if;

  if not exists (
    select 1 from jsonb_array_elements(p_stages) requested(value)
    where requested.value ->> 'type' = 'EXT'
  ) or not exists (
    select 1 from jsonb_array_elements(p_stages) requested(value)
    where requested.value ->> 'type' = 'DM'
  ) or not exists (
    select 1 from jsonb_array_elements(p_stages) requested(value)
    where requested.value ->> 'type' = 'HW'
  ) then
    raise exception 'Production must include EXT, DM and HW'
      using errcode = '23514';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(p_stages) stage(value)
    cross join lateral jsonb_array_elements(stage.value -> 'schedules') schedule(value)
  ) > 50 then
    raise exception 'Production cannot contain more than 50 schedules'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_stages) stage(value)
    cross join lateral jsonb_array_elements(stage.value -> 'schedules') schedule(value)
    where jsonb_typeof(schedule.value) <> 'object'
      or coalesce(schedule.value ->> 'variant', '') not in ('BASE', 'DIVISION', 'INSTALL_ONLY', 'LOCK_UP')
      or coalesce(schedule.value ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(nullif(schedule.value ->> 'dateOwner', ''), 'TENTATIVE')
        not in ('SUPERVISOR', 'JOBSITE_SUPERINTENDENT', 'TENTATIVE')
      or char_length(btrim(coalesce(schedule.value ->> 'note', ''))) > 100
      or jsonb_typeof(coalesce(schedule.value -> 'lotIds', '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(schedule.value -> 'lotIds', '[]'::jsonb)) < 1
      or (
        nullif(schedule.value ->> 'id', '') is not null
        and schedule.value ->> 'id' !~ '^[1-9][0-9]*$'
      )
  ) then
    raise exception 'Review every Production schedule date, type, note and Lot selection'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_stages) stage(value)
    cross join lateral jsonb_array_elements(stage.value -> 'schedules') schedule(value)
    cross join lateral jsonb_array_elements_text(schedule.value -> 'lotIds') lot_id(value)
    where lot_id.value !~ '^[1-9][0-9]*$'
  ) then
    raise exception 'Every schedule Lot must have a valid id'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_stages) stage(value)
    cross join lateral jsonb_array_elements(stage.value -> 'schedules') schedule(value)
    cross join lateral jsonb_array_elements_text(schedule.value -> 'lotIds') lot_id(value)
    group by stage.value ->> 'type', schedule.value
    having count(*) <> count(distinct lot_id.value::bigint)
  ) then
    raise exception 'A schedule cannot contain the same Lot twice'
      using errcode = '23505';
  end if;

  if (
    select count(nullif(schedule.value ->> 'id', ''))
    from jsonb_array_elements(p_stages) stage(value)
    cross join lateral jsonb_array_elements(stage.value -> 'schedules') schedule(value)
  ) <> (
    select count(distinct nullif(schedule.value ->> 'id', '')::bigint)
    from jsonb_array_elements(p_stages) stage(value)
    cross join lateral jsonb_array_elements(stage.value -> 'schedules') schedule(value)
  ) then
    raise exception 'Each persisted schedule can appear only once'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_stages) stage(value)
    cross join lateral jsonb_array_elements(stage.value -> 'schedules') schedule(value)
    where (stage.value ->> 'type' = 'EXT'
           and schedule.value ->> 'variant' not in ('BASE', 'INSTALL_ONLY'))
       or (stage.value ->> 'type' = 'SHUTTER'
           and schedule.value ->> 'variant' <> 'BASE')
       or (stage.value ->> 'type' = 'DM'
           and schedule.value ->> 'variant' not in ('BASE', 'DIVISION', 'INSTALL_ONLY'))
       or (stage.value ->> 'type' = 'HW'
           and schedule.value ->> 'variant' not in ('BASE', 'DIVISION', 'LOCK_UP'))
  ) then
    raise exception 'A schedule variant is not supported by its Production stage'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from (
      select
        stage.value ->> 'type' as stage_type,
        count(*) filter (where schedule.value ->> 'variant' = 'BASE') as base_count,
        count(*) filter (where schedule.value ->> 'variant' = 'DIVISION') as division_count,
        count(*) filter (where schedule.value ->> 'variant' = 'INSTALL_ONLY') as install_count,
        count(*) filter (where schedule.value ->> 'variant' = 'LOCK_UP') as lock_up_count
      from jsonb_array_elements(p_stages) stage(value)
      cross join lateral jsonb_array_elements(stage.value -> 'schedules') schedule(value)
      group by stage.value ->> 'type'
    ) schedule_counts
    where (schedule_counts.stage_type = 'EXT'
           and (
             schedule_counts.base_count <> 1
             or schedule_counts.division_count <> 0
             or schedule_counts.install_count > 1
             or schedule_counts.lock_up_count <> 0
           ))
       or (schedule_counts.stage_type = 'SHUTTER'
           and (
             schedule_counts.base_count <> 1
             or schedule_counts.division_count <> 0
             or schedule_counts.install_count <> 0
             or schedule_counts.lock_up_count <> 0
           ))
       or (schedule_counts.stage_type = 'DM'
           and (
             not (
               (schedule_counts.base_count = 1 and schedule_counts.division_count = 0)
               or (schedule_counts.base_count = 0 and schedule_counts.division_count >= 2)
             )
             or schedule_counts.install_count > 1
             or schedule_counts.lock_up_count <> 0
           ))
       or (schedule_counts.stage_type = 'HW'
           and (
             not (
               (schedule_counts.base_count = 1 and schedule_counts.division_count = 0)
               or (schedule_counts.base_count = 0 and schedule_counts.division_count >= 2)
             )
             or schedule_counts.install_count <> 0
             or schedule_counts.lock_up_count > 1
           ))
  ) then
    raise exception 'Review the schedule variants for each Production stage'
      using errcode = '23514';
  end if;

  select
    phase.job_id,
    job.supervisor_id,
    job.superintendent_id,
    supervisor.name,
    superintendent.name
  into
    v_job_id,
    v_supervisor_id,
    v_superintendent_id,
    v_supervisor_name,
    v_superintendent_name
  from valtrim.phases phase
  join valtrim.jobs job
    on job.id = phase.job_id
   and job.is_active
  join valtrim.people supervisor
    on supervisor.id = job.supervisor_id
   and supervisor.is_active
  join valtrim.builder_contacts superintendent
    on superintendent.id = job.superintendent_id
   and superintendent.builder_id = job.builder_id
   and superintendent.is_active
  where phase.id = p_phase_id
    and phase.is_active
  for update of phase;

  if v_job_id is null then
    raise exception 'The Phase, Job or Production team is no longer available'
      using errcode = '23503';
  end if;

  select count(*) into v_found
  from valtrim.lots lot
  where lot.phase_id = p_phase_id
    and lot.id = any(p_lot_ids);

  if v_found <> cardinality(p_lot_ids) then
    raise exception 'Every selected Lot must belong to the selected Phase'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_stages) stage(value)
    cross join lateral jsonb_array_elements(stage.value -> 'schedules') schedule(value)
    cross join lateral jsonb_array_elements_text(schedule.value -> 'lotIds') lot_id(value)
    where lot_id.value::bigint <> all(p_lot_ids)
  ) then
    raise exception 'A schedule contains Lots outside the Production activity'
      using errcode = '23503';
  end if;

  if p_activity_id is null then
    insert into valtrim.production_activities (
      phase_id,
      job_id,
      supervisor_id,
      superintendent_id,
      supervisor_name,
      superintendent_name,
      notes,
      created_by,
      updated_by
    ) values (
      p_phase_id,
      v_job_id,
      v_supervisor_id,
      v_superintendent_id,
      v_supervisor_name,
      v_superintendent_name,
      nullif(btrim(p_notes), ''),
      v_actor_id,
      v_actor_id
    ) returning id into v_activity_id;
  else
    select activity.id into v_activity_id
    from valtrim.production_activities activity
    where activity.id = p_activity_id
      and activity.phase_id = p_phase_id
      and activity.job_id = v_job_id
      and activity.status = 'ACTIVE'
    for update;

    if v_activity_id is null then
      raise exception 'The Production activity is no longer available'
        using errcode = 'P0002';
    end if;

    update valtrim.production_activities activity
    set supervisor_id = v_supervisor_id,
        superintendent_id = v_superintendent_id,
        supervisor_name = v_supervisor_name,
        superintendent_name = v_superintendent_name,
        notes = nullif(btrim(p_notes), ''),
        updated_by = v_actor_id
    where activity.id = v_activity_id;
  end if;

  delete from valtrim.production_activity_lots activity_lot
  where activity_lot.activity_id = v_activity_id;

  insert into valtrim.production_activity_lots (activity_id, phase_id, lot_id)
  select v_activity_id, p_phase_id, requested
  from unnest(p_lot_ids) requested;

  -- Any schedule not present in the submitted group becomes inactive. Existing
  -- schedule identities that are submitted are updated in place so their audit
  -- history remains attached.
  update valtrim.production_schedules schedule
  set is_active = false,
      updated_by = v_actor_id
  where schedule.activity_id = v_activity_id;

  update valtrim.production_stages stage
  set is_enabled = false
  where stage.activity_id = v_activity_id;

  for v_stage in
    select value
    from jsonb_array_elements(p_stages)
  loop
    v_stage_type := (v_stage ->> 'type')::valtrim.production_stage_type;

    select stage.id into v_stage_id
    from valtrim.production_stages stage
    where stage.activity_id = v_activity_id
      and stage.stage_type = v_stage_type
    for update;

    if v_stage_id is null then
      insert into valtrim.production_stages (
        activity_id,
        stage_type,
        is_enabled,
        order_material
      ) values (
        v_activity_id,
        v_stage_type,
        true,
        case
          when v_stage_type = 'EXT'
            then coalesce((v_stage ->> 'orderMaterial')::boolean, false)
          else false
        end
      ) returning id into v_stage_id;
    else
      update valtrim.production_stages stage
      set is_enabled = true,
          order_material = case
            when v_stage_type = 'EXT'
              then coalesce((v_stage ->> 'orderMaterial')::boolean, false)
            else false
          end
      where stage.id = v_stage_id;
    end if;

    for v_schedule in
      select value
      from jsonb_array_elements(v_stage -> 'schedules')
    loop
      v_requested_schedule_id := nullif(v_schedule ->> 'id', '')::bigint;

      select array_agg(lot_id.value::bigint order by lot_id.ordinality)
      into v_schedule_lot_ids
      from jsonb_array_elements_text(v_schedule -> 'lotIds')
        with ordinality lot_id(value, ordinality);

      if v_requested_schedule_id is null then
        insert into valtrim.production_schedules (
          stage_id,
          activity_id,
          variant,
          scheduled_date,
          date_owner,
          note,
          lot_start_label,
          lot_end_label,
          is_active,
          created_by,
          updated_by
        )
        select
          v_stage_id,
          v_activity_id,
          (v_schedule ->> 'variant')::valtrim.production_schedule_variant,
          (v_schedule ->> 'date')::date,
          coalesce(
            nullif(v_schedule ->> 'dateOwner', '')::valtrim.date_owner,
            'TENTATIVE'::valtrim.date_owner
          ),
          nullif(btrim(v_schedule ->> 'note'), ''),
          min(lot.lot_number),
          max(lot.lot_number),
          true,
          v_actor_id,
          v_actor_id
        from valtrim.lots lot
        where lot.id = any(v_schedule_lot_ids)
        returning id into v_schedule_id;
      else
        update valtrim.production_schedules schedule
        set variant = (v_schedule ->> 'variant')::valtrim.production_schedule_variant,
            scheduled_date = (v_schedule ->> 'date')::date,
            date_owner = coalesce(
              nullif(v_schedule ->> 'dateOwner', '')::valtrim.date_owner,
              'TENTATIVE'::valtrim.date_owner
            ),
            note = nullif(btrim(v_schedule ->> 'note'), ''),
            lot_start_label = (
              select min(lot.lot_number)
              from valtrim.lots lot
              where lot.id = any(v_schedule_lot_ids)
            ),
            lot_end_label = (
              select max(lot.lot_number)
              from valtrim.lots lot
              where lot.id = any(v_schedule_lot_ids)
            ),
            is_active = true,
            updated_by = v_actor_id
        where schedule.id = v_requested_schedule_id
          and schedule.activity_id = v_activity_id
          and schedule.stage_id = v_stage_id
        returning schedule.id into v_schedule_id;

        if v_schedule_id is null then
          raise exception 'A submitted schedule does not belong to this Production activity'
            using errcode = '23503';
        end if;
      end if;

      delete from valtrim.production_schedule_lots schedule_lot
      where schedule_lot.schedule_id = v_schedule_id;

      insert into valtrim.production_schedule_lots (schedule_id, lot_id)
      select v_schedule_id, requested
      from unnest(v_schedule_lot_ids) requested;
    end loop;
  end loop;

  -- BASE or DIVISION rows are the primary schedule for a stage. They must
  -- cover every activity Lot exactly once. This prevents gaps and overlaps
  -- even if a client bypasses the React form validation.
  foreach v_stage_type in array array[
    'EXT'::valtrim.production_stage_type,
    'DM'::valtrim.production_stage_type,
    'HW'::valtrim.production_stage_type
  ]
  loop
    select count(*) into v_primary_count
    from valtrim.production_schedule_lots schedule_lot
    join valtrim.production_schedules schedule
      on schedule.id = schedule_lot.schedule_id
     and schedule.activity_id = v_activity_id
     and schedule.is_active
     and schedule.variant in ('BASE', 'DIVISION')
    join valtrim.production_stages stage
      on stage.id = schedule.stage_id
     and stage.stage_type = v_stage_type;

    if v_primary_count <> cardinality(p_lot_ids)
       or exists (
         select 1
         from valtrim.production_schedule_lots schedule_lot
         join valtrim.production_schedules schedule
           on schedule.id = schedule_lot.schedule_id
          and schedule.activity_id = v_activity_id
          and schedule.is_active
          and schedule.variant in ('BASE', 'DIVISION')
         join valtrim.production_stages stage
           on stage.id = schedule.stage_id
          and stage.stage_type = v_stage_type
         group by schedule_lot.lot_id
         having count(*) <> 1
       ) then
      raise exception 'Each required stage must schedule every activity Lot exactly once'
        using errcode = '23514';
    end if;
  end loop;

  -- Optional schedules always represent the complete activity Lot selection.
  if exists (
    select 1
    from valtrim.production_schedules schedule
    where schedule.activity_id = v_activity_id
      and schedule.is_active
      and schedule.variant in ('INSTALL_ONLY', 'LOCK_UP')
      and (
        select count(*)
        from valtrim.production_schedule_lots schedule_lot
        where schedule_lot.schedule_id = schedule.id
      ) <> cardinality(p_lot_ids)
  ) then
    raise exception 'Install-only and Lock-up schedules must include every activity Lot'
      using errcode = '23514';
  end if;

  return v_activity_id;
end;
$$;

create function valtrim.save_production_activity(
  p_activity_id bigint,
  p_phase_id bigint,
  p_lot_ids bigint[],
  p_stages jsonb,
  p_notes text default null
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.save_production_activity(
    p_activity_id,
    p_phase_id,
    p_lot_ids,
    p_stages,
    p_notes
  );
$$;

alter table valtrim.production_activities enable row level security;
alter table valtrim.production_activity_lots enable row level security;
alter table valtrim.production_stages enable row level security;
alter table valtrim.production_schedules enable row level security;
alter table valtrim.production_schedule_lots enable row level security;
alter table valtrim.production_date_history enable row level security;

revoke all on table valtrim.production_activities from public, anon, authenticated;
revoke all on table valtrim.production_activity_lots from public, anon, authenticated;
revoke all on table valtrim.production_stages from public, anon, authenticated;
revoke all on table valtrim.production_schedules from public, anon, authenticated;
revoke all on table valtrim.production_schedule_lots from public, anon, authenticated;
revoke all on table valtrim.production_date_history from public, anon, authenticated;

revoke all on sequence valtrim.production_activities_id_seq from public, anon, authenticated;
revoke all on sequence valtrim.production_stages_id_seq from public, anon, authenticated;
revoke all on sequence valtrim.production_schedules_id_seq from public, anon, authenticated;
revoke all on sequence valtrim.production_date_history_id_seq from public, anon, authenticated;

grant select (
  id,
  phase_id,
  job_id,
  status,
  supervisor_id,
  superintendent_id,
  supervisor_name,
  superintendent_name,
  notes,
  created_at,
  updated_at
) on valtrim.production_activities to authenticated;

grant select (
  activity_id,
  phase_id,
  lot_id
) on valtrim.production_activity_lots to authenticated;

grant select (
  id,
  activity_id,
  stage_type,
  is_enabled,
  order_material
) on valtrim.production_stages to authenticated;

grant select (
  id,
  stage_id,
  activity_id,
  variant,
  scheduled_date,
  date_owner,
  note,
  lot_start_label,
  lot_end_label,
  is_active,
  created_at,
  updated_at
) on valtrim.production_schedules to authenticated;

grant select (
  schedule_id,
  lot_id
) on valtrim.production_schedule_lots to authenticated;

grant select (
  id,
  schedule_id,
  previous_date,
  new_date,
  previous_owner,
  new_owner,
  previous_note,
  new_note,
  changed_at
) on valtrim.production_date_history to authenticated;

create policy production_activities_select
on valtrim.production_activities for select to authenticated
using ((select private.is_active_user()));

create policy production_activity_lots_select
on valtrim.production_activity_lots for select to authenticated
using ((select private.is_active_user()));

create policy production_stages_select
on valtrim.production_stages for select to authenticated
using ((select private.is_active_user()));

create policy production_schedules_select
on valtrim.production_schedules for select to authenticated
using ((select private.is_active_user()));

create policy production_schedule_lots_select
on valtrim.production_schedule_lots for select to authenticated
using ((select private.is_active_user()));

create policy production_date_history_select
on valtrim.production_date_history for select to authenticated
using ((select private.is_active_user()));

revoke execute on function valtrim.create_production_activity(
  bigint,
  jsonb,
  bigint[],
  text,
  uuid
) from public, anon, authenticated;

revoke execute on function private.save_builder_date_configuration(
  bigint,
  smallint,
  smallint,
  smallint
) from public, anon, authenticated;
revoke execute on function valtrim.save_builder_date_configuration(
  bigint,
  smallint,
  smallint,
  smallint
) from public, anon, authenticated;
revoke execute on function private.save_production_activity(
  bigint,
  bigint,
  bigint[],
  jsonb,
  text
) from public, anon, authenticated;
revoke execute on function valtrim.save_production_activity(
  bigint,
  bigint,
  bigint[],
  jsonb,
  text
) from public, anon, authenticated;
revoke execute on function valtrim.record_production_date_change()
  from public, anon, authenticated;

grant execute on function private.save_builder_date_configuration(
  bigint,
  smallint,
  smallint,
  smallint
) to authenticated, service_role;
grant execute on function valtrim.save_builder_date_configuration(
  bigint,
  smallint,
  smallint,
  smallint
) to authenticated, service_role;
grant execute on function private.save_production_activity(
  bigint,
  bigint,
  bigint[],
  jsonb,
  text
) to authenticated, service_role;
grant execute on function valtrim.save_production_activity(
  bigint,
  bigint,
  bigint[],
  jsonb,
  text
) to authenticated, service_role;

comment on function valtrim.save_builder_date_configuration(
  bigint,
  smallint,
  smallint,
  smallint
) is
  'Saves EXT, Shutter, DM and HW week spacing for one active Builder. ADMIN, PROJECT_MANAGEMENT and SCHEDULING only.';

comment on function valtrim.save_production_activity(
  bigint,
  bigint,
  bigint[],
  jsonb,
  text
) is
  'Creates or updates one complete persisted Production calendar group atomically. ADMIN, PROJECT_MANAGEMENT and SCHEDULING only.';

comment on policy production_activities_select on valtrim.production_activities is
  'Active authenticated users can read Production activities.';

-- Customer Service and Extra / Change Orders remain inaccessible. The current
-- Extra / Change Orders tab stays a UI placeholder and no Customer Service
-- grants, policies, functions or tables are opened here.
notify pgrst, 'reload schema';

commit;
