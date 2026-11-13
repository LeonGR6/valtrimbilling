-- Deleting a cancelled Extra / Change Order, against the real database, inside a transaction that is rolled
-- back. Run it after migration 20261221120000; every row of the last result must have ok = true. It works
-- on the cancelled CO-0007 and on CO-0008 made from it by a Package, when they are there, and makes an
-- approved and an invoiced one of its own; both number sequences are put back as they were found.

begin;

create temporary table pr_results (step serial primary key, name text not null, ok boolean not null, detail text) on commit drop;
create temporary table pr_out (name text primary key, outcome text) on commit drop;
create temporary table pr_ctx (admin_id uuid, maker_id uuid, parent_id bigint, child_id bigint, job_id bigint, lot_id bigint,
  approved_id bigint, invoiced_id bigint, package_id bigint, co_seq_last bigint, co_seq_called boolean, pkg_seq_last bigint, pkg_seq_called boolean) on commit drop;

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


insert into pr_ctx (admin_id, maker_id, parent_id, child_id, job_id, co_seq_last, co_seq_called, pkg_seq_last, pkg_seq_called)
select
  (select id from valtrim.app_users where role = 'ADMIN' and is_active order by created_at limit 1),
  (select id from valtrim.app_users where role = 'DRAW_INVOICE' and is_active order by created_at limit 1),
  child.source_change_order_id, child.id, child.job_id,
  (select last_value from valtrim.change_order_number_seq), (select is_called from valtrim.change_order_number_seq),
  (select last_value from valtrim.draw_package_number_seq), (select is_called from valtrim.draw_package_number_seq)
from valtrim.change_orders child
join valtrim.change_orders parent on parent.id = child.source_change_order_id
where child.status = 'CANCELLED' and parent.status = 'CANCELLED'
  and not exists (select 1 from valtrim.draw_packages p where p.change_order_id in (child.id, parent.id))
order by child.id
limit 1;

update pr_ctx set lot_id = (
  select lot.id from valtrim.lots lot join valtrim.phases phase on phase.id = lot.phase_id and phase.is_active
  where lot.job_id = pr_ctx.job_id and not lot.is_utility_building order by lot.id limit 1);

select pg_temp.check_that('there is a cancelled Extra / CO with a cancelled one made from it by a Package',
  (select parent_id is not null and child_id is not null and lot_id is not null from pr_ctx),
  (select format('parent %s child %s', parent_id, child_id) from pr_ctx));

select pg_temp.check_that('the one with Extras / COs made from it is refused, and says which',
  pg_temp.run_as((select admin_id from pr_ctx), format('select valtrim.delete_change_order(%s)', (select parent_id from pr_ctx)))
    like '%23514:Packages made Extras / COs from this one (' || (select change_order_number from valtrim.change_orders co, pr_ctx ctx where co.id = ctx.child_id) || ')%');

insert into pr_out select 'delete child', pg_temp.run_as(admin_id, format('select valtrim.delete_change_order(%s)', child_id)) from pr_ctx;
select pg_temp.check_that('the cancelled one made from a Package is deleted with its lines, charges and history',
  (select outcome from pr_out where name = 'delete child') like 'ok:%'
  and not exists (select 1 from valtrim.change_orders co, pr_ctx ctx where co.id = ctx.child_id)
  and not exists (select 1 from valtrim.change_order_lines l, pr_ctx ctx where l.change_order_id = ctx.child_id)
  and not exists (select 1 from valtrim.change_order_plan_charges c, pr_ctx ctx where c.change_order_id = ctx.child_id)
  and not exists (select 1 from valtrim.change_order_status_history h, pr_ctx ctx where h.change_order_id = ctx.child_id),
  (select outcome from pr_out where name = 'delete child'));

insert into pr_out select 'delete parent', pg_temp.run_as(admin_id, format('select valtrim.delete_change_order(%s)', parent_id)) from pr_ctx;
select pg_temp.check_that('then the cancelled one it came from is deleted too, with its rules',
  (select outcome from pr_out where name = 'delete parent') like 'ok:%'
  and not exists (select 1 from valtrim.change_orders co, pr_ctx ctx where co.id = ctx.parent_id)
  and not exists (select 1 from valtrim.change_order_plan_rules r, pr_ctx ctx where r.change_order_id = ctx.parent_id),
  (select outcome from pr_out where name = 'delete parent'));

-- An approved one is cancelled first.
insert into pr_out select 'approved', pg_temp.run_as(admin_id, format(
  $q$select valtrim.create_change_order(%s, null, 'Validation 106', %L::jsonb, null, null, null, %L::jsonb, 'APPROVED')$q$,
  job_id, jsonb_build_array(jsonb_build_object('lot_id', lot_id, 'scope_of_work', 'x', 'amount', 10)), jsonb_build_object('mode', 'lots'))) from pr_ctx;
update pr_ctx set approved_id = nullif(regexp_replace((select outcome from pr_out where name = 'approved'), '^ok:', ''), '')::bigint;
select pg_temp.check_that('an approved one cannot be deleted',
  pg_temp.run_as((select admin_id from pr_ctx), format('select valtrim.delete_change_order(%s)', (select approved_id from pr_ctx)))
    like '%23514:Only a Draft or a cancelled%');

-- One that was invoiced keeps its Package, even voided and cancelled.
insert into pr_out select 'package', pg_temp.run_as(maker_id, format('select valtrim.create_change_order_package(%s)', approved_id)) from pr_ctx;
update pr_ctx set package_id = nullif(regexp_replace((select outcome from pr_out where name = 'package'), '^ok:', ''), '')::bigint;
select pg_temp.run_owner((select admin_id from pr_ctx), format(
  $q$update valtrim.draw_packages set status = 'VOIDED', voided_at = now(), voided_by = %L, void_reason = 'Validation 106' where id = %s$q$,
  (select admin_id from pr_ctx), (select package_id from pr_ctx)));
insert into pr_out select 'cancel invoiced', pg_temp.run_as(admin_id, format($q$select valtrim.set_change_order_status(%s, 'CANCELLED', 'x')$q$, approved_id)) from pr_ctx;
select pg_temp.check_that('a cancelled one that was invoiced on a Package is refused, naming the Package',
  (select outcome from pr_out where name = 'cancel invoiced') like 'ok:%'
  and pg_temp.run_as((select admin_id from pr_ctx), format('select valtrim.delete_change_order(%s)', (select approved_id from pr_ctx)))
    like '%23514:It was invoiced on Package CP-%',
  (select string_agg(name || '=' || outcome, ' | ') from pr_out where name in ('package', 'cancel invoiced')));

select pg_temp.check_that('the line guard still keeps the lines of a cancelled one outside a delete',
  pg_temp.run_owner((select admin_id from pr_ctx), format('delete from valtrim.change_order_lines where change_order_id = %s', (select approved_id from pr_ctx)))
    like 'err:23514:%');

select setval('valtrim.change_order_number_seq', co_seq_last, co_seq_called) from pr_ctx;
select setval('valtrim.draw_package_number_seq', pkg_seq_last, pkg_seq_called) from pr_ctx;
select pg_temp.check_that('both sequences are back where they were',
  (select last_value from valtrim.change_order_number_seq) = (select co_seq_last from pr_ctx)
  and (select last_value from valtrim.draw_package_number_seq) = (select pkg_seq_last from pr_ctx));

select step, name, ok, detail from pr_results order by step;

rollback;
