begin;

create type valtrim.service_schedule_proposal_status as enum (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'SUPERSEDED',
  'EXPIRED'
);

create table valtrim.service_schedule_proposals (
  id bigint generated always as identity primary key,
  requested_for_request_id bigint not null
    references valtrim.service_requests(id) on delete restrict,
  technician_id bigint not null
    references valtrim.people(id) on delete restrict,
  proposed_on date not null,
  proposal_rank smallint not null check (proposal_rank between 1 and 5),
  status valtrim.service_schedule_proposal_status not null default 'PENDING',
  score numeric(12,2) not null,
  total_distance_miles numeric(8,2) not null
    check (total_distance_miles >= 0),
  work_minutes smallint not null check (work_minutes > 0),
  travel_buffer_minutes smallint not null
    check (travel_buffer_minutes >= 0),
  remaining_work_minutes smallint not null,
  explanation jsonb not null default '{}'::jsonb
    check (jsonb_typeof(explanation) = 'object'),
  generated_by uuid not null
    references valtrim.app_users(id) on delete restrict,
  reviewed_by uuid references valtrim.app_users(id) on delete set null,
  reviewed_at timestamptz,
  manual_adjustment_reason varchar(500),
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table valtrim.service_schedule_proposal_stops (
  id bigint generated always as identity primary key,
  proposal_id bigint not null
    references valtrim.service_schedule_proposals(id) on delete cascade,
  request_id bigint not null
    references valtrim.service_requests(id) on delete restrict,
  stop_order smallint not null check (stop_order between 1 and 20),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  latitude numeric(9,6) not null check (latitude between -90 and 90),
  longitude numeric(9,6) not null check (longitude between -180 and 180),
  distance_from_previous_miles numeric(8,2) not null
    check (distance_from_previous_miles >= 0),
  travel_buffer_minutes smallint not null
    check (travel_buffer_minutes >= 0),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (proposal_id, request_id),
  unique (proposal_id, stop_order)
);

create index service_schedule_proposals_request_idx
  on valtrim.service_schedule_proposals (
    requested_for_request_id,
    status,
    proposal_rank
  );
create index service_schedule_proposals_technician_day_idx
  on valtrim.service_schedule_proposals (technician_id, proposed_on, status);
create index service_schedule_proposal_stops_request_idx
  on valtrim.service_schedule_proposal_stops (request_id, proposal_id);
create index service_schedule_proposal_stops_time_idx
  on valtrim.service_schedule_proposal_stops (proposal_id, starts_at, ends_at);

create trigger service_schedule_proposals_set_updated_at
before update on valtrim.service_schedule_proposals
for each row execute function valtrim.set_updated_at();

alter table valtrim.service_schedule_proposals enable row level security;
alter table valtrim.service_schedule_proposal_stops enable row level security;

revoke all on valtrim.service_schedule_proposals
  from public, anon, authenticated;
revoke all on valtrim.service_schedule_proposal_stops
  from public, anon, authenticated;
revoke all on sequence valtrim.service_schedule_proposals_id_seq
  from public, anon, authenticated;
revoke all on sequence valtrim.service_schedule_proposal_stops_id_seq
  from public, anon, authenticated;

grant select on valtrim.service_schedule_proposals to authenticated;
grant select on valtrim.service_schedule_proposal_stops to authenticated;

create policy service_schedule_proposals_select
on valtrim.service_schedule_proposals for select to authenticated
using ((select private.has_app_role('ADMIN', 'SCHEDULING')));

create policy service_schedule_proposal_stops_select
on valtrim.service_schedule_proposal_stops for select to authenticated
using (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and exists (
    select 1
    from valtrim.service_schedule_proposals proposal
    where proposal.id = service_schedule_proposal_stops.proposal_id
  )
);

create function private.service_distance_miles(
  p_from_latitude numeric,
  p_from_longitude numeric,
  p_to_latitude numeric,
  p_to_longitude numeric
)
returns numeric
language sql
immutable
strict
set search_path = ''
as $$
  select round((
    3958.7613 * 2 * asin(
      least(1, sqrt(
        power(sin(radians((p_to_latitude - p_from_latitude)::double precision) / 2), 2)
        + cos(radians(p_from_latitude::double precision))
          * cos(radians(p_to_latitude::double precision))
          * power(sin(radians((p_to_longitude - p_from_longitude)::double precision) / 2), 2)
      ))
    )
  )::numeric, 2);
$$;

revoke all on function private.service_distance_miles(
  numeric, numeric, numeric, numeric
) from public, anon, authenticated;

create function private.find_service_schedule_candidates(p_request_id bigint)
returns table (
  technician_id bigint,
  proposed_on date,
  target_starts_at timestamptz,
  target_ends_at timestamptz,
  target_latitude numeric,
  target_longitude numeric,
  target_distance_from_previous numeric,
  companion_request_id bigint,
  companion_starts_at timestamptz,
  companion_ends_at timestamptz,
  companion_latitude numeric,
  companion_longitude numeric,
  companion_distance_from_previous numeric,
  total_distance_miles numeric,
  work_minutes integer,
  total_buffer_minutes integer,
  remaining_work_minutes integer,
  score numeric,
  explanation jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select
      request.id,
      request.folio,
      request.priority,
      request.due_on,
      request.estimated_duration_minutes,
      property.latitude,
      property.longitude,
      settings.time_zone,
      settings.travel_buffer_minutes,
      settings.distance_green_max_miles,
      settings.distance_yellow_max_miles,
      timezone(settings.time_zone, now())::date as today
    from valtrim.service_requests request
    join valtrim.service_properties property on property.id = request.property_id
    cross join valtrim.service_scheduling_settings settings
    where request.id = p_request_id
      and settings.id = 1
      and request.status not in ('COMPLETED', 'CLOSED')
      and request.due_on >= timezone(settings.time_zone, now())::date
      and request.work_type is not null
      and request.estimated_duration_minutes is not null
      and property.latitude is not null
      and property.longitude is not null
      and not exists (
        select 1
        from valtrim.service_appointments appointment
        where appointment.request_id = request.id
          and appointment.is_current
          and appointment.state <> 'CANCELLED'
      )
  ),
  technicians as (
    select
      person.id,
      profile.workday_starts_at,
      profile.workday_ends_at,
      profile.start_latitude,
      profile.start_longitude
    from valtrim.people person
    join valtrim.person_roles person_role
      on person_role.person_id = person.id
     and person_role.role = 'SERVICE_TECHNICIAN'
    join valtrim.service_technician_profiles profile
      on profile.person_id = person.id
    where person.is_active
      and profile.start_latitude is not null
      and profile.start_longitude is not null
  ),
  availability_ranges as (
    select
      target.*,
      availability.available_from,
      availability.available_until,
      greatest(
        target.today,
        timezone(target.time_zone, availability.available_from)::date
      ) as first_day,
      least(
        target.due_on,
        timezone(target.time_zone, availability.available_until)::date
      ) as last_day
    from target
    join valtrim.service_request_availability availability
      on availability.request_id = target.id
  ),
  availability_days as (
    select
      availability_range.*,
      (availability_range.first_day + day_offset)::date as candidate_day
    from availability_ranges availability_range
    cross join lateral generate_series(
      0,
      greatest(availability_range.last_day - availability_range.first_day, -1)
    ) day_offset
    where availability_range.last_day >= availability_range.first_day
  ),
  candidate_windows as (
    select
      availability_day.*,
      technician.id as technician_id,
      technician.workday_starts_at,
      technician.workday_ends_at,
      technician.start_latitude,
      technician.start_longitude,
      greatest(
        availability_day.available_from,
        (availability_day.candidate_day + technician.workday_starts_at)
          at time zone availability_day.time_zone,
        date_trunc('hour', now())
          + ceil(
              extract(epoch from (now() - date_trunc('hour', now()))) / 900
            )::integer * interval '15 minutes'
      ) as window_starts_at,
      least(
        availability_day.available_until,
        (availability_day.candidate_day + technician.workday_ends_at)
          at time zone availability_day.time_zone
      ) as window_ends_at
    from availability_days availability_day
    cross join technicians technician
    where extract(isodow from availability_day.candidate_day) between 1 and 5
  ),
  slots as (
    select distinct on (
      candidate_window.technician_id,
      slot_start.starts_at
    )
      candidate_window.*,
      slot_start.starts_at as candidate_starts_at,
      slot_start.starts_at
        + make_interval(mins => candidate_window.estimated_duration_minutes)
          as candidate_ends_at
    from candidate_windows candidate_window
    cross join lateral generate_series(
      candidate_window.window_starts_at,
      candidate_window.window_ends_at
        - make_interval(mins => candidate_window.estimated_duration_minutes),
      interval '15 minutes'
    ) slot_start(starts_at)
    where candidate_window.window_ends_at - candidate_window.window_starts_at
      >= make_interval(mins => candidate_window.estimated_duration_minutes)
    order by candidate_window.technician_id, slot_start.starts_at
  ),
  valid_slots as (
    select slot.*
    from slots slot
    where not exists (
      select 1
      from valtrim.service_appointments appointment
      where appointment.technician_id = slot.technician_id
        and appointment.is_current
        and appointment.state <> 'CANCELLED'
        and appointment.starts_at < slot.candidate_ends_at
          + make_interval(mins => slot.travel_buffer_minutes)
        and appointment.ends_at > slot.candidate_starts_at
          - make_interval(mins => slot.travel_buffer_minutes)
    )
  ),
  enriched as (
    select
      slot.*,
      previous_appointment.appointment_id as previous_appointment_id,
      previous_appointment.folio as previous_folio,
      coalesce(
        previous_appointment.latitude,
        slot.start_latitude
      ) as previous_latitude,
      coalesce(
        previous_appointment.longitude,
        slot.start_longitude
      ) as previous_longitude,
      next_appointment.appointment_id as next_appointment_id,
      next_appointment.folio as next_folio,
      day_load.appointment_count,
      day_load.appointment_minutes,
      companion.request_id as companion_request_id,
      companion.folio as companion_folio,
      companion.duration_minutes as companion_duration_minutes,
      companion.starts_at as companion_starts_at,
      companion.ends_at as companion_ends_at,
      companion.latitude as companion_latitude,
      companion.longitude as companion_longitude,
      companion.distance_miles as companion_distance_miles
    from valid_slots slot
    left join lateral (
      select
        appointment.id as appointment_id,
        request.folio,
        property.latitude,
        property.longitude
      from valtrim.service_appointments appointment
      join valtrim.service_requests request on request.id = appointment.request_id
      join valtrim.service_properties property on property.id = request.property_id
      where appointment.technician_id = slot.technician_id
        and appointment.is_current
        and appointment.state <> 'CANCELLED'
        and timezone(slot.time_zone, appointment.starts_at)::date = slot.candidate_day
        and appointment.ends_at <= slot.candidate_starts_at
      order by appointment.ends_at desc, appointment.id desc
      limit 1
    ) previous_appointment on true
    left join lateral (
      select
        appointment.id as appointment_id,
        request.folio
      from valtrim.service_appointments appointment
      join valtrim.service_requests request on request.id = appointment.request_id
      where appointment.technician_id = slot.technician_id
        and appointment.is_current
        and appointment.state <> 'CANCELLED'
        and timezone(slot.time_zone, appointment.starts_at)::date = slot.candidate_day
        and appointment.starts_at >= slot.candidate_ends_at
      order by appointment.starts_at, appointment.id
      limit 1
    ) next_appointment on true
    cross join lateral (
      select
        count(appointment.id)::integer as appointment_count,
        coalesce(sum(
          extract(epoch from (appointment.ends_at - appointment.starts_at)) / 60
        ), 0)::integer as appointment_minutes
      from valtrim.service_appointments appointment
      where appointment.technician_id = slot.technician_id
        and appointment.is_current
        and appointment.state <> 'CANCELLED'
        and timezone(slot.time_zone, appointment.starts_at)::date = slot.candidate_day
    ) day_load
    left join lateral (
      select
        other_request.id as request_id,
        other_request.folio,
        other_request.estimated_duration_minutes as duration_minutes,
        slot.candidate_ends_at
          + make_interval(mins => slot.travel_buffer_minutes) as starts_at,
        slot.candidate_ends_at
          + make_interval(
              mins => slot.travel_buffer_minutes
                + other_request.estimated_duration_minutes
            ) as ends_at,
        other_property.latitude,
        other_property.longitude,
        private.service_distance_miles(
          slot.latitude,
          slot.longitude,
          other_property.latitude,
          other_property.longitude
        ) as distance_miles
      from valtrim.service_requests other_request
      join valtrim.service_properties other_property
        on other_property.id = other_request.property_id
      join valtrim.service_request_availability other_availability
        on other_availability.request_id = other_request.id
       and other_availability.available_from <= slot.candidate_ends_at
         + make_interval(mins => slot.travel_buffer_minutes)
       and other_availability.available_until >= slot.candidate_ends_at
         + make_interval(
             mins => slot.travel_buffer_minutes
               + other_request.estimated_duration_minutes
           )
      where other_request.id <> slot.id
        and other_request.status not in ('COMPLETED', 'CLOSED')
        and other_request.due_on >= slot.candidate_day
        and other_request.work_type is not null
        and other_request.estimated_duration_minutes is not null
        and other_property.latitude is not null
        and other_property.longitude is not null
        and slot.candidate_ends_at
          + make_interval(
              mins => slot.travel_buffer_minutes
                + other_request.estimated_duration_minutes
            ) <= (slot.candidate_day + slot.workday_ends_at)
              at time zone slot.time_zone
        and not exists (
          select 1
          from valtrim.service_appointments current_appointment
          where current_appointment.request_id = other_request.id
            and current_appointment.is_current
            and current_appointment.state <> 'CANCELLED'
        )
        and not exists (
          select 1
          from valtrim.service_appointments occupied
          where occupied.technician_id = slot.technician_id
            and occupied.is_current
            and occupied.state <> 'CANCELLED'
            and occupied.starts_at < slot.candidate_ends_at
              + make_interval(
                  mins => slot.travel_buffer_minutes
                    + other_request.estimated_duration_minutes
                    + slot.travel_buffer_minutes
                )
            and occupied.ends_at > slot.candidate_ends_at
        )
      order by
        case
          when private.service_distance_miles(
            slot.latitude,
            slot.longitude,
            other_property.latitude,
            other_property.longitude
          ) <= slot.distance_green_max_miles then 0
          when private.service_distance_miles(
            slot.latitude,
            slot.longitude,
            other_property.latitude,
            other_property.longitude
          ) <= slot.distance_yellow_max_miles then 1
          else 2
        end,
        other_request.due_on,
        case other_request.priority
          when 'HIGH' then 0
          when 'MEDIUM' then 1
          else 2
        end,
        private.service_distance_miles(
          slot.latitude,
          slot.longitude,
          other_property.latitude,
          other_property.longitude
        ),
        other_request.id
      limit 1
    ) companion on true
  ),
  measured as (
    select
      enriched.*,
      private.service_distance_miles(
        enriched.previous_latitude,
        enriched.previous_longitude,
        enriched.latitude,
        enriched.longitude
      ) as target_leg_miles,
      coalesce(route.total_distance_miles, 0) as route_distance_miles
    from enriched
    cross join lateral (
      select round((
        private.service_distance_miles(
          enriched.start_latitude,
          enriched.start_longitude,
          (array_agg(point.latitude order by point.starts_at, point.request_id))[1],
          (array_agg(point.longitude order by point.starts_at, point.request_id))[1]
        )
        + coalesce(sum(
            private.service_distance_miles(
              sequenced.previous_latitude,
              sequenced.previous_longitude,
              sequenced.latitude,
              sequenced.longitude
            )
          ) filter (where sequenced.previous_latitude is not null), 0)
        + private.service_distance_miles(
          (array_agg(point.latitude order by point.starts_at desc, point.request_id desc))[1],
          (array_agg(point.longitude order by point.starts_at desc, point.request_id desc))[1],
          enriched.start_latitude,
          enriched.start_longitude
        )
      )::numeric, 2) as total_distance_miles
      from (
        select
          route_point.*,
          lag(route_point.latitude) over (
            order by route_point.starts_at, route_point.request_id
          ) as previous_latitude,
          lag(route_point.longitude) over (
            order by route_point.starts_at, route_point.request_id
          ) as previous_longitude
        from (
          select
            appointment.request_id,
            appointment.starts_at,
            property.latitude,
            property.longitude
          from valtrim.service_appointments appointment
          join valtrim.service_requests request on request.id = appointment.request_id
          join valtrim.service_properties property on property.id = request.property_id
          where appointment.technician_id = enriched.technician_id
            and appointment.is_current
            and appointment.state <> 'CANCELLED'
            and timezone(enriched.time_zone, appointment.starts_at)::date
              = enriched.candidate_day
            and property.latitude is not null
            and property.longitude is not null
          union all
          select
            enriched.id,
            enriched.candidate_starts_at,
            enriched.latitude,
            enriched.longitude
          union all
          select
            enriched.companion_request_id,
            enriched.companion_starts_at,
            enriched.companion_latitude,
            enriched.companion_longitude
          where enriched.companion_request_id is not null
        ) route_point
      ) sequenced
      cross join lateral (
        select
          sequenced.request_id,
          sequenced.starts_at,
          sequenced.latitude,
          sequenced.longitude
      ) point
    ) route
  )
  select
    measured.technician_id,
    measured.candidate_day,
    measured.candidate_starts_at,
    measured.candidate_ends_at,
    measured.latitude,
    measured.longitude,
    measured.target_leg_miles,
    measured.companion_request_id,
    measured.companion_starts_at,
    measured.companion_ends_at,
    measured.companion_latitude,
    measured.companion_longitude,
    measured.companion_distance_miles,
    measured.route_distance_miles,
    (
      measured.estimated_duration_minutes
        + coalesce(measured.companion_duration_minutes, 0)
    )::integer,
    measured.travel_buffer_minutes
      * (1 + case when measured.companion_request_id is null then 0 else 1 end),
    (
      extract(epoch from (
        measured.workday_ends_at - measured.workday_starts_at
      )) / 60
    )::integer
      - measured.appointment_minutes
      - measured.estimated_duration_minutes
      - coalesce(measured.companion_duration_minutes, 0)
      - measured.travel_buffer_minutes
        * (1 + case when measured.companion_request_id is null then 0 else 1 end),
    round((
      100000
      - (
          (measured.candidate_day - measured.today)
          * case measured.priority
              when 'HIGH' then 500
              when 'MEDIUM' then 200
              else 50
            end
        )
      + case measured.priority
          when 'HIGH' then 600
          when 'MEDIUM' then 300
          else 0
        end
      + case when measured.appointment_count > 0 then 1000 else 0 end
      + case
          when measured.companion_distance_miles <= measured.distance_green_max_miles
            then 1500
          when measured.companion_distance_miles <= measured.distance_yellow_max_miles
            then 900
          when measured.companion_request_id is not null then 200
          else 0
        end
      - (measured.route_distance_miles * 10)
    )::numeric, 2) as score,
    jsonb_build_object(
      'reasons', to_jsonb(array_remove(array[
        'Fits the customer availability window.',
        'Falls inside the five-business-day deadline.',
        case when measured.appointment_count > 0
          then format(
            'Technician already has %s appointment(s) that day.',
            measured.appointment_count
          )
        end,
        case when measured.companion_request_id is not null
          then format(
            'Groups nearby request %s at %s miles.',
            measured.companion_folio,
            measured.companion_distance_miles
          )
        end
      ], null)),
      'warnings', to_jsonb(array_remove(array[
        case when measured.companion_request_id is null
          then 'No compatible second request fits immediately after this stop.'
        end,
        case when measured.route_distance_miles > measured.distance_yellow_max_miles
          then format(
            'Estimated daily route is above the preferred %s-mile band.',
            measured.distance_yellow_max_miles
          )
        end
      ], null)),
      'previousAppointmentId', measured.previous_appointment_id,
      'previousRequest', measured.previous_folio,
      'nextAppointmentId', measured.next_appointment_id,
      'nextRequest', measured.next_folio,
      'existingAppointmentCount', measured.appointment_count
    )
  from measured
  order by
    score desc,
    measured.candidate_starts_at,
    measured.technician_id,
    measured.companion_request_id nulls last;
$$;

revoke all on function private.find_service_schedule_candidates(bigint)
  from public, anon, authenticated;

create function private.generate_service_schedule_proposals_internal(
  p_request_id bigint,
  p_option_limit integer
)
returns setof bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := private.require_customer_service_actor();
  v_request record;
  v_candidate record;
  v_proposal_id bigint;
  v_rank smallint := 0;
  v_created integer := 0;
begin
  if p_option_limit is null or p_option_limit not between 1 and 5 then
    raise exception 'Proposal option limit must be between one and five'
      using errcode = '22023';
  end if;

  select
    detail.folio,
    detail.due_on,
    detail.is_ready_to_schedule,
    detail.current_appointment_id
  into v_request
  from valtrim.service_request_detail detail
  where detail.id = p_request_id;

  if not found then
    raise exception 'Customer Service request was not found'
      using errcode = 'P0002';
  end if;

  if v_request.current_appointment_id is not null then
    raise exception 'This request already has a current appointment'
      using errcode = '22023';
  end if;

  if not v_request.is_ready_to_schedule then
    raise exception 'This request is not ready for an automatic proposal'
      using errcode = '22023';
  end if;

  update valtrim.service_schedule_proposals proposal
  set status = 'SUPERSEDED'
  where proposal.status = 'PENDING'
    and exists (
      select 1
      from valtrim.service_schedule_proposal_stops stop
      where stop.proposal_id = proposal.id
        and stop.request_id = p_request_id
    );

  for v_candidate in
    select candidate.*
    from private.find_service_schedule_candidates(p_request_id) candidate
    order by
      candidate.score desc,
      candidate.target_starts_at,
      candidate.technician_id,
      candidate.companion_request_id nulls last
    limit p_option_limit
  loop
    v_rank := v_rank + 1;

    insert into valtrim.service_schedule_proposals (
      requested_for_request_id,
      technician_id,
      proposed_on,
      proposal_rank,
      score,
      total_distance_miles,
      work_minutes,
      travel_buffer_minutes,
      remaining_work_minutes,
      explanation,
      generated_by
    ) values (
      p_request_id,
      v_candidate.technician_id,
      v_candidate.proposed_on,
      v_rank,
      v_candidate.score,
      v_candidate.total_distance_miles,
      v_candidate.work_minutes,
      v_candidate.total_buffer_minutes,
      v_candidate.remaining_work_minutes,
      v_candidate.explanation,
      v_actor_id
    ) returning id into v_proposal_id;

    insert into valtrim.service_schedule_proposal_stops (
      proposal_id,
      request_id,
      stop_order,
      starts_at,
      ends_at,
      latitude,
      longitude,
      distance_from_previous_miles,
      travel_buffer_minutes
    ) values (
      v_proposal_id,
      p_request_id,
      1,
      v_candidate.target_starts_at,
      v_candidate.target_ends_at,
      v_candidate.target_latitude,
      v_candidate.target_longitude,
      v_candidate.target_distance_from_previous,
      (select travel_buffer_minutes
       from valtrim.service_scheduling_settings where id = 1)
    );

    if v_candidate.companion_request_id is not null then
      insert into valtrim.service_schedule_proposal_stops (
        proposal_id,
        request_id,
        stop_order,
        starts_at,
        ends_at,
        latitude,
        longitude,
        distance_from_previous_miles,
        travel_buffer_minutes
      ) values (
        v_proposal_id,
        v_candidate.companion_request_id,
        2,
        v_candidate.companion_starts_at,
        v_candidate.companion_ends_at,
        v_candidate.companion_latitude,
        v_candidate.companion_longitude,
        v_candidate.companion_distance_from_previous,
        (select travel_buffer_minutes
         from valtrim.service_scheduling_settings where id = 1)
      );
    end if;

    v_created := v_created + 1;
    return next v_proposal_id;
  end loop;

  if v_created = 0 then
    raise exception 'No valid proposal fits the customer window, technician workday and five-day deadline'
      using errcode = 'P0001';
  end if;

  return;
end;
$$;

revoke all on function private.generate_service_schedule_proposals_internal(
  bigint, integer
) from public, anon, authenticated;

create function valtrim.generate_service_schedule_proposals(
  p_request_id bigint,
  p_option_limit integer default 3
)
returns setof bigint
language sql
security definer
set search_path = ''
as $$
  select private.generate_service_schedule_proposals_internal(
    p_request_id,
    p_option_limit
  );
$$;

revoke all on function valtrim.generate_service_schedule_proposals(
  bigint, integer
) from public, anon, authenticated;
grant execute on function valtrim.generate_service_schedule_proposals(
  bigint, integer
) to authenticated;

create function private.supersede_service_schedule_proposals()
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
    if new.work_type is not distinct from old.work_type
       and new.estimated_duration_minutes is not distinct from old.estimated_duration_minutes
       and new.priority is not distinct from old.priority
       and new.due_on is not distinct from old.due_on
       and new.status is not distinct from old.status then
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

revoke all on function private.supersede_service_schedule_proposals()
  from public, anon, authenticated;

create trigger service_request_availability_supersede_proposals
after insert or update or delete on valtrim.service_request_availability
for each row execute function private.supersede_service_schedule_proposals();

create trigger service_requests_supersede_proposals
after update of work_type, estimated_duration_minutes, priority, due_on, status
on valtrim.service_requests
for each row execute function private.supersede_service_schedule_proposals();

create trigger service_properties_supersede_proposals
after update of latitude, longitude on valtrim.service_properties
for each row execute function private.supersede_service_schedule_proposals();

create trigger service_technician_profiles_supersede_proposals
after update of workday_starts_at, workday_ends_at, start_latitude, start_longitude
on valtrim.service_technician_profiles
for each row execute function private.supersede_service_schedule_proposals();

create trigger service_technician_active_supersede_proposals
after update of is_active on valtrim.people
for each row execute function private.supersede_service_schedule_proposals();

create trigger service_scheduling_settings_supersede_proposals
after update of time_zone, distance_green_max_miles,
  distance_yellow_max_miles, travel_buffer_minutes
on valtrim.service_scheduling_settings
for each row execute function private.supersede_service_schedule_proposals();

create trigger service_appointments_supersede_proposals
after insert or update of technician_id, starts_at, ends_at, state, is_current
on valtrim.service_appointments
for each row execute function private.supersede_service_schedule_proposals();

create view valtrim.service_schedule_proposal_options
with (security_invoker = true)
as
select
  proposal.id,
  proposal.requested_for_request_id,
  proposal.technician_id,
  technician.name as technician_name,
  proposal.proposed_on,
  proposal.proposal_rank,
  proposal.status,
  proposal.score,
  proposal.total_distance_miles,
  proposal.work_minutes,
  proposal.travel_buffer_minutes,
  proposal.remaining_work_minutes,
  proposal.explanation,
  proposal.generated_at,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', stop.id,
        'requestId', stop.request_id,
        'folio', request.folio,
        'stopOrder', stop.stop_order,
        'startsAt', stop.starts_at,
        'endsAt', stop.ends_at,
        'latitude', stop.latitude,
        'longitude', stop.longitude,
        'distanceFromPreviousMiles', stop.distance_from_previous_miles,
        'travelBufferMinutes', stop.travel_buffer_minutes,
        'address', property.address,
        'lotNumber', property.lot_number
      ) order by stop.stop_order
    ) filter (where stop.id is not null),
    '[]'::jsonb
  ) as stops
from valtrim.service_schedule_proposals proposal
join valtrim.people technician on technician.id = proposal.technician_id
left join valtrim.service_schedule_proposal_stops stop
  on stop.proposal_id = proposal.id
left join valtrim.service_requests request on request.id = stop.request_id
left join valtrim.service_properties property on property.id = request.property_id
group by proposal.id, technician.id;

revoke all on valtrim.service_schedule_proposal_options
  from public, anon, authenticated;
grant select on valtrim.service_schedule_proposal_options to authenticated;

comment on table valtrim.service_schedule_proposals is
  'Persisted automatic route alternatives awaiting dispatcher review.';
comment on table valtrim.service_schedule_proposal_stops is
  'Ordered Customer Service jobs contained in one automatic route alternative.';
comment on function valtrim.generate_service_schedule_proposals(bigint, integer) is
  'Generates deterministic appointment alternatives without creating an appointment.';

notify pgrst, 'reload schema';

commit;
