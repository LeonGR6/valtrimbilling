-- Customer Service Reschedule block, part R1 (27 Nov 2026; plan in
-- docs/customer-service-reschedule-plan.md). The coordinator moves or cancels a confirmed
-- visit, and closes a request that will not get one (decision D2).
-- Decided 27 Nov: a visit moves only to a day already agreed with the customer (P1), also
-- while its window is under way (P2) and after the due date (P3, a warning the Edge Function
-- shows); Close request belongs to this block (P4).
-- The Edge Function customer-service-appointments checks capacity and sends the customer
-- emails (parts R2 and R3). These service-role RPCs only write each change in one
-- transaction. The test-mode cancel_customer_service_appointment stays until the screens use
-- these RPCs (part R4).

begin;

-- 1. Why a visit moved or was cancelled, or why a request closed. There is one list, and
-- each RPC accepts only its part of it.
create type valtrim.service_change_reason as enum (
  'CUSTOMER_ASKED', 'BUILDER_ASKED', 'TECHNICIAN_UNAVAILABLE', 'WEATHER',
  'CUSTOMER_CANCELLED', 'BUILDER_CANCELLED', 'RESOLVED_WITHOUT_VISIT', 'NOT_VALTRIM_WORK',
  'DUPLICATE', 'OTHER'
);
comment on type valtrim.service_change_reason is
  'Why a Customer Service visit moved (CUSTOMER_ASKED, BUILDER_ASKED, TECHNICIAN_UNAVAILABLE, WEATHER, OTHER), was cancelled (CUSTOMER_CANCELLED, BUILDER_CANCELLED, RESOLVED_WITHOUT_VISIT, NOT_VALTRIM_WORK, DUPLICATE, OTHER) or why a request closed (the cancellation reasons).';

-- The words stored in the free-text reason when the coordinator adds no note.
create function private.service_change_reason_label(p_reason valtrim.service_change_reason)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case p_reason
    when 'CUSTOMER_ASKED' then 'Customer asked'
    when 'BUILDER_ASKED' then 'Builder asked'
    when 'TECHNICIAN_UNAVAILABLE' then 'Technician unavailable'
    when 'WEATHER' then 'Weather'
    when 'CUSTOMER_CANCELLED' then 'Customer cancelled'
    when 'BUILDER_CANCELLED' then 'Cancelled by Builder'
    when 'RESOLVED_WITHOUT_VISIT' then 'Resolved without a visit'
    when 'NOT_VALTRIM_WORK' then 'Not Valtrim work'
    when 'DUPLICATE' then 'Duplicate request'
    else 'Other'
  end;
$function$;
revoke all on function private.service_change_reason_label(valtrim.service_change_reason) from public, anon, authenticated;

-- 2. Appointments: the reason of a move or cancellation, and on the new visit the one it
-- replaced. cancel_reason keeps the note (or the reason's words); it is still required on
-- every cancelled appointment.
alter table valtrim.service_appointments
  add column change_reason valtrim.service_change_reason,
  add column rescheduled_from_id bigint references valtrim.service_appointments(id),
  add constraint service_appointments_change_reason_check
    check (change_reason is null or state = 'CANCELLED'),
  add constraint service_appointments_rescheduled_from_check
    check (rescheduled_from_id is distinct from id);
create unique index service_appointments_rescheduled_from_uq
  on valtrim.service_appointments (rescheduled_from_id) where rescheduled_from_id is not null;
comment on column valtrim.service_appointments.change_reason is
  'Why the visit moved or was cancelled (Reschedule block). Null on visits cancelled before 27 Nov 2026, which kept only cancel_reason.';
comment on column valtrim.service_appointments.rescheduled_from_id is
  'On a moved visit, the appointment it replaced (cancelled in the same transaction).';

-- 3. Requests: closing uses the existing closed_at, closed_by and close_reason (the note,
-- required while closed), plus the reason and, for a duplicate, the original request. A
-- closed request keeps its last open stage; the screens show it as Closed.
alter table valtrim.service_requests
  add column close_reason_code valtrim.service_change_reason,
  add column duplicate_of_request_id bigint references valtrim.service_requests(id),
  add constraint service_requests_close_reason_code_check
    check ((closed_at is null) = (close_reason_code is null)),
  add constraint service_requests_duplicate_of_check
    check (
      (close_reason_code is not distinct from 'DUPLICATE') = (duplicate_of_request_id is not null)
      and duplicate_of_request_id is distinct from id
    );
comment on column valtrim.service_requests.close_reason_code is
  'Why the request was closed without a visit (decision D2, 26 Nov 2026); close_reason keeps the note.';
comment on column valtrim.service_requests.duplicate_of_request_id is
  'The original request when the request was closed as a duplicate.';

-- 4. The customer emails of part R3.
alter type valtrim.service_communication_type add value if not exists 'VISIT_MOVED';
alter type valtrim.service_communication_type add value if not exists 'VISIT_CANCELLED';

-- 5. The appointment audit also records the reason and the replaced visit. A move is
-- audited as the old visit "moved" and the new one "rescheduled", instead of "cancelled"
-- and "registered". Otherwise unchanged from 20261125160000.
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
    'cancel_reason', new.cancel_reason,
    'change_reason', new.change_reason::text,
    'rescheduled_from_id', new.rescheduled_from_id
  );

  if tg_op = 'INSERT' then
    select array_agg(field.key order by field.key)
    into v_changed_fields
    from jsonb_each(v_new_snapshot) field;
    v_new_values := v_new_snapshot;
    if new.rescheduled_from_id is not null then
      v_action := 'SERVICE_APPOINTMENT_RESCHEDULED';
      v_summary := format('The visit for %s was moved to a new date.', v_request_folio);
    else
      v_action := 'SERVICE_APPOINTMENT_REGISTERED';
      v_summary := format('An accepted appointment was registered for %s.', v_request_folio);
    end if;
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
      'cancel_reason', old.cancel_reason,
      'change_reason', old.change_reason::text,
      'rescheduled_from_id', old.rescheduled_from_id
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

    if old.state is distinct from new.state and new.state = 'CANCELLED'
       and coalesce(current_setting('valtrim.appointment_change', true), '') = 'MOVE' then
      v_action := 'SERVICE_APPOINTMENT_MOVED';
      v_summary := format('The visit for %s was moved; its old date was released.', v_request_folio);
    elsif old.state is distinct from new.state and new.state = 'CANCELLED' then
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

-- Only active ADMIN and SCHEDULING users move, cancel and close (the Edge Function passes
-- the signed-in coordinator).
create function private.require_customer_service_coordinator_id(p_actor_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not exists (
    select 1 from valtrim.app_users app_user
    where app_user.id = p_actor_id and app_user.is_active
      and app_user.role::text in ('ADMIN', 'SCHEDULING')
  ) then
    raise exception 'You do not have permission to change Customer Service visits or requests'
      using errcode = '42501';
  end if;
end;
$function$;
revoke all on function private.require_customer_service_coordinator_id(uuid) from public, anon, authenticated;

-- 6. Move a scheduled visit to a day agreed with the customer. The old appointment is
-- cancelled with the reason and the new one registered, in one transaction, so there is
-- never zero or two current visits. Capacity was checked by the Edge Function against the
-- day without the old visit; p_expected_* are the appointments and held options it saw.
create function valtrim.reschedule_customer_service_appointment(
  p_actor_id uuid,
  p_appointment_id bigint,
  p_expected_appointment_updated_at timestamptz,
  p_expected_request_updated_at timestamptz,
  p_expected_appointment_ids bigint[],
  p_expected_option_ids bigint[],
  p_appointment jsonb,
  p_travel jsonb,
  p_reason valtrim.service_change_reason,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_note text := nullif(btrim(p_note), '');
  v_old valtrim.service_appointments%rowtype;
  v_request valtrim.service_requests%rowtype;
  v_time_zone text;
  v_technician_ids bigint[];
  v_window_starts_at timestamptz;
  v_day date;
  v_old_day date;
  v_lock record;
  v_current_ids bigint[];
  v_appointment_id bigint;
  v_leg jsonb;
begin
  perform private.require_customer_service_coordinator_id(p_actor_id);
  if p_reason is null or p_reason not in ('CUSTOMER_ASKED', 'BUILDER_ASKED', 'TECHNICIAN_UNAVAILABLE', 'WEATHER', 'OTHER') then
    raise exception 'Choose why the visit moves' using errcode = '22023';
  end if;
  if (p_reason = 'OTHER' and v_note is null) or char_length(v_note) > 500 then
    raise exception 'Describe the reason in 500 characters or fewer' using errcode = '22023';
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

  select * into v_old from valtrim.service_appointments where id = p_appointment_id;
  if not found then
    raise exception 'The visit was not found' using errcode = 'P0002';
  end if;
  select settings.time_zone into strict v_time_zone
  from valtrim.service_scheduling_settings settings where settings.id = 1;
  v_day := (v_window_starts_at at time zone v_time_zone)::date;
  v_old_day := (v_old.window_starts_at at time zone v_time_zone)::date;

  -- Lock every technician day the move touches, the old and the new, in one order (day,
  -- then technician) so concurrent writers cannot deadlock.
  for v_lock in
    select distinct key.lock_day, key.technician_id
    from (
      select v_old_day as lock_day, unnest(v_old.technician_ids) as technician_id
      union all
      select v_day, unnest(v_technician_ids)
    ) key
    order by key.lock_day, key.technician_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(format('service-appointments:%s:%s', v_lock.technician_id, v_lock.lock_day), 0)
    );
  end loop;

  select * into v_old from valtrim.service_appointments where id = p_appointment_id for update;
  if p_expected_appointment_updated_at is null or v_old.updated_at is distinct from p_expected_appointment_updated_at then
    raise exception 'This visit changed after you opened it. Reload and try again.' using errcode = '40001';
  end if;
  if not v_old.is_current or v_old.state <> 'SCHEDULED' then
    raise exception 'Only a scheduled visit can be moved' using errcode = '55000';
  end if;
  -- A visit under way can still move until its window ends (P2).
  if v_old.window_ends_at <= pg_catalog.now() then
    raise exception 'This visit already ended and cannot be moved' using errcode = '55000';
  end if;

  select * into v_request from valtrim.service_requests where id = v_old.request_id for update;
  if p_expected_request_updated_at is null or v_request.updated_at is distinct from p_expected_request_updated_at then
    raise exception 'This request changed after you opened it. Reload requests and review the plan again.'
      using errcode = '40001';
  end if;
  if v_request.workflow_stage not in ('CONFIRMED', 'WORKING') or v_request.closed_at is not null then
    raise exception 'Only a confirmed visit can be moved' using errcode = '55000';
  end if;

  -- The day the Edge Function checked, without the visit that moves.
  select coalesce(array_agg(appointment.id order by appointment.id), '{}'::bigint[])
  into v_current_ids
  from valtrim.service_appointments appointment
  where appointment.is_current
    and appointment.id <> p_appointment_id
    and appointment.technician_ids && v_technician_ids
    and (appointment.window_starts_at at time zone v_time_zone)::date = v_day;
  if v_current_ids is distinct from (
    select coalesce(array_agg(expected.id order by expected.id), '{}'::bigint[])
    from (select distinct unnest(coalesce(p_expected_appointment_ids, '{}'::bigint[])) as id) expected
  ) then
    raise exception 'The schedule changed. Review the plan again.' using errcode = '40001';
  end if;
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

  perform pg_catalog.set_config('valtrim.appointment_change', 'MOVE', true);
  update valtrim.service_appointments
  set state = 'CANCELLED', is_current = false, cancelled_at = pg_catalog.now(),
      change_reason = p_reason,
      cancel_reason = coalesce(v_note, private.service_change_reason_label(p_reason)),
      updated_by = p_actor_id
  where id = p_appointment_id;
  perform pg_catalog.set_config('valtrim.appointment_change', '', true);

  -- The customer agreed the new day with the coordinator: it comes from no proposal.
  begin
    insert into valtrim.service_appointments (
      request_id, technician_ids, window_starts_at, window_ends_at, starts_at, ends_at,
      pickup_minutes, acceptance, accepted_via, state, is_current, confirmed_at,
      rescheduled_from_id, created_by, updated_by
    ) values (
      v_old.request_id, v_technician_ids, v_window_starts_at,
      (p_appointment ->> 'windowEndsAt')::timestamptz,
      (p_appointment ->> 'startsAt')::timestamptz,
      (p_appointment ->> 'endsAt')::timestamptz,
      (p_appointment ->> 'pickupMinutes')::smallint,
      v_old.acceptance, 'COORDINATOR', 'SCHEDULED', true, pg_catalog.now(),
      p_appointment_id, p_actor_id, p_actor_id
    ) returning id into v_appointment_id;
  exception
    when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
      raise exception 'Appointment times or pickup have an invalid value' using errcode = '22023';
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

  -- A visit moved while under way waits again for its new window.
  update valtrim.service_requests
  set workflow_stage = 'CONFIRMED', updated_by = p_actor_id
  where id = v_old.request_id;

  return jsonb_build_object(
    'appointmentId', v_appointment_id,
    'previousAppointmentId', p_appointment_id,
    'requestId', v_old.request_id
  );
end;
$function$;
comment on function valtrim.reschedule_customer_service_appointment(uuid, bigint, timestamptz, timestamptz, bigint[], bigint[], jsonb, jsonb, valtrim.service_change_reason, text) is
  'Service role only (Edge Function customer-service-appointments). Moves a scheduled visit to an agreed day: cancels it with the reason and registers the new one in one transaction.';

-- Closing fields shared by the two RPCs that close a request.
create function private.check_customer_service_close(
  p_request_id bigint,
  p_reason valtrim.service_change_reason,
  p_note text,
  p_duplicate_of_request_id bigint
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_reason is null or p_reason not in ('CUSTOMER_CANCELLED', 'BUILDER_CANCELLED', 'RESOLVED_WITHOUT_VISIT', 'NOT_VALTRIM_WORK', 'DUPLICATE', 'OTHER') then
    raise exception 'Choose why the request closes' using errcode = '22023';
  end if;
  if (p_reason = 'OTHER' and p_note is null) or char_length(p_note) > 500 then
    raise exception 'Describe the reason in 500 characters or fewer' using errcode = '22023';
  end if;
  if (p_reason = 'DUPLICATE') <> (p_duplicate_of_request_id is not null) then
    raise exception 'A duplicate needs the original request, and only a duplicate has one' using errcode = '22023';
  end if;
  if p_duplicate_of_request_id is not null and (
    p_duplicate_of_request_id = p_request_id
    or not exists (select 1 from valtrim.service_requests request where request.id = p_duplicate_of_request_id)
  ) then
    raise exception 'The original request was not found' using errcode = 'P0002';
  end if;
end;
$function$;
revoke all on function private.check_customer_service_close(bigint, valtrim.service_change_reason, text, bigint) from public, anon, authenticated;

-- 7. Cancel a scheduled visit, in test mode or live. The request goes back to Ready to
-- propose, or closes when p_close_request (P4).
create function valtrim.cancel_customer_service_visit(
  p_actor_id uuid,
  p_appointment_id bigint,
  p_expected_updated_at timestamptz,
  p_reason valtrim.service_change_reason,
  p_note text default null,
  p_close_request boolean default false,
  p_duplicate_of_request_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_note text := nullif(btrim(p_note), '');
  v_appointment valtrim.service_appointments%rowtype;
  v_request valtrim.service_requests%rowtype;
  v_time_zone text;
  v_day date;
  v_technician_id bigint;
  v_close boolean := coalesce(p_close_request, false);
begin
  perform private.require_customer_service_coordinator_id(p_actor_id);
  if p_reason is null or p_reason not in ('CUSTOMER_CANCELLED', 'BUILDER_CANCELLED', 'RESOLVED_WITHOUT_VISIT', 'NOT_VALTRIM_WORK', 'DUPLICATE', 'OTHER') then
    raise exception 'Choose why the visit is cancelled' using errcode = '22023';
  end if;
  if (p_reason = 'OTHER' and v_note is null) or char_length(v_note) > 500 then
    raise exception 'Describe the reason in 500 characters or fewer' using errcode = '22023';
  end if;
  if not v_close and (p_reason = 'DUPLICATE' or p_duplicate_of_request_id is not null) then
    raise exception 'A duplicate closes the request' using errcode = '22023';
  end if;

  select * into v_appointment from valtrim.service_appointments where id = p_appointment_id;
  if not found then
    raise exception 'The visit was not found' using errcode = 'P0002';
  end if;
  if v_close then
    perform private.check_customer_service_close(v_appointment.request_id, p_reason, v_note, p_duplicate_of_request_id);
  end if;
  select settings.time_zone into strict v_time_zone
  from valtrim.service_scheduling_settings settings where settings.id = 1;
  v_day := (v_appointment.window_starts_at at time zone v_time_zone)::date;
  foreach v_technician_id in array (
    select array_agg(technician_id order by technician_id) from unnest(v_appointment.technician_ids) technician_id
  ) loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(format('service-appointments:%s:%s', v_technician_id, v_day), 0)
    );
  end loop;

  select * into v_appointment from valtrim.service_appointments where id = p_appointment_id for update;
  if p_expected_updated_at is null or v_appointment.updated_at is distinct from p_expected_updated_at then
    raise exception 'This visit changed after you opened it. Reload and try again.' using errcode = '40001';
  end if;
  if not v_appointment.is_current or v_appointment.state <> 'SCHEDULED' then
    raise exception 'Only a scheduled visit can be cancelled' using errcode = '55000';
  end if;
  if v_appointment.window_ends_at <= pg_catalog.now() then
    raise exception 'This visit already ended and cannot be cancelled' using errcode = '55000';
  end if;
  select * into v_request from valtrim.service_requests where id = v_appointment.request_id for update;
  if v_request.workflow_stage not in ('CONFIRMED', 'WORKING') or v_request.closed_at is not null then
    raise exception 'Only a confirmed visit can be cancelled' using errcode = '55000';
  end if;

  update valtrim.service_appointments
  set state = 'CANCELLED', is_current = false, cancelled_at = pg_catalog.now(),
      change_reason = p_reason,
      cancel_reason = coalesce(v_note, private.service_change_reason_label(p_reason)),
      updated_by = p_actor_id
  where id = p_appointment_id;

  update valtrim.service_requests
  set workflow_stage = 'READY_TO_PROPOSE', updated_by = p_actor_id,
      closed_at = case when v_close then pg_catalog.now() end,
      closed_by = case when v_close then p_actor_id end,
      close_reason_code = case when v_close then p_reason end,
      close_reason = case when v_close then coalesce(v_note, private.service_change_reason_label(p_reason)) end,
      duplicate_of_request_id = case when v_close then p_duplicate_of_request_id end
  where id = v_appointment.request_id;

  return jsonb_build_object(
    'appointmentId', p_appointment_id,
    'requestId', v_appointment.request_id,
    'closed', v_close
  );
end;
$function$;
comment on function valtrim.cancel_customer_service_visit(uuid, bigint, timestamptz, valtrim.service_change_reason, text, boolean, bigint) is
  'Service role only (Edge Function customer-service-appointments). Cancels a scheduled visit with a reason, live or in test mode; the request returns to Ready to propose or closes.';

-- 8. Close a request that will not get a visit (decision D2): only before a visit is
-- confirmed. A proposal still waiting for the customer is closed by the system, which
-- frees its held days. A confirmed visit is cancelled with Close the request instead.
create function valtrim.close_customer_service_request(
  p_actor_id uuid,
  p_request_id bigint,
  p_expected_updated_at timestamptz,
  p_reason valtrim.service_change_reason,
  p_note text default null,
  p_duplicate_of_request_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_note text := nullif(btrim(p_note), '');
  v_request valtrim.service_requests%rowtype;
  v_label text;
begin
  perform private.require_customer_service_coordinator_id(p_actor_id);
  perform private.check_customer_service_close(p_request_id, p_reason, v_note, p_duplicate_of_request_id);
  v_label := coalesce(v_note, private.service_change_reason_label(p_reason));

  select * into v_request from valtrim.service_requests where id = p_request_id for update;
  if not found then
    raise exception 'The Customer Service request was not found' using errcode = 'P0002';
  end if;
  if p_expected_updated_at is null or v_request.updated_at is distinct from p_expected_updated_at then
    raise exception 'This request changed after you opened it. Reload and try again.' using errcode = '40001';
  end if;
  if v_request.closed_at is not null then
    raise exception 'This request is already closed' using errcode = '55000';
  end if;
  if v_request.workflow_stage in ('CONFIRMED', 'WORKING') then
    raise exception 'This request has a confirmed visit. Cancel the visit and choose Close the request.'
      using errcode = '55000';
  end if;
  if v_request.workflow_stage not in ('NEEDS_REVIEW', 'READY_TO_PROPOSE', 'NEEDS_CONTACT', 'AWAITING_CUSTOMER') then
    raise exception 'A completed request cannot be closed' using errcode = '55000';
  end if;

  update valtrim.service_proposals
  set status = 'CANCELLED', cancelled_at = pg_catalog.now(),
      cancel_reason = left('Request closed: ' || v_label, 500), updated_by = p_actor_id
  where request_id = p_request_id and status = 'SENT';

  update valtrim.service_requests
  set workflow_stage = case when workflow_stage = 'AWAITING_CUSTOMER' then 'READY_TO_PROPOSE' else workflow_stage end,
      closed_at = pg_catalog.now(), closed_by = p_actor_id,
      close_reason_code = p_reason, close_reason = v_label,
      duplicate_of_request_id = p_duplicate_of_request_id,
      updated_by = p_actor_id
  where id = p_request_id;

  return jsonb_build_object('requestId', p_request_id, 'closed', true);
end;
$function$;
comment on function valtrim.close_customer_service_request(uuid, bigint, timestamptz, valtrim.service_change_reason, text, bigint) is
  'Service role only (Edge Function customer-service-appointments). Closes a request without a confirmed visit with a reason; a proposal still waiting is closed by the system.';

revoke all on function valtrim.reschedule_customer_service_appointment(uuid, bigint, timestamptz, timestamptz, bigint[], bigint[], jsonb, jsonb, valtrim.service_change_reason, text) from public, anon, authenticated;
revoke all on function valtrim.cancel_customer_service_visit(uuid, bigint, timestamptz, valtrim.service_change_reason, text, boolean, bigint) from public, anon, authenticated;
revoke all on function valtrim.close_customer_service_request(uuid, bigint, timestamptz, valtrim.service_change_reason, text, bigint) from public, anon, authenticated;
grant execute on function valtrim.reschedule_customer_service_appointment(uuid, bigint, timestamptz, timestamptz, bigint[], bigint[], jsonb, jsonb, valtrim.service_change_reason, text) to service_role;
grant execute on function valtrim.cancel_customer_service_visit(uuid, bigint, timestamptz, valtrim.service_change_reason, text, boolean, bigint) to service_role;
grant execute on function valtrim.close_customer_service_request(uuid, bigint, timestamptz, valtrim.service_change_reason, text, bigint) to service_role;

notify pgrst, 'reload schema';

commit;
