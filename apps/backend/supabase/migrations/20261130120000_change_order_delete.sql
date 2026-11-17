-- Deleting a Draft Extra / Change Order.
--
-- Until now a CO was never deleted: it was cancelled with a reason and stayed in the list. That is still
-- how everything that was sent goes. A Draft, though, is work in progress that can be a mistake (a test,
-- a duplicate), so it can be deleted for real, with its lines and its history.
--
--   Who     ADMIN and PROJECT_MANAGEMENT, as with every other writer.
--   What    Only a DRAFT. A Pending, Approved or Cancelled CO is cancelled instead, so the record of what
--           was asked and approved stays.
--   Number  Its CO number is not used again: the next CO keeps counting.
--
-- Nothing hangs from a CO yet (no invoice, no Purchase Order line). When a CO can be invoiced, this
-- function must refuse a CO that already has an invoice.

begin;

create function private.delete_change_order(p_change_order_id bigint)
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

  -- The lines first (the guard lets a Draft's lines go), then the history, then the header.
  delete from valtrim.change_order_lines
  where change_order_id = p_change_order_id;
  delete from valtrim.change_order_status_history
  where change_order_id = p_change_order_id;
  delete from valtrim.change_orders
  where id = p_change_order_id;
end;
$$;

create function valtrim.delete_change_order(p_change_order_id bigint)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.delete_change_order(p_change_order_id);
$$;

revoke execute on function
  private.delete_change_order(bigint),
  valtrim.delete_change_order(bigint)
from public, anon, authenticated;

grant execute on function
  private.delete_change_order(bigint),
  valtrim.delete_change_order(bigint)
to authenticated, service_role;

comment on table valtrim.change_orders is
  'Extra / Change Orders: extra work on some Lots of one Job, priced Lot by Lot. Only a Draft is deleted; the rest are cancelled with a reason.';
comment on function valtrim.delete_change_order(bigint) is
  'Deletes a Draft Change Order with its lines and history. ADMIN and PROJECT_MANAGEMENT. Anything that was sent is cancelled instead.';

notify pgrst, 'reload schema';
commit;
