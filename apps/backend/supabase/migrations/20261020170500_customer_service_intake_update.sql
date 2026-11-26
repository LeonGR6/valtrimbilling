-- Persistent editing of the same intake. Approval remains a separate block.
begin;

-- now() is constant within a transaction. Give every request update a strictly
-- increasing token, including updates performed by existing scheduling RPCs.
create function private.set_customer_service_request_updated_at()
returns trigger language plpgsql set search_path = '' as $function$
begin
  new.updated_at := greatest(pg_catalog.clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$function$;
revoke all on function private.set_customer_service_request_updated_at() from public, anon, authenticated;
drop trigger service_requests_set_updated_at on valtrim.service_requests;
create trigger service_requests_set_updated_at before update on valtrim.service_requests
for each row execute function private.set_customer_service_request_updated_at();

create function valtrim.update_customer_service_request_intake(
  p_request_id bigint,
  p_expected_updated_at timestamptz,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_customer_service_actor();
  v_existing valtrim.service_requests%rowtype;
  v_existing_property valtrim.service_properties%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_admin_only boolean;
  v_completed boolean;
  v_locked boolean;
  v_property jsonb;
  v_request jsonb;
  v_contacts jsonb;
  v_items jsonb;
  v_old_contacts jsonb;
  v_old_items jsonb;
  v_contact jsonb;
  v_item jsonb;
  v_job record;
  v_job_id bigint;
  v_property_id bigint;
  v_reported_on date;
  v_reported_on_source valtrim.service_reported_on_source;
  v_priority valtrim.service_priority;
  v_service_kind valtrim.service_kind;
  v_work_category valtrim.service_work_category;
  v_service_task valtrim.service_task;
  v_estimated_duration_minutes integer;
  v_crew_size integer;
  v_internal_notes text;
  v_lot_number text;
  v_address text;
  v_primary_name text;
  v_primary_email text;
  v_primary_phone text;
  v_contact_role valtrim.service_request_contact_role;
  v_contact_name text;
  v_contact_email text;
  v_contact_phone text;
  v_primary_count integer := 0;
  v_additional_count integer := 0;
  v_item_number integer;
  v_expected_item_number integer := 1;
  v_item_description text;
  v_material_required boolean;
  v_chargeable boolean;
  v_request_description text := '';
  v_property_changed boolean;
  v_scope_changed boolean;
  v_reset_review boolean := false;
  v_changed_fields text[];
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload -> 'request') is distinct from 'object' then
    raise exception 'The edit payload must contain request information' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_payload) key
             where key not in ('property', 'request', 'contacts', 'items')) then
    raise exception 'Source, identity and workflow fields cannot be edited through intake' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_payload -> 'request') key
             where key not in ('reportedOn', 'reportedOnSource', 'priority', 'serviceKind',
               'workCategory', 'serviceTask', 'estimatedDurationMinutes', 'crewSize', 'internalNotes')) then
    raise exception 'The request contains unsupported edit fields' using errcode = '22023';
  end if;

  select * into v_existing from valtrim.service_requests where id = p_request_id for update;
  if not found then
    raise exception 'The Customer Service request was not found' using errcode = 'P0002';
  end if;
  if p_expected_updated_at is null or v_existing.updated_at is distinct from p_expected_updated_at then
    raise exception 'This request changed after you opened it. Close the editor, reload requests and review the latest version before saving.'
      using errcode = '40001';
  end if;
  if v_existing.status = 'CLOSED' then
    raise exception 'A closed request cannot be edited through intake' using errcode = '55000';
  end if;
  select * into strict v_existing_property from valtrim.service_properties
    where id = v_existing.property_id for update;
  select value into strict v_before
    from valtrim.read_customer_service_request_intakes(p_request_id) records(value);

  v_request := p_payload -> 'request';
  v_completed := v_existing.workflow_stage = 'COMPLETED' or v_existing.status = 'COMPLETED';
  v_locked := v_completed or v_existing.workflow_stage in ('AWAITING_CUSTOMER', 'CONFIRMED', 'WORKING')
    or exists (select 1 from valtrim.service_appointments
               where request_id = p_request_id and is_current and state <> 'CANCELLED');
  v_admin_only := not (p_payload ?| array['property', 'contacts', 'items'])
    and not exists (select 1 from jsonb_object_keys(v_request) key
                    where key not in ('priority', 'internalNotes'));

  if v_locked and not v_admin_only then
    raise exception 'Only priority and internal notes can be edited after a proposal is sent or a visit is scheduled'
      using errcode = '55000';
  end if;
  if not v_locked and v_existing.workflow_stage not in ('NEEDS_REVIEW', 'READY_TO_PROPOSE') then
    raise exception 'This workflow stage cannot be edited through intake' using errcode = '55000';
  end if;
  if v_completed and v_request ? 'priority' then
    raise exception 'Only internal notes can be edited on a completed request' using errcode = '55000';
  end if;

  if v_admin_only then
    v_priority := v_existing.priority;
    if v_request ? 'priority' then
      begin
        v_priority := upper(btrim(v_request ->> 'priority'))::valtrim.service_priority;
      exception when invalid_text_representation then
        raise exception 'Priority is invalid' using errcode = '22023';
      end;
      if v_priority is null then
        raise exception 'Priority is required' using errcode = '22023';
      end if;
    end if;
    v_internal_notes := case when v_request ? 'internalNotes'
      then nullif(btrim(v_request ->> 'internalNotes'), '') else v_existing.internal_notes end;
    if char_length(v_internal_notes) > 2000 then
      raise exception 'Internal notes must contain 2000 characters or fewer' using errcode = '22023';
    end if;
    if row(v_priority, v_internal_notes) is not distinct from
       row(v_existing.priority, v_existing.internal_notes) then
      return v_before;
    end if;
    update valtrim.service_requests set priority = v_priority, internal_notes = v_internal_notes,
      updated_by = v_actor_id where id = p_request_id;
  else
    v_property := p_payload -> 'property';
    v_request := p_payload -> 'request';
    v_contacts := p_payload -> 'contacts';
    v_items := p_payload -> 'items';

    if v_property is null or jsonb_typeof(v_property) <> 'object' then
      raise exception 'Property information is required'
        using errcode = '22023';
    end if;
    if v_request is null or jsonb_typeof(v_request) <> 'object' then
      raise exception 'Request information is required'
        using errcode = '22023';
    end if;
    if v_contacts is null or jsonb_typeof(v_contacts) <> 'array'
       or jsonb_array_length(v_contacts) < 1
       or jsonb_array_length(v_contacts) > 2 then
      raise exception 'Provide one primary contact and at most one additional contact'
        using errcode = '22023';
    end if;
    if v_items is null or jsonb_typeof(v_items) <> 'array'
       or jsonb_array_length(v_items) < 1
       or jsonb_array_length(v_items) > 25 then
      raise exception 'Provide between 1 and 25 work items'
        using errcode = '22023';
    end if;


    begin
      v_job_id := nullif(btrim(v_property ->> 'jobId'), '')::bigint;
    exception
      when invalid_text_representation then
        raise exception 'The selected Job identifier is invalid'
          using errcode = '22023';
    end;

    if v_job_id is null then
      raise exception 'Select a Job before saving the request'
        using errcode = '22023';
    end if;

    select
      job.id,
      job.builder_id,
      job.community,
      job.community_latitude,
      job.community_longitude
    into v_job
    from valtrim.jobs job
    join valtrim.builders builder on builder.id = job.builder_id
    where job.id = v_job_id
      and job.is_active
      and job.status = 'ACTIVE'
      and builder.is_active
    for share of job, builder;

    if not found then
      raise exception 'The selected Job is not active or does not exist'
        using errcode = '22023';
    end if;

    if v_job.community_latitude is null or v_job.community_longitude is null
       or v_job.community_latitude not between -90 and 90
       or v_job.community_longitude not between -180 and 180 then
      raise exception 'The selected Job must have valid verified coordinates' using errcode = '22023';
    end if;

    v_lot_number := nullif(btrim(v_property ->> 'lotNumber'), '');
    v_address := nullif(btrim(v_property ->> 'address'), '');

    if char_length(v_lot_number) > 40 then
      raise exception 'Lot number must contain 40 characters or fewer'
        using errcode = '22023';
    end if;
    if char_length(v_address) > 240 then
      raise exception 'Address must contain 240 characters or fewer'
        using errcode = '22023';
    end if;

    if coalesce(v_request ->> 'reportedOn', '')
       !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Reported on must use YYYY-MM-DD'
        using errcode = '22023';
    end if;

    begin
      v_reported_on := nullif(btrim(v_request ->> 'reportedOn'), '')::date;
    exception
      when invalid_datetime_format or datetime_field_overflow then
        raise exception 'Reported on must be a valid date'
          using errcode = '22023';
    end;

    if v_reported_on is null then
      raise exception 'Reported on is required'
        using errcode = '22023';
    end if;
    if v_reported_on >
       (pg_catalog.now() at time zone 'America/Los_Angeles')::date then
      raise exception 'Reported on cannot be in the future'
        using errcode = '22023';
    end if;

    begin
      v_reported_on_source := coalesce(
        nullif(upper(btrim(v_request ->> 'reportedOnSource')), ''),
        'MANUAL'
      )::valtrim.service_reported_on_source;
      v_priority := coalesce(
        nullif(upper(btrim(v_request ->> 'priority')), ''),
        'MEDIUM'
      )::valtrim.service_priority;

      if nullif(btrim(v_request ->> 'serviceKind'), '') is not null then
        v_service_kind := pg_catalog.regexp_replace(
          upper(btrim(v_request ->> 'serviceKind')),
          '[[:space:]]+',
          '_',
          'g'
        )::valtrim.service_kind;
      end if;

      if nullif(btrim(v_request ->> 'workCategory'), '') is not null then
        v_work_category := pg_catalog.regexp_replace(
          upper(btrim(v_request ->> 'workCategory')),
          '[[:space:]]+',
          '_',
          'g'
        )::valtrim.service_work_category;
      end if;

      if nullif(btrim(v_request ->> 'serviceTask'), '') is not null then
        v_service_task := pg_catalog.regexp_replace(
          upper(btrim(v_request ->> 'serviceTask')),
          '[[:space:]]+',
          '_',
          'g'
        )::valtrim.service_task;
      end if;

      if nullif(btrim(v_request ->> 'estimatedDurationMinutes'), '') is not null then
        v_estimated_duration_minutes :=
          (v_request ->> 'estimatedDurationMinutes')::integer;
      end if;

      if nullif(btrim(v_request ->> 'crewSize'), '') is not null then
        v_crew_size := (v_request ->> 'crewSize')::integer;
      end if;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'Request classification, priority, duration, or crew is invalid'
          using errcode = '22023';
    end;

    if v_estimated_duration_minutes is not null
       and v_estimated_duration_minutes not between 15 and 720 then
      raise exception 'Estimated duration must be between 15 and 720 minutes'
        using errcode = '22023';
    end if;
    if v_crew_size is not null and v_crew_size not between 1 and 10 then
      raise exception 'Crew size must be between 1 and 10'
        using errcode = '22023';
    end if;

    v_internal_notes := nullif(btrim(v_request ->> 'internalNotes'), '');
    if char_length(v_internal_notes) > 2000 then
      raise exception 'Internal notes must contain 2000 characters or fewer'
        using errcode = '22023';
    end if;

    for v_contact in
      select contact.value
      from jsonb_array_elements(v_contacts) contact(value)
    loop
      if jsonb_typeof(v_contact) <> 'object' then
        raise exception 'Every contact must be a JSON object'
          using errcode = '22023';
      end if;

      if nullif(btrim(v_contact ->> 'role'), '') is null then
        raise exception 'Contact role must be PRIMARY or ADDITIONAL'
          using errcode = '22023';
      end if;

      begin
        v_contact_role := upper(btrim(v_contact ->> 'role'))
          ::valtrim.service_request_contact_role;
      exception
        when invalid_text_representation then
          raise exception 'Contact role must be PRIMARY or ADDITIONAL'
            using errcode = '22023';
      end;

      v_contact_name := nullif(btrim(v_contact ->> 'name'), '');
      v_contact_email := nullif(lower(btrim(v_contact ->> 'email')), '');
      v_contact_phone := nullif(btrim(v_contact ->> 'phone'), '');

      if v_contact_name is null or char_length(v_contact_name) > 100 then
        raise exception 'Every contact requires a name of 100 characters or fewer'
          using errcode = '22023';
      end if;
      if v_contact_email is null and v_contact_phone is null then
        raise exception 'Every contact requires an email or phone number'
          using errcode = '22023';
      end if;
      if v_contact_email is not null and (
        char_length(v_contact_email) > 160
        or v_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      ) then
        raise exception 'Contact email is invalid'
          using errcode = '22023';
      end if;
      if v_contact_phone is not null
         and v_contact_phone !~ '^([+]1[0-9]{10}|[+]52[0-9]{10})$' then
        raise exception 'Contact phone must use +1 or +52 followed by 10 digits'
          using errcode = '22023';
      end if;

      if v_contact_role = 'PRIMARY' then
        v_primary_count := v_primary_count + 1;
        v_primary_name := v_contact_name;
        v_primary_email := v_contact_email;
        v_primary_phone := v_contact_phone;
      else
        v_additional_count := v_additional_count + 1;
      end if;
    end loop;

    if v_primary_count <> 1 or v_additional_count > 1 then
      raise exception 'Provide exactly one primary contact and at most one additional contact'
        using errcode = '22023';
    end if;

    for v_item in
      select item.value
      from jsonb_array_elements(v_items) item(value)
    loop
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'Every work item must be a JSON object'
          using errcode = '22023';
      end if;

      if (
        v_item ? 'materialRequired'
        and v_item -> 'materialRequired' <> 'null'::jsonb
        and jsonb_typeof(v_item -> 'materialRequired') <> 'boolean'
      ) or (
        v_item ? 'chargeable'
        and v_item -> 'chargeable' <> 'null'::jsonb
        and jsonb_typeof(v_item -> 'chargeable') <> 'boolean'
      ) then
        raise exception 'Work item flags must be JSON booleans'
          using errcode = '22023';
      end if;

      begin
        v_item_number := nullif(btrim(v_item ->> 'itemNumber'), '')::integer;
        v_material_required := coalesce(
          nullif(btrim(v_item ->> 'materialRequired'), '')::boolean,
          false
        );
        v_chargeable := coalesce(
          nullif(btrim(v_item ->> 'chargeable'), '')::boolean,
          false
        );
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'Work item number and flags are invalid'
            using errcode = '22023';
      end;

      if v_item_number is null or v_item_number <> v_expected_item_number then
        raise exception 'Work item numbers must be consecutive starting at 1'
          using errcode = '22023';
      end if;

      v_item_description := nullif(btrim(v_item ->> 'description'), '');
      if v_item_description is null or char_length(v_item_description) > 1000 then
        raise exception 'Every work item requires a description of 1000 characters or fewer'
          using errcode = '22023';
      end if;

      v_request_description := concat_ws(
        E'\n',
        nullif(v_request_description, ''),
        v_item_description
      );
      v_expected_item_number := v_expected_item_number + 1;
    end loop;


    -- Normalize once so comparisons and writes use the same values. Neither
    -- source metadata nor source contents are accepted in this operation.
    select coalesce(jsonb_agg(jsonb_build_object(
      'role', upper(btrim(value ->> 'role')), 'name', btrim(value ->> 'name'),
      'email', nullif(lower(btrim(value ->> 'email')), ''),
      'phone', nullif(btrim(value ->> 'phone'), '')
    ) order by upper(btrim(value ->> 'role'))), '[]'::jsonb) into v_contacts from jsonb_array_elements(v_contacts);
    select coalesce(jsonb_agg(jsonb_build_object(
      'itemNumber', (value ->> 'itemNumber')::integer, 'description', btrim(value ->> 'description'),
      'materialRequired', coalesce((value ->> 'materialRequired')::boolean, false),
      'chargeable', coalesce((value ->> 'chargeable')::boolean, false)
    ) order by (value ->> 'itemNumber')::integer), '[]'::jsonb) into v_items from jsonb_array_elements(v_items);
    select coalesce(jsonb_agg(jsonb_build_object(
      'role', role, 'name', name, 'email', email, 'phone', phone
    ) order by role::text), '[]'::jsonb) into v_old_contacts
      from valtrim.service_request_contacts where request_id = p_request_id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'itemNumber', item_number, 'description', description,
      'materialRequired', material_required, 'chargeable', chargeable
    ) order by item_number), '[]'::jsonb) into v_old_items
      from valtrim.service_request_items where request_id = p_request_id;

    v_property_changed := row(v_existing_property.job_id, v_existing_property.lot_number,
      v_existing_property.address, v_existing_property.latitude, v_existing_property.longitude)
      is distinct from row(v_job.id, v_lot_number, v_address,
        v_job.community_latitude, v_job.community_longitude);
    v_scope_changed := v_property_changed or v_items is distinct from v_old_items
      or row(v_existing.service_kind, v_existing.work_category, v_existing.service_task,
        v_existing.estimated_duration_minutes, v_existing.crew_size)
      is distinct from row(v_service_kind, v_work_category, v_service_task,
        v_estimated_duration_minutes, v_crew_size);
    v_reset_review := v_existing.workflow_stage = 'READY_TO_PROPOSE' and v_scope_changed;

    if not v_scope_changed and v_contacts is not distinct from v_old_contacts
       and row(v_existing.reported_on, v_existing.reported_on_source, v_existing.priority,
         v_existing.internal_notes, v_existing.homeowner_name, v_existing.homeowner_email::text,
         v_existing.homeowner_phone::text)
       is not distinct from row(v_reported_on, v_reported_on_source, v_priority, v_internal_notes,
         v_primary_name, v_primary_email, v_primary_phone) then
      return v_before;
    end if;

    v_property_id := v_existing.property_id;
    if v_property_changed then
      if exists (select 1 from valtrim.service_requests
                 where property_id = v_property_id and id <> p_request_id) then
        -- Legacy requests may share a property. Editing one must not relocate another.
        insert into valtrim.service_properties(job_id, lot_number, address, latitude, longitude, created_by, updated_by)
        values (v_job.id, v_lot_number, v_address, v_job.community_latitude, v_job.community_longitude, v_actor_id, v_actor_id)
        returning id into v_property_id;
      else
        update valtrim.service_properties set job_id = v_job.id, lot_number = v_lot_number,
          address = v_address, latitude = v_job.community_latitude,
          longitude = v_job.community_longitude, updated_by = v_actor_id
        where id = v_property_id;
      end if;
    end if;

    delete from valtrim.service_request_contacts where request_id = p_request_id
      and role::text not in (select value ->> 'role' from jsonb_array_elements(v_contacts));
    insert into valtrim.service_request_contacts(request_id, role, name, email, phone, created_by, updated_by)
    select p_request_id, (value ->> 'role')::valtrim.service_request_contact_role,
      value ->> 'name', (value ->> 'email')::valtrim.email_address,
      (value ->> 'phone')::valtrim.phone_number, v_actor_id, v_actor_id
    from jsonb_array_elements(v_contacts)
    on conflict (request_id, role) do update set name = excluded.name,
      email = excluded.email, phone = excluded.phone, updated_by = excluded.updated_by
    where row(service_request_contacts.name, service_request_contacts.email, service_request_contacts.phone)
      is distinct from row(excluded.name, excluded.email, excluded.phone);

    delete from valtrim.service_request_items where request_id = p_request_id
      and item_number > jsonb_array_length(v_items);
    insert into valtrim.service_request_items(request_id, item_number, description,
      material_required, chargeable, created_by, updated_by)
    select p_request_id, (value ->> 'itemNumber')::smallint, value ->> 'description',
      (value ->> 'materialRequired')::boolean, (value ->> 'chargeable')::boolean, v_actor_id, v_actor_id
    from jsonb_array_elements(v_items)
    on conflict (request_id, item_number) do update set description = excluded.description,
      material_required = excluded.material_required, chargeable = excluded.chargeable,
      updated_by = excluded.updated_by
    where row(service_request_items.description, service_request_items.material_required, service_request_items.chargeable)
      is distinct from row(excluded.description, excluded.material_required, excluded.chargeable);

    update valtrim.service_requests set property_id = v_property_id, reported_on = v_reported_on,
      reported_on_source = v_reported_on_source, priority = v_priority,
      homeowner_name = v_primary_name, homeowner_email = v_primary_email::valtrim.email_address,
      homeowner_phone = v_primary_phone::valtrim.phone_number,
      service_kind = v_service_kind, work_category = v_work_category, service_task = v_service_task,
      estimated_duration_minutes = v_estimated_duration_minutes, crew_size = v_crew_size,
      description = left(v_request_description, 2000), internal_notes = v_internal_notes,
      workflow_stage = case when v_reset_review then 'NEEDS_REVIEW'::valtrim.service_request_workflow_stage else workflow_stage end,
      reviewed_at = case when v_reset_review then null else reviewed_at end,
      reviewed_by = case when v_reset_review then null else reviewed_by end,
      valtrim_items_confirmed = case when v_reset_review then false else valtrim_items_confirmed end,
      updated_by = v_actor_id
    where id = p_request_id;
  end if;

  select value into strict v_after
    from valtrim.read_customer_service_request_intakes(p_request_id) records(value);
  select array_agg(field order by field) into v_changed_fields from (
    select 'request.' || key as field from jsonb_each(v_after -> 'request')
    where key not in ('updated_at', 'updated_by')
      and (v_before -> 'request' -> key) is distinct from value
    union all
    select 'property.' || key from jsonb_each(v_after -> 'property')
    where key not in ('id', 'created_at', 'created_by', 'updated_at', 'updated_by')
      and (v_before -> 'property' -> key) is distinct from value
    union all select 'contacts' where not v_admin_only and v_contacts is distinct from v_old_contacts
    union all select 'items' where not v_admin_only and v_items is distinct from v_old_items
  ) changes;

  -- One aggregate intake audit event supplements the existing legacy row audit.
  -- Keep contact channels, notes and the immutable source out of global audit JSON.
  insert into valtrim.audit_events(module, action, actor_type, actor_user_id,
    actor_name, actor_email, actor_role, entity_type, entity_id, entity_label, summary,
    previous_values, new_values, metadata)
  select 'CUSTOMER_SERVICE', 'SERVICE_REQUEST_INTAKE_UPDATED', 'USER', actor.id,
    actor.name, actor.email, actor.role::text, 'SERVICE_REQUEST', p_request_id::text,
    v_existing.folio, format('Customer Service request %s intake was updated.', v_existing.folio),
    jsonb_build_object('workflowStage', v_before #> '{request,workflow_stage}',
      'priority', v_before #> '{request,priority}', 'jobId', v_before #> '{property,job_id}',
      'contactCount', jsonb_array_length(v_before -> 'contacts'), 'itemCount', jsonb_array_length(v_before -> 'items')),
    jsonb_build_object('workflowStage', v_after #> '{request,workflow_stage}',
      'priority', v_after #> '{request,priority}', 'jobId', v_after #> '{property,job_id}',
      'contactCount', jsonb_array_length(v_after -> 'contacts'), 'itemCount', jsonb_array_length(v_after -> 'items')),
    jsonb_build_object('operation', 'update_customer_service_request_intake',
      'changedFields', to_jsonb(v_changed_fields), 'reviewInvalidated', v_reset_review)
  from valtrim.app_users actor where actor.id = v_actor_id;

  return v_after;
end;
$function$;

revoke all on function valtrim.update_customer_service_request_intake(bigint, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function valtrim.update_customer_service_request_intake(bigint, timestamptz, jsonb)
  to authenticated;
comment on function valtrim.update_customer_service_request_intake(bigint, timestamptz, jsonb) is
  'Atomically edits an existing request with optimistic concurrency, immutable identity/source, Job-derived coordinates, review invalidation and audit. Active ADMIN/SCHEDULING only. Scheduled requests accept administrative fields only; completed requests accept notes only.';

notify pgrst, 'reload schema';
commit;

