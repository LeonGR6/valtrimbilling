-- Extra / Change Orders (COs).
--
-- A CO is an order of its own, like a Package: it asks for extra work on some Lots of one Job and says
-- how much each Lot costs. It never changes the prices the Job already has. Every Lot is one line with
-- its own Scope of Work and Amount (the "Scope of Work Approval" and "Amount" of the Excel sheets the
-- team keeps today), so the same work on ten Lots is ten lines.
--
--   change_orders                 the header: CO-0001, title, Job, who asked and when, status.
--   change_order_lines            one line per Lot. Its Phase, Building, Lot and Plan labels are copied
--                                 when the line is saved, so the CO keeps reading the same later.
--   change_order_status_history   every status the CO went through, who moved it and when.
--   change_order_overview         the list: the header with its Builder, Community, lots and total.
--
-- What is not here yet: the invoice (each line will go separate in it, like a Package line), Purchase
-- Order lines, attachments, Retention and WRAP. None of them is needed to create a CO.
--
-- Status       DRAFT -> PENDING -> APPROVED, and CANCELLED from any of them. A PENDING CO can go back to
--              DRAFT. CANCELLED is final. An approved or cancelled CO cannot be edited, and a CO is never
--              deleted: it is cancelled, with a reason, and stays visible.
-- Who          ADMIN and PROJECT_MANAGEMENT create, edit, send to PENDING and cancel a CO that is not
--              approved yet. Only ADMIN approves a CO or cancels an approved one. Every active user reads.
-- Amount       Not zero. A negative Amount is a credit.
-- The Lots     A Lot can be in many COs, but only once in the same one. They must belong to an active
--              Phase of the CO's Job. Lines are saved together with the header, as one call.

begin;

create type valtrim.change_order_status as enum ('DRAFT', 'PENDING', 'APPROVED', 'CANCELLED');

-- CO-0001, CO-0002 ... (more than four digits once it passes 9999).
create sequence valtrim.change_order_number_seq;

create function private.next_change_order_number()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'CO-' || case when next_value.n < 10000 then lpad(next_value.n::text, 4, '0') else next_value.n::text end
  from (select nextval('valtrim.change_order_number_seq') as n) next_value;
$$;

-- The header ------------------------------------------------------------------------------------------

create table valtrim.change_orders (
  id bigint generated always as identity primary key,
  change_order_number varchar(24) not null unique default private.next_change_order_number(),
  -- The number the team gives the extra on its own; free text.
  internal_number varchar(60) check (internal_number is null or btrim(internal_number) <> ''),
  title varchar(150) not null check (btrim(title) <> ''),
  builder_id bigint not null,
  job_id bigint not null,
  requested_by varchar(100) not null check (btrim(requested_by) <> ''),
  request_date date,
  needed_by_date date,
  status valtrim.change_order_status not null default 'DRAFT',
  -- How the Lots were chosen ({ mode, lotIds, recordIds, planIds }) so a draft can be opened as it was
  -- left. Only the screen reads it: the lines are what the CO covers.
  coverage jsonb not null default '{}'::jsonb check (jsonb_typeof(coverage) = 'object'),
  approved_at timestamptz,
  approved_by uuid,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason varchar(500) check (cancel_reason is null or btrim(cancel_reason) <> ''),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (job_id, builder_id)
    references valtrim.jobs(id, builder_id) on delete restrict,
  unique (id, job_id),
  constraint change_orders_dates_check check (
    request_date is null or needed_by_date is null or needed_by_date >= request_date
  ),
  -- An approved CO says when and by whom; it keeps both if it is cancelled later.
  constraint change_orders_approval_check check (
    status <> 'APPROVED' or (approved_at is not null and approved_by is not null)
  ),
  constraint change_orders_cancellation_check check (
    (status = 'CANCELLED') = (cancelled_at is not null and cancel_reason is not null)
  )
);

create index change_orders_job_idx on valtrim.change_orders (job_id, created_at desc);
create index change_orders_builder_idx on valtrim.change_orders (builder_id, created_at desc);
create index change_orders_status_idx on valtrim.change_orders (status, created_at desc);

create trigger change_orders_set_updated_at
before update on valtrim.change_orders
for each row execute function valtrim.set_updated_at();

-- The lines -------------------------------------------------------------------------------------------

create table valtrim.change_order_lines (
  change_order_id bigint not null,
  lot_id bigint not null,
  job_id bigint not null,
  phase_id bigint not null,
  -- The order the lines were saved in.
  line_number integer not null check (line_number >= 1),
  -- Copied from the Lot when the line is saved.
  phase_code varchar(40) not null,
  building varchar(80),
  lot_number varchar(40) not null,
  plan_code varchar(40) not null,
  plan_name varchar(100) not null,
  scope_of_work varchar(1000) not null check (btrim(scope_of_work) <> ''),
  amount numeric(14,2) not null
    check (amount <> 0 and abs(amount) <= 999999999999.99),
  -- Free text; empty while the Purchase Order is still pending.
  po_number varchar(60) check (po_number is null or btrim(po_number) <> ''),
  created_at timestamptz not null default now(),
  primary key (change_order_id, lot_id),
  unique (change_order_id, line_number),
  foreign key (change_order_id, job_id)
    references valtrim.change_orders(id, job_id) on delete restrict,
  foreign key (lot_id, phase_id)
    references valtrim.lots(id, phase_id) on delete restrict,
  foreign key (phase_id, job_id)
    references valtrim.phases(id, job_id) on delete restrict
);

create index change_order_lines_lot_idx on valtrim.change_order_lines (lot_id);
create index change_order_lines_phase_idx on valtrim.change_order_lines (phase_id, job_id);
create index change_order_lines_job_idx on valtrim.change_order_lines (job_id);

-- The history -----------------------------------------------------------------------------------------

create table valtrim.change_order_status_history (
  id bigint generated always as identity primary key,
  change_order_id bigint not null references valtrim.change_orders(id) on delete restrict,
  previous_status valtrim.change_order_status,
  new_status valtrim.change_order_status not null,
  -- The reason, when the CO was cancelled.
  note varchar(500),
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create index change_order_status_history_idx
  on valtrim.change_order_status_history (change_order_id, changed_at desc, id desc);

-- Guards ----------------------------------------------------------------------------------------------

create function private.change_order_transition_allowed(
  p_from valtrim.change_order_status,
  p_to valtrim.change_order_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('DRAFT', 'PENDING'),
    ('DRAFT', 'APPROVED'),
    ('DRAFT', 'CANCELLED'),
    ('PENDING', 'DRAFT'),
    ('PENDING', 'APPROVED'),
    ('PENDING', 'CANCELLED'),
    ('APPROVED', 'CANCELLED')
  );
$$;

create function private.guard_change_order_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.change_order_number is distinct from old.change_order_number then
    raise exception 'The number of a Change Order cannot change'
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

  return new;
end;
$$;

create trigger change_orders_guard_update
before update on valtrim.change_orders
for each row execute function private.guard_change_order_update();

create function private.record_change_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into valtrim.change_order_status_history (
      change_order_id, previous_status, new_status, changed_by
    ) values (new.id, null, new.status, (select auth.uid()));
  elsif new.status is distinct from old.status then
    insert into valtrim.change_order_status_history (
      change_order_id, previous_status, new_status, note, changed_by
    ) values (
      new.id, old.status, new.status,
      case when new.status = 'CANCELLED' then new.cancel_reason end,
      (select auth.uid())
    );
  end if;
  return null;
end;
$$;

create trigger change_orders_record_status
after insert or update of status on valtrim.change_orders
for each row execute function private.record_change_order_status();

-- Lines only change while the CO is a draft or waiting for approval.
create function private.guard_change_order_line_change()
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
    raise exception 'The lines of an approved or cancelled Change Order cannot change'
      using errcode = '23514';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger change_order_lines_guard_change
before insert or update or delete on valtrim.change_order_lines
for each row execute function private.guard_change_order_line_change();

-- Reading ---------------------------------------------------------------------------------------------

alter table valtrim.change_orders enable row level security;
alter table valtrim.change_order_lines enable row level security;
alter table valtrim.change_order_status_history enable row level security;

revoke all on table
  valtrim.change_orders,
  valtrim.change_order_lines,
  valtrim.change_order_status_history
from public, anon, authenticated;
revoke all on sequence
  valtrim.change_order_number_seq,
  valtrim.change_orders_id_seq,
  valtrim.change_order_status_history_id_seq
from public, anon, authenticated;

grant select on valtrim.change_orders to authenticated;
grant select on valtrim.change_order_lines to authenticated;
grant select on valtrim.change_order_status_history to authenticated;

create policy change_orders_select
on valtrim.change_orders for select to authenticated
using ((select private.is_active_user()));
create policy change_order_lines_select
on valtrim.change_order_lines for select to authenticated
using ((select private.is_active_user()));
create policy change_order_status_history_select
on valtrim.change_order_status_history for select to authenticated
using ((select private.is_active_user()));

create view valtrim.change_order_overview
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
  coalesce(totals.total_amount, 0) as total_amount
from valtrim.change_orders change_order
join valtrim.builders builder on builder.id = change_order.builder_id
join valtrim.jobs job on job.id = change_order.job_id
left join lateral (
  select count(*) as line_count, sum(line.amount) as total_amount
  from valtrim.change_order_lines line
  where line.change_order_id = change_order.id
) totals on true;

revoke all on valtrim.change_order_overview from public, anon, authenticated;
grant select on valtrim.change_order_overview to authenticated;

-- Writing the lines ----------------------------------------------------------------------------------

-- Replaces every line of the CO with `p_lines`, an array of
-- { lot_id, scope_of_work, amount, po_number? } in the order they should be shown.
create function private.replace_change_order_lines(
  p_change_order_id bigint,
  p_job_id bigint,
  p_lines jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_unique integer;
  v_found integer;
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
       or jsonb_typeof(item->'lot_id') is distinct from 'number'
       or item->>'lot_id' !~ '^[1-9][0-9]*$'
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
      'Every line needs a Lot, a Scope of Work up to 1000 characters and an Amount other than zero with at most 2 decimals'
      using errcode = '23514';
  end if;

  select count(distinct (item->>'lot_id')::bigint)
  into v_unique
  from jsonb_array_elements(p_lines) item;
  if v_unique <> v_count then
    raise exception 'A Lot can be in a Change Order only once' using errcode = '23505';
  end if;

  select count(*)
  into v_found
  from jsonb_array_elements(p_lines) item
  join valtrim.lots lot on lot.id = (item->>'lot_id')::bigint
  join valtrim.phases phase on phase.id = lot.phase_id
  where lot.job_id = p_job_id
    and phase.job_id = p_job_id
    and phase.is_active;
  if v_found <> v_count then
    raise exception 'Every Lot must belong to an active Phase of the Job'
      using errcode = '23503';
  end if;

  delete from valtrim.change_order_lines
  where change_order_id = p_change_order_id;

  insert into valtrim.change_order_lines (
    change_order_id, lot_id, job_id, phase_id, line_number,
    phase_code, building, lot_number, plan_code, plan_name,
    scope_of_work, amount, po_number
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
    btrim(requested.item->>'scope_of_work'),
    (requested.item->>'amount')::numeric(14,2),
    nullif(btrim(coalesce(requested.item->>'po_number', '')), '')
  from jsonb_array_elements(p_lines) with ordinality as requested(item, ord)
  join valtrim.lots lot on lot.id = (requested.item->>'lot_id')::bigint
  join valtrim.phases phase on phase.id = lot.phase_id
  join valtrim.plans plan on plan.id = lot.plan_id;
end;
$$;

-- The header checks both writers share. Returns the Builder of the Job.
create function private.check_change_order_header(
  p_job_id bigint,
  p_title text,
  p_internal_number text,
  p_requested_by text,
  p_request_date date,
  p_needed_by_date date,
  p_coverage jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_builder_id bigint;
begin
  if btrim(coalesce(p_title, '')) = '' or char_length(btrim(p_title)) > 150 then
    raise exception 'Write a title of up to 150 characters' using errcode = '23514';
  end if;
  if btrim(coalesce(p_requested_by, '')) = '' or char_length(btrim(p_requested_by)) > 100 then
    raise exception 'Write who requested it, up to 100 characters' using errcode = '23514';
  end if;
  if p_internal_number is not null and char_length(btrim(p_internal_number)) > 60 then
    raise exception 'The internal number must contain 60 characters or fewer'
      using errcode = '23514';
  end if;
  if p_request_date is not null and p_needed_by_date is not null
     and p_needed_by_date < p_request_date then
    raise exception 'The needed-by date cannot be before the request date'
      using errcode = '23514';
  end if;
  if p_coverage is not null and (
    jsonb_typeof(p_coverage) <> 'object'
    or char_length(p_coverage::text) > 400000
    or coalesce(p_coverage->>'mode', 'lots') not in ('lots', 'phase', 'job', 'plans')
  ) then
    raise exception 'The coverage is not valid' using errcode = '23514';
  end if;

  select job.builder_id
  into v_builder_id
  from valtrim.jobs job
  where job.id = p_job_id
    and job.is_active
  for share of job;
  if v_builder_id is null then
    raise exception 'Select an active Job' using errcode = '23503';
  end if;

  return v_builder_id;
end;
$$;

-- Creating a CO ---------------------------------------------------------------------------------------

create function private.create_change_order(
  p_job_id bigint,
  p_title text,
  p_requested_by text,
  p_lines jsonb,
  p_internal_number text default null,
  p_request_date date default null,
  p_needed_by_date date default null,
  p_coverage jsonb default null,
  p_status valtrim.change_order_status default 'DRAFT'
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_builder_id bigint;
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

  -- It is born a Draft, because the lines of an approved CO cannot be written; it moves on once they are.
  insert into valtrim.change_orders (
    internal_number, title, builder_id, job_id, requested_by, request_date, needed_by_date,
    status, coverage, created_by, updated_by
  ) values (
    nullif(btrim(coalesce(p_internal_number, '')), ''),
    btrim(p_title),
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

-- Editing a CO ----------------------------------------------------------------------------------------

create function private.update_change_order(
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

  perform private.replace_change_order_lines(p_change_order_id, p_job_id, p_lines);
end;
$$;

-- Moving a CO between statuses -----------------------------------------------------------------------

create function private.set_change_order_status(
  p_change_order_id bigint,
  p_status valtrim.change_order_status,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_current valtrim.change_order_status;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to change the status of a Change Order'
      using errcode = '42501';
  end if;
  if p_status is null then
    raise exception 'Select a status' using errcode = '23514';
  end if;

  select change_order.status
  into v_current
  from valtrim.change_orders change_order
  where change_order.id = p_change_order_id
  for update;
  if not found then
    raise exception 'The Change Order no longer exists' using errcode = 'P0002';
  end if;
  if p_status = v_current then
    raise exception 'The Change Order is already %', v_current using errcode = '23514';
  end if;
  if not private.change_order_transition_allowed(v_current, p_status) then
    raise exception 'A % Change Order cannot become %', v_current, p_status
      using errcode = '23514';
  end if;
  if (p_status = 'APPROVED' or v_current = 'APPROVED')
     and not (select private.has_app_role('ADMIN')) then
    raise exception 'Only an Admin approves a Change Order or cancels an approved one'
      using errcode = '42501';
  end if;
  if p_status = 'CANCELLED' and v_note is null then
    raise exception 'Write the reason for cancelling' using errcode = '23514';
  end if;
  if char_length(v_note) > 500 then
    raise exception 'The reason must contain 500 characters or fewer' using errcode = '23514';
  end if;

  update valtrim.change_orders
  set status = p_status,
      approved_at = case when p_status = 'APPROVED' then now() else approved_at end,
      approved_by = case when p_status = 'APPROVED' then v_actor_id else approved_by end,
      cancelled_at = case when p_status = 'CANCELLED' then now() else cancelled_at end,
      cancelled_by = case when p_status = 'CANCELLED' then v_actor_id else cancelled_by end,
      cancel_reason = case when p_status = 'CANCELLED' then v_note else cancel_reason end,
      updated_by = v_actor_id
  where id = p_change_order_id;
end;
$$;

-- What the browser calls ------------------------------------------------------------------------------

create function valtrim.create_change_order(
  p_job_id bigint,
  p_title text,
  p_requested_by text,
  p_lines jsonb,
  p_internal_number text default null,
  p_request_date date default null,
  p_needed_by_date date default null,
  p_coverage jsonb default null,
  p_status valtrim.change_order_status default 'DRAFT'
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.create_change_order(
    p_job_id, p_title, p_requested_by, p_lines, p_internal_number,
    p_request_date, p_needed_by_date, p_coverage, p_status
  );
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
  p_coverage jsonb default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.update_change_order(
    p_change_order_id, p_job_id, p_title, p_requested_by, p_lines, p_internal_number,
    p_request_date, p_needed_by_date, p_coverage
  );
$$;

create function valtrim.set_change_order_status(
  p_change_order_id bigint,
  p_status valtrim.change_order_status,
  p_note text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.set_change_order_status(p_change_order_id, p_status, p_note);
$$;

-- Nothing here is callable by the public: the helpers by nobody, the writers by signed-in users only.
revoke execute on function
  private.next_change_order_number(),
  private.change_order_transition_allowed(valtrim.change_order_status, valtrim.change_order_status),
  private.guard_change_order_update(),
  private.record_change_order_status(),
  private.guard_change_order_line_change(),
  private.replace_change_order_lines(bigint, bigint, jsonb),
  private.check_change_order_header(bigint, text, text, text, date, date, jsonb),
  private.create_change_order(bigint, text, text, jsonb, text, date, date, jsonb, valtrim.change_order_status),
  private.update_change_order(bigint, bigint, text, text, jsonb, text, date, date, jsonb),
  private.set_change_order_status(bigint, valtrim.change_order_status, text),
  valtrim.create_change_order(bigint, text, text, jsonb, text, date, date, jsonb, valtrim.change_order_status),
  valtrim.update_change_order(bigint, bigint, text, text, jsonb, text, date, date, jsonb),
  valtrim.set_change_order_status(bigint, valtrim.change_order_status, text)
from public, anon, authenticated;

grant execute on function
  private.create_change_order(bigint, text, text, jsonb, text, date, date, jsonb, valtrim.change_order_status),
  private.update_change_order(bigint, bigint, text, text, jsonb, text, date, date, jsonb),
  private.set_change_order_status(bigint, valtrim.change_order_status, text),
  valtrim.create_change_order(bigint, text, text, jsonb, text, date, date, jsonb, valtrim.change_order_status),
  valtrim.update_change_order(bigint, bigint, text, text, jsonb, text, date, date, jsonb),
  valtrim.set_change_order_status(bigint, valtrim.change_order_status, text)
to authenticated, service_role;

comment on table valtrim.change_orders is
  'Extra / Change Orders: extra work on some Lots of one Job, priced Lot by Lot. Never deleted: cancelled with a reason.';
comment on table valtrim.change_order_lines is
  'One line per Lot of a Change Order, with its own Scope of Work, Amount (negative for a credit) and optional PO number. Labels are copied when saved.';
comment on table valtrim.change_order_status_history is
  'Every status a Change Order went through, with who moved it and when. Written by a trigger.';
comment on column valtrim.change_orders.coverage is
  'How the Lots were chosen on the screen, so a draft opens as it was left. The lines are what the CO covers.';
comment on function valtrim.create_change_order(bigint, text, text, jsonb, text, date, date, jsonb, valtrim.change_order_status) is
  'Creates a Change Order with all its lines as the signed-in user. ADMIN and PROJECT_MANAGEMENT; only ADMIN can create it already approved.';
comment on function valtrim.update_change_order(bigint, bigint, text, text, jsonb, text, date, date, jsonb) is
  'Replaces the header and every line of a Draft or Pending Change Order. ADMIN and PROJECT_MANAGEMENT.';
comment on function valtrim.set_change_order_status(bigint, valtrim.change_order_status, text) is
  'Moves a Change Order to another status. ADMIN and PROJECT_MANAGEMENT, except approving it or cancelling an approved one, which is ADMIN only. Cancelling needs a reason.';

notify pgrst, 'reload schema';
commit;
