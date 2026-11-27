-- Example data from "Example Payment Schedule 3" (run in the Supabase SQL editor
-- of the TEST project; it is not a migration).
--
-- Creates Job 1318 for THE OLSON COMPANY (community "Uptown Walk") with one Phase
-- (MODELS, building B1), seven Plans with their price and the ten Lots of the
-- schedule (MDL Ph L1-10). Nothing existing is changed.
--
-- Builder: THE OLSON COMPANY (id 25), Billing Setup version 44: Draws
-- 40% / 30% / 10% / 10% / 10%, no separate hardware price. The Job takes the
-- ACTIVE version by itself (valtrim.validate_job).
--
-- Every Lot has the same total in the PDF, $4,493.40, and the Draws of the PDF
-- (1,797.36 / 1,348.02 / 449.34 x 3) are exactly those percentages of it, so the
-- Plan price is the Lot total. The price is effective from the contract date,
-- 2026-03-11, or a Package dated earlier could not be priced.
--
-- The PDF prints the Phase as "MDL" and the Lots as 0001 to 0010; the platform
-- stores MODELS (Phase codes must be upper case) and 1 to 10.
--
-- Reuses Supervisor Example (people id 17). The Builder has no contacts yet, so
-- it creates "Example" as its Jobsite Superintendent.

begin;

do $$
declare
  v_actor uuid := 'ec6eec15-4260-437c-94e8-b678a3a70ade';
  v_builder constant bigint := 25;
  v_setup_version constant bigint := 44;
  v_supervisor bigint;
  v_superintendent bigint;
  v_job bigint;
  v_phase bigint;
  v_plan bigint;
  v_plan_code text;
  v_effective_from constant date := date '2026-03-11';
  v_total constant numeric := 4493.40;
  -- Lot number (position + 1) -> Plan, in the order the PDF lists them.
  v_lot_plans constant text[] :=
    array['1A', '1C', '2A', '3AX', '2B', '3BX', '3AX', '2A', '1B', '1A'];
  v_plans bigint[] := '{}';
  v_codes text[] := '{}';
  v_index int;
begin
  if exists (select 1 from valtrim.jobs where code = '1318') then
    raise exception 'Job 1318 already exists';
  end if;

  if not exists (
    select 1
    from valtrim.billing_setup_versions version
    join valtrim.billing_draws draw on draw.setup_version_id = version.id
    where version.id = v_setup_version
      and version.builder_id = v_builder
      and version.status = 'ACTIVE'
    group by version.id
    having array_agg(draw.percentage::numeric order by draw.draw_number)
      = array[40, 30, 10, 10, 10]::numeric[]
  ) then
    raise exception
      'Builder % must have ACTIVE Billing Setup version % with Draws 40/30/10/10/10',
      v_builder, v_setup_version;
  end if;

  select person.id
    into v_supervisor
  from valtrim.people person
  join valtrim.person_roles role
    on role.person_id = person.id and role.role = 'SUPERVISOR'
  where person.name = 'Supervisor Example' and person.is_active;

  if v_supervisor is null then
    raise exception 'Supervisor Example was not found or is not an active SUPERVISOR';
  end if;

  select contact.id
    into v_superintendent
  from valtrim.builder_contacts contact
  where contact.builder_id = v_builder
    and contact.type = 'JOBSITE_SUPERINTENDENT'
    and contact.name = 'Example'
    and contact.is_active;

  if v_superintendent is null then
    insert into valtrim.builder_contacts (
      builder_id, name, type, email, is_active, created_by, updated_by
    ) values (
      v_builder, 'Example', 'JOBSITE_SUPERINTENDENT',
      'jobsiteexample@valtrim.com', true, v_actor, v_actor
    ) returning id into v_superintendent;
  end if;

  -- superintendent_type is a generated column, so it is not inserted.
  insert into valtrim.jobs (
    code, builder_id, billing_setup_version_id, community, supervisor_id,
    superintendent_id, status, is_active, created_by, updated_by
  ) values (
    '1318', v_builder, v_setup_version, 'Uptown Walk', v_supervisor,
    v_superintendent, 'ACTIVE', true, v_actor, v_actor
  ) returning id into v_job;

  insert into valtrim.phases (job_id, code, building, is_active, created_by, updated_by)
  values (v_job, 'MODELS', 'B1', true, v_actor, v_actor)
  returning id into v_phase;

  -- One Plan per distinct code, priced from the effective date with no end.
  for v_plan_code in
    select distinct code from unnest(v_lot_plans) as code order by code
  loop
    insert into valtrim.plans (job_id, code, name, is_active, created_by, updated_by)
    values (v_job, v_plan_code, v_plan_code, true, v_actor, v_actor)
    returning id into v_plan;

    insert into valtrim.plan_prices (plan_id, base_price, hardware_price, effective_from, created_by)
    values (v_plan, v_total, null, v_effective_from, v_actor);

    v_codes := v_codes || v_plan_code;
    v_plans := v_plans || v_plan;
  end loop;

  for v_index in 1..array_length(v_lot_plans, 1) loop
    insert into valtrim.lots (
      phase_id, job_id, plan_id, lot_number, is_reverse, display_order,
      is_utility_building, created_by, updated_by
    ) values (
      v_phase,
      v_job,
      v_plans[array_position(v_codes, v_lot_plans[v_index])],
      v_index::text,
      false,
      v_index - 1,
      false,
      v_actor,
      v_actor
    );
  end loop;
end;
$$;

commit;

-- What was created: one row per Lot with its Plan and price.
select
  job.code as job,
  phase.code as phase,
  phase.building,
  lot.lot_number,
  plan.code as plan,
  price.base_price,
  price.effective_from
from valtrim.jobs job
join valtrim.phases phase on phase.job_id = job.id
join valtrim.lots lot on lot.phase_id = phase.id
join valtrim.plans plan on plan.id = lot.plan_id
join valtrim.plan_prices price on price.plan_id = plan.id and price.effective_to is null
where job.code = '1318'
order by lot.display_order;
