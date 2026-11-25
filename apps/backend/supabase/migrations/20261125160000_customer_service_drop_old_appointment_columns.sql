-- Block B6 cleanup (25 Nov 2026): the old confirmation columns of service_appointments
-- (confirmation_status, confirmation_sent_at, declined_at, reminder_sent_at,
-- phone_follow_up_at, customer_response_note) have been unused since block B moved the
-- customer's answer to service_proposals (decided in B1). confirmed_at stays: it is the
-- time the visit was accepted. Two RPCs only wrote confirmation_status = 'CONFIRMED' and
-- the appointment audit trigger copied it; they are redefined from their live versions
-- without it. The trigger's four branches for confirmation changes, which nothing fires
-- any more, go too. visit_reminder_sent_at (the visit reminder) is unrelated and stays.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

CREATE OR REPLACE FUNCTION private.audit_service_appointment_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_candidate uuid := case when coalesce(current_setting('valtrim.system_actor', true), '') = 'on' then null else coalesce((select auth.uid()), new.updated_by, new.created_by) end;
  v_actor_id uuid;
  v_actor_name text;
  v_actor_email valtrim.email_address;
  v_actor_role text;
  v_request_folio text;
  v_customer_name text;
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

  select request.folio, request.homeowner_name
  into v_request_folio, v_customer_name
  from valtrim.service_requests request
  where request.id = new.request_id;

  v_new_snapshot := jsonb_build_object(
    'technician_ids', to_jsonb(new.technician_ids),
    'window_starts_at', new.window_starts_at,
    'window_ends_at', new.window_ends_at,
    'starts_at', new.starts_at,
    'ends_at', new.ends_at,
    'pickup_minutes', new.pickup_minutes,
    'acceptance', new.acceptance::text, 'accepted_via', new.accepted_via::text, 'proposal_id', new.proposal_id,
    'state', new.state::text,
    'is_current', new.is_current,
    'completed_at', new.completed_at,
    'cancelled_at', new.cancelled_at,
    'cancel_reason', new.cancel_reason
  );

  if tg_op = 'INSERT' then
    v_action := 'SERVICE_APPOINTMENT_REGISTERED';
    v_new_values := v_new_snapshot;
    select array_agg(field.key order by field.key)
    into v_changed_fields
    from jsonb_each(v_new_snapshot) field;
    v_summary := format('An accepted appointment was registered for %s.', v_request_folio);
  else
    v_old_snapshot := jsonb_build_object(
      'technician_ids', to_jsonb(old.technician_ids),
      'window_starts_at', old.window_starts_at,
      'window_ends_at', old.window_ends_at,
      'starts_at', old.starts_at,
      'ends_at', old.ends_at,
      'pickup_minutes', old.pickup_minutes,
      'acceptance', old.acceptance::text, 'accepted_via', old.accepted_via::text, 'proposal_id', old.proposal_id,
      'state', old.state::text,
      'is_current', old.is_current,
      'completed_at', old.completed_at,
      'cancelled_at', old.cancelled_at,
      'cancel_reason', old.cancel_reason
    );

    select
      coalesce(jsonb_object_agg(change.key, v_old_snapshot -> change.key), '{}'::jsonb),
      coalesce(jsonb_object_agg(change.key, change.value), '{}'::jsonb),
      coalesce(array_agg(change.key order by change.key), array[]::text[])
    into v_previous_values, v_new_values, v_changed_fields
    from jsonb_each(v_new_snapshot) change
    where v_old_snapshot -> change.key is distinct from change.value;

    if cardinality(v_changed_fields) = 0 then
      return new;
    end if;

    if old.state is distinct from new.state and new.state = 'CANCELLED' then
      v_action := 'SERVICE_APPOINTMENT_CANCELLED';
      v_summary := format('The appointment for %s was cancelled.', v_request_folio);
    elsif old.state is distinct from new.state and new.state = 'COMPLETED' then
      v_action := 'SERVICE_APPOINTMENT_COMPLETED';
      v_summary := format('The appointment for %s was completed.', v_request_folio);
    else
      v_action := 'SERVICE_APPOINTMENT_UPDATED';
      v_summary := format('The appointment for %s was updated.', v_request_folio);
    end if;
  end if;

  insert into valtrim.audit_events (
    module, action, result, actor_type, actor_user_id, actor_name, actor_email,
    actor_role, target_name, entity_type, entity_id, entity_label, summary,
    previous_values, new_values, metadata
  )
  values (
    'CUSTOMER_SERVICE', v_action, 'SUCCESS',
    case when v_actor_id is null then 'SYSTEM' else 'USER' end,
    v_actor_id, coalesce(v_actor_name, 'System'), v_actor_email, v_actor_role,
    v_customer_name, 'SERVICE_APPOINTMENT', new.id::text, v_request_folio, v_summary,
    v_previous_values, v_new_values,
    jsonb_build_object(
      'requestId', new.request_id,
      'requestFolio', v_request_folio,
      'changedFields', to_jsonb(v_changed_fields)
    )
  );

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION valtrim.register_customer_service_appointment(p_actor_id uuid, p_request_id bigint, p_expected_request_updated_at timestamp with time zone, p_expected_appointment_ids bigint[], p_appointment jsonb, p_travel jsonb, p_expected_option_ids bigint[] DEFAULT '{}'::bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$

declare

  v_request valtrim.service_requests%rowtype;

  v_time_zone text;

  v_technician_ids bigint[];

  v_window_starts_at timestamptz;

  v_day date;

  v_technician_id bigint;

  v_current_ids bigint[];

  v_appointment_id bigint;

  v_leg jsonb;

begin

  if not exists (

    select 1 from valtrim.app_users app_user

    where app_user.id = p_actor_id and app_user.is_active

      and app_user.role::text in ('ADMIN', 'SCHEDULING')

  ) then

    raise exception 'You do not have permission to register Customer Service appointments'

      using errcode = '42501';

  end if;

  if p_appointment is null or jsonb_typeof(p_appointment) <> 'object'

     or jsonb_typeof(p_appointment -> 'technicianIds') <> 'array'

     or p_travel is null or jsonb_typeof(p_travel) <> 'array' then

    raise exception 'Appointment and travel information are required' using errcode = '22023';

  end if;



  begin

    select array_agg(value::bigint order by value::bigint)

    into v_technician_ids

    from jsonb_array_elements_text(p_appointment -> 'technicianIds') technician(value);

    v_window_starts_at := (p_appointment ->> 'windowStartsAt')::timestamptz;

  exception

    when invalid_text_representation or datetime_field_overflow then

      raise exception 'Appointment technicians or window have an invalid value' using errcode = '22023';

  end;

  if v_technician_ids is null or v_window_starts_at is null then

    raise exception 'Appointment technicians and window are required' using errcode = '22023';

  end if;



  select settings.time_zone into strict v_time_zone

  from valtrim.service_scheduling_settings settings where settings.id = 1;

  v_day := (v_window_starts_at at time zone v_time_zone)::date;



  -- Serialize every write that touches these technicians on this day. Ordered

  -- locks keep two concurrent registrations from deadlocking.

  foreach v_technician_id in array v_technician_ids loop

    perform pg_catalog.pg_advisory_xact_lock(

      pg_catalog.hashtextextended(format('service-appointments:%s:%s', v_technician_id, v_day), 0)

    );

  end loop;



  select * into v_request from valtrim.service_requests where id = p_request_id for update;

  if not found then

    raise exception 'The Customer Service request was not found' using errcode = 'P0002';

  end if;

  if p_expected_request_updated_at is null

     or v_request.updated_at is distinct from p_expected_request_updated_at then

    raise exception 'This request changed after you opened it. Reload requests and review the plan again.'

      using errcode = '40001';

  end if;

  if v_request.workflow_stage not in ('READY_TO_PROPOSE', 'AWAITING_CUSTOMER', 'NEEDS_CONTACT')

     or v_request.closed_at is not null then

    raise exception 'Only an open request waiting for a proposal can get an appointment'

      using errcode = '55000';

  end if;

  -- Its days stay held until the customer answers; the answer is recorded on the

  -- proposal (accept, reject or counter-propose) or the proposal is cancelled first.

  if exists (

    select 1 from valtrim.service_proposals proposal

    where proposal.request_id = p_request_id and proposal.status = 'SENT'

  ) then

    raise exception 'This request has a proposal waiting for the customer. Record the customer''s answer or cancel the proposal first.'

      using errcode = '55000';

  end if;



  select coalesce(array_agg(appointment.id order by appointment.id), '{}'::bigint[])

  into v_current_ids

  from valtrim.service_appointments appointment

  where appointment.is_current

    and appointment.technician_ids && v_technician_ids

    and (appointment.window_starts_at at time zone v_time_zone)::date = v_day;

  if v_current_ids is distinct from (

    select coalesce(array_agg(expected.id order by expected.id), '{}'::bigint[])

    from (select distinct unnest(coalesce(p_expected_appointment_ids, '{}'::bigint[])) as id) expected

  ) then

    raise exception 'The schedule changed. Review the plan again.' using errcode = '40001';

  end if;

  -- Options of a sent proposal occupy their technicians like appointments.

  select coalesce(array_agg(held.id order by held.id), '{}'::bigint[])

  into v_current_ids

  from valtrim.service_proposal_options held

  join valtrim.service_proposals proposal

    on proposal.id = held.proposal_id and proposal.status = 'SENT'

  where held.technician_ids && v_technician_ids

    and (held.window_starts_at at time zone v_time_zone)::date = v_day;

  if v_current_ids is distinct from (

    select coalesce(array_agg(expected.id order by expected.id), '{}'::bigint[])

    from (select distinct unnest(coalesce(p_expected_option_ids, '{}'::bigint[])) as id) expected

  ) then

    raise exception 'The schedule changed. Review the plan again.' using errcode = '40001';

  end if;



  begin

    insert into valtrim.service_appointments (

      request_id, technician_ids, window_starts_at, window_ends_at, starts_at, ends_at,

      pickup_minutes, acceptance, state, is_current, confirmed_at,

      created_by, updated_by

    ) values (

      p_request_id, v_technician_ids, v_window_starts_at,

      (p_appointment ->> 'windowEndsAt')::timestamptz,

      (p_appointment ->> 'startsAt')::timestamptz,

      (p_appointment ->> 'endsAt')::timestamptz,

      (p_appointment ->> 'pickupMinutes')::smallint,

      (p_appointment ->> 'acceptance')::valtrim.service_appointment_acceptance,

      'SCHEDULED', true, pg_catalog.now(), p_actor_id, p_actor_id

    ) returning id into v_appointment_id;

  exception

    when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then

      raise exception 'Appointment times, pickup or acceptance have an invalid value' using errcode = '22023';

  end;



  for v_leg in select value from jsonb_array_elements(p_travel) loop

    insert into valtrim.service_travel_estimates (

      from_request_id, to_request_id, minutes, source, created_by, updated_by

    ) values (

      (v_leg ->> 'fromRequestId')::bigint, (v_leg ->> 'toRequestId')::bigint,

      (v_leg ->> 'minutes')::smallint, 'MANUAL', p_actor_id, p_actor_id

    )

    on conflict (from_request_id, to_request_id) do update

      set minutes = excluded.minutes, source = excluded.source, updated_by = excluded.updated_by;

  end loop;



  -- The workflow trigger records the history with updated_by as the actor.

  update valtrim.service_requests

  set workflow_stage = 'CONFIRMED', updated_by = p_actor_id

  where id = p_request_id;



  return jsonb_build_object('appointmentId', v_appointment_id, 'requestId', p_request_id);

end;

$function$;

CREATE OR REPLACE FUNCTION valtrim.accept_customer_service_proposal(p_actor_id uuid, p_proposal_id bigint, p_option_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$

declare

  v_via valtrim.service_response_channel :=

    case when p_actor_id is null then 'CUSTOMER_LINK' else 'COORDINATOR' end;

  v_option valtrim.service_proposal_options%rowtype;

  v_proposal valtrim.service_proposals%rowtype;

  v_request valtrim.service_requests%rowtype;

  v_time_zone text;

  v_day date;

  v_technician_id bigint;

  v_appointment_id bigint;

begin

  if p_actor_id is not null and not exists (

    select 1 from valtrim.app_users app_user

    where app_user.id = p_actor_id and app_user.is_active

      and app_user.role::text in ('ADMIN', 'SCHEDULING')

  ) then

    raise exception 'You do not have permission to record Customer Service proposal answers'

      using errcode = '42501';

  end if;



  select * into v_option from valtrim.service_proposal_options

  where id = p_option_id and proposal_id = p_proposal_id;

  if not found then

    raise exception 'This option is not part of the proposal' using errcode = 'P0002';

  end if;



  select settings.time_zone into strict v_time_zone

  from valtrim.service_scheduling_settings settings where settings.id = 1;

  v_day := (v_option.window_starts_at at time zone v_time_zone)::date;

  foreach v_technician_id in array v_option.technician_ids loop

    perform pg_catalog.pg_advisory_xact_lock(

      pg_catalog.hashtextextended(format('service-appointments:%s:%s', v_technician_id, v_day), 0)

    );

  end loop;



  select * into v_proposal from valtrim.service_proposals where id = p_proposal_id for update;

  -- A repeated click on the same answer returns the first result.

  if v_proposal.status = 'ACCEPTED' and v_proposal.accepted_option_id = p_option_id then

    return jsonb_build_object(

      'proposalId', p_proposal_id, 'requestId', v_proposal.request_id, 'alreadyRecorded', true,

      'appointmentId', (select appointment.id from valtrim.service_appointments appointment

        where appointment.proposal_id = p_proposal_id)

    );

  end if;

  if v_proposal.status <> 'SENT' then

    raise exception 'This proposal was already answered or cancelled' using errcode = '55000';

  end if;

  if v_option.window_starts_at <= pg_catalog.now() then

    raise exception 'This day has already started or passed' using errcode = '55000';

  end if;



  select * into v_request from valtrim.service_requests where id = v_proposal.request_id for update;

  if v_request.workflow_stage not in ('READY_TO_PROPOSE', 'AWAITING_CUSTOMER', 'NEEDS_CONTACT')

     or v_request.closed_at is not null then

    raise exception 'This request is no longer waiting for the customer' using errcode = '55000';

  end if;



  -- A customer's answer is not credited to the coordinator who sent the proposal.

  if v_via = 'CUSTOMER_LINK' then

    perform pg_catalog.set_config('valtrim.system_actor', 'on', true);

  end if;



  insert into valtrim.service_appointments (

    request_id, technician_ids, window_starts_at, window_ends_at, starts_at, ends_at,

    pickup_minutes, acceptance, accepted_via, proposal_id, state, is_current,

    confirmed_at, created_by, updated_by

  ) values (

    v_proposal.request_id, v_option.technician_ids, v_option.window_starts_at, v_option.window_ends_at,

    v_option.starts_at, v_option.ends_at, v_option.pickup_minutes, 'CUSTOMER_ACCEPTED_PROPOSAL',

    v_via, p_proposal_id, 'SCHEDULED', true, pg_catalog.now(), p_actor_id, p_actor_id

  ) returning id into v_appointment_id;



  update valtrim.service_proposals

  set status = 'ACCEPTED', responded_at = pg_catalog.now(), response_via = v_via,

      accepted_option_id = p_option_id, updated_by = p_actor_id

  where id = p_proposal_id;



  update valtrim.service_requests

  set workflow_stage = 'CONFIRMED', updated_by = p_actor_id

  where id = v_proposal.request_id;



  perform pg_catalog.set_config('valtrim.system_actor', '', true);

  return jsonb_build_object(

    'proposalId', p_proposal_id, 'requestId', v_proposal.request_id,

    'appointmentId', v_appointment_id, 'alreadyRecorded', false

  );

end;

$function$;

drop index if exists valtrim.service_appointments_confirmation_idx;
alter table valtrim.service_appointments drop constraint if exists service_appointments_confirmation_check;
alter table valtrim.service_appointments
  drop column confirmation_status,
  drop column confirmation_sent_at,
  drop column declined_at,
  drop column reminder_sent_at,
  drop column phone_follow_up_at,
  drop column customer_response_note;
drop type valtrim.service_confirmation_status;

notify pgrst, 'reload schema';
commit;
