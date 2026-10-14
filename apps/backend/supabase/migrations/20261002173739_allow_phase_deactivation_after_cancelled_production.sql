-- Calendar deletion intentionally soft-cancels Production for audit. Allow a
-- Phase backed only by that cancelled history to leave the active Sequence
-- Sheet without deleting the historical Lot identities. Active Production and
-- Draw Packages remain hard blockers.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table valtrim.phases
  drop constraint phases_job_id_code_key;

create unique index phases_job_active_code_uq
  on valtrim.phases (job_id, code)
  where is_active;

comment on index valtrim.phases_job_active_code_uq is
  'Keeps active Phase codes unique per Job while allowing an archived Phase identity to preserve cancelled Production history.';

-- A newly created Phase with the same code must receive a new identity instead
-- of reactivating and mutating the archived Production snapshot.
do $migration$
declare
  v_definition text;
  v_expected text := $source$
  if p_phase_id is null then
    select phase.id, phase.is_active
    into v_phase_id, v_phase_active
    from valtrim.phases phase
    where phase.job_id = p_job_id and phase.code = v_code
    for update;

    if v_phase_id is null then
      insert into valtrim.phases (job_id, code, building, is_utility_building)
      values (p_job_id, v_code, v_building, false)
      returning id into v_phase_id;
    elsif v_phase_active then
      raise exception 'This Phase already exists for the selected Job'
        using errcode = '23505';
    else
      update valtrim.phases
      set building = v_building,
          is_utility_building = false,
          is_active = true
      where id = v_phase_id;
    end if;
  else
$source$;
  v_replacement text := $source$
  if p_phase_id is null then
    select phase.id
    into v_phase_id
    from valtrim.phases phase
    where phase.job_id = p_job_id
      and phase.code = v_code
      and phase.is_active
    for update;

    if v_phase_id is not null then
      raise exception 'This Phase already exists for the selected Job'
        using errcode = '23505';
    end if;

    insert into valtrim.phases (job_id, code, building, is_utility_building)
    values (p_job_id, v_code, v_building, false)
    returning id into v_phase_id;
  else
$source$;
begin
  select pg_get_functiondef(
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure
  ) into v_definition;

  if position(v_expected in v_definition) = 0 then
    raise exception 'save_sequence_sheet_phase does not match the expected Phase reactivation definition';
  end if;

  execute replace(v_definition, v_expected, v_replacement);
end;
$migration$;

create or replace function valtrim.deactivate_sequence_sheet_phase(
  p_phase_id bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_has_cancelled_production_history boolean;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to change Sequence Sheets'
      using errcode = '42501';
  end if;

  perform 1
  from valtrim.phases phase
  join valtrim.jobs job on job.id = phase.job_id
  where phase.id = p_phase_id
    and phase.is_active
    and job.is_active
  for update of phase;

  if not found then
    raise exception 'Select an active Phase from an active Job'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from valtrim.draw_packages package
    where package.phase_id = p_phase_id
  ) or exists (
    select 1
    from valtrim.package_draws line
    where line.phase_id = p_phase_id
  ) then
    raise exception 'This Phase cannot be deleted because it is used by a Draw Package'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from valtrim.production_activities activity
    where activity.phase_id = p_phase_id
      and activity.status <> 'CANCELLED'::valtrim.production_activity_status
  ) then
    raise exception 'This Phase cannot be deleted because it has active or completed Production history'
      using errcode = '23514';
  end if;

  select exists (
    select 1
    from valtrim.production_activities activity
    where activity.phase_id = p_phase_id
      and activity.status = 'CANCELLED'::valtrim.production_activity_status
  ) into v_has_cancelled_production_history;

  if not v_has_cancelled_production_history then
    delete from valtrim.lots lot
    where lot.phase_id = p_phase_id;
  end if;

  update valtrim.phases
  set is_active = false,
      updated_by = v_actor_id
  where id = p_phase_id;

  return p_phase_id;
end;
$$;

comment on function valtrim.deactivate_sequence_sheet_phase(bigint) is
  'Removes a Phase from the active Sequence Sheet. Unused Lots are deleted; Lots referenced only by cancelled Production remain archived for audit. Draw Packages and active or completed Production block deletion.';

notify pgrst, 'reload schema';

commit;
