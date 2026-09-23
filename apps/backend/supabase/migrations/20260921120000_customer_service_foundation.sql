begin;

-- Customer Service already exists in the baseline. This migration evolves the
-- existing model for the dispatcher workflow instead of creating a second set
-- of request, property or appointment tables.

create type valtrim.service_work_type as enum (
  'HW',
  'WS',
  'HW_WS'
);

create type valtrim.service_confirmation_status as enum (
  'NOT_SENT',
  'AWAITING_CUSTOMER',
  'CONFIRMED',
  'DECLINED',
  'REMINDER_SENT',
  'PHONE_FOLLOW_UP'
);

create type valtrim.service_resolution_status as enum (
  'RESOLVED',
  'EXCEPTION'
);

create type valtrim.service_communication_channel as enum (
  'EMAIL',
  'PHONE'
);

create type valtrim.service_communication_type as enum (
  'APPOINTMENT_PROPOSAL',
  'REMINDER',
  'CUSTOMER_CONFIRMATION',
  'CUSTOMER_DECLINE',
  'PHONE_FOLLOW_UP'
);

create type valtrim.service_communication_status as enum (
  'PENDING',
  'SENT',
  'DELIVERED',
  'FAILED',
  'RECEIVED'
);

create table valtrim.service_scheduling_settings (
  id smallint primary key default 1 check (id = 1),
  business_days_to_complete smallint not null default 5
    check (business_days_to_complete between 1 and 30),
  workday_starts_at time not null default time '08:00',
  workday_ends_at time not null default time '17:00',
  time_zone varchar(80) not null default 'America/Los_Angeles'
    check (btrim(time_zone) <> ''),
  company_latitude numeric(9,6)
    check (company_latitude between -90 and 90),
  company_longitude numeric(9,6)
    check (company_longitude between -180 and 180),
  reminder_after_hours smallint not null default 24
    check (reminder_after_hours between 1 and 168),
  distance_green_max_miles numeric(6,2) not null default 10
    check (distance_green_max_miles > 0),
  distance_yellow_max_miles numeric(6,2) not null default 20,
  updated_by uuid references valtrim.app_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (workday_ends_at > workday_starts_at),
  check (
    (company_latitude is null and company_longitude is null)
    or (company_latitude is not null and company_longitude is not null)
  ),
  check (distance_yellow_max_miles > distance_green_max_miles)
);

insert into valtrim.service_scheduling_settings (id)
values (1);

alter table valtrim.service_properties
  add column latitude numeric(9,6)
    check (latitude between -90 and 90),
  add column longitude numeric(9,6)
    check (longitude between -180 and 180),
  add constraint service_properties_coordinates_pair_check
    check (
      (latitude is null and longitude is null)
      or (latitude is not null and longitude is not null)
    );

alter table valtrim.service_requests
  add column work_type valtrim.service_work_type,
  add column estimated_duration_minutes smallint
    check (estimated_duration_minutes between 15 and 720),
  add column customer_availability_notes varchar(1000),
  add column due_on date,
  add column resolution_status valtrim.service_resolution_status,
  add column completed_at timestamptz,
  add column completion_notes varchar(2000),
  add column exception_reason varchar(1000),
  add constraint service_requests_resolution_check
    check (
      resolution_status is null
      or (
        resolution_status = 'RESOLVED'
        and completed_at is not null
        and exception_reason is null
      )
      or (
        resolution_status = 'EXCEPTION'
        and completed_at is not null
        and btrim(exception_reason) <> ''
      )
    );

create function valtrim.calculate_business_due_date(
  p_start_date date,
  p_business_days integer
)
returns date
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_date date := p_start_date;
  v_days_counted integer := 0;
begin
  if p_business_days < 1 then
    raise exception 'Business days must be greater than zero';
  end if;

  while v_days_counted < p_business_days loop
    if extract(isodow from v_date) between 1 and 5 then
      v_days_counted := v_days_counted + 1;
    end if;

    if v_days_counted < p_business_days then
      v_date := v_date + 1;
    end if;
  end loop;

  return v_date;
end;
$$;

revoke all on function valtrim.calculate_business_due_date(date, integer)
  from public, anon, authenticated;
grant execute on function valtrim.calculate_business_due_date(date, integer)
  to service_role;

create function private.set_service_request_due_on()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_days integer;
begin
  select settings.business_days_to_complete
  into v_business_days
  from valtrim.service_scheduling_settings settings
  where settings.id = 1;

  new.due_on := valtrim.calculate_business_due_date(
    new.reported_on,
    coalesce(v_business_days, 5)
  );

  return new;
end;
$$;

revoke all on function private.set_service_request_due_on()
  from public, anon, authenticated;

update valtrim.service_requests request
set due_on = valtrim.calculate_business_due_date(
  request.reported_on,
  (select settings.business_days_to_complete
   from valtrim.service_scheduling_settings settings
   where settings.id = 1)
);

alter table valtrim.service_requests
  alter column due_on set not null;

create trigger service_requests_set_due_on
before insert or update of reported_on on valtrim.service_requests
for each row execute function private.set_service_request_due_on();

create table valtrim.service_request_availability (
  id bigint generated always as identity primary key,
  request_id bigint not null
    references valtrim.service_requests(id) on delete cascade,
  available_from timestamptz not null,
  available_until timestamptz not null,
  notes varchar(300),
  created_by uuid references valtrim.app_users(id) on delete set null,
  updated_by uuid references valtrim.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (available_until > available_from),
  unique (request_id, available_from, available_until)
);

alter table valtrim.service_appointments
  add column confirmation_status valtrim.service_confirmation_status
    not null default 'NOT_SENT',
  add column confirmation_sent_at timestamptz,
  add column confirmed_at timestamptz,
  add column declined_at timestamptz,
  add column reminder_sent_at timestamptz,
  add column phone_follow_up_at timestamptz,
  add column customer_response_note varchar(1000),
  add constraint service_appointments_confirmation_check
    check (
      not (confirmed_at is not null and declined_at is not null)
      and (
        confirmation_status not in (
          'AWAITING_CUSTOMER',
          'REMINDER_SENT',
          'PHONE_FOLLOW_UP'
        )
        or confirmation_sent_at is not null
      )
      and (
        confirmation_status <> 'CONFIRMED'
        or (confirmed_at is not null and declined_at is null)
      )
      and (
        confirmation_status <> 'DECLINED'
        or (declined_at is not null and confirmed_at is null)
      )
      and (
        confirmation_status <> 'REMINDER_SENT'
        or reminder_sent_at is not null
      )
      and (
        confirmation_status <> 'PHONE_FOLLOW_UP'
        or phone_follow_up_at is not null
      )
    );

-- Rescheduling may retain cancelled appointment records, but a request can be
-- completed in only one actual visit in the current business workflow.
create unique index service_appointments_one_completed_visit_uq
  on valtrim.service_appointments (request_id)
  where state = 'COMPLETED';

create table valtrim.service_communications (
  id bigint generated always as identity primary key,
  request_id bigint not null
    references valtrim.service_requests(id) on delete restrict,
  appointment_id bigint
    references valtrim.service_appointments(id) on delete restrict,
  channel valtrim.service_communication_channel not null,
  communication_type valtrim.service_communication_type not null,
  status valtrim.service_communication_status not null default 'PENDING',
  recipient varchar(160) not null check (btrim(recipient) <> ''),
  provider_message_id varchar(200),
  error_message varchar(1000),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  created_by uuid references valtrim.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Confirmation secrets stay outside the Data API. Edge Functions will store
-- only a SHA-256 hash here; the raw token is sent to the customer and is never
-- persisted.
create table private.service_confirmation_tokens (
  appointment_id bigint primary key
    references valtrim.service_appointments(id) on delete cascade,
  token_hash varchar(64) not null unique
    check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

revoke all on private.service_confirmation_tokens
  from public, anon, authenticated;
grant all on private.service_confirmation_tokens to service_role;

comment on column valtrim.service_requests.due_on is
  'Fifth business day including the reported day; stored for SLA traceability.';
comment on column valtrim.service_requests.estimated_duration_minutes is
  'Administrative estimate supplied after consulting the technician.';
comment on table valtrim.service_request_parts is
  'Optional informational parts log; it does not block scheduling readiness.';
comment on table valtrim.service_request_availability is
  'Concrete customer availability windows used by the scheduling proposal.';
comment on table valtrim.service_communications is
  'Appointment email and phone communication history for Customer Service.';

create index service_requests_due_on_idx
  on valtrim.service_requests (due_on, status, priority);
create index service_properties_coordinates_idx
  on valtrim.service_properties (latitude, longitude)
  where latitude is not null and longitude is not null;
create index service_request_availability_request_idx
  on valtrim.service_request_availability (request_id, available_from);
create index service_communications_request_idx
  on valtrim.service_communications (request_id, occurred_at desc);
create index service_communications_appointment_idx
  on valtrim.service_communications (appointment_id, occurred_at desc)
  where appointment_id is not null;
create index service_appointments_confirmation_idx
  on valtrim.service_appointments (confirmation_status, confirmation_sent_at)
  where is_current;

create trigger service_request_availability_set_updated_at
before update on valtrim.service_request_availability
for each row execute function valtrim.set_updated_at();

create trigger service_request_availability_stamp_actor
before insert or update on valtrim.service_request_availability
for each row execute function private.stamp_and_validate_actor();

create trigger service_communications_stamp_actor
before insert or update on valtrim.service_communications
for each row execute function private.stamp_and_validate_actor();

create trigger service_scheduling_settings_set_updated_at
before update on valtrim.service_scheduling_settings
for each row execute function valtrim.set_updated_at();

create trigger service_scheduling_settings_stamp_actor
before insert or update on valtrim.service_scheduling_settings
for each row execute function private.stamp_and_validate_actor();

-- Status history is produced by a trigger. Definer rights prevent RLS from
-- forcing browser clients to receive direct INSERT access to the history.
create or replace function valtrim.record_service_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into valtrim.service_request_status_history (
      request_id,
      previous_status,
      new_status,
      note,
      changed_by
    )
    values (
      new.id,
      case when tg_op = 'INSERT' then null else old.status end,
      new.status,
      new.status_note,
      coalesce((select auth.uid()), new.updated_by, new.created_by)
    );
  end if;

  return new;
end;
$$;

revoke all on function valtrim.record_service_status_change()
  from public, anon, authenticated;

create function private.audit_customer_service_request_change()
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
    'request_type', new.request_type::text,
    'work_type', new.work_type::text,
    'priority', new.priority::text,
    'status', new.status::text,
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
      'request_type', old.request_type::text,
      'work_type', old.work_type::text,
      'priority', old.priority::text,
      'status', old.status::text,
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

    if old.status is distinct from new.status and new.status = 'COMPLETED' then
      v_action := 'SERVICE_REQUEST_COMPLETED';
      v_summary := format('Customer Service request %s was completed.', new.folio);
    elsif old.status is distinct from new.status and new.status = 'OVERDUE' then
      v_action := 'SERVICE_REQUEST_OVERDUE';
      v_summary := format('Customer Service request %s became overdue.', new.folio);
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

revoke all on function private.audit_customer_service_request_change()
  from public, anon, authenticated;

drop trigger if exists customer_service_requests_audit
  on valtrim.service_requests;
create trigger customer_service_requests_audit
after insert or update on valtrim.service_requests
for each row execute function private.audit_customer_service_request_change();

create function private.audit_service_appointment_change()
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
    'technician_id', new.technician_id,
    'starts_at', new.starts_at,
    'ends_at', new.ends_at,
    'state', new.state::text,
    'is_current', new.is_current,
    'confirmation_status', new.confirmation_status::text,
    'completed_at', new.completed_at,
    'cancelled_at', new.cancelled_at
  );

  if tg_op = 'INSERT' then
    v_action := 'SERVICE_APPOINTMENT_PROPOSED';
    v_new_values := v_new_snapshot;
    select array_agg(field.key order by field.key)
    into v_changed_fields
    from jsonb_each(v_new_snapshot) field;
    v_summary := format('An appointment was proposed for %s.', v_request_folio);
  else
    v_old_snapshot := jsonb_build_object(
      'technician_id', old.technician_id,
      'starts_at', old.starts_at,
      'ends_at', old.ends_at,
      'state', old.state::text,
      'is_current', old.is_current,
      'confirmation_status', old.confirmation_status::text,
      'completed_at', old.completed_at,
      'cancelled_at', old.cancelled_at
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

    if old.confirmation_status is distinct from new.confirmation_status
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
    v_customer_name,
    'SERVICE_APPOINTMENT',
    new.id::text,
    v_request_folio,
    v_summary,
    v_previous_values,
    v_new_values,
    jsonb_build_object(
      'requestId', new.request_id,
      'requestFolio', v_request_folio,
      'changedFields', to_jsonb(v_changed_fields)
    )
  );

  return new;
end;
$$;

revoke all on function private.audit_service_appointment_change()
  from public, anon, authenticated;

drop trigger if exists customer_service_appointments_audit
  on valtrim.service_appointments;
create trigger customer_service_appointments_audit
after insert or update on valtrim.service_appointments
for each row execute function private.audit_service_appointment_change();

create or replace view valtrim.service_request_overview
with (security_invoker = true)
as
select
  sr.id,
  sr.folio,
  sr.reported_on,
  sr.status,
  sr.tag,
  sr.priority,
  sr.request_type,
  sr.homeowner_name,
  sr.homeowner_email,
  sr.homeowner_phone,
  sr.description,
  sp.address,
  sp.lot_number,
  c.name as community_name,
  appointment.id as current_appointment_id,
  appointment.starts_at,
  appointment.ends_at,
  appointment.state as appointment_state,
  technician.name as technician_name,
  sr.created_at,
  sr.updated_at,
  sr.work_type,
  sr.estimated_duration_minutes,
  sr.due_on,
  sr.resolution_status,
  sr.completed_at as request_completed_at,
  sp.latitude,
  sp.longitude,
  appointment.confirmation_status,
  appointment.confirmation_sent_at,
  appointment.confirmed_at,
  appointment.reminder_sent_at,
  (
    sr.work_type is not null
    and sr.estimated_duration_minutes is not null
    and sr.homeowner_email is not null
    and sp.latitude is not null
    and sp.longitude is not null
    and exists (
      select 1
      from valtrim.service_request_availability availability
      where availability.request_id = sr.id
    )
  ) as is_ready_to_schedule,
  (
    sr.status not in ('COMPLETED', 'CLOSED')
    and current_date > sr.due_on
  ) as is_overdue
from valtrim.service_requests sr
join valtrim.service_properties sp on sp.id = sr.property_id
left join valtrim.communities c on c.id = sp.community_id
left join valtrim.service_appointments appointment
  on appointment.request_id = sr.id and appointment.is_current
left join valtrim.people technician on technician.id = appointment.technician_id;

alter table valtrim.service_scheduling_settings enable row level security;
alter table valtrim.service_request_availability enable row level security;
alter table valtrim.service_communications enable row level security;
alter table private.service_confirmation_tokens enable row level security;

revoke all on valtrim.service_scheduling_settings
  from public, anon, authenticated;
revoke all on valtrim.service_request_availability
  from public, anon, authenticated;
revoke all on valtrim.service_communications
  from public, anon, authenticated;

grant select on valtrim.service_properties to authenticated;
grant select on valtrim.communities to authenticated;
grant insert (
  community_id,
  lot_number,
  address,
  city,
  state,
  postal_code,
  plan_label,
  latitude,
  longitude
) on valtrim.service_properties to authenticated;
grant update (
  community_id,
  lot_number,
  address,
  city,
  state,
  postal_code,
  plan_label,
  latitude,
  longitude
) on valtrim.service_properties to authenticated;

grant select on valtrim.service_requests to authenticated;
grant insert (
  property_id,
  reported_on,
  coordinator_user_id,
  homeowner_name,
  homeowner_email,
  homeowner_phone,
  request_type,
  priority,
  status,
  status_note,
  description,
  internal_notes,
  work_type,
  estimated_duration_minutes,
  customer_availability_notes
) on valtrim.service_requests to authenticated;
grant update (
  property_id,
  reported_on,
  coordinator_user_id,
  homeowner_name,
  homeowner_email,
  homeowner_phone,
  request_type,
  priority,
  status,
  status_note,
  description,
  internal_notes,
  work_type,
  estimated_duration_minutes,
  customer_availability_notes,
  resolution_status,
  completed_at,
  completion_notes,
  exception_reason
) on valtrim.service_requests to authenticated;

grant select on valtrim.service_request_status_history to authenticated;
grant select on valtrim.service_appointments to authenticated;
grant insert (
  request_id,
  technician_id,
  starts_at,
  ends_at,
  state,
  is_current,
  notes,
  completed_at,
  cancelled_at
) on valtrim.service_appointments to authenticated;
grant update (
  technician_id,
  starts_at,
  ends_at,
  state,
  is_current,
  notes,
  completed_at,
  cancelled_at
) on valtrim.service_appointments to authenticated;
grant select, insert on valtrim.service_request_notes to authenticated;
grant select on valtrim.service_request_parts to authenticated;
grant select on valtrim.service_request_attachments to authenticated;
grant select, insert, update, delete
  on valtrim.service_request_availability to authenticated;
grant select on valtrim.service_communications to authenticated;
grant select on valtrim.service_scheduling_settings to authenticated;
grant update (
  business_days_to_complete,
  workday_starts_at,
  workday_ends_at,
  time_zone,
  company_latitude,
  company_longitude,
  reminder_after_hours,
  distance_green_max_miles,
  distance_yellow_max_miles
) on valtrim.service_scheduling_settings to authenticated;
grant select on valtrim.service_request_overview to authenticated;

grant usage on sequence valtrim.service_properties_id_seq to authenticated;
grant usage on sequence valtrim.service_requests_id_seq to authenticated;
grant usage on sequence valtrim.service_request_folio_seq to authenticated;
grant usage on sequence valtrim.service_appointments_id_seq to authenticated;
grant usage on sequence valtrim.service_request_notes_id_seq to authenticated;
grant usage on sequence valtrim.service_request_availability_id_seq
  to authenticated;

create policy service_properties_select
on valtrim.service_properties for select to authenticated
using (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and (select private.can_access_community(community_id))
);

create policy customer_service_communities_select
on valtrim.communities for select to authenticated
using (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and (select private.can_access_community(id))
);

create policy service_properties_insert
on valtrim.service_properties for insert to authenticated
with check (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and (select private.can_access_community(community_id))
);

create policy service_properties_update
on valtrim.service_properties for update to authenticated
using (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and (select private.can_access_community(community_id))
)
with check (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and (select private.can_access_community(community_id))
);

create policy service_requests_select
on valtrim.service_requests for select to authenticated
using (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and exists (
    select 1
    from valtrim.service_properties property
    where property.id = service_requests.property_id
      and (select private.can_access_community(property.community_id))
  )
);

create policy service_requests_insert
on valtrim.service_requests for insert to authenticated
with check (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and exists (
    select 1
    from valtrim.service_properties property
    where property.id = service_requests.property_id
      and (select private.can_access_community(property.community_id))
  )
);

create policy service_requests_update
on valtrim.service_requests for update to authenticated
using (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and exists (
    select 1
    from valtrim.service_properties property
    where property.id = service_requests.property_id
      and (select private.can_access_community(property.community_id))
  )
)
with check (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and exists (
    select 1
    from valtrim.service_properties property
    where property.id = service_requests.property_id
      and (select private.can_access_community(property.community_id))
  )
);

create policy service_request_status_history_select
on valtrim.service_request_status_history for select to authenticated
using (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and exists (
    select 1
    from valtrim.service_requests request
    where request.id = service_request_status_history.request_id
  )
);

create policy service_appointments_select
on valtrim.service_appointments for select to authenticated
using (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and exists (
    select 1
    from valtrim.service_requests request
    where request.id = service_appointments.request_id
  )
);

create policy service_appointments_insert
on valtrim.service_appointments for insert to authenticated
with check (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and exists (
    select 1
    from valtrim.service_requests request
    where request.id = service_appointments.request_id
  )
);

create policy service_appointments_update
on valtrim.service_appointments for update to authenticated
using (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and exists (
    select 1
    from valtrim.service_requests request
    where request.id = service_appointments.request_id
  )
)
with check (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and exists (
    select 1
    from valtrim.service_requests request
    where request.id = service_appointments.request_id
  )
);

create policy service_request_notes_select
on valtrim.service_request_notes for select to authenticated
using (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and exists (
    select 1
    from valtrim.service_requests request
    where request.id = service_request_notes.request_id
  )
);

create policy service_request_notes_insert
on valtrim.service_request_notes for insert to authenticated
with check (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and exists (
    select 1
    from valtrim.service_requests request
    where request.id = service_request_notes.request_id
  )
);

create policy service_request_parts_select
on valtrim.service_request_parts for select to authenticated
using (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and exists (
    select 1
    from valtrim.service_requests request
    where request.id = service_request_parts.request_id
  )
);

create policy service_request_attachments_select
on valtrim.service_request_attachments for select to authenticated
using (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and exists (
    select 1
    from valtrim.service_requests request
    where request.id = service_request_attachments.request_id
  )
);

create policy service_request_availability_select
on valtrim.service_request_availability for select to authenticated
using (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and exists (
    select 1
    from valtrim.service_requests request
    where request.id = service_request_availability.request_id
  )
);

create policy service_request_availability_insert
on valtrim.service_request_availability for insert to authenticated
with check (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and exists (
    select 1
    from valtrim.service_requests request
    where request.id = service_request_availability.request_id
  )
);

create policy service_request_availability_update
on valtrim.service_request_availability for update to authenticated
using (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and exists (
    select 1
    from valtrim.service_requests request
    where request.id = service_request_availability.request_id
  )
)
with check (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and exists (
    select 1
    from valtrim.service_requests request
    where request.id = service_request_availability.request_id
  )
);

create policy service_request_availability_delete
on valtrim.service_request_availability for delete to authenticated
using (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and exists (
    select 1
    from valtrim.service_requests request
    where request.id = service_request_availability.request_id
  )
);

create policy service_communications_select
on valtrim.service_communications for select to authenticated
using (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and exists (
    select 1
    from valtrim.service_requests request
    where request.id = service_communications.request_id
  )
);

create policy service_scheduling_settings_select
on valtrim.service_scheduling_settings for select to authenticated
using ((select private.has_app_role('ADMIN', 'SCHEDULING')));

create policy service_scheduling_settings_update
on valtrim.service_scheduling_settings for update to authenticated
using ((select private.has_app_role('ADMIN')))
with check ((select private.has_app_role('ADMIN')));

create policy service_technician_people_select
on valtrim.people for select to authenticated
using (
  (select private.has_app_role('ADMIN', 'SCHEDULING'))
  and exists (
    select 1
    from valtrim.person_roles person_role
    where person_role.person_id = people.id
      and person_role.role = 'SERVICE_TECHNICIAN'
  )
);

create policy service_technician_roles_select
on valtrim.person_roles for select to authenticated
using (
  role = 'SERVICE_TECHNICIAN'
  and (select private.has_app_role('ADMIN', 'SCHEDULING'))
);

notify pgrst, 'reload schema';

commit;
