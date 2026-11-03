-- Customer Service identifiers, SLA deadline, and coordinate precision.

begin;

-- Keep the existing sequence so numbering continues without collisions, but
-- use the confirmed Customer Service prefix and a minimum of four digits.
alter table valtrim.service_requests
  alter column folio set default (
    'CS-' || lpad(
      nextval('valtrim.service_request_folio_seq'::regclass)::text,
      4,
      '0'
    )
  );

-- The reported date is not part of the five-business-day window. Counting
-- begins on the next calendar day and skips Saturdays and Sundays.
create or replace function valtrim.calculate_business_due_date(
  p_start_date date,
  p_business_days integer
)
returns date
language plpgsql
immutable
strict
set search_path = ''
as $function$
declare
  v_date date := p_start_date;
  v_days_counted integer := 0;
begin
  if p_business_days < 1 then
    raise exception 'Business days must be greater than zero';
  end if;

  while v_days_counted < p_business_days loop
    v_date := v_date + 1;

    if extract(isodow from v_date) between 1 and 5 then
      v_days_counted := v_days_counted + 1;
    end if;
  end loop;

  return v_date;
end;
$function$;

revoke all on function valtrim.calculate_business_due_date(date, integer)
  from public, anon, authenticated;
grant execute on function valtrim.calculate_business_due_date(date, integer)
  to service_role;

-- Align only requests that still have an active SLA. Completed/closed records
-- retain the deadline that applied when their workflow ended.
update valtrim.service_requests request
set due_on = valtrim.calculate_business_due_date(
  request.reported_on,
  settings.business_days_to_complete
)
from valtrim.service_scheduling_settings settings
where settings.id = 1
  and request.status not in ('COMPLETED', 'CLOSED')
  and request.due_on is distinct from valtrim.calculate_business_due_date(
    request.reported_on,
    settings.business_days_to_complete
  );

-- Preserve the original precision supplied for a Community and copy it to the
-- request-property snapshot without rounding it to six decimal places.
alter table valtrim.jobs
  alter column community_latitude type numeric(18, 15)
    using community_latitude::numeric(18, 15),
  alter column community_longitude type numeric(18, 15)
    using community_longitude::numeric(18, 15);

-- PostgreSQL tracks UPDATE OF columns in trigger definitions and the result
-- types exposed by views. Remove those dependencies inside this transaction so
-- the coordinate type can change, then recreate them below.
drop trigger if exists service_properties_supersede_proposals
  on valtrim.service_properties;
drop view if exists valtrim.service_request_detail;
drop view if exists valtrim.service_request_overview;

alter table valtrim.service_properties
  alter column latitude type numeric(18, 15)
    using latitude::numeric(18, 15),
  alter column longitude type numeric(18, 15)
    using longitude::numeric(18, 15);

create view valtrim.service_request_overview
with (security_invoker = true)
as
select
  request.id,
  request.folio,
  request.reported_on,
  request.status,
  request.tag,
  request.priority,
  request.request_type,
  request.homeowner_name,
  request.homeowner_email,
  request.homeowner_phone,
  request.description,
  property.address,
  property.lot_number,
  community.name as community_name,
  appointment.id as current_appointment_id,
  appointment.starts_at,
  appointment.ends_at,
  appointment.state as appointment_state,
  technician.name as technician_name,
  request.created_at,
  request.updated_at,
  request.work_type,
  request.estimated_duration_minutes,
  request.due_on,
  request.resolution_status,
  request.completed_at as request_completed_at,
  property.latitude,
  property.longitude,
  appointment.confirmation_status,
  appointment.confirmation_sent_at,
  appointment.confirmed_at,
  appointment.reminder_sent_at,
  (
    request.work_type is not null
    and request.estimated_duration_minutes is not null
    and request.homeowner_email is not null
    and property.latitude is not null
    and property.longitude is not null
    and exists (
      select 1
      from valtrim.service_request_availability availability
      where availability.request_id = request.id
    )
  ) as is_ready_to_schedule,
  (
    request.status not in ('COMPLETED', 'CLOSED')
    and current_date > request.due_on
  ) as is_overdue
from valtrim.service_requests request
join valtrim.service_properties property on property.id = request.property_id
left join valtrim.communities community
  on community.id = property.community_id
left join valtrim.service_appointments appointment
  on appointment.request_id = request.id and appointment.is_current
left join valtrim.people technician
  on technician.id = appointment.technician_id;

revoke all on valtrim.service_request_overview from public, anon;
grant select on valtrim.service_request_overview to authenticated;

create view valtrim.service_request_detail
with (security_invoker = true)
as
select
  request.id,
  request.folio,
  request.property_id,
  request.reported_on,
  request.due_on,
  request.status,
  request.tag,
  request.priority,
  request.request_type,
  request.work_type,
  request.estimated_duration_minutes,
  request.homeowner_name,
  request.homeowner_email,
  request.homeowner_phone,
  request.description,
  request.internal_notes,
  request.customer_availability_notes,
  request.resolution_status,
  request.completed_at as request_completed_at,
  request.completion_notes,
  request.exception_reason,
  request.status_before_close,
  request.closed_at,
  request.close_reason,
  request.coordinator_user_id,
  property.community_id,
  community.builder_id,
  builder.name as builder_name,
  community.name as community_name,
  property.lot_number,
  property.address,
  property.city,
  property.state,
  property.postal_code,
  property.plan_label,
  property.latitude,
  property.longitude,
  appointment.id as current_appointment_id,
  appointment.starts_at,
  appointment.ends_at,
  appointment.state as appointment_state,
  appointment.confirmation_status,
  appointment.confirmation_sent_at,
  appointment.confirmed_at,
  appointment.reminder_sent_at,
  appointment.phone_follow_up_at,
  appointment.customer_response_note,
  appointment.technician_id,
  technician.name as technician_name,
  request.created_at,
  request.updated_at,
  (
    request.status not in ('COMPLETED', 'CLOSED')
    and current_date <= request.due_on
    and request.work_type is not null
    and request.estimated_duration_minutes is not null
    and request.priority is not null
    and property.latitude is not null
    and property.longitude is not null
    and exists (
      select 1
      from valtrim.service_request_availability availability
      where availability.request_id = request.id
    )
    and exists (
      select 1
      from valtrim.people service_technician
      join valtrim.person_roles service_role
        on service_role.person_id = service_technician.id
       and service_role.role = 'SERVICE_TECHNICIAN'
      join valtrim.service_technician_profiles service_profile
        on service_profile.person_id = service_technician.id
      where service_technician.is_active
        and service_profile.start_latitude is not null
        and service_profile.start_longitude is not null
    )
  ) as is_ready_to_schedule,
  (
    request.status not in ('COMPLETED', 'CLOSED')
    and current_date > request.due_on
  ) as is_overdue,
  request.customer_unavailable_dates,
  request.customer_needs_contact
from valtrim.service_requests request
join valtrim.service_properties property on property.id = request.property_id
left join valtrim.communities community
  on community.id = property.community_id
left join valtrim.builders builder on builder.id = community.builder_id
left join valtrim.service_appointments appointment
  on appointment.request_id = request.id and appointment.is_current
left join valtrim.people technician
  on technician.id = appointment.technician_id;

revoke all on valtrim.service_request_detail from public, anon, authenticated;
grant select on valtrim.service_request_detail to authenticated;

create trigger service_properties_supersede_proposals
after update of latitude, longitude on valtrim.service_properties
for each row execute function private.supersede_service_schedule_proposals();

comment on column valtrim.jobs.community_latitude is
  'Verified community latitude preserving source precision.';
comment on column valtrim.jobs.community_longitude is
  'Verified community longitude preserving source precision.';
comment on column valtrim.service_properties.latitude is
  'Request property latitude snapshot preserving source precision.';
comment on column valtrim.service_properties.longitude is
  'Request property longitude snapshot preserving source precision.';

notify pgrst, 'reload schema';

commit;
