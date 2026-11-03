-- Human review is a separate, guarded transaction; no proposal or visit is created.
begin;

create function valtrim.mark_customer_service_request_ready(
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
  if v_request.workflow_stage <> 'NEEDS_REVIEW' or v_request.status in ('CLOSED', 'COMPLETED')
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

revoke all on function valtrim.mark_customer_service_request_ready(bigint, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function valtrim.mark_customer_service_request_ready(bigint, timestamptz, boolean) to authenticated;
comment on function valtrim.mark_customer_service_request_ready(bigint, timestamptz, boolean) is
  'Approves a complete NEEDS_REVIEW request with explicit Valtrim confirmation, exact version, active ADMIN/SCHEDULING actor, server review timestamp, workflow history and audit. Returns canonical intake without altering source or creating a proposal/visit.';

notify pgrst, 'reload schema';
commit;
