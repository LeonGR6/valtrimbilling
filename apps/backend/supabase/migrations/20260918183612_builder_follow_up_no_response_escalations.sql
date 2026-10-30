-- Phase 17: internal escalation for Builder follow-ups with no response.
--
-- ValtrimBilling remains the schedule source of truth. An operator marking a
-- schedule NO_RESPONSE creates one durable escalation episode. The in-app
-- attention view is immediate; the internal email becomes due after the
-- configured number of weekdays and is delivered only by the Edge Function.

begin;

create table valtrim.builder_follow_up_escalation_settings (
  id smallint primary key default 1 check (id = 1),
  is_enabled boolean not null default true,
  wait_business_days smallint not null default 2
    check (wait_business_days between 1 and 30),
  recipient_emails valtrim.email_address[] not null,
  updated_by uuid references valtrim.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(recipient_emails) between 1 and 10)
);

create table valtrim.builder_follow_up_escalations (
  id bigint generated always as identity primary key,
  no_response_event_id bigint not null unique
    references valtrim.builder_follow_up_events(id) on delete cascade,
  schedule_id bigint not null
    references valtrim.production_schedules(id) on delete cascade,
  target_work_date date not null,
  due_on date not null,
  status varchar(16) not null default 'PENDING'
    check (status in ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED')),
  recipient_emails valtrim.email_address[] not null,
  subject varchar(200),
  text_body text,
  html_body text,
  idempotency_key varchar(160) not null unique,
  provider_message_id varchar(200),
  attempt_count smallint not null default 0
    check (attempt_count between 0 and 20),
  processing_started_at timestamptz,
  sent_at timestamptz,
  cancellation_reason varchar(80),
  last_error varchar(1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'SENT' and sent_at is not null and provider_message_id is not null)
    or status <> 'SENT'
  )
);

create index builder_follow_up_escalation_settings_updated_by_idx
  on valtrim.builder_follow_up_escalation_settings (updated_by)
  where updated_by is not null;
create index builder_follow_up_escalations_schedule_idx
  on valtrim.builder_follow_up_escalations (schedule_id, created_at desc);
create index builder_follow_up_escalations_due_idx
  on valtrim.builder_follow_up_escalations (due_on, id)
  where status in ('PENDING', 'FAILED');

create trigger builder_follow_up_escalation_settings_set_updated_at
before update on valtrim.builder_follow_up_escalation_settings
for each row execute function valtrim.set_updated_at();

create trigger builder_follow_up_escalations_set_updated_at
before update on valtrim.builder_follow_up_escalations
for each row execute function valtrim.set_updated_at();

insert into valtrim.builder_follow_up_escalation_settings (
  id,
  is_enabled,
  wait_business_days,
  recipient_emails
) values (
  1,
  true,
  2,
  array['andres@valtrim.com'::valtrim.email_address]
);

-- Weekdays are the initial definition of a business day. Company holidays can
-- later be introduced through a calendar table without changing episode IDs.
create function private.add_builder_follow_up_business_days(
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
  v_remaining integer := p_business_days;
begin
  if p_business_days < 0 or p_business_days > 365 then
    raise exception 'Business-day offset must be between 0 and 365'
      using errcode = '22023';
  end if;

  while v_remaining > 0 loop
    v_date := v_date + 1;
    if extract(isodow from v_date) between 1 and 5 then
      v_remaining := v_remaining - 1;
    end if;
  end loop;

  return v_date;
end;
$$;

create function private.refresh_builder_follow_up_escalations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
  v_affected integer := 0;
  v_count integer := 0;
begin
  if not v_is_service
     and not (select private.has_app_role(
       'ADMIN',
       'PROJECT_MANAGEMENT',
       'SCHEDULING'
     )) then
    raise exception 'You do not have permission to refresh Builder follow-up escalations'
      using errcode = '42501';
  end if;

  update valtrim.builder_follow_up_escalations escalation
  set status = 'CANCELLED',
      cancellation_reason = case
        when not setting.is_enabled then 'ESCALATION_DISABLED'
        when state.status <> 'NO_RESPONSE' then 'RESPONSE_STATUS_CHANGED'
        when not schedule.is_active or activity.status <> 'ACTIVE' or not job.is_active
          then 'SOURCE_INACTIVE'
        when schedule.scheduled_date <> escalation.target_work_date
          then 'WORK_DATE_CHANGED'
        when schedule.scheduled_date < current_date then 'WORK_DATE_PASSED'
        when latest_event.id is distinct from escalation.no_response_event_id
          then 'EPISODE_SUPERSEDED'
        else 'NO_LONGER_ELIGIBLE'
      end,
      processing_started_at = null,
      last_error = null
  from valtrim.builder_follow_up_states state
  join valtrim.production_schedules schedule
    on schedule.id = state.schedule_id
  join valtrim.production_activities activity
    on activity.id = schedule.activity_id
  join valtrim.jobs job on job.id = activity.job_id
  cross join valtrim.builder_follow_up_escalation_settings setting
  left join lateral (
    select event.id
    from valtrim.builder_follow_up_events event
    where event.schedule_id = state.schedule_id
      and event.action = 'NO_RESPONSE'
    order by event.created_at desc, event.id desc
    limit 1
  ) latest_event on true
  where escalation.schedule_id = state.schedule_id
    and escalation.status in ('PENDING', 'PROCESSING', 'FAILED')
    and (
      not setting.is_enabled
      or state.status <> 'NO_RESPONSE'
      or not schedule.is_active
      or activity.status <> 'ACTIVE'
      or not job.is_active
      or schedule.scheduled_date <> escalation.target_work_date
      or schedule.scheduled_date < current_date
      or latest_event.id is distinct from escalation.no_response_event_id
    );
  get diagnostics v_count = row_count;
  v_affected := v_affected + v_count;

  insert into valtrim.builder_follow_up_escalations (
    no_response_event_id,
    schedule_id,
    target_work_date,
    due_on,
    recipient_emails,
    idempotency_key
  )
  select
    latest_event.id,
    schedule.id,
    schedule.scheduled_date,
    private.add_builder_follow_up_business_days(
      (latest_event.created_at at time zone 'UTC')::date,
      setting.wait_business_days
    ),
    setting.recipient_emails,
    'valtrim-no-response-' || latest_event.id::text
  from valtrim.builder_follow_up_states state
  join valtrim.production_schedules schedule
    on schedule.id = state.schedule_id
   and schedule.is_active
   and schedule.scheduled_date >= current_date
  join valtrim.production_activities activity
    on activity.id = schedule.activity_id
   and activity.status = 'ACTIVE'
  join valtrim.jobs job
    on job.id = activity.job_id
   and job.is_active
  cross join valtrim.builder_follow_up_escalation_settings setting
  join lateral (
    select event.id, event.created_at
    from valtrim.builder_follow_up_events event
    where event.schedule_id = state.schedule_id
      and event.action = 'NO_RESPONSE'
      and event.target_work_date = schedule.scheduled_date
    order by event.created_at desc, event.id desc
    limit 1
  ) latest_event on true
  where state.status = 'NO_RESPONSE'
    and setting.is_enabled
  on conflict (no_response_event_id) do nothing;
  get diagnostics v_count = row_count;
  v_affected := v_affected + v_count;

  update valtrim.builder_follow_up_escalations escalation
  set due_on = private.add_builder_follow_up_business_days(
        (event.created_at at time zone 'UTC')::date,
        setting.wait_business_days
      ),
      recipient_emails = setting.recipient_emails,
      status = case
        when escalation.status = 'CANCELLED'
             and escalation.cancellation_reason = 'ESCALATION_DISABLED'
          then 'PENDING'
        else escalation.status
      end,
      cancellation_reason = case
        when escalation.status = 'CANCELLED'
             and escalation.cancellation_reason = 'ESCALATION_DISABLED'
          then null
        else escalation.cancellation_reason
      end
  from valtrim.builder_follow_up_events event,
    valtrim.builder_follow_up_states state,
    valtrim.production_schedules schedule,
    valtrim.production_activities activity,
    valtrim.jobs job,
    valtrim.builder_follow_up_escalation_settings setting
  where event.id = escalation.no_response_event_id
    and state.schedule_id = escalation.schedule_id
    and schedule.id = escalation.schedule_id
    and activity.id = schedule.activity_id
    and job.id = activity.job_id
    and state.status = 'NO_RESPONSE'
    and schedule.is_active
    and schedule.scheduled_date = escalation.target_work_date
    and schedule.scheduled_date >= current_date
    and activity.status = 'ACTIVE'
    and job.is_active
    and setting.is_enabled
    and escalation.status in ('PENDING', 'FAILED', 'CANCELLED')
    and (
      escalation.due_on is distinct from private.add_builder_follow_up_business_days(
        (event.created_at at time zone 'UTC')::date,
        setting.wait_business_days
      )
      or escalation.recipient_emails is distinct from setting.recipient_emails
      or (
        escalation.status = 'CANCELLED'
        and escalation.cancellation_reason = 'ESCALATION_DISABLED'
      )
    );
  get diagnostics v_count = row_count;
  v_affected := v_affected + v_count;

  return v_affected;
end;
$$;

create function valtrim.refresh_builder_follow_up_escalations()
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.refresh_builder_follow_up_escalations();
$$;

create function private.save_builder_follow_up_escalation_settings(
  p_is_enabled boolean,
  p_wait_business_days smallint,
  p_recipient_emails text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_recipient_emails valtrim.email_address[];
  v_setting valtrim.builder_follow_up_escalation_settings%rowtype;
begin
  if v_actor_id is null or not (select private.has_app_role('ADMIN')) then
    raise exception 'Only an Administrator can configure Builder follow-up escalations'
      using errcode = '42501';
  end if;

  if p_is_enabled is null
     or p_wait_business_days is null
     or p_wait_business_days not between 1 and 30
     or p_recipient_emails is null
     or cardinality(p_recipient_emails) not between 1 and 10 then
    raise exception 'Provide 1 to 10 recipients and a wait of 1 to 30 business days'
      using errcode = '22023';
  end if;

  begin
    select array_agg(distinct lower(btrim(email))::valtrim.email_address order by lower(btrim(email))::valtrim.email_address)
    into v_recipient_emails
    from unnest(p_recipient_emails) as recipient(email)
    where nullif(btrim(email), '') is not null;
  exception when check_violation or invalid_text_representation then
    raise exception 'Every escalation recipient must be a valid email address'
      using errcode = '22023';
  end;

  if cardinality(v_recipient_emails) not between 1 and 10 then
    raise exception 'Provide 1 to 10 unique escalation recipients'
      using errcode = '22023';
  end if;

  update valtrim.builder_follow_up_escalation_settings setting
  set is_enabled = p_is_enabled,
      wait_business_days = p_wait_business_days,
      recipient_emails = v_recipient_emails,
      updated_by = v_actor_id
  where setting.id = 1
  returning * into v_setting;

  perform private.refresh_builder_follow_up_escalations();

  return jsonb_build_object(
    'isEnabled', v_setting.is_enabled,
    'waitBusinessDays', v_setting.wait_business_days,
    'recipientEmails', v_setting.recipient_emails
  );
end;
$$;

create function valtrim.save_builder_follow_up_escalation_settings(
  p_is_enabled boolean,
  p_wait_business_days smallint,
  p_recipient_emails text[]
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.save_builder_follow_up_escalation_settings(
    p_is_enabled,
    p_wait_business_days,
    p_recipient_emails
  );
$$;

-- Replacing this boundary prevents repeated clicks on NO_RESPONSE from
-- creating multiple episodes. A different status must be recorded before a
-- new no-response episode can begin.
create or replace function private.record_builder_follow_up_status(
  p_schedule_id bigint,
  p_status text,
  p_note text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_work_date date;
  v_contact_id bigint;
  v_contact_name text;
  v_contact_email valtrim.email_address;
  v_existing_status text;
  v_event_id bigint;
begin
  if v_actor_id is null
     or not (select private.has_app_role(
       'ADMIN',
       'PROJECT_MANAGEMENT',
       'SCHEDULING'
     )) then
    raise exception 'You do not have permission to record Builder follow-up status'
      using errcode = '42501';
  end if;

  if p_status is null
     or p_status not in (
       'SCHEDULED', 'CONFIRMED', 'NO_RESPONSE',
       'ON_HOLD', 'COMPLETED', 'CANCELLED'
     ) then
    raise exception 'Select a supported Builder follow-up status'
      using errcode = '23514';
  end if;

  if p_note is not null and char_length(btrim(p_note)) > 500 then
    raise exception 'Builder follow-up notes must contain 500 characters or fewer'
      using errcode = '23514';
  end if;

  select
    schedule.scheduled_date,
    superintendent.id,
    superintendent.name,
    superintendent.email
  into
    v_work_date,
    v_contact_id,
    v_contact_name,
    v_contact_email
  from valtrim.production_schedules schedule
  join valtrim.production_activities activity
    on activity.id = schedule.activity_id
  join valtrim.jobs job on job.id = activity.job_id
  join valtrim.builder_contacts superintendent
    on superintendent.id = job.superintendent_id
   and superintendent.builder_id = job.builder_id
   and superintendent.type = 'JOBSITE_SUPERINTENDENT'
  where schedule.id = p_schedule_id
    and schedule.is_active
    and activity.status = 'ACTIVE'
    and job.is_active
  for update of schedule;

  if v_work_date is null then
    raise exception 'The Production schedule or designated Superintendent is unavailable'
      using errcode = 'P0002';
  end if;

  select state.status into v_existing_status
  from valtrim.builder_follow_up_states state
  where state.schedule_id = p_schedule_id
  for update;

  if p_status = 'NO_RESPONSE' and v_existing_status = 'NO_RESPONSE' then
    select event.id into v_event_id
    from valtrim.builder_follow_up_events event
    where event.schedule_id = p_schedule_id
      and event.action = 'NO_RESPONSE'
      and event.target_work_date = v_work_date
    order by event.created_at desc, event.id desc
    limit 1;

    if v_event_id is not null then
      perform private.refresh_builder_follow_up_escalations();
      return v_event_id;
    end if;
  end if;

  insert into valtrim.builder_follow_up_states (
    schedule_id,
    status,
    confirmed_for_date,
    confirmed_at,
    last_response_at,
    note,
    updated_by
  ) values (
    p_schedule_id,
    p_status,
    case when p_status = 'CONFIRMED' then v_work_date else null end,
    case when p_status = 'CONFIRMED' then now() else null end,
    case when p_status in ('CONFIRMED', 'NO_RESPONSE') then now() else null end,
    nullif(btrim(p_note), ''),
    v_actor_id
  )
  on conflict (schedule_id) do update
  set status = excluded.status,
      confirmed_for_date = excluded.confirmed_for_date,
      confirmed_at = excluded.confirmed_at,
      last_response_at = coalesce(
        excluded.last_response_at,
        valtrim.builder_follow_up_states.last_response_at
      ),
      note = excluded.note,
      updated_by = excluded.updated_by;

  if p_status in ('CONFIRMED', 'ON_HOLD', 'COMPLETED', 'CANCELLED') then
    update valtrim.builder_follow_up_checkpoints checkpoint
    set status = case when p_status = 'CONFIRMED' then 'SKIPPED' else 'CANCELLED' end,
        resolution = p_status,
        completed_at = now(),
        completed_by = v_actor_id
    where checkpoint.schedule_id = p_schedule_id
      and checkpoint.work_date = v_work_date
      and checkpoint.status = 'PENDING';

    update valtrim.builder_follow_up_emails email
    set status = 'CANCELLED',
        last_error = 'The follow-up was closed as ' || p_status || '.'
    from valtrim.builder_follow_up_checkpoints checkpoint
    where checkpoint.id = email.checkpoint_id
      and checkpoint.schedule_id = p_schedule_id
      and checkpoint.work_date = v_work_date
      and email.status in ('PROCESSING', 'FAILED');
  elsif p_status = 'SCHEDULED' then
    update valtrim.builder_follow_up_checkpoints checkpoint
    set status = 'PENDING',
        resolution = null,
        completed_at = null,
        completed_by = null
    where checkpoint.schedule_id = p_schedule_id
      and checkpoint.work_date = v_work_date
      and checkpoint.status = 'SKIPPED'
      and checkpoint.resolution = 'CONFIRMED';
  end if;

  insert into valtrim.builder_follow_up_events (
    schedule_id,
    action,
    target_work_date,
    contact_id,
    contact_name,
    contact_email,
    note,
    created_by
  ) values (
    p_schedule_id,
    p_status,
    v_work_date,
    v_contact_id,
    v_contact_name,
    v_contact_email,
    nullif(btrim(p_note), ''),
    v_actor_id
  ) returning id into v_event_id;

  perform private.refresh_builder_follow_up_checkpoints();
  perform private.refresh_builder_follow_up_escalations();
  return v_event_id;
end;
$$;

create view valtrim.builder_follow_up_attention_queue
with (security_invoker = true)
as
select
  escalation.id as escalation_id,
  latest_event.id as no_response_event_id,
  schedule.id as schedule_id,
  latest_event.created_at as no_response_since,
  schedule.scheduled_date as work_date,
  stage.stage_type,
  schedule.variant,
  job.code as job_code,
  job.community,
  builder.name as builder_name,
  phase.code as phase_code,
  phase.building,
  schedule.lot_start_label,
  schedule.lot_end_label,
  superintendent.id as superintendent_contact_id,
  superintendent.name as superintendent_name,
  superintendent.email as superintendent_email,
  setting.is_enabled as escalation_enabled,
  setting.wait_business_days,
  coalesce(escalation.recipient_emails, setting.recipient_emails) as recipient_emails,
  escalation.due_on,
  escalation.status as escalation_status,
  escalation.sent_at,
  escalation.last_error,
  case
    when not setting.is_enabled then 'DISABLED'
    when escalation.status = 'SENT' then 'SENT'
    when escalation.status = 'PROCESSING' then 'PROCESSING'
    when escalation.status = 'FAILED' then 'FAILED'
    when escalation.status = 'CANCELLED' then 'CANCELLED'
    when escalation.due_on < current_date then 'OVERDUE'
    when escalation.due_on = current_date then 'DUE'
    else 'PENDING'
  end as delivery_status,
  escalation.due_on - current_date as days_until_due
from valtrim.builder_follow_up_states state
join valtrim.production_schedules schedule
  on schedule.id = state.schedule_id
 and schedule.is_active
 and schedule.scheduled_date >= current_date
join valtrim.production_stages stage
  on stage.id = schedule.stage_id
 and stage.is_enabled
join valtrim.production_activities activity
  on activity.id = schedule.activity_id
 and activity.status = 'ACTIVE'
join valtrim.jobs job
  on job.id = activity.job_id
 and job.is_active
join valtrim.builders builder on builder.id = job.builder_id
join valtrim.phases phase on phase.id = activity.phase_id
join valtrim.builder_contacts superintendent
  on superintendent.id = job.superintendent_id
 and superintendent.builder_id = job.builder_id
 and superintendent.type = 'JOBSITE_SUPERINTENDENT'
cross join valtrim.builder_follow_up_escalation_settings setting
join lateral (
  select event.id, event.created_at
  from valtrim.builder_follow_up_events event
  where event.schedule_id = state.schedule_id
    and event.action = 'NO_RESPONSE'
    and event.target_work_date = schedule.scheduled_date
  order by event.created_at desc, event.id desc
  limit 1
) latest_event on true
left join valtrim.builder_follow_up_escalations escalation
  on escalation.no_response_event_id = latest_event.id
where state.status = 'NO_RESPONSE';

create function valtrim.prepare_builder_follow_up_escalation(
  p_escalation_id bigint,
  p_preview boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_escalation record;
begin
  perform private.refresh_builder_follow_up_escalations();

  select
    escalation.*,
    latest_event.created_at as no_response_since,
    stage.stage_type,
    schedule.variant,
    job.code as job_code,
    job.community,
    builder.name as builder_name,
    phase.code as phase_code,
    phase.building,
    schedule.lot_start_label,
    schedule.lot_end_label,
    superintendent.id as superintendent_contact_id,
    superintendent.name as superintendent_name,
    superintendent.email as superintendent_email,
    setting.is_enabled as escalation_enabled,
    setting.wait_business_days
  into v_escalation
  from valtrim.builder_follow_up_escalations escalation
  join valtrim.builder_follow_up_events latest_event
    on latest_event.id = escalation.no_response_event_id
   and latest_event.action = 'NO_RESPONSE'
  join valtrim.builder_follow_up_states state
    on state.schedule_id = escalation.schedule_id
   and state.status = 'NO_RESPONSE'
  join valtrim.production_schedules schedule
    on schedule.id = escalation.schedule_id
   and schedule.is_active
   and schedule.scheduled_date = escalation.target_work_date
   and schedule.scheduled_date >= current_date
  join valtrim.production_stages stage
    on stage.id = schedule.stage_id
   and stage.is_enabled
  join valtrim.production_activities activity
    on activity.id = schedule.activity_id
   and activity.status = 'ACTIVE'
  join valtrim.jobs job
    on job.id = activity.job_id
   and job.is_active
  join valtrim.builders builder on builder.id = job.builder_id
  join valtrim.phases phase on phase.id = activity.phase_id
  join valtrim.builder_contacts superintendent
    on superintendent.id = job.superintendent_id
   and superintendent.builder_id = job.builder_id
   and superintendent.type = 'JOBSITE_SUPERINTENDENT'
  cross join valtrim.builder_follow_up_escalation_settings setting
  where escalation.id = p_escalation_id
  for update of escalation;

  if not found or not v_escalation.escalation_enabled then
    raise exception 'The no-response escalation is unavailable'
      using errcode = 'P0002';
  end if;

  if v_escalation.status = 'SENT' then
    return jsonb_build_object(
      'alreadySent', true,
      'escalationId', v_escalation.id::text,
      'providerMessageId', v_escalation.provider_message_id
    );
  end if;

  if v_escalation.status = 'CANCELLED' then
    raise exception 'The no-response escalation is no longer eligible'
      using errcode = 'P0002';
  end if;

  if not p_preview and v_escalation.due_on > current_date then
    raise exception 'The no-response escalation is not due yet'
      using errcode = '22023';
  end if;

  if not p_preview then
    if v_escalation.status = 'PROCESSING'
       and v_escalation.processing_started_at > now() - interval '15 minutes' then
      raise exception 'This no-response escalation is already being processed'
        using errcode = '55P03';
    end if;

    update valtrim.builder_follow_up_escalations escalation
    set status = 'PROCESSING',
        attempt_count = least(escalation.attempt_count + 1, 20),
        processing_started_at = now(),
        last_error = null
    where escalation.id = v_escalation.id
    returning escalation.* into v_escalation;
  end if;

  return jsonb_build_object(
    'alreadySent', false,
    'escalationId', v_escalation.id::text,
    'idempotencyKey', v_escalation.idempotency_key,
    'noResponseEventId', v_escalation.no_response_event_id::text,
    'scheduleId', v_escalation.schedule_id::text,
    'noResponseSince', v_escalation.no_response_since,
    'waitBusinessDays', v_escalation.wait_business_days,
    'dueOn', v_escalation.due_on::text,
    'workDate', v_escalation.target_work_date::text,
    'stageType', v_escalation.stage_type::text,
    'variant', v_escalation.variant::text,
    'jobCode', v_escalation.job_code,
    'community', v_escalation.community,
    'builderName', v_escalation.builder_name,
    'phaseCode', v_escalation.phase_code,
    'building', coalesce(v_escalation.building, ''),
    'lotStartLabel', coalesce(v_escalation.lot_start_label, ''),
    'lotEndLabel', coalesce(v_escalation.lot_end_label, ''),
    'superintendentContactId', v_escalation.superintendent_contact_id::text,
    'superintendentName', v_escalation.superintendent_name,
    'superintendentEmail', v_escalation.superintendent_email::text,
    'recipientEmails', to_jsonb(v_escalation.recipient_emails)
  );
end;
$$;

create function valtrim.finish_builder_follow_up_escalation(
  p_escalation_id bigint,
  p_success boolean,
  p_subject text,
  p_text_body text,
  p_html_body text,
  p_provider_message_id text default null,
  p_last_error text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finished_at timestamptz := now();
  v_escalation valtrim.builder_follow_up_escalations%rowtype;
begin
  if p_escalation_id is null
     or p_success is null
     or nullif(btrim(p_subject), '') is null
     or char_length(p_subject) > 200
     or nullif(btrim(p_text_body), '') is null
     or nullif(btrim(p_html_body), '') is null
     or char_length(coalesce(p_last_error, '')) > 1000
     or (
       p_success
       and nullif(btrim(coalesce(p_provider_message_id, '')), '') is null
     ) then
    raise exception 'The no-response escalation email result is invalid'
      using errcode = '22023';
  end if;

  select escalation.* into v_escalation
  from valtrim.builder_follow_up_escalations escalation
  where escalation.id = p_escalation_id
  for update;

  if v_escalation.id is null then
    raise exception 'The no-response escalation is unavailable'
      using errcode = 'P0002';
  end if;

  if v_escalation.status = 'SENT' then
    return v_escalation.sent_at;
  end if;

  if v_escalation.status <> 'PROCESSING' then
    raise exception 'The no-response escalation is not processing'
      using errcode = '22023';
  end if;

  update valtrim.builder_follow_up_escalations escalation
  set status = case when p_success then 'SENT' else 'FAILED' end,
      subject = p_subject,
      text_body = p_text_body,
      html_body = p_html_body,
      provider_message_id = case
        when p_success then btrim(p_provider_message_id)
        else null
      end,
      sent_at = case when p_success then v_finished_at else null end,
      processing_started_at = null,
      last_error = case
        when p_success then null
        else coalesce(nullif(btrim(p_last_error), ''), 'Email provider request failed.')
      end
  where escalation.id = p_escalation_id;

  return v_finished_at;
end;
$$;

alter table valtrim.builder_follow_up_escalation_settings enable row level security;
alter table valtrim.builder_follow_up_escalations enable row level security;

create policy builder_follow_up_escalation_settings_select
on valtrim.builder_follow_up_escalation_settings for select to authenticated
using ((select private.is_active_user()));

create policy builder_follow_up_escalations_select
on valtrim.builder_follow_up_escalations for select to authenticated
using ((select private.is_active_user()));

revoke all on table valtrim.builder_follow_up_escalation_settings,
  valtrim.builder_follow_up_escalations,
  valtrim.builder_follow_up_attention_queue
  from public, anon, authenticated;
revoke all on sequence valtrim.builder_follow_up_escalations_id_seq
  from public, anon, authenticated;

revoke execute on function private.add_builder_follow_up_business_days(date, integer)
  from public, anon, authenticated;
revoke execute on function private.refresh_builder_follow_up_escalations()
  from public, anon, authenticated;
revoke execute on function valtrim.refresh_builder_follow_up_escalations()
  from public, anon, authenticated;
revoke execute on function private.save_builder_follow_up_escalation_settings(boolean, smallint, text[])
  from public, anon, authenticated;
revoke execute on function valtrim.save_builder_follow_up_escalation_settings(boolean, smallint, text[])
  from public, anon, authenticated;
revoke execute on function valtrim.prepare_builder_follow_up_escalation(bigint, boolean)
  from public, anon, authenticated;
revoke execute on function valtrim.finish_builder_follow_up_escalation(
  bigint, boolean, text, text, text, text, text
) from public, anon, authenticated;

grant select on table valtrim.builder_follow_up_escalation_settings,
  valtrim.builder_follow_up_escalations,
  valtrim.builder_follow_up_attention_queue
  to authenticated;
grant execute on function private.refresh_builder_follow_up_escalations()
  to authenticated, service_role;
grant execute on function valtrim.refresh_builder_follow_up_escalations()
  to authenticated, service_role;
grant execute on function private.save_builder_follow_up_escalation_settings(boolean, smallint, text[])
  to authenticated;
grant execute on function valtrim.save_builder_follow_up_escalation_settings(boolean, smallint, text[])
  to authenticated;

grant all on table valtrim.builder_follow_up_escalation_settings,
  valtrim.builder_follow_up_escalations
  to service_role;
grant select on table valtrim.builder_follow_up_attention_queue to service_role;
grant usage, select on sequence valtrim.builder_follow_up_escalations_id_seq
  to service_role;
grant execute on function private.add_builder_follow_up_business_days(date, integer)
  to service_role;
grant execute on function valtrim.prepare_builder_follow_up_escalation(bigint, boolean)
  to service_role;
grant execute on function valtrim.finish_builder_follow_up_escalation(
  bigint, boolean, text, text, text, text, text
) to service_role;

comment on table valtrim.builder_follow_up_escalation_settings is
  'Singleton configuration for internal no-response escalation timing and recipients.';
comment on table valtrim.builder_follow_up_escalations is
  'Durable, idempotent internal email outbox with one row per NO_RESPONSE episode.';
comment on view valtrim.builder_follow_up_attention_queue is
  'Immediate operator attention queue for current Production schedules with no Builder response.';
comment on function valtrim.prepare_builder_follow_up_escalation(bigint, boolean) is
  'Service-role-only validation, snapshot and lease for one internal no-response escalation email.';

notify pgrst, 'reload schema';

commit;
