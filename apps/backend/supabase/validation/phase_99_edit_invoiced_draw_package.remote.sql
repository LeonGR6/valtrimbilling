-- Editing an invoiced Draw Package against the real database, inside a transaction that is rolled back. Run it
-- after the migration 20261214120000; every row of the last result must have ok = true.
--
-- It takes a real Package that waits for payment and has Options and Separate Hardware, and checks that:
--   * only the service role can run the edit, and the line guards still refuse a direct delete,
--   * a dry run changes nothing, and a Package with no change, a paid one or a stranger is refused,
--   * a cell, a Separate Hardware line and a single Option can be taken off the Package (real run), the invoice
--     total follows the lines, the Release is removed, the QuickBooks number does not move and the invoice is
--     marked as waiting for QuickBooks,
--   * a second edit waits until QuickBooks is told, and telling it clears the mark,
--   * what was freed can be put back (the total comes back to the original), and what another Package holds cannot.

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
  other_pkg bigint,
  plain_lot bigint,
  plain_draw smallint,
  hw_lot bigint,
  hw_event text,
  opt_lot bigint,
  opt_option bigint,
  opt_unit integer,
  net_before numeric,
  cells_before integer,
  hw_before integer,
  opts_before integer,
  docs_before integer,
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

-- The Package under test and the pieces taken off it ------------------------------------------------------------

insert into qt_ctx (actor, stranger, pkg, other_pkg)
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
   where package.package_type = 'DRAW' and package.status = 'DRAFT'
     and package.workflow_status = 'AWAITING_PAYMENT' and package.quickbooks_status = 'CREATED'
     and exists (select 1 from valtrim.package_options o where o.package_id = package.id)
     and exists (select 1 from valtrim.package_hardware_lines h where h.package_id = package.id)
     and exists (
       select 1 from valtrim.package_draws d
       where d.package_id = package.id
         and not exists (
           select 1 from valtrim.package_options o
           where o.package_id = d.package_id and o.billing_lot_id = d.lot_id and o.draw_id = d.draw_id
         )
     )
     and not exists (select 1 from valtrim.price_adjustment_lines l where l.package_id = package.id)
   order by (select count(*) from valtrim.package_draws d where d.package_id = package.id), package.id
   limit 1),
  null;

update qt_ctx set
  other_pkg = (
    select package.id from valtrim.draw_packages package
    where package.id <> qt_ctx.pkg and package.status <> 'VOIDED'
      and package.job_id = (select job_id from valtrim.draw_packages where id = qt_ctx.pkg)
      and exists (select 1 from valtrim.package_draws d where d.package_id = package.id)
    order by package.id limit 1
  ),
  plain_lot = (
    select d.lot_id from valtrim.package_draws d
    where d.package_id = qt_ctx.pkg
      and not exists (
        select 1 from valtrim.package_options o
        where o.package_id = d.package_id and o.billing_lot_id = d.lot_id and o.draw_id = d.draw_id
      )
    order by d.draw_number desc, d.lot_id limit 1
  ),
  plain_draw = (
    select d.draw_number from valtrim.package_draws d
    where d.package_id = qt_ctx.pkg
      and not exists (
        select 1 from valtrim.package_options o
        where o.package_id = d.package_id and o.billing_lot_id = d.lot_id and o.draw_id = d.draw_id
      )
    order by d.draw_number desc, d.lot_id limit 1
  ),
  hw_lot = (select lot_id from valtrim.package_hardware_lines where package_id = qt_ctx.pkg order by id limit 1),
  hw_event = (select hardware_event_type::text from valtrim.package_hardware_lines where package_id = qt_ctx.pkg order by id limit 1),
  opt_lot = (select lot_id from valtrim.package_options where package_id = qt_ctx.pkg order by lot_id, option_id, unit_no limit 1),
  opt_option = (select option_id from valtrim.package_options where package_id = qt_ctx.pkg order by lot_id, option_id, unit_no limit 1),
  opt_unit = (select unit_no from valtrim.package_options where package_id = qt_ctx.pkg order by lot_id, option_id, unit_no limit 1),
  net_before = (select net_amount from valtrim.invoices where package_id = qt_ctx.pkg),
  cells_before = (select count(*) from valtrim.package_draws where package_id = qt_ctx.pkg),
  hw_before = (select count(*) from valtrim.package_hardware_lines where package_id = qt_ctx.pkg),
  opts_before = (select count(*) from valtrim.package_options where package_id = qt_ctx.pkg),
  docs_before = (
    select count(*) from valtrim.package_documents
    where package_id = qt_ctx.pkg and document_type::text in ('RELEASE', 'PAYMENT_SCHEDULE') and file_id is not null
  ),
  number_before = (select invoice_number from valtrim.quickbooks_invoice_syncs where package_id = qt_ctx.pkg);

select pg_temp.check_that(
  'A real unpaid Package with Options and Separate Hardware was found to test with',
  (select pkg is not null and actor is not null and plain_lot is not null and hw_lot is not null and opt_lot is not null from qt_ctx),
  (select format('package %s, %s cells, %s hardware, %s options', pkg, cells_before, hw_before, opts_before) from qt_ctx)
);

-- Who can run it ----------------------------------------------------------------------------------------------

select pg_temp.check_that(
  'Only the service role can edit an invoiced Package or tell QuickBooks about it',
  not has_function_privilege('authenticated', 'valtrim.edit_invoiced_draw_package(uuid,bigint,jsonb,jsonb,jsonb,text,text,boolean)', 'execute')
  and not has_function_privilege('anon', 'valtrim.edit_invoiced_draw_package(uuid,bigint,jsonb,jsonb,jsonb,text,text,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'valtrim.complete_quickbooks_invoice_update(bigint,text,numeric,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'valtrim.fail_quickbooks_invoice_update(bigint,text,boolean)', 'execute')
  and has_function_privilege('service_role', 'valtrim.edit_invoiced_draw_package(uuid,bigint,jsonb,jsonb,jsonb,text,text,boolean)', 'execute')
  and has_function_privilege('service_role', 'valtrim.complete_quickbooks_invoice_update(bigint,text,numeric,jsonb)', 'execute')
  and has_function_privilege('service_role', 'valtrim.fail_quickbooks_invoice_update(bigint,text,boolean)', 'execute'),
  null
);

insert into qt_out
select 'direct delete', pg_temp.attempt(format(
  'delete from valtrim.package_draws where package_id = %s and lot_id = %s and draw_number = %s',
  pkg, plain_lot, plain_draw)) from qt_ctx;
select pg_temp.check_that(
  'A direct delete of a line of an invoiced Package is still refused',
  (select outcome like 'err:42501:%' from qt_out where name = 'direct delete'),
  (select outcome from qt_out where name = 'direct delete')
);

-- The current lines, as the edit receives them ---------------------------------------------------------------------

create temporary table qt_lines (name text primary key, body jsonb not null) on commit drop;

insert into qt_lines
select 'cells', coalesce(jsonb_agg(jsonb_build_object('lot_id', d.lot_id, 'draw_number', d.draw_number)
  order by d.phase_id, d.draw_number, d.lot_id), '[]')
from valtrim.package_draws d, qt_ctx where d.package_id = qt_ctx.pkg;

insert into qt_lines
select 'cells_without_plain', coalesce(jsonb_agg(jsonb_build_object('lot_id', d.lot_id, 'draw_number', d.draw_number)
  order by d.phase_id, d.draw_number, d.lot_id), '[]')
from valtrim.package_draws d, qt_ctx
where d.package_id = qt_ctx.pkg and not (d.lot_id = qt_ctx.plain_lot and d.draw_number = qt_ctx.plain_draw);

insert into qt_lines
select 'hardware', coalesce(jsonb_agg(jsonb_build_object('lot_id', h.lot_id, 'event_type', h.hardware_event_type::text)
  order by h.id), '[]')
from valtrim.package_hardware_lines h, qt_ctx where h.package_id = qt_ctx.pkg;

insert into qt_lines
select 'hardware_without_one', coalesce(jsonb_agg(jsonb_build_object('lot_id', h.lot_id, 'event_type', h.hardware_event_type::text)
  order by h.id), '[]')
from valtrim.package_hardware_lines h, qt_ctx
where h.package_id = qt_ctx.pkg and not (h.lot_id = qt_ctx.hw_lot and h.hardware_event_type::text = qt_ctx.hw_event);

insert into qt_lines
select 'one_option', jsonb_build_array(jsonb_build_object('lot_id', opt_lot, 'option_id', opt_option, 'unit_no', opt_unit))
from qt_ctx;

create function pg_temp.edit(p_cells text, p_hardware text, p_options text, p_dry boolean, p_notes text default null)
returns text
language sql
as $$
  select pg_temp.attempt(format(
    'select valtrim.edit_invoiced_draw_package(%L, %s, %L::jsonb, %L::jsonb, %L::jsonb, ''validation'', %L, %s)::text',
    (select actor from qt_ctx),
    (select pkg from qt_ctx),
    (select body from qt_lines where name = p_cells),
    (select body from qt_lines where name = p_hardware),
    case p_options when 'one_option' then (select body from qt_lines where name = 'one_option') else '[]'::jsonb end,
    coalesce(p_notes, (select notes from valtrim.draw_packages where id = (select pkg from qt_ctx))),
    case when p_dry then 'true' else 'false' end
  ));
$$;

create function pg_temp.field(p_name text, p_path text[])
returns numeric
language sql
as $$
  select (substr(outcome, 4)::jsonb #>> p_path)::numeric from qt_out where name = p_name and outcome like 'ok:%';
$$;

-- No change, and a dry run that changes nothing -------------------------------------------------------------------

insert into qt_out values ('no change', pg_temp.edit('cells', 'hardware', 'none', true));
select pg_temp.check_that(
  'An edit that changes nothing is refused',
  (select outcome like 'err:23514:%no changes%' from qt_out where name = 'no change'),
  (select outcome from qt_out where name = 'no change')
);

insert into qt_out values ('dry cell', pg_temp.edit('cells_without_plain', 'hardware', 'none', true));
select pg_temp.check_that(
  'A dry run that takes one cell off shows a smaller total and one cell less',
  (select pg_temp.field('dry cell', array['next', 'net']) < pg_temp.field('dry cell', array['previous', 'net'])
      and pg_temp.field('dry cell', array['next', 'cells']) = pg_temp.field('dry cell', array['previous', 'cells']) - 1
      and pg_temp.field('dry cell', array['previous', 'net']) = net_before
   from qt_ctx),
  (select outcome from qt_out where name = 'dry cell')
);

select pg_temp.check_that(
  'The dry run left everything as it was: lines, total, Release and the QuickBooks mark',
  (select (select count(*) from valtrim.package_draws where package_id = pkg) = cells_before
      and (select count(*) from valtrim.package_hardware_lines where package_id = pkg) = hw_before
      and (select count(*) from valtrim.package_options where package_id = pkg) = opts_before
      and (select net_amount from valtrim.invoices where package_id = pkg) = net_before
      and (select count(*) from valtrim.package_documents
           where package_id = pkg and document_type::text in ('RELEASE', 'PAYMENT_SCHEDULE') and file_id is not null) = docs_before
      and not (select update_pending from valtrim.quickbooks_invoice_syncs where package_id = pkg)
      and (select count(*) from valtrim.draw_package_corrections where package_id = pkg and action = 'EDIT_INVOICED') = 0
   from qt_ctx),
  null
);

insert into qt_out values ('dry hardware', pg_temp.edit('cells', 'hardware_without_one', 'none', true));
select pg_temp.check_that(
  'A dry run that takes one Separate Hardware line off shows a smaller total and one line less',
  (select pg_temp.field('dry hardware', array['next', 'net']) < pg_temp.field('dry hardware', array['previous', 'net'])
      and pg_temp.field('dry hardware', array['next', 'hardware_lines']) = hw_before - 1
   from qt_ctx),
  (select outcome from qt_out where name = 'dry hardware')
);

insert into qt_out values ('dry option', pg_temp.edit('cells', 'hardware', 'one_option', true));
select pg_temp.check_that(
  'A dry run that releases one Option shows a smaller total, one Option less and the same cells',
  (select pg_temp.field('dry option', array['next', 'net']) < pg_temp.field('dry option', array['previous', 'net'])
      and pg_temp.field('dry option', array['next', 'options']) = opts_before - 1
      and pg_temp.field('dry option', array['next', 'cells']) = cells_before
   from qt_ctx),
  (select outcome from qt_out where name = 'dry option')
);

-- Who may call it ---------------------------------------------------------------------------------------------

select pg_temp.check_that(
  'Somebody who is not a user with a Draw & Invoice role, or nobody, cannot edit',
  (select pg_temp.attempt(format(
      'select valtrim.edit_invoiced_draw_package(%L, %s, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''x'')::text',
      stranger, pkg)) like 'err:42501:%'
      and pg_temp.attempt(format(
      'select valtrim.edit_invoiced_draw_package(null, %s, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''x'')::text',
      pkg)) like 'err:42501:%'
   from qt_ctx),
  null
);

-- What another Package holds cannot be taken ------------------------------------------------------------------------

insert into qt_lines
select 'cells_with_foreign_cell',
  (select body from qt_lines where name = 'cells') || coalesce((
    select jsonb_agg(jsonb_build_object('lot_id', d.lot_id, 'draw_number', d.draw_number))
    from (
      select d.lot_id, d.draw_number from valtrim.package_draws d
      where d.package_id = (select other_pkg from qt_ctx)
      order by d.draw_number, d.lot_id limit 1
    ) d
  ), '[]'::jsonb);

insert into qt_out values ('foreign cell', pg_temp.edit('cells_with_foreign_cell', 'hardware', 'none', true));
select pg_temp.check_that(
  'A cell that belongs to another Package cannot be added',
  (select outcome like 'err:23505:%' from qt_out where name = 'foreign cell'),
  (select outcome from qt_out where name = 'foreign cell')
);

-- The real edit: one cell, one Hardware line and one Option off, plus a new note ---------------------------------------

insert into qt_out values ('real', pg_temp.edit('cells_without_plain', 'hardware_without_one', 'one_option', false, 'Edited by the validation'));
select pg_temp.check_that(
  'The edit goes through',
  (select outcome like 'ok:%' from qt_out where name = 'real'),
  (select outcome from qt_out where name = 'real')
);

select pg_temp.check_that(
  'The invoice total follows the lines, below the total before',
  (select (select net_amount from valtrim.invoices where package_id = pkg) = pg_temp.lines_net(pkg)
      and (select net_amount from valtrim.invoices where package_id = pkg) < net_before
      and (select net_amount from valtrim.invoices where package_id = pkg)
        = pg_temp.field('real', array['next', 'net'])
   from qt_ctx),
  (select format('%s -> %s', net_before, (select net_amount from valtrim.invoices where package_id = pkg)) from qt_ctx)
);

select pg_temp.check_that(
  'The cell, the Hardware line and the Option are gone; so are the Options of the Lot that left, and the Option is free for any Package',
  (select (select count(*) from valtrim.package_draws where package_id = pkg) = cells_before - 1
      and (select count(*) from valtrim.package_hardware_lines where package_id = pkg) = hw_before - 1
      and (select count(*) from valtrim.package_options where package_id = pkg)
          = opts_before - jsonb_array_length(substr((select outcome from qt_out where name = 'real'), 4)::jsonb -> 'released_options')
      and not exists (select 1 from valtrim.package_options where package_id = pkg and lot_id = plain_lot)
      and exists (
        select 1 from jsonb_array_elements(substr((select outcome from qt_out where name = 'real'), 4)::jsonb -> 'released_options') released
        where (released ->> 'lot_id')::bigint = opt_lot and (released ->> 'option_id')::bigint = opt_option
          and (released ->> 'unit_no')::integer = opt_unit)
      and not exists (
        select 1 from valtrim.package_options
        where lot_id = opt_lot and option_id = opt_option and unit_no = opt_unit)
   from qt_ctx),
  (select substr(outcome, 4)::jsonb -> 'released_options' from qt_out where name = 'real')::text
);

select pg_temp.check_that(
  'The QuickBooks number and the Awaiting payment state did not move, and the invoice waits for QuickBooks',
  (select sync.invoice_number = number_before
      and sync.update_pending and sync.update_error is null and sync.update_request_id is not null
      and sync.status = 'CREATED'
      and package.workflow_status = 'AWAITING_PAYMENT' and package.quickbooks_status = 'CREATED'
      and package.quickbooks_reference is not null
   from qt_ctx
   join valtrim.quickbooks_invoice_syncs sync on sync.package_id = qt_ctx.pkg
   join valtrim.draw_packages package on package.id = qt_ctx.pkg),
  null
);

select pg_temp.check_that(
  'The Release and Payment Schedule were removed and the change is in the correction history with its reason',
  (select (select count(*) from valtrim.package_documents
           where package_id = pkg and document_type::text in ('RELEASE', 'PAYMENT_SCHEDULE') and file_id is not null) = 0
      and (docs_before = 0 or jsonb_array_length(substr((select outcome from qt_out where name = 'real'), 4)::jsonb -> 'removed_documents') = docs_before)
      and (select count(*) from valtrim.draw_package_corrections
           where package_id = pkg and action = 'EDIT_INVOICED' and reason = 'validation') = 1
      and (select notes from valtrim.draw_packages where id = pkg) = 'Edited by the validation'
   from qt_ctx),
  null
);

-- A second edit waits for QuickBooks ----------------------------------------------------------------------------------

insert into qt_out values ('second', pg_temp.edit('cells_without_plain', 'hardware_without_one', 'none', true));
select pg_temp.check_that(
  'A second edit is refused while the first has not reached QuickBooks',
  (select outcome like 'err:23514:%has not reached QuickBooks%' from qt_out where name = 'second'),
  (select outcome from qt_out where name = 'second')
);

create temporary table qt_request (stage text primary key, request_id uuid) on commit drop;
insert into qt_request
select 'before', update_request_id from valtrim.quickbooks_invoice_syncs where package_id = (select pkg from qt_ctx);

insert into qt_out
select 'fail', pg_temp.attempt(format(
  'select valtrim.fail_quickbooks_invoice_update(%s, ''QuickBooks said no'', true)::text', pkg)) from qt_ctx;
insert into qt_request
select 'after maybe', update_request_id from valtrim.quickbooks_invoice_syncs where package_id = (select pkg from qt_ctx);
select pg_temp.check_that(
  'A failed attempt is recorded and the Package keeps waiting, with the same request id when QuickBooks may have applied it',
  (select outcome = 'ok:true' from qt_out where name = 'fail')
  and (select update_pending and update_error = 'QuickBooks said no'
       from valtrim.quickbooks_invoice_syncs where package_id = (select pkg from qt_ctx))
  and (select request_id from qt_request where stage = 'before') = (select request_id from qt_request where stage = 'after maybe'),
  (select outcome from qt_out where name = 'fail')
);

insert into qt_out
select 'fail definite', pg_temp.attempt(format(
  'select valtrim.fail_quickbooks_invoice_update(%s, ''QuickBooks refused'', false)::text', pkg)) from qt_ctx;
insert into qt_request
select 'after refusal', update_request_id from valtrim.quickbooks_invoice_syncs where package_id = (select pkg from qt_ctx);
select pg_temp.check_that(
  'After a refusal that changed nothing the next try gets a request id of its own',
  (select outcome = 'ok:true' from qt_out where name = 'fail definite')
  and (select request_id from qt_request where stage = 'after maybe') <> (select request_id from qt_request where stage = 'after refusal'),
  (select outcome from qt_out where name = 'fail definite')
);

insert into qt_out
select 'complete', pg_temp.attempt(format(
  'select valtrim.complete_quickbooks_invoice_update(%s, ''tok-2'', %s, ''{"TxnDate":"2026-01-02"}''::jsonb)::text',
  pkg, (select net_amount from valtrim.invoices where package_id = qt_ctx.pkg))) from qt_ctx;
select pg_temp.check_that(
  'Telling QuickBooks clears the mark and keeps the new total and token',
  (select outcome = 'ok:true' from qt_out where name = 'complete')
  and (select not update_pending and update_error is null and qbo_sync_token = 'tok-2'
        and total_amount = (select net_amount from valtrim.invoices where package_id = (select pkg from qt_ctx))
        and updated_in_quickbooks_at is not null
        and invoice_number = (select number_before from qt_ctx)
       from valtrim.quickbooks_invoice_syncs where package_id = (select pkg from qt_ctx)),
  (select outcome from qt_out where name = 'complete')
);

insert into qt_out
select 'complete twice', pg_temp.attempt(format(
  'select valtrim.complete_quickbooks_invoice_update(%s, ''x'', 1, ''{}''::jsonb)::text', pkg)) from qt_ctx;
select pg_temp.check_that(
  'Nothing can be completed twice',
  (select outcome like 'err:55000:%' from qt_out where name = 'complete twice'),
  (select outcome from qt_out where name = 'complete twice')
);

-- What was freed can be put back ----------------------------------------------------------------------------------------

insert into qt_out values ('put back', pg_temp.edit('cells', 'hardware', 'none', false));
select pg_temp.check_that(
  'The freed cell and Hardware line go back on the Package and the total is what it was without the released Option',
  (select outcome like 'ok:%'
      and (select count(*) from valtrim.package_draws where package_id = pkg) = cells_before
      and (select count(*) from valtrim.package_hardware_lines where package_id = pkg) = hw_before
      and (select net_amount from valtrim.invoices where package_id = pkg) = pg_temp.lines_net(pkg)
      and (select net_amount from valtrim.invoices where package_id = pkg) < net_before
      and (
        pg_temp.field('real', array['previous', 'retention']) <> 0
        or (select net_amount from valtrim.invoices where package_id = pkg)
          = net_before - (
            select (released ->> 'option_price')::numeric
            from jsonb_array_elements(substr((select outcome from qt_out where name = 'real'), 4)::jsonb -> 'released_options') released
            where (released ->> 'lot_id')::bigint = opt_lot and (released ->> 'option_id')::bigint = opt_option
              and (released ->> 'unit_no')::integer = opt_unit)
      )
   from qt_out, qt_ctx where qt_out.name = 'put back'),
  (select outcome from qt_out where name = 'put back')
);

-- Payments stop it ---------------------------------------------------------------------------------------------------------------

insert into qt_out
select 'complete again', pg_temp.attempt(format(
  'select valtrim.complete_quickbooks_invoice_update(%s, ''tok-3'', %s, ''{"TxnDate":"2026-01-02"}''::jsonb)::text',
  pkg, (select net_amount from valtrim.invoices where package_id = qt_ctx.pkg))) from qt_ctx;

update valtrim.quickbooks_invoice_syncs set qbo_state = 'PAID' where package_id = (select pkg from qt_ctx);
insert into qt_out values ('paid', pg_temp.edit('cells_without_plain', 'hardware', 'none', true));
select pg_temp.check_that(
  'An invoice that QuickBooks shows as paid cannot be edited',
  (select outcome like 'err:23514:%payment or credit%' from qt_out where name = 'paid'),
  (select outcome from qt_out where name = 'paid')
);

select step, name, ok, detail from qt_results order by step;

rollback;
