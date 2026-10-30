-- Phase 3: persist Builder Contacts of both supported types while keeping
-- Communities and Jobs closed.

grant select on valtrim.builder_contacts to authenticated;
grant insert (
  builder_id,
  name,
  type,
  email,
  phone,
  office_phone,
  notes
) on valtrim.builder_contacts to authenticated;
grant update (
  builder_id,
  name,
  type,
  email,
  phone,
  office_phone,
  notes,
  is_active
) on valtrim.builder_contacts to authenticated;

grant usage on sequence valtrim.builder_contacts_id_seq to authenticated;

create policy builder_contacts_select
on valtrim.builder_contacts for select to authenticated
using ((select private.is_active_user()));

create policy builder_contacts_insert
on valtrim.builder_contacts for insert to authenticated
with check ((select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')));

create policy builder_contacts_update
on valtrim.builder_contacts for update to authenticated
using ((select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')))
with check ((select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')));

create index builder_contacts_created_by_idx
  on valtrim.builder_contacts (created_by)
  where created_by is not null;

create index builder_contacts_updated_by_idx
  on valtrim.builder_contacts (updated_by)
  where updated_by is not null;

notify pgrst, 'reload schema';
