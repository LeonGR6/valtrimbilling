-- Putting free Options back on an invoiced Draw Package against the real database, inside a transaction that is
-- rolled back. Run it after the migration 20261216120000; every row of the last result must have ok = true.
--
-- It takes a real Package that waits for payment and has Options, gives one of its Lots two new Option units (so
-- there is something free to put back) and checks that:
--   * only the service role can run the edit (the new nine-argument function), and the old one is gone,
--   * a dry run that adds units shows the new total and changes nothing,
--   * a unit the Package already bills, one another Package bills, one that does not exist, one of a Lot of another
--     Job, one released in the same edit, a repeated one and a badly formed one are all refused,
--   * a unit of a Lot whose cells do not reach the Options billing Draw is refused,
--   * a real edit that releases one unit and adds two puts the new units on the cell that carries the Options, prices
--     them like a new cell, keeps every other unit, keeps the invoice total equal to its lines, removes the Release,
--     leaves the QuickBooks number alone and writes "added_options" in the correction history,
--   * after QuickBooks is told, the released unit can be put back with its own price, and the invoice comes back to what
--     it was before it was released.

begin;

create temporary table qt_results (
  step serial primary key,
  name text not null,
  ok boolean not null,
  detail text
) on commit drop;

create temporary table qt_ctx (
  actor uuid,
  stranger uuid,
  pkg bigint,
  job bigint,
  package_date date,
  options_draw smallint,
  anchor_lot bigint,
  anchor_draw smallint,
  opt_lot bigint,
  opt_option bigint,
  opt_unit integer,
  opt_price numeric,
  fresh_lot bigint,
  fresh_option bigint,
  fresh_price numeric,
  foreign_lot bigint,
  foreign_option bigint,
  foreign_unit integer,
  natural_lot bigint,
  natural_option bigint,
  natural_unit integer,
  gross_before numeric,
  retention_before numeric,
  wrap_before numeric,
  net_before numeric,
  cells_before integer,
  opts_before integer,
  edits_before integer,
  number_before text
) on commit drop;

create temporary table qt_out (name text primary key, outcome text) on commit drop;

create function pg_temp.attempt(p_sql text)
returns text
language plpgsql
as $$
declare
  v_result text;
begin
  execute p_sql into v_result;
  return 'ok:' || coalesce(v_result, '');
exception when others then
  return 'err:' || sqlstate || ':' || sqlerrm;
end;
$$;

create function pg_temp.check_that(p_name text, p_ok boolean, p_detail text default null)
returns void
language sql
as $$
  insert into qt_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
$$;

create function pg_temp.lines_net(p_package bigint)
returns numeric
language sql
as $$
  select coalesce((select sum(net_amount) from valtrim.package_draws where package_id = p_package), 0)
       + coalesce((select sum(net_amount) from valtrim.package_hardware_lines where package_id = p_package), 0);
$$;

-- The Package under test -----------------------------------------------------------------------------------------

insert into qt_ctx (actor, stranger, pkg)
select
  (select id from valtrim.app_users
   where is_active and role::text in ('ADMIN', 'ACCOUNTING', 'DRAW_INVOICE')
   order by created_at limit 1),
  gen_random_uuid(),
  (select package.id
   from valtrim.draw_packages package
   join valtrim.invoices invoice on invoice.package_id = package.id and invoice.paid_amount = 0
   join valtrim.quickbooks_invoice_syncs sync
     on sync.package_id = package.id and sync.status = 'CREATED' and not sync.update_pending
   join valtrim.billing_setup_versions version on version.id = package.setup_version_id
   where package.package_type = 'DRAW' and package.status = 'DRAFT'
     and package.workflow_status = 'AWAITING_PAYMENT' and package.quickbooks_status = 'CREATED'
     and version.options_billing_draw_number is not null
     and exists (select 1 from valtrim.package_options o where o.package_id = package.id)
     and not exists (select 1 from valtrim.price_adjustment_lines l where l.package_id = package.id)
     and not exists (select 1 from valtrim.package_price_differences x where x.package_id = package.id)
     -- A Lot of the Package that can get a new Option, in a cell at or after the Options billing Draw.
     and exists (
       select 1
       from valtrim.package_draws d
       join valtrim.lots lot on lot.id = d.lot_id and not lot.is_utility_building
       where d.package_id = package.id
         and d.draw_number >= version.options_billing_draw_number
     )
   order by (select count(*) from valtrim.package_draws d where d.package_id = package.id), package.id
   limit 1);

update qt_ctx set
  job = (select job_id from valtrim.draw_packages where id = qt_ctx.pkg),
  package_date = (select package_date from valtrim.draw_packages where id = qt_ctx.pkg),
  options_draw = (
    select version.options_billing_draw_number
    from valtrim.draw_packages package
    join valtrim.billing_setup_versions version on version.id = package.setup_version_id
    where package.id = qt_ctx.pkg),
  gross_before = (select gross_amount from valtrim.invoices where package_id = qt_ctx.pkg),
  retention_before = (select retention_amount from valtrim.invoices where package_id = qt_ctx.pkg),
  wrap_before = (select wrap_amount from valtrim.invoices where package_id = qt_ctx.pkg),
  net_before = (select net_amount from valtrim.invoices where package_id = qt_ctx.pkg),
  cells_before = (select count(*) from valtrim.package_draws where package_id = qt_ctx.pkg),
  opts_before = (select count(*) from valtrim.package_options where package_id = qt_ctx.pkg),
  edits_before = (select count(*) from valtrim.draw_package_corrections where package_id = qt_ctx.pkg and action = 'EDIT_INVOICED'),
  number_before = (select invoice_number from valtrim.quickbooks_invoice_syncs where package_id = qt_ctx.pkg);

-- The cell that carries the Options, by the rule the edit uses: the first one by Draw and Lot.
update qt_ctx set
  anchor_lot = (
    select d.lot_id from valtrim.package_draws d
    where d.package_id = qt_ctx.pkg
      and exists (select 1 from valtrim.package_options o
                  where o.package_id = d.package_id and o.billing_lot_id = d.lot_id and o.draw_id = d.draw_id)
    order by (select is_utility_building from valtrim.lots where id = d.lot_id), d.draw_number, d.lot_id limit 1),
  anchor_draw = (
    select d.draw_number from valtrim.package_draws d
    where d.package_id = qt_ctx.pkg
      and exists (select 1 from valtrim.package_options o
                  where o.package_id = d.package_id and o.billing_lot_id = d.lot_id and o.draw_id = d.draw_id)
    order by (select is_utility_building from valtrim.lots where id = d.lot_id), d.draw_number, d.lot_id limit 1),
  opt_lot = (select lot_id from valtrim.package_options where package_id = qt_ctx.pkg order by lot_id, option_id, unit_no limit 1),
  opt_option = (select option_id from valtrim.package_options where package_id = qt_ctx.pkg order by lot_id, option_id, unit_no limit 1),
  opt_unit = (select unit_no from valtrim.package_options where package_id = qt_ctx.pkg order by lot_id, option_id, unit_no limit 1),
  opt_price = (select option_price from valtrim.package_options where package_id = qt_ctx.pkg order by lot_id, option_id, unit_no limit 1);

-- The Lot that gets a new Option: the first one by Draw, in a cell at or after the Options billing Draw.
update qt_ctx set
  fresh_lot = (
    select lot.id
    from valtrim.package_draws d
    join valtrim.lots lot on lot.id = d.lot_id and not lot.is_utility_building
    where d.package_id = qt_ctx.pkg
      and d.draw_number >= qt_ctx.options_draw
    order by d.draw_number, lot.id
    limit 1
  );

update qt_ctx set
  -- A unit another Package of the same Job bills.
  foreign_lot = (
    select o.lot_id from valtrim.package_options o
    join valtrim.draw_packages p on p.id = o.package_id
    where p.job_id = qt_ctx.job and o.package_id <> qt_ctx.pkg
    order by o.package_id, o.lot_id, o.option_id, o.unit_no limit 1),
  foreign_option = (
    select o.option_id from valtrim.package_options o
    join valtrim.draw_packages p on p.id = o.package_id
    where p.job_id = qt_ctx.job and o.package_id <> qt_ctx.pkg
    order by o.package_id, o.lot_id, o.option_id, o.unit_no limit 1),
  foreign_unit = (
    select o.unit_no from valtrim.package_options o
    join valtrim.draw_packages p on p.id = o.package_id
    where p.job_id = qt_ctx.job and o.package_id <> qt_ctx.pkg
    order by o.package_id, o.lot_id, o.option_id, o.unit_no limit 1);

-- A unit that is free in the real data (selected on a Lot of the Package, billed by no Package), when there is one.
update qt_ctx set
  (natural_lot, natural_option, natural_unit) = (
    select selected.lot_id, selected.option_id, unit.no
    from valtrim.lot_options selected
    cross join lateral generate_series(1, selected.quantity) as unit(no)
    where exists (
        select 1 from valtrim.package_draws d
        where d.package_id = qt_ctx.pkg and d.lot_id = selected.lot_id and d.draw_number >= qt_ctx.options_draw)
      and not exists (
        select 1 from valtrim.package_options o
        where o.lot_id = selected.lot_id and o.option_id = selected.option_id and o.unit_no = unit.no)
      and (selected.lot_id, selected.option_id) is distinct from (qt_ctx.fresh_lot, qt_ctx.fresh_option)
    order by selected.lot_id, selected.option_id, unit.no
    limit 1
  );

-- A new Option of the Plan of that Lot, priced since 2000, with two units on the Lot (for this test only).
with new_option as (
  insert into valtrim.plan_options (plan_id, code, name, is_active)
  select lot.plan_id, 'VALIDATION-ADD-BACK', 'Validation Option', true
  from valtrim.lots lot where lot.id = (select fresh_lot from qt_ctx)
  returning id
), new_price as (
  insert into valtrim.option_prices (option_id, price, effective_from, is_not_applicable)
  select id, 1000, date '2000-01-01', false from new_option
  returning option_id
)
update qt_ctx set fresh_option = (select option_id from new_price), fresh_price = 1000;

insert into valtrim.lot_options (lot_id, plan_id, option_id, quantity)
select fresh_lot, (select plan_id from valtrim.lots where id = fresh_lot), fresh_option, 2
from qt_ctx;

select pg_temp.check_that(
  'A real unpaid Package with Options and a Lot that can get a new Option was found to test with',
  (select pkg is not null and actor is not null and anchor_lot is not null and opt_lot is not null
      and fresh_lot is not null and fresh_price is not null from qt_ctx),
  (select format('package %s, %s cells, %s options, options draw %s, carried by Lot %s Draw %s, fresh Option %s on Lot %s at %s',
     pkg, cells_before, opts_before, options_draw, anchor_lot, anchor_draw, fresh_option, fresh_lot, fresh_price) from qt_ctx)
);

-- Who can run it ----------------------------------------------------------------------------------------------------

select pg_temp.check_that(
  'Only the service role can run the nine-argument edit, and the eight-argument one is gone',
  not has_function_privilege('authenticated', 'valtrim.edit_invoiced_draw_package(uuid,bigint,jsonb,jsonb,jsonb,text,text,boolean,jsonb)', 'execute')
  and not has_function_privilege('anon', 'valtrim.edit_invoiced_draw_package(uuid,bigint,jsonb,jsonb,jsonb,text,text,boolean,jsonb)', 'execute')
  and has_function_privilege('service_role', 'valtrim.edit_invoiced_draw_package(uuid,bigint,jsonb,jsonb,jsonb,text,text,boolean,jsonb)', 'execute')
  and to_regprocedure('valtrim.edit_invoiced_draw_package(uuid,bigint,jsonb,jsonb,jsonb,text,text,boolean)') is null
  and not has_function_privilege('authenticated', 'private.regenerate_package_option_cell(bigint,bigint,bigint,smallint,jsonb)', 'execute'),
  null
);

-- The current lines, as the edit receives them ----------------------------------------------------------------------

create temporary table qt_lines (name text primary key, body jsonb not null) on commit drop;

insert into qt_lines
select 'cells', coalesce(jsonb_agg(jsonb_build_object('lot_id', d.lot_id, 'draw_number', d.draw_number)
  order by d.phase_id, d.draw_number, d.lot_id), '[]')
from valtrim.package_draws d, qt_ctx where d.package_id = qt_ctx.pkg;

insert into qt_lines
select 'cells_before_options_draw', coalesce(jsonb_agg(jsonb_build_object('lot_id', d.lot_id, 'draw_number', d.draw_number)
  order by d.phase_id, d.draw_number, d.lot_id), '[]')
from valtrim.package_draws d, qt_ctx
where d.package_id = qt_ctx.pkg and d.draw_number < qt_ctx.options_draw;

insert into qt_lines
select 'hardware', coalesce(jsonb_agg(jsonb_build_object('lot_id', h.lot_id, 'event_type', h.hardware_event_type::text)
  order by h.id), '[]')
from valtrim.package_hardware_lines h, qt_ctx where h.package_id = qt_ctx.pkg;

insert into qt_lines
select 'released_opt', jsonb_build_array(jsonb_build_object('lot_id', opt_lot, 'option_id', opt_option, 'unit_no', opt_unit))
from qt_ctx;

insert into qt_lines
select 'fresh_two', jsonb_build_array(
  jsonb_build_object('lot_id', fresh_lot, 'option_id', fresh_option, 'unit_no', 1),
  jsonb_build_object('lot_id', fresh_lot, 'option_id', fresh_option, 'unit_no', 2))
from qt_ctx;

insert into qt_lines
select 'fresh_one', jsonb_build_array(jsonb_build_object('lot_id', fresh_lot, 'option_id', fresh_option, 'unit_no', 1))
from qt_ctx;

-- p_released and p_added are the names of rows of qt_lines ('none' for an empty list), or a literal JSON text.
create function pg_temp.body(p_name text)
returns jsonb
language sql
as $$
  select case
    when p_name = 'none' then '[]'::jsonb
    when left(p_name, 1) in ('[', '{') then p_name::jsonb
    else (select body from qt_lines where name = p_name)
  end;
$$;

create function pg_temp.edit(p_cells text, p_released text, p_added text, p_dry boolean)
returns text
language sql
as $$
  select pg_temp.attempt(format(
    'select valtrim.edit_invoiced_draw_package(%L, %s, %L::jsonb, %L::jsonb, %L::jsonb, ''validation'', %L, %s, %L::jsonb)::text',
    (select actor from qt_ctx),
    (select pkg from qt_ctx),
    pg_temp.body(p_cells),
    (select body from qt_lines where name = 'hardware'),
    pg_temp.body(p_released),
    (select notes from valtrim.draw_packages where id = (select pkg from qt_ctx)),
    case when p_dry then 'true' else 'false' end,
    pg_temp.body(p_added)
  ));
$$;

create function pg_temp.field(p_name text, p_path text[])
returns numeric
language sql
as $$
  select (substr(outcome, 4)::jsonb #>> p_path)::numeric from qt_out where name = p_name and outcome like 'ok:%';
$$;

-- A dry run changes nothing --------------------------------------------------------------------------------------------

insert into qt_out values ('dry add', pg_temp.edit('cells', 'none', 'fresh_two', true));
select pg_temp.check_that(
  'A dry run that adds two units shows two Options more, a bigger total and the price of the Option on each',
  (select outcome like 'ok:%'
      and pg_temp.field('dry add', array['next', 'options']) = pg_temp.field('dry add', array['previous', 'options']) + 2
      and pg_temp.field('dry add', array['next', 'cells']) = cells_before
      and pg_temp.field('dry add', array['next', 'gross']) = pg_temp.field('dry add', array['previous', 'gross']) + 2 * fresh_price
      and jsonb_array_length(substr(outcome, 4)::jsonb -> 'added_options') = 2
      and (select bool_and((added ->> 'option_price')::numeric = fresh_price)
           from jsonb_array_elements(substr(outcome, 4)::jsonb -> 'added_options') added)
   from qt_out, qt_ctx where qt_out.name = 'dry add'),
  (select outcome from qt_out where name = 'dry add')
);

select pg_temp.check_that(
  'The dry run left everything as it was: cells, Options, total and the QuickBooks mark',
  (select (select count(*) from valtrim.package_draws where package_id = pkg) = cells_before
      and (select count(*) from valtrim.package_options where package_id = pkg) = opts_before
      and (select net_amount from valtrim.invoices where package_id = pkg) = net_before
      and not exists (select 1 from valtrim.package_options where lot_id = fresh_lot and option_id = fresh_option)
      and not (select update_pending from valtrim.quickbooks_invoice_syncs where package_id = pkg)
      and (select count(*) from valtrim.draw_package_corrections where package_id = pkg and action = 'EDIT_INVOICED') = edits_before
   from qt_ctx),
  null
);

-- A unit that is free in the real data --------------------------------------------------------------------------------

insert into qt_out
select 'natural', pg_temp.edit('cells', 'none',
  format('[{"lot_id": %s, "option_id": %s, "unit_no": %s}]', natural_lot, natural_option, natural_unit), true)
from qt_ctx where natural_lot is not null;
select pg_temp.check_that(
  'A unit that no Package bills, on a Lot of this Package, can be added (dry run)',
  (select outcome like 'ok:%'
      and pg_temp.field('natural', array['next', 'options']) = opts_before + 1
      and pg_temp.field('natural', array['next', 'gross']) > pg_temp.field('natural', array['previous', 'gross'])
   from qt_out, qt_ctx where qt_out.name = 'natural')
  or (select natural_lot is null from qt_ctx),
  coalesce((select outcome from qt_out where name = 'natural'), 'skipped: no Option of this Package is free')
);

-- What is refused ------------------------------------------------------------------------------------------------------

insert into qt_out values ('same unit', pg_temp.edit('cells', 'none', 'released_opt', true));
select pg_temp.check_that(
  'A unit the Package already bills cannot be added',
  (select outcome like 'err:23505:%already billed%' from qt_out where name = 'same unit'),
  (select outcome from qt_out where name = 'same unit')
);

insert into qt_out
select 'foreign unit', pg_temp.edit('cells', 'none',
  format('[{"lot_id": %s, "option_id": %s, "unit_no": %s}]', foreign_lot, foreign_option, foreign_unit), true)
from qt_ctx where foreign_lot is not null;
select pg_temp.check_that(
  'A unit that another Package of the Job bills cannot be taken',
  (select outcome like 'err:23505:%already billed%' from qt_out where name = 'foreign unit')
  or (select foreign_lot is null from qt_ctx),
  coalesce((select outcome from qt_out where name = 'foreign unit'), 'skipped: no other Package of the Job bills an Option')
);

insert into qt_out
select 'unit beyond quantity', pg_temp.edit('cells', 'none',
  format('[{"lot_id": %s, "option_id": %s, "unit_no": 3}]', fresh_lot, fresh_option), true)
from qt_ctx;
select pg_temp.check_that(
  'A unit the Lot does not have (the Option has two) is refused',
  (select outcome like 'err:23503:%active Lot%' from qt_out where name = 'unit beyond quantity'),
  (select outcome from qt_out where name = 'unit beyond quantity')
);

insert into qt_out
select 'other job', pg_temp.edit('cells', 'none',
  format('[{"lot_id": %s, "option_id": %s, "unit_no": 1}]',
    (select lot.id from valtrim.lots lot
     join valtrim.phases phase on phase.id = lot.phase_id and phase.job_id <> qt_ctx.job
     join valtrim.lot_options lo on lo.lot_id = lot.id
     order by lot.id limit 1),
    (select lo.option_id from valtrim.lots lot
     join valtrim.phases phase on phase.id = lot.phase_id and phase.job_id <> qt_ctx.job
     join valtrim.lot_options lo on lo.lot_id = lot.id
     order by lot.id limit 1)), true)
from qt_ctx;
select pg_temp.check_that(
  'An Option of a Lot of another Job is refused',
  (select outcome like 'err:23503:%active Lot in this Job%' from qt_out where name = 'other job'),
  (select outcome from qt_out where name = 'other job')
);

insert into qt_out values ('released and added', pg_temp.edit('cells', 'released_opt', 'released_opt', true));
select pg_temp.check_that(
  'A unit cannot be released and added in the same edit',
  (select outcome like 'err:23514:%released and added%' from qt_out where name = 'released and added'),
  (select outcome from qt_out where name = 'released and added')
);

insert into qt_out
select 'repeated', pg_temp.edit('cells', 'none',
  (select (body || body)::text from qt_lines where name = 'fresh_one'), true);
select pg_temp.check_that(
  'The same unit twice in one request is refused',
  (select outcome like 'err:23514:%must be unique%' from qt_out where name = 'repeated'),
  (select outcome from qt_out where name = 'repeated')
);

insert into qt_out
select 'bad unit', pg_temp.edit('cells', 'none',
  format('[{"lot_id": %s, "option_id": %s, "unit_no": 0}]', fresh_lot, fresh_option), true)
from qt_ctx;
insert into qt_out
select 'not a list', pg_temp.edit('cells', 'none', '{"lot_id": 1}', true);
select pg_temp.check_that(
  'A unit number of 0, or a request that is not a list, is refused',
  (select outcome like 'err:23514:%valid Lot, Option and unit%' from qt_out where name = 'bad unit')
  and (select outcome like 'err:23514:%JSON arrays%' from qt_out where name = 'not a list'),
  (select (select outcome from qt_out where name = 'bad unit') || ' / ' || (select outcome from qt_out where name = 'not a list'))
);

insert into qt_out
select 'not reached', pg_temp.edit('cells_before_options_draw', 'none', 'fresh_one', true)
where (select jsonb_array_length(body) from qt_lines where name = 'cells_before_options_draw') > 0
  and not exists (
    select 1 from valtrim.package_draws prior_line
    join valtrim.draw_packages prior_package on prior_package.id = prior_line.package_id
      and prior_package.job_id = (select job from qt_ctx) and prior_package.id <> (select pkg from qt_ctx)
    join valtrim.billing_setup_versions prior_version on prior_version.id = prior_line.setup_version_id
    where prior_line.lot_id = (select fresh_lot from qt_ctx)
      and prior_line.draw_number >= prior_version.options_billing_draw_number);
select pg_temp.check_that(
  'A Lot whose cells stay before the Options billing Draw cannot get Options',
  (select outcome like 'err:23514:%reached or passed the Options billing Draw%' from qt_out where name = 'not reached')
  or not exists (select 1 from qt_out where name = 'not reached'),
  coalesce((select outcome from qt_out where name = 'not reached'), 'skipped: the Package has no cell before the Options billing Draw')
);

-- The real edit: one unit released, two added ---------------------------------------------------------------------------

insert into qt_out values ('real', pg_temp.edit('cells', 'released_opt', 'fresh_two', false));
select pg_temp.check_that(
  'The edit goes through',
  (select outcome like 'ok:%' from qt_out where name = 'real'),
  (select outcome from qt_out where name = 'real')
);

select pg_temp.check_that(
  'The two new units ride on the cell that carried the Options, priced like a new cell, and the unit released is free',
  (select (select count(*) from valtrim.package_options
           where package_id = pkg and lot_id = fresh_lot and option_id = fresh_option
             and billing_lot_id = anchor_lot
             and draw_id = (select id from valtrim.billing_draws draw
                            where draw.draw_number = anchor_draw
                              and draw.setup_version_id = (select setup_version_id from valtrim.draw_packages where id = pkg))
             and option_price = fresh_price) = 2
      and (select count(*) from valtrim.package_options where package_id = pkg) = opts_before - 1 + 2
      and not exists (select 1 from valtrim.package_options where lot_id = opt_lot and option_id = opt_option and unit_no = opt_unit)
   from qt_ctx),
  (select format('%s Options now', (select count(*) from valtrim.package_options where package_id = pkg)) from qt_ctx)
);

select pg_temp.check_that(
  'Every other unit of the cell was kept, and the Options of every cell add up to what its line bills',
  (select (select count(*) from valtrim.package_options o
           where o.package_id = pkg
             and not (o.lot_id = fresh_lot and o.option_id = fresh_option)) = opts_before - 1
      and (select coalesce(sum(option_price), 0) from valtrim.package_options where package_id = pkg)
        = (select coalesce(sum(options_amount), 0) from valtrim.package_draws where package_id = pkg)
   from qt_ctx),
  null
);

select pg_temp.check_that(
  'The gross follows the Options (minus the released one, plus the two new), and the net follows the lines',
  (select (select gross_amount from valtrim.invoices where package_id = pkg)
          = gross_before - opt_price + 2 * fresh_price
      and (select net_amount from valtrim.invoices where package_id = pkg) = pg_temp.lines_net(pkg)
      and (select net_amount from valtrim.invoices where package_id = pkg) = pg_temp.field('real', array['next', 'net'])
   from qt_ctx),
  (select format('gross %s -> %s', gross_before, (select gross_amount from valtrim.invoices where package_id = pkg)) from qt_ctx)
);

select pg_temp.check_that(
  'Retention and wrap follow the lines, and the net is the gross less both',
  (select invoice.retention_amount = coalesce((select sum(retention_amount) from valtrim.package_draws where package_id = pkg), 0)
      and invoice.wrap_amount = coalesce((select sum(wrap_amount) from valtrim.package_draws where package_id = pkg), 0)
      and invoice.net_amount = invoice.gross_amount - invoice.retention_amount - invoice.wrap_amount
   from qt_ctx join valtrim.invoices invoice on invoice.package_id = qt_ctx.pkg),
  (select format('retention %s -> %s, wrap %s -> %s', retention_before, invoice.retention_amount, wrap_before, invoice.wrap_amount)
   from qt_ctx join valtrim.invoices invoice on invoice.package_id = qt_ctx.pkg)
);

select pg_temp.check_that(
  'The answer and the correction history list what was added and what was released',
  (select jsonb_array_length(substr(outcome, 4)::jsonb -> 'added_options') = 2
      and jsonb_array_length(substr(outcome, 4)::jsonb -> 'released_options') = 1
      and (select jsonb_array_length(next_details -> 'added_options') = 2
             and jsonb_array_length(next_details -> 'released_options') = 1
           from valtrim.draw_package_corrections
           where package_id = (select pkg from qt_ctx) and action = 'EDIT_INVOICED' and reason = 'validation')
   from qt_out where name = 'real'),
  (select outcome from qt_out where name = 'real')
);

select pg_temp.check_that(
  'The QuickBooks number did not move, the invoice waits for QuickBooks and no Release or Payment Schedule is left',
  (select sync.invoice_number = number_before
      and sync.update_pending and sync.update_error is null and sync.status = 'CREATED'
      and package.workflow_status = 'AWAITING_PAYMENT' and package.quickbooks_status = 'CREATED'
      and (select count(*) from valtrim.package_documents
           where package_id = pkg and document_type::text in ('RELEASE', 'PAYMENT_SCHEDULE') and file_id is not null) = 0
   from qt_ctx
   join valtrim.quickbooks_invoice_syncs sync on sync.package_id = qt_ctx.pkg
   join valtrim.draw_packages package on package.id = qt_ctx.pkg),
  null
);

-- A second edit waits for QuickBooks ------------------------------------------------------------------------------------

insert into qt_out values ('second', pg_temp.edit('cells', 'none', 'none', true));
select pg_temp.check_that(
  'A second edit is refused while the first has not reached QuickBooks',
  (select outcome like 'err:23514:%has not reached QuickBooks%' from qt_out where name = 'second'),
  (select outcome from qt_out where name = 'second')
);

insert into qt_out
select 'complete', pg_temp.attempt(format(
  'select valtrim.complete_quickbooks_invoice_update(%s, ''tok-2'', %s, ''{"TxnDate":"2026-01-02"}''::jsonb)::text',
  pkg, (select net_amount from valtrim.invoices where package_id = qt_ctx.pkg))) from qt_ctx;
select pg_temp.check_that(
  'Telling QuickBooks clears the mark',
  (select outcome = 'ok:true' from qt_out where name = 'complete')
  and (select not update_pending from valtrim.quickbooks_invoice_syncs where package_id = (select pkg from qt_ctx)),
  (select outcome from qt_out where name = 'complete')
);

-- The released unit goes back ---------------------------------------------------------------------------------------------

insert into qt_out values ('put back', pg_temp.edit('cells', 'none', 'released_opt', false));
select pg_temp.check_that(
  'The unit that was released goes back with its own price, and the Package bills what it did plus the two new units',
  (select outcome like 'ok:%'
      and exists (
        select 1 from valtrim.package_options
        where package_id = pkg and lot_id = opt_lot and option_id = opt_option and unit_no = opt_unit
          and option_price = opt_price and billing_lot_id = anchor_lot)
      and (select count(*) from valtrim.package_options where package_id = pkg) = opts_before + 2
      and (select gross_amount from valtrim.invoices where package_id = pkg) = gross_before + 2 * fresh_price
      and (select net_amount from valtrim.invoices where package_id = pkg) = pg_temp.lines_net(pkg)
      and (select coalesce(sum(option_price), 0) from valtrim.package_options where package_id = pkg)
        = (select coalesce(sum(options_amount), 0) from valtrim.package_draws where package_id = pkg)
   from qt_out, qt_ctx where qt_out.name = 'put back'),
  (select outcome from qt_out where name = 'put back')
);

-- Putting back what the Package already bills is a no-change edit, and a paid invoice stops it ---------------------------

insert into qt_out
select 'complete again', pg_temp.attempt(format(
  'select valtrim.complete_quickbooks_invoice_update(%s, ''tok-3'', %s, ''{"TxnDate":"2026-01-02"}''::jsonb)::text',
  pkg, (select net_amount from valtrim.invoices where package_id = qt_ctx.pkg))) from qt_ctx;

insert into qt_out values ('nothing to add', pg_temp.edit('cells', 'none', 'none', true));
select pg_temp.check_that(
  'An edit with no Options to add and nothing else changed is still refused as no change',
  (select outcome like 'err:23514:%no changes%' from qt_out where name = 'nothing to add'),
  (select outcome from qt_out where name = 'nothing to add')
);

update valtrim.quickbooks_invoice_syncs set qbo_state = 'PAID' where package_id = (select pkg from qt_ctx);
insert into qt_out values ('paid', pg_temp.edit('cells', 'none', 'fresh_one', true));
select pg_temp.check_that(
  'An invoice that QuickBooks shows as paid cannot get Options either',
  (select outcome like 'err:23514:%payment or credit%' from qt_out where name = 'paid'),
  (select outcome from qt_out where name = 'paid')
);

select step, name, ok, detail from qt_results order by step;

rollback;
