-- Retire the five obsolete request columns and the legacy write contract.
-- No rows are deleted. Existing status history and global audit are retained.
-- Intake, review, sources and frontend-only scheduling keep their current scope.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

lock table valtrim.service_requests in access exclusive mode;

-- Never discard an unmapped old classification, status or transition note.
-- New intakes use SERVICE_CALL/NEW, no old work_type, and their real workflow_stage.
do $preflight$
begin
  if exists (select 1 from valtrim.service_requests where
    request_type <> 'SERVICE_CALL' or work_type is not null or status <> 'NEW'
    or tag <> 'NEW' or nullif(btrim(status_note), '') is not null) then
    raise exception 'Legacy request data requires an explicit mapping before removing obsolete columns; no changes were applied'
      using errcode = '55000';
  end if;
end;
$preflight$;

-- These endpoints implement the retired HW/WS + status contract. Keeping them
-- callable would bypass the current intake/review rules or reference dropped columns.
-- Scheduling, cancellation and closing are not being integrated by this cleanup.
drop function valtrim.create_customer_service_request(jsonb, jsonb, jsonb);
drop function valtrim.update_customer_service_request(bigint, jsonb, jsonb, jsonb);
drop function valtrim.close_customer_service_request(bigint, text);
drop function valtrim.reopen_customer_service_request(bigint, text);
drop function valtrim.generate_service_schedule_proposals(bigint, integer);
drop function valtrim.approve_service_schedule_proposal(bigint, jsonb, text);
drop function private.create_customer_service_request_internal(jsonb, jsonb, jsonb);
drop function private.update_customer_service_request_internal(bigint, jsonb, jsonb, jsonb);
drop function private.close_customer_service_request_internal(bigint, text);
drop function private.reopen_customer_service_request_internal(bigint, text);
drop function private.generate_service_schedule_proposals_internal(bigint, integer);
drop function private.approve_service_schedule_proposal_internal(bigint, jsonb, text);
drop function private.find_service_schedule_candidates(bigint);
drop function valtrim.replace_current_service_appointment(bigint, timestamptz, timestamptz, bigint, text, uuid);
drop function valtrim.close_service_request(bigint, text, uuid);
drop function valtrim.reopen_service_request(bigint, text, uuid);

-- The current application reads read_customer_service_request_intakes instead.
-- RESTRICT (the default) makes an unknown external dependency abort atomically.
drop view valtrim.service_request_detail;
drop view valtrim.service_request_overview;

drop trigger service_requests_normalize on valtrim.service_requests;
drop trigger service_requests_history on valtrim.service_requests;
drop trigger service_requests_supersede_proposals on valtrim.service_requests;
drop function valtrim.normalize_service_request();
drop function valtrim.record_service_status_change();

alter table valtrim.service_requests drop constraint service_requests_check;
alter table valtrim.service_requests
  drop column request_type,
  drop column work_type,
  drop column status,
  drop column tag,
  drop column status_note;

-- Preserve the existing closed-record guard independently of the removed status.
-- This does not introduce a close/reopen operation or decide its future workflow.
alter table valtrim.service_requests add constraint service_requests_closure_metadata_check
  check ((closed_at is null and close_reason is null)
    or (closed_at is not null and nullif(btrim(close_reason), '') is not null));

create or replace function private.create_customer_service_request_intake_internal(
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

create or replace function valtrim.update_customer_service_request_intake(
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
  if v_existing.closed_at is not null then
    raise exception 'A closed request cannot be edited through intake' using errcode = '55000';
  end if;
  select * into strict v_existing_property from valtrim.service_properties
    where id = v_existing.property_id for update;
  select value into strict v_before
    from valtrim.read_customer_service_request_intakes(p_request_id) records(value);

  v_request := p_payload -> 'request';
  v_completed := v_existing.workflow_stage = 'COMPLETED';
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

create or replace function valtrim.mark_customer_service_request_ready(
  p_request_id bigint,
  p_expected_updated_at timestamptz,
  p_valtrim_items_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_customer_service_actor();
  v_request valtrim.service_requests%rowtype;
  v_property valtrim.service_properties%rowtype;
  v_job record;
  v_contact record;
  v_item record;
  v_contact_count integer := 0;
  v_primary_count integer := 0;
  v_item_count integer := 0;
  v_after jsonb;
  v_reviewed_at timestamptz;
begin
  select * into v_request from valtrim.service_requests where id = p_request_id for update;
  if not found then
    raise exception 'The Customer Service request was not found' using errcode = 'P0002';
  end if;
  if p_expected_updated_at is null or v_request.updated_at is distinct from p_expected_updated_at then
    raise exception 'This request changed after you opened it. Close the review, reload requests and review the latest version before approving.'
      using errcode = '40001';
  end if;
  if v_request.workflow_stage <> 'NEEDS_REVIEW' or v_request.closed_at is not null
     or exists (select 1 from valtrim.service_appointments
                where request_id = p_request_id and is_current and state <> 'CANCELLED') then
    raise exception 'Only a request awaiting review without an active appointment can be approved'
      using errcode = '55000';
  end if;
  if p_valtrim_items_confirmed is distinct from true then
    raise exception 'Confirm that the requested work items belong to Valtrim before approving'
      using errcode = '22023';
  end if;

  select * into strict v_property from valtrim.service_properties
    where id = v_request.property_id for share;
  select job.id, job.community_latitude, job.community_longitude into v_job
  from valtrim.jobs job join valtrim.builders builder on builder.id = job.builder_id
  where job.id = v_property.job_id and job.is_active and job.status = 'ACTIVE' and builder.is_active
  for share of job, builder;
  if not found then
    raise exception 'The selected Job is not active or does not exist' using errcode = '22023';
  end if;
  if v_job.community_latitude is null or v_job.community_longitude is null
     or v_job.community_latitude not between -90 and 90
     or v_job.community_longitude not between -180 and 180 then
    raise exception 'The selected Job must have valid verified coordinates' using errcode = '22023';
  end if;
  -- A Job edit does not change the request's version. Do not approve a location
  -- different from the snapshot the coordinator actually reviewed.
  if row(v_property.latitude, v_property.longitude) is distinct from
     row(v_job.community_latitude, v_job.community_longitude) then
    raise exception 'Job coordinates changed. Edit and save the request, then review its current location before approving.'
      using errcode = '40001';
  end if;
  if v_request.reported_on is null or v_request.reported_on >
     (pg_catalog.now() at time zone 'America/Los_Angeles')::date then
    raise exception 'A valid, non-future Reported on date is required' using errcode = '22023';
  end if;
  if v_request.service_kind is null or v_request.work_category is null or v_request.service_task is null then
    raise exception 'Complete Service kind, Work type and Service task before approving' using errcode = '22023';
  end if;
  if v_request.estimated_duration_minutes is null or v_request.estimated_duration_minutes not between 15 and 720 then
    raise exception 'Duration must be between 15 and 720 minutes before approving' using errcode = '22023';
  end if;
  if v_request.crew_size is null or v_request.crew_size not between 1 and 10 then
    raise exception 'Crew size must be between 1 and 10 before approving' using errcode = '22023';
  end if;
  if v_request.service_task = 'SHUTTER_REPLACEMENT' and v_request.crew_size < 2 then
    raise exception 'Shutter replacement requires at least 2 people' using errcode = '22023';
  end if;

  for v_contact in select * from valtrim.service_request_contacts where request_id = p_request_id for share loop
    v_contact_count := v_contact_count + 1;
    if v_contact.role = 'PRIMARY' then v_primary_count := v_primary_count + 1; end if;
    if nullif(btrim(v_contact.name), '') is null or char_length(btrim(v_contact.name)) > 100 then
      raise exception 'Every contact requires a name of 100 characters or fewer' using errcode = '22023';
    end if;
    if nullif(btrim(v_contact.email::text), '') is null and nullif(btrim(v_contact.phone::text), '') is null then
      raise exception 'Every contact requires an email or phone number' using errcode = '22023';
    end if;
    if v_contact.email is not null and (char_length(v_contact.email) > 160
       or v_contact.email::text !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') then
      raise exception 'Contact email is invalid' using errcode = '22023';
    end if;
    if v_contact.phone is not null and v_contact.phone::text !~ '^([+]1[0-9]{10}|[+]52[0-9]{10})$' then
      raise exception 'Contact phone must use +1 or +52 followed by 10 digits' using errcode = '22023';
    end if;
  end loop;
  if v_primary_count <> 1 or v_contact_count not between 1 and 2 then
    raise exception 'Provide exactly one primary contact and at most one additional contact' using errcode = '22023';
  end if;

  for v_item in select * from valtrim.service_request_items
    where request_id = p_request_id order by item_number for share loop
    v_item_count := v_item_count + 1;
    if v_item.item_number <> v_item_count or nullif(btrim(v_item.description), '') is null
       or char_length(btrim(v_item.description)) > 1000
       or v_item.material_required is null or v_item.chargeable is null then
      raise exception 'Every work item requires a description, flags and consecutive numbering' using errcode = '22023';
    end if;
  end loop;
  if v_item_count not between 1 and 25 then
    raise exception 'Provide between 1 and 25 work items before approving' using errcode = '22023';
  end if;

  v_reviewed_at := pg_catalog.clock_timestamp();
  update valtrim.service_requests set workflow_stage = 'READY_TO_PROPOSE',
    reviewed_by = v_actor_id, reviewed_at = v_reviewed_at,
    valtrim_items_confirmed = true, updated_by = v_actor_id where id = p_request_id;
  -- The existing workflow trigger writes the history in this same transaction.
  -- The dedicated audit also records review fields absent from the legacy audit.
  insert into valtrim.audit_events(module, action, actor_type, actor_user_id,
    actor_name, actor_email, actor_role, entity_type, entity_id, entity_label, summary,
    previous_values, new_values, metadata)
  select 'CUSTOMER_SERVICE', 'SERVICE_REQUEST_READY_TO_PROPOSE', 'USER', actor.id,
    actor.name, actor.email, actor.role::text, 'SERVICE_REQUEST', p_request_id::text,
    v_request.folio, format('Customer Service request %s was reviewed and marked ready to propose.', v_request.folio),
    jsonb_build_object('workflowStage', v_request.workflow_stage, 'reviewedBy', v_request.reviewed_by,
      'reviewedAt', v_request.reviewed_at, 'valtrimItemsConfirmed', v_request.valtrim_items_confirmed),
    jsonb_build_object('workflowStage', 'READY_TO_PROPOSE', 'reviewedBy', v_actor_id,
      'reviewedAt', v_reviewed_at, 'valtrimItemsConfirmed', true),
    jsonb_build_object('operation', 'mark_customer_service_request_ready',
      'jobId', v_job.id, 'contactCount', v_contact_count, 'itemCount', v_item_count)
  from valtrim.app_users actor where actor.id = v_actor_id;

  select value into strict v_after from valtrim.read_customer_service_request_intakes(p_request_id) records(value);
  return v_after;
end;
$function$;

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
    'work_category', new.work_category::text,
    'closed_at', new.closed_at,
    'priority', new.priority::text,
    'workflow_stage', new.workflow_stage::text,
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
      'work_category', old.work_category::text,
      'closed_at', old.closed_at,
      'priority', old.priority::text,
      'workflow_stage', old.workflow_stage::text,
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

    if old.closed_at is null and new.closed_at is not null then
      v_action := 'SERVICE_REQUEST_CLOSED';
      v_summary := format('Customer Service request %s was closed.', new.folio);
    elsif old.closed_at is not null and new.closed_at is null then
      v_action := 'SERVICE_REQUEST_REOPENED';
      v_summary := format('Customer Service request %s was reopened.', new.folio);
    elsif old.workflow_stage is distinct from new.workflow_stage and new.workflow_stage = 'COMPLETED' then
      v_action := 'SERVICE_REQUEST_COMPLETED';
      v_summary := format('Customer Service request %s was completed.', new.folio);
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

create or replace function private.supersede_service_schedule_proposals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id bigint;
  v_property_id bigint;
  v_technician_id bigint;
begin
  if tg_table_name = 'service_request_availability' then
    v_request_id := case when tg_op = 'DELETE' then old.request_id else new.request_id end;

    update valtrim.service_schedule_proposals proposal
    set status = 'SUPERSEDED'
    where proposal.status = 'PENDING'
      and exists (
        select 1
        from valtrim.service_schedule_proposal_stops stop
        where stop.proposal_id = proposal.id
          and stop.request_id = v_request_id
      );
  elsif tg_table_name = 'service_requests' then
    if new.work_category is not distinct from old.work_category
       and new.estimated_duration_minutes is not distinct from old.estimated_duration_minutes
       and new.priority is not distinct from old.priority
       and new.due_on is not distinct from old.due_on
       and new.workflow_stage is not distinct from old.workflow_stage
       and new.closed_at is not distinct from old.closed_at then
      return new;
    end if;

    update valtrim.service_schedule_proposals proposal
    set status = 'SUPERSEDED'
    where proposal.status = 'PENDING'
      and exists (
        select 1
        from valtrim.service_schedule_proposal_stops stop
        where stop.proposal_id = proposal.id
          and stop.request_id = new.id
      );
  elsif tg_table_name = 'service_properties' then
    if new.latitude is not distinct from old.latitude
       and new.longitude is not distinct from old.longitude then
      return new;
    end if;

    v_property_id := new.id;
    update valtrim.service_schedule_proposals proposal
    set status = 'SUPERSEDED'
    where proposal.status = 'PENDING'
      and exists (
        select 1
        from valtrim.service_schedule_proposal_stops stop
        join valtrim.service_requests request on request.id = stop.request_id
        where stop.proposal_id = proposal.id
          and request.property_id = v_property_id
      );
  elsif tg_table_name = 'service_technician_profiles' then
    if new.workday_starts_at is not distinct from old.workday_starts_at
       and new.workday_ends_at is not distinct from old.workday_ends_at
       and new.start_latitude is not distinct from old.start_latitude
       and new.start_longitude is not distinct from old.start_longitude then
      return new;
    end if;

    v_technician_id := new.person_id;
    update valtrim.service_schedule_proposals proposal
    set status = 'SUPERSEDED'
    where proposal.status = 'PENDING'
      and proposal.technician_id = v_technician_id;
  elsif tg_table_name = 'people' then
    if new.is_active is not distinct from old.is_active then
      return new;
    end if;

    update valtrim.service_schedule_proposals proposal
    set status = 'SUPERSEDED'
    where proposal.status = 'PENDING'
      and proposal.technician_id = new.id;
  elsif tg_table_name = 'service_scheduling_settings' then
    if new.time_zone is not distinct from old.time_zone
       and new.distance_green_max_miles is not distinct from old.distance_green_max_miles
       and new.distance_yellow_max_miles is not distinct from old.distance_yellow_max_miles
       and new.travel_buffer_minutes is not distinct from old.travel_buffer_minutes then
      return new;
    end if;

    update valtrim.service_schedule_proposals proposal
    set status = 'SUPERSEDED'
    where proposal.status = 'PENDING';
  elsif tg_table_name = 'service_appointments' then
    if new.is_current and new.state <> 'CANCELLED' then
      update valtrim.service_schedule_proposals proposal
      set status = 'SUPERSEDED'
      where proposal.status = 'PENDING'
        and (
          exists (
            select 1
            from valtrim.service_schedule_proposal_stops request_stop
            where request_stop.proposal_id = proposal.id
              and request_stop.request_id = new.request_id
          )
          or (
            proposal.technician_id = new.technician_id
            and exists (
              select 1
              from valtrim.service_schedule_proposal_stops stop
              where stop.proposal_id = proposal.id
                and new.starts_at < stop.ends_at
                  + make_interval(mins => stop.travel_buffer_minutes)
                and new.ends_at > stop.starts_at
                  - make_interval(mins => stop.travel_buffer_minutes)
            )
          )
        );
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create or replace function valtrim.validate_service_appointment()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
begin
  if new.technician_id is not null and not exists (
    select 1
    from people p
    join person_roles r
      on r.person_id = p.id and r.role = 'SERVICE_TECHNICIAN'
    where p.id = new.technician_id and p.is_active
  ) then
    raise exception 'El tecnico debe estar activo y tener rol SERVICE_TECHNICIAN';
  end if;
  if exists (
    select 1 from service_requests
    where id = new.request_id and closed_at is not null
  ) then
    raise exception 'No se puede agendar una solicitud cerrada';
  end if;
  return new;
end;
$$;

create trigger service_requests_supersede_proposals
after update of work_category, estimated_duration_minutes, priority, due_on, workflow_stage, closed_at
on valtrim.service_requests for each row execute function private.supersede_service_schedule_proposals();

comment on column valtrim.service_requests.workflow_stage is
  'Canonical Customer Service workflow stage. Replaces legacy status/tag; overdue is derived from due_on.';
comment on table valtrim.service_request_status_history is
  'Preserved history of the retired request status contract. New transitions use service_request_workflow_history.';

notify pgrst, 'reload schema';
commit;
