begin;

-- Phase 1C keeps route approval behind one transactional RPC. Browser clients
-- retain read-only access to proposals and cannot create appointments directly.

alter table valtrim.service_appointments
  add column approved_proposal_id bigint
    references valtrim.service_schedule_proposals(id) on delete restrict,
  add column manual_adjustment_reason varchar(500),
  add constraint service_appointments_manual_adjustment_reason_check
    check (
      manual_adjustment_reason is null
      or btrim(manual_adjustment_reason) <> ''
    );

create unique index service_appointments_approved_proposal_request_uq
  on valtrim.service_appointments (approved_proposal_id, request_id)
  where approved_proposal_id is not null;

alter table valtrim.service_schedule_proposals
  add constraint service_schedule_proposals_review_check
    check (
      (
        status not in ('APPROVED', 'REJECTED')
        or (reviewed_by is not null and reviewed_at is not null)
      )
      and (
        manual_adjustment_reason is null
        or (
          status = 'APPROVED'
          and btrim(manual_adjustment_reason) <> ''
        )
      )
    );

-- The baseline helper predates dispatcher approval and has no mandatory reason
-- for a manual schedule. Keep it unavailable through the Data API.
revoke all on function valtrim.replace_current_service_appointment(
  bigint, timestamptz, timestamptz, bigint, text, uuid
) from public, anon, authenticated;

create function private.approve_service_schedule_proposal_internal(
  p_proposal_id bigint,
  p_adjustments jsonb,
  p_manual_adjustment_reason text
)
returns table (
  appointment_id bigint,
  request_id bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_customer_service_actor();
  v_proposal record;
  v_profile record;
  v_stop record;
  v_adjustment jsonb;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_time_zone text;
  v_buffer_minutes integer;
  v_has_adjustments boolean := false;
  v_reason text := nullif(btrim(p_manual_adjustment_reason), '');
begin
  if p_proposal_id is null then
    raise exception 'A schedule proposal is required' using errcode = '22023';
  end if;

  if p_adjustments is null then
    p_adjustments := '[]'::jsonb;
  end if;

  if jsonb_typeof(p_adjustments) <> 'array' then
    raise exception 'Schedule adjustments must be a JSON array'
      using errcode = '22023';
  end if;

  select proposal.*
  into v_proposal
  from valtrim.service_schedule_proposals proposal
  where proposal.id = p_proposal_id
  for update;

  if not found then
    raise exception 'The schedule proposal was not found'
      using errcode = 'P0002';
  end if;

  if v_proposal.status <> 'PENDING' then
    raise exception 'Only a pending schedule proposal can be approved'
      using errcode = '22023';
  end if;

  select settings.time_zone, settings.travel_buffer_minutes
  into v_time_zone, v_buffer_minutes
  from valtrim.service_scheduling_settings settings
  where settings.id = 1;

  if v_proposal.proposed_on < (now() at time zone v_time_zone)::date then
    raise exception 'This schedule proposal has expired; recalculate the options'
      using errcode = '22023';
  end if;

  -- Serialize approvals for this technician. Direct appointment writes are
  -- already revoked, so the lock closes the concurrent dispatcher race.
  perform pg_catalog.pg_advisory_xact_lock(
    84217,
    (v_proposal.technician_id % 2147483647)::integer
  );

  select
    profile.workday_starts_at,
    profile.workday_ends_at,
    person.is_active
  into v_profile
  from valtrim.service_technician_profiles profile
  join valtrim.people person on person.id = profile.person_id
  where profile.person_id = v_proposal.technician_id
  for update of profile, person;

  if not found or not v_profile.is_active then
    raise exception 'The proposed technician is no longer operational'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from valtrim.service_schedule_proposal_stops stop
    where stop.proposal_id = p_proposal_id
  ) then
    raise exception 'The schedule proposal has no stops'
      using errcode = '22023';
  end if;

  perform request.id
  from valtrim.service_requests request
  join valtrim.service_schedule_proposal_stops stop
    on stop.request_id = request.id
  where stop.proposal_id = p_proposal_id
  order by request.id
  for update of request;

  if exists (
    select 1
    from jsonb_array_elements(p_adjustments) adjustment
    where jsonb_typeof(adjustment) <> 'object'
      or nullif(adjustment ->> 'requestId', '') is null
      or nullif(adjustment ->> 'startsAt', '') is null
      or nullif(adjustment ->> 'endsAt', '') is null
  ) then
    raise exception 'Every adjustment requires requestId, startsAt and endsAt'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_adjustments) adjustment
    group by (adjustment ->> 'requestId')::bigint
    having count(*) > 1
  ) then
    raise exception 'A proposal stop can only be adjusted once'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_adjustments) adjustment
    left join valtrim.service_schedule_proposal_stops stop
      on stop.proposal_id = p_proposal_id
     and stop.request_id = (adjustment ->> 'requestId')::bigint
    where stop.id is null
  ) then
    raise exception 'An adjustment does not belong to this proposal'
      using errcode = '22023';
  end if;

  for v_stop in
    select stop.*
    from valtrim.service_schedule_proposal_stops stop
    where stop.proposal_id = p_proposal_id
    order by stop.stop_order
  loop
    select adjustment
    into v_adjustment
    from jsonb_array_elements(p_adjustments) adjustment
    where (adjustment ->> 'requestId')::bigint = v_stop.request_id;

    v_starts_at := coalesce(
      (v_adjustment ->> 'startsAt')::timestamptz,
      v_stop.starts_at
    );
    v_ends_at := coalesce(
      (v_adjustment ->> 'endsAt')::timestamptz,
      v_stop.ends_at
    );

    if v_starts_at is distinct from v_stop.starts_at
       or v_ends_at is distinct from v_stop.ends_at then
      v_has_adjustments := true;
    end if;

    if v_ends_at <= v_starts_at then
      raise exception 'Every adjusted appointment must end after it starts'
        using errcode = '22023';
    end if;

    if v_ends_at - v_starts_at <> v_stop.ends_at - v_stop.starts_at then
      raise exception 'A manual adjustment cannot change the estimated duration'
        using errcode = '22023';
    end if;

    if (v_starts_at at time zone v_time_zone)::date
         <> v_proposal.proposed_on
       or (v_ends_at at time zone v_time_zone)::date
         <> v_proposal.proposed_on then
      raise exception 'Adjusted appointments must stay on the proposed day'
        using errcode = '22023';
    end if;

    if (v_starts_at at time zone v_time_zone)::time
         < v_profile.workday_starts_at
       or (v_ends_at at time zone v_time_zone)::time
         > v_profile.workday_ends_at then
      raise exception 'An adjusted appointment is outside the technician workday'
        using errcode = '22023';
    end if;

    if not exists (
      select 1
      from valtrim.service_request_availability availability
      where availability.request_id = v_stop.request_id
        and availability.available_from <= v_starts_at
        and availability.available_until >= v_ends_at
    ) then
      raise exception 'An appointment no longer fits the customer availability'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from valtrim.service_requests request
      where request.id = v_stop.request_id
        and request.status in ('COMPLETED', 'CLOSED')
    ) then
      raise exception 'A proposal request is already completed or closed'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from valtrim.service_appointments appointment
      where appointment.request_id = v_stop.request_id
        and appointment.is_current
    ) then
      raise exception 'A proposal request already has a current appointment'
        using errcode = '23505';
    end if;

    if exists (
      select 1
      from valtrim.service_appointments appointment
      where appointment.technician_id = v_proposal.technician_id
        and appointment.is_current
        and appointment.state <> 'CANCELLED'
        and v_starts_at < appointment.ends_at
          + make_interval(mins => v_buffer_minutes)
        and v_ends_at > appointment.starts_at
          - make_interval(mins => v_buffer_minutes)
    ) then
      raise exception 'The technician schedule changed; recalculate the options'
        using errcode = '23P01';
    end if;
  end loop;

  if jsonb_array_length(p_adjustments) > 0 and not v_has_adjustments then
    raise exception 'The manual adjustment does not change a proposal time'
      using errcode = '22023';
  end if;

  if v_has_adjustments and v_reason is null then
    raise exception 'A reason is required for a manual schedule adjustment'
      using errcode = '22023';
  end if;

  if length(v_reason) > 500 then
    raise exception 'The manual adjustment reason must be 500 characters or fewer'
      using errcode = '22023';
  end if;

  if exists (
    with final_stops as (
      select
        stop.stop_order,
        stop.travel_buffer_minutes,
        coalesce(
          (adjustment.item ->> 'startsAt')::timestamptz,
          stop.starts_at
        ) as starts_at,
        coalesce(
          (adjustment.item ->> 'endsAt')::timestamptz,
          stop.ends_at
        ) as ends_at
      from valtrim.service_schedule_proposal_stops stop
      left join lateral (
        select item
        from jsonb_array_elements(p_adjustments) item
        where (item ->> 'requestId')::bigint = stop.request_id
      ) adjustment on true
      where stop.proposal_id = p_proposal_id
    )
    select 1
    from final_stops current_stop
    join final_stops next_stop
      on next_stop.stop_order = current_stop.stop_order + 1
    where next_stop.starts_at < current_stop.ends_at
      + make_interval(mins => current_stop.travel_buffer_minutes)
  ) then
    raise exception 'Adjusted route stops overlap or omit the travel buffer'
      using errcode = '23P01';
  end if;

  update valtrim.service_schedule_proposals proposal
  set status = 'APPROVED',
      reviewed_by = v_actor_id,
      reviewed_at = now(),
      manual_adjustment_reason = case
        when v_has_adjustments then v_reason
        else null
      end
  where proposal.id = p_proposal_id;

  update valtrim.service_schedule_proposals alternative
  set status = 'REJECTED',
      reviewed_by = v_actor_id,
      reviewed_at = now(),
      manual_adjustment_reason = null
  where alternative.id <> p_proposal_id
    and alternative.status = 'PENDING'
    and exists (
      select 1
      from valtrim.service_schedule_proposal_stops alternative_stop
      join valtrim.service_schedule_proposal_stops approved_stop
        on approved_stop.proposal_id = p_proposal_id
       and approved_stop.request_id = alternative_stop.request_id
      where alternative_stop.proposal_id = alternative.id
    );

  for v_stop in
    select stop.*
    from valtrim.service_schedule_proposal_stops stop
    where stop.proposal_id = p_proposal_id
    order by stop.stop_order
  loop
    select adjustment
    into v_adjustment
    from jsonb_array_elements(p_adjustments) adjustment
    where (adjustment ->> 'requestId')::bigint = v_stop.request_id;

    v_starts_at := coalesce(
      (v_adjustment ->> 'startsAt')::timestamptz,
      v_stop.starts_at
    );
    v_ends_at := coalesce(
      (v_adjustment ->> 'endsAt')::timestamptz,
      v_stop.ends_at
    );

    insert into valtrim.service_appointments (
      request_id,
      technician_id,
      starts_at,
      ends_at,
      state,
      is_current,
      notes,
      confirmation_status,
      confirmation_sent_at,
      approved_proposal_id,
      manual_adjustment_reason,
      created_by,
      updated_by
    ) values (
      v_stop.request_id,
      v_proposal.technician_id,
      v_starts_at,
      v_ends_at,
      'SCHEDULED',
      true,
      format('Approved route proposal %s, stop %s', p_proposal_id, v_stop.stop_order),
      'NOT_SENT',
      null,
      p_proposal_id,
      case
        when v_starts_at is distinct from v_stop.starts_at
          or v_ends_at is distinct from v_stop.ends_at
        then v_reason
        else null
      end,
      v_actor_id,
      v_actor_id
    )
    returning id into appointment_id;

    request_id := v_stop.request_id;

    update valtrim.service_requests request
    set status = case
          when request.status = 'NEW' then 'CONTACT_NEEDED'
          else request.status
        end,
        status_note = 'Appointment approved; customer notification has not been sent.',
        updated_by = v_actor_id
    where request.id = v_stop.request_id;

    return next;
  end loop;

  return;
end;
$$;

revoke all on function private.approve_service_schedule_proposal_internal(
  bigint, jsonb, text
) from public, anon, authenticated;

create function valtrim.approve_service_schedule_proposal(
  p_proposal_id bigint,
  p_adjustments jsonb default '[]'::jsonb,
  p_manual_adjustment_reason text default null
)
returns table (
  appointment_id bigint,
  request_id bigint
)
language sql
security definer
set search_path = ''
as $$
  select *
  from private.approve_service_schedule_proposal_internal(
    p_proposal_id,
    p_adjustments,
    p_manual_adjustment_reason
  );
$$;

revoke all on function valtrim.approve_service_schedule_proposal(
  bigint, jsonb, text
) from public, anon, authenticated;
grant execute on function valtrim.approve_service_schedule_proposal(
  bigint, jsonb, text
) to authenticated;

comment on function valtrim.approve_service_schedule_proposal(
  bigint, jsonb, text
) is
  'Atomically approves one pending route, rejects alternatives, and creates NOT_SENT appointments for every stop.';

notify pgrst, 'reload schema';

commit;
