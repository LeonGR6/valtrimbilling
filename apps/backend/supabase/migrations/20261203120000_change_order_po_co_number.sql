-- Change Orders: the PO / CO # the person registers.
--
-- A Change Order has two numbers of its own now:
--   change_order_number / internal_number   the internal CO / Extra #: CO-0001, CO-0002 ... (unchanged)
--   po_co_number                            the PO or CO number the Builder gave for the extra, written
--                                           by the person (free text, optional: it may not have arrived).
--
--   create_change_order / update_change_order   take `p_po_co_number` (last argument, optional).
--   change_order_overview                       gives it as a last column, for the list and its search.
--
-- The number is stored as it was written, only cleaned: every kind of space (the non-breaking one that a
-- paste from a portal brings, a tab, a line break) becomes one plain space and the ends are trimmed.
-- Nothing else is changed (leading zeros, "CO#", dashes and slashes are part of the number).

begin;

alter table valtrim.change_orders
  add column po_co_number varchar(60)
    check (po_co_number is null or btrim(po_co_number) <> '');

comment on column valtrim.change_orders.po_co_number is
  'The PO or CO number the Builder gave for the extra, as the person wrote it (spaces cleaned). Optional free text.';

-- One place where the number is cleaned and checked, for both writers.
create function private.clean_po_co_number(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_clean text;
begin
  v_clean := nullif(
    btrim(regexp_replace(coalesce(p_value, ''), '[[:space:]   ]+', ' ', 'g')),
    ''
  );
  if v_clean is not null and char_length(v_clean) > 60 then
    raise exception 'The PO / CO # must contain 60 characters or fewer'
      using errcode = '23514';
  end if;
  return v_clean;
end;
$$;

-- The list ---------------------------------------------------------------------------------------------

-- A new column goes last: the columns that were there keep their place.
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
  change_order.po_co_number
from valtrim.change_orders change_order
join valtrim.builders builder on builder.id = change_order.builder_id
join valtrim.jobs job on job.id = change_order.job_id
left join lateral (
  select count(*) as line_count, sum(line.amount) as total_amount
  from valtrim.change_order_lines line
  where line.change_order_id = change_order.id
) totals on true;

-- The writers ------------------------------------------------------------------------------------------

-- The signature changes (one more argument), so the old functions go and the new ones take their place.
drop function valtrim.create_change_order(bigint, text, text, jsonb, text, date, date, jsonb, valtrim.change_order_status);
drop function valtrim.update_change_order(bigint, bigint, text, text, jsonb, text, date, date, jsonb);
drop function private.create_change_order(bigint, text, text, jsonb, text, date, date, jsonb, valtrim.change_order_status);
drop function private.update_change_order(bigint, bigint, text, text, jsonb, text, date, date, jsonb);

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
  p_po_co_number text default null
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.create_change_order(
    p_job_id, p_title, p_requested_by, p_lines, p_internal_number,
    p_request_date, p_needed_by_date, p_coverage, p_status, p_po_co_number
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
  p_coverage jsonb default null,
  p_po_co_number text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.update_change_order(
    p_change_order_id, p_job_id, p_title, p_requested_by, p_lines, p_internal_number,
    p_request_date, p_needed_by_date, p_coverage, p_po_co_number
  );
$$;

-- Who can call what: the same as before -----------------------------------------------------------------

revoke execute on function
  private.clean_po_co_number(text),
  private.create_change_order(bigint, text, text, jsonb, text, date, date, jsonb, valtrim.change_order_status, text),
  private.update_change_order(bigint, bigint, text, text, jsonb, text, date, date, jsonb, text),
  valtrim.create_change_order(bigint, text, text, jsonb, text, date, date, jsonb, valtrim.change_order_status, text),
  valtrim.update_change_order(bigint, bigint, text, text, jsonb, text, date, date, jsonb, text)
from public, anon, authenticated;

grant execute on function
  private.create_change_order(bigint, text, text, jsonb, text, date, date, jsonb, valtrim.change_order_status, text),
  private.update_change_order(bigint, bigint, text, text, jsonb, text, date, date, jsonb, text),
  valtrim.create_change_order(bigint, text, text, jsonb, text, date, date, jsonb, valtrim.change_order_status, text),
  valtrim.update_change_order(bigint, bigint, text, text, jsonb, text, date, date, jsonb, text)
to authenticated, service_role;

comment on function valtrim.create_change_order(bigint, text, text, jsonb, text, date, date, jsonb, valtrim.change_order_status, text) is
  'Creates a Change Order with all its lines as the signed-in user. ADMIN and PROJECT_MANAGEMENT; only ADMIN can create it already approved.';
comment on function valtrim.update_change_order(bigint, bigint, text, text, jsonb, text, date, date, jsonb, text) is
  'Replaces the header and every line of a Draft or Pending Change Order. ADMIN and PROJECT_MANAGEMENT.';

notify pgrst, 'reload schema';
commit;
