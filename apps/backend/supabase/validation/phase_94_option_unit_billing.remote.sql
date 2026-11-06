-- An Option billed unit by unit (one package_options row per unit of a Lot's Option), against the real database,
-- inside a transaction that is rolled back. Run it after the migration 20261208120000; every row of the last result
-- must have ok = true. It borrows one Lot that has an unbilled priced Option, saves its Phase again as an ADMIN, bills
-- its units in Options Packages and in a Draw Package and leaves nothing behind.

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
order by (version.retention_enabled and version.retention_percentage > 0) desc, selected.lot_id, selected.option_id
limit 1;

select pg_temp.check_that(
  'there is a Lot with an unbilled priced Option to test with',
  (select admin_id is not null and lot_id is not null from qt_ctx)
);

-- The Job of the test withholds retention (inside this transaction only), so a Retention Release can be tried.
alter table valtrim.billing_setup_versions disable trigger user; -- a Setup in use is immutable; this is rolled back
update valtrim.billing_setup_versions version
set retention_enabled = true,
    retention_percentage = 10,
    retention_release_scope = coalesce(version.retention_release_scope, 'JOB')
where version.id = (
  select job.billing_setup_version_id from valtrim.jobs job where job.id = (select job_id from qt_ctx)
);

-- Columns and keys ------------------------------------------------------------------------------------------

select pg_temp.check_that(
  'a Package row is one unit: the key has the unit and signed-in users can read it',
  exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.package_options'::regclass and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (lot_id, option_id, unit_no)'
  )
  and has_column_privilege('authenticated', 'valtrim.package_options', 'unit_no', 'SELECT')
  and has_column_privilege('authenticated', 'valtrim.package_options', 'unit_label', 'SELECT')
  and has_column_privilege('authenticated', 'valtrim.retention_release_option_lines', 'source_unit_no', 'SELECT')
);

select pg_temp.check_that(
  'the helper functions cannot be called by users',
  not has_function_privilege('authenticated', 'private.expand_option_units(jsonb)', 'EXECUTE')
);

select pg_temp.check_that(
  'the Options already billed keep unit 1',
  not exists (select 1 from valtrim.package_options where unit_no <> 1 or quantity <> 1)
);

create temporary table qt_out (name text primary key, outcome text) on commit drop;

-- The Lot has three locations ------------------------------------------------------------------------------

insert into qt_out
select 'three floors', pg_temp.save_phase(
  (select jsonb_build_array(jsonb_build_object(
    'option_id', option_id, 'quantity', 3,
    'locations', jsonb_build_array('1st floor', '2nd floor', '3rd floor')
  )) from qt_ctx)
);

select pg_temp.check_that(
  'the Option is saved with three units',
  (select outcome from qt_out where name = 'three floors') like 'ok:%'
  and (select quantity = 3 from valtrim.lot_options
       where lot_id = (select lot_id from qt_ctx) and option_id = (select option_id from qt_ctx)),
  (select outcome from qt_out where name = 'three floors')
);

-- An Options Package bills one unit --------------------------------------------------------------------------

insert into qt_out
select 'package unit 1', pg_temp.run_as(
  (select admin_id from qt_ctx),
  format(
    'select valtrim.create_options_package(%s, %L::jsonb, current_date, null)',
    (select job_id from qt_ctx),
    (select jsonb_build_array(jsonb_build_object('lot_id', lot_id, 'option_id', option_id, 'unit_no', 1))::text from qt_ctx)
  )
);

update qt_ctx set package_id = nullif(regexp_replace((select outcome from qt_out where name = 'package unit 1'), '^ok:', ''), '')::bigint
where (select outcome from qt_out where name = 'package unit 1') like 'ok:%';

select pg_temp.check_that(
  'a Package bills only the unit that was chosen, with its location and the price of one unit',
  (select package_id is not null from qt_ctx)
  and (select count(*) = 1 from valtrim.package_options billed, qt_ctx ctx
       where billed.lot_id = ctx.lot_id and billed.option_id = ctx.option_id)
  and (
    select billed.unit_no = 1 and billed.unit_label = '1st floor' and billed.quantity = 1
      and billed.option_price = ctx.unit_price
    from valtrim.package_options billed, qt_ctx ctx
    where billed.package_id = ctx.package_id and billed.lot_id = ctx.lot_id and billed.option_id = ctx.option_id
  ),
  (select outcome from qt_out where name = 'package unit 1')
);

select pg_temp.check_that(
  'the invoice of that Package is for one unit, and so are its Retention and WRAP',
  (select package_id is not null from qt_ctx)
  and (
    select invoice.gross_amount = ctx.unit_price
    from valtrim.invoices invoice, qt_ctx ctx where invoice.package_id = ctx.package_id
  )
  and (
    select billed.retention_amount = round(billed.option_price * (
      select version.retention_percentage from valtrim.jobs job
      join valtrim.billing_setup_versions version on version.id = job.billing_setup_version_id
      where job.id = ctx.job_id
    ) / 100, 2)
    from valtrim.package_options billed, qt_ctx ctx
    where billed.package_id = ctx.package_id and billed.lot_id = ctx.lot_id and billed.option_id = ctx.option_id
  )
);

-- A unit cannot be billed twice ---------------------------------------------------------------------------------

insert into qt_out
select 'unit 1 again', pg_temp.run_as(
  (select admin_id from qt_ctx),
  format(
    'select valtrim.create_options_package(%s, %L::jsonb, current_date, null)',
    (select job_id from qt_ctx),
    (select jsonb_build_array(jsonb_build_object('lot_id', lot_id, 'option_id', option_id, 'unit_no', 1))::text from qt_ctx)
  )
);
insert into qt_out
select 'whole option', pg_temp.run_as(
  (select admin_id from qt_ctx),
  format(
    'select valtrim.create_options_package(%s, %L::jsonb, current_date, null)',
    (select job_id from qt_ctx),
    (select jsonb_build_array(jsonb_build_object('lot_id', lot_id, 'option_id', option_id))::text from qt_ctx)
  )
);
insert into qt_out
select 'unit 4', pg_temp.run_as(
  (select admin_id from qt_ctx),
  format(
    'select valtrim.create_options_package(%s, %L::jsonb, current_date, null)',
    (select job_id from qt_ctx),
    (select jsonb_build_array(jsonb_build_object('lot_id', lot_id, 'option_id', option_id, 'unit_no', 4))::text from qt_ctx)
  )
);
insert into qt_out
select 'unit 0', pg_temp.run_as(
  (select admin_id from qt_ctx),
  format(
    'select valtrim.create_options_package(%s, %L::jsonb, current_date, null)',
    (select job_id from qt_ctx),
    (select jsonb_build_array(jsonb_build_object('lot_id', lot_id, 'option_id', option_id, 'unit_no', 0))::text from qt_ctx)
  )
);
insert into qt_out
select 'same unit twice', pg_temp.run_as(
  (select admin_id from qt_ctx),
  format(
    'select valtrim.create_options_package(%s, %L::jsonb, current_date, null)',
    (select job_id from qt_ctx),
    (select jsonb_build_array(
       jsonb_build_object('lot_id', lot_id, 'option_id', option_id, 'unit_no', 2),
       jsonb_build_object('lot_id', lot_id, 'option_id', option_id, 'unit_no', 2)
     )::text from qt_ctx)
  )
);

select pg_temp.check_that(
  'a billed unit, a unit that does not exist and a repeated unit are refused',
  (select outcome like 'err:23505:%already billed%' from qt_out where name = 'unit 1 again')
  and (select outcome like 'err:23505:%already billed%' from qt_out where name = 'whole option')
  and (select outcome like 'err:23503:%' from qt_out where name = 'unit 4')
  and (select outcome like 'err:23514:%' from qt_out where name = 'unit 0')
  and (select outcome like 'err:23514:%unique%' from qt_out where name = 'same unit twice'),
  (select string_agg(name || ' => ' || outcome, E'\n' order by name) from qt_out)
);

-- The other units go in a second Package ---------------------------------------------------------------------------

insert into qt_out
select 'package units 2 and 3', pg_temp.run_as(
  (select admin_id from qt_ctx),
  format(
    'select valtrim.create_options_package(%s, %L::jsonb, current_date, null)',
    (select job_id from qt_ctx),
    (select jsonb_build_array(
       jsonb_build_object('lot_id', lot_id, 'option_id', option_id, 'unit_no', 2),
       jsonb_build_object('lot_id', lot_id, 'option_id', option_id, 'unit_no', 3)
     )::text from qt_ctx)
  )
);

select pg_temp.check_that(
  'the remaining units are billed in another Package with their own locations',
  (select outcome from qt_out where name = 'package units 2 and 3') like 'ok:%'
  and (
    select array_agg(billed.unit_label order by billed.unit_no) = array['2nd floor', '3rd floor']
      and sum(billed.option_price) = (select unit_price * 2 from qt_ctx)
    from valtrim.package_options billed, qt_ctx ctx
    where billed.package_id = regexp_replace((select outcome from qt_out where name = 'package units 2 and 3'), '^ok:', '')::bigint
      and billed.lot_id = ctx.lot_id and billed.option_id = ctx.option_id
  )
  and (
    select invoice.gross_amount = ctx.unit_price * 2
    from valtrim.invoices invoice, qt_ctx ctx
    where invoice.package_id = regexp_replace((select outcome from qt_out where name = 'package units 2 and 3'), '^ok:', '')::bigint
  ),
  (select outcome from qt_out where name = 'package units 2 and 3')
);

-- A billed unit and its location are fixed ----------------------------------------------------------------------

create function pg_temp.update_option(p_set text)
returns text
language plpgsql
as $$
declare
  v_ctx qt_ctx;
  v_count integer;
begin
  select * into v_ctx from qt_ctx;
  begin
    execute format(
      'with changed as (update valtrim.lot_options set %s where lot_id = %s and option_id = %s returning 1) select count(*) from changed',
      p_set, v_ctx.lot_id, v_ctx.option_id
    ) into v_count;
    return 'ok:' || v_count;
  exception when others then
    return 'err:' || sqlstate || ':' || sqlerrm;
  end;
end;
$$;

insert into qt_out select 'fewer units', pg_temp.update_option('quantity = 2, locations = array[''1st floor'', ''2nd floor'']');
insert into qt_out select 'rename billed location', pg_temp.update_option('locations = array[''Basement'', ''2nd floor'', ''3rd floor'']');
insert into qt_out select 'more units', pg_temp.update_option('quantity = 4');
insert into qt_out select 'name the 4th', pg_temp.update_option('locations = array[''1st floor'', ''2nd floor'', ''3rd floor'', ''Garage'']');

select pg_temp.check_that(
  'a billed unit cannot be removed and its location cannot change, but more units can be added',
  (select outcome like 'err:23514:%cannot be removed%' from qt_out where name = 'fewer units')
  and (select outcome like 'err:23514:%location%already on a Package%' from qt_out where name = 'rename billed location')
  and (select outcome = 'ok:1' from qt_out where name = 'more units')
  and (select outcome = 'ok:1' from qt_out where name = 'name the 4th'),
  (select string_agg(name || ' => ' || outcome, E'\n' order by name) from qt_out)
);

insert into qt_out
select 'unit 4 package', pg_temp.run_as(
  (select admin_id from qt_ctx),
  format(
    'select valtrim.create_options_package(%s, %L::jsonb, current_date, null)',
    (select job_id from qt_ctx),
    (select jsonb_build_array(jsonb_build_object('lot_id', lot_id, 'option_id', option_id, 'unit_no', 4))::text from qt_ctx)
  )
);

select pg_temp.check_that(
  'a unit added afterwards can be billed on its own',
  (select outcome from qt_out where name = 'unit 4 package') like 'ok:%'
  and exists (
    select 1 from valtrim.package_options billed, qt_ctx ctx
    where billed.lot_id = ctx.lot_id and billed.option_id = ctx.option_id
      and billed.unit_no = 4 and billed.unit_label = 'Garage'
  ),
  (select outcome from qt_out where name = 'unit 4 package')
);

-- Retention is released per Phase when the Billing Setup says so, and per Job otherwise.
create function pg_temp.release_phase()
returns text
language sql
as $$
  select coalesce((
    select case when version.retention_release_scope = 'BUILDING' then ctx.phase_id::text end
    from qt_ctx ctx
    join valtrim.jobs job on job.id = ctx.job_id
    join valtrim.billing_setup_versions version on version.id = job.billing_setup_version_id
  ), 'null')
$$;

-- Retention is released unit by unit -------------------------------------------------------------------------------
-- The conditions of a real release (Hardware billed for every Lot, the cutoff date, the month of waiting) belong to the
-- Job being borrowed, not to what is tried here. Inside this transaction only, they are lifted from the function so
-- that the part that carries each unit of an Option can run. Everything is rolled back at the end.
do $lift$
declare
  v_definition text := pg_get_functiondef('private.create_retention_release_package(bigint,bigint,text)'::regprocedure);
  v_lifted text;
begin
  v_lifted := replace(v_definition, 'if v_completed_lots <> v_expected_lots then', 'if false then');
  v_lifted := replace(v_lifted, 'if coalesce(v_missing_cutoff, true) or v_source_cutoff_date is null then', 'if false then');
  v_lifted := replace(v_lifted, 'if current_date < v_available_date then', 'if false then');
  if v_lifted = v_definition then
    raise exception 'The conditions of the Retention Release could not be lifted for the test';
  end if;
  execute v_lifted;
end
$lift$;

update valtrim.draw_packages
set workflow_status = 'READY_TO_SUBMIT'
where id in (
  select package_id from valtrim.package_options
  where lot_id = (select lot_id from qt_ctx) and option_id = (select option_id from qt_ctx)
);

insert into qt_out
select 'retention release', pg_temp.run_as(
  (select admin_id from qt_ctx),
  format(
    'select private.create_retention_release_package(%s, %s, null)',
    (select job_id from qt_ctx), pg_temp.release_phase()
  )
);

select pg_temp.check_that(
  'a Retention Release takes the retention of every billed unit, once (needs a Job that withholds retention)',
  (select outcome from qt_out where name = 'retention release') like 'ok:%'
  and (
    select count(*) = 4 and count(distinct line.source_unit_no) = 4
    from valtrim.retention_release_option_lines line, qt_ctx ctx
    where line.source_lot_id = ctx.lot_id and line.source_option_id = ctx.option_id
  ),
  (select outcome from qt_out where name = 'retention release')
);

insert into qt_out
select 'retention release again', pg_temp.run_as(
  (select admin_id from qt_ctx),
  format(
    'select private.create_retention_release_package(%s, %s, null)',
    (select job_id from qt_ctx), pg_temp.release_phase()
  )
);

select pg_temp.check_that(
  'the same retention cannot be released again',
  (select outcome from qt_out where name = 'retention release again') like 'err:%',
  (select outcome from qt_out where name = 'retention release again')
);

-- A Draw Package ----------------------------------------------------------------------------------------------
-- A Lot with a single Option, on its own Job: the Draw of the Options billing bills the units that were chosen.

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
set quantity = 3, locations = array['Upstairs', 'Downstairs', 'Garage']
where lot_id = (select lot_id from qt_draw) and option_id = (select option_id from qt_draw);

insert into qt_out
select 'draw package', pg_temp.run_as(
  (select admin_id from qt_ctx),
  format(
    'select private.create_draw_invoice_package(%s, %L::jsonb, current_date, null)',
    (select job_id from qt_draw),
    (select jsonb_build_array(jsonb_build_object(
       'lot_id', lot_id, 'draw_number', draw_number,
       'package_options', jsonb_build_array(jsonb_build_object('lot_id', lot_id, 'option_id', option_id, 'unit_no', 2))
     ))::text from qt_draw)
  )
);

update qt_draw set package_id = nullif(regexp_replace((select outcome from qt_out where name = 'draw package'), '^ok:', ''), '')::bigint
where (select outcome from qt_out where name = 'draw package') like 'ok:%';

select pg_temp.check_that(
  'a Draw Package bills only the unit that was chosen',
  (select package_id is not null from qt_draw)
  and (
    select count(*) = 1 and bool_and(billed.unit_no = 2 and billed.unit_label = 'Downstairs'
      and billed.option_price = draw.unit_price and billed.quantity = 1)
    from valtrim.package_options billed, qt_draw draw
    where billed.lot_id = draw.lot_id and billed.option_id = draw.option_id
  )
  and (
    select line.options_amount = draw.unit_price
    from valtrim.package_draws line, qt_draw draw
    where line.package_id = draw.package_id and line.lot_id = draw.lot_id
  ),
  (select outcome from qt_out where name = 'draw package')
);

insert into qt_out
select 'options package after draw', pg_temp.run_as(
  (select admin_id from qt_ctx),
  format(
    'select valtrim.create_options_package(%s, %L::jsonb, current_date, null)',
    (select job_id from qt_draw),
    (select jsonb_build_array(
       jsonb_build_object('lot_id', lot_id, 'option_id', option_id, 'unit_no', 1),
       jsonb_build_object('lot_id', lot_id, 'option_id', option_id, 'unit_no', 3)
     )::text from qt_draw)
  )
);
insert into qt_out
select 'unit 2 after draw', pg_temp.run_as(
  (select admin_id from qt_ctx),
  format(
    'select valtrim.create_options_package(%s, %L::jsonb, current_date, null)',
    (select job_id from qt_draw),
    (select jsonb_build_array(jsonb_build_object('lot_id', lot_id, 'option_id', option_id, 'unit_no', 2))::text from qt_draw)
  )
);

select pg_temp.check_that(
  'the units a Draw Package left are billed in an Options Package, and the one it billed is not',
  (select outcome from qt_out where name = 'options package after draw') like 'ok:%'
  and (select outcome like 'err:23505:%already billed%' from qt_out where name = 'unit 2 after draw'),
  (select outcome from qt_out where name = 'options package after draw')
    || ' | ' || (select outcome from qt_out where name = 'unit 2 after draw')
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
    'unit test'
  )
);

select pg_temp.check_that(
  'a price that moved on a Draft Package is applied to the billed unit',
  (select package_id is not null from qt_draw)
  and (select outcome like 'ok:%' from qt_out where name = 'apply price')
  and (
    select line.options_amount = draw.unit_price + 10
    from valtrim.package_draws line, qt_draw draw
    where line.package_id = draw.package_id and line.lot_id = draw.lot_id
  ),
  (select 'new price: ' || (select outcome from qt_out where name = 'new price')
     || ' | apply: ' || (select outcome from qt_out where name = 'apply price'))
);

select step, name, ok, detail from qt_results order by step;

rollback;
