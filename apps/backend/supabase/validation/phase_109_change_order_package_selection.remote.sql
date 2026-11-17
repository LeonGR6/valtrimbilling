-- Extra / Change Orders charged from a Package: the Lots are chosen one by one. Run it after migration
-- 20261225120000; every row of the last result must have ok = true. Everything happens in a transaction that
-- is rolled back. It needs a Job with a live Draw / Options Package and two Lots of one Plan.

begin;

create temporary table pr_results (step serial primary key, name text not null, ok boolean not null, detail text) on commit drop;
create temporary table pr_out (name text primary key, outcome text) on commit drop;
create temporary table pr_ctx (admin_id uuid, sched_id uuid, job_id bigint, package_id bigint, plan_id bigint,
  phase_id bigint, lot_a bigint, lot_b bigint, foreign_lot bigint, parent_id bigint, child_id bigint,
  co_seq_last bigint, co_seq_called boolean) on commit drop;

create function pg_temp.check_that(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into pr_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
$$;

create function pg_temp.run_as(p_user uuid, p_sql text)
returns text language plpgsql as $$
declare v_result text;
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

create function pg_temp.id_of(p_name text)
returns bigint language sql as $$
  select nullif(regexp_replace((select outcome from pr_out where name = p_name), '^ok:', ''), '')::bigint;
$$;

insert into pr_ctx (admin_id, sched_id, job_id, package_id, plan_id, phase_id, lot_a, lot_b, co_seq_last, co_seq_called)
select
  (select id from valtrim.app_users where role = 'ADMIN' and is_active order by created_at limit 1),
  gen_random_uuid(), -- someone who is not a user: no role at all
  package.job_id, package.id, pair.plan_id, pair.phase_id, pair.lot_a, pair.lot_b,
  (select last_value from valtrim.change_order_number_seq), (select is_called from valtrim.change_order_number_seq)
from valtrim.draw_packages package
join lateral (
  select a.plan_id, a.phase_id, a.id as lot_a, b.id as lot_b
  from valtrim.lots a
  join valtrim.lots b on b.job_id = a.job_id and b.phase_id = a.phase_id and b.plan_id = a.plan_id and b.id > a.id
  where a.job_id = package.job_id and not a.is_utility_building and not b.is_utility_building and a.plan_id is not null
  order by a.id limit 1
) pair on true
where package.status <> 'VOIDED' and package.package_type in ('DRAW', 'OPTIONS')
order by package.id desc
limit 1;

update pr_ctx set foreign_lot = (select id from valtrim.lots where job_id <> pr_ctx.job_id and not is_utility_building limit 1);

select pg_temp.check_that('there is a Job with a live Package and two Lots of one Plan',
  (select admin_id is not null and sched_id is not null and lot_b is not null and foreign_lot is not null from pr_ctx),
  (select format('job %s package %s plan %s lots %s/%s', job_id, package_id, plan_id, lot_a, lot_b) from pr_ctx));

-- A "Specific plan types" Change Order with an event of its own, approved, whose line is Lot A.
insert into pr_out select 'parent', pg_temp.run_as(admin_id, format(
  $q$select valtrim.create_change_order(
    p_job_id => %s, p_title => null, p_requested_by => 'Validation 109',
    p_lines => %L::jsonb, p_coverage => %L::jsonb, p_plan_rules => %L::jsonb)$q$,
  job_id,
  jsonb_build_array(jsonb_build_object('lot_id', lot_a, 'scope_of_work', 'x', 'amount', 10)),
  jsonb_build_object('mode', 'plans', 'planIds', jsonb_build_array(plan_id::text)),
  jsonb_build_array(jsonb_build_object('plan_id', plan_id, 'scope_of_work', 'By plan', 'amount', 25))
)) from pr_ctx;
update pr_ctx set parent_id = pg_temp.id_of('parent');
insert into pr_out select 'approve', pg_temp.run_as(admin_id, format(
  $q$select valtrim.set_change_order_status(%s, 'APPROVED')$q$, parent_id)) from pr_ctx;
select pg_temp.check_that('the parent Change Order is approved',
  (select outcome from pr_out where name = 'approve') like 'ok:%', (select outcome from pr_out where name = 'approve'));

-- The screen lists Lot B (not Lot A, already a line of the Change Order) with the event of its Plan (none = own).
insert into pr_out select 'candidates', pg_temp.run_as(admin_id, format(
  $q$select string_agg(lot_id::text || ':' || coalesce(billing_event, 'OWN'), ',') from valtrim.package_change_order_candidates(%s, array[%s]::bigint[])$q$,
  job_id, phase_id)) from pr_ctx;
select pg_temp.check_that('the candidates list Lot B with the event of its Plan, and not Lot A',
  (select outcome from pr_out where name = 'candidates') like '%' || (select lot_b from pr_ctx)::text || ':OWN%'
  and (select outcome from pr_out where name = 'candidates') not like '%' || (select lot_a from pr_ctx)::text || ':%',
  (select outcome from pr_out where name = 'candidates'));

select pg_temp.check_that('a person with no role cannot save a choice',
  pg_temp.run_as((select sched_id from pr_ctx), format(
    $q$select valtrim.stage_package_change_order_selection(%s, '[]'::jsonb)$q$, (select job_id from pr_ctx))) like 'err:42501:%');
select pg_temp.check_that('a Lot of another Job is refused',
  pg_temp.run_as((select admin_id from pr_ctx), format(
    $q$select valtrim.stage_package_change_order_selection(%s, %L::jsonb)$q$,
    (select job_id from pr_ctx), (select jsonb_build_array(jsonb_build_object('lot_id', foreign_lot)) from pr_ctx))) like 'err:23514:%');
select pg_temp.check_that('something that is not an array is refused',
  pg_temp.run_as((select admin_id from pr_ctx), format(
    $q$select valtrim.stage_package_change_order_selection(%s, '{}'::jsonb)$q$, (select job_id from pr_ctx))) like 'err:23514:%');
select pg_temp.check_that('a bad date is refused',
  pg_temp.run_as((select admin_id from pr_ctx), format(
    $q$select valtrim.stage_package_change_order_selection(%s, %L::jsonb)$q$,
    (select job_id from pr_ctx), (select jsonb_build_array(jsonb_build_object('lot_id', lot_b, 'event_date', 'tomorrow')) from pr_ctx))) like 'err:23514:%');

-- The choice: Lot B, with the date of an event of its own.
insert into pr_out select 'stage', pg_temp.run_as(admin_id, format(
  $q$select valtrim.stage_package_change_order_selection(%s, %L::jsonb)$q$,
  job_id, jsonb_build_array(jsonb_build_object('lot_id', lot_b, 'event_date', (current_date + 20)::text)))) from pr_ctx;
select pg_temp.check_that('an Admin saves the choice',
  (select outcome from pr_out where name = 'stage') like 'ok:%'
  and exists (select 1 from valtrim.package_change_order_staging staging, pr_ctx
              where staging.user_id = pr_ctx.admin_id and staging.job_id = pr_ctx.job_id and staging.lot_ids = array[pr_ctx.lot_b]),
  (select outcome from pr_out where name = 'stage'));

-- The Package takes it when it syncs (as that user, the Package just created).
update valtrim.draw_packages set created_at = now() where id = (select package_id from pr_ctx);
select set_config('request.jwt.claims', json_build_object('sub', admin_id::text, 'role', 'authenticated')::text, true) from pr_ctx;
select private.sync_package_change_orders(package_id) from pr_ctx;
update pr_ctx set child_id = (select id from valtrim.change_orders
  where source_change_order_id = pr_ctx.parent_id and source_package_id = pr_ctx.package_id);

select pg_temp.check_that('the Package keeps the choice and the staging is used up',
  exists (select 1 from valtrim.package_change_order_choices c, pr_ctx where c.package_id = pr_ctx.package_id and c.lot_ids = array[pr_ctx.lot_b])
  and not exists (select 1 from valtrim.package_change_order_staging s, pr_ctx where s.job_id = pr_ctx.job_id and s.user_id = pr_ctx.admin_id));
select pg_temp.check_that('the Package charges exactly the chosen Lot (billed by it or not)',
  (select child_id from pr_ctx) is not null
  and (select array_agg(lot_id) from valtrim.change_order_plan_charges
       where package_id = (select package_id from pr_ctx) and released_at is null
         and source_change_order_id = (select parent_id from pr_ctx)) = array[(select lot_b from pr_ctx)]);
select pg_temp.check_that('the Change Order made from the Package gets an event of its own on the chosen date',
  exists (select 1 from valtrim.change_order_events event
          join valtrim.change_order_event_lots event_lot on event_lot.event_id = event.id
          where event.change_order_id = (select child_id from pr_ctx) and event.scheduled_date = current_date + 20
            and event_lot.lot_id = (select lot_b from pr_ctx)));

-- Another sync keeps the choice.
select private.sync_package_change_orders(package_id) from pr_ctx;
select pg_temp.check_that('syncing again keeps the choice',
  (select count(*) = 1 from valtrim.change_order_plan_charges
   where package_id = (select package_id from pr_ctx) and released_at is null and source_change_order_id = (select parent_id from pr_ctx)));

-- Choosing none gives the Lot back.
update valtrim.package_change_order_choices set lot_ids = '{}', event_dates = '{}' where package_id = (select package_id from pr_ctx);
select private.sync_package_change_orders(package_id) from pr_ctx;
select pg_temp.check_that('with no Lot chosen nothing is charged and the Change Order made is cancelled',
  not exists (select 1 from valtrim.change_order_plan_charges
              where package_id = (select package_id from pr_ctx) and released_at is null and source_change_order_id = (select parent_id from pr_ctx))
  and (select status from valtrim.change_orders where id = (select child_id from pr_ctx)) = 'CANCELLED');

select setval('valtrim.change_order_number_seq', co_seq_last, co_seq_called) from pr_ctx;
select pg_temp.check_that('the CO number sequence is back where it was',
  (select last_value from valtrim.change_order_number_seq) = (select co_seq_last from pr_ctx));

select step, name, ok, detail from pr_results order by step;

rollback;
