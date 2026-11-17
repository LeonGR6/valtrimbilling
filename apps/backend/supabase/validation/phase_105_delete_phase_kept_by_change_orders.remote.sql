-- Deleting a Phase whose Lots an Extra / Change Order points at, against the real database, inside a
-- transaction that is rolled back. Run it after migration 20261220120000; every row of the last result must
-- have ok = true. It uses Phase TEST of Job 1295 (Lots kept by the cancelled CO-0008) when it is there, and a
-- Phase of its own; the CO number sequence is put back as it was found.

begin;

create temporary table pr_results (step serial primary key, name text not null, ok boolean not null, detail text) on commit drop;
create temporary table pr_out (name text primary key, outcome text) on commit drop;
create temporary table pr_ctx (admin_id uuid, phase_id bigint, job_id bigint, free_lot bigint, own_phase bigint, own_plan bigint, co_seq_last bigint, co_seq_called boolean, draft_id bigint) on commit drop;

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


insert into pr_ctx (admin_id, phase_id, job_id, co_seq_last, co_seq_called)
select
  (select id from valtrim.app_users where role = 'ADMIN' and is_active order by created_at limit 1),
  phase.id, phase.job_id,
  (select last_value from valtrim.change_order_number_seq),
  (select is_called from valtrim.change_order_number_seq)
from valtrim.phases phase
join valtrim.jobs job on job.id = phase.job_id
where job.code = '1295' and phase.code = 'TEST' and phase.is_active
  and exists (
    select 1 from valtrim.change_order_lines line
    join valtrim.change_orders co on co.id = line.change_order_id
    where line.phase_id = phase.id and co.status = 'CANCELLED'
  )
order by phase.id desc
limit 1;

update pr_ctx set free_lot = (
  select lot.id from valtrim.lots lot
  where lot.phase_id = pr_ctx.phase_id
    and not exists (select 1 from valtrim.change_order_lines line where line.lot_id = lot.id)
  order by lot.id limit 1
);

select pg_temp.check_that('Phase TEST of Job 1295 has Lots kept by a cancelled Extra / CO, and a Lot no CO uses',
  (select admin_id is not null and phase_id is not null and free_lot is not null from pr_ctx),
  (select format('phase %s free lot %s', phase_id, free_lot) from pr_ctx)
);

-- A standing Extra / CO stops the delete, and says which.
insert into pr_out
select 'draft', pg_temp.run_as(admin_id, format(
  $q$select valtrim.create_change_order(%s, null, 'Validation 105', %L::jsonb, null, null, null, %L::jsonb)$q$,
  job_id, jsonb_build_array(jsonb_build_object('lot_id', free_lot, 'scope_of_work', 'x', 'amount', 1)),
  jsonb_build_object('mode', 'lots'))) from pr_ctx;
update pr_ctx set draft_id = nullif(regexp_replace((select outcome from pr_out where name = 'draft'), '^ok:', ''), '')::bigint;

insert into pr_out
select 'delete with draft', pg_temp.run_as(admin_id, format('select valtrim.deactivate_sequence_sheet_phase(%s)', phase_id)) from pr_ctx;

select pg_temp.check_that('a Draft Extra / CO on its Lots stops the delete and is named',
  (select outcome from pr_out where name = 'delete with draft')
    like '%23514:This Phase cannot be deleted because Extra / CO ' || (select change_order_number from valtrim.change_orders co, pr_ctx ctx where co.id = ctx.draft_id) || ' charges its Lots%'
  and (select is_active from valtrim.phases phase, pr_ctx ctx where phase.id = ctx.phase_id),
  (select outcome from pr_out where name = 'delete with draft')
);

-- Only cancelled Extras / COs left: the Phase goes, its Lots stay.
insert into pr_out
select 'delete draft', pg_temp.run_as(admin_id, format('select valtrim.delete_change_order(%s)', draft_id)) from pr_ctx;

insert into pr_out
select 'delete phase', pg_temp.run_as(admin_id, format('select valtrim.deactivate_sequence_sheet_phase(%s)', phase_id)) from pr_ctx;

select pg_temp.check_that('with only cancelled Extras / COs on its Lots, the Phase is deleted and its Lots are kept',
  (select outcome from pr_out where name = 'delete draft') like 'ok:%'
  and (select outcome from pr_out where name = 'delete phase') like 'ok:%'
  and (select not is_active from valtrim.phases phase, pr_ctx ctx where phase.id = ctx.phase_id)
  and (select count(*) > 0 from valtrim.lots lot, pr_ctx ctx where lot.phase_id = ctx.phase_id)
  and (select bool_and(exists (select 1 from valtrim.lots lot where lot.id = line.lot_id))
       from valtrim.change_order_lines line, pr_ctx ctx where line.phase_id = ctx.phase_id),
  (select string_agg(name || '=' || outcome, ' | ') from pr_out where name in ('delete draft', 'delete phase'))
);

-- A Phase no Extra / CO touches still loses its Lots.
update pr_ctx set own_plan = (select plan.id from valtrim.plans plan where plan.job_id = pr_ctx.job_id and plan.is_active order by plan.id limit 1);
select pg_temp.run_owner((select admin_id from pr_ctx), format(
  $q$insert into valtrim.phases (job_id, code, building, is_active) values (%s, 'T105', null, true)$q$, (select job_id from pr_ctx)));
update pr_ctx set own_phase = (select id from valtrim.phases where job_id = pr_ctx.job_id and code = 'T105' order by id desc limit 1);
insert into pr_out
select 'own lot', pg_temp.run_owner(admin_id, format(
  $q$insert into valtrim.lots (phase_id, job_id, plan_id, lot_number, is_reverse, display_order, is_utility_building) values (%s, %s, %s, '1', false, 1, false)$q$,
  own_phase, job_id, own_plan)) from pr_ctx;
insert into pr_out
select 'delete own', pg_temp.run_as(admin_id, format('select valtrim.deactivate_sequence_sheet_phase(%s)', own_phase)) from pr_ctx;

select pg_temp.check_that('a Phase no Extra / CO touches is deleted with its Lots, as before',
  (select outcome from pr_out where name = 'own lot') = 'ok'
  and (select outcome from pr_out where name = 'delete own') like 'ok:%'
  and not exists (select 1 from valtrim.lots lot, pr_ctx ctx where lot.phase_id = ctx.own_phase),
  (select string_agg(name || '=' || outcome, ' | ') from pr_out where name in ('own lot', 'delete own'))
);

select setval('valtrim.change_order_number_seq', co_seq_last, co_seq_called) from pr_ctx;
select pg_temp.check_that('the CO number sequence is back where it was',
  (select last_value from valtrim.change_order_number_seq) = (select co_seq_last from pr_ctx));

select step, name, ok, detail from pr_results order by step;

rollback;
