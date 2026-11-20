-- Block B, step B2 (docs/customer-service-block-b-plan.md): a sent proposal's
-- options occupy their technicians like appointments.
--
-- The view service_proposal_holds lists those options for the planner and the
-- Edge Function. Registration now also compares the held options of the technicians' day with the
-- ones the Edge Function validated, and refuses a request whose own proposal is
-- still waiting for the customer. The new argument defaults to no held options, so
-- the deployed Edge Function keeps working until it is redeployed; until then no
-- proposal can be sent, so there is nothing to compare. Otherwise unchanged from
-- 20261105120000.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- One definition of a held option for the planner and the Edge Function: every
-- option of a proposal that is still waiting for the customer. Coordinators read
-- it through the tables' RLS.
create view valtrim.service_proposal_holds
with (security_invoker = true) as
select
  option.id as option_id,
  option.option_number,
  proposal.id as proposal_id,
  proposal.request_id,
  request.folio,
  proposal.sent_at,
  option.technician_ids,
  option.window_starts_at,
  option.window_ends_at,
  option.starts_at,
  option.ends_at,
  option.pickup_minutes
from valtrim.service_proposal_options option
join valtrim.service_proposals proposal on proposal.id = option.proposal_id
join valtrim.service_requests request on request.id = proposal.request_id
where proposal.status = 'SENT';

revoke all on valtrim.service_proposal_holds from public, anon, authenticated;
grant select on valtrim.service_proposal_holds to authenticated, service_role;
comment on view valtrim.service_proposal_holds is
  'Options of SENT proposals. They occupy their technicians like appointments until the customer answers.';

drop function valtrim.register_customer_service_appointment(uuid, bigint, timestamptz, bigint[], jsonb, jsonb);

create function valtrim.register_customer_service_appointment(
  p_actor_id uuid,
  p_request_id bigint,
  p_expected_request_updated_at timestamptz,
  p_expected_appointment_ids bigint[],
  p_appointment jsonb,
  p_travel jsonb,
  p_expected_option_ids bigint[] default '{}'::bigint[]
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

revoke all on function valtrim.register_customer_service_appointment(uuid, bigint, timestamptz, bigint[], jsonb, jsonb, bigint[])
  from public, anon, authenticated;
grant execute on function valtrim.register_customer_service_appointment(uuid, bigint, timestamptz, bigint[], jsonb, jsonb, bigint[])
  to service_role;
comment on function valtrim.register_customer_service_appointment(uuid, bigint, timestamptz, bigint[], jsonb, jsonb, bigint[]) is
  'Service role only. Stores an appointment validated by the customer-service-appointments Edge Function, its manual travel estimates and the CONFIRMED stage in one transaction. Rejects a stale request, a changed technician day (appointments or held proposal options) with 40001, and a request whose proposal is still waiting for the customer.';

notify pgrst, 'reload schema';
commit;
