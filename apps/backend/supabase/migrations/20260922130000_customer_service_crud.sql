begin;

-- Customer Service CRUD is intentionally exposed through narrow RPCs. A
-- request spans property, request and availability rows, so browser-side
-- multi-step writes could leave partial records when one statement fails.

create function private.require_customer_service_actor()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'SCHEDULING')) then
    raise exception 'You do not have permission to manage Customer Service requests'
      using errcode = '42501';
  end if;

  return v_actor_id;
end;
$$;

revoke all on function private.require_customer_service_actor()
  from public, anon, authenticated;

create function private.replace_customer_service_availability_internal(
  p_request_id bigint,
  p_availability jsonb,
  p_reported_on date,
  p_due_on date,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_time_zone text;
  v_window jsonb;
  v_available_from timestamptz;
  v_available_until timestamptz;
begin
  if p_availability is null
     or jsonb_typeof(p_availability) <> 'array'
     or jsonb_array_length(p_availability) = 0 then
    raise exception 'At least one customer availability window is required'
      using errcode = '22023';
  end if;

  select settings.time_zone
  into v_time_zone
  from valtrim.service_scheduling_settings settings
  where settings.id = 1;

  delete from valtrim.service_request_availability availability
  where availability.request_id = p_request_id;

  for v_window in
    select availability_window.value
    from jsonb_array_elements(p_availability) availability_window(value)
  loop
    if jsonb_typeof(v_window) <> 'object'
       or nullif(btrim(v_window ->> 'availableFrom'), '') is null
       or nullif(btrim(v_window ->> 'availableUntil'), '') is null then
      raise exception 'Every availability window needs availableFrom and availableUntil'
        using errcode = '22023';
    end if;

    begin
      v_available_from := (v_window ->> 'availableFrom')::timestamptz;
      v_available_until := (v_window ->> 'availableUntil')::timestamptz;
    exception
      when invalid_datetime_format or invalid_text_representation then
        raise exception 'Customer availability contains an invalid date or time'
          using errcode = '22023';
    end;

    if v_available_until <= v_available_from then
      raise exception 'Availability must end after it starts'
        using errcode = '22023';
    end if;

    if timezone(v_time_zone, v_available_from)::date < p_reported_on
       or timezone(v_time_zone, v_available_from)::date > p_due_on
       or timezone(v_time_zone, v_available_until)::date < p_reported_on
       or timezone(v_time_zone, v_available_until)::date > p_due_on then
      raise exception 'Availability must be inside the five-business-day service window'
        using errcode = '22023';
    end if;

    insert into valtrim.service_request_availability (
      request_id,
      available_from,
      available_until,
      notes,
      created_by,
      updated_by
    )
    values (
      p_request_id,
      v_available_from,
      v_available_until,
      nullif(btrim(v_window ->> 'notes'), ''),
      p_actor_id,
      p_actor_id
    );
  end loop;
end;
$$;

revoke all on function private.replace_customer_service_availability_internal(
  bigint,
  jsonb,
  date,
  date,
  uuid
) from public, anon, authenticated;

create function private.create_customer_service_request_internal(
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
    raise exception 'Property information is required'
      using errcode = '22023';
  end if;

  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    raise exception 'Request information is required'
      using errcode = '22023';
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

  v_address := nullif(btrim(p_property ->> 'address'), '');
  v_contact_name := nullif(btrim(p_request ->> 'contactName'), '');
  v_contact_email := nullif(lower(btrim(p_request ->> 'contactEmail')), '');
  v_contact_phone := nullif(btrim(p_request ->> 'contactPhone'), '');
  v_description := nullif(btrim(p_request ->> 'issue'), '');
  v_work_type := nullif(upper(btrim(p_request ->> 'workType')), '');

  if v_community_id is null then
    raise exception 'Select a community'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from valtrim.communities community
    where community.id = v_community_id
      and community.is_active
  ) or not private.can_access_community(v_community_id) then
    raise exception 'The community does not exist or is not available to this user'
      using errcode = '42501';
  end if;

  if v_address is null
     or nullif(btrim(p_property ->> 'latitude'), '') is null
     or nullif(btrim(p_property ->> 'longitude'), '') is null then
    raise exception 'Address, latitude and longitude are required'
      using errcode = '22023';
  end if;

  if v_contact_name is null
     or v_contact_email is null
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
    community_id,
    lot_number,
    address,
    city,
    state,
    postal_code,
    plan_label,
    latitude,
    longitude,
    created_by,
    updated_by
  )
  values (
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
  )
  returning id into v_property_id;

  insert into valtrim.service_requests (
    property_id,
    reported_on,
    created_by,
    coordinator_user_id,
    homeowner_name,
    homeowner_email,
    homeowner_phone,
    request_type,
    priority,
    description,
    internal_notes,
    updated_by,
    work_type,
    estimated_duration_minutes,
    customer_availability_notes
  )
  values (
    v_property_id,
    v_reported_on,
    v_actor_id,
    v_actor_id,
    v_contact_name,
    v_contact_email::valtrim.email_address,
    v_contact_phone::valtrim.phone_number,
    coalesce(
      nullif(upper(btrim(p_request ->> 'type')), ''),
      'SERVICE_CALL'
    )::valtrim.service_request_type,
    coalesce(
      nullif(upper(btrim(p_request ->> 'priority')), ''),
      'MEDIUM'
    )::valtrim.service_priority,
    v_description,
    nullif(btrim(p_request ->> 'internalNotes'), ''),
    v_actor_id,
    v_work_type::valtrim.service_work_type,
    v_duration_minutes,
    nullif(btrim(p_request ->> 'customerAvailabilityNotes'), '')
  )
  returning id, due_on into v_request_id, v_due_on;

  perform private.replace_customer_service_availability_internal(
    v_request_id,
    p_availability,
    v_reported_on,
    v_due_on,
    v_actor_id
  );

  return v_request_id;
end;
$$;

revoke all on function private.create_customer_service_request_internal(
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated;

create function private.update_customer_service_request_internal(
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
    raise exception 'Customer Service request not found'
      using errcode = 'P0002';
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

  v_address := nullif(btrim(p_property ->> 'address'), '');
  v_contact_name := nullif(btrim(p_request ->> 'contactName'), '');
  v_contact_email := nullif(lower(btrim(p_request ->> 'contactEmail')), '');
  v_contact_phone := nullif(btrim(p_request ->> 'contactPhone'), '');
  v_description := nullif(btrim(p_request ->> 'issue'), '');
  v_work_type := nullif(upper(btrim(p_request ->> 'workType')), '');

  if v_community_id is null
     or not exists (
       select 1
       from valtrim.communities community
       where community.id = v_community_id
         and community.is_active
     )
     or not private.can_access_community(v_community_id) then
    raise exception 'The community does not exist or is not available to this user'
      using errcode = '42501';
  end if;

  if v_address is null
     or nullif(btrim(p_property ->> 'latitude'), '') is null
     or nullif(btrim(p_property ->> 'longitude'), '') is null then
    raise exception 'Address, latitude and longitude are required'
      using errcode = '22023';
  end if;

  if v_contact_name is null
     or v_contact_email is null
     or v_contact_phone is null
     or v_description is null
     or v_work_type is null
     or v_duration_minutes is null then
    raise exception 'Customer, issue, work type and duration are required'
      using errcode = '22023';
  end if;

  if v_reported_on > current_date then
    raise exception 'Reported date cannot be in the future'
      using errcode = '22023';
  end if;

  update valtrim.service_properties property
  set community_id = v_community_id,
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
        nullif(upper(btrim(p_request ->> 'type')), ''),
        'SERVICE_CALL'
      )::valtrim.service_request_type,
      priority = coalesce(
        nullif(upper(btrim(p_request ->> 'priority')), ''),
        'MEDIUM'
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
    p_request_id,
    p_availability,
    v_reported_on,
    v_due_on,
    v_actor_id
  );

  return p_request_id;
end;
$$;

revoke all on function private.update_customer_service_request_internal(
  bigint,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated;

create function private.close_customer_service_request_internal(
  p_request_id bigint,
  p_reason text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_customer_service_actor();
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A close reason is required'
      using errcode = '22023';
  end if;

  update valtrim.service_requests request
  set status_before_close = request.status,
      status = 'CLOSED',
      closed_at = now(),
      closed_by = v_actor_id,
      close_reason = btrim(p_reason),
      status_note = btrim(p_reason),
      updated_by = v_actor_id
  where request.id = p_request_id
    and request.status <> 'CLOSED';

  if not found then
    raise exception 'Customer Service request was not found or is already closed'
      using errcode = 'P0002';
  end if;

  return p_request_id;
end;
$$;

revoke all on function private.close_customer_service_request_internal(
  bigint,
  text
) from public, anon, authenticated;

create function private.reopen_customer_service_request_internal(
  p_request_id bigint,
  p_note text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_customer_service_actor();
begin
  update valtrim.service_requests request
  set status = coalesce(request.status_before_close, 'CONTACT_NEEDED'),
      status_before_close = null,
      closed_at = null,
      closed_by = null,
      close_reason = null,
      status_note = nullif(btrim(p_note), ''),
      updated_by = v_actor_id
  where request.id = p_request_id
    and request.status = 'CLOSED';

  if not found then
    raise exception 'Customer Service request was not found or is not closed'
      using errcode = 'P0002';
  end if;

  return p_request_id;
end;
$$;

revoke all on function private.reopen_customer_service_request_internal(
  bigint,
  text
) from public, anon, authenticated;

-- Public Data API wrappers use definer rights because direct table writes are
-- revoked below. Their private implementations still validate the JWT actor,
-- application role and community access before changing any data.
create function valtrim.create_customer_service_request(
  p_property jsonb,
  p_request jsonb,
  p_availability jsonb
)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select private.create_customer_service_request_internal(
    p_property,
    p_request,
    p_availability
  );
$$;

create function valtrim.update_customer_service_request(
  p_request_id bigint,
  p_property jsonb,
  p_request jsonb,
  p_availability jsonb
)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select private.update_customer_service_request_internal(
    p_request_id,
    p_property,
    p_request,
    p_availability
  );
$$;

create function valtrim.close_customer_service_request(
  p_request_id bigint,
  p_reason text
)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select private.close_customer_service_request_internal(
    p_request_id,
    p_reason
  );
$$;

create function valtrim.reopen_customer_service_request(
  p_request_id bigint,
  p_note text
)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select private.reopen_customer_service_request_internal(
    p_request_id,
    p_note
  );
$$;

revoke all on function valtrim.create_customer_service_request(
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated;
revoke all on function valtrim.update_customer_service_request(
  bigint,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated;
revoke all on function valtrim.close_customer_service_request(bigint, text)
  from public, anon, authenticated;
revoke all on function valtrim.reopen_customer_service_request(bigint, text)
  from public, anon, authenticated;

grant execute on function valtrim.create_customer_service_request(
  jsonb,
  jsonb,
  jsonb
) to authenticated;
grant execute on function valtrim.update_customer_service_request(
  bigint,
  jsonb,
  jsonb,
  jsonb
) to authenticated;
grant execute on function valtrim.close_customer_service_request(bigint, text)
  to authenticated;
grant execute on function valtrim.reopen_customer_service_request(bigint, text)
  to authenticated;

-- Remove every browser write path that could bypass the atomic RPCs. SELECT
-- remains available under the RLS policies created by the foundation phase.
revoke insert (
  community_id,
  lot_number,
  address,
  city,
  state,
  postal_code,
  plan_label,
  latitude,
  longitude
) on valtrim.service_properties from authenticated;
revoke update (
  community_id,
  lot_number,
  address,
  city,
  state,
  postal_code,
  plan_label,
  latitude,
  longitude
) on valtrim.service_properties from authenticated;

revoke insert (
  property_id,
  reported_on,
  coordinator_user_id,
  homeowner_name,
  homeowner_email,
  homeowner_phone,
  request_type,
  priority,
  status,
  status_note,
  description,
  internal_notes,
  work_type,
  estimated_duration_minutes,
  customer_availability_notes
) on valtrim.service_requests from authenticated;
revoke update (
  property_id,
  reported_on,
  coordinator_user_id,
  homeowner_name,
  homeowner_email,
  homeowner_phone,
  request_type,
  priority,
  status,
  status_note,
  description,
  internal_notes,
  work_type,
  estimated_duration_minutes,
  customer_availability_notes,
  resolution_status,
  completed_at,
  completion_notes,
  exception_reason
) on valtrim.service_requests from authenticated;

revoke insert, update, delete
  on valtrim.service_request_availability from authenticated;

revoke insert (
  request_id,
  technician_id,
  starts_at,
  ends_at,
  state,
  is_current,
  notes,
  completed_at,
  cancelled_at
) on valtrim.service_appointments from authenticated;
revoke update (
  technician_id,
  starts_at,
  ends_at,
  state,
  is_current,
  notes,
  completed_at,
  cancelled_at
) on valtrim.service_appointments from authenticated;

revoke usage on sequence valtrim.service_properties_id_seq
  from authenticated;
revoke usage on sequence valtrim.service_requests_id_seq
  from authenticated;
revoke usage on sequence valtrim.service_request_folio_seq
  from authenticated;
revoke usage on sequence valtrim.service_request_availability_id_seq
  from authenticated;
revoke usage on sequence valtrim.service_appointments_id_seq
  from authenticated;

-- Extend the request audit vocabulary so closing and reopening are distinct
-- Activity History events rather than generic edits.
create or replace function private.audit_customer_service_request_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_candidate uuid := coalesce(
    (select auth.uid()),
    new.updated_by,
    new.created_by
  );
  v_actor_id uuid;
  v_actor_name text;
  v_actor_email valtrim.email_address;
  v_actor_role text;
  v_property_label text;
  v_old_snapshot jsonb;
  v_new_snapshot jsonb;
  v_previous_values jsonb := '{}'::jsonb;
  v_new_values jsonb;
  v_changed_fields text[] := array[]::text[];
  v_action text;
  v_summary text;
begin
  select app_user.id, app_user.name, app_user.email, app_user.role::text
  into v_actor_id, v_actor_name, v_actor_email, v_actor_role
  from valtrim.app_users app_user
  where app_user.id = v_actor_candidate;

  select property.address
  into v_property_label
  from valtrim.service_properties property
  where property.id = new.property_id;

  v_new_snapshot := jsonb_build_object(
    'property_id', new.property_id,
    'reported_on', new.reported_on,
    'due_on', new.due_on,
    'homeowner_name', new.homeowner_name,
    'request_type', new.request_type::text,
    'work_type', new.work_type::text,
    'priority', new.priority::text,
    'status', new.status::text,
    'estimated_duration_minutes', new.estimated_duration_minutes,
    'description', new.description,
    'resolution_status', new.resolution_status::text
  );

  if tg_op = 'INSERT' then
    v_action := 'SERVICE_REQUEST_CREATED';
    v_new_values := v_new_snapshot;
    select array_agg(field.key order by field.key)
    into v_changed_fields
    from jsonb_each(v_new_snapshot) field;
    v_summary := format('Customer Service request %s was created.', new.folio);
  else
    v_old_snapshot := jsonb_build_object(
      'property_id', old.property_id,
      'reported_on', old.reported_on,
      'due_on', old.due_on,
      'homeowner_name', old.homeowner_name,
      'request_type', old.request_type::text,
      'work_type', old.work_type::text,
      'priority', old.priority::text,
      'status', old.status::text,
      'estimated_duration_minutes', old.estimated_duration_minutes,
      'description', old.description,
      'resolution_status', old.resolution_status::text
    );

    select
      coalesce(
        jsonb_object_agg(change.key, v_old_snapshot -> change.key),
        '{}'::jsonb
      ),
      coalesce(
        jsonb_object_agg(change.key, change.value),
        '{}'::jsonb
      ),
      coalesce(array_agg(change.key order by change.key), array[]::text[])
    into v_previous_values, v_new_values, v_changed_fields
    from jsonb_each(v_new_snapshot) change
    where v_old_snapshot -> change.key is distinct from change.value;

    if cardinality(v_changed_fields) = 0 then
      return new;
    end if;

    if old.status is distinct from new.status and new.status = 'CLOSED' then
      v_action := 'SERVICE_REQUEST_CLOSED';
      v_summary := format('Customer Service request %s was closed.', new.folio);
    elsif old.status = 'CLOSED' and new.status <> 'CLOSED' then
      v_action := 'SERVICE_REQUEST_REOPENED';
      v_summary := format('Customer Service request %s was reopened.', new.folio);
    elsif old.status is distinct from new.status and new.status = 'COMPLETED' then
      v_action := 'SERVICE_REQUEST_COMPLETED';
      v_summary := format('Customer Service request %s was completed.', new.folio);
    elsif old.status is distinct from new.status and new.status = 'OVERDUE' then
      v_action := 'SERVICE_REQUEST_OVERDUE';
      v_summary := format('Customer Service request %s became overdue.', new.folio);
    else
      v_action := 'SERVICE_REQUEST_UPDATED';
      v_summary := format('Customer Service request %s was updated.', new.folio);
    end if;
  end if;

  insert into valtrim.audit_events (
    module,
    action,
    result,
    actor_type,
    actor_user_id,
    actor_name,
    actor_email,
    actor_role,
    target_name,
    entity_type,
    entity_id,
    entity_label,
    summary,
    previous_values,
    new_values,
    metadata
  )
  values (
    'CUSTOMER_SERVICE',
    v_action,
    'SUCCESS',
    case when v_actor_id is null then 'SYSTEM' else 'USER' end,
    v_actor_id,
    coalesce(v_actor_name, 'System'),
    v_actor_email,
    v_actor_role,
    new.homeowner_name,
    'SERVICE_REQUEST',
    new.id::text,
    new.folio,
    v_summary,
    v_previous_values,
    v_new_values,
    jsonb_build_object(
      'propertyId', new.property_id,
      'propertyLabel', v_property_label,
      'changedFields', to_jsonb(v_changed_fields)
    )
  );

  return new;
end;
$$;

revoke all on function private.audit_customer_service_request_change()
  from public, anon, authenticated;

create view valtrim.service_request_detail
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
    request.work_type is not null
    and request.estimated_duration_minutes is not null
    and request.homeowner_email is not null
    and property.latitude is not null
    and property.longitude is not null
    and exists (
      select 1
      from valtrim.service_request_availability availability
      where availability.request_id = request.id
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

revoke all on valtrim.service_request_detail
  from public, anon, authenticated;
grant select on valtrim.service_request_detail to authenticated;

notify pgrst, 'reload schema';

commit;
