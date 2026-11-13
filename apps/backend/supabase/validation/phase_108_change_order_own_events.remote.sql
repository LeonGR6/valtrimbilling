-- Extra / Change Orders: the event of each Plan and the events of their own, against the real database,
-- inside a transaction that is rolled back. Run it after migration 20261224120000; every row of the last
-- result must have ok = true. It works on a Job that has an ACTIVE Calendar activity with a DM stage, makes
-- its own Change Orders and a DM date 30 days away, and puts the CO number sequence back as it was found.

begin;

create temporary table pr_results (step serial primary key, name text not null, ok boolean not null, detail text) on commit drop;
create temporary table pr_out (name text primary key, outcome text) on commit drop;
create temporary table pr_ctx (admin_id uuid, other_id uuid, job_id bigint, activity_id bigint, stage_id bigint,
  lots bigint[], plan_id bigint, package_id bigint, approved_id bigint, draft_id bigint, plans_id bigint, child_id bigint,
  lines bigint[], event_id bigint, co_seq_last bigint, co_seq_called boolean) on commit drop;

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

create function pg_temp.id_of(p_name text)
returns bigint
language sql
as $$
  select nullif(regexp_replace((select outcome from pr_out where name = p_name), '^ok:', ''), '')::bigint;
$$;

-- A Job with an ACTIVE activity that has a DM stage, and three Lots of that activity.
insert into pr_ctx (admin_id, other_id, job_id, activity_id, stage_id, co_seq_last, co_seq_called)
select
  (select id from valtrim.app_users where role = 'ADMIN' and is_active order by created_at limit 1),
  (select id from valtrim.app_users where role = 'DRAW_INVOICE' and is_active order by created_at limit 1),
  activity.job_id, activity.id, stage.id,
  (select last_value from valtrim.change_order_number_seq), (select is_called from valtrim.change_order_number_seq)
from valtrim.production_activities activity
join valtrim.production_stages stage on stage.activity_id = activity.id and stage.stage_type = 'DM' and stage.is_enabled
join valtrim.phases phase on phase.id = activity.phase_id and phase.is_active
where activity.status = 'ACTIVE'
  and (select count(*) from valtrim.production_activity_lots activity_lot
       join valtrim.lots lot on lot.id = activity_lot.lot_id and not lot.is_utility_building
       where activity_lot.activity_id = activity.id) >= 3
order by activity.id desc
limit 1;

update pr_ctx set lots = (
  select array_agg(lot_id order by lot_id) from (
    select activity_lot.lot_id from valtrim.production_activity_lots activity_lot
    join valtrim.lots lot on lot.id = activity_lot.lot_id and not lot.is_utility_building
    where activity_lot.activity_id = pr_ctx.activity_id order by activity_lot.lot_id limit 3) chosen);
update pr_ctx set plan_id = (select plan_id from valtrim.lots where id = lots[3]);
update pr_ctx set package_id = (select id from valtrim.draw_packages where job_id = pr_ctx.job_id order by id limit 1);

select pg_temp.check_that('there is a Job with an active DM activity, 3 Lots and a Package',
  (select admin_id is not null and other_id is not null and cardinality(lots) = 3 and package_id is not null from pr_ctx),
  (select format('job %s activity %s lots %s package %s', job_id, activity_id, lots, package_id) from pr_ctx));

-- An approved Change Order with three Lot lines, none charged with an event.
insert into pr_out select 'approved', pg_temp.run_as(admin_id, format(
  $q$select valtrim.create_change_order(%s, null, 'Validation 108', %L::jsonb, null, null, null, %L::jsonb, 'APPROVED')$q$,
  job_id,
  (select jsonb_agg(jsonb_build_object('lot_id', lot_id, 'scope_of_work', 'x', 'amount', 10)) from unnest(lots) lot_id),
  jsonb_build_object('mode', 'lots'))) from pr_ctx;
update pr_ctx set approved_id = pg_temp.id_of('approved');
update pr_ctx set lines = (select array_agg(id order by line_number) from valtrim.change_order_lines where change_order_id = pr_ctx.approved_id);
select pg_temp.check_that('the approved Change Order is made with 3 lines',
  (select cardinality(lines) = 3 from pr_ctx), (select outcome from pr_out where name = 'approved'));

-- Creating an event.
insert into pr_out select 'event', pg_temp.run_as(admin_id, format(
  $q$select valtrim.create_change_order_event(%s, current_date + 10, %L::bigint[], '  Bring the ladder  ')$q$,
  approved_id, array[lines[1], lines[2]])) from pr_ctx;
update pr_ctx set event_id = pg_temp.id_of('event');
select pg_temp.check_that('an Admin schedules 2 Lots of an approved Change Order',
  (select event_id is not null from pr_ctx), (select outcome from pr_out where name = 'event'));
select pg_temp.check_that('the overview shows the event with its 2 Lots, the CO and the trimmed note',
  exists (select 1 from valtrim.change_order_event_overview overview, pr_ctx
          where overview.id = pr_ctx.event_id and overview.lot_count = 2 and overview.note = 'Bring the ladder'
            and overview.change_order_id = pr_ctx.approved_id and overview.scheduled_date = current_date + 10
            and jsonb_array_length(overview.lots) = 2 and overview.job_code is not null));

select pg_temp.check_that('a Lot already in an event is refused',
  pg_temp.run_as((select admin_id from pr_ctx), format(
    $q$select valtrim.create_change_order_event(%s, current_date + 12, %L::bigint[])$q$,
    (select approved_id from pr_ctx), (select array[lines[2], lines[3]] from pr_ctx))) like 'err:23505:%already has an event%');
select pg_temp.check_that('a date before today is refused',
  pg_temp.run_as((select admin_id from pr_ctx), format(
    $q$select valtrim.create_change_order_event(%s, current_date - 1, %L::bigint[])$q$,
    (select approved_id from pr_ctx), (select array[lines[3]] from pr_ctx))) like 'err:23514:%before today%');
select pg_temp.check_that('no date is refused',
  pg_temp.run_as((select admin_id from pr_ctx), format(
    $q$select valtrim.create_change_order_event(%s, null, %L::bigint[])$q$,
    (select approved_id from pr_ctx), (select array[lines[3]] from pr_ctx))) like 'err:23514:%Choose the date%');
select pg_temp.check_that('no Lots is refused',
  pg_temp.run_as((select admin_id from pr_ctx), format(
    $q$select valtrim.create_change_order_event(%s, current_date + 10, '{}'::bigint[])$q$,
    (select approved_id from pr_ctx))) like 'err:23514:%at least one Lot%');
select pg_temp.check_that('a note over 500 characters is refused',
  pg_temp.run_as((select admin_id from pr_ctx), format(
    $q$select valtrim.create_change_order_event(%s, current_date + 10, %L::bigint[], %L)$q$,
    (select approved_id from pr_ctx), (select array[lines[3]] from pr_ctx), repeat('x', 501))) like 'err:23514:%500 characters%');
select pg_temp.check_that('a line of another Change Order is refused',
  pg_temp.run_as((select admin_id from pr_ctx), format(
    $q$select valtrim.create_change_order_event(%s, current_date + 10, %L::bigint[])$q$,
    (select approved_id from pr_ctx),
    array[(select id from valtrim.change_order_lines where change_order_id <> (select approved_id from pr_ctx) order by id limit 1)]))
    like 'err:23514:%Lot of this Change Order%');
select pg_temp.check_that('the Draw & Invoice role cannot schedule',
  pg_temp.run_as((select other_id from pr_ctx), format(
    $q$select valtrim.create_change_order_event(%s, current_date + 10, %L::bigint[])$q$,
    (select approved_id from pr_ctx), (select array[lines[3]] from pr_ctx))) like 'err:42501:%');
select pg_temp.check_that('nobody writes the tables directly',
  pg_temp.run_as((select admin_id from pr_ctx), format(
    $q$insert into valtrim.change_order_events (change_order_id, job_id, scheduled_date) values (%s, %s, current_date) returning id$q$,
    (select approved_id from pr_ctx), (select job_id from pr_ctx))) like 'err:42501:%');

-- A Draft cannot be scheduled.
insert into pr_out select 'draft', pg_temp.run_as(admin_id, format(
  $q$select valtrim.create_change_order(%s, null, 'Validation 108', %L::jsonb, null, null, null, %L::jsonb)$q$,
  job_id, jsonb_build_array(jsonb_build_object('lot_id', lots[1], 'scope_of_work', 'x', 'amount', 10)),
  jsonb_build_object('mode', 'lots'))) from pr_ctx;
update pr_ctx set draft_id = pg_temp.id_of('draft');
select pg_temp.check_that('a Draft Change Order cannot be scheduled',
  pg_temp.run_as((select admin_id from pr_ctx), format(
    $q$select valtrim.create_change_order_event(%s, current_date + 10, %L::bigint[])$q$,
    (select draft_id from pr_ctx),
    (select array_agg(id) from valtrim.change_order_lines where change_order_id = (select draft_id from pr_ctx))))
    like 'err:23514:%Only an approved%');

-- Changing and removing.
-- (Each action runs in its own statement before it is checked: Postgres may evaluate either side of an
-- `and` first.)
insert into pr_out select 'update', pg_temp.run_as(admin_id, format(
  $q$select valtrim.update_change_order_event(%s, current_date + 14, '')$q$, event_id)) from pr_ctx;
select pg_temp.check_that('the date and the note change',
  (select outcome from pr_out where name = 'update') like 'ok:%'
  and exists (select 1 from valtrim.change_order_events event, pr_ctx
              where event.id = pr_ctx.event_id and event.scheduled_date = current_date + 14 and event.note is null));
select pg_temp.check_that('it cannot move to a date before today',
  pg_temp.run_as((select admin_id from pr_ctx), format(
    $q$select valtrim.update_change_order_event(%s, current_date - 3)$q$, (select event_id from pr_ctx))) like 'err:23514:%before today%');
select pg_temp.check_that('the Draw & Invoice role cannot change or remove it',
  pg_temp.run_as((select other_id from pr_ctx), format(
    $q$select valtrim.update_change_order_event(%s, current_date + 20)$q$, (select event_id from pr_ctx))) like 'err:42501:%'
  and pg_temp.run_as((select other_id from pr_ctx), format(
    $q$select valtrim.delete_change_order_event(%s)$q$, (select event_id from pr_ctx))) like 'err:42501:%');
insert into pr_out select 'delete', pg_temp.run_as(admin_id, format(
  $q$select valtrim.delete_change_order_event(%s)$q$, event_id)) from pr_ctx;
select pg_temp.check_that('removing it frees its Lots',
  (select outcome from pr_out where name = 'delete') like 'ok:%'
  and not exists (select 1 from valtrim.change_order_event_lots where change_order_id = (select approved_id from pr_ctx)),
  (select outcome from pr_out where name = 'delete'));
insert into pr_out select 'again', pg_temp.run_as(admin_id, format(
  $q$select valtrim.create_change_order_event(%s, current_date, %L::bigint[])$q$, approved_id, lines)) from pr_ctx;
select pg_temp.check_that('they can be scheduled again, today included',
  (select outcome from pr_out where name = 'again') like 'ok:%', (select outcome from pr_out where name = 'again'));

-- An event whose last Lot goes away goes away too.
update pr_ctx set event_id = (select id from valtrim.change_order_events where change_order_id = pr_ctx.approved_id);
delete from valtrim.change_order_event_lots where event_id = (select event_id from pr_ctx);
select pg_temp.check_that('an event left without Lots is removed',
  not exists (select 1 from valtrim.change_order_events where id = (select event_id from pr_ctx)));

-- Cancelling the Change Order takes its events off the Calendar.
select pg_temp.run_as((select admin_id from pr_ctx), format(
  $q$select valtrim.create_change_order_event(%s, current_date + 7, %L::bigint[])$q$,
  (select approved_id from pr_ctx), (select lines from pr_ctx)));
select pg_temp.check_that('the Change Order has an event before it is cancelled',
  (select count(*) = 1 from valtrim.change_order_events where change_order_id = (select approved_id from pr_ctx)));
insert into pr_out select 'cancel', pg_temp.run_as(admin_id, format(
  $q$select valtrim.set_change_order_status(%s, 'CANCELLED', 'Validation 108')$q$, approved_id)) from pr_ctx;
select pg_temp.check_that('cancelling the Change Order removes its events',
  (select outcome from pr_out where name = 'cancel') like 'ok:%'
  and not exists (select 1 from valtrim.change_order_events where change_order_id = (select approved_id from pr_ctx)));

-- The event of each Plan.
insert into pr_out select 'plans', pg_temp.run_as(admin_id, format(
  $q$select valtrim.create_change_order(
    p_job_id => %s, p_title => null, p_requested_by => 'Validation 108',
    p_lines => %L::jsonb, p_coverage => %L::jsonb, p_plan_rules => %L::jsonb)$q$,
  job_id,
  jsonb_build_array(jsonb_build_object('lot_id', lots[3], 'scope_of_work', 'x', 'amount', 10)),
  jsonb_build_object('mode', 'plans', 'planIds', jsonb_build_array(plan_id::text)),
  jsonb_build_array(jsonb_build_object('plan_id', plan_id, 'scope_of_work', 'By plan', 'amount', 25, 'billing_event', 'DM'))
)) from pr_ctx;
update pr_ctx set plans_id = pg_temp.id_of('plans');
select pg_temp.check_that('a Plan keeps the event it is charged with',
  exists (select 1 from valtrim.change_order_plan_rules where change_order_id = (select plans_id from pr_ctx) and billing_event = 'DM'),
  (select outcome from pr_out where name = 'plans'));

select pg_temp.check_that('an event other than EXT, DM or HW is refused for a Plan',
  pg_temp.run_as((select admin_id from pr_ctx), format(
    $q$select valtrim.update_change_order(
      p_change_order_id => %s, p_job_id => %s, p_title => null, p_requested_by => 'Validation 108',
      p_lines => %L::jsonb, p_coverage => %L::jsonb, p_plan_rules => %L::jsonb)$q$,
    (select plans_id from pr_ctx), (select job_id from pr_ctx),
    (select jsonb_build_array(jsonb_build_object('lot_id', lots[3], 'scope_of_work', 'x', 'amount', 10)) from pr_ctx),
    (select jsonb_build_object('mode', 'plans', 'planIds', jsonb_build_array(plan_id::text)) from pr_ctx),
    (select jsonb_build_array(jsonb_build_object('plan_id', plan_id, 'scope_of_work', 'By plan', 'amount', 25, 'billing_event', 'XX')) from pr_ctx)
  )) like 'err:23514:%EXT, DM, HW%');

insert into pr_out select 'no event', pg_temp.run_as((select admin_id from pr_ctx), format(
    $q$select valtrim.update_change_order(
      p_change_order_id => %s, p_job_id => %s, p_title => null, p_requested_by => 'Validation 108',
      p_lines => %L::jsonb, p_coverage => %L::jsonb, p_plan_rules => %L::jsonb)$q$,
    (select plans_id from pr_ctx), (select job_id from pr_ctx),
    (select jsonb_build_array(jsonb_build_object('lot_id', lots[3], 'scope_of_work', 'x', 'amount', 10)) from pr_ctx),
    (select jsonb_build_object('mode', 'plans', 'planIds', jsonb_build_array(plan_id::text)) from pr_ctx),
    (select jsonb_build_array(jsonb_build_object('plan_id', plan_id, 'scope_of_work', 'By plan', 'amount', 25)) from pr_ctx)
  ));
select pg_temp.check_that('a Plan with no event is kept empty (event of its own)',
  (select outcome from pr_out where name = 'no event') like 'ok:%'
  and exists (select 1 from valtrim.change_order_plan_rules where change_order_id = (select plans_id from pr_ctx) and billing_event is null));

-- Back to DM, approved, and a Lot charged later by a Package follows it while its DM is far away.
select pg_temp.run_as((select admin_id from pr_ctx), format(
  $q$select valtrim.update_change_order(
    p_change_order_id => %s, p_job_id => %s, p_title => null, p_requested_by => 'Validation 108',
    p_lines => %L::jsonb, p_coverage => %L::jsonb, p_plan_rules => %L::jsonb)$q$,
  (select plans_id from pr_ctx), (select job_id from pr_ctx),
  (select jsonb_build_array(jsonb_build_object('lot_id', lots[3], 'scope_of_work', 'x', 'amount', 10)) from pr_ctx),
  (select jsonb_build_object('mode', 'plans', 'planIds', jsonb_build_array(plan_id::text)) from pr_ctx),
  (select jsonb_build_array(jsonb_build_object('plan_id', plan_id, 'scope_of_work', 'By plan', 'amount', 25, 'billing_event', 'DM')) from pr_ctx)));
insert into pr_out select 'approve plans', pg_temp.run_as(admin_id, format(
  $q$select valtrim.set_change_order_status(%s, 'APPROVED')$q$, plans_id)) from pr_ctx;

-- A DM date 30 days away for the third Lot (the earliest date counts, so the others are made inactive).
update valtrim.production_schedules schedule set is_active = false
from valtrim.production_schedule_lots schedule_lot, valtrim.production_stages stage
where schedule_lot.schedule_id = schedule.id and stage.id = schedule.stage_id and stage.stage_type = 'DM'
  and schedule_lot.lot_id = (select lots[3] from pr_ctx);
with made as (
  insert into valtrim.production_schedules (stage_id, activity_id, variant, scheduled_date)
  select stage_id, activity_id,
    (select variant from valtrim.production_schedules where stage_id = pr_ctx.stage_id and variant <> 'BASEBOARD_INSTALL' limit 1),
    current_date + 30
  from pr_ctx
  returning id
)
insert into valtrim.production_schedule_lots (schedule_id, lot_id)
select made.id, (select lots[3] from pr_ctx) from made;

-- What the Package sync does: a Change Order made from a Package, and its line written while the sync is on.
select set_config('valtrim.change_order_package_sync', 'on', true);
insert into valtrim.change_orders (
  change_order_number, internal_number, builder_id, job_id, requested_by, request_date,
  status, coverage, approved_at, approved_by, source_change_order_id, source_package_id
)
select v.n, v.n, parent.builder_id, parent.job_id, parent.requested_by, current_date,
  'APPROVED', '{}'::jsonb, now(), parent.approved_by, parent.id, (select package_id from pr_ctx)
from valtrim.change_orders parent, (select private.next_change_order_number() as n) v
where parent.id = (select plans_id from pr_ctx);
update pr_ctx set child_id = (select id from valtrim.change_orders where source_change_order_id = pr_ctx.plans_id);
insert into valtrim.change_order_lines (
  change_order_id, lot_id, job_id, phase_id, line_number, phase_code, building, lot_number, plan_code, plan_name,
  scope_of_work, amount
)
select pr_ctx.child_id, lot.id, lot.job_id, lot.phase_id, 1, phase.code, phase.building, lot.lot_number, plan.code, plan.name, 'By plan', 25
from pr_ctx
join valtrim.lots lot on lot.id = pr_ctx.lots[3]
join valtrim.phases phase on phase.id = lot.phase_id
join valtrim.plans plan on plan.id = lot.plan_id;
select set_config('valtrim.change_order_package_sync', 'off', true);

select pg_temp.check_that('a Lot charged later by a Package takes the DM of its Plan, with its date',
  (select outcome from pr_out where name = 'approve plans') like 'ok:%'
  and exists (select 1 from valtrim.change_order_lines where change_order_id = (select child_id from pr_ctx)
              and billing_event = 'DM' and billing_event_date = current_date + 30),
  (select string_agg(coalesce(billing_event, 'none') || ' ' || coalesce(billing_event_date::text, ''), ', ')
   from valtrim.change_order_lines where change_order_id = (select child_id from pr_ctx)));

-- The same with the DM too close: no tie, it needs an event of its own.
update valtrim.production_schedules schedule set scheduled_date = current_date + 1
from valtrim.production_schedule_lots schedule_lot
where schedule_lot.schedule_id = schedule.id and schedule_lot.lot_id = (select lots[3] from pr_ctx) and schedule.is_active
  and schedule.scheduled_date = current_date + 30;
select set_config('valtrim.change_order_package_sync', 'on', true);
delete from valtrim.change_order_lines where change_order_id = (select child_id from pr_ctx);
insert into valtrim.change_order_lines (
  change_order_id, lot_id, job_id, phase_id, line_number, phase_code, building, lot_number, plan_code, plan_name,
  scope_of_work, amount
)
select pr_ctx.child_id, lot.id, lot.job_id, lot.phase_id, 1, phase.code, phase.building, lot.lot_number, plan.code, plan.name, 'By plan', 25
from pr_ctx
join valtrim.lots lot on lot.id = pr_ctx.lots[3]
join valtrim.phases phase on phase.id = lot.phase_id
join valtrim.plans plan on plan.id = lot.plan_id;
select set_config('valtrim.change_order_package_sync', 'off', true);
select pg_temp.check_that('with the DM too close, the Lot is left for an event of its own',
  exists (select 1 from valtrim.change_order_lines where change_order_id = (select child_id from pr_ctx) and billing_event is null));

select pg_temp.check_that('a line written outside the sync is left as it comes',
  (select count(*) = 0 from valtrim.change_order_lines line
   join valtrim.change_orders change_order on change_order.id = line.change_order_id
   where change_order.id = (select approved_id from pr_ctx) and line.billing_event is not null));

select pg_temp.check_that('the email record takes CO next to EXT, DM and HW, and nothing else',
  exists (select 1 from pg_constraint where conname = 'change_order_event_emails_events_check'
          and pg_get_constraintdef(oid) like '%''CO''%' and pg_get_constraintdef(oid) like '%<= 4%'));

select setval('valtrim.change_order_number_seq', co_seq_last, co_seq_called) from pr_ctx;
select pg_temp.check_that('the CO number sequence is back where it was',
  (select last_value from valtrim.change_order_number_seq) = (select co_seq_last from pr_ctx));

select step, name, ok, detail from pr_results order by step;

rollback;
