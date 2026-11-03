-- User-approved 2026-10-29: one primary customer and up to two additional customers.
-- Existing requests retain their contact IDs, channels and ordering. No source or file changes.
begin;

alter table valtrim.service_request_contacts add column contact_number smallint;
update valtrim.service_request_contacts set contact_number = case when role = 'PRIMARY' then 1 else 2 end;
alter table valtrim.service_request_contacts
  drop constraint service_request_contacts_role_uq,
  alter column contact_number set not null,
  add constraint service_request_contacts_number_check check (
    (role = 'PRIMARY' and contact_number = 1) or (role = 'ADDITIONAL' and contact_number between 2 and 3)),
  add constraint service_request_contacts_number_uq unique (request_id,contact_number);

-- Supports existing callers that omit the new number. The parent lock serializes
-- concurrent inserts; the constrained unique number bounds every write to three.
create function private.assign_customer_service_contact_number()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  perform 1 from valtrim.service_requests where id = new.request_id for update;
  if new.contact_number is null then
    if new.role = 'PRIMARY' then new.contact_number := 1;
    else
      select slot into new.contact_number from generate_series(2,3) slot
      where not exists (select 1 from valtrim.service_request_contacts c
        where c.request_id = new.request_id and c.contact_number = slot and c.id <> new.id)
      order by slot limit 1;
      if new.contact_number is null then
        raise exception 'A request supports up to three customers' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function private.assign_customer_service_contact_number() from public,anon,authenticated,service_role;
create trigger service_request_contacts_assign_number
before insert or update of request_id,role,contact_number on valtrim.service_request_contacts
for each row execute function private.assign_customer_service_contact_number();

-- The external JSON contract remains PRIMARY/ADDITIONAL; numbers are assigned
-- internally in source/form order, never trusted from a caller-provided field.
create function private.number_customer_service_contacts(p_contacts jsonb)
returns table(value jsonb,contact_number smallint)
language sql immutable set search_path = '' as $function$
  select value,(case when upper(btrim(value ->> 'role')) = 'PRIMARY' then 1
    else row_number() over(partition by upper(btrim(value ->> 'role')) order by ordinality)+1 end)::smallint
  from jsonb_array_elements(p_contacts) with ordinality;
$function$;
revoke all on function private.number_customer_service_contacts(jsonb) from public,anon,authenticated,service_role;

-- Replace only contact bounds, numbering, writes and read order in the deployed
-- definitions. Authorization, exact versions, source immutability, audit and
-- independent human approval retain their existing implementation and grants.
CREATE OR REPLACE FUNCTION private.create_customer_service_request_intake_internal(p_submission_key uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     or jsonb_array_length(v_contacts) > 3 then
    raise exception 'Provide one primary contact and at most two additional contacts'
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

  if v_primary_count <> 1 or v_additional_count > 2 then
    raise exception 'Provide exactly one primary contact and at most two additional contacts'
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
      raise exception 'Source type must be PDF, EMAIL_TEXT or EMAIL_METADATA'
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

    if v_source_type = 'EMAIL_METADATA' then
      if v_sender_email is null and v_subject is null then
        raise exception 'Provide a sender or subject for email details' using errcode = '22023';
      end if;
      if v_email_text is not null or v_extracted_text is not null
         or v_extraction_payload is not null or v_extraction_model is not null
         or v_extracted_at is not null or cardinality(v_review_notes) <> 0
         or exists (select 1 from jsonb_object_keys(v_source) key
                    where key not in ('sourceType', 'senderEmail', 'subject', 'emailText',
                      'extractedText', 'extractionPayload', 'extractionModel', 'extractedAt', 'reviewNotes')) then
        raise exception 'Email details cannot include a document, body or extraction' using errcode = '22023';
      end if;
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
    select value || jsonb_build_object('_number',contact_number)
    from private.number_customer_service_contacts(v_contacts)
  loop
    insert into valtrim.service_request_contacts (
      request_id,
      role,
      name,
      email,
      phone,
      created_by,
      updated_by,
      contact_number
    ) values (
      v_request_id,
      upper(btrim(v_contact ->> 'role'))
        ::valtrim.service_request_contact_role,
      btrim(v_contact ->> 'name'),
      nullif(lower(btrim(v_contact ->> 'email')), '')::valtrim.email_address,
      nullif(btrim(v_contact ->> 'phone'), '')::valtrim.phone_number,
      v_actor_id,
      v_actor_id,
      (v_contact ->> '_number')::smallint
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

CREATE OR REPLACE FUNCTION private.normalize_customer_service_import_intake(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    or jsonb_array_length(v_contacts) not between 1 and 3 then
    raise exception 'Provide one primary contact and at most two additional contacts' using errcode = '22023';
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
  if v_primary_count <> 1 or v_additional_count > 2 then
    raise exception 'Provide exactly one primary contact and at most two additional contacts' using errcode = '22023';
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
    'contacts',(select jsonb_agg(value order by value ->> 'role',ordinality) from jsonb_array_elements(v_normal_contacts) with ordinality),
    'items',v_normal_items);
end;
$function$;

CREATE OR REPLACE FUNCTION private.write_customer_service_import_intake(p_import_id uuid, p_data jsonb, p_request_id bigint DEFAULT NULL::bigint, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and contact_number not in (select contact_number from private.number_customer_service_contacts(p_data -> 'contacts'));
  insert into valtrim.service_request_contacts(request_id,role,name,email,phone,created_by,updated_by,contact_number)
  select v_request_id,(value ->> 'role')::valtrim.service_request_contact_role,value ->> 'name',
    (value ->> 'email')::valtrim.email_address,(value ->> 'phone')::valtrim.phone_number,p_actor_id,p_actor_id,contact_number
  from private.number_customer_service_contacts(p_data -> 'contacts')
  on conflict (request_id,contact_number) do update set name = excluded.name,email = excluded.email,
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

CREATE OR REPLACE FUNCTION private.update_customer_service_request_intake(p_request_id bigint, p_expected_updated_at timestamp with time zone, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
       or jsonb_array_length(v_contacts) > 3 then
      raise exception 'Provide one primary contact and at most two additional contacts'
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

    if v_primary_count <> 1 or v_additional_count > 2 then
      raise exception 'Provide exactly one primary contact and at most two additional contacts'
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
    ) order by upper(btrim(value ->> 'role')),ordinality), '[]'::jsonb) into v_contacts from jsonb_array_elements(v_contacts) with ordinality;
    select coalesce(jsonb_agg(jsonb_build_object(
      'itemNumber', (value ->> 'itemNumber')::integer, 'description', btrim(value ->> 'description'),
      'materialRequired', coalesce((value ->> 'materialRequired')::boolean, false),
      'chargeable', coalesce((value ->> 'chargeable')::boolean, false)
    ) order by (value ->> 'itemNumber')::integer), '[]'::jsonb) into v_items from jsonb_array_elements(v_items);
    select coalesce(jsonb_agg(jsonb_build_object(
      'role', role, 'name', name, 'email', email, 'phone', phone
    ) order by role::text,contact_number), '[]'::jsonb) into v_old_contacts
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
      and contact_number not in (select contact_number from private.number_customer_service_contacts(v_contacts));
    insert into valtrim.service_request_contacts(request_id, role, name, email, phone, created_by, updated_by, contact_number)
    select p_request_id, (value ->> 'role')::valtrim.service_request_contact_role,
      value ->> 'name', (value ->> 'email')::valtrim.email_address,
      (value ->> 'phone')::valtrim.phone_number, v_actor_id, v_actor_id, contact_number
    from private.number_customer_service_contacts(v_contacts)
    on conflict (request_id, contact_number) do update set name = excluded.name,
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

CREATE OR REPLACE FUNCTION valtrim.read_customer_service_request_intakes(p_request_id bigint DEFAULT NULL::bigint)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_customer_service_actor();
  return query
  select jsonb_build_object(
    'request',to_jsonb(request),'property',to_jsonb(property),
    'builderName',coalesce(builder.name,legacy_builder.name),
    'community',coalesce(job.community,community.name),'jobCode',job.code,
    'coordinatorName',coordinator.name,'reviewerName',reviewer.name,
    'contacts',coalesce((select jsonb_agg(to_jsonb(contact) order by contact.contact_number)
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

CREATE OR REPLACE FUNCTION valtrim.mark_customer_service_request_ready(p_request_id bigint, p_expected_updated_at timestamp with time zone, p_valtrim_items_confirmed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if v_primary_count <> 1 or v_contact_count not between 1 and 3 then
    raise exception 'Provide exactly one primary contact and at most two additional contacts' using errcode = '22023';
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

commit;
