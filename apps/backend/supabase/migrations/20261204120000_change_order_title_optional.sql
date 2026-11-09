-- Change Orders: the title is no longer asked.
--
-- The screen does not have a Title box any more (the PO / CO # takes its place), so a Change Order can be
-- saved without one:
--   change_orders.title          may be empty (null). The ones made before keep the title they have.
--   check_change_order_header    no longer asks for a title; it only refuses one longer than 150 characters.
--   create_change_order /        a missing or blank title is stored as nothing. The signatures do not change:
--   update_change_order          `p_title` is still the second argument, and the screen sends null.

begin;

alter table valtrim.change_orders
  alter column title drop not null;

alter table valtrim.change_orders
  drop constraint change_orders_title_check;
alter table valtrim.change_orders
  add constraint change_orders_title_check check (title is null or btrim(title) <> '');

comment on column valtrim.change_orders.title is
  'Not asked any more: the Change Orders made before keep their title, the new ones have none. Optional free text.';

-- The header checks both writers share: the same as before, without the demand for a title.
create or replace function private.check_change_order_header(
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
  if p_title is not null and char_length(btrim(p_title)) > 150 then
    raise exception 'The title must contain 150 characters or fewer' using errcode = '23514';
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

-- Creating a CO: a blank title is no title -------------------------------------------------------------------

create or replace function private.create_change_order(
  p_job_id bigint,
  p_title text,
  p_requested_by text,
  p_lines jsonb,
  p_internal_number text default null,
  p_request_date date default null,
  p_needed_by_date date default null,
  p_coverage jsonb default null,
  p_status valtrim.change_order_status default 'DRAFT',
  p_po_co_number text default null
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

-- Editing a CO: the same ---------------------------------------------------------------------------------------

create or replace function private.update_change_order(
  p_change_order_id bigint,
  p_job_id bigint,
  p_title text,
  p_requested_by text,
  p_lines jsonb,
  p_internal_number text default null,
  p_request_date date default null,
  p_needed_by_date date default null,
  p_coverage jsonb default null,
  p_po_co_number text default null
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

  -- The lines go first: they point at the Job of the header.
  delete from valtrim.change_order_lines
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
end;
$$;

notify pgrst, 'reload schema';
commit;
