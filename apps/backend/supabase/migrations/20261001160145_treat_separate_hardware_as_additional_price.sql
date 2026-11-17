-- Treat separated Hardware as an additional charge. Draw percentages continue
-- to allocate the complete Plan Price, and the configured Hardware Price is
-- added only to its Billing Draw. Historical Package snapshots remain intact.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $migration$
declare
  v_constraint record;
begin
  for v_constraint in
    select constraint_record.conname
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'valtrim.plan_prices'::regclass
      and constraint_record.contype = 'c'
      and pg_get_constraintdef(constraint_record.oid) ilike '%hardware_price%'
      and pg_get_constraintdef(constraint_record.oid) ilike '%base_price%'
  loop
    execute format(
      'alter table valtrim.plan_prices drop constraint %I',
      v_constraint.conname
    );
  end loop;
end;
$migration$;

comment on column valtrim.plan_prices.base_price is
  'Complete Plan Price allocated across the configured Draw percentages.';
comment on column valtrim.plan_prices.hardware_price is
  'Optional Hardware Price charged in addition to the complete Plan Price when separated hardware is enabled.';

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
         or p_hardware_price > 999999999999.99
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

do $migration$
declare
  v_constraint record;
begin
  for v_constraint in
    select constraint_record.conname
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'valtrim.package_draws'::regclass
      and constraint_record.contype = 'c'
      and pg_get_constraintdef(constraint_record.oid) ilike '%draw_base%'
      and pg_get_constraintdef(constraint_record.oid) ilike '%hardware_price%'
      and pg_get_constraintdef(constraint_record.oid) ilike '%base_price%'
  loop
    execute format(
      'alter table valtrim.package_draws drop constraint %I',
      v_constraint.conname
    );
  end loop;
end;
$migration$;

alter table valtrim.package_draws
  add constraint package_draws_plan_price_snapshot_check
  check (
    draw_base = base_price
    or draw_base + hardware_price = base_price
  );

comment on column valtrim.package_draws.draw_base is
  'Plan Price snapshot allocated across Draws. New Packages retain the complete Plan Price; the legacy name remains for historical compatibility.';

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'valtrim.prepare_package_draw()'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    'new.draw_base := new.base_price - new.hardware_price;',
    'new.draw_base := new.base_price;'
  );

  if v_updated = v_definition then
    raise exception 'Package Draw calculation did not match the expected definition';
  end if;

  execute v_updated;
end;
$migration$;

comment on function valtrim.prepare_package_draw() is
  'Snapshots the complete Plan Price for Draw allocation and adds separated Hardware only on its configured Billing Draw.';
comment on function valtrim.set_plan_price(bigint, numeric, numeric) is
  'Sets an effective-dated complete Plan Price and an optional additional Hardware Price; ADMIN and PROJECT_MANAGEMENT only.';

commit;
