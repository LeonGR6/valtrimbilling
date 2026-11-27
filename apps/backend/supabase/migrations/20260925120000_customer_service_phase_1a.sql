begin;

-- Phase 1A keeps the scheduling inputs small: one workday and one dispatch
-- origin per active technician. Skills, lunch and parts are intentionally not
-- part of proposal readiness.
alter table valtrim.service_scheduling_settings
  add column travel_buffer_minutes smallint not null default 15
    check (travel_buffer_minutes between 0 and 120),
  add column default_duration_minutes smallint not null default 60
    check (default_duration_minutes between 15 and 720),
  add column requires_dispatcher_approval boolean not null default true;

update valtrim.service_scheduling_settings
set business_days_to_complete = 5
where id = 1;

alter table valtrim.service_scheduling_settings
  add constraint service_scheduling_settings_five_day_check
    check (business_days_to_complete = 5);

revoke update (business_days_to_complete)
  on valtrim.service_scheduling_settings from authenticated;

grant update (
  travel_buffer_minutes,
  default_duration_minutes,
  requires_dispatcher_approval
) on valtrim.service_scheduling_settings to authenticated;

create table valtrim.service_technician_profiles (
  person_id bigint primary key
    references valtrim.people(id) on delete cascade,
  workday_starts_at time not null default time '08:00',
  workday_ends_at time not null default time '17:00',
  start_latitude numeric(9,6)
    check (start_latitude between -90 and 90),
  start_longitude numeric(9,6)
    check (start_longitude between -180 and 180),
  created_by uuid references valtrim.app_users(id) on delete set null,
  updated_by uuid references valtrim.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (workday_ends_at > workday_starts_at),
  check (
    (start_latitude is null and start_longitude is null)
    or (start_latitude is not null and start_longitude is not null)
  )
);

insert into valtrim.service_technician_profiles (
  person_id,
  workday_starts_at,
  workday_ends_at,
  start_latitude,
  start_longitude
)
select
  person_role.person_id,
  settings.workday_starts_at,
  settings.workday_ends_at,
  settings.company_latitude,
  settings.company_longitude
from valtrim.person_roles person_role
cross join valtrim.service_scheduling_settings settings
where person_role.role = 'SERVICE_TECHNICIAN'
  and settings.id = 1
on conflict (person_id) do nothing;

create trigger service_technician_profiles_set_updated_at
before update on valtrim.service_technician_profiles
for each row execute function valtrim.set_updated_at();

alter table valtrim.service_technician_profiles enable row level security;

revoke all on valtrim.service_technician_profiles
  from public, anon, authenticated;
grant select on valtrim.service_technician_profiles to authenticated;

create policy service_technician_profiles_select
on valtrim.service_technician_profiles for select to authenticated
using ((select private.has_app_role('ADMIN', 'SCHEDULING')));

drop view if exists valtrim.service_technician_roster;
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
  profile.start_latitude,
  profile.start_longitude,
  (
    person.is_active
    and profile.workday_starts_at is not null
    and profile.workday_ends_at is not null
    and profile.start_latitude is not null
    and profile.start_longitude is not null
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

-- Keep database readiness aligned with the confirmed Phase 1A rules. Email is
-- required before sending a proposal, not before generating one.
create or replace view valtrim.service_request_detail
with (security_invoker = true)
as
select
  request.id,
  request.folio,
  request.property_id,
  request.reported_on,
  request.due_on,
  request.status,
  request.tag,
  request.priority,
  request.request_type,
  request.work_type,
  request.estimated_duration_minutes,
  request.homeowner_name,
  request.homeowner_email,
  request.homeowner_phone,
  request.description,
  request.internal_notes,
  request.customer_availability_notes,
  request.resolution_status,
  request.completed_at as request_completed_at,
  request.completion_notes,
  request.exception_reason,
  request.status_before_close,
  request.closed_at,
  request.close_reason,
  request.coordinator_user_id,
  property.community_id,
  community.builder_id,
  builder.name as builder_name,
  community.name as community_name,
  property.lot_number,
  property.address,
  property.city,
  property.state,
  property.postal_code,
  property.plan_label,
  property.latitude,
  property.longitude,
  appointment.id as current_appointment_id,
  appointment.starts_at,
  appointment.ends_at,
  appointment.state as appointment_state,
  appointment.confirmation_status,
  appointment.confirmation_sent_at,
  appointment.confirmed_at,
  appointment.reminder_sent_at,
  appointment.phone_follow_up_at,
  appointment.customer_response_note,
  appointment.technician_id,
  technician.name as technician_name,
  request.created_at,
  request.updated_at,
  (
    request.status not in ('COMPLETED', 'CLOSED')
    and current_date <= request.due_on
    and request.work_type is not null
    and request.estimated_duration_minutes is not null
    and request.priority is not null
    and property.latitude is not null
    and property.longitude is not null
    and exists (
      select 1
      from valtrim.service_request_availability availability
      where availability.request_id = request.id
    )
    and exists (
      select 1
      from valtrim.people service_technician
      join valtrim.person_roles service_role
        on service_role.person_id = service_technician.id
       and service_role.role = 'SERVICE_TECHNICIAN'
      join valtrim.service_technician_profiles service_profile
        on service_profile.person_id = service_technician.id
      where service_technician.is_active
        and service_profile.start_latitude is not null
        and service_profile.start_longitude is not null
    )
  ) as is_ready_to_schedule,
  (
    request.status not in ('COMPLETED', 'CLOSED')
    and current_date > request.due_on
  ) as is_overdue
from valtrim.service_requests request
join valtrim.service_properties property on property.id = request.property_id
left join valtrim.communities community on community.id = property.community_id
left join valtrim.builders builder on builder.id = community.builder_id
left join valtrim.service_appointments appointment
  on appointment.request_id = request.id and appointment.is_current
left join valtrim.people technician on technician.id = appointment.technician_id;

drop function if exists valtrim.create_service_technician(text, text, text);
drop function if exists private.create_service_technician_internal(text, text, text);

create function private.create_service_technician_internal(
  p_name text,
  p_email text,
  p_phone text,
  p_workday_starts_at time,
  p_workday_ends_at time,
  p_start_latitude numeric,
  p_start_longitude numeric
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
  if p_start_latitude is null or p_start_longitude is null
     or p_start_latitude not between -90 and 90
     or p_start_longitude not between -180 and 180 then
    raise exception 'Technician start coordinates are invalid'
      using errcode = '22023';
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
    person_id,
    workday_starts_at,
    workday_ends_at,
    start_latitude,
    start_longitude,
    created_by,
    updated_by
  ) values (
    v_technician_id,
    p_workday_starts_at,
    p_workday_ends_at,
    p_start_latitude,
    p_start_longitude,
    v_actor_id,
    v_actor_id
  );

  return v_technician_id;
end;
$$;

revoke all on function private.create_service_technician_internal(
  text, text, text, time, time, numeric, numeric
) from public, anon, authenticated;

create function valtrim.create_service_technician(
  p_name text,
  p_email text,
  p_phone text,
  p_workday_starts_at time,
  p_workday_ends_at time,
  p_start_latitude numeric,
  p_start_longitude numeric
)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select private.create_service_technician_internal(
    p_name,
    p_email,
    p_phone,
    p_workday_starts_at,
    p_workday_ends_at,
    p_start_latitude,
    p_start_longitude
  );
$$;

revoke all on function valtrim.create_service_technician(
  text, text, text, time, time, numeric, numeric
) from public, anon, authenticated;
grant execute on function valtrim.create_service_technician(
  text, text, text, time, time, numeric, numeric
) to authenticated;

create function private.update_service_technician_internal(
  p_technician_id bigint,
  p_name text,
  p_email text,
  p_phone text,
  p_is_active boolean,
  p_workday_starts_at time,
  p_workday_ends_at time,
  p_start_latitude numeric,
  p_start_longitude numeric
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
  if p_start_latitude is null or p_start_longitude is null
     or p_start_latitude not between -90 and 90
     or p_start_longitude not between -180 and 180 then
    raise exception 'Technician start coordinates are invalid'
      using errcode = '22023';
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
    person_id,
    workday_starts_at,
    workday_ends_at,
    start_latitude,
    start_longitude,
    created_by,
    updated_by
  ) values (
    p_technician_id,
    p_workday_starts_at,
    p_workday_ends_at,
    p_start_latitude,
    p_start_longitude,
    v_actor_id,
    v_actor_id
  )
  on conflict (person_id) do update
  set workday_starts_at = excluded.workday_starts_at,
      workday_ends_at = excluded.workday_ends_at,
      start_latitude = excluded.start_latitude,
      start_longitude = excluded.start_longitude,
      updated_by = excluded.updated_by;

  return p_technician_id;
end;
$$;

revoke all on function private.update_service_technician_internal(
  bigint, text, text, text, boolean, time, time, numeric, numeric
) from public, anon, authenticated;

create function valtrim.update_service_technician(
  p_technician_id bigint,
  p_name text,
  p_email text,
  p_phone text,
  p_is_active boolean,
  p_workday_starts_at time,
  p_workday_ends_at time,
  p_start_latitude numeric,
  p_start_longitude numeric
)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select private.update_service_technician_internal(
    p_technician_id,
    p_name,
    p_email,
    p_phone,
    p_is_active,
    p_workday_starts_at,
    p_workday_ends_at,
    p_start_latitude,
    p_start_longitude
  );
$$;

revoke all on function valtrim.update_service_technician(
  bigint, text, text, text, boolean, time, time, numeric, numeric
) from public, anon, authenticated;
grant execute on function valtrim.update_service_technician(
  bigint, text, text, text, boolean, time, time, numeric, numeric
) to authenticated;

notify pgrst, 'reload schema';

commit;
