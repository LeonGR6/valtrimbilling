-- Charging a Change Order with a Calendar event, against the real database, inside a transaction that is
-- rolled back. Run it after the migration; every row of the last result must have ok = true.
-- It borrows one READ_ONLY user as PROJECT_MANAGEMENT and one Job whose DM events are on the Calendar, moves
-- some of those dates inside the transaction, and leaves nothing behind.

begin;

create temporary table ev_results (
  step serial primary key,
  name text not null,
  ok boolean not null,
  detail text
) on commit drop;

create temporary table ev_log (
  id serial primary key,
  statement text,
  outcome text
) on commit drop;

create temporary table ev_ctx (
  admin_id uuid,
  pm_id uuid,
  job_id bigint,
  sched_a bigint,
  sched_b bigint,
  sched_c bigint,
  lot_a bigint,
  lot_b bigint,
  lot_c bigint,
  lot_d bigint,
  co_id bigint,
  co2_id bigint
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
    insert into ev_log (statement, outcome) values (p_sql, 'ok:' || coalesce(v_result, ''));
    return 'ok:' || coalesce(v_result, '');
  exception when others then
    reset role;
    insert into ev_log (statement, outcome) values (p_sql, 'err:' || sqlstate || ':' || sqlerrm);
    return 'err:' || sqlstate || ':' || sqlerrm;
  end;
end;
$$;

-- The same as the table owner, so only the triggers and constraints stand in the way.
create function pg_temp.run_sql(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return 'ok:';
exception when others then
  return 'err:' || sqlstate || ':' || sqlerrm;
end;
$$;

create function pg_temp.check_that(p_name text, p_ok boolean, p_detail text default null)
returns void
language sql
as $$
  insert into ev_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
$$;

-- The id a statement returned ('ok:12' -> 12), or null when it failed.
create function pg_temp.id_of(p_outcome text)
returns bigint
language sql
as $$
  select nullif(regexp_replace(p_outcome, '^ok:', ''), '')::bigint
  where p_outcome like 'ok:%';
$$;

insert into ev_ctx (admin_id, pm_id)
select
  (select id from valtrim.app_users where role = 'ADMIN' and is_active order by created_at limit 1),
  (select id from valtrim.app_users where role = 'READ_ONLY' and is_active order by created_at limit 1);

update valtrim.app_users set role = 'PROJECT_MANAGEMENT' where id = (select pm_id from ev_ctx);

-- A Job with three DM events of its own (three schedules), one of them over two or more Lots, and Lots that
-- have no other DM date than that one.
create temporary table ev_dm on commit drop as
select schedule.id as schedule_id, activity.job_id, schedule_lot.lot_id
from valtrim.production_schedules schedule
join valtrim.production_stages stage
  on stage.id = schedule.stage_id and stage.stage_type = 'DM' and stage.is_enabled
join valtrim.production_activities activity
  on activity.id = schedule.activity_id and activity.status = 'ACTIVE'
join valtrim.jobs job on job.id = activity.job_id and job.is_active
join valtrim.production_schedule_lots schedule_lot on schedule_lot.schedule_id = schedule.id
join valtrim.lots lot on lot.id = schedule_lot.lot_id
join valtrim.phases phase on phase.id = lot.phase_id and phase.is_active
where schedule.is_active
  and schedule.variant = 'BASE'
  and (
    select count(*)
    from valtrim.production_schedule_lots other_lot
    join valtrim.production_schedules other
      on other.id = other_lot.schedule_id and other.is_active and other.variant <> 'BASEBOARD_INSTALL'
    join valtrim.production_stages other_stage
      on other_stage.id = other.stage_id and other_stage.stage_type = 'DM' and other_stage.is_enabled
    where other_lot.lot_id = schedule_lot.lot_id
  ) = 1;

update ev_ctx set job_id = (
  select job_id
  from (select job_id, schedule_id, count(*) as lots from ev_dm group by job_id, schedule_id) per_schedule
  group by job_id
  having count(*) >= 3 and max(lots) >= 2
  order by job_id
  limit 1
);

update ev_ctx set
  sched_a = (
    select schedule_id from ev_dm
    where job_id = ev_ctx.job_id
    group by schedule_id having count(*) >= 2
    order by schedule_id limit 1
  );
update ev_ctx set
  sched_b = (select min(schedule_id) from ev_dm where job_id = ev_ctx.job_id and schedule_id <> ev_ctx.sched_a);
update ev_ctx set
  sched_c = (
    select min(schedule_id) from ev_dm
    where job_id = ev_ctx.job_id and schedule_id not in (ev_ctx.sched_a, ev_ctx.sched_b)
  );
update ev_ctx set
  lot_a = (select min(lot_id) from ev_dm where schedule_id = ev_ctx.sched_a),
  lot_d = (select max(lot_id) from ev_dm where schedule_id = ev_ctx.sched_a),
  lot_b = (select min(lot_id) from ev_dm where schedule_id = ev_ctx.sched_b),
  lot_c = (select min(lot_id) from ev_dm where schedule_id = ev_ctx.sched_c);

select pg_temp.check_that(
  'there is a cast to test with',
  (select admin_id is not null and pm_id is not null and job_id is not null
          and lot_a is not null and lot_b is not null and lot_c is not null
          and lot_d is not null and lot_a <> lot_d from ev_ctx)
);

-- The dates: A is far away, B is 3 days away, C was yesterday, D has no DM date on the Calendar.
update valtrim.production_schedules set scheduled_date = current_date + 30 where id = (select sched_a from ev_ctx);
update valtrim.production_schedules set scheduled_date = current_date + 3 where id = (select sched_b from ev_ctx);
update valtrim.production_schedules set scheduled_date = current_date - 1 where id = (select sched_c from ev_ctx);
delete from valtrim.production_schedule_lots
where schedule_id = (select sched_a from ev_ctx) and lot_id = (select lot_d from ev_ctx);

-- Business days ----------------------------------------------------------------------------------------

select pg_temp.check_that(
  'the holidays are the ones the Calendar leaves out (2024 to 2030)',
  (
    select array_agg(day::date::text order by day)
    from generate_series('2024-01-01'::date, '2030-12-31'::date, interval '1 day') as day
    where private.is_us_federal_holiday(day::date)
  ) = array[
    '2024-01-01','2024-05-27','2024-06-19','2024-07-04','2024-09-02','2024-11-28','2024-12-25',
    '2025-01-01','2025-05-26','2025-06-19','2025-07-04','2025-09-01','2025-11-27','2025-12-25',
    '2026-01-01','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25',
    '2027-01-01','2027-05-31','2027-06-18','2027-07-05','2027-09-06','2027-11-25','2027-12-24','2027-12-31',
    '2028-05-29','2028-06-19','2028-07-04','2028-09-04','2028-11-23','2028-12-25',
    '2029-01-01','2029-05-28','2029-06-19','2029-07-04','2029-09-03','2029-11-22','2029-12-25',
    '2030-01-01','2030-05-27','2030-06-19','2030-07-04','2030-09-02','2030-11-28','2030-12-25'
  ]
);

select pg_temp.check_that(
  'business days: weekends and holidays do not count',
  private.business_days_ahead('2026-11-05', '2026-11-13') = 6
  and private.business_days_ahead('2026-11-05', '2026-11-12') = 5
  and private.business_days_ahead('2026-11-06', '2026-11-09') = 1
  and private.business_days_ahead('2026-11-23', '2026-11-30') = 4
  and private.business_days_ahead('2026-11-05', '2026-11-05') = 0
  and private.business_days_ahead('2026-11-05', '2026-11-01') = 0
);

select pg_temp.check_that(
  'an event is far enough only with more than 5 business days left',
  private.change_order_event_status('2026-11-13', '2026-11-05') = 'AVAILABLE'
  and private.change_order_event_status('2026-11-12', '2026-11-05') = 'TOO_CLOSE'
  and private.change_order_event_status('2026-11-05', '2026-11-05') = 'TOO_CLOSE'
  and private.change_order_event_status('2026-11-04', '2026-11-05') = 'PASSED'
);

-- Reading the events -------------------------------------------------------------------------------------

select pg_temp.check_that(
  'the form reads the event of each Lot with its status',
  (
    select
      count(*) filter (where lot_id = (select lot_a from ev_ctx) and event_type = 'DM'
                         and event_date = current_date + 30 and event_status = 'AVAILABLE') = 1
      and count(*) filter (where lot_id = (select lot_b from ev_ctx) and event_type = 'DM'
                         and event_status = 'TOO_CLOSE' and business_days between 1 and 3) = 1
      and count(*) filter (where lot_id = (select lot_c from ev_ctx) and event_type = 'DM'
                         and event_date = current_date - 1 and event_status = 'PASSED' and business_days = 0) = 1
      and count(*) filter (where lot_id = (select lot_d from ev_ctx) and event_type = 'DM') = 0
    from valtrim.change_order_lot_events((select job_id from ev_ctx))
  )
);

select pg_temp.check_that(
  'a signed-in user can read the events through the Data API function',
  pg_temp.run_as(
    (select pm_id from ev_ctx),
    format('select count(*)::text from valtrim.change_order_lot_events(%s)', (select job_id from ev_ctx))
  ) ~ '^ok:[1-9]'
);

select pg_temp.check_that(
  'only the three billing events are read (no Shutter, no Baseboard install)',
  not exists (
    select 1 from valtrim.change_order_lot_events((select job_id from ev_ctx))
    where event_type not in ('EXT', 'DM', 'HW')
  )
);

-- Tying a line ---------------------------------------------------------------------------------------------

update ev_ctx set co_id = pg_temp.id_of(pg_temp.run_as(
  pm_id,
  format(
    $q$select valtrim.create_change_order(%s, 'Tied', 'Carlos',
      '[{"lot_id": %s, "scope_of_work": "Add", "amount": 10, "billing_event": "DM"}]'::jsonb)::text$q$,
    job_id, lot_a
  )
));

select pg_temp.check_that(
  'a Lot whose event is far away is tied to it, with the date it had',
  (select co_id is not null from ev_ctx)
  and exists (
    select 1 from valtrim.change_order_lines
    where change_order_id = (select co_id from ev_ctx)
      and billing_event = 'DM' and billing_event_date = current_date + 30
  )
);

select pg_temp.check_that(
  'a Lot whose event is too close cannot be tied, and the message names it',
  pg_temp.run_as(
    (select pm_id from ev_ctx),
    format(
      $q$select valtrim.create_change_order(%s, 'Close', 'Carlos',
        '[{"lot_id": %s, "scope_of_work": "Add", "amount": 10, "billing_event": "DM"}]'::jsonb)::text$q$,
      (select job_id from ev_ctx), (select lot_b from ev_ctx)
    )
  ) like 'err:23514:These lots cannot be charged with the Calendar event chosen: Lot % (DM is too close). Leave them%'
);

select pg_temp.check_that(
  'a Lot whose event has passed cannot be tied',
  pg_temp.run_as(
    (select pm_id from ev_ctx),
    format(
      $q$select valtrim.create_change_order(%s, 'Gone', 'Carlos',
        '[{"lot_id": %s, "scope_of_work": "Add", "amount": 10, "billing_event": "DM"}]'::jsonb)::text$q$,
      (select job_id from ev_ctx), (select lot_c from ev_ctx)
    )
  ) like 'err:23514:%Lot % (DM has already passed)%'
);

select pg_temp.check_that(
  'a Lot with no such event on the Calendar cannot be tied',
  pg_temp.run_as(
    (select pm_id from ev_ctx),
    format(
      $q$select valtrim.create_change_order(%s, 'None', 'Carlos',
        '[{"lot_id": %s, "scope_of_work": "Add", "amount": 10, "billing_event": "DM"}]'::jsonb)::text$q$,
      (select job_id from ev_ctx), (select lot_d from ev_ctx)
    )
  ) like 'err:23514:%Lot % (DM is not on the Calendar)%'
);

select pg_temp.check_that(
  'every refused Lot is listed, and nothing is saved',
  pg_temp.run_as(
    (select pm_id from ev_ctx),
    format(
      $q$select valtrim.create_change_order(%s, 'Many', 'Carlos',
        '[{"lot_id": %s, "scope_of_work": "a", "amount": 1, "billing_event": "DM"},
          {"lot_id": %s, "scope_of_work": "a", "amount": 1, "billing_event": "DM"},
          {"lot_id": %s, "scope_of_work": "a", "amount": 1, "billing_event": "DM"}]'::jsonb)::text$q$,
      (select job_id from ev_ctx), (select lot_b from ev_ctx), (select lot_c from ev_ctx), (select lot_d from ev_ctx)
    )
  ) like 'err:23514:%too close%already passed%not on the Calendar%'
  and not exists (select 1 from valtrim.change_orders where title = 'Many')
);

update ev_ctx set co2_id = pg_temp.id_of(pg_temp.run_as(
  pm_id,
  format(
    $q$select valtrim.create_change_order(%s, 'Mixed', 'Carlos',
      '[{"lot_id": %s, "scope_of_work": "Add", "amount": 10, "billing_event": "DM"},
        {"lot_id": %s, "scope_of_work": "Add", "amount": 10, "billing_event": null},
        {"lot_id": %s, "scope_of_work": "Add", "amount": 10},
        {"location": "Sales Office", "scope_of_work": "Add", "amount": 5}]'::jsonb)::text$q$,
    job_id, lot_a, lot_b, lot_c
  )
));

select pg_temp.check_that(
  'a CO can mix tied lines with lines that need an event of their own',
  (select co2_id is not null from ev_ctx)
  and (select count(*) from valtrim.change_order_lines
       where change_order_id = (select co2_id from ev_ctx) and billing_event = 'DM') = 1
  and (select count(*) from valtrim.change_order_lines
       where change_order_id = (select co2_id from ev_ctx) and billing_event is null and billing_event_date is null) = 3
);

select pg_temp.check_that(
  'only EXT, DM or HW can be chosen',
  pg_temp.run_as(
    (select pm_id from ev_ctx),
    format(
      $q$select valtrim.create_change_order(%s, 'Bad', 'Carlos',
        '[{"lot_id": %s, "scope_of_work": "Add", "amount": 10, "billing_event": "SHUTTER"}]'::jsonb)::text$q$,
      (select job_id from ev_ctx), (select lot_a from ev_ctx)
    )
  ) like 'err:23514:A line on a Lot can be charged with EXT, DM or HW%'
);

select pg_temp.check_that(
  'a line without a Lot cannot be tied to an event',
  pg_temp.run_as(
    (select pm_id from ev_ctx),
    format(
      $q$select valtrim.create_change_order(%s, 'Bad place', 'Carlos',
        '[{"location": "Sales Office", "scope_of_work": "Add", "amount": 10, "billing_event": "DM"}]'::jsonb)::text$q$,
      (select job_id from ev_ctx)
    )
  ) like 'err:23514:A line on a Lot can be charged with EXT, DM or HW%'
);

select pg_temp.check_that(
  'a tie is stored as a pair, and only on a Lot line',
  pg_temp.run_sql($q$update valtrim.change_order_lines set billing_event = 'DM', billing_event_date = null
    where change_order_id = (select co2_id from ev_ctx) and billing_event is null$q$) like 'err:23514:%'
  and pg_temp.run_sql($q$update valtrim.change_order_lines set billing_event = 'XYZ', billing_event_date = current_date
    where change_order_id = (select co2_id from ev_ctx) and billing_event is null$q$) like 'err:23514:%'
);

-- Editing --------------------------------------------------------------------------------------------------

-- The event of the tied Lot moves closer, then passes: editing something else keeps the tie.
update valtrim.production_schedules set scheduled_date = current_date + 2 where id = (select sched_a from ev_ctx);

select pg_temp.check_that(
  'a saved tie is kept when the event has moved closer',
  pg_temp.run_as(
    (select pm_id from ev_ctx),
    format(
      $q$select valtrim.update_change_order(%s, %s, 'Tied again', 'Carlos',
        '[{"lot_id": %s, "scope_of_work": "Add more", "amount": 12, "billing_event": "DM"}]'::jsonb)::text$q$,
      (select co_id from ev_ctx), (select job_id from ev_ctx), (select lot_a from ev_ctx)
    )
  ) like 'ok:%'
);

select pg_temp.check_that(
  'and its date is refreshed from the Calendar',
  exists (
    select 1 from valtrim.change_order_lines
    where change_order_id = (select co_id from ev_ctx)
      and billing_event = 'DM' and billing_event_date = current_date + 2 and amount = 12
  )
);

update valtrim.production_schedules set scheduled_date = current_date - 5 where id = (select sched_a from ev_ctx);
delete from valtrim.production_schedule_lots
where schedule_id = (select sched_a from ev_ctx) and lot_id = (select lot_a from ev_ctx);

select pg_temp.check_that(
  'a saved tie is kept even when the Calendar no longer has the event',
  pg_temp.run_as(
    (select pm_id from ev_ctx),
    format(
      $q$select valtrim.update_change_order(%s, %s, 'Tied again', 'Carlos',
        '[{"lot_id": %s, "scope_of_work": "Add more", "amount": 13, "billing_event": "DM"}]'::jsonb)::text$q$,
      (select co_id from ev_ctx), (select job_id from ev_ctx), (select lot_a from ev_ctx)
    )
  ) like 'ok:%'
);

select pg_temp.check_that(
  'and the date it had stays',
  exists (
    select 1 from valtrim.change_order_lines
    where change_order_id = (select co_id from ev_ctx)
      and billing_event = 'DM' and billing_event_date = current_date + 2 and amount = 13
  )
);

select pg_temp.check_that(
  'a tie is let go by saving the line without it',
  pg_temp.run_as(
    (select pm_id from ev_ctx),
    format(
      $q$select valtrim.update_change_order(%s, %s, 'Tied again', 'Carlos',
        '[{"lot_id": %s, "scope_of_work": "Add more", "amount": 13}]'::jsonb)::text$q$,
      (select co_id from ev_ctx), (select job_id from ev_ctx), (select lot_a from ev_ctx)
    )
  ) like 'ok:%'
);

select pg_temp.check_that(
  'and the line has no event any more',
  exists (
    select 1 from valtrim.change_order_lines
    where change_order_id = (select co_id from ev_ctx) and billing_event is null and billing_event_date is null
  )
);

select pg_temp.check_that(
  'once let go, it cannot be tied again while the event is gone',
  pg_temp.run_as(
    (select pm_id from ev_ctx),
    format(
      $q$select valtrim.update_change_order(%s, %s, 'Tied again', 'Carlos',
        '[{"lot_id": %s, "scope_of_work": "Add more", "amount": 13, "billing_event": "DM"}]'::jsonb)::text$q$,
      (select co_id from ev_ctx), (select job_id from ev_ctx), (select lot_a from ev_ctx)
    )
  ) like 'err:23514:%Lot % (DM %'
);

-- The HW event of the other Lot is in the past, so it cannot be a way in.
update valtrim.production_schedules set scheduled_date = current_date - 10
where id in (
  select schedule.id
  from valtrim.production_schedule_lots schedule_lot
  join valtrim.production_schedules schedule on schedule.id = schedule_lot.schedule_id
  join valtrim.production_stages stage on stage.id = schedule.stage_id and stage.stage_type = 'HW'
  where schedule_lot.lot_id = (select lot_b from ev_ctx)
);

select pg_temp.check_that(
  'changing the event of a tied Lot is a new tie and is checked',
  pg_temp.run_as(
    (select pm_id from ev_ctx),
    format(
      $q$select valtrim.update_change_order(%s, %s, 'Mixed', 'Carlos',
        '[{"lot_id": %s, "scope_of_work": "Add", "amount": 10, "billing_event": "DM"},
          {"lot_id": %s, "scope_of_work": "Add", "amount": 10, "billing_event": "HW"}]'::jsonb)::text$q$,
      (select co2_id from ev_ctx), (select job_id from ev_ctx), (select lot_a from ev_ctx), (select lot_b from ev_ctx)
    )
  ) like 'err:23514:%'
);

-- The CO stays as it was when an edit is refused.
select pg_temp.check_that(
  'a refused edit leaves the saved lines as they were',
  (select count(*) from valtrim.change_order_lines where change_order_id = (select co2_id from ev_ctx)) = 4
  and exists (
    select 1 from valtrim.change_order_lines
    where change_order_id = (select co2_id from ev_ctx) and billing_event = 'DM'
  )
);

select pg_temp.check_that(
  'the Data API function and the helpers are closed to anonymous users',
  has_function_privilege('authenticated', 'valtrim.change_order_lot_events(bigint)', 'execute')
  and not has_function_privilege('anon', 'valtrim.change_order_lot_events(bigint)', 'execute')
  and not has_function_privilege('anon', 'private.lot_event_dates(bigint[])', 'execute')
  and not has_function_privilege('anon', 'private.business_days_ahead(date, date)', 'execute')
);

select step, name, ok, detail from ev_results order by step;

rollback;
