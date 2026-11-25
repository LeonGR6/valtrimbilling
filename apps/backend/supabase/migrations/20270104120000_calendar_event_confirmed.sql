-- Confirmed: every Calendar event can be marked as confirmed. The Calendar puts "*" before the
-- name of a confirmed event (Month, Week and List views) and so does Google Calendar.
--
-- Production events (EXT, Shutter, DM, HW, their divisions and their extra events) keep it on
-- their schedule row and save it with the rest of the activity. The events of their own of an
-- Extra / CO keep it on their row and change it with set_change_order_event_confirmed.
-- Nothing about billing, dates or follow-ups changes.

begin;

-- 1) Where it is kept ---------------------------------------------------------------------------------

alter table valtrim.production_schedules
  add column if not exists is_confirmed boolean not null default false;

comment on column valtrim.production_schedules.is_confirmed is
  'The event is confirmed: the Calendar and Google show "*" before its name.';

-- The Calendar reads production_schedules column by column: the new column needs its own grant.
grant select (is_confirmed) on valtrim.production_schedules to authenticated;

alter table valtrim.change_order_events
  add column if not exists is_confirmed boolean not null default false;

comment on column valtrim.change_order_events.is_confirmed is
  'The event is confirmed: the Calendar shows "*" before its name.';

-- 2) Saving a Production activity: each schedule says whether it is confirmed --------------------------

do $migration$
declare
  v_definition text;
  v_updated text;

  -- Replaces exactly one occurrence, or stops the migration.
  function_patch constant text := 'save_production_activity';
begin
  select pg_get_functiondef(
    'private.save_production_activity(bigint,bigint,bigint[],jsonb,text)'::regprocedure
  ) into v_definition;

  -- a) "confirmed", when sent, is true or false.
  v_updated := replace(
    v_definition,
    'or char_length(btrim(coalesce(schedule.value ->> ''note'', ''''))) > 100',
    'or char_length(btrim(coalesce(schedule.value ->> ''note'', ''''))) > 100
      or (schedule.value ? ''confirmed''
          and jsonb_typeof(schedule.value -> ''confirmed'') not in (''boolean'', ''null''))'
  );
  if v_updated = v_definition then
    raise exception '% schedule checks did not match the expected definition', function_patch;
  end if;
  v_definition := v_updated;

  -- b) A new schedule keeps it.
  v_updated := replace(
    v_definition,
    '          note,
          lot_start_label,',
    '          note,
          is_confirmed,
          lot_start_label,'
  );
  if v_updated = v_definition then
    raise exception '% insert columns did not match the expected definition', function_patch;
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    '          ),
          nullif(btrim(v_schedule ->> ''note''), ''''),
          (array_agg(',
    '          ),
          nullif(btrim(v_schedule ->> ''note''), ''''),
          coalesce((v_schedule ->> ''confirmed'')::boolean, false),
          (array_agg('
  );
  if v_updated = v_definition then
    raise exception '% insert values did not match the expected definition', function_patch;
  end if;
  v_definition := v_updated;

  -- c) A saved schedule keeps it too.
  v_updated := replace(
    v_definition,
    '            note = nullif(btrim(v_schedule ->> ''note''), ''''),',
    '            note = nullif(btrim(v_schedule ->> ''note''), ''''),
            is_confirmed = coalesce((v_schedule ->> ''confirmed'')::boolean, false),'
  );
  if v_updated = v_definition then
    raise exception '% update did not match the expected definition', function_patch;
  end if;

  execute v_updated;
end;
$migration$;

-- 3) Google Calendar: the sync reads it to put "*" before the name ---------------------------------------

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef('valtrim.begin_google_calendar_sync(uuid)'::regprocedure)
  into v_definition;

  v_updated := replace(
    v_definition,
    '''dateOwner'', schedule.date_owner::text,',
    '''dateOwner'', schedule.date_owner::text,
        ''confirmed'', schedule.is_confirmed,'
  );
  if v_updated = v_definition then
    raise exception 'begin_google_calendar_sync did not match the expected definition';
  end if;

  execute v_updated;
end;
$migration$;

-- 4) Extra / CO events: read it, and change it ---------------------------------------------------------

create or replace view valtrim.change_order_event_overview
with (security_invoker = true)
as
select event.id,
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
    coalesce(lots.lot_count, 0::bigint) as lot_count,
    coalesce(lots.lots, '[]'::jsonb) as lots,
    event.is_confirmed
   from valtrim.change_order_events event
     join valtrim.change_orders change_order on change_order.id = event.change_order_id
     join valtrim.jobs job on job.id = event.job_id
     join valtrim.builders builder on builder.id = change_order.builder_id
     left join lateral ( select count(*) as lot_count,
            jsonb_agg(jsonb_build_object('line_id', line.id, 'lot_id', line.lot_id, 'phase_id', line.phase_id, 'phase_code', line.phase_code, 'building', line.building, 'lot_number', line.lot_number, 'plan_code', line.plan_code, 'scope_of_work', line.scope_of_work) order by line.line_number) as lots
           from valtrim.change_order_event_lots event_lot
             join valtrim.change_order_lines line on line.id = event_lot.line_id
          where event_lot.event_id = event.id) lots on true;

create or replace function private.set_change_order_event_confirmed(
  p_event_id bigint,
  p_confirmed boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status valtrim.change_order_status;
begin
  perform private.require_change_order_event_writer();

  if p_confirmed is null then
    raise exception 'Say whether the event is confirmed' using errcode = '23502';
  end if;

  select change_order.status
  into v_status
  from valtrim.change_order_events event
  join valtrim.change_orders change_order on change_order.id = event.change_order_id
  where event.id = p_event_id
  for update of event;

  if v_status is null then
    raise exception 'The event was not found' using errcode = 'P0002';
  end if;
  if v_status <> 'APPROVED' then
    raise exception 'Only the events of an approved Change Order can change' using errcode = '23514';
  end if;

  update valtrim.change_order_events
  set is_confirmed = p_confirmed,
      updated_by = (select auth.uid()),
      updated_at = now()
  where id = p_event_id;
end;
$$;

create or replace function valtrim.set_change_order_event_confirmed(
  p_event_id bigint,
  p_confirmed boolean
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.set_change_order_event_confirmed(p_event_id, p_confirmed);
$$;

revoke execute on function
  private.set_change_order_event_confirmed(bigint, boolean),
  valtrim.set_change_order_event_confirmed(bigint, boolean)
from public, anon, authenticated;

grant execute on function
  private.set_change_order_event_confirmed(bigint, boolean),
  valtrim.set_change_order_event_confirmed(bigint, boolean)
to authenticated, service_role;

comment on function valtrim.set_change_order_event_confirmed(bigint, boolean) is
  'Marks a Change Order event as confirmed or not. ADMIN, PROJECT_MANAGEMENT and SCHEDULING.';

notify pgrst, 'reload schema';

commit;
