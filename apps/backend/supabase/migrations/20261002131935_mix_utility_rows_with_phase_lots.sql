-- A Phase can mix ordinary Lots and Utility Building rows. Utility identity
-- belongs to each row; the Phase-level flag remains only as a legacy bridge for
-- the already-deployed migration that introduced the capability.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table valtrim.lots
  add column is_utility_building boolean not null default false;

comment on column valtrim.lots.is_utility_building is
  'Marks a Plan-only Utility Building row. It is excluded from Lot counts, ranges, Options, Hardware and Production.';

-- Preserve any rows created while the short-lived Phase-level implementation
-- was active, then retire that flag from runtime behavior.
update valtrim.lots lot
set is_utility_building = true,
    is_reverse = false
from valtrim.phases phase
where phase.id = lot.phase_id
  and phase.is_utility_building;

delete from valtrim.lot_options selected
using valtrim.lots lot
where lot.id = selected.lot_id
  and lot.is_utility_building;

update valtrim.phases
set is_utility_building = false
where is_utility_building;

comment on column valtrim.phases.is_utility_building is
  'Deprecated compatibility column. Utility Building identity is stored per valtrim.lots row.';

grant select (is_utility_building) on valtrim.lots to authenticated;

create or replace function valtrim.save_sequence_sheet_phase(
  p_job_id bigint,
  p_phase_id bigint,
  p_code text,
  p_building text,
  p_lots jsonb,
  p_is_utility_building boolean
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
  v_legacy_all_utility boolean := coalesce(p_is_utility_building, false);
  v_has_utility boolean;
  v_utility_enabled boolean;
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
    raise exception 'Select an active Job' using errcode = '23503';
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
    raise exception 'A Phase must contain between 1 and 500 rows'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lots) requested(value)
    where jsonb_typeof(requested.value) <> 'object'
  ) then
    raise exception 'Every Phase row must be an object' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
    where coalesce(requested.value ->> 'plan_id', '') !~ '^[1-9][0-9]*$'
       or (
         nullif(requested.value ->> 'id', '') is not null
         and requested.value ->> 'id' !~ '^[1-9][0-9]*$'
       )
       or jsonb_typeof(coalesce(requested.value -> 'option_ids', '[]'::jsonb)) <> 'array'
       or (
         not coalesce(
           (requested.value ->> 'is_utility_building')::boolean,
           v_legacy_all_utility
         )
         and (
           nullif(btrim(requested.value ->> 'lot_number'), '') is null
           or char_length(btrim(requested.value ->> 'lot_number')) > 30
         )
       )
  ) then
    raise exception 'Review the row Plan, Lot number and selected Options'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
    where coalesce(
      (requested.value ->> 'is_utility_building')::boolean,
      v_legacy_all_utility
    )
    and (
      coalesce((requested.value ->> 'is_reverse')::boolean, false)
      or jsonb_array_length(
        coalesce(requested.value -> 'option_ids', '[]'::jsonb)
      ) > 0
    )
  ) then
    raise exception 'Utility Building rows cannot include Reverse or Options'
      using errcode = '23514';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(p_lots) requested(value)
    where not coalesce(
      (requested.value ->> 'is_utility_building')::boolean,
      v_legacy_all_utility
    )
  ) <> (
    select count(distinct upper(btrim(requested.value ->> 'lot_number')))
    from jsonb_array_elements(p_lots) requested(value)
    where not coalesce(
      (requested.value ->> 'is_utility_building')::boolean,
      v_legacy_all_utility
    )
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
    raise exception 'Each existing row can appear only once'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
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
      select requested.position,
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

  select exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
    where coalesce(
      (requested.value ->> 'is_utility_building')::boolean,
      v_legacy_all_utility
    )
  ) into v_has_utility;

  select version.utility_building
  into v_utility_enabled
  from valtrim.jobs job
  join valtrim.billing_setup_versions version
    on version.id = job.billing_setup_version_id
   and version.builder_id = job.builder_id
  where job.id = p_job_id
    and job.is_active
    and version.status in ('ACTIVE', 'SUPERSEDED')
  for update of job;

  if v_utility_enabled is null then
    raise exception 'Select an active Job with an available Billing Setup'
      using errcode = '23503';
  end if;
  if v_has_utility and not v_utility_enabled then
    raise exception 'Utility Building is inactive for this Job Billing Setup'
      using errcode = '23514';
  end if;

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
        building = v_building,
        is_utility_building = false
    where id = v_phase_id;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
    where nullif(requested.value ->> 'id', '') is not null
      and not exists (
        select 1 from valtrim.lots lot
        where lot.id = (requested.value ->> 'id')::bigint
          and lot.phase_id = v_phase_id
      )
  ) then
    raise exception 'An existing row does not belong to the selected Phase'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
    join valtrim.lots lot
      on lot.id = nullif(requested.value ->> 'id', '')::bigint
     and lot.phase_id = v_phase_id
    where lot.is_utility_building is distinct from coalesce(
      (requested.value ->> 'is_utility_building')::boolean,
      v_legacy_all_utility
    )
  ) then
    raise exception 'An existing row cannot change between Lot and Utility Building'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
    where not exists (
      select 1 from valtrim.plans plan
      where plan.id = (requested.value ->> 'plan_id')::bigint
        and plan.job_id = p_job_id
        and plan.is_active
    )
  ) then
    raise exception 'Every Phase row must use an active Plan from the selected Job'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
    cross join lateral jsonb_array_elements_text(
      coalesce(requested.value -> 'option_ids', '[]'::jsonb)
    ) selected(option_id)
    where not exists (
      select 1 from valtrim.plan_options option
      where option.id = selected.option_id::bigint
        and option.plan_id = (requested.value ->> 'plan_id')::bigint
        and option.is_active
    )
  ) then
    raise exception 'Every selected Option must belong to the Lot Plan'
      using errcode = '23503';
  end if;

  update valtrim.lots
  set lot_number = 'SYNC-' || id::text
  where phase_id = v_phase_id;

  for v_lot in
    with requested_rows as (
      select
        nullif(requested.value ->> 'id', '')::bigint as id,
        requested.value,
        requested.position,
        coalesce(
          (requested.value ->> 'is_utility_building')::boolean,
          v_legacy_all_utility
        ) as is_utility_building
      from jsonb_array_elements(p_lots) with ordinality requested(value, position)
    ), normalized_rows as (
      select
        requested.id,
        requested.value,
        requested.position,
        requested.is_utility_building,
        sum(case when requested.is_utility_building then 1 else 0 end)
          over (order by requested.position) as utility_position
      from requested_rows requested
    )
    select
      requested.id,
      case
        when requested.is_utility_building
          then 'UTILITY-' || requested.utility_position::text
        else upper(btrim(requested.value ->> 'lot_number'))
      end as lot_number,
      (requested.value ->> 'plan_id')::bigint as plan_id,
      case when requested.is_utility_building then false
        else coalesce((requested.value ->> 'is_reverse')::boolean, false)
      end as is_reverse,
      case when requested.is_utility_building then '[]'::jsonb
        else coalesce(requested.value -> 'option_ids', '[]'::jsonb)
      end as option_ids,
      requested.is_utility_building,
      (requested.position - 1)::integer as display_order
    from normalized_rows requested
    order by requested.position
  loop
    if v_lot.id is null then
      insert into valtrim.lots (
        phase_id, job_id, plan_id, lot_number, is_reverse,
        is_utility_building, display_order
      ) values (
        v_phase_id, p_job_id, v_lot.plan_id, v_lot.lot_number,
        v_lot.is_reverse, v_lot.is_utility_building, v_lot.display_order
      ) returning id into v_lot_id;
    else
      v_lot_id := v_lot.id;
      delete from valtrim.lot_options selected
      where selected.lot_id = v_lot_id;

      update valtrim.lots
      set plan_id = v_lot.plan_id,
          lot_number = v_lot.lot_number,
          is_reverse = v_lot.is_reverse,
          is_utility_building = v_lot.is_utility_building,
          display_order = v_lot.display_order
      where id = v_lot_id and phase_id = v_phase_id;
    end if;

    if not v_lot.is_utility_building then
      insert into valtrim.lot_options (lot_id, plan_id, option_id)
      select v_lot_id, v_lot.plan_id, selected.option_id::bigint
      from jsonb_array_elements_text(v_lot.option_ids) selected(option_id);
    end if;

    v_kept_lot_ids := array_append(v_kept_lot_ids, v_lot_id);
  end loop;

  delete from valtrim.lots lot
  where lot.phase_id = v_phase_id
    and not (lot.id = any(v_kept_lot_ids));

  return v_phase_id;
end;
$$;

comment on function valtrim.save_sequence_sheet_phase(
  bigint, bigint, text, text, jsonb, boolean
) is
  'Atomically saves mixed ordinary Lots and Plan-only Utility Building rows in one Phase. The boolean parameter is retained only for compatibility with the short-lived Phase-level client.';

-- The previous deployed function already contains all immutable pricing and
-- concurrency checks. Replace only its source identity from Phase to row.
do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef('valtrim.prepare_package_draw()'::regprocedure)
  into v_definition;

  if position('phase.is_utility_building,' in v_definition) = 0 then
    raise exception 'prepare_package_draw does not match the expected Utility Building definition';
  end if;

  v_definition := replace(
    v_definition,
    'phase.is_utility_building,',
    'lot.is_utility_building,'
  );
  execute v_definition;
end;
$migration$;

comment on function valtrim.prepare_package_draw() is
  'Builds immutable mixed Phase snapshots. Ordinary Lots allocate the complete Plan Price by Draw percentage; Utility Building rows charge the complete Plan Price once on the selected Draw and never include Options or Hardware.';

drop trigger if exists production_activities_reject_utility_phase
  on valtrim.production_activities;
drop function if exists valtrim.reject_utility_production_activity();

create function valtrim.reject_utility_production_lot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from valtrim.lots lot
    where lot.id = new.lot_id
      and lot.is_utility_building
  ) then
    raise exception 'Utility Building rows do not belong to Production or Calendar Lot ranges'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger production_activity_lots_reject_utility_row
before insert or update of lot_id on valtrim.production_activity_lots
for each row execute function valtrim.reject_utility_production_lot();

revoke execute on function valtrim.reject_utility_production_lot()
  from public, anon, authenticated;
grant execute on function valtrim.reject_utility_production_lot()
  to service_role;

notify pgrst, 'reload schema';

commit;
