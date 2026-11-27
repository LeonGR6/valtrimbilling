-- Extra / Change Orders by Plan: the Lots that come later are charged from the first Package that bills them.
--
-- A Change Order that covers "Specific plan types" keeps, for each Plan it covers, the Scope of Work and the
-- Amount of that Plan (change_order_plan_rules). Its lines are the Lots that had those Plans when it was saved,
-- as before. Once it is APPROVED it also works as a rule for the Lots that come later:
--
--   * when a Draw or Options Package bills a Lot of the Job with one of those Plans, and the Lot is neither on
--     the lines of the Change Order nor charged already by it, a Change Order of its own is made for that
--     Package: APPROVED, with the next CO number, one line per such Lot with the Scope and Amount of its Plan,
--     and it says where it came from (source_change_order_id, source_package_id);
--   * the Package itself does not change: the charge is not one of its lines;
--   * each Lot is charged once by each rule (change_order_plan_charges), in the first Package that bills it;
--   * a Lot that leaves the Package (an edit) or a Package that is voided gives its Lots back: a Change Order
--     that loses all its Lots is cancelled (keeping its lines, to show what it charged), one that keeps some
--     loses the lines of the others; a Lot given back is charged by the first other live Package that bills
--     it, or else by the next Package that does;
--   * a Change Order made from a Package that someone cancels by hand keeps its Lots charged.
--
-- All of this runs when the transaction that creates or changes the Package commits (deferred constraint
-- triggers), so every way of making or correcting a Package is covered and sees the Package as it ends up.
--
-- New:
--   change_order_plan_rules            Scope of Work and Amount by Plan of a "Specific plan types" CO
--   change_order_plan_charges          which Lot was charged by which rule, through which Package
--   change_orders.source_*             where a Change Order made from a Package came from
--   package_change_order_preview       what a Package would charge, for the Create Package preview
--   create_change_order / update_change_order   take `p_plan_rules` (last argument, optional)
--   change_order_overview              four more columns at the end: the source CO and Package
--
-- Approving a "Specific plan types" Change Order needs its Scope and Amount by Plan.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Where a Change Order made from a Package came from -----------------------------------------------------

alter table valtrim.change_orders
  add column source_change_order_id bigint references valtrim.change_orders(id) on delete restrict,
  add column source_package_id bigint references valtrim.draw_packages(id) on delete restrict,
  add constraint change_orders_source_check
    check ((source_change_order_id is null) = (source_package_id is null));

create index change_orders_source_change_order_idx
  on valtrim.change_orders (source_change_order_id)
  where source_change_order_id is not null;
create index change_orders_source_package_idx
  on valtrim.change_orders (source_package_id)
  where source_package_id is not null;
-- One live Change Order for each rule and Package.
create unique index change_orders_one_per_source_package
  on valtrim.change_orders (source_change_order_id, source_package_id)
  where source_change_order_id is not null and status <> 'CANCELLED';

comment on column valtrim.change_orders.source_change_order_id is
  'For a Change Order made from a Package: the "Specific plan types" Change Order whose Scope and Amount it charges.';
comment on column valtrim.change_orders.source_package_id is
  'For a Change Order made from a Package: the Package that billed its Lots.';

-- The Scope and Amount by Plan ----------------------------------------------------------------------------

create table valtrim.change_order_plan_rules (
  change_order_id bigint not null,
  plan_id bigint not null,
  job_id bigint not null,
  scope_of_work varchar(1000) not null check (btrim(scope_of_work) <> ''),
  amount numeric(14,2) not null
    check (amount <> 0 and abs(amount) <= 999999999999.99),
  created_at timestamptz not null default now(),
  primary key (change_order_id, plan_id),
  foreign key (change_order_id, job_id)
    references valtrim.change_orders(id, job_id) on delete restrict,
  foreign key (plan_id, job_id)
    references valtrim.plans(id, job_id) on delete restrict
);

create index change_order_plan_rules_plan_idx on valtrim.change_order_plan_rules (plan_id);

comment on table valtrim.change_order_plan_rules is
  'The Scope of Work and Amount of each Plan of a "Specific plan types" Change Order. Once the CO is approved, a Lot with that Plan billed later by a Package is charged with them.';

-- The Lots charged later --------------------------------------------------------------------------------

create table valtrim.change_order_plan_charges (
  id bigint generated always as identity primary key,
  source_change_order_id bigint not null references valtrim.change_orders(id) on delete restrict,
  change_order_id bigint not null references valtrim.change_orders(id) on delete restrict,
  package_id bigint not null references valtrim.draw_packages(id) on delete restrict,
  lot_id bigint not null references valtrim.lots(id) on delete restrict,
  plan_id bigint not null references valtrim.plans(id) on delete restrict,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  release_reason varchar(200),
  check ((released_at is null) = (release_reason is null))
);

-- A Lot is charged once by each rule while its charge stands.
create unique index change_order_plan_charges_one_per_lot
  on valtrim.change_order_plan_charges (source_change_order_id, lot_id)
  where released_at is null;
create index change_order_plan_charges_package_idx
  on valtrim.change_order_plan_charges (package_id)
  where released_at is null;
create index change_order_plan_charges_change_order_idx
  on valtrim.change_order_plan_charges (change_order_id);
create index change_order_plan_charges_lot_idx
  on valtrim.change_order_plan_charges (lot_id)
  where released_at is null;

comment on table valtrim.change_order_plan_charges is
  'Each Lot charged by the Scope and Amount by Plan of a Change Order, with the Package that billed it and the Change Order made for it. Released when the Lot leaves the Package or the Package is voided.';

-- Reading: every active user, like the other Change Order tables. Writing: only the functions below.

alter table valtrim.change_order_plan_rules enable row level security;
alter table valtrim.change_order_plan_charges enable row level security;

create policy change_order_plan_rules_select
  on valtrim.change_order_plan_rules for select to authenticated
  using ((select private.is_active_user()));
create policy change_order_plan_charges_select
  on valtrim.change_order_plan_charges for select to authenticated
  using ((select private.is_active_user()));

revoke all on table valtrim.change_order_plan_rules, valtrim.change_order_plan_charges
  from public, anon, authenticated;
grant select on table valtrim.change_order_plan_rules, valtrim.change_order_plan_charges to authenticated;
grant all on table valtrim.change_order_plan_rules, valtrim.change_order_plan_charges to service_role;

-- Guards ------------------------------------------------------------------------------------------------

-- Is the Package sync writing right now? Only it may touch the lines of an approved Change Order made from a
-- Package; the setting lives until the end of the transaction and the sync turns it off when it is done.
create function private.change_order_package_sync_on()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('valtrim.change_order_package_sync', true), '') = 'on';
$$;

create or replace function private.guard_change_order_line_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status valtrim.change_order_status;
  v_from_package boolean;
begin
  select change_order.status, change_order.source_change_order_id is not null
  into v_status, v_from_package
  from valtrim.change_orders change_order
  where change_order.id = case when tg_op = 'DELETE' then old.change_order_id else new.change_order_id end;

  if v_status in ('DRAFT', 'PENDING') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- A Change Order made from a Package follows its Package.
  if v_status = 'APPROVED' and v_from_package and private.change_order_package_sync_on() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  raise exception 'The lines of an approved or cancelled Change Order cannot change'
    using errcode = '23514';
end;
$$;

create function private.guard_change_order_plan_rule_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status valtrim.change_order_status;
begin
  select change_order.status
  into v_status
  from valtrim.change_orders change_order
  where change_order.id = case when tg_op = 'DELETE' then old.change_order_id else new.change_order_id end;

  if v_status is null or v_status not in ('DRAFT', 'PENDING') then
    raise exception 'The Scope and Amount by Plan of an approved or cancelled Change Order cannot change'
      using errcode = '23514';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger change_order_plan_rules_guard_change
before insert or update or delete on valtrim.change_order_plan_rules
for each row execute function private.guard_change_order_plan_rule_change();

create or replace function private.guard_change_order_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.change_order_number is distinct from old.change_order_number then
    raise exception 'The number of a Change Order cannot change'
      using errcode = '23514';
  end if;

  if row(new.source_change_order_id, new.source_package_id)
     is distinct from row(old.source_change_order_id, old.source_package_id) then
    raise exception 'Where a Change Order came from cannot change'
      using errcode = '23514';
  end if;

  if new.status is distinct from old.status
     and not private.change_order_transition_allowed(old.status, new.status) then
    raise exception 'A % Change Order cannot become %', old.status, new.status
      using errcode = '23514';
  end if;

  if old.status in ('APPROVED', 'CANCELLED')
     and row(
       new.internal_number, new.title, new.builder_id, new.job_id, new.requested_by,
       new.request_date, new.needed_by_date, new.coverage
     ) is distinct from row(
       old.internal_number, old.title, old.builder_id, old.job_id, old.requested_by,
       old.request_date, old.needed_by_date, old.coverage
     ) then
    raise exception 'An approved or cancelled Change Order cannot be edited'
      using errcode = '23514';
  end if;

  -- A "Specific plan types" Change Order is approved with its Scope and Amount by Plan: they are what the
  -- Lots that come later are charged with.
  if new.status = 'APPROVED' and old.status is distinct from 'APPROVED'
     and new.source_change_order_id is null
     and coalesce(new.coverage->>'mode', 'lots') = 'plans'
     and not exists (
       select 1 from valtrim.change_order_plan_rules rule where rule.change_order_id = new.id
     ) then
    raise exception 'Write the Scope and Amount of each Plan before approving this Change Order'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Writing the Scope and Amount by Plan ------------------------------------------------------------------

-- Replaces the rules of a Draft or Pending Change Order. `p_rules` is a JSON array of
-- { plan_id, scope_of_work, amount }, one per Plan of the coverage; null leaves the CO without rules (a Draft
-- may wait for them; approving it needs them). Only a "Specific plan types" coverage takes rules.
create function private.replace_change_order_plan_rules(
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

  insert into valtrim.change_order_plan_rules (change_order_id, plan_id, job_id, scope_of_work, amount)
  select
    p_change_order_id,
    (item->>'plan_id')::bigint,
    p_job_id,
    btrim(item->>'scope_of_work'),
    (item->>'amount')::numeric(14,2)
  from jsonb_array_elements(p_rules) item;
end;
$$;

-- The writers: one more argument -------------------------------------------------------------------------

drop function valtrim.create_change_order(bigint, text, text, jsonb, text, date, date, jsonb, valtrim.change_order_status, text);
drop function valtrim.update_change_order(bigint, bigint, text, text, jsonb, text, date, date, jsonb, text);
drop function private.create_change_order(bigint, text, text, jsonb, text, date, date, jsonb, valtrim.change_order_status, text);
drop function private.update_change_order(bigint, bigint, text, text, jsonb, text, date, date, jsonb, text);

create function private.create_change_order(
  p_job_id bigint,
  p_title text,
  p_requested_by text,
  p_lines jsonb,
  p_internal_number text default null,
  p_request_date date default null,
  p_needed_by_date date default null,
  p_coverage jsonb default null,
  p_status valtrim.change_order_status default 'DRAFT',
  p_po_co_number text default null,
  p_plan_rules jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_builder_id bigint;
  v_number text;
  v_po_co_number text;
  v_change_order_id bigint;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to create a Change Order'
      using errcode = '42501';
  end if;
  if p_status is null or p_status = 'CANCELLED' then
    raise exception 'A Change Order is created as Draft, Pending or Approved'
      using errcode = '23514';
  end if;
  if p_status = 'APPROVED' and not (select private.has_app_role('ADMIN')) then
    raise exception 'Only an Admin approves a Change Order'
      using errcode = '42501';
  end if;

  v_builder_id := private.check_change_order_header(
    p_job_id, p_title, p_internal_number, p_requested_by,
    p_request_date, p_needed_by_date, p_coverage
  );
  v_po_co_number := private.clean_po_co_number(p_po_co_number);

  -- The number is taken only now, once the header has been checked, so a header that is refused does not use one up.
  v_number := private.next_change_order_number();

  -- It is born a Draft, because the lines of an approved CO cannot be written; it moves on once they are.
  insert into valtrim.change_orders (
    change_order_number, internal_number, po_co_number, title, builder_id, job_id, requested_by,
    request_date, needed_by_date, status, coverage, created_by, updated_by
  ) values (
    v_number,
    coalesce(nullif(btrim(coalesce(p_internal_number, '')), ''), v_number),
    v_po_co_number,
    nullif(btrim(coalesce(p_title, '')), ''),
    v_builder_id,
    p_job_id,
    btrim(p_requested_by),
    p_request_date,
    p_needed_by_date,
    'DRAFT',
    coalesce(p_coverage, '{}'::jsonb),
    v_actor_id,
    v_actor_id
  ) returning id into v_change_order_id;

  perform private.replace_change_order_lines(v_change_order_id, p_job_id, p_lines);
  perform private.replace_change_order_plan_rules(v_change_order_id, p_job_id, p_coverage, p_plan_rules);

  if p_status <> 'DRAFT' then
    update valtrim.change_orders
    set status = p_status,
        approved_at = case when p_status = 'APPROVED' then now() end,
        approved_by = case when p_status = 'APPROVED' then v_actor_id end
    where id = v_change_order_id;
  end if;

  return v_change_order_id;
end;
$$;

create function valtrim.create_change_order(
  p_job_id bigint,
  p_title text,
  p_requested_by text,
  p_lines jsonb,
  p_internal_number text default null,
  p_request_date date default null,
  p_needed_by_date date default null,
  p_coverage jsonb default null,
  p_status valtrim.change_order_status default 'DRAFT',
  p_po_co_number text default null,
  p_plan_rules jsonb default null
)
returns bigint
language sql
set search_path = ''
as $$
  select private.create_change_order(
    p_job_id, p_title, p_requested_by, p_lines, p_internal_number,
    p_request_date, p_needed_by_date, p_coverage, p_status, p_po_co_number, p_plan_rules
  );
$$;

create function private.update_change_order(
  p_change_order_id bigint,
  p_job_id bigint,
  p_title text,
  p_requested_by text,
  p_lines jsonb,
  p_internal_number text default null,
  p_request_date date default null,
  p_needed_by_date date default null,
  p_coverage jsonb default null,
  p_po_co_number text default null,
  p_plan_rules jsonb default null
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
  v_po_co_number text;
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
  v_po_co_number := private.clean_po_co_number(p_po_co_number);

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

  -- The lines and the rules go first: they point at the Job of the header.
  delete from valtrim.change_order_lines
  where change_order_id = p_change_order_id;
  delete from valtrim.change_order_plan_rules
  where change_order_id = p_change_order_id;

  update valtrim.change_orders
  set internal_number = nullif(btrim(coalesce(p_internal_number, '')), ''),
      po_co_number = v_po_co_number,
      title = nullif(btrim(coalesce(p_title, '')), ''),
      builder_id = v_builder_id,
      job_id = p_job_id,
      requested_by = btrim(p_requested_by),
      request_date = p_request_date,
      needed_by_date = p_needed_by_date,
      coverage = coalesce(p_coverage, '{}'::jsonb),
      updated_by = v_actor_id
  where id = p_change_order_id;

  perform private.replace_change_order_lines(p_change_order_id, p_job_id, p_lines, v_previous_ties);
  perform private.replace_change_order_plan_rules(p_change_order_id, p_job_id, p_coverage, p_plan_rules);
end;
$$;

create function valtrim.update_change_order(
  p_change_order_id bigint,
  p_job_id bigint,
  p_title text,
  p_requested_by text,
  p_lines jsonb,
  p_internal_number text default null,
  p_request_date date default null,
  p_needed_by_date date default null,
  p_coverage jsonb default null,
  p_po_co_number text default null,
  p_plan_rules jsonb default null
)
returns void
language sql
set search_path = ''
as $$
  select private.update_change_order(
    p_change_order_id, p_job_id, p_title, p_requested_by, p_lines, p_internal_number,
    p_request_date, p_needed_by_date, p_coverage, p_po_co_number, p_plan_rules
  );
$$;

-- Deleting a Draft takes its rules too.
create or replace function private.delete_change_order(p_change_order_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_status valtrim.change_order_status;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to delete a Change Order'
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
  if v_status <> 'DRAFT' then
    raise exception 'Only a Draft Change Order can be deleted. Cancel it instead'
      using errcode = '23514';
  end if;

  -- The lines and the rules first (the guards let a Draft's go), then the history, then the header.
  delete from valtrim.change_order_lines
  where change_order_id = p_change_order_id;
  delete from valtrim.change_order_plan_rules
  where change_order_id = p_change_order_id;
  delete from valtrim.change_order_status_history
  where change_order_id = p_change_order_id;
  delete from valtrim.change_orders
  where id = p_change_order_id;
end;
$$;

-- What a Package charges ---------------------------------------------------------------------------------

-- The Lots among `p_lot_ids` that an approved "Specific plan types" Change Order of the Job would charge:
-- their Plan has a rule, they are not on the lines of that CO, and no other Package charges them for it
-- already. `p_package_id` is the Package being synced (its own charges do not count against it), or null for
-- a Package that does not exist yet.
create function private.plan_change_order_candidates(
  p_job_id bigint,
  p_lot_ids bigint[],
  p_package_id bigint default null
)
returns table (
  source_change_order_id bigint,
  lot_id bigint,
  plan_id bigint,
  scope_of_work varchar,
  amount numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select parent.id, lot.id, lot.plan_id, rule.scope_of_work, rule.amount
  from valtrim.change_order_plan_rules rule
  join valtrim.change_orders parent
    on parent.id = rule.change_order_id
   and parent.job_id = p_job_id
   and parent.status = 'APPROVED'
   and parent.source_change_order_id is null
  join valtrim.lots lot
    on lot.plan_id = rule.plan_id
   and lot.job_id = p_job_id
   and lot.id = any(p_lot_ids)
   and not lot.is_utility_building
  where not exists (
      select 1
      from valtrim.change_order_lines own
      where own.change_order_id = parent.id
        and own.lot_id = lot.id
    )
    and not exists (
      select 1
      from valtrim.change_order_plan_charges charge
      where charge.source_change_order_id = parent.id
        and charge.lot_id = lot.id
        and charge.released_at is null
        and charge.package_id is distinct from p_package_id
    );
$$;

-- What the Create Package screen shows under the Package: the Lots it would charge, with the Scope and Amount
-- of their Plan. Nothing is written.
create function private.package_change_order_preview(p_job_id bigint, p_lot_ids bigint[])
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
  amount numeric
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
  if coalesce(cardinality(p_lot_ids), 0) > 5000 then
    raise exception 'A Package can have up to 5000 Lots' using errcode = '23514';
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
    candidate.amount
  from private.plan_change_order_candidates(p_job_id, coalesce(p_lot_ids, '{}'::bigint[]), null) candidate
  join valtrim.change_orders parent on parent.id = candidate.source_change_order_id
  join valtrim.lots lot on lot.id = candidate.lot_id
  join valtrim.phases phase on phase.id = lot.phase_id
  join valtrim.plans plan on plan.id = candidate.plan_id
  order by parent.change_order_number, phase.code, phase.building nulls first, lot.display_order, lot.lot_number;
end;
$$;

create function valtrim.package_change_order_preview(p_job_id bigint, p_lot_ids bigint[])
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
  amount numeric
)
language sql
stable
set search_path = ''
as $$
  select * from private.package_change_order_preview(p_job_id, p_lot_ids);
$$;

-- Brings the Change Orders made from one Package in line with the Package as it is now. Run when the
-- transaction that made or changed the Package commits.
create function private.sync_package_change_orders(p_package_id bigint)
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
  --    someone cancelled by hand is left as it is.
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
    and change_order.status = 'APPROVED';

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
        and change_order.status <> 'CANCELLED';

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
    end loop;
  end if;

  perform set_config('valtrim.change_order_package_sync', 'off', true);
end;
$$;

-- Runs the sync once for each Package touched by the transaction, when it commits.
create function private.queue_package_change_order_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package_id bigint;
  v_done text := coalesce(current_setting('valtrim.change_order_synced_packages', true), '');
begin
  if tg_table_name = 'draw_packages' then
    v_package_id := new.id;
  elsif tg_op = 'DELETE' then
    v_package_id := old.package_id;
  else
    v_package_id := new.package_id;
  end if;

  if position(',' || v_package_id::text || ',' in v_done) > 0 then
    return null;
  end if;
  perform set_config('valtrim.change_order_synced_packages', v_done || ',' || v_package_id::text || ',', true);

  perform private.sync_package_change_orders(v_package_id);
  return null;
end;
$$;

create constraint trigger package_draws_sync_change_orders
after insert or delete on valtrim.package_draws
deferrable initially deferred
for each row execute function private.queue_package_change_order_sync();

create constraint trigger package_options_sync_change_orders
after insert or delete on valtrim.package_options
deferrable initially deferred
for each row execute function private.queue_package_change_order_sync();

create constraint trigger draw_packages_sync_change_orders
after update of status on valtrim.draw_packages
deferrable initially deferred
for each row
when (new.status is distinct from old.status)
execute function private.queue_package_change_order_sync();

-- The list: where a Change Order came from, at the end ---------------------------------------------------

create or replace view valtrim.change_order_overview
with (security_invoker = true)
as
select
  change_order.id,
  change_order.change_order_number,
  change_order.internal_number,
  change_order.title,
  change_order.status,
  change_order.builder_id,
  builder.name as builder_name,
  change_order.job_id,
  job.code as job_code,
  job.community,
  change_order.requested_by,
  change_order.request_date,
  change_order.needed_by_date,
  change_order.created_at,
  change_order.updated_at,
  coalesce(totals.line_count, 0) as line_count,
  coalesce(totals.total_amount, 0) as total_amount,
  change_order.po_co_number,
  change_order.source_change_order_id,
  source.change_order_number as source_change_order_number,
  change_order.source_package_id,
  source_package.package_number as source_package_number
from valtrim.change_orders change_order
join valtrim.builders builder on builder.id = change_order.builder_id
join valtrim.jobs job on job.id = change_order.job_id
left join valtrim.change_orders source on source.id = change_order.source_change_order_id
left join valtrim.draw_packages source_package on source_package.id = change_order.source_package_id
left join lateral (
  select count(*) as line_count, sum(line.amount) as total_amount
  from valtrim.change_order_lines line
  where line.change_order_id = change_order.id
) totals on true;

-- Who can call what -------------------------------------------------------------------------------------

revoke execute on function
  private.change_order_package_sync_on(),
  private.guard_change_order_plan_rule_change(),
  private.replace_change_order_plan_rules(bigint, bigint, jsonb, jsonb),
  private.create_change_order(bigint, text, text, jsonb, text, date, date, jsonb, valtrim.change_order_status, text, jsonb),
  private.update_change_order(bigint, bigint, text, text, jsonb, text, date, date, jsonb, text, jsonb),
  valtrim.create_change_order(bigint, text, text, jsonb, text, date, date, jsonb, valtrim.change_order_status, text, jsonb),
  valtrim.update_change_order(bigint, bigint, text, text, jsonb, text, date, date, jsonb, text, jsonb),
  private.plan_change_order_candidates(bigint, bigint[], bigint),
  private.package_change_order_preview(bigint, bigint[]),
  valtrim.package_change_order_preview(bigint, bigint[]),
  private.sync_package_change_orders(bigint),
  private.queue_package_change_order_sync()
from public, anon, authenticated;

grant execute on function
  private.create_change_order(bigint, text, text, jsonb, text, date, date, jsonb, valtrim.change_order_status, text, jsonb),
  private.update_change_order(bigint, bigint, text, text, jsonb, text, date, date, jsonb, text, jsonb),
  valtrim.create_change_order(bigint, text, text, jsonb, text, date, date, jsonb, valtrim.change_order_status, text, jsonb),
  valtrim.update_change_order(bigint, bigint, text, text, jsonb, text, date, date, jsonb, text, jsonb),
  private.package_change_order_preview(bigint, bigint[]),
  valtrim.package_change_order_preview(bigint, bigint[])
to authenticated, service_role;

comment on function valtrim.create_change_order(bigint, text, text, jsonb, text, date, date, jsonb, valtrim.change_order_status, text, jsonb) is
  'Creates a Change Order with all its lines (and, for Specific plan types, its Scope and Amount by Plan) as the signed-in user. ADMIN and PROJECT_MANAGEMENT; only ADMIN can create it already approved.';
comment on function valtrim.update_change_order(bigint, bigint, text, text, jsonb, text, date, date, jsonb, text, jsonb) is
  'Replaces the header, every line and the Scope and Amount by Plan of a Draft or Pending Change Order. ADMIN and PROJECT_MANAGEMENT.';
comment on function valtrim.package_change_order_preview(bigint, bigint[]) is
  'The Lots of a Package about to be created that an approved Specific plan types Change Order would charge, with the Scope and Amount of their Plan. Reads only.';
comment on function private.sync_package_change_orders(bigint) is
  'Makes, extends, trims or cancels the Change Orders made from one Package so they charge exactly the Lots it bills that a rule has not charged elsewhere. Run by deferred triggers when the Package changes.';

notify pgrst, 'reload schema';

commit;
