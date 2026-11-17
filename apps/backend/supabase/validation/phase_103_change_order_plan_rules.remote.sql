-- Extra / Change Orders by Plan charged from Packages, against the real database, inside a transaction that is
-- rolled back. Run it after migration 20261218120000; every row of the last result must have ok = true.
--
-- It takes a Job with a Plan that has at least 5 Lots never billed (and another Plan with one), makes a
-- "Specific plan types" Change Order for it, approves it and creates, edits and voids real Packages as a
-- real Draw & Invoice user (another one reads the preview). The Package sync runs when a transaction
-- commits; here it is run at each step with SET CONSTRAINTS ALL IMMEDIATE (pg_temp.flush). Nothing is left:
-- the transaction is rolled back and both number sequences are put back as they were found.
-- A run that stops halfway does not reach that last step: the CO numbers it took stay used. Put the sequence
-- back to the highest CO number afterwards (setval to the max, never to 1).

begin;

create temporary table pr_results (
  step serial primary key,
  name text not null,
  ok boolean not null,
  detail text
) on commit drop;

create temporary table pr_out (
  name text primary key,
  outcome text
) on commit drop;

create temporary table pr_ctx (
  admin_id uuid,
  maker_id uuid,
  reader_id uuid,
  job_id bigint,
  plan_id bigint,
  other_plan_id bigint,
  foreign_plan_id bigint,
  lots bigint[],
  other_lot bigint,
  draw1 smallint,
  draw2 smallint,
  co_seq_last bigint,
  co_seq_called boolean,
  pkg_seq_last bigint,
  pkg_seq_called boolean,
  parent_id bigint,
  draft_id bigint,
  package_a bigint,
  package_b bigint,
  package_c bigint,
  package_d bigint
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
create function pg_temp.child_of(p_package_id bigint)
returns bigint
language sql
as $$
  select id from valtrim.change_orders
  where source_change_order_id = (select parent_id from pr_ctx)
    and source_package_id = p_package_id
  order by id desc
  limit 1;
$$;

-- What the preview shows, read as the Admin (whoever ran the step before).
create function pg_temp.preview_lots()
returns bigint[]
language sql
as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', (select admin_id from pr_ctx)::text, 'role', 'authenticated')::text, true);
  select coalesce(array_agg(preview.lot_id order by preview.lot_id), '{}'::bigint[])
  from pr_ctx ctx,
       valtrim.package_change_order_preview(ctx.job_id, ctx.lots || ctx.other_lot) preview
  where preview.source_change_order_id = ctx.parent_id;
$$;

create function pg_temp.sorted(p_ids bigint[])
returns bigint[]
language sql
as $$ select coalesce(array_agg(id order by id), '{}'::bigint[]) from unnest(p_ids) id; $$;

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
  having count(*) >= 5
     and exists (
       select 1 from unbilled other
       where other.job_id = unbilled.job_id and other.plan_id <> unbilled.plan_id
     )
  order by (
    select count(*) from valtrim.draw_packages package
    where package.job_id = unbilled.job_id and package.package_type = 'DRAW' and package.status <> 'VOIDED'
  ) desc, unbilled.job_id, unbilled.plan_id
  limit 1
)
insert into pr_ctx (
  admin_id, maker_id, reader_id, job_id, plan_id, other_plan_id, foreign_plan_id, lots, other_lot,
  draw1, draw2, co_seq_last, co_seq_called, pkg_seq_last, pkg_seq_called
)
select
  (select id from valtrim.app_users where role = 'ADMIN' and is_active order by created_at limit 1),
  (select id from valtrim.app_users where role = 'DRAW_INVOICE' and is_active order by created_at limit 1),
  (select id from valtrim.app_users where role = 'DRAW_INVOICE' and is_active order by created_at desc limit 1),
  chosen.job_id,
  chosen.plan_id,
  (select other.plan_id from unbilled other
   where other.job_id = chosen.job_id and other.plan_id <> chosen.plan_id order by other.plan_id limit 1),
  (select plan.id from valtrim.plans plan where plan.job_id <> chosen.job_id and plan.is_active order by plan.id limit 1),
  (select array_agg(picked.id order by picked.code, picked.display_order, picked.lot_number)
   from (
     select * from unbilled own
     where own.job_id = chosen.job_id and own.plan_id = chosen.plan_id
     order by own.code, own.display_order, own.lot_number
     limit 5
   ) picked),
  null,
  (select min(draw.draw_number) from valtrim.billing_draws draw
   join valtrim.jobs job on job.billing_setup_version_id = draw.setup_version_id
   where job.id = chosen.job_id),
  (select min(draw.draw_number) from valtrim.billing_draws draw
   join valtrim.jobs job on job.billing_setup_version_id = draw.setup_version_id
   where job.id = chosen.job_id
     and draw.draw_number > (
       select min(first_draw.draw_number) from valtrim.billing_draws first_draw
       where first_draw.setup_version_id = draw.setup_version_id
     )),
  (select last_value from valtrim.change_order_number_seq),
  (select is_called from valtrim.change_order_number_seq),
  (select last_value from valtrim.draw_package_number_seq),
  (select is_called from valtrim.draw_package_number_seq)
from chosen;

update pr_ctx
set other_lot = (
  select lot.id
  from valtrim.lots lot
  join valtrim.phases phase on phase.id = lot.phase_id and phase.is_active and not phase.is_utility_building
  where lot.job_id = pr_ctx.job_id
    and lot.plan_id = pr_ctx.other_plan_id
    and not lot.is_utility_building
    and not exists (select 1 from valtrim.package_draws d where d.lot_id = lot.id)
    and not exists (select 1 from valtrim.package_options o where o.lot_id = lot.id)
  order by phase.code, lot.display_order, lot.lot_number
  limit 1
);

select pg_temp.check_that('the validation has an Admin, a Draw & Invoice user, a reader, 5 unbilled Lots of a Plan, a Lot of another Plan and two Draws',
  (select admin_id is not null and maker_id is not null and reader_id is not null and maker_id <> reader_id
          and job_id is not null and cardinality(lots) = 5 and other_lot is not null
          and foreign_plan_id is not null and draw1 is not null and draw2 is not null
   from pr_ctx),
  (select format('job %s plan %s lots %s other lot %s draws %s/%s', job_id, plan_id, lots, other_lot, draw1, draw2) from pr_ctx)
);

-- The pieces are there ------------------------------------------------------------------------------------

select pg_temp.check_that('the rules and charges tables keep RLS on and give readers SELECT only',
  (select bool_and(relrowsecurity) from pg_class where oid in ('valtrim.change_order_plan_rules'::regclass, 'valtrim.change_order_plan_charges'::regclass))
  and has_table_privilege('authenticated', 'valtrim.change_order_plan_rules', 'select')
  and not has_table_privilege('authenticated', 'valtrim.change_order_plan_rules', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.change_order_plan_charges', 'insert')
  and not has_table_privilege('anon', 'valtrim.change_order_plan_charges', 'select')
);

select pg_temp.check_that('one create and one update per schema, with the new last argument',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('valtrim', 'private') and p.proname in ('create_change_order', 'update_change_order')) = 4
  and (select bool_and(pg_get_function_identity_arguments(p.oid) like '%p_plan_rules jsonb')
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('valtrim', 'private') and p.proname in ('create_change_order', 'update_change_order'))
);

select pg_temp.check_that('authenticated may preview but not run the sync; anon may do neither',
  has_function_privilege('authenticated', 'valtrim.package_change_order_preview(bigint, bigint[])', 'execute')
  and not has_function_privilege('anon', 'valtrim.package_change_order_preview(bigint, bigint[])', 'execute')
  and not has_function_privilege('authenticated', 'private.sync_package_change_orders(bigint)', 'execute')
  and not has_function_privilege('authenticated', 'private.plan_change_order_candidates(bigint, bigint[], bigint)', 'execute')
);

select pg_temp.check_that('the three Package triggers are deferred constraint triggers',
  (select count(*) from pg_trigger
   where tgname in ('package_draws_sync_change_orders', 'package_options_sync_change_orders', 'draw_packages_sync_change_orders')
     and tgconstraint <> 0 and tgdeferrable and tginitdeferred) = 3
);

-- The Change Order with a Scope and Amount by Plan --------------------------------------------------------

insert into pr_out
select 'parent', pg_temp.run_as(
  (select admin_id from pr_ctx),
  format(
    $q$select valtrim.create_change_order(
      p_job_id => %s, p_title => null, p_requested_by => 'Validation 103',
      p_lines => %L::jsonb, p_coverage => %L::jsonb, p_status => 'DRAFT',
      p_plan_rules => %L::jsonb)$q$,
    job_id,
    jsonb_build_array(jsonb_build_object('lot_id', lots[1], 'scope_of_work', 'Existing lot', 'amount', 100)),
    jsonb_build_object('mode', 'plans', 'planIds', jsonb_build_array(plan_id::text)),
    jsonb_build_array(jsonb_build_object('plan_id', plan_id, 'scope_of_work', '  Plan rule scope ', 'amount', 250.5))
  )
) from pr_ctx;

update pr_ctx set parent_id = pg_temp.package_of('parent');

select pg_temp.check_that('a Specific plan types Change Order is saved with its Scope and Amount by Plan',
  (select parent_id is not null from pr_ctx)
  and (select count(*) = 1 and bool_and(rule.scope_of_work = 'Plan rule scope' and rule.amount = 250.50)
       from valtrim.change_order_plan_rules rule, pr_ctx ctx
       where rule.change_order_id = ctx.parent_id and rule.plan_id = ctx.plan_id),
  (select outcome from pr_out where name = 'parent')
);

-- Refusals.
create function pg_temp.try_create(p_coverage jsonb, p_rules jsonb)
returns text
language sql
as $$
  select pg_temp.run_as(
    (select admin_id from pr_ctx),
    format(
      $q$select valtrim.create_change_order(
        p_job_id => %s, p_title => null, p_requested_by => 'Validation 103',
        p_lines => %L::jsonb, p_coverage => %L::jsonb, p_plan_rules => %L::jsonb)$q$,
      (select job_id from pr_ctx),
      (select jsonb_build_array(jsonb_build_object('lot_id', lots[1], 'scope_of_work', 'x', 'amount', 1)) from pr_ctx),
      p_coverage,
      p_rules
    )
  );
$$;

select pg_temp.check_that('rules are refused on a coverage that is not Specific plan types',
  pg_temp.try_create(
    jsonb_build_object('mode', 'lots'),
    (select jsonb_build_array(jsonb_build_object('plan_id', plan_id, 'scope_of_work', 'x', 'amount', 1)) from pr_ctx)
  ) like 'err:23514:%'
);

select pg_temp.check_that('a rule for a Plan the coverage did not choose is refused',
  pg_temp.try_create(
    (select jsonb_build_object('mode', 'plans', 'planIds', jsonb_build_array(plan_id::text)) from pr_ctx),
    (select jsonb_build_array(
       jsonb_build_object('plan_id', plan_id, 'scope_of_work', 'x', 'amount', 1),
       jsonb_build_object('plan_id', other_plan_id, 'scope_of_work', 'y', 'amount', 2)) from pr_ctx)
  ) like 'err:23514:%'
);

select pg_temp.check_that('a chosen Plan without its rule is refused',
  pg_temp.try_create(
    (select jsonb_build_object('mode', 'plans', 'planIds', jsonb_build_array(plan_id::text, other_plan_id::text)) from pr_ctx),
    (select jsonb_build_array(jsonb_build_object('plan_id', plan_id, 'scope_of_work', 'x', 'amount', 1)) from pr_ctx)
  ) like 'err:23514:%'
);

select pg_temp.check_that('a rule with an Amount of zero is refused',
  pg_temp.try_create(
    (select jsonb_build_object('mode', 'plans', 'planIds', jsonb_build_array(plan_id::text)) from pr_ctx),
    (select jsonb_build_array(jsonb_build_object('plan_id', plan_id, 'scope_of_work', 'x', 'amount', 0)) from pr_ctx)
  ) like 'err:23514:%'
);

select pg_temp.check_that('a rule for a Plan of another Job is refused',
  pg_temp.try_create(
    (select jsonb_build_object('mode', 'plans', 'planIds', jsonb_build_array(foreign_plan_id::text)) from pr_ctx),
    (select jsonb_build_array(jsonb_build_object('plan_id', foreign_plan_id, 'scope_of_work', 'x', 'amount', 1)) from pr_ctx)
  ) like 'err:23503:%'
);

select pg_temp.check_that('the same Plan twice is refused',
  pg_temp.try_create(
    (select jsonb_build_object('mode', 'plans', 'planIds', jsonb_build_array(plan_id::text)) from pr_ctx),
    (select jsonb_build_array(
       jsonb_build_object('plan_id', plan_id, 'scope_of_work', 'x', 'amount', 1),
       jsonb_build_object('plan_id', plan_id, 'scope_of_work', 'y', 'amount', 2)) from pr_ctx)
  ) like 'err:23505:%'
);

-- A Draft without rules: saved (the screen of today does not send them), but it cannot be approved.
insert into pr_out
select 'draft without rules', pg_temp.run_as(
  (select admin_id from pr_ctx),
  format(
    $q$select valtrim.create_change_order(%s, null, 'Validation 103', %L::jsonb, null, null, null, %L::jsonb)$q$,
    job_id,
    jsonb_build_array(jsonb_build_object('lot_id', lots[1], 'scope_of_work', 'x', 'amount', 1)),
    jsonb_build_object('mode', 'plans', 'planIds', jsonb_build_array(plan_id::text))
  )
) from pr_ctx;

update pr_ctx set draft_id = pg_temp.package_of('draft without rules');

select pg_temp.check_that('a Draft with Specific plan types and no rules is saved, by the call of today (no p_plan_rules)',
  (select draft_id is not null from pr_ctx),
  (select outcome from pr_out where name = 'draft without rules')
);

select pg_temp.check_that('it cannot be approved without its Scope and Amount by Plan',
  pg_temp.run_as((select admin_id from pr_ctx),
    format($q$select valtrim.set_change_order_status(%s, 'APPROVED', null)$q$, (select draft_id from pr_ctx))
  ) like 'err:23514:%Scope and Amount%'
);

select pg_temp.check_that('nor created already approved without them',
  pg_temp.run_as(
    (select admin_id from pr_ctx),
    format(
      $q$select valtrim.create_change_order(%s, null, 'Validation 103', %L::jsonb, null, null, null, %L::jsonb, 'APPROVED')$q$,
      (select job_id from pr_ctx),
      (select jsonb_build_array(jsonb_build_object('lot_id', lots[1], 'scope_of_work', 'x', 'amount', 1)) from pr_ctx),
      (select jsonb_build_object('mode', 'plans', 'planIds', jsonb_build_array(plan_id::text)) from pr_ctx)
    )
  ) like 'err:23514:%Scope and Amount%'
);

insert into pr_out
select 'update draft with rules', pg_temp.run_as(
  (select admin_id from pr_ctx),
  format(
    $q$select valtrim.update_change_order(
      p_change_order_id => %s, p_job_id => %s, p_title => null, p_requested_by => 'Validation 103',
      p_lines => %L::jsonb, p_coverage => %L::jsonb, p_plan_rules => %L::jsonb)$q$,
    draft_id, job_id,
    jsonb_build_array(jsonb_build_object('lot_id', lots[1], 'scope_of_work', 'x', 'amount', 1)),
    jsonb_build_object('mode', 'plans', 'planIds', jsonb_build_array(plan_id::text)),
    jsonb_build_array(jsonb_build_object('plan_id', plan_id, 'scope_of_work', 'Edited', 'amount', 75))
  )
) from pr_ctx;

select pg_temp.check_that('editing a Draft writes its rules',
  (select outcome from pr_out where name = 'update draft with rules') like 'ok:%'
  and (select count(*) = 1 and bool_and(rule.amount = 75) from valtrim.change_order_plan_rules rule, pr_ctx ctx
       where rule.change_order_id = ctx.draft_id),
  (select outcome from pr_out where name = 'update draft with rules')
);

insert into pr_out
select 'update draft to lots', pg_temp.run_as(
  (select admin_id from pr_ctx),
  format(
    $q$select valtrim.update_change_order(%s, %s, null, 'Validation 103', %L::jsonb, null, null, null, %L::jsonb)$q$,
    draft_id, job_id,
    jsonb_build_array(jsonb_build_object('lot_id', lots[1], 'scope_of_work', 'x', 'amount', 1)),
    jsonb_build_object('mode', 'lots')
  )
) from pr_ctx;

select pg_temp.check_that('moving the Draft to Specific lots takes its rules away',
  (select outcome from pr_out where name = 'update draft to lots') like 'ok:%'
  and not exists (select 1 from valtrim.change_order_plan_rules rule, pr_ctx ctx where rule.change_order_id = ctx.draft_id),
  (select outcome from pr_out where name = 'update draft to lots')
);

insert into pr_out
select 'update draft with rules again', pg_temp.run_as(
  (select admin_id from pr_ctx),
  format(
    $q$select valtrim.update_change_order(%s, %s, null, 'Validation 103', %L::jsonb, null, null, null, %L::jsonb, null, %L::jsonb)$q$,
    draft_id, job_id,
    jsonb_build_array(jsonb_build_object('lot_id', lots[1], 'scope_of_work', 'x', 'amount', 1)),
    jsonb_build_object('mode', 'plans', 'planIds', jsonb_build_array(plan_id::text)),
    jsonb_build_array(jsonb_build_object('plan_id', plan_id, 'scope_of_work', 'Again', 'amount', 5))
  )
) from pr_ctx;

insert into pr_out
select 'delete draft', pg_temp.run_as(
  (select admin_id from pr_ctx),
  format($q$select valtrim.delete_change_order(%s)$q$, draft_id)
) from pr_ctx;

select pg_temp.check_that('a Draft with rules can be deleted, and its rules go with it',
  (select outcome from pr_out where name = 'update draft with rules again') like 'ok:%'
  and (select outcome from pr_out where name = 'delete draft') like 'ok:%'
  and not exists (select 1 from valtrim.change_order_plan_rules rule, pr_ctx ctx where rule.change_order_id = ctx.draft_id)
  and not exists (select 1 from valtrim.change_orders co, pr_ctx ctx where co.id = ctx.draft_id),
  (select outcome from pr_out where name = 'delete draft')
);

-- Approving it -----------------------------------------------------------------------------------------------

insert into pr_out
select 'approve parent', pg_temp.run_as(
  (select admin_id from pr_ctx),
  format($q$select valtrim.set_change_order_status(%s, 'APPROVED', null)$q$, parent_id)
) from pr_ctx;

select pg_temp.check_that('the Admin approves it',
  (select status = 'APPROVED' from valtrim.change_orders co, pr_ctx ctx where co.id = ctx.parent_id),
  (select outcome from pr_out where name = 'approve parent')
);

select pg_temp.check_that('its rules cannot change once it is approved',
  pg_temp.run_owner((select admin_id from pr_ctx),
    format('update valtrim.change_order_plan_rules set amount = 1 where change_order_id = %s', (select parent_id from pr_ctx))
  ) like 'err:23514:%'
);

select pg_temp.check_that('a signed-in user cannot write rules or charges directly',
  pg_temp.run_as((select admin_id from pr_ctx),
    format('insert into valtrim.change_order_plan_rules (change_order_id, plan_id, job_id, scope_of_work, amount) values (%s, %s, %s, %L, 1) returning 1',
      (select parent_id from pr_ctx), (select other_plan_id from pr_ctx), (select job_id from pr_ctx), 'x')
  ) like 'err:42501:%'
);

-- The preview ----------------------------------------------------------------------------------------------

select pg_temp.check_that('the preview shows the Lots of the Plan that are not on the CO, with the Scope and Amount of the Plan',
  pg_temp.preview_lots() = (select pg_temp.sorted(lots[2:5]) from pr_ctx)
  and (select bool_and(preview.amount = 250.50 and preview.scope_of_work = 'Plan rule scope'
                       and preview.source_change_order_number = parent.change_order_number)
       from pr_ctx ctx
       join valtrim.change_orders parent on parent.id = ctx.parent_id,
       valtrim.package_change_order_preview(ctx.job_id, ctx.lots || ctx.other_lot) preview),
  (select pg_temp.preview_lots()::text)
);

insert into pr_out
select 'preview as reader', pg_temp.run_as(
  (select reader_id from pr_ctx),
  format($q$select count(*)::text from valtrim.package_change_order_preview(%s, %L::bigint[])$q$, job_id, lots)
) from pr_ctx;

select pg_temp.check_that('another active user who is not an Admin can read the preview',
  (select outcome from pr_out where name = 'preview as reader') = 'ok:4',
  (select outcome from pr_out where name = 'preview as reader')
);

-- Package A: Lot 2 ------------------------------------------------------------------------------------------

insert into pr_out
select 'package a', pg_temp.run_as(
  maker_id,
  format('select private.create_draw_invoice_package(%s, %L::jsonb, current_date, null)',
    job_id, jsonb_build_array(jsonb_build_object('lot_id', lots[2], 'draw_number', draw1)))
) from pr_ctx;

update pr_ctx set package_a = pg_temp.package_of('package a');

insert into pr_out select 'flush a', pg_temp.flush((select maker_id from pr_ctx));

select pg_temp.check_that('Package A is created by the Draw & Invoice user and the sync runs',
  (select package_a is not null from pr_ctx) and (select outcome from pr_out where name = 'flush a') = 'ok',
  (select string_agg(name || '=' || outcome, ' | ') from pr_out where name in ('package a', 'flush a'))
);

select pg_temp.check_that('a Change Order of its own is made for Package A: approved, with Lot 2 at the Amount of its Plan',
  (select count(*) = 1
          and bool_and(co.status = 'APPROVED' and co.approved_by = ctx.admin_id and co.created_by = ctx.maker_id
                       and co.internal_number = co.change_order_number and co.requested_by = 'Validation 103'
                       and co.job_id = ctx.job_id)
   from valtrim.change_orders co, pr_ctx ctx
   where co.source_change_order_id = ctx.parent_id and co.source_package_id = ctx.package_a)
  and (select count(*) = 1 and bool_and(line.lot_id = pg_temp.lot(2) and line.amount = 250.50
                                         and line.scope_of_work = 'Plan rule scope' and line.line_number = 1)
       from valtrim.change_order_lines line
       where line.change_order_id = pg_temp.child_of((select package_a from pr_ctx)))
  and (select count(*) = 1 from valtrim.change_order_plan_charges charge, pr_ctx ctx
       where charge.package_id = ctx.package_a and charge.released_at is null and charge.lot_id = pg_temp.lot(2))
);

select pg_temp.check_that('the Package keeps its own lines: the charge is not one of them',
  (select count(*) = 1 from valtrim.package_draws draw, pr_ctx ctx where draw.package_id = ctx.package_a)
);

select pg_temp.check_that('the list shows where it came from',
  (select bool_and(overview.source_change_order_number = parent.change_order_number
                   and overview.source_package_number = package.package_number
                   and overview.total_amount = 250.50 and overview.line_count = 1)
   from pr_ctx ctx
   join valtrim.change_orders parent on parent.id = ctx.parent_id
   join valtrim.draw_packages package on package.id = ctx.package_a
   join valtrim.change_order_overview overview on overview.id = pg_temp.child_of(ctx.package_a))
);

select pg_temp.check_that('its history says it was born approved',
  (select count(*) = 1 and bool_and(history.previous_status is null and history.new_status = 'APPROVED')
   from valtrim.change_order_status_history history
   where history.change_order_id = pg_temp.child_of((select package_a from pr_ctx)))
);

select pg_temp.check_that('Lot 2 no longer shows in the preview',
  pg_temp.preview_lots() = (select pg_temp.sorted(lots[3:5]) from pr_ctx),
  (select pg_temp.preview_lots()::text)
);

select pg_temp.check_that('a Change Order made from a Package cannot be edited, nor have its source changed',
  pg_temp.run_as((select admin_id from pr_ctx),
    format($q$select valtrim.update_change_order(%s, %s, null, 'x', %L::jsonb)$q$,
      pg_temp.child_of((select package_a from pr_ctx)), (select job_id from pr_ctx),
      (select jsonb_build_array(jsonb_build_object('lot_id', lots[2], 'scope_of_work', 'x', 'amount', 1)) from pr_ctx))
  ) like 'err:23514:%'
  and pg_temp.run_owner((select admin_id from pr_ctx),
    format('update valtrim.change_orders set source_package_id = null, source_change_order_id = null where id = %s',
      pg_temp.child_of((select package_a from pr_ctx)))
  ) like 'err:23514:%'
);

-- Package B: Lot 2 again (another Draw), Lots 3 and 4 --------------------------------------------------------

insert into pr_out
select 'package b', pg_temp.run_as(
  maker_id,
  format('select private.create_draw_invoice_package(%s, %L::jsonb, current_date, null)',
    job_id, jsonb_build_array(
      jsonb_build_object('lot_id', lots[2], 'draw_number', draw2),
      jsonb_build_object('lot_id', lots[3], 'draw_number', draw1),
      jsonb_build_object('lot_id', lots[4], 'draw_number', draw1)))
) from pr_ctx;

update pr_ctx set package_b = pg_temp.package_of('package b');

insert into pr_out select 'flush b', pg_temp.flush((select maker_id from pr_ctx));

select pg_temp.check_that('Package B charges Lots 3 and 4, not Lot 2 again',
  (select package_b is not null from pr_ctx) and (select outcome from pr_out where name = 'flush b') = 'ok'
  and (select pg_temp.sorted(array_agg(line.lot_id)) from valtrim.change_order_lines line
       where line.change_order_id = pg_temp.child_of((select package_b from pr_ctx)))
      = (select pg_temp.sorted(lots[3:4]) from pr_ctx)
  and (select count(*) = 1 from valtrim.change_order_plan_charges charge, pr_ctx ctx
       where charge.lot_id = ctx.lots[2] and charge.released_at is null),
  (select string_agg(name || '=' || outcome, ' | ') from pr_out where name in ('package b', 'flush b'))
);

-- Lot 4 leaves Package B (an edit) ---------------------------------------------------------------------------

select set_config('valtrim.draw_package_correction', 'on', true);

insert into pr_out
select 'take lot 4 out', pg_temp.run_owner(
  admin_id,
  format('delete from valtrim.package_options where package_id = %s and lot_id = %s', package_b, lots[4])
) || '/' || pg_temp.run_owner(
  admin_id,
  format('delete from valtrim.package_draws where package_id = %s and lot_id = %s', package_b, lots[4])
)
from pr_ctx;

select set_config('valtrim.draw_package_correction', 'off', true);

insert into pr_out select 'flush edit', pg_temp.flush((select admin_id from pr_ctx));

select pg_temp.check_that('Lot 4 leaves Package B: its line goes, its charge is released and it shows again in the preview',
  (select outcome from pr_out where name = 'take lot 4 out') = 'ok/ok'
  and (select outcome from pr_out where name = 'flush edit') = 'ok'
  and (select array_agg(line.lot_id) from valtrim.change_order_lines line
       where line.change_order_id = pg_temp.child_of((select package_b from pr_ctx))) = array[pg_temp.lot(3)]
  and (select status = 'APPROVED' from valtrim.change_orders where id = pg_temp.child_of((select package_b from pr_ctx)))
  and (select count(*) = 1 and bool_and(charge.release_reason like 'The Lot left Package %')
       from valtrim.change_order_plan_charges charge, pr_ctx ctx
       where charge.package_id = ctx.package_b and charge.lot_id = ctx.lots[4] and charge.released_at is not null)
  and pg_temp.lot(4) = any(pg_temp.preview_lots()),
  (select string_agg(name || '=' || outcome, ' | ') from pr_out where name in ('take lot 4 out', 'flush edit'))
);

-- Package A is voided ------------------------------------------------------------------------------------------

insert into pr_out
select 'void a', pg_temp.run_owner(
  admin_id,
  format($q$update valtrim.draw_packages set status = 'VOIDED', voided_at = now(), voided_by = %L, void_reason = 'Validation 103' where id = %s$q$, admin_id, package_a)
) from pr_ctx;

insert into pr_out select 'flush void', pg_temp.flush((select admin_id from pr_ctx));

select pg_temp.check_that('voiding Package A cancels its Change Order, which keeps its line to show what it charged',
  (select outcome from pr_out where name = 'void a') = 'ok'
  and (select outcome from pr_out where name = 'flush void') = 'ok'
  and (select co.status = 'CANCELLED' and co.cancel_reason like 'Package % was voided' and co.cancelled_by = ctx.admin_id
       from valtrim.change_orders co, pr_ctx ctx where co.id = pg_temp.child_of(ctx.package_a))
  and (select count(*) = 1 from valtrim.change_order_lines line
       where line.change_order_id = pg_temp.child_of((select package_a from pr_ctx)))
  and (select bool_and(charge.released_at is not null) from valtrim.change_order_plan_charges charge, pr_ctx ctx
       where charge.package_id = ctx.package_a),
  (select string_agg(name || '=' || outcome, ' | ') from pr_out where name in ('void a', 'flush void'))
);

select pg_temp.check_that('Lot 2, given back, is charged by Package B, which still bills it (same Change Order of B)',
  (select pg_temp.sorted(array_agg(line.lot_id)) from valtrim.change_order_lines line
   where line.change_order_id = pg_temp.child_of((select package_b from pr_ctx)))
  = (select pg_temp.sorted(array[lots[2], lots[3]]) from pr_ctx)
  and (select count(*) = 1 from valtrim.change_order_plan_charges charge, pr_ctx ctx
       where charge.lot_id = ctx.lots[2] and charge.released_at is null and charge.package_id = ctx.package_b)
  and (select max(line.line_number) = 2 from valtrim.change_order_lines line
       where line.change_order_id = pg_temp.child_of((select package_b from pr_ctx)))
);

select pg_temp.check_that('the preview now shows Lots 4 and 5 only',
  pg_temp.preview_lots() = (select pg_temp.sorted(lots[4:5]) from pr_ctx),
  (select pg_temp.preview_lots()::text)
);

-- The Change Order of B is cancelled by hand ---------------------------------------------------------------

insert into pr_out
select 'cancel b by hand', pg_temp.run_as(
  admin_id,
  format($q$select valtrim.set_change_order_status(%s, 'CANCELLED', 'Validation by hand')$q$, pg_temp.child_of(package_b))
) from pr_ctx;

select pg_temp.check_that('a Change Order made from a Package cancelled by hand keeps its Lots charged',
  (select outcome from pr_out where name = 'cancel b by hand') like 'ok:%'
  and (select count(*) = 2 from valtrim.change_order_plan_charges charge, pr_ctx ctx
       where charge.package_id = ctx.package_b and charge.released_at is null)
  and pg_temp.preview_lots() = (select pg_temp.sorted(lots[4:5]) from pr_ctx),
  (select outcome from pr_out where name = 'cancel b by hand')
);

-- Package C: Lot 5 and a Lot of another Plan ------------------------------------------------------------------

insert into pr_out
select 'package c', pg_temp.run_as(
  maker_id,
  format('select private.create_draw_invoice_package(%s, %L::jsonb, current_date, null)',
    job_id, jsonb_build_array(
      jsonb_build_object('lot_id', lots[5], 'draw_number', draw1),
      jsonb_build_object('lot_id', other_lot, 'draw_number', draw1)))
) from pr_ctx;

update pr_ctx set package_c = pg_temp.package_of('package c');

insert into pr_out select 'flush c', pg_temp.flush((select maker_id from pr_ctx));

select pg_temp.check_that('Package C charges Lot 5 only: the Lot of another Plan is not charged',
  (select package_c is not null from pr_ctx) and (select outcome from pr_out where name = 'flush c') = 'ok'
  and (select array_agg(line.lot_id) from valtrim.change_order_lines line
       where line.change_order_id = pg_temp.child_of((select package_c from pr_ctx))) = array[pg_temp.lot(5)]
  and not exists (select 1 from valtrim.change_order_plan_charges charge, pr_ctx ctx where charge.lot_id = ctx.other_lot),
  (select string_agg(name || '=' || outcome, ' | ') from pr_out where name in ('package c', 'flush c'))
);

-- The rule is cancelled: Package D charges nothing ---------------------------------------------------------

insert into pr_out
select 'cancel parent', pg_temp.run_as(
  admin_id,
  format($q$select valtrim.set_change_order_status(%s, 'CANCELLED', 'Validation 103')$q$, parent_id)
) from pr_ctx;

insert into pr_out
select 'package d', pg_temp.run_as(
  maker_id,
  format('select private.create_draw_invoice_package(%s, %L::jsonb, current_date, null)',
    job_id, jsonb_build_array(jsonb_build_object('lot_id', lots[4], 'draw_number', draw1)))
) from pr_ctx;

update pr_ctx set package_d = pg_temp.package_of('package d');

insert into pr_out select 'flush d', pg_temp.flush((select maker_id from pr_ctx));

select pg_temp.check_that('once the rule is cancelled, a new Package charges nothing and the preview is empty',
  (select outcome from pr_out where name = 'cancel parent') like 'ok:%'
  and (select package_d is not null from pr_ctx) and (select outcome from pr_out where name = 'flush d') = 'ok'
  and pg_temp.child_of((select package_d from pr_ctx)) is null
  and cardinality(pg_temp.preview_lots()) = 0,
  (select string_agg(name || '=' || outcome, ' | ') from pr_out where name in ('cancel parent', 'package d', 'flush d'))
);

select pg_temp.check_that('the Change Orders already made from Packages stay as they were',
  (select status from valtrim.change_orders where id = pg_temp.child_of((select package_c from pr_ctx))) = 'APPROVED'
);

-- A Package on a Job without rules is not touched ------------------------------------------------------------

select pg_temp.check_that('no Change Order was made from a Package outside the Job of the validation',
  not exists (
    select 1 from valtrim.change_orders co, pr_ctx ctx
    where co.source_package_id is not null and co.job_id <> ctx.job_id
  )
);

-- Nothing is left ---------------------------------------------------------------------------------------------

select setval('valtrim.change_order_number_seq', co_seq_last, co_seq_called) from pr_ctx;
select setval('valtrim.draw_package_number_seq', pkg_seq_last, pkg_seq_called) from pr_ctx;

select pg_temp.check_that('both number sequences are back where they were',
  (select last_value from valtrim.change_order_number_seq) = (select co_seq_last from pr_ctx)
  and (select is_called from valtrim.change_order_number_seq) = (select co_seq_called from pr_ctx)
  and (select last_value from valtrim.draw_package_number_seq) = (select pkg_seq_last from pr_ctx)
);

select step, name, ok, detail from pr_results order by step;

rollback;
