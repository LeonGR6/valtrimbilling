-- Saving many Plan and Option prices of a Job in one call.
--
-- The price sheet of Plans & Options (Edit prices) used to save one price per request: a Job with
-- 540 Options sent 540 requests one after the other, and then looked up the Phases with an older
-- price once per price, 540 more at the same time.
-- valtrim.set_job_prices saves all of it in one request and one transaction, so a failure leaves
-- no price half saved. It takes two lists:
--
--   p_plans    [{ "plan_id": 12, "base_price": 245000.00, "hardware_price": 1200.00 | null }]
--   p_options  [{ "option_id": 340, "price": -150.00, "not_applicable": false }]
--
-- Each price goes through valtrim.set_plan_price / valtrim.set_option_price, so the rules of a
-- single price do not change (effective-dated prices, a price pinned to a Lot or Package is closed
-- and a new one opened, a future price blocks the change). What this function adds is that every
-- Plan and Option must belong to the Job, nothing is repeated, and the one that cannot be saved is
-- named in the error. Plans and Options are saved in id order, so two saves at the same time lock
-- rows in the same order.
--
-- For Admin and Project Management, like the single price changes.

begin;

create or replace function valtrim.set_job_prices(
  p_job_id bigint,
  p_plans jsonb default '[]'::jsonb,
  p_options jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_prices constant integer := 5000;
  c_max_amount constant numeric := 999999999999.99;
  v_plans jsonb := coalesce(p_plans, '[]'::jsonb);
  v_options jsonb := coalesce(p_options, '[]'::jsonb);
  v_item jsonb;
  v_code text;
begin
  if (select auth.uid()) is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to change prices'
      using errcode = '42501';
  end if;

  if jsonb_typeof(v_plans) <> 'array' or jsonb_typeof(v_options) <> 'array' then
    raise exception 'The prices are not in the expected format'
      using errcode = '23514';
  end if;

  if jsonb_array_length(v_plans) + jsonb_array_length(v_options) = 0 then
    raise exception 'Nothing to change'
      using errcode = '23514';
  end if;

  if jsonb_array_length(v_plans) + jsonb_array_length(v_options) > c_max_prices then
    raise exception 'Change at most % prices at a time', c_max_prices
      using errcode = '23514';
  end if;

  perform 1
  from valtrim.jobs job
  where job.id = p_job_id
    and job.is_active
  for share;

  if not found then
    raise exception 'Select an active Job'
      using errcode = '23503';
  end if;

  -- The shape of every item -----------------------------------------------------------------

  if exists (
    select 1
    from jsonb_array_elements(v_plans) item(value)
    where jsonb_typeof(item.value) <> 'object'
       or coalesce(item.value ->> 'plan_id', '') !~ '^[0-9]{1,18}$'
       or jsonb_typeof(item.value -> 'base_price') is distinct from 'number'
       or jsonb_typeof(item.value -> 'hardware_price') not in ('number', 'null')
  ) then
    raise exception 'Each Plan price needs a Plan and a price'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_options) item(value)
    where jsonb_typeof(item.value) <> 'object'
       or coalesce(item.value ->> 'option_id', '') !~ '^[0-9]{1,18}$'
       or jsonb_typeof(item.value -> 'not_applicable') not in ('boolean', 'null')
       or (
         coalesce(item.value -> 'not_applicable' = 'true'::jsonb, false) = false
         and jsonb_typeof(item.value -> 'price') is distinct from 'number'
       )
  ) then
    raise exception 'Each Option price needs an Option and a price, or NA'
      using errcode = '23514';
  end if;

  if (
    select count(*) <> count(distinct item.value ->> 'plan_id')
    from jsonb_array_elements(v_plans) item(value)
  ) or (
    select count(*) <> count(distinct item.value ->> 'option_id')
    from jsonb_array_elements(v_options) item(value)
  ) then
    raise exception 'A Plan or an Option price is repeated'
      using errcode = '23514';
  end if;

  -- Everything belongs to the Job ----------------------------------------------------------------

  if (
    select count(*)
    from valtrim.plans plan
    where plan.job_id = p_job_id
      and plan.is_active
      and plan.id in (
        select (item.value ->> 'plan_id')::bigint from jsonb_array_elements(v_plans) item(value)
      )
  ) <> jsonb_array_length(v_plans) then
    raise exception 'A Plan is no longer in the Job. Refresh the page and try again'
      using errcode = '23503';
  end if;

  if (
    select count(*)
    from valtrim.plan_options option
    join valtrim.plans plan on plan.id = option.plan_id
    where plan.job_id = p_job_id
      and plan.is_active
      and option.is_active
      and option.id in (
        select (item.value ->> 'option_id')::bigint from jsonb_array_elements(v_options) item(value)
      )
  ) <> jsonb_array_length(v_options) then
    raise exception 'An Option is no longer in the Job. Refresh the page and try again'
      using errcode = '23503';
  end if;

  -- The amounts, naming the Plan or Option that cannot be saved ---------------------------------

  select plan.code
  into v_code
  from jsonb_array_elements(v_plans) item(value)
  join valtrim.plans plan on plan.id = (item.value ->> 'plan_id')::bigint
  where (item.value ->> 'base_price')::numeric < 0
     or (item.value ->> 'base_price')::numeric > c_max_amount
     or (item.value ->> 'base_price')::numeric <> round((item.value ->> 'base_price')::numeric, 2)
     or (item.value ->> 'hardware_price')::numeric < 0
     or (item.value ->> 'hardware_price')::numeric > c_max_amount
     or (item.value ->> 'hardware_price')::numeric <> round((item.value ->> 'hardware_price')::numeric, 2)
  order by plan.id
  limit 1;

  if v_code is not null then
    raise exception 'Enter valid prices for Plan %, with up to two decimal places', v_code
      using errcode = '23514';
  end if;

  select option.code
  into v_code
  from jsonb_array_elements(v_options) item(value)
  join valtrim.plan_options option on option.id = (item.value ->> 'option_id')::bigint
  where coalesce(item.value -> 'not_applicable' = 'true'::jsonb, false) = false
    and (
      (item.value ->> 'price')::numeric < -c_max_amount
      or (item.value ->> 'price')::numeric > c_max_amount
      or (item.value ->> 'price')::numeric <> round((item.value ->> 'price')::numeric, 2)
    )
  order by option.id
  limit 1;

  if v_code is not null then
    raise exception 'Enter a valid price for Option %, with up to two decimal places', v_code
      using errcode = '23514';
  end if;

  -- The prices ------------------------------------------------------------------------------------

  for v_item in
    select item.value
    from jsonb_array_elements(v_plans) item(value)
    order by (item.value ->> 'plan_id')::bigint
  loop
    perform valtrim.set_plan_price(
      (v_item ->> 'plan_id')::bigint,
      (v_item ->> 'base_price')::numeric,
      (v_item ->> 'hardware_price')::numeric
    );
  end loop;

  for v_item in
    select item.value
    from jsonb_array_elements(v_options) item(value)
    order by (item.value ->> 'option_id')::bigint
  loop
    perform valtrim.set_option_price(
      (v_item ->> 'option_id')::bigint,
      (v_item ->> 'price')::numeric,
      coalesce(v_item -> 'not_applicable' = 'true'::jsonb, false)
    );
  end loop;

  return jsonb_build_object(
    'plans_saved', jsonb_array_length(v_plans),
    'options_saved', jsonb_array_length(v_options)
  );
end;
$$;

revoke execute on function valtrim.set_job_prices(bigint, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function valtrim.set_job_prices(bigint, jsonb, jsonb)
  to authenticated, service_role;

comment on function valtrim.set_job_prices(bigint, jsonb, jsonb) is
  'Sets today''s price of many Plans and Options of an active Job in one transaction, through set_plan_price and set_option_price. Every Plan and Option must belong to the Job and none is repeated. ADMIN and PROJECT_MANAGEMENT only.';

notify pgrst, 'reload schema';

commit;
