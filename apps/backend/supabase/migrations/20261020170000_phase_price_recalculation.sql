-- Update the price of Phases that were already created.
--
-- A Plan or Option price changed in Pricing only reaches the Phases created after
-- the change (see phase_pinned_prices). This lets an administrator choose Phases
-- created before it and move them to today's price:
--
--   * preview_phase_price_changes lists, per Phase and Lot, what still bills a
--     price different from today's, and whether it is already billed.
--   * apply_phase_price_changes moves the chosen Lots / Options to today's price.
--     A reason is required and every change is recorded.
--
-- Only what no Package has billed yet can change here. Billed Packages are never
-- touched by this step.

begin;

create table valtrim.phase_price_recalculations (
  id bigint generated always as identity primary key,
  job_id bigint not null references valtrim.jobs(id) on delete restrict,
  reason varchar(500) not null check (char_length(btrim(reason)) >= 3),
  lot_count integer not null default 0 check (lot_count >= 0),
  option_count integer not null default 0 check (option_count >= 0),
  created_by uuid not null references valtrim.app_users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index phase_price_recalculations_job_idx
  on valtrim.phase_price_recalculations (job_id, created_at desc);
create index phase_price_recalculations_actor_idx
  on valtrim.phase_price_recalculations (created_by);

-- One line per Lot (Plan price) or per Lot Option that moved. The Phase, Lot and
-- Option are copied so the record stays readable if the Phase is deleted later.
create table valtrim.phase_price_recalculation_lines (
  id bigint generated always as identity primary key,
  recalculation_id bigint not null
    references valtrim.phase_price_recalculations(id) on delete cascade,
  lot_id bigint not null,
  phase_id bigint not null,
  phase_code text not null,
  building text,
  lot_number text not null,
  plan_id bigint not null,
  plan_code text not null,
  option_id bigint,
  option_code text,
  previous_plan_price_id bigint references valtrim.plan_prices(id) on delete restrict,
  new_plan_price_id bigint references valtrim.plan_prices(id) on delete restrict,
  previous_option_price_id bigint references valtrim.option_prices(id) on delete restrict,
  new_option_price_id bigint references valtrim.option_prices(id) on delete restrict,
  previous_amount numeric(14,2),
  new_amount numeric(14,2),
  previous_hardware_amount numeric(14,2),
  new_hardware_amount numeric(14,2),
  check (
    (option_id is null and new_plan_price_id is not null and new_option_price_id is null)
    or (option_id is not null and new_option_price_id is not null and new_plan_price_id is null)
  )
);

create index phase_price_recalculation_lines_recalculation_idx
  on valtrim.phase_price_recalculation_lines (recalculation_id);
create index phase_price_recalculation_lines_lot_idx
  on valtrim.phase_price_recalculation_lines (lot_id);

alter table valtrim.phase_price_recalculations enable row level security;
alter table valtrim.phase_price_recalculation_lines enable row level security;

revoke all on table valtrim.phase_price_recalculations from public, anon, authenticated;
revoke all on table valtrim.phase_price_recalculation_lines from public, anon, authenticated;
revoke all on sequence valtrim.phase_price_recalculations_id_seq
  from public, anon, authenticated;
revoke all on sequence valtrim.phase_price_recalculation_lines_id_seq
  from public, anon, authenticated;

grant select (id, job_id, reason, lot_count, option_count, created_by, created_at)
  on valtrim.phase_price_recalculations to authenticated;
grant select (
  id, recalculation_id, lot_id, phase_id, phase_code, building, lot_number,
  plan_id, plan_code, option_id, option_code,
  previous_plan_price_id, new_plan_price_id,
  previous_option_price_id, new_option_price_id,
  previous_amount, new_amount, previous_hardware_amount, new_hardware_amount
) on valtrim.phase_price_recalculation_lines to authenticated;

create policy phase_price_recalculations_select
on valtrim.phase_price_recalculations for select to authenticated
using ((select private.is_active_user()));

create policy phase_price_recalculation_lines_select
on valtrim.phase_price_recalculation_lines for select to authenticated
using ((select private.is_active_user()));

-- What can change ------------------------------------------------------------

create function valtrim.preview_phase_price_changes(
  p_job_id bigint,
  p_plan_id bigint default null,
  p_option_id bigint default null,
  p_components text default 'ALL'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if (select auth.uid()) is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to update Phase prices'
      using errcode = '42501';
  end if;
  if p_components is null or p_components not in ('ALL', 'PLAN', 'OPTIONS') then
    raise exception 'Choose what to compare: the Plan price, the Options or both'
      using errcode = '23514';
  end if;

  perform 1 from valtrim.jobs job where job.id = p_job_id and job.is_active;
  if not found then
    raise exception 'Select an active Job' using errcode = '23503';
  end if;

  with lot_plan as (
    select
      lot.id as lot_id,
      jsonb_build_object(
        'billed', (
          exists (select 1 from valtrim.package_draws line where line.lot_id = lot.id)
          or exists (
            select 1 from valtrim.package_hardware_lines line where line.lot_id = lot.id
          )
        ),
        'from_price_id', lot.plan_price_id,
        'to_price_id', open_price.id,
        'from_base', pinned.base_price,
        'from_hardware', pinned.hardware_price,
        'to_base', open_price.base_price,
        'to_hardware', open_price.hardware_price
      ) as change
    from valtrim.lots lot
    join valtrim.phases phase
      on phase.id = lot.phase_id and phase.job_id = p_job_id and phase.is_active
    join valtrim.plan_prices open_price
      on open_price.plan_id = lot.plan_id and open_price.effective_to is null
    left join valtrim.plan_prices pinned on pinned.id = lot.plan_price_id
    where p_components in ('ALL', 'PLAN')
      and p_option_id is null
      and (p_plan_id is null or lot.plan_id = p_plan_id)
      and (pinned.base_price, pinned.hardware_price)
        is distinct from (open_price.base_price, open_price.hardware_price)
  ),
  lot_option as (
    select
      selected.lot_id,
      jsonb_build_object(
        'option_id', selected.option_id,
        'code', option.code,
        'description', coalesce(option.description, option.name),
        'billed', exists (
          select 1 from valtrim.package_options billed
          where billed.lot_id = selected.lot_id
            and billed.option_id = selected.option_id
        ),
        'from_price_id', selected.option_price_id,
        'to_price_id', open_price.id,
        'from_price', pinned.price,
        'from_na', coalesce(pinned.is_not_applicable, false),
        'to_price', open_price.price,
        'to_na', open_price.is_not_applicable
      ) as change
    from valtrim.lot_options selected
    join valtrim.lots lot on lot.id = selected.lot_id
    join valtrim.phases phase
      on phase.id = lot.phase_id and phase.job_id = p_job_id and phase.is_active
    join valtrim.plan_options option on option.id = selected.option_id
    join valtrim.option_prices open_price
      on open_price.option_id = selected.option_id and open_price.effective_to is null
    left join valtrim.option_prices pinned on pinned.id = selected.option_price_id
    where p_components in ('ALL', 'OPTIONS')
      and (p_option_id is null or selected.option_id = p_option_id)
      and (p_plan_id is null or lot.plan_id = p_plan_id)
      and (pinned.price, pinned.is_not_applicable)
        is distinct from (open_price.price, open_price.is_not_applicable)
  ),
  changed_lot as (
    select lot_id from lot_plan
    union
    select lot_id from lot_option
  )
  select coalesce(jsonb_agg(phase_row.row_json order by phase_row.phase_id), '[]'::jsonb)
  into v_result
  from (
    select
      phase.id as phase_id,
      jsonb_build_object(
        'phase_id', phase.id,
        'code', phase.code,
        'building', phase.building,
        'lots', (
          select jsonb_agg(
            jsonb_build_object(
              'lot_id', lot.id,
              'lot_number', lot.lot_number,
              'utility_name', lot.utility_name,
              'is_utility_building', lot.is_utility_building,
              'plan_id', lot.plan_id,
              'plan_code', plan.code,
              'plan_change', (select lp.change from lot_plan lp where lp.lot_id = lot.id),
              'option_changes', coalesce((
                select jsonb_agg(
                  lo.change order by (lo.change ->> 'option_id')::bigint
                )
                from lot_option lo
                where lo.lot_id = lot.id
              ), '[]'::jsonb)
            )
            order by lot.display_order, lot.id
          )
          from valtrim.lots lot
          join valtrim.plans plan on plan.id = lot.plan_id
          where lot.phase_id = phase.id
            and lot.id in (select changed.lot_id from changed_lot changed)
        )
      ) as row_json
    from valtrim.phases phase
    where phase.job_id = p_job_id
      and phase.is_active
      and exists (
        select 1
        from valtrim.lots lot
        where lot.phase_id = phase.id
          and lot.id in (select changed.lot_id from changed_lot changed)
      )
  ) phase_row;

  return v_result;
end;
$$;

-- Move chosen Lots / Options to today's price ----------------------------------

create function valtrim.apply_phase_price_changes(
  p_job_id bigint,
  p_lot_ids bigint[],
  p_options jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  v_lot_ids bigint[];
  v_options jsonb := coalesce(p_options, '[]'::jsonb);
  v_recalculation_id bigint;
  v_lot_count integer := 0;
  v_option_count integer := 0;
  v_row record;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to update Phase prices'
      using errcode = '42501';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'Enter the reason for this price change (3 to 500 characters)'
      using errcode = '23514';
  end if;
  if jsonb_typeof(v_options) <> 'array'
     or exists (
       select 1
       from jsonb_array_elements(v_options) item
       where jsonb_typeof(item) <> 'object'
          or jsonb_typeof(item -> 'lot_id') is distinct from 'number'
          or jsonb_typeof(item -> 'option_id') is distinct from 'number'
     ) then
    raise exception 'Every Option selection needs a Lot and an Option'
      using errcode = '23514';
  end if;

  v_lot_ids := array(
    select distinct selected.lot_id
    from unnest(coalesce(p_lot_ids, '{}'::bigint[])) as selected(lot_id)
    where selected.lot_id is not null
  );
  v_options := coalesce((
    select jsonb_agg(distinct jsonb_build_object(
      'lot_id', (item ->> 'lot_id')::bigint,
      'option_id', (item ->> 'option_id')::bigint
    ))
    from jsonb_array_elements(v_options) item
  ), '[]'::jsonb);

  if cardinality(v_lot_ids) + jsonb_array_length(v_options) = 0 then
    raise exception 'Select at least one Phase price to update'
      using errcode = '23514';
  end if;
  if cardinality(v_lot_ids) + jsonb_array_length(v_options) > 5000 then
    raise exception 'Select 5000 prices or fewer at a time'
      using errcode = '23514';
  end if;

  -- Package creation locks the Job first; so does this, so the two never overlap.
  perform 1 from valtrim.jobs job where job.id = p_job_id and job.is_active for update;
  if not found then
    raise exception 'Select an active Job' using errcode = '23503';
  end if;

  insert into valtrim.phase_price_recalculations (job_id, reason, created_by)
  values (p_job_id, v_reason, v_actor_id)
  returning id into v_recalculation_id;

  for v_row in
    select
      lot.id as lot_id,
      phase.id as phase_id,
      phase.code as phase_code,
      phase.building,
      lot.lot_number,
      lot.plan_id,
      plan.code as plan_code,
      lot.plan_price_id as previous_id,
      open_price.id as new_id,
      pinned.base_price as previous_base,
      pinned.hardware_price as previous_hardware,
      open_price.base_price as new_base,
      open_price.hardware_price as new_hardware
    from unnest(v_lot_ids) as requested(lot_id)
    join valtrim.lots lot on lot.id = requested.lot_id
    join valtrim.phases phase
      on phase.id = lot.phase_id and phase.job_id = p_job_id and phase.is_active
    join valtrim.plans plan on plan.id = lot.plan_id
    join valtrim.plan_prices open_price
      on open_price.plan_id = lot.plan_id and open_price.effective_to is null
    left join valtrim.plan_prices pinned on pinned.id = lot.plan_price_id
    where (pinned.base_price, pinned.hardware_price)
        is distinct from (open_price.base_price, open_price.hardware_price)
      and not exists (select 1 from valtrim.package_draws line where line.lot_id = lot.id)
      and not exists (
        select 1 from valtrim.package_hardware_lines line where line.lot_id = lot.id
      )
    order by lot.id
    for update of lot
  loop
    update valtrim.lots
    set plan_price_id = v_row.new_id
    where id = v_row.lot_id;

    insert into valtrim.phase_price_recalculation_lines (
      recalculation_id, lot_id, phase_id, phase_code, building, lot_number,
      plan_id, plan_code, previous_plan_price_id, new_plan_price_id,
      previous_amount, new_amount, previous_hardware_amount, new_hardware_amount
    ) values (
      v_recalculation_id, v_row.lot_id, v_row.phase_id, v_row.phase_code,
      v_row.building, v_row.lot_number, v_row.plan_id, v_row.plan_code,
      v_row.previous_id, v_row.new_id,
      v_row.previous_base, v_row.new_base,
      v_row.previous_hardware, v_row.new_hardware
    );
    v_lot_count := v_lot_count + 1;
  end loop;

  for v_row in
    select
      selected.lot_id,
      selected.option_id,
      selected.option_price_id as previous_id,
      open_price.id as new_id,
      phase.id as phase_id,
      phase.code as phase_code,
      phase.building,
      lot.lot_number,
      lot.plan_id,
      plan.code as plan_code,
      option.code as option_code,
      pinned.price as previous_price,
      open_price.price as new_price
    from jsonb_to_recordset(v_options) as requested(lot_id bigint, option_id bigint)
    join valtrim.lot_options selected
      on selected.lot_id = requested.lot_id and selected.option_id = requested.option_id
    join valtrim.lots lot on lot.id = selected.lot_id
    join valtrim.phases phase
      on phase.id = lot.phase_id and phase.job_id = p_job_id and phase.is_active
    join valtrim.plans plan on plan.id = lot.plan_id
    join valtrim.plan_options option on option.id = selected.option_id
    join valtrim.option_prices open_price
      on open_price.option_id = selected.option_id and open_price.effective_to is null
    left join valtrim.option_prices pinned on pinned.id = selected.option_price_id
    where (pinned.price, pinned.is_not_applicable)
        is distinct from (open_price.price, open_price.is_not_applicable)
      and not exists (
        select 1 from valtrim.package_options billed
        where billed.lot_id = selected.lot_id and billed.option_id = selected.option_id
      )
    order by selected.lot_id, selected.option_id
    for update of selected
  loop
    update valtrim.lot_options
    set option_price_id = v_row.new_id
    where lot_id = v_row.lot_id and option_id = v_row.option_id;

    insert into valtrim.phase_price_recalculation_lines (
      recalculation_id, lot_id, phase_id, phase_code, building, lot_number,
      plan_id, plan_code, option_id, option_code,
      previous_option_price_id, new_option_price_id, previous_amount, new_amount
    ) values (
      v_recalculation_id, v_row.lot_id, v_row.phase_id, v_row.phase_code,
      v_row.building, v_row.lot_number, v_row.plan_id, v_row.plan_code,
      v_row.option_id, v_row.option_code,
      v_row.previous_id, v_row.new_id, v_row.previous_price, v_row.new_price
    );
    v_option_count := v_option_count + 1;
  end loop;

  -- Anything asked for that could not move means the list on screen is out of
  -- date (a price changed, or a Package billed it meanwhile): change nothing.
  if v_lot_count <> cardinality(v_lot_ids)
     or v_option_count <> jsonb_array_length(v_options) then
    raise exception 'Prices or Packages changed since this list was loaded. Reload it and try again'
      using errcode = '40001';
  end if;

  update valtrim.phase_price_recalculations
  set lot_count = v_lot_count,
      option_count = v_option_count
  where id = v_recalculation_id;

  return jsonb_build_object(
    'recalculation_id', v_recalculation_id,
    'lots', v_lot_count,
    'options', v_option_count
  );
end;
$$;

revoke all on function valtrim.preview_phase_price_changes(bigint, bigint, bigint, text)
  from public, anon;
revoke all on function valtrim.apply_phase_price_changes(bigint, bigint[], jsonb, text)
  from public, anon;
grant execute on function valtrim.preview_phase_price_changes(bigint, bigint, bigint, text)
  to authenticated;
grant execute on function valtrim.apply_phase_price_changes(bigint, bigint[], jsonb, text)
  to authenticated;

commit;
