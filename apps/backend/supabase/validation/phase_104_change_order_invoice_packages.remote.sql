-- Invoicing an Extra / Change Order through a Package of its own, against the real database, inside a
-- transaction that is rolled back. Run it after migration 20261219120000; every row of the last result must
-- have ok = true.
--
-- It makes approved Change Orders on a Job with unbilled Lots, invoices them as a real Draw & Invoice user,
-- and checks the refusals, the void, and that an invoiced Change Order made from a Package is left as it is
-- when its source Package changes. Nothing is left: both number sequences are put back as they were found.
-- A run that stops halfway does not reach that last step: put the CO sequence back to the highest CO number.

begin;

create temporary table pr_results (step serial primary key, name text not null, ok boolean not null, detail text) on commit drop;
create temporary table pr_out (name text primary key, outcome text) on commit drop;
create temporary table pr_ctx (
  admin_id uuid, maker_id uuid, other_id uuid, job_id bigint, plan_id bigint, lots bigint[], draw1 smallint,
  co_seq_last bigint, co_seq_called boolean, pkg_seq_last bigint, pkg_seq_called boolean,
  co_a bigint, co_credit bigint, co_draft bigint, package_a bigint, package_a2 bigint,
  parent_id bigint, source_package bigint, child_id bigint, child_package bigint
) on commit drop;

create function pg_temp.check_that(p_name text, p_ok boolean, p_detail text default null)
returns void
language sql
as $$
  insert into pr_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
$$;

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

-- What happens when the transaction commits, now: the deferred Package triggers run as `p_user`.
create function pg_temp.flush(p_user uuid)
returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  perform set_config('valtrim.change_order_synced_packages', '', true);
  begin
    set constraints all immediate;
    set constraints all deferred;
    return 'ok';
  exception when others then
    set constraints all deferred;
    return 'err:' || sqlstate || ':' || sqlerrm;
  end;
end;
$$;

-- A statement run as the database owner with `p_user` as the signed-in user (for what the app does through
-- functions that a test cannot call: voiding a Package, taking a Lot out of it).
create function pg_temp.run_owner(p_user uuid, p_sql text)
returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  begin
    execute p_sql;
    return 'ok';
  exception when others then
    return 'err:' || sqlstate || ':' || sqlerrm;
  end;
end;
$$;

create function pg_temp.lot(p_index integer)
returns bigint
language sql
as $$ select lots[p_index] from pr_ctx; $$;

create function pg_temp.package_of(p_name text)
returns bigint
language sql
as $$
  select nullif(regexp_replace(outcome, '^ok:', ''), '')::bigint
  from pr_out where name = p_name and outcome like 'ok:%';
$$;

-- The Change Order made from a Package for the rule, not cancelled.


-- The context -------------------------------------------------------------------------------------------

with unbilled as (
  select lot.job_id, lot.plan_id, lot.id, phase.code, lot.display_order, lot.lot_number
  from valtrim.lots lot
  join valtrim.phases phase on phase.id = lot.phase_id and phase.is_active and not phase.is_utility_building
  join valtrim.jobs job on job.id = lot.job_id and job.is_active and job.billing_setup_version_id is not null
  join valtrim.plans plan on plan.id = lot.plan_id and plan.is_active
  where not lot.is_utility_building
    and not exists (select 1 from valtrim.package_draws d where d.lot_id = lot.id)
    and not exists (select 1 from valtrim.package_options o where o.lot_id = lot.id)
),
chosen as (
  select unbilled.job_id, unbilled.plan_id
  from unbilled
  group by unbilled.job_id, unbilled.plan_id
  having count(*) >= 4
  order by (
    select count(*) from valtrim.draw_packages package
    where package.job_id = unbilled.job_id and package.package_type = 'DRAW' and package.status <> 'VOIDED'
  ) desc, unbilled.job_id, unbilled.plan_id
  limit 1
)
insert into pr_ctx (admin_id, maker_id, other_id, job_id, plan_id, lots, draw1, co_seq_last, co_seq_called, pkg_seq_last, pkg_seq_called)
select
  (select id from valtrim.app_users where role = 'ADMIN' and is_active order by created_at limit 1),
  (select id from valtrim.app_users where role = 'DRAW_INVOICE' and is_active order by created_at limit 1),
  (select id from valtrim.app_users where role = 'DRAW_INVOICE' and is_active order by created_at desc limit 1),
  chosen.job_id,
  chosen.plan_id,
  (select array_agg(picked.id order by picked.code, picked.display_order, picked.lot_number)
   from (select * from unbilled own where own.job_id = chosen.job_id and own.plan_id = chosen.plan_id
         order by own.code, own.display_order, own.lot_number limit 4) picked),
  (select min(draw.draw_number) from valtrim.billing_draws draw
   join valtrim.jobs job on job.billing_setup_version_id = draw.setup_version_id where job.id = chosen.job_id),
  (select last_value from valtrim.change_order_number_seq),
  (select is_called from valtrim.change_order_number_seq),
  (select last_value from valtrim.draw_package_number_seq),
  (select is_called from valtrim.draw_package_number_seq)
from chosen;

-- The other Draw & Invoice user plays Project Management, who cannot invoice.
update valtrim.app_users set role = 'PROJECT_MANAGEMENT' where id = (select other_id from pr_ctx);

select pg_temp.check_that('the validation has an Admin, a Draw & Invoice user, a Project Manager and 4 unbilled Lots of a Plan',
  (select admin_id is not null and maker_id is not null and other_id is not null and maker_id <> other_id
          and cardinality(lots) = 4 and draw1 is not null from pr_ctx),
  (select format('job %s plan %s lots %s', job_id, plan_id, lots) from pr_ctx)
);

-- The pieces are there ------------------------------------------------------------------------------------

select pg_temp.check_that('the CHANGE_ORDER type, its column and its one-per-CO index exist; readers see the column',
  exists (select 1 from pg_constraint where conname = 'draw_packages_package_type_check'
          and pg_get_constraintdef(oid) like '%CHANGE_ORDER%')
  and has_column_privilege('authenticated', 'valtrim.draw_packages', 'change_order_id', 'select')
  and exists (select 1 from pg_indexes where indexname = 'draw_packages_one_per_change_order')
  and has_function_privilege('authenticated', 'valtrim.create_change_order_package(bigint, text)', 'execute')
  and not has_function_privilege('anon', 'valtrim.create_change_order_package(bigint, text)', 'execute')
  and not has_function_privilege('authenticated', 'private.change_order_invoice_package(bigint)', 'execute')
);

-- Change Orders to invoice --------------------------------------------------------------------------------

insert into pr_out
select 'co a', pg_temp.run_as(admin_id, format(
  $q$select valtrim.create_change_order(%s, null, 'Validation 104', %L::jsonb, null, null, null, %L::jsonb, 'APPROVED')$q$,
  job_id,
  jsonb_build_array(
    jsonb_build_object('lot_id', lots[1], 'scope_of_work', 'Wider door', 'amount', 100),
    jsonb_build_object('lot_id', lots[2], 'scope_of_work', 'Wider door', 'amount', 50.25),
    jsonb_build_object('location', 'Sales Office', 'scope_of_work', 'Locks', 'amount', 25)),
  jsonb_build_object('mode', 'lots'))) from pr_ctx;
update pr_ctx set co_a = pg_temp.package_of('co a');

insert into pr_out
select 'co credit', pg_temp.run_as(admin_id, format(
  $q$select valtrim.create_change_order(%s, null, 'Validation 104', %L::jsonb, null, null, null, %L::jsonb, 'APPROVED')$q$,
  job_id,
  jsonb_build_array(jsonb_build_object('lot_id', lots[1], 'scope_of_work', 'Credit', 'amount', -10)),
  jsonb_build_object('mode', 'lots'))) from pr_ctx;
update pr_ctx set co_credit = pg_temp.package_of('co credit');

insert into pr_out
select 'co draft', pg_temp.run_as(admin_id, format(
  $q$select valtrim.create_change_order(%s, null, 'Validation 104', %L::jsonb, null, null, null, %L::jsonb, 'DRAFT')$q$,
  job_id,
  jsonb_build_array(jsonb_build_object('lot_id', lots[1], 'scope_of_work', 'Draft', 'amount', 10)),
  jsonb_build_object('mode', 'lots'))) from pr_ctx;
update pr_ctx set co_draft = pg_temp.package_of('co draft');

select pg_temp.check_that('three Change Orders to work with: approved, approved credit, draft',
  (select co_a is not null and co_credit is not null and co_draft is not null from pr_ctx),
  (select string_agg(name || '=' || outcome, ' | ') from pr_out where name like 'co %')
);

-- Refusals --------------------------------------------------------------------------------------------------

select pg_temp.check_that('Project Management cannot invoice a Change Order',
  pg_temp.run_as((select other_id from pr_ctx), format('select valtrim.create_change_order_package(%s)', (select co_a from pr_ctx)))
    like 'err:42501:%'
);
select pg_temp.check_that('a Draft cannot be invoiced',
  pg_temp.run_as((select maker_id from pr_ctx), format('select valtrim.create_change_order_package(%s)', (select co_draft from pr_ctx)))
    like 'err:23514:%approved%'
);
select pg_temp.check_that('a Change Order whose total is a credit cannot be invoiced',
  pg_temp.run_as((select maker_id from pr_ctx), format('select valtrim.create_change_order_package(%s)', (select co_credit from pr_ctx)))
    like 'err:23514:%credit or zero%'
);
select pg_temp.check_that('a Change Order that does not exist says so',
  pg_temp.run_as((select maker_id from pr_ctx), 'select valtrim.create_change_order_package(-1)') like 'err:P0002:%'
);

-- Invoicing it ----------------------------------------------------------------------------------------------

insert into pr_out
select 'package a', pg_temp.run_as(maker_id, format($q$select valtrim.create_change_order_package(%s, 'Validation note')$q$, co_a))
from pr_ctx;
update pr_ctx set package_a = pg_temp.package_of('package a');

select pg_temp.check_that('the Draw & Invoice user invoices it: a CHANGE_ORDER Package with the CO total, no Retention, no WRAP',
  (select package_a is not null from pr_ctx)
  and (select package.package_type = 'CHANGE_ORDER' and package.change_order_id = ctx.co_a
              and package.package_number like 'CP-%' and package.workflow_status = 'DRAFT'
              and package.status = 'DRAFT' and package.job_id = ctx.job_id and package.created_by = ctx.maker_id
              -- A Lot line and a line without a Lot: no single Phase.
              and package.phase_id is null
       from valtrim.draw_packages package, pr_ctx ctx where package.id = ctx.package_a)
  and (select invoice.gross_amount = 175.25 and invoice.retention_amount = 0 and invoice.wrap_amount = 0
              and invoice.net_amount = 175.25 and invoice.status = 'DRAFT'
       from valtrim.invoices invoice, pr_ctx ctx where invoice.package_id = ctx.package_a),
  (select outcome from pr_out where name = 'package a')
);

select pg_temp.check_that('the note goes to the Package notes, like any Package',
  exists (select 1 from valtrim.draw_package_notes note, pr_ctx ctx where note.package_id = ctx.package_a and note.body = 'Validation note')
);

select pg_temp.check_that('the list shows its invoice Package',
  (select overview.invoice_package_id = ctx.package_a and overview.invoice_package_number like 'CP-%'
          and overview.invoice_workflow_status = 'DRAFT'
   from valtrim.change_order_overview overview, pr_ctx ctx where overview.id = ctx.co_a)
);

select pg_temp.check_that('it cannot be invoiced twice',
  pg_temp.run_as((select maker_id from pr_ctx), format('select valtrim.create_change_order_package(%s)', (select co_a from pr_ctx)))
    like 'err:23505:%already invoiced%'
);

select pg_temp.check_that('it cannot be cancelled while its invoice Package stands',
  pg_temp.run_as((select admin_id from pr_ctx), format($q$select valtrim.set_change_order_status(%s, 'CANCELLED', 'x')$q$, (select co_a from pr_ctx)))
    like 'err:23514:%Void the invoice Package%'
);

select pg_temp.check_that('the Change Order of a Package never changes',
  pg_temp.run_owner((select admin_id from pr_ctx),
    format('update valtrim.draw_packages set change_order_id = %s where id = %s', (select co_draft from pr_ctx), (select package_a from pr_ctx)))
    like 'err:%inmutables%'
);

select pg_temp.check_that('a Package of another type cannot point at a Change Order',
  pg_temp.run_owner((select admin_id from pr_ctx),
    format($q$insert into valtrim.draw_packages (package_number, package_type, change_order_id, builder_id, job_id, setup_version_id, package_date, invoice_line_format)
      select 'XX-TEST-104', 'DRAW', %s, job.builder_id, job.id, job.billing_setup_version_id, current_date, 'LOT_SCOPE'
      from valtrim.jobs job where job.id = %s$q$, (select co_a from pr_ctx), (select job_id from pr_ctx)))
    like 'err:23514:%'
);

select pg_temp.check_that('with no lines of its own it can still leave Draft (it is ready to submit)',
  pg_temp.run_owner((select admin_id from pr_ctx),
    format($q$update valtrim.draw_packages set workflow_status = 'READY_TO_SUBMIT' where id = %s$q$, (select package_a from pr_ctx)))
    = 'ok'
);

-- Voiding it lets it be invoiced again -----------------------------------------------------------------------

select pg_temp.run_owner((select admin_id from pr_ctx),
  format($q$update valtrim.draw_packages set workflow_status = 'DRAFT' where id = %s$q$, (select package_a from pr_ctx)));

insert into pr_out
select 'void a', pg_temp.run_owner(admin_id,
  format($q$update valtrim.draw_packages set status = 'VOIDED', voided_at = now(), voided_by = %L, void_reason = 'Validation 104' where id = %s$q$, admin_id, package_a))
from pr_ctx;

insert into pr_out
select 'package a2', pg_temp.run_as(maker_id, format('select valtrim.create_change_order_package(%s)', co_a)) from pr_ctx;
update pr_ctx set package_a2 = pg_temp.package_of('package a2');

select pg_temp.check_that('once its Package is voided, the Change Order is invoiced again on a new Package',
  (select outcome from pr_out where name = 'void a') = 'ok'
  and (select package_a2 is not null and package_a2 <> package_a from pr_ctx)
  and (select overview.invoice_package_id = ctx.package_a2 from valtrim.change_order_overview overview, pr_ctx ctx where overview.id = ctx.co_a),
  (select string_agg(name || '=' || outcome, ' | ') from pr_out where name in ('void a', 'package a2'))
);

-- An invoiced Change Order made from a Package is closed --------------------------------------------------------

insert into pr_out
select 'parent', pg_temp.run_as(admin_id, format(
  $q$select valtrim.create_change_order(p_job_id => %s, p_title => null, p_requested_by => 'Validation 104',
     p_lines => %L::jsonb, p_coverage => %L::jsonb, p_status => 'APPROVED', p_plan_rules => %L::jsonb)$q$,
  job_id,
  jsonb_build_array(jsonb_build_object('lot_id', lots[1], 'scope_of_work', 'Rule', 'amount', 40)),
  jsonb_build_object('mode', 'plans', 'planIds', jsonb_build_array(plan_id::text)),
  jsonb_build_array(jsonb_build_object('plan_id', plan_id, 'scope_of_work', 'Rule', 'amount', 40))))
from pr_ctx;
update pr_ctx set parent_id = pg_temp.package_of('parent');

insert into pr_out
select 'source package', pg_temp.run_as(maker_id, format('select private.create_draw_invoice_package(%s, %L::jsonb, current_date, null)',
  job_id, jsonb_build_array(
    jsonb_build_object('lot_id', lots[3], 'draw_number', draw1),
    jsonb_build_object('lot_id', lots[4], 'draw_number', draw1))))
from pr_ctx;
update pr_ctx set source_package = pg_temp.package_of('source package');
insert into pr_out select 'flush source', pg_temp.flush((select maker_id from pr_ctx));

update pr_ctx set child_id = (
  select co.id from valtrim.change_orders co
  where co.source_change_order_id = pr_ctx.parent_id and co.source_package_id = pr_ctx.source_package and co.status = 'APPROVED'
);

insert into pr_out
select 'child package', pg_temp.run_as(maker_id, format('select valtrim.create_change_order_package(%s)', child_id)) from pr_ctx;
update pr_ctx set child_package = pg_temp.package_of('child package');

select pg_temp.check_that('the Change Order made from the source Package charges Lots 3 and 4 and is invoiced',
  (select child_id is not null and child_package is not null from pr_ctx)
  and (select count(*) = 2 from valtrim.change_order_lines line, pr_ctx ctx where line.change_order_id = ctx.child_id)
  and (select invoice.net_amount = 80 from valtrim.invoices invoice, pr_ctx ctx where invoice.package_id = ctx.child_package),
  (select string_agg(name || '=' || outcome, ' | ') from pr_out where name in ('parent', 'source package', 'flush source', 'child package'))
);

select set_config('valtrim.draw_package_correction', 'on', true);
insert into pr_out
select 'take lot 4 out', pg_temp.run_owner(admin_id,
  format('delete from valtrim.package_options where package_id = %s and lot_id = %s', source_package, lots[4]))
  || '/' || pg_temp.run_owner(admin_id,
  format('delete from valtrim.package_draws where package_id = %s and lot_id = %s', source_package, lots[4]))
from pr_ctx;
select set_config('valtrim.draw_package_correction', 'off', true);
insert into pr_out select 'flush edit', pg_temp.flush((select admin_id from pr_ctx));

select pg_temp.check_that('Lot 4 leaving the source Package does not touch the invoiced Change Order: its line and charge stand',
  (select outcome from pr_out where name = 'take lot 4 out') = 'ok/ok'
  and (select outcome from pr_out where name = 'flush edit') = 'ok'
  and (select status = 'APPROVED' from valtrim.change_orders co, pr_ctx ctx where co.id = ctx.child_id)
  and (select count(*) = 2 from valtrim.change_order_lines line, pr_ctx ctx where line.change_order_id = ctx.child_id)
  and (select count(*) = 2 from valtrim.change_order_plan_charges charge, pr_ctx ctx
       where charge.change_order_id = ctx.child_id and charge.released_at is null),
  (select string_agg(name || '=' || outcome, ' | ') from pr_out where name in ('take lot 4 out', 'flush edit'))
);

select pg_temp.check_that('the invoice of the Change Order made from a Package still matches its lines',
  (select invoice.net_amount = (select sum(line.amount) from valtrim.change_order_lines line where line.change_order_id = ctx.child_id)
   from valtrim.invoices invoice, pr_ctx ctx where invoice.package_id = ctx.child_package)
);

-- Nothing is left ---------------------------------------------------------------------------------------------

select setval('valtrim.change_order_number_seq', co_seq_last, co_seq_called) from pr_ctx;
select setval('valtrim.draw_package_number_seq', pkg_seq_last, pkg_seq_called) from pr_ctx;

select pg_temp.check_that('both number sequences are back where they were',
  (select last_value from valtrim.change_order_number_seq) = (select co_seq_last from pr_ctx)
  and (select last_value from valtrim.draw_package_number_seq) = (select pkg_seq_last from pr_ctx)
);

select step, name, ok, detail from pr_results order by step;

rollback;
