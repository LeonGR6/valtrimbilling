begin;

alter table valtrim.service_requests
  add column customer_unavailable_dates date[] not null default '{}'::date[],
  add column customer_needs_contact boolean not null default false,
  add constraint service_requests_customer_unavailable_dates_limit_check
    check (cardinality(customer_unavailable_dates) <= 5);

alter table valtrim.service_scheduling_settings
  alter column workday_starts_at set default time '07:00',
  alter column workday_ends_at set default time '17:00',
  alter column travel_buffer_minutes set default 30;

update valtrim.service_scheduling_settings
set workday_starts_at = time '07:00',
    workday_ends_at = time '17:00',
    travel_buffer_minutes = 30
where id = 1;

alter table valtrim.service_technician_profiles
  alter column workday_starts_at set default time '07:00',
  alter column workday_ends_at set default time '17:00';

update valtrim.service_technician_profiles
set workday_starts_at = time '07:00',
    workday_ends_at = time '17:00';

create function private.parse_customer_unavailable_dates(
  p_value jsonb,
  p_reported_on date,
  p_due_on date
)
returns date[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_dates date[] := '{}'::date[];
begin
  if p_value is null then
    return v_dates;
  end if;

  if jsonb_typeof(p_value) <> 'array' then
    raise exception 'Customer unavailable dates must be an array'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_value) > 5 then
    raise exception 'Use five customer unavailable dates or fewer'
      using errcode = '22023';
  end if;

  begin
    select coalesce(
      array_agg(distinct unavailable_date::date order by unavailable_date::date),
      '{}'::date[]
    )
    into v_dates
    from jsonb_array_elements_text(p_value) unavailable(unavailable_date);
  exception
    when invalid_text_representation or datetime_field_overflow then
      raise exception 'Customer unavailable dates contain an invalid date'
        using errcode = '22023';
  end;

  if cardinality(v_dates) <> jsonb_array_length(p_value) then
    raise exception 'Customer unavailable dates cannot repeat'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(v_dates) unavailable_date
    where unavailable_date < p_reported_on
      or unavailable_date > p_due_on
      or extract(isodow from unavailable_date) not between 1 and 5
  ) then
    raise exception 'Customer unavailable dates must be business days inside the request deadline'
      using errcode = '22023';
  end if;

  return v_dates;
end;
$$;

revoke all on function private.parse_customer_unavailable_dates(
  jsonb, date, date
) from public, anon, authenticated;

create function private.build_customer_service_availability(
  p_reported_on date,
  p_due_on date,
  p_unavailable_dates date[]
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'availableFrom',
          ((p_reported_on + candidate.day_offset) + settings.workday_starts_at)
            at time zone settings.time_zone,
        'availableUntil',
          ((p_reported_on + candidate.day_offset) + settings.workday_ends_at)
            at time zone settings.time_zone,
        'notes', null
      )
      order by candidate.day_offset
    ),
    '[]'::jsonb
  )
  from valtrim.service_scheduling_settings settings
  cross join lateral generate_series(
    0,
    greatest(p_due_on - p_reported_on, -1)
  ) candidate(day_offset)
  where settings.id = 1
    and extract(isodow from p_reported_on + candidate.day_offset) between 1 and 5
    and not ((p_reported_on + candidate.day_offset) = any(
      coalesce(p_unavailable_dates, '{}'::date[])
    ));
$$;

revoke all on function private.build_customer_service_availability(
  date, date, date[]
) from public, anon, authenticated;

create or replace function private.create_customer_service_request_internal(
  p_property jsonb,
  p_request jsonb,
  p_availability jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_customer_service_actor();
  v_community_id bigint;
  v_property_id bigint;
  v_request_id bigint;
  v_reported_on date;
  v_due_on date;
  v_contact_name text;
  v_contact_email text;
  v_contact_phone text;
  v_address text;
  v_description text;
  v_work_type text;
  v_duration_minutes integer;
  v_business_days integer;
  v_unavailable_dates date[] := '{}'::date[];
  v_needs_contact boolean := false;
  v_generated_availability jsonb := p_availability;
begin
  if p_property is null or jsonb_typeof(p_property) <> 'object' then
    raise exception 'Property information is required' using errcode = '22023';
  end if;
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    raise exception 'Request information is required' using errcode = '22023';
  end if;

  begin
    v_community_id := nullif(btrim(p_property ->> 'communityId'), '')::bigint;
    v_reported_on := coalesce(
      nullif(btrim(p_request ->> 'reportedOn'), '')::date,
      current_date
    );
    v_duration_minutes :=
      nullif(btrim(p_request ->> 'estimatedDurationMinutes'), '')::integer;
    v_needs_contact := coalesce(
      nullif(btrim(p_request ->> 'customerNeedsContact'), '')::boolean,
      false
    );
  exception
    when invalid_text_representation or datetime_field_overflow then
      raise exception 'Community, reported date, duration or contact preference has an invalid value'
        using errcode = '22023';
  end;

  select settings.business_days_to_complete
  into v_business_days
  from valtrim.service_scheduling_settings settings
  where settings.id = 1;

  v_due_on := valtrim.calculate_business_due_date(
    v_reported_on,
    coalesce(v_business_days, 5)
  );

  if p_request ? 'customerUnavailableDates' then
    v_unavailable_dates := private.parse_customer_unavailable_dates(
      p_request -> 'customerUnavailableDates',
      v_reported_on,
      v_due_on
    );
    v_generated_availability := private.build_customer_service_availability(
      v_reported_on,
      v_due_on,
      v_unavailable_dates
    );
  end if;

  if v_community_id is not null and (
    not exists (
      select 1 from valtrim.communities community
      where community.id = v_community_id and community.is_active
    ) or not private.can_access_community(v_community_id)
  ) then
    raise exception 'The community does not exist or is not available to this user'
      using errcode = '42501';
  end if;

  v_address := nullif(btrim(p_property ->> 'address'), '');
  v_contact_name := nullif(btrim(p_request ->> 'contactName'), '');
  v_contact_email := nullif(lower(btrim(p_request ->> 'contactEmail')), '');
  v_contact_phone := nullif(btrim(p_request ->> 'contactPhone'), '');
  v_description := nullif(btrim(p_request ->> 'issue'), '');
  v_work_type := nullif(upper(btrim(p_request ->> 'workType')), '');

  if v_address is null
     or nullif(btrim(p_property ->> 'latitude'), '') is null
     or nullif(btrim(p_property ->> 'longitude'), '') is null then
    raise exception 'Address, latitude and longitude are required'
      using errcode = '22023';
  end if;
  if v_contact_name is null or v_contact_email is null
     or v_contact_phone is null then
    raise exception 'Customer name, email and phone are required'
      using errcode = '22023';
  end if;
  if v_description is null or v_work_type is null
     or v_duration_minutes is null then
    raise exception 'Issue, work type and estimated duration are required'
      using errcode = '22023';
  end if;
  if v_reported_on > current_date then
    raise exception 'Reported date cannot be in the future'
      using errcode = '22023';
  end if;

  insert into valtrim.service_properties (
    community_id, lot_number, address, city, state, postal_code,
    plan_label, latitude, longitude, created_by, updated_by
  ) values (
    v_community_id,
    nullif(btrim(p_property ->> 'lotNumber'), ''),
    v_address,
    nullif(btrim(p_property ->> 'city'), ''),
    nullif(upper(btrim(p_property ->> 'state')), ''),
    nullif(btrim(p_property ->> 'postalCode'), ''),
    nullif(btrim(p_property ->> 'planLabel'), ''),
    (p_property ->> 'latitude')::numeric,
    (p_property ->> 'longitude')::numeric,
    v_actor_id,
    v_actor_id
  ) returning id into v_property_id;

  insert into valtrim.service_requests (
    property_id, reported_on, created_by, coordinator_user_id,
    homeowner_name, homeowner_email, homeowner_phone, request_type,
    priority, description, internal_notes, updated_by, work_type,
    estimated_duration_minutes, customer_availability_notes,
    customer_unavailable_dates, customer_needs_contact
  ) values (
    v_property_id,
    v_reported_on,
    v_actor_id,
    v_actor_id,
    v_contact_name,
    v_contact_email::valtrim.email_address,
    v_contact_phone::valtrim.phone_number,
    coalesce(nullif(upper(btrim(p_request ->> 'type')), ''), 'SERVICE_CALL')
      ::valtrim.service_request_type,
    coalesce(nullif(upper(btrim(p_request ->> 'priority')), ''), 'MEDIUM')
      ::valtrim.service_priority,
    v_description,
    nullif(btrim(p_request ->> 'internalNotes'), ''),
    v_actor_id,
    v_work_type::valtrim.service_work_type,
    v_duration_minutes,
    nullif(btrim(p_request ->> 'customerAvailabilityNotes'), ''),
    v_unavailable_dates,
    v_needs_contact
  ) returning id, due_on into v_request_id, v_due_on;

  perform private.replace_customer_service_availability_internal(
    v_request_id,
    v_generated_availability,
    v_reported_on,
    v_due_on,
    v_actor_id
  );
  return v_request_id;
end;
$$;

create or replace function private.update_customer_service_request_internal(
  p_request_id bigint,
  p_property jsonb,
  p_request jsonb,
  p_availability jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_customer_service_actor();
  v_property_id bigint;
  v_current_status valtrim.service_status;
  v_community_id bigint;
  v_reported_on date;
  v_due_on date;
  v_contact_name text;
  v_contact_email text;
  v_contact_phone text;
  v_address text;
  v_description text;
  v_work_type text;
  v_duration_minutes integer;
  v_business_days integer;
  v_unavailable_dates date[];
  v_needs_contact boolean;
  v_generated_availability jsonb := p_availability;
begin
  if p_property is null or jsonb_typeof(p_property) <> 'object'
     or p_request is null or jsonb_typeof(p_request) <> 'object' then
    raise exception 'Property and request information are required'
      using errcode = '22023';
  end if;

  select
    request.property_id,
    request.status,
    request.customer_unavailable_dates,
    request.customer_needs_contact
  into
    v_property_id,
    v_current_status,
    v_unavailable_dates,
    v_needs_contact
  from valtrim.service_requests request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception 'Customer Service request not found' using errcode = 'P0002';
  end if;
  if v_current_status in ('COMPLETED', 'CLOSED') then
    raise exception 'Completed or closed requests cannot be edited'
      using errcode = '55000';
  end if;

  begin
    v_community_id := nullif(btrim(p_property ->> 'communityId'), '')::bigint;
    v_reported_on := coalesce(
      nullif(btrim(p_request ->> 'reportedOn'), '')::date,
      current_date
    );
    v_duration_minutes :=
      nullif(btrim(p_request ->> 'estimatedDurationMinutes'), '')::integer;
    if p_request ? 'customerNeedsContact' then
      v_needs_contact := coalesce(
        nullif(btrim(p_request ->> 'customerNeedsContact'), '')::boolean,
        false
      );
    end if;
  exception
    when invalid_text_representation or datetime_field_overflow then
      raise exception 'Community, reported date, duration or contact preference has an invalid value'
        using errcode = '22023';
  end;

  select settings.business_days_to_complete
  into v_business_days
  from valtrim.service_scheduling_settings settings
  where settings.id = 1;

  v_due_on := valtrim.calculate_business_due_date(
    v_reported_on,
    coalesce(v_business_days, 5)
  );

  if p_request ? 'customerUnavailableDates' then
    v_unavailable_dates := private.parse_customer_unavailable_dates(
      p_request -> 'customerUnavailableDates',
      v_reported_on,
      v_due_on
    );
    v_generated_availability := private.build_customer_service_availability(
      v_reported_on,
      v_due_on,
      v_unavailable_dates
    );
  end if;

  if v_community_id is not null and (
    not exists (
      select 1 from valtrim.communities community
      where community.id = v_community_id and community.is_active
    ) or not private.can_access_community(v_community_id)
  ) then
    raise exception 'The community does not exist or is not available to this user'
      using errcode = '42501';
  end if;

  v_address := nullif(btrim(p_property ->> 'address'), '');
  v_contact_name := nullif(btrim(p_request ->> 'contactName'), '');
  v_contact_email := nullif(lower(btrim(p_request ->> 'contactEmail')), '');
  v_contact_phone := nullif(btrim(p_request ->> 'contactPhone'), '');
  v_description := nullif(btrim(p_request ->> 'issue'), '');
  v_work_type := nullif(upper(btrim(p_request ->> 'workType')), '');

  if v_address is null
     or nullif(btrim(p_property ->> 'latitude'), '') is null
     or nullif(btrim(p_property ->> 'longitude'), '') is null then
    raise exception 'Address, latitude and longitude are required'
      using errcode = '22023';
  end if;
  if v_contact_name is null or v_contact_email is null
     or v_contact_phone is null or v_description is null
     or v_work_type is null or v_duration_minutes is null then
    raise exception 'Customer, issue, work type and duration are required'
      using errcode = '22023';
  end if;
  if v_reported_on > current_date then
    raise exception 'Reported date cannot be in the future'
      using errcode = '22023';
  end if;

  update valtrim.service_properties property
  set community_id = coalesce(v_community_id, property.community_id),
      lot_number = nullif(btrim(p_property ->> 'lotNumber'), ''),
      address = v_address,
      city = nullif(btrim(p_property ->> 'city'), ''),
      state = nullif(upper(btrim(p_property ->> 'state')), ''),
      postal_code = nullif(btrim(p_property ->> 'postalCode'), ''),
      plan_label = nullif(btrim(p_property ->> 'planLabel'), ''),
      latitude = (p_property ->> 'latitude')::numeric,
      longitude = (p_property ->> 'longitude')::numeric,
      updated_by = v_actor_id
  where property.id = v_property_id;

  update valtrim.service_requests request
  set reported_on = v_reported_on,
      coordinator_user_id = v_actor_id,
      homeowner_name = v_contact_name,
      homeowner_email = v_contact_email::valtrim.email_address,
      homeowner_phone = v_contact_phone::valtrim.phone_number,
      request_type = coalesce(
        nullif(upper(btrim(p_request ->> 'type')), ''), 'SERVICE_CALL'
      )::valtrim.service_request_type,
      priority = coalesce(
        nullif(upper(btrim(p_request ->> 'priority')), ''), 'MEDIUM'
      )::valtrim.service_priority,
      description = v_description,
      internal_notes = nullif(btrim(p_request ->> 'internalNotes'), ''),
      updated_by = v_actor_id,
      work_type = v_work_type::valtrim.service_work_type,
      estimated_duration_minutes = v_duration_minutes,
      customer_availability_notes =
        nullif(btrim(p_request ->> 'customerAvailabilityNotes'), ''),
      customer_unavailable_dates = v_unavailable_dates,
      customer_needs_contact = v_needs_contact
  where request.id = p_request_id
  returning due_on into v_due_on;

  perform private.replace_customer_service_availability_internal(
    p_request_id,
    v_generated_availability,
    v_reported_on,
    v_due_on,
    v_actor_id
  );
  return p_request_id;
end;
$$;

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
  ) as is_overdue,
  request.customer_unavailable_dates,
  request.customer_needs_contact
from valtrim.service_requests request
join valtrim.service_properties property on property.id = request.property_id
left join valtrim.communities community on community.id = property.community_id
left join valtrim.builders builder on builder.id = community.builder_id
left join valtrim.service_appointments appointment
  on appointment.request_id = request.id and appointment.is_current
left join valtrim.people technician on technician.id = appointment.technician_id;

comment on column valtrim.service_requests.customer_unavailable_dates is
  'Business days the customer cannot receive service inside the five-day deadline.';
comment on column valtrim.service_requests.customer_needs_contact is
  'Whether Valtrim should contact the customer before sending another proposal.';
comment on table valtrim.service_request_availability is
  'System-generated schedulable workdays after applying customer restrictions.';

notify pgrst, 'reload schema';

commit;
