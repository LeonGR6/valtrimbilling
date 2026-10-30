-- Phase 7 follow-up: selected_by is an action-specific audit column, so the
-- shared actor trigger validates it but does not populate it. Stamp the
-- authenticated selector on every Lot Option insert.

begin;

create or replace function private.stamp_lot_option_selector()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
begin
  if v_actor_id is not null then
    new.selected_by := v_actor_id;
  end if;

  return new;
end;
$$;

revoke all on function private.stamp_lot_option_selector()
  from public, anon, authenticated;

drop trigger if exists stamp_lot_option_selector on valtrim.lot_options;
create trigger stamp_lot_option_selector
before insert on valtrim.lot_options
for each row execute function private.stamp_lot_option_selector();

comment on function private.stamp_lot_option_selector() is
  'Records the authenticated user who selected a Plan Option for a Lot.';

commit;
