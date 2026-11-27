begin;

-- Supervisors still require email in their frontend form. Technicians may be
-- registered by name only, so do not manufacture an email address for them.
alter table valtrim.people alter column email drop not null;

-- Keep the existing supervisor contract enforced in the database, including
-- direct updates by authorized users and calls to create_supervisor.
create or replace function valtrim.validate_person_role()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
declare
  v_territory text;
  v_email valtrim.email_address;
begin
  if new.role = 'SUPERVISOR' then
    select territory, email into v_territory, v_email
    from people where id = new.person_id and is_active;
    if v_territory is null or btrim(v_territory) = '' or v_email is null then
      raise exception 'An active supervisor requires territory and email';
    end if;
  end if;
  return new;
end;
$$;

create or replace function valtrim.validate_person_update()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
begin
  if exists (
    select 1 from person_roles
    where person_id = new.id and role = 'SUPERVISOR'
  ) then
    if new.email is null then
      raise exception 'A supervisor requires email';
    end if;
    if new.is_active and (new.territory is null or btrim(new.territory) = '') then
      raise exception 'An active supervisor requires territory';
    end if;
  end if;
  return new;
end;
$$;

-- Technicians are Valtrim people, not Auth accounts. Creation must add the
-- person and SERVICE_TECHNICIAN role in one transaction.
create function private.create_service_technician_internal(
  p_name text,
  p_email text,
  p_phone text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  technician_id bigint;
begin
  if not (select private.has_app_role('ADMIN', 'SCHEDULING')) then
    raise exception 'You do not have permission to create service technicians'
      using errcode = '42501';
  end if;

  insert into valtrim.people (name, email, phone, is_active)
  values (
    btrim(p_name),
    nullif(lower(btrim(p_email)), ''),
    nullif(btrim(p_phone), ''),
    true
  )
  returning id into technician_id;

  insert into valtrim.person_roles (person_id, role)
  values (technician_id, 'SERVICE_TECHNICIAN');

  return technician_id;
end;
$$;

revoke all on function private.create_service_technician_internal(text, text, text)
  from public, anon, authenticated;
grant execute on function private.create_service_technician_internal(text, text, text)
  to authenticated;

create function valtrim.create_service_technician(
  p_name text,
  p_email text,
  p_phone text
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.create_service_technician_internal(p_name, p_email, p_phone);
$$;

revoke all on function valtrim.create_service_technician(text, text, text)
  from public, anon, authenticated;
grant execute on function valtrim.create_service_technician(text, text, text)
  to authenticated;

-- Existing column grants on people allow updates; this policy limits them
-- to authorized staff and rows assigned the service technician role.
create policy service_technician_people_update
on valtrim.people for update to authenticated
using (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and exists (
    select 1 from valtrim.person_roles person_role
    where person_role.person_id = people.id
      and person_role.role = 'SERVICE_TECHNICIAN'
  )
)
with check (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and exists (
    select 1 from valtrim.person_roles person_role
    where person_role.person_id = people.id
      and person_role.role = 'SERVICE_TECHNICIAN'
  )
);

notify pgrst, 'reload schema';

commit;
