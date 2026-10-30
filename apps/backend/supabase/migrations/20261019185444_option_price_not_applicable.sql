-- An Option price can be "NA" (not applicable): the Option is still selected and
-- listed, but it neither adds to nor subtracts from the Draw it is billed with.
--
-- It is stored as a $0.00 price with a flag, so every sum, Retention, WRAP and
-- invoice calculation that already reads the price keeps working and sees zero.
-- The flag is what lets the screens show "NA" instead of "$0.00", and it is
-- copied into the Package snapshot like the price is. Nothing changes for an
-- Option that was never priced: that still blocks billing until it has a price
-- (a number or NA).

begin;

alter table valtrim.option_prices
  add column is_not_applicable boolean not null default false,
  add constraint option_prices_not_applicable_is_zero_check
    check (not is_not_applicable or price = 0);

alter table valtrim.package_options
  add column option_not_applicable boolean not null default false,
  add constraint package_options_not_applicable_is_zero_check
    check (not option_not_applicable or option_price = 0);

comment on column valtrim.option_prices.is_not_applicable is
  'True when the Option price is NA: stored as 0.00 and shown as NA, it adds and subtracts nothing.';
comment on column valtrim.package_options.option_not_applicable is
  'Snapshot of option_prices.is_not_applicable when the Option was billed.';

-- Both tables expose their columns one by one.
grant select (is_not_applicable) on valtrim.option_prices to authenticated;
grant select (option_not_applicable) on valtrim.package_options to authenticated;

-- One function sets a number or NA, so the old two-argument one goes away.
drop function if exists valtrim.set_option_price(bigint, numeric);

create function valtrim.set_option_price(
  p_option_id bigint,
  p_price numeric,
  p_not_applicable boolean default false
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
  v_not_applicable boolean := coalesce(p_not_applicable, false);
  v_price numeric(14,2);
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to change Option prices'
      using errcode = '42501';
  end if;

  if v_not_applicable then
    v_price := 0;
  else
    if p_price is null
       or p_price < -999999999999.99
       or p_price > 999999999999.99
       or p_price <> round(p_price, 2) then
      raise exception 'Enter a valid Option price with up to two decimal places'
        using errcode = '23514';
    end if;
    v_price := p_price::numeric(14,2);
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
      is_not_applicable,
      effective_from,
      created_by
    )
    values (
      p_option_id,
      v_price,
      v_not_applicable,
      current_date,
      v_actor_id
    )
    returning id into v_current_id;
  elsif v_effective_from = current_date then
    update valtrim.option_prices
    set price = v_price,
        is_not_applicable = v_not_applicable,
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
      is_not_applicable,
      effective_from,
      created_by
    )
    values (
      p_option_id,
      v_price,
      v_not_applicable,
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

revoke execute on function valtrim.set_option_price(bigint, numeric, boolean)
  from public, anon, authenticated;
grant execute on function valtrim.set_option_price(bigint, numeric, boolean)
  to authenticated, service_role;

comment on function valtrim.set_option_price(bigint, numeric, boolean) is
  'Sets today''s current Option price (a number, negative for a credit, or NA) and preserves prior effective-dated prices. ADMIN and PROJECT_MANAGEMENT only.';

-- Copy the flag into the Package snapshot with the price.
do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'valtrim.populate_package_options()'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    '      option_price,
      phase_id,',
    '      option_price,
      option_not_applicable,
      phase_id,'
  );
  if v_updated = v_definition then
    raise exception 'populate_package_options insert columns did not match the expected definition';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    '      price.price,
      phase.id,',
    '      price.price,
      price.is_not_applicable,
      phase.id,'
  );
  if v_updated = v_definition then
    raise exception 'populate_package_options select values did not match the expected definition';
  end if;

  execute v_updated;
end;
$migration$;

notify pgrst, 'reload schema';

commit;
