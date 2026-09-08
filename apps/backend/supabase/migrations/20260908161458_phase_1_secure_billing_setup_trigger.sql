create or replace function valtrim.initialize_builder_billing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into valtrim.billing_setups (builder_id, created_by)
  values (new.id, new.created_by);
  return new;
end;
$$;

revoke insert on valtrim.billing_setups from authenticated;
revoke usage on sequence valtrim.billing_setups_id_seq from authenticated;
drop policy billing_setups_insert on valtrim.billing_setups;
