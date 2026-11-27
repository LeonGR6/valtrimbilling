-- Change Orders: the Internal CO / Extra # fills itself in.
--
-- The screen shows the number the next Change Order will have (CO-0001, CO-0002 ...) in the Internal #
-- box, ready to be kept or replaced by the number the team uses on its own.
--
--   next_change_order_number()   what the next Change Order will be called, without using it up.
--                                Only for who can create one. It is a preview: someone else may take
--                                the number first, which is why the screen sends nothing while the
--                                box is untouched.
--   create_change_order(...)     when no internal number is given, the internal number is the number
--                                the Change Order gets (the same one, taken once), so what the person
--                                saw is what is stored even if the preview was stale.
--
-- Editing keeps its rule: what is written in the box is what is stored (blank stays blank).

begin;

-- One place for how a number is written, shared by the real number and the preview.
create function private.format_change_order_number(p_number bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'CO-' || case when p_number < 10000 then lpad(p_number::text, 4, '0') else p_number::text end;
$$;

create or replace function private.next_change_order_number()
returns text
language sql
volatile
set search_path = ''
as $$
  select private.format_change_order_number(nextval('valtrim.change_order_number_seq'));
$$;

-- The preview ------------------------------------------------------------------------------------------

create function private.peek_change_order_number()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last bigint;
  v_called boolean;
begin
  if (select auth.uid()) is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to create a Change Order'
      using errcode = '42501';
  end if;

  select sequence.last_value, sequence.is_called
  into v_last, v_called
  from valtrim.change_order_number_seq sequence;

  -- A sequence nobody has used yet (is_called false) hands out its last_value first.
  return private.format_change_order_number(case when v_called then v_last + 1 else v_last end);
end;
$$;

create function valtrim.next_change_order_number()
returns text
language sql
security invoker
set search_path = ''
as $$
  select private.peek_change_order_number();
$$;

-- Creating a CO: a blank internal number is the Change Order number -------------------------------------

create or replace function private.create_change_order(
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
  v_number text;
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

  -- The number is taken only now, once the header has been checked, so a header that is refused does not use one up.
  v_number := private.next_change_order_number();

  -- It is born a Draft, because the lines of an approved CO cannot be written; it moves on once they are.
  insert into valtrim.change_orders (
    change_order_number, internal_number, title, builder_id, job_id, requested_by, request_date,
    needed_by_date, status, coverage, created_by, updated_by
  ) values (
    v_number,
    coalesce(nullif(btrim(coalesce(p_internal_number, '')), ''), v_number),
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

-- Who can call what -----------------------------------------------------------------------------------

revoke execute on function
  private.format_change_order_number(bigint),
  private.peek_change_order_number(),
  valtrim.next_change_order_number()
from public, anon, authenticated;

grant execute on function
  private.peek_change_order_number(),
  valtrim.next_change_order_number()
to authenticated, service_role;

comment on column valtrim.change_orders.internal_number is
  'The number the team gives the extra on its own; free text. A new Change Order without one gets its Change Order number.';

commit;
