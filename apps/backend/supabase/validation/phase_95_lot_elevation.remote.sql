-- The elevation of a Lot, against the real database, inside a transaction that is rolled back. Run it after the
-- migration 20261209120000; every row of the last result must have ok = true. It borrows two Lots with an unbilled priced
-- Option, saves a Phase as an ADMIN with and without an elevation, bills them in an Options Package and in a Draw Package
-- and leaves nothing behind.

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
  package_id bigint
) on commit drop;

create temporary table qt_draw (
  job_id bigint,
  lot_id bigint,
  option_id bigint,
  draw_number smallint,
  package_id bigint
) on commit drop;

create temporary table qt_out (name text primary key, outcome text) on commit drop;

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

-- The Phase as the Sequence Sheet would send it. The borrowed Lot carries `elevation` only when p_send is true.
create function pg_temp.save_phase(p_send boolean, p_elevation text default null)
returns text
language plpgsql
as $$
declare
  v_ctx qt_ctx;
  v_phase record;
  v_rows jsonb;
begin
  select * into v_ctx from qt_ctx;
  select * into v_phase from valtrim.phases where id = v_ctx.phase_id;
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
      ), '[]'::jsonb)
    )) || case
      when p_send and lot.id = v_ctx.lot_id then jsonb_build_object('elevation', p_elevation)
      else '{}'::jsonb
    end
    order by lot.display_order, lot.id
  )
  into v_rows
  from valtrim.lots lot
  where lot.phase_id = v_ctx.phase_id;

  return pg_temp.run_as(
    v_ctx.admin_id,
    format(
      'select valtrim.save_sequence_sheet_phase(%s, %s, %L, %L, %L::jsonb, false)',
      v_ctx.job_id, v_ctx.phase_id, v_phase.code, coalesce(v_phase.building, ''), v_rows::text
    )
  );
end;
$$;

insert into qt_ctx (admin_id, job_id, phase_id, lot_id, option_id)
select
  (select id from valtrim.app_users where role = 'ADMIN' and is_active order by created_at limit 1),
  phase.job_id, phase.id, selected.lot_id, selected.option_id
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

-- Columns and rows that already exist ---------------------------------------------------------------------------

select pg_temp.check_that(
  'the elevation is a column of the Lot and of the three kinds of Package line, readable by users and the service',
  has_column_privilege('authenticated', 'valtrim.lots', 'elevation', 'SELECT')
  and has_column_privilege('service_role', 'valtrim.lots', 'elevation', 'SELECT')
  and has_column_privilege('service_role', 'valtrim.lots', 'elevation', 'UPDATE')
  and not has_column_privilege('authenticated', 'valtrim.lots', 'elevation', 'UPDATE')
  and has_column_privilege('authenticated', 'valtrim.package_draws', 'lot_elevation', 'SELECT')
  and has_column_privilege('authenticated', 'valtrim.package_hardware_lines', 'lot_elevation', 'SELECT')
  and has_column_privilege('authenticated', 'valtrim.package_options', 'lot_elevation', 'SELECT')
  and has_column_privilege('service_role', 'valtrim.package_options', 'lot_elevation', 'SELECT')
);

select pg_temp.check_that(
  'what existed before has no elevation, so it shows as it did',
  not exists (select 1 from valtrim.lots where elevation is not null)
  and not exists (select 1 from valtrim.package_draws where lot_elevation is not null)
  and not exists (select 1 from valtrim.package_hardware_lines where lot_elevation is not null)
  and not exists (select 1 from valtrim.package_options where lot_elevation is not null)
);

select pg_temp.check_that(
  'the Package triggers and the Options Package copy the elevation',
  position('lot_elevation' in pg_get_functiondef('valtrim.prepare_package_draw()'::regprocedure)) > 0
  and position('lot_elevation' in pg_get_functiondef('valtrim.prepare_package_hardware_line()'::regprocedure)) > 0
  and position('lot_elevation' in pg_get_functiondef('valtrim.populate_package_options()'::regprocedure)) > 0
  and position('lot_elevation' in pg_get_functiondef('private.create_options_package(bigint,jsonb,date,text)'::regprocedure)) > 0
);

-- The Sequence Sheet saves it -------------------------------------------------------------------------------------

insert into qt_out select 'save a', pg_temp.save_phase(true, ' a ');

select pg_temp.check_that(
  'an elevation is saved in upper case and trimmed',
  (select outcome from qt_out where name = 'save a') like 'ok:%'
  and (select elevation = 'A' from valtrim.lots where id = (select lot_id from qt_ctx)),
  (select outcome from qt_out where name = 'save a')
);

insert into qt_out select 'save without', pg_temp.save_phase(false);

select pg_temp.check_that(
  'a save that does not name an elevation keeps the one the Lot has',
  (select outcome from qt_out where name = 'save without') like 'ok:%'
  and (select elevation = 'A' from valtrim.lots where id = (select lot_id from qt_ctx)),
  (select outcome from qt_out where name = 'save without')
);

insert into qt_out select 'too long', pg_temp.save_phase(true, repeat('X', 21));

select pg_temp.check_that(
  'an elevation of more than 20 characters is refused and the Lot keeps its own',
  (select outcome from qt_out where name = 'too long') like 'err:%'
  and (select elevation = 'A' from valtrim.lots where id = (select lot_id from qt_ctx)),
  (select outcome from qt_out where name = 'too long')
);

insert into qt_out select 'clear', pg_temp.save_phase(true, '  ');

select pg_temp.check_that(
  'an empty elevation clears it',
  (select outcome from qt_out where name = 'clear') like 'ok:%'
  and (select elevation is null from valtrim.lots where id = (select lot_id from qt_ctx)),
  (select outcome from qt_out where name = 'clear')
);

-- The Plan can be the same for Lots with another elevation: the key of a Lot is still its number --------------------

update valtrim.lots lot
set elevation = case when lot.id = (select min(id) from valtrim.lots where phase_id = (select phase_id from qt_ctx)) then 'A' else 'B' end
where lot.phase_id = (select phase_id from qt_ctx) and not lot.is_utility_building;

select pg_temp.check_that(
  'Lots of one Phase can each have another elevation, whatever their Plan',
  (select count(distinct elevation) = 2 from valtrim.lots where phase_id = (select phase_id from qt_ctx) and not is_utility_building)
  or (select count(*) = 1 from valtrim.lots where phase_id = (select phase_id from qt_ctx) and not is_utility_building)
);
update valtrim.lots set elevation = null where phase_id = (select phase_id from qt_ctx);

-- An Options Package takes the elevation of the moment ------------------------------------------------------------

insert into qt_out select 'save b', pg_temp.save_phase(true, 'b');

insert into qt_out
select 'package with b', pg_temp.run_as(
  (select admin_id from qt_ctx),
  format(
    'select valtrim.create_options_package(%s, %L::jsonb, current_date, null)',
    (select job_id from qt_ctx),
    (select jsonb_build_array(jsonb_build_object('lot_id', lot_id, 'option_id', option_id, 'unit_no', 1))::text from qt_ctx)
  )
);

update qt_ctx set package_id = nullif(regexp_replace((select outcome from qt_out where name = 'package with b'), '^ok:', ''), '')::bigint
where (select outcome from qt_out where name = 'package with b') like 'ok:%';

select pg_temp.check_that(
  'an Options Package keeps the elevation the Lot had when it was made',
  (select package_id is not null from qt_ctx)
  and (
    select billed.lot_elevation = 'B'
    from valtrim.package_options billed, qt_ctx ctx
    where billed.package_id = ctx.package_id and billed.lot_id = ctx.lot_id and billed.option_id = ctx.option_id
  ),
  (select outcome from qt_out where name = 'package with b')
);

insert into qt_out select 'save c', pg_temp.save_phase(true, 'c');

select pg_temp.check_that(
  'changing the elevation afterwards does not change the Package that was made',
  (select elevation = 'C' from valtrim.lots where id = (select lot_id from qt_ctx))
  and (
    select billed.lot_elevation = 'B'
    from valtrim.package_options billed, qt_ctx ctx
    where billed.package_id = ctx.package_id and billed.lot_id = ctx.lot_id and billed.option_id = ctx.option_id
  )
);

-- A Lot with no elevation leaves the line without one -----------------------------------------------------------------

update valtrim.lot_options
set quantity = 2
where lot_id = (select lot_id from qt_ctx) and option_id = (select option_id from qt_ctx);
insert into qt_out select 'clear again', pg_temp.save_phase(true, '');

insert into qt_out
select 'package without', pg_temp.run_as(
  (select admin_id from qt_ctx),
  format(
    'select valtrim.create_options_package(%s, %L::jsonb, current_date, null)',
    (select job_id from qt_ctx),
    (select jsonb_build_array(jsonb_build_object('lot_id', lot_id, 'option_id', option_id, 'unit_no', 2))::text from qt_ctx)
  )
);

select pg_temp.check_that(
  'a Lot with no elevation leaves the Package line without one, as before',
  (select outcome from qt_out where name = 'package without') like 'ok:%'
  and (
    select billed.lot_elevation is null
    from valtrim.package_options billed, qt_ctx ctx
    where billed.lot_id = ctx.lot_id and billed.option_id = ctx.option_id and billed.unit_no = 2
  ),
  (select outcome from qt_out where name = 'package without')
);

-- A Draw Package ----------------------------------------------------------------------------------------------------

insert into qt_draw (job_id, lot_id, option_id, draw_number)
select phase.job_id, selected.lot_id, selected.option_id, version.options_billing_draw_number
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
  and not exists (select 1 from valtrim.package_options billed where billed.lot_id = selected.lot_id)
  and not exists (select 1 from valtrim.package_draws line where line.lot_id = selected.lot_id)
order by selected.lot_id
limit 1;

select pg_temp.check_that(
  'there is a Lot with a single unbilled Option and no Draw yet to test with',
  (select lot_id is not null from qt_draw)
);

update valtrim.lots set elevation = 'D' where id = (select lot_id from qt_draw);

insert into qt_out
select 'draw package', pg_temp.run_as(
  (select admin_id from qt_ctx),
  format(
    'select private.create_draw_invoice_package(%s, %L::jsonb, current_date, null)',
    (select job_id from qt_draw),
    (select jsonb_build_array(jsonb_build_object(
       'lot_id', lot_id, 'draw_number', draw_number,
       'package_options', jsonb_build_array(jsonb_build_object('lot_id', lot_id, 'option_id', option_id))
     ))::text from qt_draw)
  )
);

update qt_draw set package_id = nullif(regexp_replace((select outcome from qt_out where name = 'draw package'), '^ok:', ''), '')::bigint
where (select outcome from qt_out where name = 'draw package') like 'ok:%';

select pg_temp.check_that(
  'a Draw Package keeps the elevation on its Draw line and on the Option it carries',
  (select package_id is not null from qt_draw)
  and (
    select bool_and(line.lot_elevation = 'D' and line.plan_code = plan.code)
    from valtrim.package_draws line
    join valtrim.lots lot on lot.id = line.lot_id
    join valtrim.plans plan on plan.id = lot.plan_id, qt_draw draw
    where line.package_id = draw.package_id and line.lot_id = draw.lot_id
  )
  and (
    select count(*) >= 1 and bool_and(billed.lot_elevation = 'D')
    from valtrim.package_options billed, qt_draw draw
    where billed.package_id = draw.package_id and billed.lot_id = draw.lot_id
  ),
  (select outcome from qt_out where name = 'draw package')
);

-- Nothing financial reads it ------------------------------------------------------------------------------------------

select pg_temp.check_that(
  'the amounts of the Draw line do not depend on the elevation',
  (select package_id is not null from qt_draw)
  and (
    select line.gross_amount = (
      select invoice.gross_amount from valtrim.invoices invoice where invoice.package_id = draw.package_id
    )
    from valtrim.package_draws line, qt_draw draw
    where line.package_id = draw.package_id and line.lot_id = draw.lot_id
  )
);

select step, name, ok, detail from qt_results order by step;

rollback;
