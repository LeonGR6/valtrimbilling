-- Change Orders: the PO / CO # can be written or changed after the CO was approved.
--
-- The builder's PO often arrives after the extra was approved, and the form only opens a Draft or a Pending
-- CO (an approved one is frozen so what was approved stays as it was). The PO / CO # is only a reference
-- the office writes down, so it gets a function of its own instead of opening the whole CO:
--
--   set_change_order_po_co_number(p_change_order_id, p_po_co_number)
--
--   Who     ADMIN and PROJECT_MANAGEMENT, as with every other writer.
--   When    Draft, Pending and Approved. A Cancelled CO is closed for good and keeps what it had.
--   What    Only the PO / CO #; the same cleaning as when saving the form (spaces cleaned, up to 60
--           characters). An empty value clears it.
--
-- Nothing else of the CO is touched, so the guard that freezes an approved CO stays as it is: it never
-- looked at the PO / CO #. The row's updated_at / updated_by say who changed it last.

begin;

create function private.set_change_order_po_co_number(
  p_change_order_id bigint,
  p_po_co_number text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_status valtrim.change_order_status;
  v_po_co_number text;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to change the PO / CO # of a Change Order'
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
  if v_status = 'CANCELLED' then
    raise exception 'The PO / CO # of a cancelled Change Order cannot be changed'
      using errcode = '23514';
  end if;

  v_po_co_number := private.clean_po_co_number(p_po_co_number);

  update valtrim.change_orders
  set po_co_number = v_po_co_number,
      updated_by = v_actor_id
  where id = p_change_order_id;
end;
$$;

create function valtrim.set_change_order_po_co_number(
  p_change_order_id bigint,
  p_po_co_number text
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.set_change_order_po_co_number(p_change_order_id, p_po_co_number);
$$;

revoke execute on function
  private.set_change_order_po_co_number(bigint, text),
  valtrim.set_change_order_po_co_number(bigint, text)
from public, anon, authenticated;

grant execute on function
  private.set_change_order_po_co_number(bigint, text),
  valtrim.set_change_order_po_co_number(bigint, text)
to authenticated, service_role;

comment on function valtrim.set_change_order_po_co_number(bigint, text) is
  'Writes, changes or clears the PO / CO # of a Draft, Pending or Approved Change Order, which the form no longer opens once it is approved. ADMIN and PROJECT_MANAGEMENT.';

notify pgrst, 'reload schema';
commit;
