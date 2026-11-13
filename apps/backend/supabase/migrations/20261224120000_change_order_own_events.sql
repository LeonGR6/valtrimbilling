-- Extra / Change Orders: the Calendar event chosen Lot by Lot or Plan by Plan, and events of their own.
--
-- Until now one choice (EXT, DM, HW or "Own CO event") covered every Lot of a Change Order. The screen now
-- chooses it for each Lot, or for each Plan of a "Specific plan types" Change Order; each line already kept
-- its own `billing_event`, so the lines need nothing new. What is new:
--
--   change_order_plan_rules.billing_event   the event a Plan is charged with (EXT, DM, HW; empty = its own
--                                           CO event). A Lot of that Plan billed later by a Package (the
--                                           Change Order made from that Package) is charged with it when
--                                           the Lot's event is still more than 5 business days away, like
--                                           any other tie; otherwise it needs an event of its own.
--
--   change_order_events / change_order_event_lots
--                                           the events of their own: a date and a note for some of the Lots
--                                           of an APPROVED Change Order that are not charged with an EXT, DM
--                                           or HW event. A Lot is in one event at most. They show on the
--                                           Production Calendar next to EXT, DM and HW.
--
--   create_change_order_event / update_change_order_event / delete_change_order_event
--                                           ADMIN, PROJECT_MANAGEMENT and SCHEDULING.
--   change_order_event_overview             what the Calendar and the Change Order page read.
--   change_order_event_emails.events        the email to Scheduling can also tell the events of their own
--                                           ('CO').
--
-- A Change Order that is cancelled loses its events (they leave the Calendar). Removing an event deletes it.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- The event of each Plan ---------------------------------------------------------------------------------

alter table valtrim.change_order_plan_rules
  add column billing_event text
    check (billing_event is null or billing_event in ('EXT', 'DM', 'HW'));

comment on column valtrim.change_order_plan_rules.billing_event is
  'The Calendar event the Lots of this Plan are charged with (EXT, DM, HW), when it is more than 5 business days away; empty = each Lot needs an event of its own in the Change Order calendar.';

-- Same as before, plus the optional `billing_event` of each item: { plan_id, scope_of_work, amount,
-- billing_event? } where billing_event is 'EXT', 'DM', 'HW' or null.
create or replace function private.replace_change_order_plan_rules(
  p_change_order_id bigint,
  p_job_id bigint,
  p_coverage jsonb,
  p_rules jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text := coalesce(p_coverage->>'mode', 'lots');
  v_count integer;
  v_unique integer;
  v_found integer;
  v_coverage_plans integer;
begin
  delete from valtrim.change_order_plan_rules
  where change_order_id = p_change_order_id;

  if p_rules is null or jsonb_typeof(p_rules) = 'null' then
    return;
  end if;
  if jsonb_typeof(p_rules) <> 'array' then
    raise exception 'The Scope and Amount by Plan must be a JSON array' using errcode = '23514';
  end if;

  v_count := jsonb_array_length(p_rules);
  if v_count = 0 then
    return;
  end if;
  if v_mode <> 'plans' then
    raise exception 'A Scope and Amount by Plan only goes with a Change Order that covers Specific plan types'
      using errcode = '23514';
  end if;
  if v_count > 500 then
    raise exception 'A Change Order can have a Scope and Amount for up to 500 Plans' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rules) item
    where jsonb_typeof(item) <> 'object'
       or jsonb_typeof(item->'plan_id') is distinct from 'number'
       or item->>'plan_id' !~ '^[1-9][0-9]*$'
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
  ) then
    raise exception
      'Every Plan needs a Scope of Work up to 1000 characters and an Amount other than zero with at most 2 decimals'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rules) item
    where coalesce(jsonb_typeof(item->'billing_event'), 'null') <> 'null'
      and (
        jsonb_typeof(item->'billing_event') <> 'string'
        or item->>'billing_event' not in ('EXT', 'DM', 'HW')
      )
  ) then
    raise exception 'The event of a Plan must be EXT, DM, HW or empty for an event of its own'
      using errcode = '23514';
  end if;

  select count(distinct (item->>'plan_id')::bigint)
  into v_unique
  from jsonb_array_elements(p_rules) item;
  if v_unique <> v_count then
    raise exception 'A Plan can have only one Scope and Amount' using errcode = '23505';
  end if;

  select count(*)
  into v_found
  from jsonb_array_elements(p_rules) item
  join valtrim.plans plan on plan.id = (item->>'plan_id')::bigint
  where plan.job_id = p_job_id
    and plan.is_active;
  if v_found <> v_count then
    raise exception 'Every Plan must be an active Plan of the Job' using errcode = '23503';
  end if;

  -- The Plans of the rules are the Plans the coverage chose, when it names them.
  if jsonb_typeof(p_coverage->'planIds') = 'array' then
    select count(distinct value)
    into v_coverage_plans
    from jsonb_array_elements_text(p_coverage->'planIds') value;

    if v_coverage_plans <> v_count or exists (
      select 1
      from jsonb_array_elements(p_rules) item
      where not ((p_coverage->'planIds') ? (item->>'plan_id'))
    ) then
      raise exception 'Write one Scope and Amount for each Plan chosen, and only for them'
        using errcode = '23514';
    end if;
  end if;

  insert into valtrim.change_order_plan_rules (
    change_order_id, plan_id, job_id, scope_of_work, amount, billing_event
  )
  select
    p_change_order_id,
    (item->>'plan_id')::bigint,
    p_job_id,
    btrim(item->>'scope_of_work'),
    (item->>'amount')::numeric(14,2),
    nullif(item->>'billing_event', '')
  from jsonb_array_elements(p_rules) item;
end;
$$;

-- A Lot charged later by a Package follows the event of its Plan --------------------------------------------

-- The Package sync writes the lines of a Change Order made from a Package without an event. Before such a
-- line goes in, it takes the event of its Plan in the rule it comes from, when the Lot has that event on the
-- Calendar and it is still AVAILABLE (more than 5 business days away). Nothing else writes lines this way.
create function private.fill_package_change_order_line_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
  v_date date;
begin
  if new.lot_id is null or new.billing_event is not null or not private.change_order_package_sync_on() then
    return new;
  end if;

  select rule.billing_event
  into v_event
  from valtrim.change_orders change_order
  join valtrim.lots lot on lot.id = new.lot_id
  join valtrim.change_order_plan_rules rule
    on rule.change_order_id = change_order.source_change_order_id
   and rule.plan_id = lot.plan_id
  where change_order.id = new.change_order_id;

  if v_event is null then
    return new;
  end if;

  select event.scheduled_date
  into v_date
  from private.lot_event_dates(array[new.lot_id]) event
  where event.event_type = v_event;

  if v_date is not null and private.change_order_event_status(v_date) = 'AVAILABLE' then
    new.billing_event := v_event;
    new.billing_event_date := v_date;
  end if;

  return new;
end;
$$;

create trigger change_order_lines_fill_package_event
before insert on valtrim.change_order_lines
for each row execute function private.fill_package_change_order_line_event();

-- The events of their own ------------------------------------------------------------------------------

create table valtrim.change_order_events (
  id bigint generated always as identity primary key,
  change_order_id bigint not null,
  job_id bigint not null,
  scheduled_date date not null,
  note varchar(500) check (note is null or btrim(note) <> ''),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, change_order_id),
  foreign key (change_order_id, job_id)
    references valtrim.change_orders(id, job_id) on delete cascade
);

create index change_order_events_change_order_idx on valtrim.change_order_events (change_order_id);
create index change_order_events_date_idx on valtrim.change_order_events (scheduled_date);

create table valtrim.change_order_event_lots (
  event_id bigint not null,
  change_order_id bigint not null,
  line_id bigint not null references valtrim.change_order_lines(id) on delete cascade,
  lot_id bigint not null references valtrim.lots(id) on delete restrict,
  primary key (event_id, line_id),
  -- A Lot of a Change Order is in one event at most.
  unique (line_id),
  foreign key (event_id, change_order_id)
    references valtrim.change_order_events(id, change_order_id) on delete cascade
);

create index change_order_event_lots_change_order_idx on valtrim.change_order_event_lots (change_order_id);
create index change_order_event_lots_lot_idx on valtrim.change_order_event_lots (lot_id);

comment on table valtrim.change_order_events is
  'Events of their own for the Lots of an approved Change Order that are not charged with an EXT, DM or HW event: a date and a note. They show on the Production Calendar.';
comment on table valtrim.change_order_event_lots is
  'The Lots (lines) of each Change Order event. A line is in one event at most.';

alter table valtrim.change_order_events enable row level security;
alter table valtrim.change_order_event_lots enable row level security;

create policy change_order_events_select
  on valtrim.change_order_events for select to authenticated
  using ((select private.is_active_user()));
create policy change_order_event_lots_select
  on valtrim.change_order_event_lots for select to authenticated
  using ((select private.is_active_user()));

revoke all on table valtrim.change_order_events, valtrim.change_order_event_lots
  from public, anon, authenticated;
grant select on table valtrim.change_order_events, valtrim.change_order_event_lots to authenticated;
grant all on table valtrim.change_order_events, valtrim.change_order_event_lots to service_role;

-- An event whose last Lot went away (a Package gave the Lot back) goes away too.
create function private.drop_empty_change_order_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from valtrim.change_order_events event
  where event.id = old.event_id
    and not exists (select 1 from valtrim.change_order_event_lots lot where lot.event_id = old.event_id);
  return null;
end;
$$;

create trigger change_order_event_lots_drop_empty_event
after delete on valtrim.change_order_event_lots
for each row execute function private.drop_empty_change_order_event();

-- A cancelled Change Order leaves the Calendar.
create function private.drop_cancelled_change_order_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from valtrim.change_order_events where change_order_id = new.id;
  return null;
end;
$$;

create trigger change_orders_drop_events_when_cancelled
after update of status on valtrim.change_orders
for each row
when (new.status = 'CANCELLED' and old.status is distinct from 'CANCELLED')
execute function private.drop_cancelled_change_order_events();

-- Writing them -----------------------------------------------------------------------------------------

-- Checks the date and the note of an event; returns the note trimmed (null when empty).
create function private.checked_change_order_event_note(p_scheduled_date date, p_note text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_scheduled_date is null then
    raise exception 'Choose the date of the event' using errcode = '23514';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) > 500 then
    raise exception 'The note can have up to 500 characters' using errcode = '23514';
  end if;
  return nullif(btrim(coalesce(p_note, '')), '');
end;
$$;

-- Who may schedule: the planning roles that own the Change Order, and Scheduling, who owns the Calendar.
create function private.require_change_order_event_writer()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT', 'SCHEDULING')) then
    raise exception 'Only an Admin, Project Management or Scheduling can schedule Change Order events'
      using errcode = '42501';
  end if;
end;
$$;

-- Creates an event of its own for some Lots (`p_line_ids`, lines of the Change Order) of an APPROVED Change
-- Order. Each line must be a Lot line that is not charged with an EXT, DM or HW event and not in another
-- event. The date cannot be before today. Returns the new event's id.
create function private.create_change_order_event(
  p_change_order_id bigint,
  p_scheduled_date date,
  p_line_ids bigint[],
  p_note text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_job_id bigint;
  v_status valtrim.change_order_status;
  v_note text;
  v_lines bigint[];
  v_found integer;
  v_event_id bigint;
begin
  perform private.require_change_order_event_writer();
  v_note := private.checked_change_order_event_note(p_scheduled_date, p_note);

  select change_order.job_id, change_order.status
  into v_job_id, v_status
  from valtrim.change_orders change_order
  where change_order.id = p_change_order_id
  for update;

  if v_job_id is null then
    raise exception 'The Change Order was not found' using errcode = 'P0002';
  end if;
  if v_status <> 'APPROVED' then
    raise exception 'Only an approved Change Order can be scheduled' using errcode = '23514';
  end if;
  if p_scheduled_date < current_date then
    raise exception 'The date of the event cannot be before today' using errcode = '23514';
  end if;

  select array_agg(distinct line_id)
  into v_lines
  from unnest(coalesce(p_line_ids, '{}'::bigint[])) line_id
  where line_id is not null;

  if coalesce(cardinality(v_lines), 0) = 0 then
    raise exception 'Choose at least one Lot for the event' using errcode = '23514';
  end if;
  if cardinality(v_lines) > 5000 then
    raise exception 'An event can have up to 5000 Lots' using errcode = '23514';
  end if;

  select count(*)
  into v_found
  from valtrim.change_order_lines line
  where line.id = any(v_lines)
    and line.change_order_id = p_change_order_id
    and line.lot_id is not null;
  if v_found <> cardinality(v_lines) then
    raise exception 'Every Lot of the event must be a Lot of this Change Order' using errcode = '23514';
  end if;

  if exists (
    select 1 from valtrim.change_order_lines line
    where line.id = any(v_lines) and line.billing_event is not null
  ) then
    raise exception 'A Lot charged with an EXT, DM or HW event does not need an event of its own'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from valtrim.change_order_event_lots event_lot
    where event_lot.line_id = any(v_lines)
  ) then
    raise exception 'A Lot already has an event. Change that event instead' using errcode = '23505';
  end if;

  insert into valtrim.change_order_events (
    change_order_id, job_id, scheduled_date, note, created_by, updated_by
  )
  values (p_change_order_id, v_job_id, p_scheduled_date, v_note, v_actor, v_actor)
  returning id into v_event_id;

  insert into valtrim.change_order_event_lots (event_id, change_order_id, line_id, lot_id)
  select v_event_id, p_change_order_id, line.id, line.lot_id
  from valtrim.change_order_lines line
  where line.id = any(v_lines);

  return v_event_id;
end;
$$;

-- Changes the date and the note of an event. A date already in the past can stay; a new one cannot be
-- before today.
create function private.update_change_order_event(
  p_event_id bigint,
  p_scheduled_date date,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_date date;
  v_status valtrim.change_order_status;
  v_note text;
begin
  perform private.require_change_order_event_writer();
  v_note := private.checked_change_order_event_note(p_scheduled_date, p_note);

  select event.scheduled_date, change_order.status
  into v_old_date, v_status
  from valtrim.change_order_events event
  join valtrim.change_orders change_order on change_order.id = event.change_order_id
  where event.id = p_event_id
  for update of event;

  if v_old_date is null then
    raise exception 'The event was not found' using errcode = 'P0002';
  end if;
  if v_status <> 'APPROVED' then
    raise exception 'Only the events of an approved Change Order can change' using errcode = '23514';
  end if;
  if p_scheduled_date <> v_old_date and p_scheduled_date < current_date then
    raise exception 'The date of the event cannot be before today' using errcode = '23514';
  end if;

  update valtrim.change_order_events
  set scheduled_date = p_scheduled_date,
      note = v_note,
      updated_by = (select auth.uid()),
      updated_at = now()
  where id = p_event_id;
end;
$$;

-- Removes an event: its Lots need an event again.
create function private.delete_change_order_event(p_event_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_change_order_event_writer();

  delete from valtrim.change_order_events where id = p_event_id;
  if not found then
    raise exception 'The event was not found' using errcode = 'P0002';
  end if;
end;
$$;

create function valtrim.create_change_order_event(
  p_change_order_id bigint,
  p_scheduled_date date,
  p_line_ids bigint[],
  p_note text default null
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.create_change_order_event(p_change_order_id, p_scheduled_date, p_line_ids, p_note);
$$;

create function valtrim.update_change_order_event(
  p_event_id bigint,
  p_scheduled_date date,
  p_note text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.update_change_order_event(p_event_id, p_scheduled_date, p_note);
$$;

create function valtrim.delete_change_order_event(p_event_id bigint)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.delete_change_order_event(p_event_id);
$$;

-- Reading them -----------------------------------------------------------------------------------------

-- One row per event, with what the Calendar shows: the Change Order, its Job and Builder, and its Lots.
create view valtrim.change_order_event_overview
with (security_invoker = true)
as
select
  event.id,
  event.change_order_id,
  change_order.change_order_number,
  change_order.po_co_number,
  change_order.status as change_order_status,
  event.job_id,
  job.code as job_code,
  job.community,
  change_order.builder_id,
  builder.name as builder_name,
  event.scheduled_date,
  event.note,
  event.created_at,
  event.updated_at,
  coalesce(lots.lot_count, 0) as lot_count,
  coalesce(lots.lots, '[]'::jsonb) as lots
from valtrim.change_order_events event
join valtrim.change_orders change_order on change_order.id = event.change_order_id
join valtrim.jobs job on job.id = event.job_id
join valtrim.builders builder on builder.id = change_order.builder_id
left join lateral (
  select
    count(*) as lot_count,
    jsonb_agg(
      jsonb_build_object(
        'line_id', line.id,
        'lot_id', line.lot_id,
        'phase_id', line.phase_id,
        'phase_code', line.phase_code,
        'building', line.building,
        'lot_number', line.lot_number,
        'plan_code', line.plan_code,
        'scope_of_work', line.scope_of_work
      )
      order by line.line_number
    ) as lots
  from valtrim.change_order_event_lots event_lot
  join valtrim.change_order_lines line on line.id = event_lot.line_id
  where event_lot.event_id = event.id
) lots on true;

revoke all on valtrim.change_order_event_overview from public, anon, authenticated;
grant select on valtrim.change_order_event_overview to authenticated, service_role;

-- The email to Scheduling also tells the events of their own ('CO') --------------------------------------

alter table valtrim.change_order_event_emails
  drop constraint change_order_event_emails_events_check,
  add constraint change_order_event_emails_events_check
    check (cardinality(events) between 1 and 4 and events <@ array['EXT', 'DM', 'HW', 'CO']);

comment on column valtrim.change_order_event_emails.events is
  'The events the email was about: EXT, DM, HW (charged with that Calendar event) and CO (an event of its own).';

-- Who can call what -------------------------------------------------------------------------------------

revoke execute on function
  private.fill_package_change_order_line_event(),
  private.drop_empty_change_order_event(),
  private.drop_cancelled_change_order_events(),
  private.checked_change_order_event_note(date, text),
  private.require_change_order_event_writer(),
  private.create_change_order_event(bigint, date, bigint[], text),
  private.update_change_order_event(bigint, date, text),
  private.delete_change_order_event(bigint),
  valtrim.create_change_order_event(bigint, date, bigint[], text),
  valtrim.update_change_order_event(bigint, date, text),
  valtrim.delete_change_order_event(bigint)
from public, anon, authenticated;

grant execute on function
  private.checked_change_order_event_note(date, text),
  private.require_change_order_event_writer(),
  private.create_change_order_event(bigint, date, bigint[], text),
  private.update_change_order_event(bigint, date, text),
  private.delete_change_order_event(bigint),
  valtrim.create_change_order_event(bigint, date, bigint[], text),
  valtrim.update_change_order_event(bigint, date, text),
  valtrim.delete_change_order_event(bigint)
to authenticated, service_role;

comment on function valtrim.create_change_order_event(bigint, date, bigint[], text) is
  'Schedules an event of its own for Lots of an approved Change Order that are not charged with an EXT, DM or HW event. ADMIN, PROJECT_MANAGEMENT and SCHEDULING.';
comment on function valtrim.update_change_order_event(bigint, date, text) is
  'Changes the date and the note of a Change Order event. ADMIN, PROJECT_MANAGEMENT and SCHEDULING.';
comment on function valtrim.delete_change_order_event(bigint) is
  'Removes a Change Order event; its Lots need an event again. ADMIN, PROJECT_MANAGEMENT and SCHEDULING.';

commit;
