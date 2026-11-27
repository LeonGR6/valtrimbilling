-- Email import block 2. Local only until explicitly applied by the operator.
-- Adds a backend-only save operation, not a mailbox connector or AI worker.
begin;

alter table valtrim.service_requests
  add column email_import_id uuid unique
    references valtrim.service_request_imports(id) on delete restrict,
  alter column reported_on drop not null,
  alter column due_on drop not null,
  add constraint service_requests_import_submission_check check (
    email_import_id is null or (submission_key is not null and submission_key = email_import_id)
  ),
  add constraint service_requests_import_dates_check check (
    (reported_on is not null and due_on is not null)
    or (email_import_id is not null and workflow_stage = 'NEEDS_REVIEW'
      and reported_on is null and due_on is null)
  );

-- Missing channels/names are allowed only on contacts of imported requests
-- awaiting review. Manual requests and approval retain the complete contract.
alter table valtrim.service_request_contacts
  alter column name drop not null,
  drop constraint service_request_contacts_method_check,
  add constraint service_request_contacts_nonempty_check check (
    name is not null or email is not null or phone is not null
  );

create function private.guard_customer_service_imported_contact()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_partial boolean;
begin
  select request.email_import_id is not null and request.workflow_stage = 'NEEDS_REVIEW' and request.closed_at is null
  into v_partial from valtrim.service_requests request where request.id = new.request_id for share;
  if not coalesce(v_partial, false) and (nullif(btrim(new.name), '') is null
    or (new.email is null and new.phone is null)) then
    raise exception 'Every contact requires a name and an email or phone number'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_customer_service_imported_contact()
  from public, anon, authenticated, service_role;
create trigger service_request_contacts_import_completeness
before insert or update on valtrim.service_request_contacts
for each row execute function private.guard_customer_service_imported_contact();

create function private.guard_customer_service_request_import_link()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if new.email_import_id is distinct from old.email_import_id
     or (old.email_import_id is not null and new.submission_key is distinct from old.submission_key) then
    raise exception 'A request import link and its submission key cannot be replaced' using errcode = '22023';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_customer_service_request_import_link()
  from public, anon, authenticated, service_role;
create trigger service_requests_guard_import_link
before update on valtrim.service_requests
for each row execute function private.guard_customer_service_request_import_link();

-- Shared only by the automatic save and the human edit of an imported request
-- still in NEEDS_REVIEW. It does not relax the manual create/update validators.
create function private.normalize_customer_service_import_intake(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_property jsonb;
  v_request jsonb;
  v_contacts jsonb;
  v_items jsonb;
  v_contact jsonb;
  v_item jsonb;
  v_normal_contacts jsonb := '[]';
  v_normal_items jsonb := '[]';
  v_primary_count integer := 0;
  v_additional_count integer := 0;
  v_position integer := 0;
  v_role text;
  v_name text;
  v_email text;
  v_phone text;
  v_job_id bigint;
  v_latitude numeric;
  v_longitude numeric;
  v_reported_on date;
  v_reported_source valtrim.service_reported_on_source;
  v_priority valtrim.service_priority;
  v_kind valtrim.service_kind;
  v_category valtrim.service_work_category;
  v_task valtrim.service_task;
  v_duration integer;
  v_crew integer;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or exists (select 1 from jsonb_object_keys(p_payload) key
      where key not in ('property','request','contacts','items')) then
    raise exception 'Import intake must contain only property, request, contacts and items' using errcode = '22023';
  end if;
  v_property := coalesce(p_payload -> 'property', '{}'::jsonb);
  v_request := coalesce(p_payload -> 'request', '{}'::jsonb);
  v_contacts := p_payload -> 'contacts';
  v_items := p_payload -> 'items';
  if jsonb_typeof(v_property) <> 'object' or jsonb_typeof(v_request) <> 'object' then
    raise exception 'Property and request information must be objects' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(v_property) key
    where key not in ('jobId','lotNumber','address','latitude','longitude'))
    or exists (select 1 from jsonb_object_keys(v_request) key
    where key not in ('reportedOn','reportedOnSource','priority','serviceKind','workCategory',
      'serviceTask','estimatedDurationMinutes','crewSize','internalNotes')) then
    raise exception 'Import intake contains unsupported property or request fields' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(v_property) field where field.value <> 'null'::jsonb
    and ((field.key in ('lotNumber','address') and jsonb_typeof(field.value) <> 'string')
      or (field.key in ('jobId','latitude','longitude') and jsonb_typeof(field.value) not in ('string','number'))))
    or exists (select 1 from jsonb_each(v_request) field where field.value <> 'null'::jsonb
      and ((field.key in ('estimatedDurationMinutes','crewSize') and jsonb_typeof(field.value) not in ('string','number'))
        or (field.key not in ('estimatedDurationMinutes','crewSize') and jsonb_typeof(field.value) <> 'string'))) then
    raise exception 'Import intake fields have invalid types' using errcode = '22023';
  end if;
  if v_contacts is null or jsonb_typeof(v_contacts) <> 'array'
    or jsonb_array_length(v_contacts) not between 1 and 2 then
    raise exception 'Provide one primary contact and at most one additional contact' using errcode = '22023';
  end if;
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) not between 1 and 25 then
    raise exception 'Provide between 1 and 25 described work items' using errcode = '22023';
  end if;

  for v_contact in select value from jsonb_array_elements(v_contacts) loop
    if jsonb_typeof(v_contact) <> 'object' then
      raise exception 'Contact information must be an object' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_each(v_contact) field where field.key not in ('role','name','email','phone')
      or (field.value <> 'null'::jsonb and jsonb_typeof(field.value) <> 'string')) then
      raise exception 'Contact information contains unsupported fields or types' using errcode = '22023';
    end if;
    v_role := upper(btrim(v_contact ->> 'role'));
    v_name := nullif(btrim(v_contact ->> 'name'), '');
    v_email := lower(nullif(btrim(v_contact ->> 'email'), ''));
    v_phone := nullif(btrim(v_contact ->> 'phone'), '');
    if v_role = 'PRIMARY' then
      v_primary_count := v_primary_count + 1;
      if v_name is null then
        raise exception 'The homeowner name is required for an imported request' using errcode = '22023';
      end if;
    elsif v_role = 'ADDITIONAL' then
      v_additional_count := v_additional_count + 1;
    else
      raise exception 'Contact role must be PRIMARY or ADDITIONAL' using errcode = '22023';
    end if;
    if char_length(v_name) > 100 then
      raise exception 'Contact name must contain 100 characters or fewer' using errcode = '22023';
    end if;
    if v_email is not null and (char_length(v_email) > 160
      or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') then
      raise exception 'Contact email is invalid' using errcode = '22023';
    end if;
    if v_phone is not null and v_phone !~ '^([+]1[0-9]{10}|[+]52[0-9]{10})$' then
      raise exception 'Contact phone must use +1 or +52 followed by 10 digits' using errcode = '22023';
    end if;
    if v_name is not null or v_email is not null or v_phone is not null then
      v_normal_contacts := v_normal_contacts || jsonb_build_array(jsonb_build_object(
        'role',v_role,'name',v_name,'email',v_email,'phone',v_phone));
    end if;
  end loop;
  if v_primary_count <> 1 or v_additional_count > 1 then
    raise exception 'Provide exactly one primary contact and at most one additional contact' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(v_items) loop
    v_position := v_position + 1;
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Work item information must be an object' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_each(v_item) field where field.key not in
      ('itemNumber','description','materialRequired','chargeable'))
      or jsonb_typeof(v_item -> 'description') is distinct from 'string'
      or nullif(btrim(v_item ->> 'description'), '') is null
      or char_length(btrim(v_item ->> 'description')) > 1000 then
      raise exception 'Every work item requires a description of 1000 characters or fewer' using errcode = '22023';
    end if;
    if v_item ? 'itemNumber' and (v_item ->> 'itemNumber') is distinct from v_position::text then
      raise exception 'Work item numbers must be consecutive' using errcode = '22023';
    end if;
    if (v_item ? 'materialRequired' and jsonb_typeof(v_item -> 'materialRequired') <> 'boolean')
      or (v_item ? 'chargeable' and jsonb_typeof(v_item -> 'chargeable') <> 'boolean') then
      raise exception 'Work item flags must be booleans' using errcode = '22023';
    end if;
    v_normal_items := v_normal_items || jsonb_build_array(jsonb_build_object(
      'itemNumber',v_position,'description',btrim(v_item ->> 'description'),
      'materialRequired',coalesce((v_item ->> 'materialRequired')::boolean,false),
      'chargeable',coalesce((v_item ->> 'chargeable')::boolean,false)));
  end loop;

  begin
    v_job_id := nullif(btrim(v_property ->> 'jobId'), '')::bigint;
    v_latitude := nullif(btrim(v_property ->> 'latitude'), '')::numeric;
    v_longitude := nullif(btrim(v_property ->> 'longitude'), '')::numeric;
    v_duration := nullif(btrim(v_request ->> 'estimatedDurationMinutes'), '')::integer;
    v_crew := nullif(btrim(v_request ->> 'crewSize'), '')::integer;
    v_priority := coalesce(nullif(upper(btrim(v_request ->> 'priority')),''),'MEDIUM')::valtrim.service_priority;
    v_reported_source := coalesce(nullif(upper(btrim(v_request ->> 'reportedOnSource')),''),'MANUAL')::valtrim.service_reported_on_source;
    v_kind := nullif(regexp_replace(upper(btrim(v_request ->> 'serviceKind')),'[[:space:]]+','_','g'),'')::valtrim.service_kind;
    v_category := nullif(regexp_replace(upper(btrim(v_request ->> 'workCategory')),'[[:space:]]+','_','g'),'')::valtrim.service_work_category;
    v_task := nullif(regexp_replace(upper(btrim(v_request ->> 'serviceTask')),'[[:space:]]+','_','g'),'')::valtrim.service_task;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Job, coordinates, classification, duration or crew is invalid' using errcode = '22023';
  end;
  if (v_latitude is null) <> (v_longitude is null)
    or v_latitude not between -90 and 90 or v_longitude not between -180 and 180
    or (v_job_id is not null and v_job_id < 1) then
    raise exception 'Job or coordinates are invalid' using errcode = '22023';
  end if;
  if v_job_id is not null then
    select job.community_latitude, job.community_longitude into v_latitude,v_longitude
    from valtrim.jobs job join valtrim.builders builder on builder.id = job.builder_id
    where job.id = v_job_id and job.is_active and job.status = 'ACTIVE' and builder.is_active
    for share of job,builder;
    if not found then
      raise exception 'The selected Job is not active or does not exist' using errcode = '22023';
    end if;
    if v_latitude is null or v_longitude is null or v_latitude not between -90 and 90
      or v_longitude not between -180 and 180 then
      raise exception 'The selected Job must have valid verified coordinates' using errcode = '22023';
    end if;
  end if;
  if nullif(btrim(v_request ->> 'reportedOn'),'') is not null then
    if (v_request ->> 'reportedOn') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Reported on must use YYYY-MM-DD' using errcode = '22023';
    end if;
    begin
      v_reported_on := (v_request ->> 'reportedOn')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Reported on must be a valid date' using errcode = '22023';
    end;
    if v_reported_on > (now() at time zone 'America/Los_Angeles')::date then
      raise exception 'Reported on cannot be in the future' using errcode = '22023';
    end if;
  end if;
  if char_length(nullif(btrim(v_property ->> 'lotNumber'),'')) > 40
    or char_length(nullif(btrim(v_property ->> 'address'),'')) > 240
    or char_length(nullif(btrim(v_request ->> 'internalNotes'),'')) > 2000 then
    raise exception 'Lot, address or internal notes exceeds its allowed length' using errcode = '22023';
  end if;
  if v_duration not between 15 and 720 or v_crew not between 1 and 10 then
    raise exception 'Duration must be 15 to 720 minutes and crew must be 1 to 10 when provided' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'property',jsonb_build_object('jobId',v_job_id,'lotNumber',nullif(btrim(v_property ->> 'lotNumber'),''),
      'address',nullif(btrim(v_property ->> 'address'),''),'latitude',v_latitude,'longitude',v_longitude),
    'request',jsonb_build_object('reportedOn',v_reported_on,'reportedOnSource',v_reported_source,
      'priority',v_priority,'serviceKind',v_kind,'workCategory',v_category,'serviceTask',v_task,
      'estimatedDurationMinutes',v_duration,'crewSize',v_crew,'internalNotes',nullif(btrim(v_request ->> 'internalNotes'),'')),
    'contacts',(select jsonb_agg(value order by value ->> 'role') from jsonb_array_elements(v_normal_contacts)),
    'items',v_normal_items);
end;
$function$;
revoke all on function private.normalize_customer_service_import_intake(jsonb)
  from public, anon, authenticated, service_role;

create function private.write_customer_service_import_intake(
  p_import_id uuid, p_data jsonb, p_request_id bigint default null, p_actor_id uuid default null
)
returns bigint language plpgsql security definer set search_path = '' as $function$
declare
  v_existing valtrim.service_requests%rowtype;
  v_existing_property valtrim.service_properties%rowtype;
  v_property jsonb := p_data -> 'property';
  v_request jsonb := p_data -> 'request';
  v_primary jsonb;
  v_property_id bigint;
  v_request_id bigint := p_request_id;
  v_description text;
  v_current jsonb;
begin
  select value into strict v_primary from jsonb_array_elements(p_data -> 'contacts')
    where value ->> 'role' = 'PRIMARY';
  select left(string_agg(value ->> 'description', E'\n' order by (value ->> 'itemNumber')::integer),2000)
    into v_description from jsonb_array_elements(p_data -> 'items');

  if p_request_id is not null then
    select * into strict v_existing from valtrim.service_requests where id = p_request_id for update;
    if v_existing.email_import_id is distinct from p_import_id or v_existing.workflow_stage <> 'NEEDS_REVIEW'
      or v_existing.closed_at is not null then
      raise exception 'Only the same imported request awaiting review can be updated' using errcode = '55000';
    end if;
    select * into strict v_existing_property from valtrim.service_properties
      where id = v_existing.property_id for update;
    select jsonb_build_object(
      'property',jsonb_build_object('jobId',v_existing_property.job_id,'lotNumber',v_existing_property.lot_number,
        'address',v_existing_property.address,'latitude',v_existing_property.latitude,'longitude',v_existing_property.longitude),
      'request',jsonb_build_object('reportedOn',v_existing.reported_on,'reportedOnSource',v_existing.reported_on_source,
        'priority',v_existing.priority,'serviceKind',v_existing.service_kind,'workCategory',v_existing.work_category,
        'serviceTask',v_existing.service_task,'estimatedDurationMinutes',v_existing.estimated_duration_minutes,
        'crewSize',v_existing.crew_size,'internalNotes',v_existing.internal_notes),
      'contacts',(select jsonb_agg(jsonb_build_object('role',role,'name',name,'email',email,'phone',phone) order by role::text)
        from valtrim.service_request_contacts where request_id = p_request_id),
      'items',(select jsonb_agg(jsonb_build_object('itemNumber',item_number,'description',description,
        'materialRequired',material_required,'chargeable',chargeable) order by item_number)
        from valtrim.service_request_items where request_id = p_request_id)) into v_current;
    if v_current = p_data then return p_request_id; end if;
    v_property_id := v_existing.property_id;
  end if;

  if p_request_id is null or (v_current -> 'property') is distinct from v_property then
    if p_request_id is null or exists (select 1 from valtrim.service_requests
      where property_id = v_property_id and id <> p_request_id) then
      insert into valtrim.service_properties(job_id,lot_number,address,latitude,longitude,created_by,updated_by)
      values ((v_property ->> 'jobId')::bigint,v_property ->> 'lotNumber',v_property ->> 'address',
        (v_property ->> 'latitude')::numeric,(v_property ->> 'longitude')::numeric,p_actor_id,p_actor_id)
      returning id into v_property_id;
    else
      update valtrim.service_properties set job_id = (v_property ->> 'jobId')::bigint,
        lot_number = v_property ->> 'lotNumber',address = v_property ->> 'address',
        latitude = (v_property ->> 'latitude')::numeric,longitude = (v_property ->> 'longitude')::numeric,
        updated_by = p_actor_id where id = v_property_id;
    end if;
  end if;

  if p_request_id is null then
    insert into valtrim.service_requests(property_id,email_import_id,submission_key,
      reported_on,reported_on_source,priority,homeowner_name,homeowner_email,homeowner_phone,
      service_kind,work_category,service_task,estimated_duration_minutes,crew_size,
      description,internal_notes,workflow_stage,reviewed_at,reviewed_by,valtrim_items_confirmed,created_by,updated_by)
    values (v_property_id,p_import_id,p_import_id,(v_request ->> 'reportedOn')::date,
      (v_request ->> 'reportedOnSource')::valtrim.service_reported_on_source,
      (v_request ->> 'priority')::valtrim.service_priority,v_primary ->> 'name',
      (v_primary ->> 'email')::valtrim.email_address,(v_primary ->> 'phone')::valtrim.phone_number,
      (v_request ->> 'serviceKind')::valtrim.service_kind,(v_request ->> 'workCategory')::valtrim.service_work_category,
      (v_request ->> 'serviceTask')::valtrim.service_task,(v_request ->> 'estimatedDurationMinutes')::integer,
      (v_request ->> 'crewSize')::integer,v_description,v_request ->> 'internalNotes',
      'NEEDS_REVIEW',null,null,false,p_actor_id,p_actor_id) returning id into v_request_id;
  else
    update valtrim.service_requests set property_id = v_property_id,
      reported_on = (v_request ->> 'reportedOn')::date,
      reported_on_source = (v_request ->> 'reportedOnSource')::valtrim.service_reported_on_source,
      priority = (v_request ->> 'priority')::valtrim.service_priority,
      homeowner_name = v_primary ->> 'name',homeowner_email = (v_primary ->> 'email')::valtrim.email_address,
      homeowner_phone = (v_primary ->> 'phone')::valtrim.phone_number,
      service_kind = (v_request ->> 'serviceKind')::valtrim.service_kind,
      work_category = (v_request ->> 'workCategory')::valtrim.service_work_category,
      service_task = (v_request ->> 'serviceTask')::valtrim.service_task,
      estimated_duration_minutes = (v_request ->> 'estimatedDurationMinutes')::integer,
      crew_size = (v_request ->> 'crewSize')::integer,description = v_description,
      internal_notes = v_request ->> 'internalNotes',reviewed_at = null,reviewed_by = null,
      valtrim_items_confirmed = false,updated_by = p_actor_id where id = p_request_id;
  end if;

  delete from valtrim.service_request_contacts where request_id = v_request_id
    and role::text not in (select value ->> 'role' from jsonb_array_elements(p_data -> 'contacts'));
  insert into valtrim.service_request_contacts(request_id,role,name,email,phone,created_by,updated_by)
  select v_request_id,(value ->> 'role')::valtrim.service_request_contact_role,value ->> 'name',
    (value ->> 'email')::valtrim.email_address,(value ->> 'phone')::valtrim.phone_number,p_actor_id,p_actor_id
  from jsonb_array_elements(p_data -> 'contacts')
  on conflict (request_id,role) do update set name = excluded.name,email = excluded.email,
    phone = excluded.phone,updated_by = excluded.updated_by
  where row(service_request_contacts.name,service_request_contacts.email,service_request_contacts.phone)
    is distinct from row(excluded.name,excluded.email,excluded.phone);

  delete from valtrim.service_request_items where request_id = v_request_id
    and item_number > jsonb_array_length(p_data -> 'items');
  insert into valtrim.service_request_items(request_id,item_number,description,material_required,chargeable,created_by,updated_by)
  select v_request_id,(value ->> 'itemNumber')::smallint,value ->> 'description',
    (value ->> 'materialRequired')::boolean,(value ->> 'chargeable')::boolean,p_actor_id,p_actor_id
  from jsonb_array_elements(p_data -> 'items')
  on conflict (request_id,item_number) do update set description = excluded.description,
    material_required = excluded.material_required,chargeable = excluded.chargeable,updated_by = excluded.updated_by
  where row(service_request_items.description,service_request_items.material_required,service_request_items.chargeable)
    is distinct from row(excluded.description,excluded.material_required,excluded.chargeable);
  return v_request_id;
end;
$function$;
revoke all on function private.write_customer_service_import_intake(uuid,jsonb,bigint,uuid)
  from public, anon, authenticated, service_role;

create function valtrim.save_customer_service_imported_request(p_import_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_import valtrim.service_request_imports%rowtype;
  v_data jsonb;
  v_request_id bigint;
  v_error text;
begin
  -- This endpoint is for a backend with its own credentials, never a forged
  -- coordinator session. Existing actor/audit triggers record SYSTEM naturally.
  if (select auth.uid()) is not null then
    raise exception 'Automatic import requires a system context without a user identity' using errcode = '42501';
  end if;
  if p_import_id is null then
    raise exception 'Import identity is required' using errcode = '22023';
  end if;
  select * into v_import from valtrim.service_request_imports where id = p_import_id for update;
  if not found then raise exception 'Email import not found' using errcode = 'P0002'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_import_id::text,0));
  if v_import.request_id is not null then
    if not exists (select 1 from valtrim.service_requests
      where id = v_import.request_id and email_import_id = p_import_id and submission_key = p_import_id) then
      raise exception 'The import is linked to a different request origin; manual reconciliation is required'
        using errcode = '55000';
    end if;
    return (select jsonb_build_object('importId',p_import_id,'requestId',request.id,
      'folio',request.folio,'status',v_import.status,'idempotentReplay',true)
      from valtrim.service_requests request where request.id = v_import.request_id);
  end if;
  if exists (select 1 from valtrim.service_requests where submission_key = p_import_id) then
    raise exception 'This import key is already used by another request' using errcode = '23505';
  end if;

  begin
    v_data := private.normalize_customer_service_import_intake(p_payload);
    v_request_id := private.write_customer_service_import_intake(p_import_id,v_data);
    update valtrim.service_request_imports set request_id = v_request_id,status = 'PROCESSED',
      processed_at = clock_timestamp(),error_code = null,error_message = null,extraction_payload = p_payload
      where id = p_import_id;
  exception when sqlstate '22023' or check_violation then
    -- The subtransaction rolls back property/request/children before retaining
    -- the failure. Returning a problem is intentional: raising would lose it.
    v_error := sqlerrm;
    update valtrim.service_request_imports set status = 'NEEDS_ATTENTION',processed_at = null,
      error_code = 'INVALID_REQUEST_DATA',error_message = v_error,
      extraction_payload = case when jsonb_typeof(p_payload) = 'object' then p_payload else null end
      where id = p_import_id;
    return jsonb_build_object('importId',p_import_id,'requestId',null,'status','NEEDS_ATTENTION',
      'errorCode','INVALID_REQUEST_DATA','errorMessage',v_error,'idempotentReplay',false);
  end;
  return (select jsonb_build_object('importId',p_import_id,'requestId',request.id,
    'folio',request.folio,'status','PROCESSED','idempotentReplay',false)
    from valtrim.service_requests request where request.id = v_request_id);
end;
$function$;
revoke all on function valtrim.save_customer_service_imported_request(uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function valtrim.save_customer_service_imported_request(uuid,jsonb) to service_role;

-- Preserve the deployed standard editor verbatim as a private implementation.
-- Only the new imported/NEEDS_REVIEW branch uses the partial-intake validator.
alter function valtrim.update_customer_service_request_intake(bigint,timestamptz,jsonb) set schema private;
revoke all on function private.update_customer_service_request_intake(bigint,timestamptz,jsonb)
  from public, anon, authenticated, service_role;

create function valtrim.update_customer_service_request_intake(
  p_request_id bigint,p_expected_updated_at timestamptz,p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_actor_id uuid := private.require_customer_service_actor();
  v_existing valtrim.service_requests%rowtype;
  v_data jsonb;
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_existing from valtrim.service_requests where id = p_request_id for update;
  -- The standard implementation retains its original errors, permission checks,
  -- exact version check, source whitelist and post-proposal editing rules.
  if not found or v_existing.email_import_id is null or v_existing.workflow_stage <> 'NEEDS_REVIEW'
    or v_existing.closed_at is not null
    or exists (select 1 from valtrim.service_appointments where request_id = p_request_id and is_current and state <> 'CANCELLED')
    or (jsonb_typeof(p_payload) = 'object' and not (p_payload ?| array['property','contacts','items'])) then
    return private.update_customer_service_request_intake(p_request_id,p_expected_updated_at,p_payload);
  end if;
  if p_expected_updated_at is null or v_existing.updated_at is distinct from p_expected_updated_at then
    raise exception 'This request changed after you opened it. Close the editor, reload requests and review the latest version before saving.'
      using errcode = '40001';
  end if;
  v_data := private.normalize_customer_service_import_intake(p_payload);
  select value into strict v_before from valtrim.read_customer_service_request_intakes(p_request_id) records(value);
  perform private.write_customer_service_import_intake(v_existing.email_import_id,v_data,p_request_id,v_actor_id);
  select value into strict v_after from valtrim.read_customer_service_request_intakes(p_request_id) records(value);
  if v_before = v_after then return v_after; end if;
  insert into valtrim.audit_events(module,action,actor_type,actor_user_id,actor_name,actor_email,
    actor_role,entity_type,entity_id,entity_label,summary,previous_values,new_values,metadata)
  select 'CUSTOMER_SERVICE','SERVICE_REQUEST_INTAKE_UPDATED','USER',actor.id,actor.name,actor.email,
    actor.role::text,'SERVICE_REQUEST',p_request_id::text,v_existing.folio,
    format('Imported Customer Service request %s intake was updated.',v_existing.folio),
    jsonb_build_object('workflowStage',v_before #> '{request,workflow_stage}',
      'jobId',v_before #> '{property,job_id}','contactCount',jsonb_array_length(v_before -> 'contacts'),
      'itemCount',jsonb_array_length(v_before -> 'items')),
    jsonb_build_object('workflowStage',v_after #> '{request,workflow_stage}',
      'jobId',v_after #> '{property,job_id}','contactCount',jsonb_array_length(v_after -> 'contacts'),
      'itemCount',jsonb_array_length(v_after -> 'items')),
    jsonb_build_object('operation','update_customer_service_request_intake','importId',v_existing.email_import_id,
      'reviewInvalidated',false)
  from valtrim.app_users actor where actor.id = v_actor_id;
  return v_after;
end;
$function$;
revoke all on function valtrim.update_customer_service_request_intake(bigint,timestamptz,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function valtrim.update_customer_service_request_intake(bigint,timestamptz,jsonb) to authenticated;

create or replace function valtrim.read_customer_service_request_intakes(p_request_id bigint default null)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $function$
begin
  perform private.require_customer_service_actor();
  return query
  select jsonb_build_object(
    'request',to_jsonb(request),'property',to_jsonb(property),
    'builderName',coalesce(builder.name,legacy_builder.name),
    'community',coalesce(job.community,community.name),'jobCode',job.code,
    'coordinatorName',coordinator.name,'reviewerName',reviewer.name,
    'contacts',coalesce((select jsonb_agg(to_jsonb(contact) order by contact.role)
      from valtrim.service_request_contacts contact where contact.request_id = request.id),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(to_jsonb(item) order by item.item_number)
      from valtrim.service_request_items item where item.request_id = request.id),'[]'::jsonb),
    'source',(select to_jsonb(source) || jsonb_build_object('file',(
      select jsonb_build_object('id',file.id,'bucket_id',file.bucket_id,'object_path',file.object_path,
        'original_filename',file.original_filename,'mime_type',file.mime_type,'size_bytes',file.size_bytes,
        'sha256',btrim(file.sha256)) from valtrim.stored_files file where file.id = source.file_id))
      from valtrim.service_request_sources source where source.request_id = request.id),
    'emailImport',case when receipt.id is null then null else jsonb_build_object(
      'id',receipt.id,'status',receipt.status,'source_payload',receipt.source_payload,
      'extraction_payload',receipt.extraction_payload,'attachment_refs',receipt.attachment_refs) end,
    'workflowHistory',coalesce((select jsonb_agg(to_jsonb(history) order by history.changed_at,history.id)
      from valtrim.service_request_workflow_history history where history.request_id = request.id),'[]'::jsonb))
  from valtrim.service_requests request
  join valtrim.service_properties property on property.id = request.property_id
  left join valtrim.jobs job on job.id = property.job_id
  left join valtrim.builders builder on builder.id = job.builder_id
  left join valtrim.communities community on community.id = property.community_id
  left join valtrim.builders legacy_builder on legacy_builder.id = community.builder_id
  left join valtrim.app_users coordinator on coordinator.id = request.coordinator_user_id
  left join valtrim.app_users reviewer on reviewer.id = request.reviewed_by
  left join valtrim.service_request_imports receipt on receipt.id = request.email_import_id
  where p_request_id is null or request.id = p_request_id
  order by request.created_at desc,request.id desc;
end;
$function$;

comment on column valtrim.service_requests.email_import_id is
  'Immutable origin of an imported request. Its UUID is also the stable submission key. Manual requests keep NULL.';
comment on function valtrim.save_customer_service_imported_request(uuid,jsonb) is
  'Backend-only structured intake save. Creates and links one NEEDS_REVIEW request atomically, or retains invalid data as NEEDS_ATTENTION. Replays never replace a request or human edits. No AI, files, mailbox connection or approval.';
comment on function private.update_customer_service_request_intake(bigint,timestamptz,jsonb) is
  'Unchanged standard intake editor retained privately; invoked by the public editor for manual requests, administrative edits and later workflow stages.';
comment on function valtrim.update_customer_service_request_intake(bigint,timestamptz,jsonb) is
  'Human intake editor. Imported NEEDS_REVIEW requests permit missing fields but not invalid values; manual and post-review rules are unchanged. Exact version and active ADMIN/SCHEDULING required.';

notify pgrst, 'reload schema';
commit;
