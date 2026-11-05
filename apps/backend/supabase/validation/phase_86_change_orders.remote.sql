-- Behaviour of Change Orders against the real database, inside a transaction that is rolled back.
-- Run it in the SQL editor after the migration; every row of the last result must have ok = true.
-- It borrows one READ_ONLY user as PROJECT_MANAGEMENT and one active Job with Lots, and leaves nothing.

begin;

create temporary table co_results (
  step serial primary key,
  name text not null,
  ok boolean not null,
  detail text
) on commit drop;

-- The Change Orders that were already there (real ones, once the team uses them): the checks count what this script adds.
create temporary table co_baseline on commit drop as
select count(*) as n from valtrim.change_orders;

create temporary table co_ctx (
  admin_id uuid,
  pm_id uuid,
  readonly_id uuid,
  job_id bigint,
  builder_id bigint,
  lot_ids bigint[],
  other_job_id bigint,
  other_lot_id bigint,
  co_id bigint,
  admin_co_id bigint,
  loc_co_id bigint
) on commit drop;

-- Runs one statement as a signed-in user and says how it ended: 'ok:<first value>' or 'err:<sqlstate>:<message>'.
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
  insert into co_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
$$;

-- The cast: an Admin, a Project Management user (a READ_ONLY user changed for this transaction), a read-only
-- user, a Job with Lots and a Lot of another Job.
insert into co_ctx (admin_id, pm_id, readonly_id)
select
  (select id from valtrim.app_users where role = 'ADMIN' and is_active order by created_at limit 1),
  (select id from valtrim.app_users where role = 'READ_ONLY' and is_active order by created_at limit 1),
  (select id from valtrim.app_users where role = 'READ_ONLY' and is_active order by created_at desc limit 1);

update valtrim.app_users set role = 'PROJECT_MANAGEMENT' where id = (select pm_id from co_ctx);

update co_ctx set
  job_id = job.id,
  builder_id = job.builder_id,
  lot_ids = array(
    select lot.id
    from valtrim.lots lot
    join valtrim.phases phase on phase.id = lot.phase_id and phase.is_active
    where phase.job_id = job.id
    order by lot.id
    limit 4
  )
from (
  select j.id, j.builder_id
  from valtrim.jobs j
  where j.is_active
    and (
      select count(*)
      from valtrim.lots lot
      join valtrim.phases phase on phase.id = lot.phase_id and phase.is_active
      where phase.job_id = j.id
    ) >= 4
  order by j.id
  limit 1
) job;

update co_ctx set
  other_job_id = other.job_id,
  other_lot_id = other.lot_id
from (
  select lot.job_id, min(lot.id) as lot_id
  from valtrim.lots lot
  join valtrim.phases phase on phase.id = lot.phase_id and phase.is_active
  join valtrim.jobs other_job on other_job.id = lot.job_id and other_job.is_active
  where lot.job_id <> (select job_id from co_ctx)
  group by lot.job_id
  order by lot.job_id
  limit 1
) other;

select pg_temp.check_that(
  'there is a cast to test with',
  (select admin_id is not null and pm_id is not null and readonly_id is not null
          and pm_id <> readonly_id and job_id is not null and cardinality(lot_ids) = 4
          and other_lot_id is not null from co_ctx)
);

-- Creating ------------------------------------------------------------------------------------------

select pg_temp.check_that(
  'a read-only user cannot create a Change Order',
  pg_temp.run_as(
    (select readonly_id from co_ctx),
    format(
      $q$select valtrim.create_change_order(%s, 'Attic ladder', 'Carlos', '[{"lot_id": %s, "scope_of_work": "Add", "amount": 10}]'::jsonb)::text$q$,
      (select job_id from co_ctx), (select lot_ids[1] from co_ctx)
    )
  ) like 'err:42501:%'
);

update co_ctx set co_id = nullif(
  regexp_replace(
    pg_temp.run_as(
      pm_id,
      format(
        $q$select valtrim.create_change_order(
          %s, '  Attic ladder  ', 'Carlos Ramirez',
          '[
            {"lot_id": %s, "scope_of_work": "Add attic ladder", "amount": 10, "po_number": " PO-77 "},
            {"lot_id": %s, "scope_of_work": "Add attic ladder", "amount": -30.25, "po_number": ""},
            {"lot_id": %s, "scope_of_work": "Add attic ladder", "amount": 1689.6}
          ]'::jsonb,
          'E-2026-0047', date '2026-11-01', date '2026-11-20',
          '{"mode": "lots", "lotIds": [1, 2]}'::jsonb
        )::text$q$,
        job_id, lot_ids[1], lot_ids[2], lot_ids[3]
      )
    ),
    '^ok:', ''
  ),
  ''
)::bigint;

select pg_temp.check_that(
  'Project Management creates a Change Order with three lines',
  (select co_id is not null from co_ctx),
  (select co_id::text from co_ctx)
);

select pg_temp.check_that(
  'it is a Draft with a CO-0001 style number, the Builder of the Job and trimmed text',
  (
    select change_order.status = 'DRAFT'
      and change_order.change_order_number ~ '^CO-[0-9]{4,}$'
      and change_order.builder_id = ctx.builder_id
      and change_order.title = 'Attic ladder'
      and change_order.internal_number = 'E-2026-0047'
      and change_order.requested_by = 'Carlos Ramirez'
      and change_order.created_by = ctx.pm_id
      and change_order.coverage->>'mode' = 'lots'
    from valtrim.change_orders change_order
    join co_ctx ctx on ctx.co_id = change_order.id
  )
);

select pg_temp.check_that(
  'the lines keep their order, labels, credit and PO (blank means none)',
  (
    select count(*) = 3
      and bool_and(line.job_id = ctx.job_id)
      and sum(line.amount) = 1669.35
      and min(line.amount) = -30.25
      and min(line.line_number) = 1 and max(line.line_number) = 3
      and bool_and(line.lot_number = lot.lot_number and line.phase_code = phase.code)
      and bool_and(line.plan_code = plan.code and line.plan_name = plan.name)
      and count(line.po_number) = 1
      and max(line.po_number) = 'PO-77'
    from valtrim.change_order_lines line
    join co_ctx ctx on ctx.co_id = line.change_order_id
    join valtrim.lots lot on lot.id = line.lot_id
    join valtrim.phases phase on phase.id = lot.phase_id
    join valtrim.plans plan on plan.id = lot.plan_id
  )
);

select pg_temp.check_that(
  'the history starts with the Draft',
  (
    select count(*) = 1 and bool_and(history.previous_status is null and history.new_status = 'DRAFT'
                                     and history.changed_by = ctx.pm_id)
    from valtrim.change_order_status_history history
    join co_ctx ctx on ctx.co_id = history.change_order_id
  )
);

select pg_temp.check_that(
  'the overview adds up the lines',
  (
    select overview.line_count = 3 and overview.total_amount = 1669.35
      and overview.job_code is not null and overview.builder_name is not null
    from valtrim.change_order_overview overview
    join co_ctx ctx on ctx.co_id = overview.id
  )
);

-- Bad lines are refused and leave nothing behind ---------------------------------------------------

create temporary table co_bad (name text, lines text, expected text) on commit drop;
insert into co_bad values
  ('an Amount of zero', '[{"lot_id": {L1}, "scope_of_work": "x", "amount": 0}]', 'err:23514:%'),
  ('an Amount with three decimals', '[{"lot_id": {L1}, "scope_of_work": "x", "amount": 1.234}]', 'err:23514:%'),
  ('an Amount given as text', '[{"lot_id": {L1}, "scope_of_work": "x", "amount": "5"}]', 'err:23514:%'),
  ('a missing Scope of Work', '[{"lot_id": {L1}, "scope_of_work": "  ", "amount": 5}]', 'err:23514:%'),
  ('a Scope of Work over 1000 characters', '[{"lot_id": {L1}, "scope_of_work": "' || repeat('x', 1001) || '", "amount": 5}]', 'err:23514:%'),
  ('a PO number over 60 characters', '[{"lot_id": {L1}, "scope_of_work": "x", "amount": 5, "po_number": "' || repeat('9', 61) || '"}]', 'err:23514:%'),
  ('no lines', '[]', 'err:23514:%'),
  ('lines that are not an array', '{}', 'err:23514:%'),
  ('the same Lot twice', '[{"lot_id": {L1}, "scope_of_work": "x", "amount": 5}, {"lot_id": {L1}, "scope_of_work": "y", "amount": 6}]', 'err:23505:%'),
  ('a Lot of another Job', '[{"lot_id": {OTHER}, "scope_of_work": "x", "amount": 5}]', 'err:23503:%'),
  ('a Lot that does not exist', '[{"lot_id": 999999999, "scope_of_work": "x", "amount": 5}]', 'err:23503:%'),
  ('a line with a Lot and a location', '[{"lot_id": {L1}, "location": "Sales Office", "scope_of_work": "x", "amount": 5}]', 'err:23514:%'),
  ('a line with neither a Lot nor a location', '[{"scope_of_work": "x", "amount": 5}]', 'err:23514:%'),
  ('a blank location', '[{"location": "   ", "scope_of_work": "x", "amount": 5}]', 'err:23514:%'),
  ('a location over 100 characters', '[{"location": "' || repeat('x', 101) || '", "scope_of_work": "x", "amount": 5}]', 'err:23514:%'),
  ('a location that is not text', '[{"location": 5, "scope_of_work": "x", "amount": 5}]', 'err:23514:%'),
  ('a Lot given as text', '[{"lot_id": "5", "scope_of_work": "x", "amount": 5}]', 'err:23514:%'),
  ('a location with an Amount of zero', '[{"location": "Sales Office", "scope_of_work": "x", "amount": 0}]', 'err:23514:%');

select pg_temp.check_that(
  'refused: ' || bad.name,
  pg_temp.run_as(
    ctx.pm_id,
    format(
      $q$select valtrim.create_change_order(%s, 'Bad', 'Carlos', %L::jsonb)::text$q$,
      ctx.job_id,
      replace(replace(bad.lines, '{L1}', ctx.lot_ids[1]::text), '{OTHER}', ctx.other_lot_id::text)
    )
  ) like bad.expected,
  pg_temp.run_as(
    ctx.pm_id,
    format(
      $q$select valtrim.create_change_order(%s, 'Bad', 'Carlos', %L::jsonb)::text$q$,
      ctx.job_id,
      replace(replace(bad.lines, '{L1}', ctx.lot_ids[1]::text), '{OTHER}', ctx.other_lot_id::text)
    )
  )
)
from co_bad bad
cross join co_ctx ctx;

create temporary table co_bad_headers (name text, call text) on commit drop;
insert into co_bad_headers values
  ('an empty title', $q$select valtrim.create_change_order({JOB}, '  ', 'Carlos', {LINES}::jsonb)::text$q$),
  ('nobody who requested it', $q$select valtrim.create_change_order({JOB}, 'T', '', {LINES}::jsonb)::text$q$),
  ('a needed-by date before the request date', $q$select valtrim.create_change_order({JOB}, 'T', 'C', {LINES}::jsonb, null, date '2026-11-10', date '2026-11-01')::text$q$),
  ('a coverage that is not an object', $q$select valtrim.create_change_order({JOB}, 'T', 'C', {LINES}::jsonb, null, null, null, '[1]'::jsonb)::text$q$),
  ('a coverage mode that does not exist', $q$select valtrim.create_change_order({JOB}, 'T', 'C', {LINES}::jsonb, null, null, null, '{"mode": "x"}'::jsonb)::text$q$),
  ('a Job that does not exist', $q$select valtrim.create_change_order(999999999, 'T', 'C', {LINES}::jsonb)::text$q$),
  ('a Cancelled status', $q$select valtrim.create_change_order({JOB}, 'T', 'C', {LINES}::jsonb, null, null, null, null, 'CANCELLED')::text$q$);

select pg_temp.check_that(
  'refused: ' || header.name,
  pg_temp.run_as(
    ctx.pm_id,
    replace(replace(header.call, '{JOB}', ctx.job_id::text),
            '{LINES}', quote_literal(format('[{"lot_id": %s, "scope_of_work": "x", "amount": 5}]', ctx.lot_ids[1])))
  ) like 'err:%',
  pg_temp.run_as(
    ctx.pm_id,
    replace(replace(header.call, '{JOB}', ctx.job_id::text),
            '{LINES}', quote_literal(format('[{"lot_id": %s, "scope_of_work": "x", "amount": 5}]', ctx.lot_ids[1])))
  )
)
from co_bad_headers header
cross join co_ctx ctx;

select pg_temp.check_that(
  'nothing was left behind by the refused calls',
  (select count(*) = (select n from co_baseline) + 1 from valtrim.change_orders),
  (select count(*)::text from valtrim.change_orders)
);

-- Approving at creation is for Admins ----------------------------------------------------------------

select pg_temp.check_that(
  'Project Management cannot create a Change Order already approved',
  pg_temp.run_as(
    (select pm_id from co_ctx),
    format(
      $q$select valtrim.create_change_order(%s, 'T', 'C', '[{"lot_id": %s, "scope_of_work": "x", "amount": 5}]'::jsonb, null, null, null, null, 'APPROVED')::text$q$,
      (select job_id from co_ctx), (select lot_ids[4] from co_ctx)
    )
  ) like 'err:42501:%'
);

update co_ctx set admin_co_id = nullif(
  regexp_replace(
    pg_temp.run_as(
      admin_id,
      format(
        $q$select valtrim.create_change_order(%s, 'Approved from the start', 'Builder', '[{"lot_id": %s, "scope_of_work": "x", "amount": 5}]'::jsonb, null, null, null, null, 'APPROVED')::text$q$,
        job_id, lot_ids[1]
      )
    ),
    '^ok:', ''
  ),
  ''
)::bigint;

select pg_temp.check_that(
  'an Admin creates it already approved, with who and when',
  (
    select change_order.status = 'APPROVED'
      and change_order.approved_by = ctx.admin_id and change_order.approved_at is not null
    from valtrim.change_orders change_order
    join co_ctx ctx on ctx.admin_co_id = change_order.id
  )
);

select pg_temp.check_that(
  'the same Lot can be in another Change Order',
  (select count(distinct change_order_id) = 2
   from valtrim.change_order_lines
   where lot_id = (select lot_ids[1] from co_ctx))
);

-- Editing --------------------------------------------------------------------------------------------

select pg_temp.check_that(
  'Project Management edits the header and replaces the lines of a Draft',
  pg_temp.run_as(
    (select pm_id from co_ctx),
    format(
      $q$select valtrim.update_change_order(%s, %s, 'New title', 'Maria', '[
        {"lot_id": %s, "scope_of_work": "Only this", "amount": 250.5, "po_number": "PO-1"},
        {"lot_id": %s, "scope_of_work": "And this", "amount": 99}
      ]'::jsonb, null, null, null, '{"mode": "phase"}'::jsonb)::text$q$,
      (select co_id from co_ctx), (select job_id from co_ctx), (select lot_ids[2] from co_ctx), (select lot_ids[1] from co_ctx)
    )
  ) like 'ok:%'
);

select pg_temp.check_that(
  'the edit left two lines, the new header and no internal number',
  (
    select change_order.title = 'New title' and change_order.requested_by = 'Maria'
      and change_order.internal_number is null and change_order.coverage->>'mode' = 'phase'
      and change_order.updated_by = ctx.pm_id
      and (select count(*) from valtrim.change_order_lines line where line.change_order_id = change_order.id) = 2
      and (select sum(line.amount) from valtrim.change_order_lines line where line.change_order_id = change_order.id) = 349.5
      and (select min(line.line_number) from valtrim.change_order_lines line where line.change_order_id = change_order.id) = 1
    from valtrim.change_orders change_order
    join co_ctx ctx on ctx.co_id = change_order.id
  )
);

select pg_temp.check_that(
  'a read-only user cannot edit',
  pg_temp.run_as(
    (select readonly_id from co_ctx),
    format(
      $q$select valtrim.update_change_order(%s, %s, 'Hack', 'x', '[{"lot_id": %s, "scope_of_work": "x", "amount": 1}]'::jsonb)::text$q$,
      (select co_id from co_ctx), (select job_id from co_ctx), (select lot_ids[1] from co_ctx)
    )
  ) like 'err:42501:%'
);

select pg_temp.check_that(
  'a refused edit keeps the old lines',
  pg_temp.run_as(
    (select pm_id from co_ctx),
    format(
      $q$select valtrim.update_change_order(%s, %s, 'T', 'x', '[{"lot_id": %s, "scope_of_work": "x", "amount": 0}]'::jsonb)::text$q$,
      (select co_id from co_ctx), (select job_id from co_ctx), (select lot_ids[1] from co_ctx)
    )
  ) like 'err:23514:%'
  and (select count(*) = 2 from valtrim.change_order_lines where change_order_id = (select co_id from co_ctx))
);

select pg_temp.check_that(
  'the Job of a Draft can change when its lines move with it',
  pg_temp.run_as(
    (select pm_id from co_ctx),
    format(
      $q$select valtrim.update_change_order(%s, %s, 'Other job', 'x', '[{"lot_id": %s, "scope_of_work": "x", "amount": 1}]'::jsonb)::text$q$,
      (select co_id from co_ctx), (select other_job_id from co_ctx), (select other_lot_id from co_ctx)
    )
  ) like 'ok:%'
);

-- Separate statement: one that calls the writer cannot see what the writer just did.
select pg_temp.check_that(
  'the Change Order now belongs to the other Job and to its Builder',
  (select job_id = (select other_job_id from co_ctx)
         and builder_id = (select builder_id from valtrim.jobs where id = (select other_job_id from co_ctx))
         and (select count(*) from valtrim.change_order_lines line where line.change_order_id = change_orders.id
                and line.job_id = change_orders.job_id) = 1
       from valtrim.change_orders where id = (select co_id from co_ctx))
);

select pg_temp.check_that(
  'and it can come back to the first Job',
  pg_temp.run_as(
    (select pm_id from co_ctx),
    format(
      $q$select valtrim.update_change_order(%s, %s, 'Back', 'x', '[{"lot_id": %s, "scope_of_work": "x", "amount": 5}, {"lot_id": %s, "scope_of_work": "x", "amount": 7}]'::jsonb)::text$q$,
      (select co_id from co_ctx), (select job_id from co_ctx), (select lot_ids[1] from co_ctx), (select lot_ids[2] from co_ctx)
    )
  ) like 'ok:%'
);

-- Status ---------------------------------------------------------------------------------------------

select pg_temp.check_that(
  'Project Management sends a Draft to Pending',
  pg_temp.run_as((select pm_id from co_ctx),
    format($q$select valtrim.set_change_order_status(%s, 'PENDING')::text$q$, (select co_id from co_ctx))) like 'ok:%'
);

select pg_temp.check_that(
  'a Pending Change Order can still be edited',
  pg_temp.run_as(
    (select pm_id from co_ctx),
    format(
      $q$select valtrim.update_change_order(%s, %s, 'Still editable', 'x', '[{"lot_id": %s, "scope_of_work": "x", "amount": 5}]'::jsonb)::text$q$,
      (select co_id from co_ctx), (select job_id from co_ctx), (select lot_ids[1] from co_ctx)
    )
  ) like 'ok:%'
);

select pg_temp.check_that(
  'Project Management cannot approve',
  pg_temp.run_as((select pm_id from co_ctx),
    format($q$select valtrim.set_change_order_status(%s, 'APPROVED')::text$q$, (select co_id from co_ctx))) like 'err:42501:%'
);

select pg_temp.check_that(
  'a read-only user cannot change the status',
  pg_temp.run_as((select readonly_id from co_ctx),
    format($q$select valtrim.set_change_order_status(%s, 'DRAFT')::text$q$, (select co_id from co_ctx))) like 'err:42501:%'
);

select pg_temp.check_that(
  'a Pending Change Order goes back to Draft and again to Pending',
  pg_temp.run_as((select pm_id from co_ctx),
    format($q$select valtrim.set_change_order_status(%s, 'DRAFT')::text$q$, (select co_id from co_ctx))) like 'ok:%'
  and pg_temp.run_as((select pm_id from co_ctx),
    format($q$select valtrim.set_change_order_status(%s, 'PENDING')::text$q$, (select co_id from co_ctx))) like 'ok:%'
);

select pg_temp.check_that(
  'the same status twice is refused',
  pg_temp.run_as((select pm_id from co_ctx),
    format($q$select valtrim.set_change_order_status(%s, 'PENDING')::text$q$, (select co_id from co_ctx))) like 'err:23514:%'
);

select pg_temp.check_that(
  'an Admin approves it, with who and when',
  pg_temp.run_as((select admin_id from co_ctx),
    format($q$select valtrim.set_change_order_status(%s, 'APPROVED')::text$q$, (select co_id from co_ctx))) like 'ok:%'
);

select pg_temp.check_that(
  'it says who approved and when',
  (select status = 'APPROVED' and approved_by = (select admin_id from co_ctx) and approved_at is not null
   from valtrim.change_orders where id = (select co_id from co_ctx))
);

select pg_temp.check_that(
  'an approved Change Order cannot be edited, not even its lines',
  pg_temp.run_as(
    (select admin_id from co_ctx),
    format(
      $q$select valtrim.update_change_order(%s, %s, 'No', 'x', '[{"lot_id": %s, "scope_of_work": "x", "amount": 5}]'::jsonb)::text$q$,
      (select co_id from co_ctx), (select job_id from co_ctx), (select lot_ids[1] from co_ctx)
    )
  ) like 'err:23514:%'
);

select pg_temp.check_that(
  'the database itself refuses to change an approved Change Order or its lines',
  pg_temp.run_sql(format($q$update valtrim.change_orders set title = 'Sneaky' where id = %s$q$, (select co_id from co_ctx))) like 'err:23514:%'
  and pg_temp.run_sql(format($q$delete from valtrim.change_order_lines where change_order_id = %s$q$, (select co_id from co_ctx))) like 'err:23514:%'
  and pg_temp.run_sql(format($q$update valtrim.change_order_lines set amount = 1 where change_order_id = %s$q$, (select co_id from co_ctx))) like 'err:23514:%'
  and pg_temp.run_sql(format($q$update valtrim.change_orders set change_order_number = 'CO-9' where id = %s$q$, (select co_id from co_ctx))) like 'err:23514:%'
);

select pg_temp.check_that(
  'Project Management cannot cancel an approved Change Order',
  pg_temp.run_as((select pm_id from co_ctx),
    format($q$select valtrim.set_change_order_status(%s, 'CANCELLED', 'Changed our minds')::text$q$, (select co_id from co_ctx))) like 'err:42501:%'
);

select pg_temp.check_that(
  'cancelling needs a reason',
  pg_temp.run_as((select admin_id from co_ctx),
    format($q$select valtrim.set_change_order_status(%s, 'CANCELLED', '  ')::text$q$, (select co_id from co_ctx))) like 'err:23514:%'
);

select pg_temp.check_that(
  'an Admin cancels an approved Change Order with a reason',
  pg_temp.run_as((select admin_id from co_ctx),
    format($q$select valtrim.set_change_order_status(%s, 'CANCELLED', 'Builder dropped the extra')::text$q$, (select co_id from co_ctx))) like 'ok:%'
);

select pg_temp.check_that(
  'it keeps the reason, who cancelled and when it was approved',
  (select status = 'CANCELLED' and cancel_reason = 'Builder dropped the extra'
         and cancelled_by = (select admin_id from co_ctx) and cancelled_at is not null and approved_at is not null
   from valtrim.change_orders where id = (select co_id from co_ctx))
);

select pg_temp.check_that(
  'a Cancelled Change Order is final',
  pg_temp.run_as((select admin_id from co_ctx),
    format($q$select valtrim.set_change_order_status(%s, 'DRAFT')::text$q$, (select co_id from co_ctx))) like 'err:23514:%'
);

select pg_temp.check_that(
  'the history tells the whole story in order, with the reason',
  (
    select array_agg(history.new_status::text order by history.id)
         = array['DRAFT', 'PENDING', 'DRAFT', 'PENDING', 'APPROVED', 'CANCELLED']
       and max(history.note) = 'Builder dropped the extra'
    from valtrim.change_order_status_history history
    where history.change_order_id = (select co_id from co_ctx)
  )
);

-- The browser cannot write by itself ------------------------------------------------------------------

select pg_temp.check_that(
  'a signed-in user cannot insert, update or delete a Change Order or a line directly',
  pg_temp.run_as((select admin_id from co_ctx),
    $q$insert into valtrim.change_orders (title, builder_id, job_id, requested_by) select 'x', builder_id, id, 'x' from valtrim.jobs limit 1$q$) like 'err:42501:%'
  and pg_temp.run_as((select admin_id from co_ctx),
    $q$update valtrim.change_orders set title = 'x'$q$) like 'err:42501:%'
  and pg_temp.run_as((select admin_id from co_ctx), $q$delete from valtrim.change_order_lines$q$) like 'err:42501:%'
  and pg_temp.run_as((select admin_id from co_ctx), $q$delete from valtrim.change_order_status_history$q$) like 'err:42501:%'
);

select pg_temp.check_that(
  'every active user reads them',
  pg_temp.run_as((select readonly_id from co_ctx),
    $q$select count(*)::text from valtrim.change_order_overview where line_count > 0$q$) similar to 'ok:[1-9][0-9]*'
  and pg_temp.run_as((select readonly_id from co_ctx),
    $q$select count(*)::text from valtrim.change_order_lines$q$) similar to 'ok:[1-9][0-9]*'
);

-- Lines for a place with no Lot (Sales Office, Restroom) ----------------------------------------------

update co_ctx set loc_co_id = nullif(
  regexp_replace(
    pg_temp.run_as(
      pm_id,
      format(
        $q$select valtrim.create_change_order(
          %s, 'Sales Office and Restroom', 'Carlos Ramirez',
          '[
            {"lot_id": %s, "scope_of_work": "Add attic ladder", "amount": 100},
            {"location": "  Sales Office ", "scope_of_work": "Electronic locks", "amount": 250.5},
            {"location": "Restroom", "scope_of_work": "Credit for the old locks", "amount": -20}
          ]'::jsonb
        )::text$q$,
        job_id, lot_ids[3]
      )
    ),
    '^ok:', ''
  ),
  ''
)::bigint;

select pg_temp.check_that(
  'Project Management creates a Change Order with a Lot and two places',
  (select loc_co_id is not null from co_ctx),
  (select loc_co_id::text from co_ctx)
);

select pg_temp.check_that(
  'the Lot line keeps its labels and the place lines keep only their text, trimmed, in order',
  (
    select count(*) = 3
      and count(*) filter (where line.lot_id is not null) = 1
      and count(*) filter (where line.location is not null) = 2
      and bool_and(line.job_id = ctx.job_id)
      and sum(line.amount) = 330.5
      and min(line.line_number) = 1 and max(line.line_number) = 3
      and max(line.lot_id) filter (where line.line_number = 1) = (select lot_ids[3] from co_ctx)
      and max(line.location) filter (where line.line_number = 2) = 'Sales Office'
      and max(line.location) filter (where line.line_number = 3) = 'Restroom'
      and bool_and(
        case
          when line.lot_id is null then
            line.phase_id is null and line.phase_code is null and line.building is null
            and line.lot_number is null and line.plan_code is null and line.plan_name is null
          else
            line.phase_id is not null and line.phase_code is not null and line.lot_number is not null
            and line.plan_code is not null and line.plan_name is not null and line.location is null
        end
      )
    from valtrim.change_order_lines line
    join co_ctx ctx on ctx.loc_co_id = line.change_order_id
  )
);

select pg_temp.check_that(
  'the overview adds up Lot lines and place lines together',
  (
    select overview.line_count = 3 and overview.total_amount = 330.5
    from valtrim.change_order_overview overview
    join co_ctx ctx on ctx.loc_co_id = overview.id
  )
);

select pg_temp.check_that(
  'the table itself refuses a line with a Lot and a location, or with neither',
  pg_temp.run_sql(format(
    $q$insert into valtrim.change_order_lines (
         change_order_id, lot_id, job_id, phase_id, line_number, phase_code, lot_number, plan_code, plan_name,
         location, scope_of_work, amount)
       select %s, lot.id, lot.job_id, lot.phase_id, 90, 'P', lot.lot_number, 'x', 'x', 'Sales Office', 'x', 5
       from valtrim.lots lot where lot.id = %s$q$,
    (select loc_co_id from co_ctx), (select lot_ids[4] from co_ctx)
  )) like 'err:23514:%'
  and pg_temp.run_sql(format(
    $q$insert into valtrim.change_order_lines (change_order_id, job_id, line_number, scope_of_work, amount)
       values (%s, %s, 91, 'x', 5)$q$,
    (select loc_co_id from co_ctx), (select job_id from co_ctx)
  )) like 'err:23514:%'
  and pg_temp.run_sql(format(
    $q$insert into valtrim.change_order_lines (change_order_id, job_id, line_number, scope_of_work, amount, location, phase_code)
       values (%s, %s, 92, 'x', 5, 'Sales Office', 'P1')$q$,
    (select loc_co_id from co_ctx), (select job_id from co_ctx)
  )) like 'err:23514:%'
);

select pg_temp.check_that(
  'the table itself still allows a Lot only once in a Change Order',
  pg_temp.run_sql(format(
    $q$insert into valtrim.change_order_lines (
         change_order_id, lot_id, job_id, phase_id, line_number, phase_code, lot_number, plan_code, plan_name,
         scope_of_work, amount)
       select %s, lot.id, lot.job_id, lot.phase_id, 93, 'P', lot.lot_number, 'x', 'x', 'x', 5
       from valtrim.lots lot where lot.id = %s$q$,
    (select loc_co_id from co_ctx), (select lot_ids[3] from co_ctx)
  )) like 'err:23505:%'
);

select pg_temp.check_that(
  'but the same text can be the place of many lines',
  pg_temp.run_as(
    (select pm_id from co_ctx),
    format(
      $q$select valtrim.update_change_order(%s, %s, 'Sales Office twice', 'Carlos Ramirez', '[
        {"location": "Sales Office", "scope_of_work": "Electronic locks", "amount": 250.5, "po_number": "PO-9"},
        {"location": "Sales Office", "scope_of_work": "Window film", "amount": 80},
        {"lot_id": %s, "scope_of_work": "Add attic ladder", "amount": 100}
      ]'::jsonb)::text$q$,
      (select loc_co_id from co_ctx), (select job_id from co_ctx), (select lot_ids[3] from co_ctx)
    )
  ) like 'ok:%'
);

select pg_temp.check_that(
  'the edit replaced the lines and kept the order and the PO number',
  (
    select count(*) = 3
      and count(*) filter (where line.location = 'Sales Office') = 2
      and max(line.lot_id) filter (where line.line_number = 3) = (select lot_ids[3] from co_ctx)
      and max(line.po_number) filter (where line.line_number = 1) = 'PO-9'
      and sum(line.amount) = 430.5
    from valtrim.change_order_lines line
    join co_ctx ctx on ctx.loc_co_id = line.change_order_id
  )
);

select pg_temp.check_that(
  'a Change Order of places can be approved and then its place lines are frozen too',
  pg_temp.run_as((select admin_id from co_ctx),
    format($q$select valtrim.set_change_order_status(%s, 'APPROVED')::text$q$, (select loc_co_id from co_ctx))) like 'ok:%'
  and pg_temp.run_sql(format(
    $q$update valtrim.change_order_lines set location = 'Elsewhere' where change_order_id = %s and location is not null$q$,
    (select loc_co_id from co_ctx)
  )) like 'err:23514:%'
  and pg_temp.run_sql(format(
    $q$delete from valtrim.change_order_lines where change_order_id = %s$q$,
    (select loc_co_id from co_ctx)
  )) like 'err:23514:%'
);

-- The Internal # fills itself in ----------------------------------------------------------------------

create temporary table co_numbers (
  preview text,
  preview_again text,
  after_refused text,
  blank_id bigint,
  spaces_id bigint
) on commit drop;

insert into co_numbers (preview, preview_again)
select
  regexp_replace(pg_temp.run_as(pm_id, $q$select valtrim.next_change_order_number()$q$), '^ok:', ''),
  regexp_replace(pg_temp.run_as(pm_id, $q$select valtrim.next_change_order_number()$q$), '^ok:', '')
from co_ctx;

select pg_temp.check_that(
  'Project Management sees the number the next Change Order will have, and looking does not use it up',
  (select preview ~ '^CO-[0-9]{4,}$' and preview = preview_again from co_numbers),
  (select preview || ' / ' || preview_again from co_numbers)
);

select pg_temp.check_that(
  'a read-only user is not shown the next number',
  pg_temp.run_as((select readonly_id from co_ctx), $q$select valtrim.next_change_order_number()$q$) like 'err:42501:%'
);

select pg_temp.check_that(
  'a header that is refused does not use a number up',
  pg_temp.run_as(
    (select pm_id from co_ctx),
    format(
      $q$select valtrim.create_change_order(%s, '   ', 'Carlos', '[{"lot_id": %s, "scope_of_work": "x", "amount": 10}]'::jsonb)::text$q$,
      (select job_id from co_ctx), (select lot_ids[4] from co_ctx)
    )
  ) like 'err:%'
);

update co_numbers set after_refused =
  regexp_replace(pg_temp.run_as((select pm_id from co_ctx), $q$select valtrim.next_change_order_number()$q$), '^ok:', '');

select pg_temp.check_that(
  'the next number is still the same after the refused save',
  (select after_refused = preview from co_numbers),
  (select preview || ' / ' || after_refused from co_numbers)
);

update co_numbers set blank_id = nullif(
  regexp_replace(
    pg_temp.run_as(
      (select pm_id from co_ctx),
      format(
        $q$select valtrim.create_change_order(%s, 'No number of its own', 'Carlos', '[{"lot_id": %s, "scope_of_work": "x", "amount": 10}]'::jsonb)::text$q$,
        (select job_id from co_ctx), (select lot_ids[4] from co_ctx)
      )
    ),
    '^ok:', ''
  ),
  ''
)::bigint;

select pg_temp.check_that(
  'a Change Order saved without an internal number gets the number that was shown, in both places',
  (
    select change_order.change_order_number = numbers.preview
      and change_order.internal_number = change_order.change_order_number
    from valtrim.change_orders change_order
    join co_numbers numbers on numbers.blank_id = change_order.id
  )
);

update co_numbers set spaces_id = nullif(
  regexp_replace(
    pg_temp.run_as(
      (select pm_id from co_ctx),
      format(
        $q$select valtrim.create_change_order(%s, 'Blank spaces', 'Carlos', '[{"lot_id": %s, "scope_of_work": "x", "amount": 10}]'::jsonb, '   ')::text$q$,
        (select job_id from co_ctx), (select lot_ids[4] from co_ctx)
      )
    ),
    '^ok:', ''
  ),
  ''
)::bigint;

select pg_temp.check_that(
  'an internal number of only spaces counts as blank, and the next Change Order has the next number',
  (
    select change_order.internal_number = change_order.change_order_number
      and change_order.change_order_number <> numbers.preview
    from valtrim.change_orders change_order
    join co_numbers numbers on numbers.spaces_id = change_order.id
  )
);

select pg_temp.check_that(
  'two Change Orders never share a number',
  (select count(distinct change_order_number) = count(*) from valtrim.change_orders)
);

-- Deleting: only a Draft, with its lines and history -------------------------------------------------

create temporary table co_delete (draft_id bigint, pending_id bigint, admin_draft_id bigint) on commit drop;

insert into co_delete (draft_id, pending_id, admin_draft_id) values (
  nullif(regexp_replace(
    pg_temp.run_as((select pm_id from co_ctx), format(
      $q$select valtrim.create_change_order(%s, 'Delete me', 'Carlos', '[{"lot_id": %s, "scope_of_work": "x", "amount": 10}]'::jsonb)::text$q$,
      (select job_id from co_ctx), (select lot_ids[1] from co_ctx))),
    '^ok:', ''), '')::bigint,
  nullif(regexp_replace(
    pg_temp.run_as((select pm_id from co_ctx), format(
      $q$select valtrim.create_change_order(%s, 'Sent, not deletable', 'Carlos', '[{"lot_id": %s, "scope_of_work": "x", "amount": 10}]'::jsonb, p_status => 'PENDING')::text$q$,
      (select job_id from co_ctx), (select lot_ids[1] from co_ctx))),
    '^ok:', ''), '')::bigint,
  nullif(regexp_replace(
    pg_temp.run_as((select pm_id from co_ctx), format(
      $q$select valtrim.create_change_order(%s, 'Admin deletes me', 'Carlos', '[{"lot_id": %s, "scope_of_work": "x", "amount": 10}]'::jsonb)::text$q$,
      (select job_id from co_ctx), (select lot_ids[1] from co_ctx))),
    '^ok:', ''), '')::bigint
);

select pg_temp.check_that(
  'a read-only user cannot delete a Change Order',
  pg_temp.run_as((select readonly_id from co_ctx), format('select valtrim.delete_change_order(%s)::text', (select draft_id from co_delete)))
    like 'err:42501:%'
);

select pg_temp.check_that(
  'a Pending Change Order cannot be deleted, and the message says to cancel it',
  pg_temp.run_as((select pm_id from co_ctx), format('select valtrim.delete_change_order(%s)::text', (select pending_id from co_delete)))
    like 'err:23514:Only a Draft%Cancel it instead'
);

select pg_temp.check_that(
  'an Approved Change Order cannot be deleted either',
  pg_temp.run_as((select admin_id from co_ctx), format('select valtrim.set_change_order_status(%s, ''APPROVED'')::text', (select pending_id from co_delete)))
    like 'ok:%'
  and pg_temp.run_as((select admin_id from co_ctx), format('select valtrim.delete_change_order(%s)::text', (select pending_id from co_delete)))
    like 'err:23514:Only a Draft%'
);

select pg_temp.check_that(
  'Project Management deletes a Draft',
  pg_temp.run_as((select pm_id from co_ctx), format('select valtrim.delete_change_order(%s)::text', (select draft_id from co_delete)))
    like 'ok:%'
);

select pg_temp.check_that(
  'its header, lines and history are gone',
  not exists (select 1 from valtrim.change_orders where id = (select draft_id from co_delete))
  and not exists (select 1 from valtrim.change_order_lines where change_order_id = (select draft_id from co_delete))
  and not exists (select 1 from valtrim.change_order_status_history where change_order_id = (select draft_id from co_delete))
);

select pg_temp.check_that(
  'deleting it again says it no longer exists',
  pg_temp.run_as((select pm_id from co_ctx), format('select valtrim.delete_change_order(%s)::text', (select draft_id from co_delete)))
    like 'err:P0002:%'
);

select pg_temp.check_that(
  'an Admin deletes a Draft too',
  pg_temp.run_as((select admin_id from co_ctx), format('select valtrim.delete_change_order(%s)::text', (select admin_draft_id from co_delete)))
    like 'ok:%'
);

select pg_temp.check_that(
  'and it is gone',
  not exists (select 1 from valtrim.change_orders where id = (select admin_draft_id from co_delete))
);

select step, name, ok, detail from co_results order by step;

rollback;
