-- Extra / Change Orders charged from a Package: the Lots are chosen one by one, and suggested.
--
-- Until now a Package charged every Lot it billed whose Plan has an approved "Specific plan types" Extra / CO.
-- Now the Create Package screen lists every Lot of the Phases chosen that such a Plan could still charge,
-- suggests some (by the same cut-off the Calendar suggestion uses) and lets the person tick any, all or none:
--
--   package_change_order_candidates   the Lots the screen lists, with the Calendar event each Plan was
--                                     tied to (EXT, DM, HW; empty = an event of its own CO) and, for a Plan
--                                     with an event of its own, the dates of the events its source CO has.
--   stage_package_change_order_selection
--                                     the person's choice (Lots, and the date for a Lot that goes with an
--                                     event of its own), saved just before the Package is created. The
--                                     create functions are not touched: the sync that runs when the
--                                     Package commits takes the choice (the same user and Job, saved before
--                                     the Package existed, in the last 15 minutes) and keeps it with the
--                                     Package in package_change_order_choices.
--   sync_package_change_orders        a Package with a choice charges exactly the chosen Lots (billed by it
--                                     or not); one without a choice charges what it bills, as before. A
--                                     Lot not chosen stays free for a later Package. A Change Order made
--                                     from the Package also gets, for a Lot with a date, an event of its
--                                     own on that date.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table valtrim.package_change_order_choices (
  package_id bigint primary key references valtrim.draw_packages(id) on delete cascade,
  lot_ids bigint[] not null default '{}'::bigint[],
  -- { "<lot id>": "YYYY-MM-DD" }: the date of the event of its own a chosen Lot goes with.
  event_dates jsonb not null default '{}'::jsonb check (jsonb_typeof(event_dates) = 'object'),
  created_at timestamptz not null default now()
);

create table valtrim.package_change_order_staging (
  user_id uuid not null,
  job_id bigint not null references valtrim.jobs(id) on delete cascade,
  lot_ids bigint[] not null default '{}'::bigint[],
  event_dates jsonb not null default '{}'::jsonb check (jsonb_typeof(event_dates) = 'object'),
  staged_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

alter table valtrim.package_change_order_choices enable row level security;
alter table valtrim.package_change_order_staging enable row level security;

create policy package_change_order_choices_select
  on valtrim.package_change_order_choices for select to authenticated
  using ((select private.is_active_user()));

revoke all on table valtrim.package_change_order_choices, valtrim.package_change_order_staging
  from public, anon, authenticated;
grant select on table valtrim.package_change_order_choices to authenticated;
grant all on table valtrim.package_change_order_choices, valtrim.package_change_order_staging to service_role;

comment on table valtrim.package_change_order_choices is
  'The Lots a Package was told to charge to the Specific plan types Extras / COs (and the event dates of their own). A Package without a row charges what it bills.';
comment on table valtrim.package_change_order_staging is
  'The choice of Lots a person made on Create Package, kept until the Package they create takes it (15 minutes at most).';

-- The Lots the screen lists --------------------------------------------------------------------------------

create function private.package_change_order_candidates(p_job_id bigint, p_phase_ids bigint[])
returns table (
  source_change_order_id bigint,
  source_change_order_number varchar,
  source_internal_number varchar,
  source_po_co_number varchar,
  lot_id bigint,
  phase_id bigint,
  phase_code varchar,
  building varchar,
  lot_number varchar,
  plan_id bigint,
  plan_code varchar,
  plan_name varchar,
  scope_of_work varchar,
  amount numeric,
  billing_event text,
  own_event_dates date[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_active_user()) then
    raise exception 'You do not have permission to read Change Orders' using errcode = '42501';
  end if;

  return query
  select
    parent.id,
    parent.change_order_number,
    parent.internal_number,
    parent.po_co_number,
    lot.id,
    phase.id,
    phase.code,
    phase.building,
    lot.lot_number,
    plan.id,
    plan.code,
    plan.name,
    candidate.scope_of_work,
    candidate.amount,
    rule.billing_event,
    case when rule.billing_event is null then own.dates else null end
  from private.plan_change_order_candidates(
    p_job_id,
    array(
      select any_lot.id
      from valtrim.lots any_lot
      where any_lot.job_id = p_job_id
        and any_lot.phase_id = any(coalesce(p_phase_ids, '{}'::bigint[]))
        and not any_lot.is_utility_building
      limit 5000
    ),
    null
  ) candidate
  join valtrim.change_orders parent on parent.id = candidate.source_change_order_id
  join valtrim.lots lot on lot.id = candidate.lot_id
  join valtrim.phases phase on phase.id = lot.phase_id
  join valtrim.plans plan on plan.id = candidate.plan_id
  left join valtrim.change_order_plan_rules rule
    on rule.change_order_id = parent.id and rule.plan_id = plan.id
  left join lateral (
    select array_agg(distinct event.scheduled_date order by event.scheduled_date) as dates
    from valtrim.change_order_events event
    join valtrim.change_order_event_lots event_lot on event_lot.event_id = event.id
    join valtrim.lots event_source_lot on event_source_lot.id = event_lot.lot_id
    where event.change_order_id = parent.id
      and event_source_lot.plan_id = plan.id
  ) own on true
  order by parent.change_order_number, phase.code, phase.building nulls first, lot.display_order, lot.lot_number;
end;
$$;

create function valtrim.package_change_order_candidates(p_job_id bigint, p_phase_ids bigint[])
returns table (
  source_change_order_id bigint,
  source_change_order_number varchar,
  source_internal_number varchar,
  source_po_co_number varchar,
  lot_id bigint,
  phase_id bigint,
  phase_code varchar,
  building varchar,
  lot_number varchar,
  plan_id bigint,
  plan_code varchar,
  plan_name varchar,
  scope_of_work varchar,
  amount numeric,
  billing_event text,
  own_event_dates date[]
)
language sql
stable
set search_path = ''
as $$
  select * from private.package_change_order_candidates(p_job_id, p_phase_ids);
$$;

-- The choice, saved just before the Package ---------------------------------------------------------------

-- `p_lots` is a JSON array of { lot_id, event_date? }: the Lots to charge (an empty array = none). The date
-- is only for a Lot whose Plan goes with an event of its own.
create function private.stage_package_change_order_selection(p_job_id bigint, p_lots jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_lot_ids bigint[];
  v_dates jsonb := '{}'::jsonb;
  v_item jsonb;
begin
  if v_user is null or not (select private.has_app_role('ADMIN', 'ACCOUNTING', 'DRAW_INVOICE')) then
    raise exception 'You do not have permission to create Packages' using errcode = '42501';
  end if;
  if p_lots is null or jsonb_typeof(p_lots) <> 'array' then
    raise exception 'The Lots to charge must be a JSON array' using errcode = '23514';
  end if;
  if jsonb_array_length(p_lots) > 5000 then
    raise exception 'A Package can charge up to 5000 Lots' using errcode = '23514';
  end if;

  for v_item in select value from jsonb_array_elements(p_lots) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item->'lot_id') is distinct from 'number'
       or v_item->>'lot_id' !~ '^[1-9][0-9]*$' then
      raise exception 'Every Lot to charge needs its lot_id' using errcode = '23514';
    end if;
    if coalesce(jsonb_typeof(v_item->'event_date'), 'null') <> 'null' then
      if jsonb_typeof(v_item->'event_date') <> 'string'
         or v_item->>'event_date' !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'The date of an event must be YYYY-MM-DD' using errcode = '23514';
      end if;
      v_dates := v_dates || jsonb_build_object(v_item->>'lot_id', v_item->>'event_date');
    end if;
  end loop;

  select coalesce(array_agg(distinct (item->>'lot_id')::bigint), '{}'::bigint[])
  into v_lot_ids
  from jsonb_array_elements(p_lots) item;

  if (
    select count(*) from valtrim.lots lot
    where lot.id = any(v_lot_ids) and lot.job_id = p_job_id and not lot.is_utility_building
  ) <> cardinality(v_lot_ids) then
    raise exception 'Every Lot to charge must be a Lot of the Job' using errcode = '23514';
  end if;

  insert into valtrim.package_change_order_staging as staging (user_id, job_id, lot_ids, event_dates, staged_at)
  values (v_user, p_job_id, v_lot_ids, v_dates, now())
  on conflict (user_id, job_id)
  do update set lot_ids = excluded.lot_ids, event_dates = excluded.event_dates, staged_at = excluded.staged_at;
end;
$$;

create function valtrim.stage_package_change_order_selection(p_job_id bigint, p_lots jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.stage_package_change_order_selection(p_job_id, p_lots);
$$;

-- A new Package takes the choice saved for its user and Job, once.
create function private.take_package_change_order_staging(p_package_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_job_id bigint;
  v_created_at timestamptz;
  v_staging valtrim.package_change_order_staging;
begin
  if v_user is null or exists (
    select 1 from valtrim.package_change_order_choices choice where choice.package_id = p_package_id
  ) then
    return;
  end if;

  select package.job_id, package.created_at
  into v_job_id, v_created_at
  from valtrim.draw_packages package
  where package.id = p_package_id;
  if v_job_id is null or v_created_at < now() - interval '15 minutes' then
    return;
  end if;

  select * into v_staging
  from valtrim.package_change_order_staging staging
  where staging.user_id = v_user
    and staging.job_id = v_job_id
    and staging.staged_at <= v_created_at
    and staging.staged_at > now() - interval '15 minutes'
  for update;
  if not found then
    return;
  end if;

  insert into valtrim.package_change_order_choices (package_id, lot_ids, event_dates)
  values (p_package_id, v_staging.lot_ids, v_staging.event_dates);

  delete from valtrim.package_change_order_staging staging
  where staging.user_id = v_user and staging.job_id = v_job_id;
end;
$$;

-- A Change Order made from a Package gets an event of its own for the Lots that came with a date -----------

create function private.schedule_package_change_order_events(p_change_order_id bigint, p_package_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_job_id bigint;
  v_package_number varchar;
  v_dates jsonb;
  v_date date;
  v_event_id bigint;
begin
  select choice.event_dates into v_dates
  from valtrim.package_change_order_choices choice
  where choice.package_id = p_package_id;
  if v_dates is null or v_dates = '{}'::jsonb then
    return;
  end if;

  select change_order.job_id into v_job_id from valtrim.change_orders change_order where change_order.id = p_change_order_id;
  select package.package_number into v_package_number from valtrim.draw_packages package where package.id = p_package_id;

  for v_date in
    select distinct (v_dates ->> line.lot_id::text)::date
    from valtrim.change_order_lines line
    where line.change_order_id = p_change_order_id
      and line.lot_id is not null
      and line.billing_event is null
      and v_dates ? line.lot_id::text
      and not exists (select 1 from valtrim.change_order_event_lots event_lot where event_lot.line_id = line.id)
    order by 1
  loop
    -- A date that already went by cannot be scheduled: those Lots wait for an event from the Extra / CO page.
    continue when v_date is null or v_date < current_date;

    insert into valtrim.change_order_events (change_order_id, job_id, scheduled_date, note, created_by, updated_by)
    values (p_change_order_id, v_job_id, v_date, format('Charged from Package %s', v_package_number), v_actor, v_actor)
    returning id into v_event_id;

    insert into valtrim.change_order_event_lots (event_id, change_order_id, line_id, lot_id)
    select v_event_id, p_change_order_id, line.id, line.lot_id
    from valtrim.change_order_lines line
    where line.change_order_id = p_change_order_id
      and line.lot_id is not null
      and line.billing_event is null
      and (v_dates ->> line.lot_id::text)::date = v_date
      and not exists (select 1 from valtrim.change_order_event_lots event_lot where event_lot.line_id = line.id);
  end loop;
end;
$$;

-- The sync: a Package with a choice charges exactly the chosen Lots ---------------------------------------

create or replace function private.sync_package_change_orders(p_package_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_package_number varchar;
  v_job_id bigint;
  v_package_date date;
  v_live boolean;
  v_lots bigint[] := '{}'::bigint[];
  v_voided_package_id bigint;
  v_source_id bigint;
  v_child_id bigint;
  v_number text;
  v_last_line integer;
  v_released_lots bigint[] := '{}'::bigint[];
  v_other_package_id bigint;
  v_choice_lots bigint[];
begin
  select
    package.package_number,
    package.job_id,
    package.package_date,
    package.status <> 'VOIDED' and package.package_type in ('DRAW', 'OPTIONS')
  into v_package_number, v_job_id, v_package_date, v_live
  from valtrim.draw_packages package
  where package.id = p_package_id;
  if not found then
    return;
  end if;

  if v_live then
    select coalesce(array_agg(distinct billed.lot_id), '{}'::bigint[])
    into v_lots
    from (
      select draw.lot_id from valtrim.package_draws draw where draw.package_id = p_package_id
      union
      select billed_option.lot_id from valtrim.package_options billed_option
      where billed_option.package_id = p_package_id
    ) billed
    join valtrim.lots lot on lot.id = billed.lot_id and not lot.is_utility_building;

    -- A Package made with a choice of Lots charges exactly those, billed by it or not.
    perform private.take_package_change_order_staging(p_package_id);
    select choice.lot_ids
    into v_choice_lots
    from valtrim.package_change_order_choices choice
    where choice.package_id = p_package_id;

    if v_choice_lots is not null then
      select coalesce(array_agg(distinct lot.id), '{}'::bigint[])
      into v_lots
      from valtrim.lots lot
      where lot.id = any(v_choice_lots)
        and lot.job_id = v_job_id
        and not lot.is_utility_building;
    end if;
  end if;

  perform set_config('valtrim.change_order_package_sync', 'on', true);

  -- 1. A voided Package that still holds one of these Lots gives it back first.
  if cardinality(v_lots) > 0 then
    for v_voided_package_id in
      select distinct charge.package_id
      from valtrim.change_order_plan_charges charge
      join valtrim.draw_packages package on package.id = charge.package_id
      where charge.lot_id = any(v_lots)
        and charge.released_at is null
        and charge.package_id <> p_package_id
        and package.status = 'VOIDED'
    loop
      perform private.sync_package_change_orders(v_voided_package_id);
      perform set_config('valtrim.change_order_package_sync', 'on', true);
    end loop;
  end if;

  -- 2. The Lots this Package no longer bills (or all of them, when it was voided) are given back.
  --    A Change Order of this Package that loses all its Lots is cancelled and keeps its lines, so it still
  --    shows what it charged; one that keeps some Lots loses the lines of the others. A Change Order that
  --    someone cancelled by hand is left as it is, and so is one that was invoiced: what it charged stands.
  update valtrim.change_orders change_order
  set status = 'CANCELLED',
      cancelled_at = now(),
      cancelled_by = v_actor_id,
      cancel_reason = case
        when v_live then format('Package %s no longer bills its Lots', v_package_number)
        else format('Package %s was voided', v_package_number)
      end,
      updated_by = v_actor_id
  where change_order.source_package_id = p_package_id
    and change_order.status = 'APPROVED'
    and private.change_order_invoice_package(change_order.id) is null
    and exists (
      select 1
      from valtrim.change_order_plan_charges charge
      where charge.change_order_id = change_order.id
        and charge.released_at is null
        and not (charge.lot_id = any(v_lots))
    )
    and not exists (
      select 1
      from valtrim.change_order_plan_charges charge
      where charge.change_order_id = change_order.id
        and charge.released_at is null
        and charge.lot_id = any(v_lots)
    );

  delete from valtrim.change_order_lines line
  using valtrim.change_order_plan_charges charge, valtrim.change_orders change_order
  where charge.package_id = p_package_id
    and charge.released_at is null
    and not (charge.lot_id = any(v_lots))
    and line.change_order_id = charge.change_order_id
    and line.lot_id = charge.lot_id
    and change_order.id = charge.change_order_id
    and change_order.status = 'APPROVED'
    and private.change_order_invoice_package(change_order.id) is null;

  with released as (
    update valtrim.change_order_plan_charges charge
    set released_at = now(),
        release_reason = case
          when v_live then format('The Lot left Package %s', v_package_number)
          else format('Package %s was voided', v_package_number)
        end
    where charge.package_id = p_package_id
      and charge.released_at is null
      and not (charge.lot_id = any(v_lots))
      and private.change_order_invoice_package(charge.change_order_id) is null
    returning charge.lot_id
  )
  select coalesce(array_agg(distinct released.lot_id), '{}'::bigint[])
  into v_released_lots
  from released;

  -- A Lot given back is charged by the first other Package that still bills it, if there is one; if not,
  -- the next Package that bills it charges it.
  if cardinality(v_released_lots) > 0 then
    for v_other_package_id in
      select package.id
      from valtrim.draw_packages package
      where package.id <> p_package_id
        and package.job_id = v_job_id
        and package.status <> 'VOIDED'
        and package.package_type in ('DRAW', 'OPTIONS')
        and (
          exists (
            select 1 from valtrim.package_draws draw
            where draw.package_id = package.id and draw.lot_id = any(v_released_lots)
          )
          or exists (
            select 1 from valtrim.package_options billed_option
            where billed_option.package_id = package.id and billed_option.lot_id = any(v_released_lots)
          )
        )
      order by package.id
    loop
      perform private.sync_package_change_orders(v_other_package_id);
      perform set_config('valtrim.change_order_package_sync', 'on', true);
    end loop;
  end if;

  -- 3. The Lots it bills that a rule has not charged yet, one Change Order for each rule.
  if v_live and cardinality(v_lots) > 0 then
    for v_source_id in
      select distinct candidate.source_change_order_id
      from private.plan_change_order_candidates(v_job_id, v_lots, p_package_id) candidate
      where not exists (
        select 1
        from valtrim.change_order_plan_charges charge
        where charge.source_change_order_id = candidate.source_change_order_id
          and charge.lot_id = candidate.lot_id
          and charge.package_id = p_package_id
          and charge.released_at is null
      )
      order by candidate.source_change_order_id
    loop
      v_child_id := null;
      select change_order.id
      into v_child_id
      from valtrim.change_orders change_order
      where change_order.source_change_order_id = v_source_id
        and change_order.source_package_id = p_package_id
        and change_order.status <> 'CANCELLED'
        -- One already invoiced is closed: new Lots go on another Change Order of the same Package.
        and private.change_order_invoice_package(change_order.id) is null
      order by change_order.id desc
      limit 1;

      if v_child_id is null then
        v_number := private.next_change_order_number();

        insert into valtrim.change_orders (
          change_order_number, internal_number, builder_id, job_id, requested_by, request_date,
          status, coverage, approved_at, approved_by, created_by, updated_by,
          source_change_order_id, source_package_id
        )
        select
          v_number,
          v_number,
          parent.builder_id,
          parent.job_id,
          parent.requested_by,
          coalesce(v_package_date, current_date),
          'APPROVED',
          '{}'::jsonb,
          now(),
          parent.approved_by,
          v_actor_id,
          v_actor_id,
          parent.id,
          p_package_id
        from valtrim.change_orders parent
        where parent.id = v_source_id
        returning id into v_child_id;
      end if;

      select coalesce(max(line.line_number), 0)
      into v_last_line
      from valtrim.change_order_lines line
      where line.change_order_id = v_child_id;

      -- The lines first, then the charges: the charges are what tells a Lot is taken.
      insert into valtrim.change_order_lines (
        change_order_id, lot_id, job_id, phase_id, line_number,
        phase_code, building, lot_number, plan_code, plan_name, location,
        scope_of_work, amount, po_number, billing_event, billing_event_date
      )
      select
        v_child_id,
        lot.id,
        lot.job_id,
        lot.phase_id,
        (v_last_line + row_number() over (
          order by phase.code, phase.building nulls first, lot.display_order, lot.lot_number
        ))::integer,
        phase.code,
        phase.building,
        lot.lot_number,
        plan.code,
        plan.name,
        null,
        candidate.scope_of_work,
        candidate.amount,
        null,
        null,
        null
      from private.plan_change_order_candidates(v_job_id, v_lots, p_package_id) candidate
      join valtrim.lots lot on lot.id = candidate.lot_id
      join valtrim.phases phase on phase.id = lot.phase_id
      join valtrim.plans plan on plan.id = candidate.plan_id
      where candidate.source_change_order_id = v_source_id
        and not exists (
          select 1
          from valtrim.change_order_plan_charges charge
          where charge.source_change_order_id = v_source_id
            and charge.lot_id = candidate.lot_id
            and charge.package_id = p_package_id
            and charge.released_at is null
        );

      insert into valtrim.change_order_plan_charges (
        source_change_order_id, change_order_id, package_id, lot_id, plan_id
      )
      select v_source_id, v_child_id, p_package_id, candidate.lot_id, candidate.plan_id
      from private.plan_change_order_candidates(v_job_id, v_lots, p_package_id) candidate
      where candidate.source_change_order_id = v_source_id
        and not exists (
          select 1
          from valtrim.change_order_plan_charges charge
          where charge.source_change_order_id = v_source_id
            and charge.lot_id = candidate.lot_id
            and charge.package_id = p_package_id
            and charge.released_at is null
        );
      -- Lots charged on the date of an event of their own get that event.
      perform private.schedule_package_change_order_events(v_child_id, p_package_id);
    end loop;
  end if;

  perform set_config('valtrim.change_order_package_sync', 'off', true);
end;
$$;

-- Who can call what -------------------------------------------------------------------------------------

revoke execute on function
  private.package_change_order_candidates(bigint, bigint[]),
  valtrim.package_change_order_candidates(bigint, bigint[]),
  private.stage_package_change_order_selection(bigint, jsonb),
  valtrim.stage_package_change_order_selection(bigint, jsonb),
  private.take_package_change_order_staging(bigint),
  private.schedule_package_change_order_events(bigint, bigint)
from public, anon, authenticated;

grant execute on function
  private.package_change_order_candidates(bigint, bigint[]),
  valtrim.package_change_order_candidates(bigint, bigint[]),
  private.stage_package_change_order_selection(bigint, jsonb),
  valtrim.stage_package_change_order_selection(bigint, jsonb)
to authenticated, service_role;

comment on function valtrim.package_change_order_candidates(bigint, bigint[]) is
  'Every Lot of the Phases that a Specific plan types Extra / CO could still charge, with the event its Plan was tied to. For the Create Package screen.';
comment on function valtrim.stage_package_change_order_selection(bigint, jsonb) is
  'Saves the Lots a person chose to charge on Create Package, for the Package they are about to create. ADMIN, ACCOUNTING and DRAW_INVOICE.';

notify pgrst, 'reload schema';
commit;
