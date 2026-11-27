-- A cancelled Extra / Change Order can be deleted, like a Draft.
--
-- Cancelling keeps an Extra / CO as history; whether to keep that history is the person's choice. Admin and
-- Project Management can now delete a cancelled one too, for good: its lines, its Scope and Amount by Plan,
-- its charges (the Lots a Package charged on it go back to being charged by the next Package that bills
-- them), the emails sent to Scheduling about it, its status history and the header.
--
-- It is still refused when something else depends on it:
--   * Extras / COs made from Packages for it (delete those first);
--   * a Package that invoices it, even voided (the invoice is accounting history).
-- An approved or pending one is cancelled first.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- The guards of the lines and of the Scope and Amount by Plan let the delete of this one Change Order through.
create or replace function private.change_order_being_deleted(p_change_order_id bigint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('valtrim.change_order_deleting', true), '') = p_change_order_id::text;
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
  -- The delete of a whole Change Order takes its lines with it.
  if tg_op = 'DELETE' and private.change_order_being_deleted(old.change_order_id) then
    return old;
  end if;

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

create or replace function private.guard_change_order_plan_rule_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status valtrim.change_order_status;
begin
  if tg_op = 'DELETE' and private.change_order_being_deleted(old.change_order_id) then
    return old;
  end if;

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

create or replace function private.delete_change_order(p_change_order_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_status valtrim.change_order_status;
  v_made_from_it text;
  v_package text;
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
  if v_status not in ('DRAFT', 'CANCELLED') then
    raise exception 'Only a Draft or a cancelled Change Order can be deleted. Cancel it first'
      using errcode = '23514';
  end if;

  select string_agg(child.change_order_number, ', ' order by child.change_order_number)
  into v_made_from_it
  from valtrim.change_orders child
  where child.source_change_order_id = p_change_order_id;
  if v_made_from_it is not null then
    raise exception 'Packages made Extras / COs from this one (%). Delete those first', v_made_from_it
      using errcode = '23514';
  end if;

  select string_agg(package.package_number, ', ' order by package.package_number)
  into v_package
  from valtrim.draw_packages package
  where package.change_order_id = p_change_order_id;
  if v_package is not null then
    raise exception 'It was invoiced on Package %, which keeps it as accounting history: it cannot be deleted', v_package
      using errcode = '23514';
  end if;

  perform set_config('valtrim.change_order_deleting', p_change_order_id::text, true);

  -- What hangs on it first, then the header.
  delete from valtrim.change_order_plan_charges
  where change_order_id = p_change_order_id or source_change_order_id = p_change_order_id;
  delete from valtrim.change_order_event_emails
  where change_order_id = p_change_order_id;
  delete from valtrim.change_order_lines
  where change_order_id = p_change_order_id;
  delete from valtrim.change_order_plan_rules
  where change_order_id = p_change_order_id;
  delete from valtrim.change_order_status_history
  where change_order_id = p_change_order_id;
  delete from valtrim.change_orders
  where id = p_change_order_id;

  perform set_config('valtrim.change_order_deleting', '', true);
end;
$$;

revoke execute on function private.change_order_being_deleted(bigint) from public, anon, authenticated;

comment on function valtrim.delete_change_order(bigint) is
  'Deletes a Draft or a cancelled Change Order for good, with its lines, rules, charges, emails and history. ADMIN and PROJECT_MANAGEMENT. Refused while Extras / COs made from it or a Package that invoices it exist.';

notify pgrst, 'reload schema';

commit;
