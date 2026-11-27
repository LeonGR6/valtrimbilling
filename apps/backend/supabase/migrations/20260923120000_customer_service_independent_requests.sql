begin;

-- Customer Service requests may describe repair work without a production
-- community or builder. Keep existing community links for historical records.
-- ADMIN and SCHEDULING manage this module independently of project access.
alter policy service_properties_select on valtrim.service_properties
  using ((select private.has_app_role('ADMIN', 'SCHEDULING')));

alter policy service_properties_insert on valtrim.service_properties
  with check ((select private.has_app_role('ADMIN', 'SCHEDULING')));

alter policy service_properties_update on valtrim.service_properties
  using ((select private.has_app_role('ADMIN', 'SCHEDULING')))
  with check ((select private.has_app_role('ADMIN', 'SCHEDULING')));

alter policy service_requests_select on valtrim.service_requests
  using ((select private.has_app_role('ADMIN', 'SCHEDULING')));

alter policy service_requests_insert on valtrim.service_requests
  with check ((select private.has_app_role('ADMIN', 'SCHEDULING')));

alter policy service_requests_update on valtrim.service_requests
  using ((select private.has_app_role('ADMIN', 'SCHEDULING')))
  with check ((select private.has_app_role('ADMIN', 'SCHEDULING')));

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
  exception
    when invalid_text_representation or datetime_field_overflow then
      raise exception 'Community, reported date or duration has an invalid value'
        using errcode = '22023';
  end;

  -- An older client may still supply a community. It is optional, but any
  -- supplied link must remain valid and available to that actor.
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
    estimated_duration_minutes, customer_availability_notes
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
    nullif(btrim(p_request ->> 'customerAvailabilityNotes'), '')
  ) returning id, due_on into v_request_id, v_due_on;

  perform private.replace_customer_service_availability_internal(
    v_request_id, p_availability, v_reported_on, v_due_on, v_actor_id
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
begin
  if p_property is null or jsonb_typeof(p_property) <> 'object'
     or p_request is null or jsonb_typeof(p_request) <> 'object' then
    raise exception 'Property and request information are required'
      using errcode = '22023';
  end if;

  select request.property_id, request.status
    into v_property_id, v_current_status
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
  exception
    when invalid_text_representation or datetime_field_overflow then
      raise exception 'Community, reported date or duration has an invalid value'
        using errcode = '22023';
  end;

  -- Omitted/null community means "leave the historical link unchanged".
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
        nullif(btrim(p_request ->> 'customerAvailabilityNotes'), '')
  where request.id = p_request_id
  returning due_on into v_due_on;

  perform private.replace_customer_service_availability_internal(
    p_request_id, p_availability, v_reported_on, v_due_on, v_actor_id
  );
  return p_request_id;
end;
$$;

-- CREATE OR REPLACE preserves the existing EXECUTE grants and owner.
notify pgrst, 'reload schema';

commit;
