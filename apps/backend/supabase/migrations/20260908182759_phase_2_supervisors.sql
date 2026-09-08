-- Phase 2: persist only Valtrim People with the SUPERVISOR role. Communities,
-- jobsites, Jobs and the remaining person roles stay closed.

grant select on valtrim.people to authenticated;
grant update (
  name,
  email,
  phone,
  office_phone,
  territory,
  is_active
) on valtrim.people to authenticated;

grant select on valtrim.person_roles to authenticated;

create policy supervisor_people_select
on valtrim.people for select to authenticated
using (
  (select private.is_active_user())
  and exists (
    select 1
    from valtrim.person_roles person_role
    where person_role.person_id = people.id
      and person_role.role = 'SUPERVISOR'
  )
);

create policy supervisor_people_update
on valtrim.people for update to authenticated
using (
  (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT'))
  and exists (
    select 1
    from valtrim.person_roles person_role
    where person_role.person_id = people.id
      and person_role.role = 'SUPERVISOR'
  )
)
with check (
  (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT'))
  and exists (
    select 1
    from valtrim.person_roles person_role
    where person_role.person_id = people.id
      and person_role.role = 'SUPERVISOR'
  )
);

create policy supervisor_roles_select
on valtrim.person_roles for select to authenticated
using (
  role = 'SUPERVISOR'
  and (select private.is_active_user())
);

-- Supervisor creation spans people and person_roles, so it is kept atomic.
-- The privileged implementation stays in the unexposed private schema and
-- verifies the application role itself. The exposed function below is an
-- invoker-only wrapper.
create function private.create_supervisor_internal(
  p_name text,
  p_email text,
  p_phone text,
  p_office_phone text,
  p_territory text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  supervisor_id bigint;
begin
  if not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to create supervisors'
      using errcode = '42501';
  end if;

  insert into valtrim.people (
    name,
    email,
    phone,
    office_phone,
    territory,
    is_active
  )
  values (
    btrim(p_name),
    lower(btrim(p_email)),
    nullif(btrim(p_phone), ''),
    nullif(btrim(p_office_phone), ''),
    nullif(btrim(p_territory), ''),
    true
  )
  returning id into supervisor_id;

  insert into valtrim.person_roles (person_id, role)
  values (supervisor_id, 'SUPERVISOR');

  return supervisor_id;
end;
$$;

revoke all on function private.create_supervisor_internal(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function private.create_supervisor_internal(text, text, text, text, text)
  to authenticated;

create function valtrim.create_supervisor(
  p_name text,
  p_email text,
  p_phone text,
  p_office_phone text,
  p_territory text
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.create_supervisor_internal(
    p_name,
    p_email,
    p_phone,
    p_office_phone,
    p_territory
  );
$$;

revoke all on function valtrim.create_supervisor(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function valtrim.create_supervisor(text, text, text, text, text)
  to authenticated;

-- A supervisor must have territory while active. Inactivation is a soft
-- delete and therefore keeps the role and historical references intact.
create or replace function valtrim.validate_person_update()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
begin
  if exists (
    select 1 from person_roles
    where person_id = new.id and role = 'SUPERVISOR'
  ) and new.is_active and (new.territory is null or btrim(new.territory) = '') then
    raise exception 'Una persona activa con rol SUPERVISOR debe tener territorio';
  end if;
  return new;
end;
$$;

create index people_created_by_idx
  on valtrim.people (created_by)
  where created_by is not null;

create index people_updated_by_idx
  on valtrim.people (updated_by)
  where updated_by is not null;

notify pgrst, 'reload schema';
