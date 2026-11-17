-- An Option more than once on a Lot (quantity + locations), against the real database, inside a transaction that
-- is rolled back. Run it after the migration; every row of the last result must have ok = true.
-- It borrows one Lot that has an unbilled priced Option, saves its Phase again as an ADMIN, bills the Option in an
-- Options Package and leaves nothing behind.

begin;

create temporary table qt_results (
  step serial primary key,
  name text not null,
  ok boolean not null,
  detail text
) on commit drop;

create temporary table qt_ctx (
  admin_id uuid,
  job_id bigint,
  phase_id bigint,
  lot_id bigint,
  option_id bigint,
  unit_price numeric,
  package_id bigint
) on commit drop;

create function pg_temp.run_as(p_user uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  v_result text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    execute p_sql into v_result;
    reset role;
    return 'ok:' || coalesce(v_result, '');
  exception when others then
    reset role;
    return 'err:' || sqlstate || ':' || sqlerrm;
  end;
end;
$$;

create function pg_temp.check_that(p_name text, p_ok boolean, p_detail text default null)
returns void
language sql
as $$
  insert into qt_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
$$;

-- The Phase as the Sequence Sheet would send it, with an optional change on one Lot.
create function pg_temp.phase_rows(p_phase_id bigint, p_lot_id bigint, p_details jsonb)
returns jsonb
language sql
as $$
  select jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'id', lot.id,
      'plan_id', lot.plan_id,
      'lot_number', case when lot.is_utility_building then null else lot.lot_number end,
      'is_reverse', lot.is_reverse,
      'is_utility_building', lot.is_utility_building,
      'utility_name', lot.utility_name,
      'option_ids', coalesce((
        select jsonb_agg(selected.option_id order by selected.option_id)
        from valtrim.lot_options selected where selected.lot_id = lot.id
      ), '[]'::jsonb),
      'option_details', case when lot.id = p_lot_id then p_details else null end
    )) order by lot.display_order, lot.id
  )
  from valtrim.lots lot
  where lot.phase_id = p_phase_id
$$;

create function pg_temp.save_phase(p_details jsonb, p_extra_option bigint default null)
returns text
language plpgsql
as $$
declare
  v_ctx qt_ctx;
  v_rows jsonb;
  v_phase record;
begin
  select * into v_ctx from qt_ctx;
  select * into v_phase from valtrim.phases where id = v_ctx.phase_id;
  v_rows := pg_temp.phase_rows(v_ctx.phase_id, v_ctx.lot_id, p_details);
  return pg_temp.run_as(
    v_ctx.admin_id,
    format(
      'select valtrim.save_sequence_sheet_phase(%s, %s, %L, %L, %L::jsonb, false)',
      v_ctx.job_id, v_ctx.phase_id, v_phase.code, coalesce(v_phase.building, ''), v_rows::text
    )
  );
end;
$$;

insert into qt_ctx (admin_id, job_id, phase_id, lot_id, option_id, unit_price)
select
  (select id from valtrim.app_users where role = 'ADMIN' and is_active order by created_at limit 1),
  phase.job_id, phase.id, selected.lot_id, selected.option_id, price.price
from valtrim.lot_options selected
join valtrim.lots lot on lot.id = selected.lot_id and not lot.is_utility_building
join valtrim.phases phase on phase.id = lot.phase_id and phase.is_active
join valtrim.jobs job on job.id = phase.job_id and job.is_active
join valtrim.option_prices price
  on price.option_id = selected.option_id
 and (price.id = selected.option_price_id or (selected.option_price_id is null and price.effective_to is null))
 and price.price > 0
 and not price.is_not_applicable
where not exists (
  select 1 from valtrim.package_options billed
  where billed.lot_id = selected.lot_id and billed.option_id = selected.option_id
)
order by selected.lot_id, selected.option_id
limit 1;

select pg_temp.check_that(
  'there is a Lot with an unbilled priced Option to test with',
  (select admin_id is not null and lot_id is not null from qt_ctx)
);

-- Columns, defaults, constraints -----------------------------------------------------------------------------

select pg_temp.check_that(
  'every Option already on a Lot or billed keeps quantity 1 and no locations',
  not exists (select 1 from valtrim.lot_options where quantity <> 1 or cardinality(locations) <> 0)
  and not exists (select 1 from valtrim.package_options where quantity <> 1)
);

select pg_temp.check_that(
  'signed-in users can read the quantity and the locations',
  has_column_privilege('authenticated', 'valtrim.lot_options', 'quantity', 'SELECT')
  and has_column_privilege('authenticated', 'valtrim.lot_options', 'locations', 'SELECT')
  and has_column_privilege('authenticated', 'valtrim.package_options', 'quantity', 'SELECT')
);

select pg_temp.check_that(
  'the helper functions cannot be called by users',
  not has_function_privilege('authenticated', 'private.sequence_sheet_option_wants(jsonb,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.lot_option_quantity_guard()', 'EXECUTE')
);

-- Saving a Phase ---------------------------------------------------------------------------------------------

create temporary table qt_out (name text primary key, outcome text) on commit drop;

insert into qt_out
select 'old client', pg_temp.save_phase(null);

select pg_temp.check_that(
  'a save with no Option details still works and changes nothing',
  (select outcome from qt_out where name = 'old client') like 'ok:%'
  and (select quantity = 1 and cardinality(locations) = 0 from valtrim.lot_options
       where lot_id = (select lot_id from qt_ctx) and option_id = (select option_id from qt_ctx)),
  (select outcome from qt_out where name = 'old client')
);

insert into qt_out
select 'three floors', pg_temp.save_phase(
  (select jsonb_build_array(jsonb_build_object(
    'option_id', option_id, 'quantity', 3,
    'locations', jsonb_build_array('1st floor', ' 2nd floor ', '3rd floor')
  )) from qt_ctx)
);

select pg_temp.check_that(
  'an Option can be saved with quantity 3 and three locations (trimmed)',
  (select outcome from qt_out where name = 'three floors') like 'ok:%'
  and (select quantity = 3 and locations = array['1st floor', '2nd floor', '3rd floor']
       from valtrim.lot_options
       where lot_id = (select lot_id from qt_ctx) and option_id = (select option_id from qt_ctx)),
  (select outcome from qt_out where name = 'three floors')
);

insert into qt_out
select 'old client again', pg_temp.save_phase(null);

select pg_temp.check_that(
  'a save with no details afterwards keeps the quantity and the locations',
  (select outcome from qt_out where name = 'old client again') like 'ok:%'
  and (select quantity = 3 and cardinality(locations) = 3 from valtrim.lot_options
       where lot_id = (select lot_id from qt_ctx) and option_id = (select option_id from qt_ctx)),
  (select outcome from qt_out where name = 'old client again')
);

insert into qt_out
select 'fewer locations', pg_temp.save_phase(
  (select jsonb_build_array(jsonb_build_object(
    'option_id', option_id, 'quantity', 4, 'locations', jsonb_build_array('Garage')
  )) from qt_ctx)
);

select pg_temp.check_that(
  'the quantity can be larger than the number of locations',
  (select outcome from qt_out where name = 'fewer locations') like 'ok:%'
  and (select quantity = 4 and locations = array['Garage'] from valtrim.lot_options
       where lot_id = (select lot_id from qt_ctx) and option_id = (select option_id from qt_ctx)),
  (select outcome from qt_out where name = 'fewer locations')
);

insert into qt_out
select 'too many locations', pg_temp.save_phase(
  (select jsonb_build_array(jsonb_build_object(
    'option_id', option_id, 'quantity', 1, 'locations', jsonb_build_array('A', 'B')
  )) from qt_ctx)
);
insert into qt_out
select 'quantity 100', pg_temp.save_phase(
  (select jsonb_build_array(jsonb_build_object('option_id', option_id, 'quantity', 100)) from qt_ctx)
);
insert into qt_out
select 'quantity 0', pg_temp.save_phase(
  (select jsonb_build_array(jsonb_build_object('option_id', option_id, 'quantity', 0)) from qt_ctx)
);
insert into qt_out
select 'blank location', pg_temp.save_phase(
  (select jsonb_build_array(jsonb_build_object(
    'option_id', option_id, 'quantity', 2, 'locations', jsonb_build_array('   ')
  )) from qt_ctx)
);
insert into qt_out
select 'long location', pg_temp.save_phase(
  (select jsonb_build_array(jsonb_build_object(
    'option_id', option_id, 'quantity', 2, 'locations', jsonb_build_array(repeat('x', 101))
  )) from qt_ctx)
);
insert into qt_out
select 'option not selected', pg_temp.save_phase(
  jsonb_build_array(jsonb_build_object('option_id', 999999999, 'quantity', 2))
);
insert into qt_out
select 'detail twice', pg_temp.save_phase(
  (select jsonb_build_array(
    jsonb_build_object('option_id', option_id, 'quantity', 2),
    jsonb_build_object('option_id', option_id, 'quantity', 3)
  ) from qt_ctx)
);
insert into qt_out
select 'details not a list', pg_temp.save_phase('{"option_id": 1}'::jsonb);

select pg_temp.check_that(
  'wrong details are refused with a clear message',
  (select outcome like 'err:23514:%' from qt_out where name = 'too many locations')
  and (select outcome like 'err:23514:%' from qt_out where name = 'quantity 100')
  and (select outcome like 'err:23514:%' from qt_out where name = 'quantity 0')
  and (select outcome like 'err:23514:%' from qt_out where name = 'blank location')
  and (select outcome like 'err:23514:%' from qt_out where name = 'long location')
  and (select outcome like 'err:23514:%' from qt_out where name = 'option not selected')
  and (select outcome like 'err:23505:%' from qt_out where name = 'detail twice')
  and (select outcome like 'err:22023:%' from qt_out where name = 'details not a list'),
  (select string_agg(name || ' => ' || outcome, E'\n' order by name) from qt_out)
);

select pg_temp.check_that(
  'a refused save leaves the Option as it was',
  (select quantity = 4 and locations = array['Garage'] from valtrim.lot_options
   where lot_id = (select lot_id from qt_ctx) and option_id = (select option_id from qt_ctx))
);

-- Back to 3 floors for the billing steps.
insert into qt_out
select 'three floors again', pg_temp.save_phase(
  (select jsonb_build_array(jsonb_build_object(
    'option_id', option_id, 'quantity', 3,
    'locations', jsonb_build_array('1st floor', '2nd floor', '3rd floor')
  )) from qt_ctx)
);

-- Billing ---------------------------------------------------------------------------------------------------

insert into qt_out
select 'package', pg_temp.run_as(
  (select admin_id from qt_ctx),
  format(
    'select valtrim.create_options_package(%s, %L::jsonb, current_date, null)',
    (select job_id from qt_ctx),
    (select jsonb_build_array(jsonb_build_object('lot_id', lot_id, 'option_id', option_id))::text from qt_ctx)
  )
);

update qt_ctx set package_id = nullif(regexp_replace((select outcome from qt_out where name = 'package'), '^ok:', ''), '')::bigint
where (select outcome from qt_out where name = 'package') like 'ok:%';

select pg_temp.check_that(
  'an Options Package bills the price times the quantity',
  (select package_id is not null from qt_ctx)
  and (
    select billed.quantity = 3 and billed.option_price = ctx.unit_price * 3
    from valtrim.package_options billed, qt_ctx ctx
    where billed.package_id = ctx.package_id and billed.lot_id = ctx.lot_id and billed.option_id = ctx.option_id
  ),
  (select outcome from qt_out where name = 'package')
);

select pg_temp.check_that(
  'the Retention and the WRAP of the row are taken on the whole amount',
  (select package_id is not null from qt_ctx)
  and (
    select billed.retention_amount >= 0
      and billed.retention_amount = round(billed.option_price * (
        select version.retention_percentage from valtrim.jobs job
        join valtrim.billing_setup_versions version on version.id = job.billing_setup_version_id
        where job.id = ctx.job_id
      ) / 100, 2)
    from valtrim.package_options billed, qt_ctx ctx
    where billed.package_id = ctx.package_id and billed.lot_id = ctx.lot_id and billed.option_id = ctx.option_id
  )
);

select pg_temp.check_that(
  'the invoice of the Package is for the whole amount',
  (select package_id is not null from qt_ctx)
  and (
    select invoice.gross_amount = ctx.unit_price * 3
    from valtrim.invoices invoice, qt_ctx ctx
    where invoice.package_id = ctx.package_id
  )
);

insert into qt_out
select 'billed quantity', pg_temp.save_phase(
  (select jsonb_build_array(jsonb_build_object(
    'option_id', option_id, 'quantity', 2, 'locations', jsonb_build_array('1st floor')
  )) from qt_ctx)
);

select pg_temp.check_that(
  'the quantity of an Option that is on a Package cannot change',
  (select package_id is not null from qt_ctx)
  and (select outcome like 'err:23514:%already on a Package%' from qt_out where name = 'billed quantity')
  and (select quantity = 3 from valtrim.lot_options
       where lot_id = (select lot_id from qt_ctx) and option_id = (select option_id from qt_ctx)),
  (select outcome from qt_out where name = 'billed quantity')
);

insert into qt_out
select 'billed locations', pg_temp.save_phase(
  (select jsonb_build_array(jsonb_build_object(
    'option_id', option_id, 'quantity', 3, 'locations', jsonb_build_array('Kitchen', 'Bath')
  )) from qt_ctx)
);

select pg_temp.check_that(
  'the locations of an Option on a Package can still be corrected',
  (select package_id is not null from qt_ctx)
  and (select outcome like 'ok:%' from qt_out where name = 'billed locations')
  and (select locations = array['Kitchen', 'Bath'] from valtrim.lot_options
       where lot_id = (select lot_id from qt_ctx) and option_id = (select option_id from qt_ctx)),
  (select outcome from qt_out where name = 'billed locations')
);

-- A Draw Package ----------------------------------------------------------------------------------------------
-- A Lot with a single Option, on its own Job: the Draw of the Options billing bills price x quantity, and a price
-- that moves is applied to every unit.

create temporary table qt_draw (
  job_id bigint,
  lot_id bigint,
  option_id bigint,
  draw_number smallint,
  unit_price numeric,
  package_id bigint
) on commit drop;

insert into qt_draw (job_id, lot_id, option_id, draw_number, unit_price)
select phase.job_id, selected.lot_id, selected.option_id, version.options_billing_draw_number, price.price
from valtrim.lot_options selected
join valtrim.lots lot on lot.id = selected.lot_id and not lot.is_utility_building
join valtrim.phases phase on phase.id = lot.phase_id and phase.is_active
join valtrim.jobs job on job.id = phase.job_id and job.is_active
join valtrim.billing_setup_versions version
  on version.id = job.billing_setup_version_id and version.builder_id = job.builder_id
join valtrim.option_prices price
  on price.option_id = selected.option_id
 and (price.id = selected.option_price_id or (selected.option_price_id is null and price.effective_to is null))
 and price.price > 0
 and not price.is_not_applicable
where selected.lot_id <> (select lot_id from qt_ctx)
  and (select count(*) from valtrim.lot_options own where own.lot_id = selected.lot_id) = 1
  and not exists (
    select 1 from valtrim.package_options billed where billed.lot_id = selected.lot_id
  )
  and not exists (
    select 1 from valtrim.package_draws line where line.lot_id = selected.lot_id
  )
order by selected.lot_id
limit 1;

select pg_temp.check_that(
  'there is a Lot with a single unbilled Option and no Draw yet to test with',
  (select lot_id is not null from qt_draw)
);

update valtrim.lot_options
set quantity = 2, locations = array['Upstairs']
where lot_id = (select lot_id from qt_draw) and option_id = (select option_id from qt_draw);

insert into qt_out
select 'draw package', pg_temp.run_as(
  (select admin_id from qt_ctx),
  format(
    'select private.create_draw_invoice_package(%s, %L::jsonb, current_date, null)',
    (select job_id from qt_draw),
    (select jsonb_build_array(jsonb_build_object('lot_id', lot_id, 'draw_number', draw_number))::text from qt_draw)
  )
);

update qt_draw set package_id = nullif(regexp_replace((select outcome from qt_out where name = 'draw package'), '^ok:', ''), '')::bigint
where (select outcome from qt_out where name = 'draw package') like 'ok:%';

select pg_temp.check_that(
  'a Draw Package bills the Option price times its quantity',
  (select package_id is not null from qt_draw)
  and (
    select billed.quantity = 2 and billed.option_price = draw.unit_price * 2
    from valtrim.package_options billed, qt_draw draw
    where billed.package_id = draw.package_id and billed.lot_id = draw.lot_id and billed.option_id = draw.option_id
  )
  and (
    select line.options_amount = draw.unit_price * 2
    from valtrim.package_draws line, qt_draw draw
    where line.package_id = draw.package_id and line.lot_id = draw.lot_id
  ),
  (select outcome from qt_out where name = 'draw package')
);

insert into qt_out
select 'new price', pg_temp.run_as(
  (select admin_id from qt_ctx),
  format(
    'select valtrim.set_option_price(%s, %s, false)::text',
    (select option_id from qt_draw), (select unit_price + 10 from qt_draw)
  )
);

insert into qt_out
select 'apply price', pg_temp.run_as(
  (select admin_id from qt_ctx),
  format(
    'select valtrim.apply_phase_price_changes(%s, %L::bigint[], %L::jsonb, %L, false)::text',
    (select job_id from qt_draw),
    '{}',
    (select jsonb_build_array(jsonb_build_object('lot_id', lot_id, 'option_id', option_id))::text from qt_draw),
    'quantity test'
  )
);

select pg_temp.check_that(
  'a price that moved on a Draft Package is applied to every unit',
  (select package_id is not null from qt_draw)
  and (select outcome like 'ok:%' from qt_out where name = 'apply price')
  and (
    select line.options_amount = (draw.unit_price + 10) * 2
    from valtrim.package_draws line, qt_draw draw
    where line.package_id = draw.package_id and line.lot_id = draw.lot_id
  )
  and (
    select billed.quantity = 2 and billed.option_price = (draw.unit_price + 10) * 2
    from valtrim.package_options billed, qt_draw draw
    where billed.lot_id = draw.lot_id and billed.option_id = draw.option_id
  ),
  (select 'new price: ' || (select outcome from qt_out where name = 'new price')
     || ' | apply: ' || (select outcome from qt_out where name = 'apply price'))
);

select step, name, ok, detail from qt_results order by step;

rollback;
