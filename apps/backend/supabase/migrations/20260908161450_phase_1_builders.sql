-- Phase 1: persist the builders catalog while keeping the rest of the
-- business schema closed.

grant select on valtrim.builders to authenticated;
grant insert (
  code,
  name,
  description,
  address,
  contact_name,
  contact_email,
  contact_phone,
  is_active,
  ext_to_dm_weeks,
  shutter_before_dm_weeks,
  dm_to_hw_weeks
) on valtrim.builders to authenticated;
grant update (
  code,
  name,
  description,
  address,
  contact_name,
  contact_email,
  contact_phone,
  is_active,
  ext_to_dm_weeks,
  shutter_before_dm_weeks,
  dm_to_hw_weeks
) on valtrim.builders to authenticated;

grant usage on sequence valtrim.builders_id_seq to authenticated;

-- The existing builders_initialize_billing trigger creates exactly one setup
-- for each new builder. The setup configuration tables remain closed until a
-- later phase.
grant select, insert on valtrim.billing_setups to authenticated;
grant usage on sequence valtrim.billing_setups_id_seq to authenticated;

create policy builders_select
on valtrim.builders for select to authenticated
using ((select private.is_active_user()));

create policy builders_insert
on valtrim.builders for insert to authenticated
with check ((select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')));

create policy builders_update
on valtrim.builders for update to authenticated
using ((select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')))
with check ((select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')));

create policy billing_setups_select
on valtrim.billing_setups for select to authenticated
using ((select private.is_active_user()));

create policy billing_setups_insert
on valtrim.billing_setups for insert to authenticated
with check ((select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')));
