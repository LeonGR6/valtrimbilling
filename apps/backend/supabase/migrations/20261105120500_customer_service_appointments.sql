-- Proposal Workspace, delivery 5 (block A): persist accepted appointments.
-- Capacity rules live in the customer-service-appointments Edge Function
-- (functions/_shared/customerServiceScheduling.mjs). The database only stores the
-- accepted appointment atomically, serializes writes per technician and day,
-- and keeps integrity checks. Drafts and unaccepted options are never stored.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Every row below is reshaped or dropped. Verified empty on 2026-11-05; abort
-- instead of guessing a mapping if that is no longer true.
do $preflight$
begin
  if exists (select 1 from valtrim.service_appointments)
     or exists (select 1 from valtrim.service_schedule_proposals)
     or exists (select 1 from valtrim.service_schedule_proposal_stops) then
    raise exception 'Existing appointments or legacy proposals require an explicit mapping; no changes were applied'
      using errcode = '55000';
  end if;
end;
$preflight$;

-- 1. Retire the output of the plpgsql route generator removed in 20261021141000.
drop trigger service_request_availability_supersede_proposals on valtrim.service_request_availability;
drop trigger service_requests_supersede_proposals on valtrim.service_requests;
drop trigger service_properties_supersede_proposals on valtrim.service_properties;
drop trigger service_technician_profiles_supersede_proposals on valtrim.service_technician_profiles;
drop trigger service_technician_active_supersede_proposals on valtrim.people;
drop trigger service_scheduling_settings_supersede_proposals on valtrim.service_scheduling_settings;
drop trigger service_appointments_supersede_proposals on valtrim.service_appointments;
drop function private.supersede_service_schedule_proposals();
drop view valtrim.service_schedule_proposal_options;

alter table valtrim.service_appointments
  drop column approved_proposal_id,
  drop column manual_adjustment_reason;
drop table valtrim.service_schedule_proposal_stops;
drop table valtrim.service_schedule_proposals;
drop type valtrim.service_schedule_proposal_status;

-- A fixed buffer was replaced by per-leg travel estimates (decided 2026-11-05).
alter table valtrim.service_scheduling_settings drop column travel_buffer_minutes;

-- 2. Appointment shape: the customer's two-hour window, the work inside it, a
-- pickup copy, the full crew and how the customer accepted.
create type valtrim.service_appointment_acceptance as enum (
  'CUSTOMER_ACCEPTED_PROPOSAL',
  'COUNTER_PROPOSAL_ACCEPTED'
);

drop policy service_appointments_insert on valtrim.service_appointments;
drop policy service_appointments_update on valtrim.service_appointments;
drop index valtrim.service_appointments_technician_idx;

alter table valtrim.service_appointments
  drop column technician_id,
  add column technician_ids bigint[] not null,
  add column window_starts_at timestamptz not null,
  add column window_ends_at timestamptz not null,
  add column pickup_minutes smallint not null default 10
    check (pickup_minutes between 0 and 60),
  add column acceptance valtrim.service_appointment_acceptance not null,
  add column cancel_reason varchar(500),
  add constraint service_appointments_technicians_check
    check (cardinality(technician_ids) between 1 and 10
      and array_position(technician_ids, null) is null),
  add constraint service_appointments_window_check
    check (window_ends_at = window_starts_at + interval '2 hours'),
  add constraint service_appointments_work_in_window_check
    check (starts_at >= window_starts_at and starts_at < window_ends_at
      and ends_at + pickup_minutes * interval '1 minute' <= window_ends_at),
  add constraint service_appointments_cancel_reason_check
    check ((state = 'CANCELLED') = (nullif(btrim(cancel_reason), '') is not null)),
  add constraint service_appointments_cancelled_not_current_check
    check (state <> 'CANCELLED' or not is_current);

create index service_appointments_technicians_idx
  on valtrim.service_appointments using gin (technician_ids) where is_current;
create index service_appointments_window_idx
  on valtrim.service_appointments (window_starts_at) where is_current;

comment on column valtrim.service_appointments.starts_at is 'Internal work start inside the customer window.';
comment on column valtrim.service_appointments.ends_at is 'Internal work end (start + reviewed duration), before pickup.';
comment on column valtrim.service_appointments.technician_ids is 'Every assigned technician (a crew of two is two registered technicians).';
comment on column valtrim.service_appointments.pickup_minutes is 'Pickup minutes after the work, copied when the appointment is registered.';

-- Integrity only: who may be assigned and whether the request is open.
create or replace function valtrim.validate_service_appointment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.technician_ids is distinct from old.technician_ids then
    if cardinality(new.technician_ids) <> (
      select count(distinct technician_id) from unnest(new.technician_ids) technician_id
    ) or exists (
      select 1 from unnest(new.technician_ids) technician_id
      where not exists (
        select 1 from valtrim.people person
        join valtrim.person_roles person_role
          on person_role.person_id = person.id and person_role.role = 'SERVICE_TECHNICIAN'
        where person.id = technician_id and person.is_active
      )
    ) then
      raise exception 'Technicians must be distinct, active and have the SERVICE_TECHNICIAN role'
        using errcode = '23514';
    end if;
  end if;
  if tg_op = 'INSERT' and exists (
    select 1 from valtrim.service_requests request
    where request.id = new.request_id and request.closed_at is not null
  ) then
    raise exception 'A closed request cannot be scheduled' using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function private.audit_service_appointment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_candidate uuid := coalesce((select auth.uid()), new.updated_by, new.created_by);
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
    'acceptance', new.acceptance::text,
    'state', new.state::text,
    'is_current', new.is_current,
    'confirmation_status', new.confirmation_status::text,
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
      'acceptance', old.acceptance::text,
      'state', old.state::text,
      'is_current', old.is_current,
      'confirmation_status', old.confirmation_status::text,
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
    elsif old.confirmation_status is distinct from new.confirmation_status
       and new.confirmation_status = 'CONFIRMED' then
      v_action := 'SERVICE_APPOINTMENT_CONFIRMED';
      v_summary := format('The customer confirmed the appointment for %s.', v_request_folio);
    elsif old.confirmation_status is distinct from new.confirmation_status
       and new.confirmation_status = 'DECLINED' then
      v_action := 'SERVICE_APPOINTMENT_DECLINED';
      v_summary := format('The customer declined the appointment for %s.', v_request_folio);
    elsif old.confirmation_status is distinct from new.confirmation_status
       and new.confirmation_status = 'REMINDER_SENT' then
      v_action := 'SERVICE_APPOINTMENT_REMINDER_SENT';
      v_summary := format('A confirmation reminder was sent for %s.', v_request_folio);
    elsif old.confirmation_status is distinct from new.confirmation_status
       and new.confirmation_status = 'PHONE_FOLLOW_UP' then
      v_action := 'SERVICE_APPOINTMENT_PHONE_FOLLOW_UP';
      v_summary := format('Phone follow-up was requested for %s.', v_request_folio);
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
$$;

revoke all on function private.audit_service_appointment_change() from public, anon, authenticated;

-- 3. Travel minutes between two visits, keyed like the planner ("from>to").
-- Routes API will write the same rows later with another source.
create type valtrim.service_travel_source as enum ('MANUAL', 'ROUTES_API');

create table valtrim.service_travel_estimates (
  from_request_id bigint not null
    references valtrim.service_requests(id) on delete cascade,
  to_request_id bigint not null
    references valtrim.service_requests(id) on delete cascade,
  minutes smallint not null check (minutes between 0 and 999),
  source valtrim.service_travel_source not null default 'MANUAL',
  created_by uuid references valtrim.app_users(id) on delete set null,
  updated_by uuid references valtrim.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (from_request_id, to_request_id),
  check (from_request_id <> to_request_id)
);

create index service_travel_estimates_to_idx
  on valtrim.service_travel_estimates (to_request_id);

create trigger service_travel_estimates_set_updated_at
before update on valtrim.service_travel_estimates
for each row execute function valtrim.set_updated_at();

create trigger stamp_and_validate_actor
before insert or update on valtrim.service_travel_estimates
for each row execute function private.stamp_and_validate_actor();

alter table valtrim.service_travel_estimates enable row level security;
revoke all on valtrim.service_travel_estimates from public, anon, authenticated;
grant select on valtrim.service_travel_estimates to authenticated;

create policy service_travel_estimates_select
on valtrim.service_travel_estimates for select to authenticated
using ((select private.has_app_role('ADMIN', 'SCHEDULING')));

-- 4. Atomic write for the Edge Function. It does not decide capacity: it only
-- checks the actor, the request version and that the technicians' day is the
-- one the function validated, then stores everything in one transaction.
create function valtrim.register_customer_service_appointment(
  p_actor_id uuid,
  p_request_id bigint,
  p_expected_request_updated_at timestamptz,
  p_expected_appointment_ids bigint[],
  p_appointment jsonb,
  p_travel jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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

  begin
    insert into valtrim.service_appointments (
      request_id, technician_ids, window_starts_at, window_ends_at, starts_at, ends_at,
      pickup_minutes, acceptance, state, is_current, confirmation_status, confirmed_at,
      created_by, updated_by
    ) values (
      p_request_id, v_technician_ids, v_window_starts_at,
      (p_appointment ->> 'windowEndsAt')::timestamptz,
      (p_appointment ->> 'startsAt')::timestamptz,
      (p_appointment ->> 'endsAt')::timestamptz,
      (p_appointment ->> 'pickupMinutes')::smallint,
      (p_appointment ->> 'acceptance')::valtrim.service_appointment_acceptance,
      'SCHEDULED', true, 'CONFIRMED', pg_catalog.now(), p_actor_id, p_actor_id
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

revoke all on function valtrim.register_customer_service_appointment(uuid, bigint, timestamptz, bigint[], jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function valtrim.register_customer_service_appointment(uuid, bigint, timestamptz, bigint[], jsonb, jsonb)
  to service_role;
comment on function valtrim.register_customer_service_appointment(uuid, bigint, timestamptz, bigint[], jsonb, jsonb) is
  'Service role only. Stores an appointment validated by the customer-service-appointments Edge Function, its manual travel estimates and the CONFIRMED stage in one transaction. Rejects a stale request or a changed technician day with 40001.';

-- Cancelling has no capacity rule, so the signed-in coordinator calls it directly.
create function valtrim.cancel_customer_service_appointment(
  p_appointment_id bigint,
  p_expected_updated_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_customer_service_actor();
  v_appointment valtrim.service_appointments%rowtype;
  v_time_zone text;
  v_day date;
  v_technician_id bigint;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'Enter a cancellation reason of 500 characters or fewer' using errcode = '22023';
  end if;

  select * into v_appointment from valtrim.service_appointments where id = p_appointment_id;
  if not found then
    raise exception 'The appointment was not found' using errcode = 'P0002';
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
    raise exception 'This appointment changed after you opened it. Reload and try again.' using errcode = '40001';
  end if;
  if not v_appointment.is_current or v_appointment.state <> 'SCHEDULED' then
    raise exception 'Only a scheduled appointment can be cancelled' using errcode = '55000';
  end if;

  update valtrim.service_appointments
  set state = 'CANCELLED', cancelled_at = pg_catalog.now(), is_current = false,
      cancel_reason = v_reason
  where id = p_appointment_id;

  update valtrim.service_requests
  set workflow_stage = 'READY_TO_PROPOSE'
  where id = v_appointment.request_id and workflow_stage = 'CONFIRMED';

  return jsonb_build_object('appointmentId', p_appointment_id, 'requestId', v_appointment.request_id);
end;
$function$;

revoke all on function valtrim.cancel_customer_service_appointment(bigint, timestamptz, text)
  from public, anon, authenticated;
grant execute on function valtrim.cancel_customer_service_appointment(bigint, timestamptz, text)
  to authenticated;
comment on function valtrim.cancel_customer_service_appointment(bigint, timestamptz, text) is
  'ADMIN/SCHEDULING only. Cancels a scheduled appointment with a reason, releases it and returns its CONFIRMED request to READY_TO_PROPOSE.';

notify pgrst, 'reload schema';
commit;
