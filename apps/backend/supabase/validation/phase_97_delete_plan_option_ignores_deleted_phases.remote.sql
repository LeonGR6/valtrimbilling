-- Deleting a Plan or an Option when only deleted Phases still use it, against the real database, inside a
-- transaction that is rolled back. Run it after the migration 20261211120000; every row of the last result must
-- have ok = true. It borrows the Jobs that have deleted Phases whose Lots were kept, deletes a Plan and an Option as
-- an ADMIN, and brings a Phase back to life (inside the transaction) to check that its Lots still block.

begin;

create temporary table qt_results (
  step serial primary key,
  name text not null,
  ok boolean not null,
  detail text
) on commit drop;

create temporary table qt_ctx (
  admin_id uuid,
  phase_id bigint,
  plan_free bigint,
  option_free bigint,
  plan_used bigint,
  option_used bigint
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

-- A deleted Phase of an active Job that kept Lots, with two Plans and two Options that only such Lots use.
with kept as (
  select
    phase.id as phase_id,
    lot.plan_id,
    selected.option_id,
    row_number() over (partition by phase.id order by lot.plan_id, selected.option_id) as n
  from valtrim.phases phase
  join valtrim.jobs job on job.id = phase.job_id and job.is_active
  join valtrim.lots lot on lot.phase_id = phase.id
  join valtrim.plans plan on plan.id = lot.plan_id and plan.is_active
  join valtrim.lot_options selected on selected.lot_id = lot.id
  join valtrim.plan_options option on option.id = selected.option_id and option.is_active
  where not phase.is_active
    and not exists (
      select 1 from valtrim.lots other
      join valtrim.phases other_phase on other_phase.id = other.phase_id and other_phase.is_active
      where other.plan_id = lot.plan_id
    )
    and not exists (
      select 1 from valtrim.lot_options other
      join valtrim.lots other_lot on other_lot.id = other.lot_id
      join valtrim.phases other_phase on other_phase.id = other_lot.phase_id and other_phase.is_active
      where other.option_id = selected.option_id
    )
)
insert into qt_ctx (admin_id, phase_id, plan_free, option_free, plan_used, option_used)
select
  (select id from valtrim.app_users where role = 'ADMIN' and is_active order by created_at limit 1),
  first_row.phase_id,
  first_row.plan_id,
  -- an Option of a Plan other than the one that is deleted first, so deleting the Plan does not take it along
  (select kept.option_id from kept
   join valtrim.plan_options option on option.id = kept.option_id
   where kept.phase_id = first_row.phase_id and option.plan_id <> first_row.plan_id
   order by kept.option_id limit 1),
  (select kept.plan_id from kept
   where kept.phase_id = first_row.phase_id and kept.plan_id <> first_row.plan_id
   order by kept.plan_id limit 1),
  (select kept.option_id from kept
   join valtrim.plan_options option on option.id = kept.option_id
   where kept.phase_id = first_row.phase_id
     and option.plan_id not in (first_row.plan_id)
     and option.plan_id is not null
   order by kept.option_id desc limit 1)
from kept first_row
where first_row.n = 1
order by first_row.phase_id
limit 1;

select pg_temp.check_that(
  'there is a deleted Phase with kept Lots, and an ADMIN, to test with',
  (select admin_id is not null and phase_id is not null and plan_free is not null and option_free is not null
     and plan_used is not null and option_used is not null from qt_ctx),
  (select row_to_json(qt_ctx)::text from qt_ctx)
);

-- Only deleted Phases use them: the deletion goes through -----------------------------------------------------------------

insert into qt_out
select 'option', pg_temp.run_as(admin_id, format('select valtrim.deactivate_plan_option(%s)::text', option_free)) from qt_ctx;
select pg_temp.check_that(
  'an Option that only the Lots of a deleted Phase use can be deleted',
  (select outcome = 'ok:' || (select option_free from qt_ctx)::text from qt_out where name = 'option')
  and (select not is_active from valtrim.plan_options where id = (select option_free from qt_ctx)),
  (select outcome from qt_out where name = 'option')
);

insert into qt_out
select 'plan', pg_temp.run_as(admin_id, format('select valtrim.deactivate_job_plan(%s)::text', plan_free)) from qt_ctx;
select pg_temp.check_that(
  'a Plan that only the Lots of a deleted Phase use can be deleted, and it is deactivated, not removed',
  (select outcome = 'ok:' || (select plan_free from qt_ctx)::text from qt_out where name = 'plan')
  and (select not is_active from valtrim.plans where id = (select plan_free from qt_ctx))
  and exists (select 1 from valtrim.lots lot, qt_ctx ctx where lot.phase_id = ctx.phase_id and lot.plan_id = ctx.plan_free),
  (select outcome from qt_out where name = 'plan')
);

-- The Phase is alive again: its Lots block ------------------------------------------------------------------------------

update valtrim.phases set is_active = true where id = (select phase_id from qt_ctx);

select pg_temp.check_that(
  'with the Phase active, the Lots that use the Plan still block its deletion',
  (select pg_temp.run_as(admin_id, format('select valtrim.deactivate_job_plan(%s)::text', plan_used)) like 'err:23503:Reassign or remove the Lots%' from qt_ctx),
  (select pg_temp.run_as(admin_id, format('select valtrim.deactivate_job_plan(%s)::text', plan_used)) from qt_ctx)
);

select pg_temp.check_that(
  'with the Phase active, the Lots that use the Option still block its deletion',
  (select pg_temp.run_as(admin_id, format('select valtrim.deactivate_plan_option(%s)::text', option_used)) like 'err:23503:Remove the Option from its assigned Lots%' from qt_ctx),
  (select pg_temp.run_as(admin_id, format('select valtrim.deactivate_plan_option(%s)::text', option_used)) from qt_ctx)
);

select step, name, ok, detail from qt_results order by step;

rollback;
