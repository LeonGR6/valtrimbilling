-- User-authorized (5 Nov 2026):
-- 1. Permanently delete the two test technicians ("tecnico 1" = person 4,
--    "tecnico 2" = person 5). They were inspected on the linked project: only
--    the SERVICE_TECHNICIAN role, no Jobs, production activities or
--    appointments reference them. Roles and profiles cascade with the person.
-- 2. Retire the technician start coordinates. Travel is entered per pair of
--    visits (service_travel_estimates), so a technician start point is unused.
--    The company coordinates in service_scheduling_settings are not touched.
begin;

do $cleanup$
declare
  v_deleted integer;
begin
  if not exists (select 1 from valtrim.people where id in (4, 5)) then
    raise notice 'Test technicians 4 and 5 are already gone; nothing to delete';
    return;
  end if;

  perform 1 from valtrim.people where id in (4, 5) order by id for update;

  if (select count(*) from valtrim.people where id in (4, 5)) <> 2
     or exists (
       select 1 from valtrim.people
       where id in (4, 5)
         and name <> case id when 4 then 'tecnico 1' else 'tecnico 2' end
     ) then
    raise exception 'Test technician identity changed; nothing was deleted';
  end if;

  if exists (
       select 1 from valtrim.person_roles
       where person_id in (4, 5) and role <> 'SERVICE_TECHNICIAN'
     )
     or exists (select 1 from valtrim.jobs where supervisor_id in (4, 5))
     or exists (select 1 from valtrim.production_activities where supervisor_id in (4, 5))
     or exists (
       select 1 from valtrim.service_appointments
       where technician_ids && array[4, 5]::bigint[]
     ) then
    raise exception 'Test technicians have other roles or references; nothing was deleted';
  end if;

  delete from valtrim.people where id in (4, 5);
  get diagnostics v_deleted = row_count;
  if v_deleted <> 2 then
    raise exception 'Test technician delete count mismatch';
  end if;

  -- Identities only, never copies of contact data.
  insert into valtrim.audit_events (
    module, action, actor_type, actor_name,
    entity_type, entity_id, entity_label, summary, metadata
  )
  select
    'CUSTOMER_SERVICE', 'SERVICE_TECHNICIAN_TEST_DATA_DELETED', 'SYSTEM', 'Authorized data cleanup',
    'SERVICE_TECHNICIAN', target.id::text, target.name,
    format('Test technician %s was permanently deleted.', target.name),
    jsonb_build_object(
      'migration', '20261105220000',
      'operation', 'cleanup_test_technicians',
      'backupCreated', false
    )
  from (values (4, 'tecnico 1'), (5, 'tecnico 2')) target(id, name);
end;
$cleanup$;

-- The roster view and the technician RPCs are the only objects that use the
-- coordinates; both are recreated without them.
drop view valtrim.service_technician_roster;

drop function valtrim.create_service_technician(text, text, text, time, time, numeric, numeric);
drop function private.create_service_technician_internal(text, text, text, time, time, numeric, numeric);
drop function valtrim.update_service_technician(bigint, text, text, text, boolean, time, time, numeric, numeric);
drop function private.update_service_technician_internal(bigint, text, text, text, boolean, time, time, numeric, numeric);

alter table valtrim.service_technician_profiles
  drop column start_latitude,
  drop column start_longitude;

create view valtrim.service_technician_roster
with (security_invoker = true)
as
select
  person.id,
  person.name,
  person.email,
  person.phone,
  person.is_active,
  profile.workday_starts_at,
  profile.workday_ends_at,
  (
    person.is_active
    and profile.workday_starts_at is not null
    and profile.workday_ends_at is not null
  ) as is_operational
from valtrim.people person
join valtrim.person_roles person_role
  on person_role.person_id = person.id
 and person_role.role = 'SERVICE_TECHNICIAN'
left join valtrim.service_technician_profiles profile
  on profile.person_id = person.id;

revoke all on valtrim.service_technician_roster
  from public, anon, authenticated;
grant select on valtrim.service_technician_roster to authenticated;

create function private.create_service_technician_internal(
  p_name text,
  p_email text,
  p_phone text,
  p_workday_starts_at time,
  p_workday_ends_at time
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_customer_service_actor();
  v_technician_id bigint;
begin
  if nullif(btrim(p_name), '') is null then
    raise exception 'Technician name is required' using errcode = '22023';
  end if;
  if p_workday_starts_at is null or p_workday_ends_at is null
     or p_workday_ends_at <= p_workday_starts_at then
    raise exception 'Technician workday is invalid' using errcode = '22023';
  end if;

  insert into valtrim.people (
    name, email, phone, is_active, created_by, updated_by
  ) values (
    btrim(p_name),
    nullif(lower(btrim(p_email)), ''),
    nullif(btrim(p_phone), ''),
    true,
    v_actor_id,
    v_actor_id
  ) returning id into v_technician_id;

  insert into valtrim.person_roles (person_id, role)
  values (v_technician_id, 'SERVICE_TECHNICIAN');

  insert into valtrim.service_technician_profiles (
    person_id, workday_starts_at, workday_ends_at, created_by, updated_by
  ) values (
    v_technician_id, p_workday_starts_at, p_workday_ends_at, v_actor_id, v_actor_id
  );

  return v_technician_id;
end;
$$;

revoke all on function private.create_service_technician_internal(
  text, text, text, time, time
) from public, anon, authenticated;

create function valtrim.create_service_technician(
  p_name text,
  p_email text,
  p_phone text,
  p_workday_starts_at time,
  p_workday_ends_at time
)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select private.create_service_technician_internal(
    p_name, p_email, p_phone, p_workday_starts_at, p_workday_ends_at
  );
$$;

revoke all on function valtrim.create_service_technician(
  text, text, text, time, time
) from public, anon, authenticated;
grant execute on function valtrim.create_service_technician(
  text, text, text, time, time
) to authenticated;

create function private.update_service_technician_internal(
  p_technician_id bigint,
  p_name text,
  p_email text,
  p_phone text,
  p_is_active boolean,
  p_workday_starts_at time,
  p_workday_ends_at time
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_customer_service_actor();
begin
  if nullif(btrim(p_name), '') is null then
    raise exception 'Technician name is required' using errcode = '22023';
  end if;
  if p_workday_starts_at is null or p_workday_ends_at is null
     or p_workday_ends_at <= p_workday_starts_at then
    raise exception 'Technician workday is invalid' using errcode = '22023';
  end if;

  update valtrim.people person
  set name = btrim(p_name),
      email = nullif(lower(btrim(p_email)), ''),
      phone = nullif(btrim(p_phone), ''),
      is_active = p_is_active,
      updated_by = v_actor_id
  where person.id = p_technician_id
    and exists (
      select 1
      from valtrim.person_roles person_role
      where person_role.person_id = person.id
        and person_role.role = 'SERVICE_TECHNICIAN'
    );

  if not found then
    raise exception 'Service technician was not found' using errcode = 'P0002';
  end if;

  insert into valtrim.service_technician_profiles (
    person_id, workday_starts_at, workday_ends_at, created_by, updated_by
  ) values (
    p_technician_id, p_workday_starts_at, p_workday_ends_at, v_actor_id, v_actor_id
  )
  on conflict (person_id) do update
  set workday_starts_at = excluded.workday_starts_at,
      workday_ends_at = excluded.workday_ends_at,
      updated_by = excluded.updated_by;

  return p_technician_id;
end;
$$;

revoke all on function private.update_service_technician_internal(
  bigint, text, text, text, boolean, time, time
) from public, anon, authenticated;

create function valtrim.update_service_technician(
  p_technician_id bigint,
  p_name text,
  p_email text,
  p_phone text,
  p_is_active boolean,
  p_workday_starts_at time,
  p_workday_ends_at time
)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select private.update_service_technician_internal(
    p_technician_id, p_name, p_email, p_phone, p_is_active,
    p_workday_starts_at, p_workday_ends_at
  );
$$;

revoke all on function valtrim.update_service_technician(
  bigint, text, text, text, boolean, time, time
) from public, anon, authenticated;
grant execute on function valtrim.update_service_technician(
  bigint, text, text, text, boolean, time, time
) to authenticated;

notify pgrst, 'reload schema';

commit;
