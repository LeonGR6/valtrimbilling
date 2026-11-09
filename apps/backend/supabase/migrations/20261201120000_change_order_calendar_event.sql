-- Charging an Extra / Change Order with an event that is already on the Calendar.
--
-- A Lot already has an EXT, a DM and a Hardware (HW) event on the Production Calendar. If that event is
-- still far enough away, the Lot's line of a Change Order can be charged along with it. If the event has
-- gone by, or is too close to add anything to it, the line is not tied to the Calendar: it will need an
-- event of its own in the Change Order calendar (not built yet).
--
--   Event    The date billing already uses for a Lot: the earliest date of the Lot's EXT / DM / HW stage on
--            an ACTIVE activity (Baseboard install does not count, as in Create Package).
--   Far      The event is AVAILABLE when more than 5 business days are left before it. A business day is
--            Monday to Friday except the US federal holidays the Calendar already uses.
--   Close    TOO_CLOSE when 5 business days or fewer are left (an event today is TOO_CLOSE).
--   Gone     PASSED when the date is before today.
--   None     A Lot with no such event on the Calendar is NOT_SCHEDULED; it cannot be tied to anything.
--   Today    The database's own date (UTC), so the screen and the check always agree.
--
-- A line keeps the tie as `billing_event` ('EXT', 'DM' or 'HW'; empty means "its own Change Order event")
-- with the date it had when it was saved. The CO still has its own invoice: this only says which event
-- it is charged along with.
--
-- The database checks a new tie when the lines are saved. A tie that was already saved is kept (and its
-- date refreshed from the Calendar) even if the event has since moved closer: nobody loses it by editing
-- something else, and the screen warns about it.

begin;

alter table valtrim.change_order_lines
  add column billing_event text
    check (billing_event is null or billing_event in ('EXT', 'DM', 'HW')),
  add column billing_event_date date;

alter table valtrim.change_order_lines
  add constraint change_order_lines_billing_event_pair
    check ((billing_event is null) = (billing_event_date is null)),
  add constraint change_order_lines_billing_event_on_lot
    check (billing_event is null or lot_id is not null);

-- Business days ---------------------------------------------------------------------------------------

-- The US federal holidays the Production Calendar leaves out when it counts days: Memorial Day, Labor
-- Day, Thanksgiving, and New Year, Juneteenth, Independence Day and Christmas (moved to the Friday before
-- or the Monday after when they fall on a weekend). The same list as the Calendar's own.
create function private.is_us_federal_holiday(p_date date)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_year integer := extract(year from p_date)::integer;
  v_day date;
begin
  -- Memorial Day: the last Monday of May.
  v_day := make_date(v_year, 5, 31);
  if p_date = v_day - (extract(isodow from v_day)::integer - 1) then
    return true;
  end if;

  -- Labor Day: the first Monday of September.
  v_day := make_date(v_year, 9, 1);
  if p_date = v_day + ((8 - extract(isodow from v_day)::integer) % 7) then
    return true;
  end if;

  -- Thanksgiving: the fourth Thursday of November.
  v_day := make_date(v_year, 11, 1);
  if p_date = v_day + ((11 - extract(isodow from v_day)::integer) % 7) + 21 then
    return true;
  end if;

  -- The fixed ones, as they are observed (the neighbouring years can be observed into this one).
  return exists (
    select 1
    from generate_series(v_year - 1, v_year + 1) as holiday_year
    cross join (values (1, 1), (6, 19), (7, 4), (12, 25)) as fixed(m, d)
    cross join lateral (select make_date(holiday_year, fixed.m, fixed.d) as holiday) as actual
    where p_date = case extract(isodow from actual.holiday)::integer
      when 6 then actual.holiday - 1
      when 7 then actual.holiday + 1
      else actual.holiday
    end
  );
end;
$$;

-- The business days after `p_from` up to and including `p_to`: 0 when `p_to` is not after `p_from`. It
-- counts at most the next 30 days (about 20 business days), enough to tell whether an event is far away.
create function private.business_days_ahead(p_from date, p_to date)
returns integer
language sql
immutable
strict
set search_path = ''
as $$
  select count(*)::integer
  from generate_series(1, greatest(least(p_to - p_from, 30), 0)) as step
  where extract(isodow from p_from + step)::integer < 6
    and not private.is_us_federal_holiday(p_from + step);
$$;

-- Whether a Calendar event can still be charged along with: AVAILABLE, TOO_CLOSE or PASSED.
create function private.change_order_event_status(p_event_date date, p_today date default current_date)
returns text
language sql
stable
strict
set search_path = ''
as $$
  select case
    when p_event_date < p_today then 'PASSED'
    when private.business_days_ahead(p_today, p_event_date) <= 5 then 'TOO_CLOSE'
    else 'AVAILABLE'
  end;
$$;

-- The Calendar -----------------------------------------------------------------------------------------

-- The date of each EXT / DM / HW event of the given Lots: one row per Lot and event, the earliest date
-- the Calendar gives the Lot, with who owns that date. A Lot with no such event has no row.
create function private.lot_event_dates(p_lot_ids bigint[])
returns table (lot_id bigint, event_type text, scheduled_date date, date_owner text)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (schedule_lot.lot_id, stage.stage_type)
    schedule_lot.lot_id,
    stage.stage_type::text,
    schedule.scheduled_date,
    schedule.date_owner::text
  from valtrim.production_schedule_lots schedule_lot
  join valtrim.production_schedules schedule
    on schedule.id = schedule_lot.schedule_id
   and schedule.is_active
   and schedule.variant <> 'BASEBOARD_INSTALL'
  join valtrim.production_stages stage
    on stage.id = schedule.stage_id
   and stage.is_enabled
   and stage.stage_type in ('EXT', 'DM', 'HW')
  join valtrim.production_activities activity
    on activity.id = schedule.activity_id
   and activity.status = 'ACTIVE'
  where schedule_lot.lot_id = any (p_lot_ids)
  order by schedule_lot.lot_id, stage.stage_type, schedule.scheduled_date, schedule.id;
$$;

-- What the Change Order form shows: for every Lot of the Job, each event it has, its date, who owns the
-- date, whether it can still be charged along with (AVAILABLE, TOO_CLOSE, PASSED) and, when it is close,
-- how many business days are left.
create function valtrim.change_order_lot_events(p_job_id bigint)
returns table (
  lot_id bigint,
  event_type text,
  event_date date,
  date_owner text,
  event_status text,
  business_days integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    event.lot_id,
    event.event_type,
    event.scheduled_date,
    event.date_owner,
    private.change_order_event_status(event.scheduled_date),
    private.business_days_ahead(current_date, event.scheduled_date)
  from private.lot_event_dates(
    array(select lot.id from valtrim.lots lot where lot.job_id = p_job_id)
  ) event
  order by event.lot_id, event.event_type;
$$;

revoke execute on function
  private.is_us_federal_holiday(date),
  private.business_days_ahead(date, date),
  private.change_order_event_status(date, date),
  private.lot_event_dates(bigint[]),
  valtrim.change_order_lot_events(bigint)
from public, anon, authenticated;

grant execute on function
  private.is_us_federal_holiday(date),
  private.business_days_ahead(date, date),
  private.change_order_event_status(date, date),
  private.lot_event_dates(bigint[]),
  valtrim.change_order_lot_events(bigint)
to authenticated, service_role;

-- Saving the lines ---------------------------------------------------------------------------------------

-- Replaces every line of the CO with `p_lines`, an array of
--   { lot_id, scope_of_work, amount, po_number?, billing_event? }   a Lot line, or
--   { location, scope_of_work, amount, po_number? }                  a location line,
-- in the order they should be shown. Each item has a lot_id or a location, never both.
-- `billing_event` ('EXT', 'DM' or 'HW') ties a Lot line to that Calendar event; it is refused when the
-- Lot's event is gone, too close or not scheduled, unless that very tie was already saved on the CO.
-- `p_previous_ties` are the ties saved before: { "<lot id>": { "event": "DM", "date": "2026-09-22" } }.
-- Editing deletes the old lines before this runs, so the editor reads them first and passes them in.
drop function private.replace_change_order_lines(bigint, bigint, jsonb);

create function private.replace_change_order_lines(
  p_change_order_id bigint,
  p_job_id bigint,
  p_lines jsonb,
  p_previous_ties jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_lots integer;
  v_unique_lots integer;
  v_found integer;
  v_tied_lots bigint[];
  v_refused integer;
  v_refused_text text;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'The lines must be a JSON array' using errcode = '23514';
  end if;
  v_count := jsonb_array_length(p_lines);
  if v_count not between 1 and 5000 then
    raise exception 'Add between 1 and 5000 lines' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) item
    where jsonb_typeof(item) <> 'object'
       or (
         (
           (
             jsonb_typeof(item->'lot_id') = 'number'
             and item->>'lot_id' ~ '^[1-9][0-9]*$'
             and coalesce(jsonb_typeof(item->'location'), 'null') = 'null'
           )
           or (
             jsonb_typeof(item->'location') = 'string'
             and char_length(btrim(item->>'location')) between 1 and 100
             and coalesce(jsonb_typeof(item->'lot_id'), 'null') = 'null'
           )
         ) is not true
       )
       or jsonb_typeof(item->'scope_of_work') is distinct from 'string'
       or char_length(btrim(item->>'scope_of_work')) not between 1 and 1000
       or jsonb_typeof(item->'amount') is distinct from 'number'
       or item->>'amount' !~ '^-?[0-9]{1,12}(\.[0-9]{1,2})?$'
       or (
         case
           when item->>'amount' ~ '^-?[0-9]{1,12}(\.[0-9]{1,2})?$'
             then (item->>'amount')::numeric = 0
           else true
         end
       )
       or (
         item ? 'po_number'
         and (
           jsonb_typeof(item->'po_number') not in ('string', 'null')
           or char_length(btrim(coalesce(item->>'po_number', ''))) > 60
         )
       )
  ) then
    raise exception
      'Every line needs a Lot or a location, a Scope of Work up to 1000 characters and an Amount other than zero with at most 2 decimals'
      using errcode = '23514';
  end if;

  -- The Calendar event a line is charged with: EXT, DM or HW, and only on a Lot line.
  if exists (
    select 1
    from jsonb_array_elements(p_lines) item
    where item ? 'billing_event'
      and jsonb_typeof(item->'billing_event') <> 'null'
      and (
        jsonb_typeof(item->'billing_event') <> 'string'
        or item->>'billing_event' not in ('EXT', 'DM', 'HW')
        or jsonb_typeof(item->'lot_id') is distinct from 'number'
      )
  ) then
    raise exception 'A line on a Lot can be charged with EXT, DM or HW; a line without a Lot cannot'
      using errcode = '23514';
  end if;

  select count(*), count(distinct (item->>'lot_id')::bigint)
  into v_lots, v_unique_lots
  from jsonb_array_elements(p_lines) item
  where jsonb_typeof(item->'lot_id') = 'number';
  if v_unique_lots <> v_lots then
    raise exception 'A Lot can be in a Change Order only once' using errcode = '23505';
  end if;

  select count(*)
  into v_found
  from jsonb_array_elements(p_lines) item
  join valtrim.lots lot on lot.id = (item->>'lot_id')::bigint
  join valtrim.phases phase on phase.id = lot.phase_id
  where jsonb_typeof(item->'lot_id') = 'number'
    and lot.job_id = p_job_id
    and phase.job_id = p_job_id
    and phase.is_active;
  if v_found <> v_lots then
    raise exception 'Every Lot must belong to an active Phase of the Job'
      using errcode = '23503';
  end if;

  select coalesce(array_agg((item->>'lot_id')::bigint), '{}'::bigint[])
  into v_tied_lots
  from jsonb_array_elements(p_lines) item
  where jsonb_typeof(item->'billing_event') = 'string';

  -- A new tie needs an event that is far enough away.
  select count(*), string_agg(refused.reason, ', ' order by refused.ord) filter (where refused.place <= 8)
  into v_refused, v_refused_text
  from (
    select
      requested.ord,
      row_number() over (order by requested.ord) as place,
      format(
        'Lot %s (%s)',
        lot.lot_number,
        case
          when event.scheduled_date is null
            then requested.item->>'billing_event' || ' is not on the Calendar'
          when private.change_order_event_status(event.scheduled_date) = 'PASSED'
            then requested.item->>'billing_event' || ' has already passed'
          else requested.item->>'billing_event' || ' is too close'
        end
      ) as reason
    from jsonb_array_elements(p_lines) with ordinality as requested(item, ord)
    join valtrim.lots lot on lot.id = (requested.item->>'lot_id')::bigint
    left join private.lot_event_dates(v_tied_lots) event
      on event.lot_id = lot.id
     and event.event_type = requested.item->>'billing_event'
    where jsonb_typeof(requested.item->'billing_event') = 'string'
      and (p_previous_ties -> lot.id::text ->> 'event') is distinct from requested.item->>'billing_event'
      and (
        event.scheduled_date is null
        or private.change_order_event_status(event.scheduled_date) <> 'AVAILABLE'
      )
  ) refused;
  if v_refused > 0 then
    raise exception
      'These lots cannot be charged with the Calendar event chosen: %. Leave them for an Extra / Change Order event of their own',
      v_refused_text || case when v_refused > 8 then format(' and %s more', v_refused - 8) else '' end
      using errcode = '23514';
  end if;

  delete from valtrim.change_order_lines
  where change_order_id = p_change_order_id;

  insert into valtrim.change_order_lines (
    change_order_id, lot_id, job_id, phase_id, line_number,
    phase_code, building, lot_number, plan_code, plan_name, location,
    scope_of_work, amount, po_number, billing_event, billing_event_date
  )
  select
    p_change_order_id,
    lot.id,
    lot.job_id,
    lot.phase_id,
    requested.ord::integer,
    phase.code,
    phase.building,
    lot.lot_number,
    plan.code,
    plan.name,
    null::varchar,
    btrim(requested.item->>'scope_of_work'),
    (requested.item->>'amount')::numeric(14,2),
    nullif(btrim(coalesce(requested.item->>'po_number', '')), ''),
    case when jsonb_typeof(requested.item->'billing_event') = 'string'
      then requested.item->>'billing_event'
    end,
    case when jsonb_typeof(requested.item->'billing_event') = 'string'
      then coalesce(event.scheduled_date, (p_previous_ties -> lot.id::text ->> 'date')::date)
    end
  from jsonb_array_elements(p_lines) with ordinality as requested(item, ord)
  join valtrim.lots lot on lot.id = (requested.item->>'lot_id')::bigint
  join valtrim.phases phase on phase.id = lot.phase_id
  join valtrim.plans plan on plan.id = lot.plan_id
  left join private.lot_event_dates(v_tied_lots) event
    on event.lot_id = lot.id
   and event.event_type = requested.item->>'billing_event'
  where jsonb_typeof(requested.item->'lot_id') = 'number'
  union all
  select
    p_change_order_id,
    null::bigint,
    p_job_id,
    null::bigint,
    requested.ord::integer,
    null::varchar,
    null::varchar,
    null::varchar,
    null::varchar,
    null::varchar,
    btrim(requested.item->>'location'),
    btrim(requested.item->>'scope_of_work'),
    (requested.item->>'amount')::numeric(14,2),
    nullif(btrim(coalesce(requested.item->>'po_number', '')), ''),
    null::text,
    null::date
  from jsonb_array_elements(p_lines) with ordinality as requested(item, ord)
  where jsonb_typeof(requested.item->'lot_id') is distinct from 'number';
end;
$$;

revoke execute on function
  private.replace_change_order_lines(bigint, bigint, jsonb, jsonb)
from public, anon, authenticated;

-- Editing a Draft or Pending CO: the same as before, but it reads the ties already saved before the old
-- lines are deleted, so a tie that was saved is not mistaken for a new one.
create or replace function private.update_change_order(
  p_change_order_id bigint,
  p_job_id bigint,
  p_title text,
  p_requested_by text,
  p_lines jsonb,
  p_internal_number text default null,
  p_request_date date default null,
  p_needed_by_date date default null,
  p_coverage jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_status valtrim.change_order_status;
  v_builder_id bigint;
  v_previous_ties jsonb;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to edit a Change Order'
      using errcode = '42501';
  end if;

  select change_order.status
  into v_status
  from valtrim.change_orders change_order
  where change_order.id = p_change_order_id
  for update;
  if not found then
    raise exception 'The Change Order no longer exists' using errcode = 'P0002';
  end if;
  if v_status not in ('DRAFT', 'PENDING') then
    raise exception 'An approved or cancelled Change Order cannot be edited'
      using errcode = '23514';
  end if;

  v_builder_id := private.check_change_order_header(
    p_job_id, p_title, p_internal_number, p_requested_by,
    p_request_date, p_needed_by_date, p_coverage
  );

  select coalesce(
    jsonb_object_agg(
      line.lot_id::text,
      jsonb_build_object('event', line.billing_event, 'date', line.billing_event_date)
    ),
    '{}'::jsonb
  )
  into v_previous_ties
  from valtrim.change_order_lines line
  where line.change_order_id = p_change_order_id
    and line.billing_event is not null;

  -- The lines go first: they point at the Job of the header.
  delete from valtrim.change_order_lines
  where change_order_id = p_change_order_id;

  update valtrim.change_orders
  set internal_number = nullif(btrim(coalesce(p_internal_number, '')), ''),
      title = btrim(p_title),
      builder_id = v_builder_id,
      job_id = p_job_id,
      requested_by = btrim(p_requested_by),
      request_date = p_request_date,
      needed_by_date = p_needed_by_date,
      coverage = coalesce(p_coverage, '{}'::jsonb),
      updated_by = v_actor_id
  where id = p_change_order_id;

  perform private.replace_change_order_lines(p_change_order_id, p_job_id, p_lines, v_previous_ties);
end;
$$;

comment on column valtrim.change_order_lines.billing_event is
  'The Calendar event (EXT, DM or HW) the Lot of this line is charged along with. Empty: the line needs an Extra / Change Order event of its own.';
comment on column valtrim.change_order_lines.billing_event_date is
  'The date of that event on the Calendar when the line was saved (refreshed each time the lines are saved).';
comment on function valtrim.change_order_lot_events(bigint) is
  'The EXT, DM and HW events of the Lots of a Job with their dates and whether each can still be charged along with (AVAILABLE, TOO_CLOSE, PASSED).';

notify pgrst, 'reload schema';
commit;
