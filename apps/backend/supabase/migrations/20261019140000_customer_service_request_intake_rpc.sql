-- Transactional Customer Service New Request intake.
--
-- The browser supplies one idempotency key and one structured payload. The
-- database remains authoritative for the Job, Community coordinates, folio,
-- due date, workflow stage, audit actor, and creation timestamps.

begin;

-- A PDF may be attached to an email. Preserve the original email body while
-- the PDF itself remains pending for the private Storage step.
alter table valtrim.service_request_sources
  drop constraint service_request_sources_input_check,
  add constraint service_request_sources_input_check
    check (
      (
        source_type = 'EMAIL_TEXT'
        and email_text is not null
        and btrim(email_text) <> ''
        and file_id is null
        and file_status = 'NOT_APPLICABLE'
        and file_error is null
      )
      or
      (
        source_type = 'PDF'
        and (
          (
            file_status = 'PENDING'
            and file_id is null
            and file_error is null
          )
          or
          (
            file_status = 'AVAILABLE'
            and file_id is not null
            and file_error is null
          )
          or
          (
            file_status = 'FAILED'
            and file_id is null
            and file_error is not null
            and btrim(file_error) <> ''
          )
        )
      )
    );

create function private.create_customer_service_request_intake_internal(
  p_submission_key uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_customer_service_actor();
  v_property jsonb;
  v_request jsonb;
  v_contacts jsonb;
  v_items jsonb;
  v_source jsonb;
  v_contact jsonb;
  v_item jsonb;
  v_existing_request record;
  v_job record;
  v_job_id bigint;
  v_property_id bigint;
  v_request_id bigint;
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
  v_source_type valtrim.service_request_source_type;
  v_sender_email text;
  v_subject text;
  v_email_text text;
  v_extracted_text text;
  v_extraction_payload jsonb;
  v_extraction_model text;
  v_extracted_at timestamptz;
  v_review_notes text[] := '{}'::text[];
begin
  if p_submission_key is null then
    raise exception 'A submission key is required'
      using errcode = '22023';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'The New Request payload must be a JSON object'
      using errcode = '22023';
  end if;

  -- Serialize concurrent retries for the same client-generated key. A replay
  -- returns the original server result without allocating another Property,
  -- Request, folio, contact, item, or source row.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_submission_key::text, 0)
  );

  select
    request.id,
    request.folio,
    request.due_on,
    request.workflow_stage,
    request.created_at
  into v_existing_request
  from valtrim.service_requests request
  where request.submission_key = p_submission_key;

  if found then
    return jsonb_build_object(
      'requestId', v_existing_request.id,
      'folio', v_existing_request.folio,
      'dueOn', v_existing_request.due_on,
      'workflowStage', v_existing_request.workflow_stage,
      'createdAt', v_existing_request.created_at,
      'idempotentReplay', true
    );
  end if;

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

  if p_payload ? 'source' and p_payload -> 'source' <> 'null'::jsonb then
    v_source := p_payload -> 'source';
    if jsonb_typeof(v_source) <> 'object' then
      raise exception 'Source information must be a JSON object or null'
        using errcode = '22023';
    end if;
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
    and builder.is_active;

  if not found then
    raise exception 'The selected Job is not active or does not exist'
      using errcode = '22023';
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

  if v_source is not null then
    if nullif(btrim(v_source ->> 'sourceType'), '') is null then
      raise exception 'Source type must be PDF or EMAIL_TEXT'
        using errcode = '22023';
    end if;

    begin
      v_source_type := upper(btrim(v_source ->> 'sourceType'))
        ::valtrim.service_request_source_type;
      if nullif(btrim(v_source ->> 'extractedAt'), '') is not null then
        v_extracted_at := (v_source ->> 'extractedAt')::timestamptz;
      end if;
    exception
      when invalid_text_representation or invalid_datetime_format
        or datetime_field_overflow then
        raise exception 'Source type or extraction timestamp is invalid'
          using errcode = '22023';
    end;

    v_sender_email := nullif(lower(btrim(v_source ->> 'senderEmail')), '');
    v_subject := nullif(btrim(v_source ->> 'subject'), '');
    v_email_text := case
      when nullif(btrim(v_source ->> 'emailText'), '') is null then null
      else v_source ->> 'emailText'
    end;
    v_extracted_text := case
      when nullif(btrim(v_source ->> 'extractedText'), '') is null then null
      else v_source ->> 'extractedText'
    end;
    v_extraction_model := nullif(btrim(v_source ->> 'extractionModel'), '');

    if v_sender_email is not null and (
      char_length(v_sender_email) > 160
      or v_sender_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    ) then
      raise exception 'Source sender email is invalid'
        using errcode = '22023';
    end if;
    if char_length(v_subject) > 250 then
      raise exception 'Source subject must contain 250 characters or fewer'
        using errcode = '22023';
    end if;
    if char_length(v_email_text) > 50000 then
      raise exception 'Source email text must contain 50000 characters or fewer'
        using errcode = '22023';
    end if;
    if v_source_type = 'EMAIL_TEXT' and v_email_text is null then
      raise exception 'Email text is required for an EMAIL_TEXT source'
        using errcode = '22023';
    end if;
    if char_length(v_extraction_model) > 120 then
      raise exception 'Extraction model must contain 120 characters or fewer'
        using errcode = '22023';
    end if;

    if v_source ? 'extractionPayload'
       and v_source -> 'extractionPayload' <> 'null'::jsonb then
      v_extraction_payload := v_source -> 'extractionPayload';
      if jsonb_typeof(v_extraction_payload) <> 'object' then
        raise exception 'Extraction payload must be a JSON object'
          using errcode = '22023';
      end if;
    end if;

    if v_source ? 'reviewNotes' then
      if jsonb_typeof(v_source -> 'reviewNotes') <> 'array'
         or exists (
           select 1
           from jsonb_array_elements(v_source -> 'reviewNotes') note(value)
           where jsonb_typeof(note.value) <> 'string'
         ) then
        raise exception 'Source review notes must be an array of strings'
          using errcode = '22023';
      end if;

      select coalesce(
        array_agg(note.value #>> '{}'),
        '{}'::text[]
      )
      into v_review_notes
      from jsonb_array_elements(v_source -> 'reviewNotes') note(value);
    end if;
  end if;

  insert into valtrim.service_properties (
    job_id,
    lot_number,
    address,
    latitude,
    longitude,
    created_by,
    updated_by
  ) values (
    v_job.id,
    v_lot_number,
    v_address,
    v_job.community_latitude,
    v_job.community_longitude,
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
    estimated_duration_minutes,
    submission_key,
    workflow_stage,
    reported_on_source,
    service_kind,
    work_category,
    service_task,
    crew_size,
    valtrim_items_confirmed
  ) values (
    v_property_id,
    v_reported_on,
    v_actor_id,
    v_actor_id,
    v_primary_name,
    v_primary_email::valtrim.email_address,
    v_primary_phone::valtrim.phone_number,
    'SERVICE_CALL',
    v_priority,
    left(v_request_description, 2000),
    v_internal_notes,
    v_actor_id,
    v_estimated_duration_minutes,
    p_submission_key,
    'NEEDS_REVIEW',
    v_reported_on_source,
    v_service_kind,
    v_work_category,
    v_service_task,
    v_crew_size,
    false
  )
  returning id into v_request_id;

  for v_contact in
    select contact.value
    from jsonb_array_elements(v_contacts) contact(value)
  loop
    insert into valtrim.service_request_contacts (
      request_id,
      role,
      name,
      email,
      phone,
      created_by,
      updated_by
    ) values (
      v_request_id,
      upper(btrim(v_contact ->> 'role'))
        ::valtrim.service_request_contact_role,
      btrim(v_contact ->> 'name'),
      nullif(lower(btrim(v_contact ->> 'email')), '')::valtrim.email_address,
      nullif(btrim(v_contact ->> 'phone'), '')::valtrim.phone_number,
      v_actor_id,
      v_actor_id
    );
  end loop;

  for v_item in
    select item.value
    from jsonb_array_elements(v_items) item(value)
  loop
    insert into valtrim.service_request_items (
      request_id,
      item_number,
      description,
      material_required,
      chargeable,
      created_by,
      updated_by
    ) values (
      v_request_id,
      (v_item ->> 'itemNumber')::smallint,
      btrim(v_item ->> 'description'),
      coalesce(nullif(btrim(v_item ->> 'materialRequired'), '')::boolean, false),
      coalesce(nullif(btrim(v_item ->> 'chargeable'), '')::boolean, false),
      v_actor_id,
      v_actor_id
    );
  end loop;

  if v_source is not null then
    insert into valtrim.service_request_sources (
      request_id,
      source_type,
      sender_email,
      subject,
      email_text,
      file_status,
      extracted_text,
      extraction_payload,
      extraction_model,
      extracted_at,
      review_notes,
      created_by,
      updated_by
    ) values (
      v_request_id,
      v_source_type,
      v_sender_email::valtrim.email_address,
      v_subject,
      v_email_text,
      case
        when v_source_type = 'PDF'
          then 'PENDING'::valtrim.service_request_source_file_status
        else 'NOT_APPLICABLE'::valtrim.service_request_source_file_status
      end,
      v_extracted_text,
      v_extraction_payload,
      v_extraction_model,
      v_extracted_at,
      v_review_notes,
      v_actor_id,
      v_actor_id
    );
  end if;

  return (
    select jsonb_build_object(
      'requestId', request.id,
      'folio', request.folio,
      'dueOn', request.due_on,
      'workflowStage', request.workflow_stage,
      'createdAt', request.created_at,
      'idempotentReplay', false
    )
    from valtrim.service_requests request
    where request.id = v_request_id
  );
end;
$function$;

revoke all on function private.create_customer_service_request_intake_internal(
  uuid,
  jsonb
) from public, anon, authenticated;

create function valtrim.create_customer_service_request_intake(
  p_submission_key uuid,
  p_payload jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select private.create_customer_service_request_intake_internal(
    p_submission_key,
    p_payload
  );
$function$;

revoke all on function valtrim.create_customer_service_request_intake(
  uuid,
  jsonb
) from public, anon, authenticated;
grant execute on function valtrim.create_customer_service_request_intake(
  uuid,
  jsonb
) to authenticated;

comment on function valtrim.create_customer_service_request_intake(uuid, jsonb) is
  'Atomically creates one Customer Service request and its Job-derived property, contacts, items, and optional source. Repeating the submission key returns the original request.';

notify pgrst, 'reload schema';

commit;
