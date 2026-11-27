-- Phase 6: persist Job Plans, their optional Options and effective-dated
-- pricing. Sequence Sheet Phases/Lots and downstream billing remain closed.
--
-- Active authenticated users can read the catalog and price history. ADMIN
-- and PROJECT_MANAGEMENT can create/edit/soft-deactivate Plans and Options.
-- Price changes are atomic RPCs so an open price period is never overwritten
-- without preserving its prior effective dates.

begin;

-- The product allows the same P.O. / OPT # more than once under one Plan when
-- each row describes different work. Identity and Lot assignments use ids,
-- not the display code.
alter table valtrim.plan_options
  drop constraint if exists plan_options_plan_id_code_key;

-- The UI's Option description is also the immutable billing-line name. Keep
-- both current and future package snapshots wide enough for that description.
alter table valtrim.plan_options
  alter column name type varchar(300);

alter table valtrim.package_options
  alter column option_name type varchar(300);

-- A Plan can have a base price while hardware is still intentionally
-- unpriced. This is distinct from an explicitly assigned $0 hardware price.
alter table valtrim.plan_prices
  alter column hardware_price drop not null,
  alter column hardware_price drop default;

comment on column valtrim.plan_prices.hardware_price is
  'Nullable until assigned. Required by downstream billing only when the Job Billing Setup separates hardware.';

create index plans_created_by_idx
  on valtrim.plans (created_by)
  where created_by is not null;

create index plans_updated_by_idx
  on valtrim.plans (updated_by)
  where updated_by is not null;

create index plan_options_created_by_idx
  on valtrim.plan_options (created_by)
  where created_by is not null;

create index plan_options_updated_by_idx
  on valtrim.plan_options (updated_by)
  where updated_by is not null;

create index plan_prices_created_by_idx
  on valtrim.plan_prices (created_by)
  where created_by is not null;

create index option_prices_created_by_idx
  on valtrim.option_prices (created_by)
  where created_by is not null;

alter table valtrim.plans enable row level security;
alter table valtrim.plan_options enable row level security;
alter table valtrim.plan_prices enable row level security;
alter table valtrim.option_prices enable row level security;

revoke all on table valtrim.plans from public, anon, authenticated;
revoke all on table valtrim.plan_options from public, anon, authenticated;
revoke all on table valtrim.plan_prices from public, anon, authenticated;
revoke all on table valtrim.option_prices from public, anon, authenticated;
revoke all on sequence valtrim.plans_id_seq from public, anon, authenticated;
revoke all on sequence valtrim.plan_options_id_seq from public, anon, authenticated;

grant select on table valtrim.plans to authenticated;
grant select on table valtrim.plan_options to authenticated;
grant select on table valtrim.plan_prices to authenticated;
grant select on table valtrim.option_prices to authenticated;

grant insert (
  job_id,
  code,
  name,
  description
) on valtrim.plans to authenticated;

grant update (
  code,
  name,
  description,
  is_active
) on valtrim.plans to authenticated;

grant insert (
  plan_id,
  code,
  name,
  description
) on valtrim.plan_options to authenticated;

grant update (
  code,
  name,
  description,
  is_active
) on valtrim.plan_options to authenticated;

grant usage on sequence valtrim.plans_id_seq to authenticated;
grant usage on sequence valtrim.plan_options_id_seq to authenticated;

create policy plans_select
on valtrim.plans for select to authenticated
using ((select private.is_active_user()));

create policy plans_insert
on valtrim.plans for insert to authenticated
with check (
  (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT'))
  and is_active
  and exists (
    select 1
    from valtrim.jobs job
    where job.id = plans.job_id
      and job.is_active
  )
);

create policy plans_update
on valtrim.plans for update to authenticated
using ((select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')))
with check (
  (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT'))
  and exists (
    select 1
    from valtrim.jobs job
    where job.id = plans.job_id
      and job.is_active
  )
);

create policy plan_options_select
on valtrim.plan_options for select to authenticated
using ((select private.is_active_user()));

create policy plan_options_insert
on valtrim.plan_options for insert to authenticated
with check (
  (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT'))
  and is_active
  and exists (
    select 1
    from valtrim.plans plan
    join valtrim.jobs job on job.id = plan.job_id
    where plan.id = plan_options.plan_id
      and plan.is_active
      and job.is_active
  )
);

create policy plan_options_update
on valtrim.plan_options for update to authenticated
using ((select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')))
with check (
  (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT'))
  and exists (
    select 1
    from valtrim.plans plan
    join valtrim.jobs job on job.id = plan.job_id
    where plan.id = plan_options.plan_id
      and plan.is_active
      and job.is_active
  )
);

create policy plan_prices_select
on valtrim.plan_prices for select to authenticated
using ((select private.is_active_user()));

create policy option_prices_select
on valtrim.option_prices for select to authenticated
using ((select private.is_active_user()));

create or replace function valtrim.set_plan_price(
  p_plan_id bigint,
  p_base_price numeric,
  p_hardware_price numeric default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_current_id bigint;
  v_effective_from date;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to change Plan prices'
      using errcode = '42501';
  end if;

  if p_base_price is null
     or p_base_price < 0
     or p_base_price > 999999999999.99
     or p_base_price <> round(p_base_price, 2)
     or (
       p_hardware_price is not null
       and (
         p_hardware_price < 0
         or p_hardware_price > p_base_price
         or p_hardware_price <> round(p_hardware_price, 2)
       )
     ) then
    raise exception 'Enter valid Plan and hardware prices with up to two decimal places'
      using errcode = '23514';
  end if;

  perform 1
  from valtrim.plans plan
  join valtrim.jobs job on job.id = plan.job_id
  where plan.id = p_plan_id
    and plan.is_active
    and job.is_active
  for update of plan;

  if not found then
    raise exception 'Select an active Plan from an active Job'
      using errcode = '23503';
  end if;

  select price.id, price.effective_from
  into v_current_id, v_effective_from
  from valtrim.plan_prices price
  where price.plan_id = p_plan_id
    and price.effective_to is null
  for update;

  if v_current_id is null then
    insert into valtrim.plan_prices (
      plan_id,
      base_price,
      hardware_price,
      effective_from,
      created_by
    )
    values (
      p_plan_id,
      p_base_price::valtrim.amount,
      p_hardware_price::valtrim.amount,
      current_date,
      v_actor_id
    )
    returning id into v_current_id;
  elsif v_effective_from = current_date then
    update valtrim.plan_prices
    set base_price = p_base_price::valtrim.amount,
        hardware_price = p_hardware_price::valtrim.amount,
        created_by = v_actor_id,
        created_at = now()
    where id = v_current_id;
  elsif v_effective_from < current_date then
    update valtrim.plan_prices
    set effective_to = current_date - 1
    where id = v_current_id;

    insert into valtrim.plan_prices (
      plan_id,
      base_price,
      hardware_price,
      effective_from,
      created_by
    )
    values (
      p_plan_id,
      p_base_price::valtrim.amount,
      p_hardware_price::valtrim.amount,
      current_date,
      v_actor_id
    )
    returning id into v_current_id;
  else
    raise exception 'A future Plan price must be resolved before setting today''s price'
      using errcode = '23514';
  end if;

  return v_current_id;
end;
$$;

create or replace function valtrim.set_option_price(
  p_option_id bigint,
  p_price numeric
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_current_id bigint;
  v_effective_from date;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to change Option prices'
      using errcode = '42501';
  end if;

  if p_price is null
     or p_price < 0
     or p_price > 999999999999.99
     or p_price <> round(p_price, 2) then
    raise exception 'Enter a valid Option price with up to two decimal places'
      using errcode = '23514';
  end if;

  perform 1
  from valtrim.plan_options option
  join valtrim.plans plan on plan.id = option.plan_id
  join valtrim.jobs job on job.id = plan.job_id
  where option.id = p_option_id
    and option.is_active
    and plan.is_active
    and job.is_active
  for update of option;

  if not found then
    raise exception 'Select an active Option from an active Plan and Job'
      using errcode = '23503';
  end if;

  select price.id, price.effective_from
  into v_current_id, v_effective_from
  from valtrim.option_prices price
  where price.option_id = p_option_id
    and price.effective_to is null
  for update;

  if v_current_id is null then
    insert into valtrim.option_prices (
      option_id,
      price,
      effective_from,
      created_by
    )
    values (
      p_option_id,
      p_price::valtrim.amount,
      current_date,
      v_actor_id
    )
    returning id into v_current_id;
  elsif v_effective_from = current_date then
    update valtrim.option_prices
    set price = p_price::valtrim.amount,
        created_by = v_actor_id,
        created_at = now()
    where id = v_current_id;
  elsif v_effective_from < current_date then
    update valtrim.option_prices
    set effective_to = current_date - 1
    where id = v_current_id;

    insert into valtrim.option_prices (
      option_id,
      price,
      effective_from,
      created_by
    )
    values (
      p_option_id,
      p_price::valtrim.amount,
      current_date,
      v_actor_id
    )
    returning id into v_current_id;
  else
    raise exception 'A future Option price must be resolved before setting today''s price'
      using errcode = '23514';
  end if;

  return v_current_id;
end;
$$;

create or replace function valtrim.deactivate_job_plan(
  p_plan_id bigint
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
    raise exception 'You do not have permission to deactivate Plans'
      using errcode = '42501';
  end if;

  perform 1
  from valtrim.plans plan
  join valtrim.jobs job on job.id = plan.job_id
  where plan.id = p_plan_id
    and plan.is_active
    and job.is_active
  for update of plan;

  if not found then
    raise exception 'Select an active Plan from an active Job'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from valtrim.lots lot
    where lot.plan_id = p_plan_id
  ) then
    raise exception 'Reassign or remove the Lots that use this Plan first'
      using errcode = '23503';
  end if;

  update valtrim.plan_options
  set is_active = false
  where plan_id = p_plan_id
    and is_active;

  update valtrim.plans
  set is_active = false
  where id = p_plan_id;

  return p_plan_id;
end;
$$;

create or replace function valtrim.deactivate_plan_option(
  p_option_id bigint
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
    raise exception 'You do not have permission to deactivate Options'
      using errcode = '42501';
  end if;

  perform 1
  from valtrim.plan_options option
  join valtrim.plans plan on plan.id = option.plan_id
  join valtrim.jobs job on job.id = plan.job_id
  where option.id = p_option_id
    and option.is_active
    and plan.is_active
    and job.is_active
  for update of option;

  if not found then
    raise exception 'Select an active Option from an active Plan and Job'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from valtrim.lot_options selected
    where selected.option_id = p_option_id
  ) then
    raise exception 'Remove the Option from its assigned Lots first'
      using errcode = '23503';
  end if;

  update valtrim.plan_options
  set is_active = false
  where id = p_option_id;

  return p_option_id;
end;
$$;

revoke execute on function valtrim.set_plan_price(bigint, numeric, numeric)
  from public, anon, authenticated;
revoke execute on function valtrim.set_option_price(bigint, numeric)
  from public, anon, authenticated;
revoke execute on function valtrim.deactivate_job_plan(bigint)
  from public, anon, authenticated;
revoke execute on function valtrim.deactivate_plan_option(bigint)
  from public, anon, authenticated;

grant execute on function valtrim.set_plan_price(bigint, numeric, numeric)
  to authenticated, service_role;
grant execute on function valtrim.set_option_price(bigint, numeric)
  to authenticated, service_role;
grant execute on function valtrim.deactivate_job_plan(bigint)
  to authenticated, service_role;
grant execute on function valtrim.deactivate_plan_option(bigint)
  to authenticated, service_role;

comment on function valtrim.set_plan_price(bigint, numeric, numeric) is
  'Sets today''s current Plan price and preserves prior effective-dated prices. ADMIN and PROJECT_MANAGEMENT only.';

comment on function valtrim.set_option_price(bigint, numeric) is
  'Sets today''s current Option price and preserves prior effective-dated prices. ADMIN and PROJECT_MANAGEMENT only.';

comment on function valtrim.deactivate_job_plan(bigint) is
  'Soft-deactivates an unused Plan and its Options. ADMIN and PROJECT_MANAGEMENT only.';

comment on function valtrim.deactivate_plan_option(bigint) is
  'Soft-deactivates an Option that is not assigned to a Lot. ADMIN and PROJECT_MANAGEMENT only.';

notify pgrst, 'reload schema';

commit;
