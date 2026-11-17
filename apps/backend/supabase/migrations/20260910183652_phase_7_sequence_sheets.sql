-- Phase 7: persist Sequence Sheet Phases, Lots, the Plan assigned to each Lot,
-- reverse orientation and selected Plan Options. Production and every
-- downstream billing module remain closed.
--
-- Active authenticated users can read active Sequence Sheets. ADMIN and
-- PROJECT_MANAGEMENT save an entire Phase atomically through a role-checked
-- RPC, preventing partial Lot or Option assignments.

begin;

-- Match the existing Sequence Sheet form while making uniqueness checks
-- deterministic at the database boundary.
update valtrim.phases
set code = upper(btrim(code)),
    building = case
      when building is null then null
      else upper(btrim(building))
    end;

update valtrim.lots
set lot_number = upper(btrim(lot_number));

alter table valtrim.phases
  drop constraint if exists phases_code_check,
  add constraint phases_code_check check (
    code = upper(btrim(code))
    and code <> ''
  ),
  add constraint phases_building_check check (
    building is null
    or (
      building = upper(btrim(building))
      and building <> ''
      and char_length(building) <= 50
    )
  );

alter table valtrim.lots
  drop constraint if exists lots_lot_number_check,
  add constraint lots_lot_number_check check (
    lot_number = upper(btrim(lot_number))
    and lot_number <> ''
    and char_length(lot_number) <= 30
  ),
  add constraint lots_display_order_check check (
    display_order between 0 and 499
  );

create index phases_created_by_idx
  on valtrim.phases (created_by)
  where created_by is not null;

create index phases_updated_by_idx
  on valtrim.phases (updated_by)
  where updated_by is not null;

create index lots_created_by_idx
  on valtrim.lots (created_by)
  where created_by is not null;

create index lots_updated_by_idx
  on valtrim.lots (updated_by)
  where updated_by is not null;

create index lot_options_selected_by_idx
  on valtrim.lot_options (selected_by)
  where selected_by is not null;

alter table valtrim.phases enable row level security;
alter table valtrim.lots enable row level security;
alter table valtrim.lot_options enable row level security;

revoke all on table valtrim.phases from public, anon, authenticated;
revoke all on table valtrim.lots from public, anon, authenticated;
revoke all on table valtrim.lot_options from public, anon, authenticated;
revoke all on sequence valtrim.phases_id_seq from public, anon, authenticated;
revoke all on sequence valtrim.lots_id_seq from public, anon, authenticated;

grant select on table valtrim.phases to authenticated;
grant select on table valtrim.lots to authenticated;
grant select on table valtrim.lot_options to authenticated;

create policy phases_select
on valtrim.phases for select to authenticated
using ((select private.is_active_user()));

create policy lots_select
on valtrim.lots for select to authenticated
using ((select private.is_active_user()));

create policy lot_options_select
on valtrim.lot_options for select to authenticated
using ((select private.is_active_user()));

create or replace function valtrim.save_sequence_sheet_phase(
  p_job_id bigint,
  p_phase_id bigint,
  p_code text,
  p_building text,
  p_lots jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_building text := upper(btrim(coalesce(p_building, '')));
  v_phase_id bigint;
  v_phase_active boolean;
  v_lot record;
  v_lot_id bigint;
  v_kept_lot_ids bigint[] := '{}'::bigint[];
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to change Sequence Sheets'
      using errcode = '42501';
  end if;

  if p_job_id is null or p_job_id <= 0 then
    raise exception 'Select an active Job'
      using errcode = '23503';
  end if;

  if v_code = '' or char_length(v_code) > 40 then
    raise exception 'Enter a Phase code with 40 characters or fewer'
      using errcode = '23514';
  end if;

  if v_building = '' or char_length(v_building) > 50 then
    raise exception 'Enter a Building code with 50 characters or fewer'
      using errcode = '23514';
  end if;

  if p_lots is null
     or jsonb_typeof(p_lots) <> 'array'
     or jsonb_array_length(p_lots) < 1
     or jsonb_array_length(p_lots) > 500 then
    raise exception 'A Phase must contain between 1 and 500 Lots'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
    where jsonb_typeof(requested.value) <> 'object'
  ) then
    raise exception 'Every Lot assignment must be an object'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lots) with ordinality requested(value, position)
    where nullif(btrim(requested.value ->> 'lot_number'), '') is null
       or char_length(btrim(requested.value ->> 'lot_number')) > 30
       or nullif(requested.value ->> 'plan_id', '')::bigint <= 0
       or (
         nullif(requested.value ->> 'id', '') is not null
         and nullif(requested.value ->> 'id', '')::bigint <= 0
       )
       or jsonb_typeof(coalesce(requested.value -> 'option_ids', '[]'::jsonb)) <> 'array'
  ) then
    raise exception 'Review the Lot number, Plan and selected Options'
      using errcode = '23514';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(p_lots) requested(value)
  ) <> (
    select count(distinct upper(btrim(requested.value ->> 'lot_number')))
    from jsonb_array_elements(p_lots) requested(value)
  ) then
    raise exception 'Each Lot number can appear only once in a Phase'
      using errcode = '23505';
  end if;

  if (
    select count(nullif(requested.value ->> 'id', ''))
    from jsonb_array_elements(p_lots) requested(value)
  ) <> (
    select count(distinct nullif(requested.value ->> 'id', '')::bigint)
    from jsonb_array_elements(p_lots) requested(value)
  ) then
    raise exception 'Each existing Lot can appear only once'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lots) with ordinality requested(value, position)
    cross join lateral jsonb_array_elements_text(
      coalesce(requested.value -> 'option_ids', '[]'::jsonb)
    ) selected(option_id)
    where selected.option_id !~ '^[1-9][0-9]*$'
  ) then
    raise exception 'Every selected Option must have a valid id'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from (
      select
        requested.position,
        count(*) as option_count,
        count(distinct selected.option_id::bigint) as distinct_option_count
      from jsonb_array_elements(p_lots) with ordinality requested(value, position)
      cross join lateral jsonb_array_elements_text(
        coalesce(requested.value -> 'option_ids', '[]'::jsonb)
      ) selected(option_id)
      group by requested.position
    ) option_counts
    where option_counts.option_count <> option_counts.distinct_option_count
  ) then
    raise exception 'Each Option can be selected only once per Lot'
      using errcode = '23505';
  end if;

  perform 1
  from valtrim.jobs job
  where job.id = p_job_id
    and job.is_active
  for update;

  if not found then
    raise exception 'Select an active Job'
      using errcode = '23503';
  end if;

  if p_phase_id is null then
    select phase.id, phase.is_active
    into v_phase_id, v_phase_active
    from valtrim.phases phase
    where phase.job_id = p_job_id
      and phase.code = v_code
    for update;

    if v_phase_id is null then
      insert into valtrim.phases (job_id, code, building)
      values (p_job_id, v_code, v_building)
      returning id into v_phase_id;
    elsif v_phase_active then
      raise exception 'This Phase already exists for the selected Job'
        using errcode = '23505';
    else
      update valtrim.phases
      set building = v_building,
          is_active = true
      where id = v_phase_id;
    end if;
  else
    select phase.id
    into v_phase_id
    from valtrim.phases phase
    where phase.id = p_phase_id
      and phase.job_id = p_job_id
      and phase.is_active
    for update;

    if v_phase_id is null then
      raise exception 'Select an active Phase from the selected Job'
        using errcode = '23503';
    end if;

    update valtrim.phases
    set code = v_code,
        building = v_building
    where id = v_phase_id;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
    where nullif(requested.value ->> 'id', '') is not null
      and not exists (
        select 1
        from valtrim.lots lot
        where lot.id = (requested.value ->> 'id')::bigint
          and lot.phase_id = v_phase_id
      )
  ) then
    raise exception 'An existing Lot does not belong to the selected Phase'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
    where not exists (
      select 1
      from valtrim.plans plan
      where plan.id = (requested.value ->> 'plan_id')::bigint
        and plan.job_id = p_job_id
        and plan.is_active
    )
  ) then
    raise exception 'Every Lot must use an active Plan from the selected Job'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
    cross join lateral jsonb_array_elements_text(
      coalesce(requested.value -> 'option_ids', '[]'::jsonb)
    ) selected(option_id)
    where not exists (
      select 1
      from valtrim.plan_options option
      where option.id = selected.option_id::bigint
        and option.plan_id = (requested.value ->> 'plan_id')::bigint
        and option.is_active
    )
  ) then
    raise exception 'Every selected Option must belong to the Lot Plan'
      using errcode = '23503';
  end if;

  -- Temporary unique values allow two existing Lots to swap numbers in one
  -- atomic save without tripping the Phase/Lot uniqueness constraint midway.
  update valtrim.lots
  set lot_number = 'SYNC-' || id::text
  where phase_id = v_phase_id;

  for v_lot in
    select
      nullif(requested.value ->> 'id', '')::bigint as id,
      upper(btrim(requested.value ->> 'lot_number')) as lot_number,
      (requested.value ->> 'plan_id')::bigint as plan_id,
      coalesce((requested.value ->> 'is_reverse')::boolean, false) as is_reverse,
      coalesce(requested.value -> 'option_ids', '[]'::jsonb) as option_ids,
      (requested.position - 1)::integer as display_order
    from jsonb_array_elements(p_lots) with ordinality requested(value, position)
    order by requested.position
  loop
    if v_lot.id is null then
      insert into valtrim.lots (
        phase_id,
        job_id,
        plan_id,
        lot_number,
        is_reverse,
        display_order
      )
      values (
        v_phase_id,
        p_job_id,
        v_lot.plan_id,
        v_lot.lot_number,
        v_lot.is_reverse,
        v_lot.display_order
      )
      returning id into v_lot_id;
    else
      v_lot_id := v_lot.id;

      delete from valtrim.lot_options selected
      where selected.lot_id = v_lot_id;

      update valtrim.lots
      set plan_id = v_lot.plan_id,
          lot_number = v_lot.lot_number,
          is_reverse = v_lot.is_reverse,
          display_order = v_lot.display_order
      where id = v_lot_id
        and phase_id = v_phase_id;
    end if;

    insert into valtrim.lot_options (lot_id, plan_id, option_id)
    select
      v_lot_id,
      v_lot.plan_id,
      selected.option_id::bigint
    from jsonb_array_elements_text(v_lot.option_ids) selected(option_id);

    v_kept_lot_ids := array_append(v_kept_lot_ids, v_lot_id);
  end loop;

  delete from valtrim.lots lot
  where lot.phase_id = v_phase_id
    and not (lot.id = any(v_kept_lot_ids));

  return v_phase_id;
end;
$$;

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

  -- Lot deletion is intentional: it releases Plan/Option dependencies while
  -- the Phase identity remains as an auditable, reusable soft-deactivated row.
  -- Future Production references use RESTRICT and will block this operation.
  delete from valtrim.lots
  where phase_id = p_phase_id;

  update valtrim.phases
  set is_active = false
  where id = p_phase_id;

  return p_phase_id;
end;
$$;

revoke execute on function valtrim.save_sequence_sheet_phase(
  bigint, bigint, text, text, jsonb
) from public, anon, authenticated;

revoke execute on function valtrim.deactivate_sequence_sheet_phase(bigint)
  from public, anon, authenticated;

grant execute on function valtrim.save_sequence_sheet_phase(
  bigint, bigint, text, text, jsonb
) to authenticated, service_role;

grant execute on function valtrim.deactivate_sequence_sheet_phase(bigint)
  to authenticated, service_role;

comment on function valtrim.save_sequence_sheet_phase(
  bigint, bigint, text, text, jsonb
) is
  'Atomically creates or updates one Phase, its ordered Lots, Plan assignment, reverse orientation and selected Options. ADMIN and PROJECT_MANAGEMENT only.';

comment on function valtrim.deactivate_sequence_sheet_phase(bigint) is
  'Deletes unreferenced Lot assignments and soft-deactivates a Phase. ADMIN and PROJECT_MANAGEMENT only.';

comment on policy phases_select on valtrim.phases is
  'Active authenticated users can read Sequence Sheet Phases.';

comment on policy lots_select on valtrim.lots is
  'Active authenticated users can read Sequence Sheet Lot assignments.';

comment on policy lot_options_select on valtrim.lot_options is
  'Active authenticated users can read the Options selected for each Lot.';

notify pgrst, 'reload schema';

commit;
