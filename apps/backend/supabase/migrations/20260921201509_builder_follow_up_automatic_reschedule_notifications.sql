-- Automatically apply Superintendent date changes and acknowledge every
-- public follow-up response through a durable, retryable email outbox.

begin;

alter table valtrim.builder_follow_up_events
  add column response_token_id bigint
    references valtrim.builder_follow_up_response_tokens(id) on delete set null;

create unique index builder_follow_up_events_response_token_idx
  on valtrim.builder_follow_up_events (response_token_id)
  where response_token_id is not null;

create table valtrim.builder_follow_up_response_emails (
  id bigint generated always as identity primary key,
  response_token_id bigint not null
    references valtrim.builder_follow_up_response_tokens(id) on delete cascade,
  notification_type varchar(24) not null
    check (notification_type in ('JOBSITE_RECEIPT', 'INTERNAL_ALERT')),
  recipient_emails valtrim.email_address[] not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  status varchar(16) not null default 'PENDING'
    check (status in ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED')),
  subject varchar(200),
  text_body text,
  html_body text,
  idempotency_key varchar(160) not null unique,
  provider_message_id varchar(200),
  attempt_count smallint not null default 0
    check (attempt_count between 0 and 20),
  processing_started_at timestamptz,
  sent_at timestamptz,
  last_error varchar(1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (response_token_id, notification_type),
  check (cardinality(recipient_emails) between 1 and 10),
  check (
    (status = 'SENT' and sent_at is not null and provider_message_id is not null)
    or status <> 'SENT'
  )
);

create index builder_follow_up_response_emails_delivery_idx
  on valtrim.builder_follow_up_response_emails (created_at, id)
  where status in ('PENDING', 'FAILED');

create trigger builder_follow_up_response_emails_set_updated_at
before update on valtrim.builder_follow_up_response_emails
for each row execute function valtrim.set_updated_at();

create or replace function valtrim.get_builder_follow_up_response(
  p_public_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
  v_token valtrim.builder_follow_up_response_tokens%rowtype;
  v_source record;
  v_request valtrim.builder_follow_up_reschedule_requests%rowtype;
  v_notification_ids jsonb := '[]'::jsonb;
  v_current_work_date date;
begin
  if not v_is_service then
    raise exception 'Only the response service can read a public follow-up response'
      using errcode = '42501';
  end if;

  select token.* into v_token
  from valtrim.builder_follow_up_response_tokens token
  where token.public_id = p_public_id;

  if not found then
    raise exception 'The follow-up response link is invalid'
      using errcode = 'P0002';
  end if;

  if v_token.responded_at is not null then
    select request.* into v_request
    from valtrim.builder_follow_up_reschedule_requests request
    where request.response_token_id = v_token.id;

    select schedule.scheduled_date into v_current_work_date
    from valtrim.production_schedules schedule
    where schedule.id = v_token.schedule_id;

    select coalesce(jsonb_agg(email.id::text order by email.id), '[]'::jsonb)
      into v_notification_ids
    from valtrim.builder_follow_up_response_emails email
    where email.response_token_id = v_token.id;

    return jsonb_build_object(
      'alreadySubmitted', true,
      'scheduleId', v_token.schedule_id::text,
      'checkpointId', v_token.checkpoint_id::text,
      'responseAction', v_token.response_action,
      'respondedAt', v_token.responded_at,
      'workDate', v_token.target_work_date::text,
      'proposedWorkDate', v_request.proposed_work_date::text,
      'finalWorkDate', coalesce(v_request.proposed_work_date, v_token.target_work_date)::text,
      'currentWorkDate', v_current_work_date::text,
      'requestStatus', v_request.status,
      'requestId', v_request.id::text,
      'recipientName', v_token.recipient_name,
      'notificationIds', v_notification_ids
    );
  end if;

  if v_token.revoked_at is not null or v_token.expires_at <= now() then
    raise exception 'The follow-up response link is expired or no longer valid'
      using errcode = 'P0002';
  end if;

  select
    schedule.id as schedule_id,
    checkpoint.id as checkpoint_id,
    stage.stage_type,
    schedule.variant,
    schedule.scheduled_date as work_date,
    schedule.lot_start_label,
    schedule.lot_end_label,
    job.code as job_code,
    job.community,
    builder.name as builder_name,
    phase.code as phase_code,
    phase.building,
    superintendent.name as recipient_name
  into v_source
  from valtrim.production_schedules schedule
  join valtrim.builder_follow_up_checkpoints checkpoint
    on checkpoint.id = v_token.checkpoint_id
   and checkpoint.schedule_id = schedule.id
   and checkpoint.status in ('PENDING', 'COMPLETED')
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
   and superintendent.id = v_token.recipient_contact_id
   and superintendent.email = v_token.recipient_email
   and superintendent.builder_id = job.builder_id
   and superintendent.type = 'JOBSITE_SUPERINTENDENT'
   and superintendent.is_active
  where schedule.id = v_token.schedule_id
    and schedule.is_active
    and schedule.scheduled_date = v_token.target_work_date;

  if not found then
    raise exception 'The Production date or designated Superintendent changed'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'alreadySubmitted', false,
    'scheduleId', v_source.schedule_id::text,
    'checkpointId', v_source.checkpoint_id::text,
    'stageType', v_source.stage_type::text,
    'variant', v_source.variant::text,
    'workDate', v_source.work_date::text,
    'minimumProposedDate', (v_source.work_date + 1)::text,
    'lotStartLabel', coalesce(v_source.lot_start_label, ''),
    'lotEndLabel', coalesce(v_source.lot_end_label, ''),
    'jobCode', v_source.job_code,
    'community', v_source.community,
    'builderName', v_source.builder_name,
    'phaseCode', v_source.phase_code,
    'building', coalesce(v_source.building, ''),
    'recipientName', v_source.recipient_name,
    'expiresAt', v_token.expires_at
  );
end;
$$;

create or replace function valtrim.submit_builder_follow_up_response(
  p_public_id uuid,
  p_response text,
  p_proposed_work_date date default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
  v_token valtrim.builder_follow_up_response_tokens%rowtype;
  v_source record;
  v_request_id bigint;
  v_notification_id bigint;
  v_notification_ids jsonb := '[]'::jsonb;
  v_internal_recipients valtrim.email_address[];
  v_response text := upper(btrim(coalesce(p_response, '')));
  v_reason text := nullif(btrim(p_reason), '');
  v_final_work_date date;
  v_snapshot jsonb;
begin
  if not v_is_service then
    raise exception 'Only the response service can submit a public follow-up response'
      using errcode = '42501';
  end if;

  if v_response not in ('CONFIRMED', 'NOT_READY') then
    raise exception 'Select Confirmed or Not ready'
      using errcode = '22023';
  end if;

  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'The readiness note must contain 500 characters or fewer'
      using errcode = '22023';
  end if;

  select token.* into v_token
  from valtrim.builder_follow_up_response_tokens token
  where token.public_id = p_public_id
  for update;

  if not found then
    raise exception 'The follow-up response link is invalid'
      using errcode = 'P0002';
  end if;

  if v_token.responded_at is not null then
    if v_token.response_action <> v_response then
      raise exception 'A different response was already submitted with this link'
        using errcode = '23505';
    end if;

    select request.id into v_request_id
    from valtrim.builder_follow_up_reschedule_requests request
    where request.response_token_id = v_token.id;

    select coalesce(jsonb_agg(email.id::text order by email.id), '[]'::jsonb)
      into v_notification_ids
    from valtrim.builder_follow_up_response_emails email
    where email.response_token_id = v_token.id;

    return jsonb_build_object(
      'alreadySubmitted', true,
      'scheduleId', v_token.schedule_id::text,
      'checkpointId', v_token.checkpoint_id::text,
      'responseAction', v_token.response_action,
      'respondedAt', v_token.responded_at,
      'workDate', v_token.target_work_date::text,
      'proposedWorkDate', case
        when v_token.response_action = 'NOT_READY'
          then (select request.proposed_work_date::text
                from valtrim.builder_follow_up_reschedule_requests request
                where request.id = v_request_id)
        else null
      end,
      'finalWorkDate', coalesce(
        (select request.proposed_work_date
         from valtrim.builder_follow_up_reschedule_requests request
         where request.id = v_request_id),
        v_token.target_work_date
      )::text,
      'requestStatus', case when v_request_id is null then null else 'APPROVED' end,
      'requestId', v_request_id::text,
      'recipientName', v_token.recipient_name,
      'notificationIds', v_notification_ids
    );
  end if;

  if v_token.revoked_at is not null or v_token.expires_at <= now() then
    raise exception 'The follow-up response link is expired or no longer valid'
      using errcode = 'P0002';
  end if;

  select
    schedule.id as schedule_id,
    schedule.scheduled_date,
    state.status as follow_up_status,
    stage.stage_type,
    schedule.variant,
    schedule.lot_start_label,
    schedule.lot_end_label,
    job.code as job_code,
    job.community,
    builder.name as builder_name,
    phase.code as phase_code,
    phase.building,
    superintendent.id as contact_id,
    superintendent.name as contact_name,
    superintendent.email as contact_email
  into v_source
  from valtrim.production_schedules schedule
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
   and superintendent.id = v_token.recipient_contact_id
   and superintendent.email = v_token.recipient_email
   and superintendent.builder_id = job.builder_id
   and superintendent.type = 'JOBSITE_SUPERINTENDENT'
   and superintendent.is_active
  join valtrim.builder_follow_up_states state
    on state.schedule_id = schedule.id
  where schedule.id = v_token.schedule_id
    and schedule.is_active
    and schedule.scheduled_date = v_token.target_work_date
    and state.status not in (
      'CONFIRMED', 'RESCHEDULE_REQUESTED', 'ON_HOLD', 'COMPLETED', 'CANCELLED'
    )
  for update of schedule, state;

  if not found then
    raise exception 'The Production date, response state, or designated Superintendent changed'
      using errcode = 'P0002';
  end if;

  if v_response = 'NOT_READY' then
    if p_proposed_work_date is null
       or p_proposed_work_date <= v_token.target_work_date
       or p_proposed_work_date > v_token.target_work_date + 365 then
      raise exception 'Select a new date after the current work date and within one year'
        using errcode = '22023';
    end if;
    v_final_work_date := p_proposed_work_date;

    insert into valtrim.builder_follow_up_reschedule_requests (
      response_token_id,
      schedule_id,
      target_work_date,
      proposed_work_date,
      reason,
      status,
      superintendent_contact_id,
      superintendent_name,
      superintendent_email,
      reviewed_at,
      review_note
    ) values (
      v_token.id,
      v_token.schedule_id,
      v_token.target_work_date,
      p_proposed_work_date,
      v_reason,
      'APPROVED',
      v_token.recipient_contact_id,
      v_token.recipient_name,
      v_token.recipient_email,
      now(),
      'Automatically applied from the secure Jobsite response.'
    ) returning id into v_request_id;

    update valtrim.production_schedules schedule
    set scheduled_date = p_proposed_work_date,
        updated_by = null
    where schedule.id = v_token.schedule_id;

    update valtrim.builder_follow_up_states state
    set status = 'RESCHEDULED',
        confirmed_for_date = null,
        confirmed_at = null,
        last_response_at = now(),
        note = left(
          'Automatically rescheduled by the Jobsite Superintendent from '
            || v_token.target_work_date::text || ' to ' || p_proposed_work_date::text
            || case when v_reason is null then '.' else ': ' || v_reason end,
          500
        ),
        updated_by = null
    where state.schedule_id = v_token.schedule_id;
  else
    v_final_work_date := v_token.target_work_date;

    update valtrim.builder_follow_up_states state
    set status = 'CONFIRMED',
        confirmed_for_date = v_token.target_work_date,
        confirmed_at = now(),
        last_response_at = now(),
        note = 'Confirmed by the Jobsite Superintendent from the email response link.',
        updated_by = null
    where state.schedule_id = v_token.schedule_id;

    update valtrim.builder_follow_up_checkpoints checkpoint
    set status = 'SKIPPED',
        resolution = 'CONFIRMED',
        completed_at = now(),
        completed_by = null
    where checkpoint.schedule_id = v_token.schedule_id
      and checkpoint.work_date = v_token.target_work_date
      and checkpoint.status = 'PENDING';
  end if;

  update valtrim.builder_follow_up_emails email
  set status = 'CANCELLED',
      last_error = case
        when v_response = 'CONFIRMED'
          then 'The Superintendent confirmed the work date.'
        else 'The Superintendent moved the Production work date.'
      end
  from valtrim.builder_follow_up_checkpoints checkpoint
  where checkpoint.id = email.checkpoint_id
    and checkpoint.schedule_id = v_token.schedule_id
    and checkpoint.work_date = v_token.target_work_date
    and email.status in ('PROCESSING', 'FAILED');

  insert into valtrim.builder_follow_up_events (
    schedule_id,
    checkpoint_id,
    response_token_id,
    action,
    target_work_date,
    contact_id,
    contact_name,
    contact_email,
    communication_method,
    note
  ) values (
    v_token.schedule_id,
    v_token.checkpoint_id,
    v_token.id,
    case when v_response = 'CONFIRMED' then 'CONFIRMED' else 'NOT_READY' end,
    v_token.target_work_date,
    v_token.recipient_contact_id,
    v_token.recipient_name,
    v_token.recipient_email,
    'EMAIL',
    case
      when v_response = 'CONFIRMED'
        then 'Confirmed from the secure email response link.'
      else left(
        'Production date automatically moved to ' || p_proposed_work_date::text
          || case when v_reason is null then '.' else ': ' || v_reason end,
        500
      )
    end
  );

  update valtrim.builder_follow_up_response_tokens token
  set responded_at = now(),
      response_action = v_response
  where token.id = v_token.id
  returning token.responded_at into v_token.responded_at;

  update valtrim.builder_follow_up_response_tokens token
  set revoked_at = now(),
      revocation_reason = 'RESPONSE_RECORDED'
  where token.schedule_id = v_token.schedule_id
    and token.target_work_date = v_token.target_work_date
    and token.id <> v_token.id
    and token.responded_at is null
    and token.revoked_at is null;

  v_snapshot := jsonb_build_object(
    'responseTokenId', v_token.id::text,
    'scheduleId', v_token.schedule_id::text,
    'responseAction', v_response,
    'respondedAt', v_token.responded_at,
    'targetWorkDate', v_token.target_work_date::text,
    'finalWorkDate', v_final_work_date::text,
    'stageType', v_source.stage_type::text,
    'variant', v_source.variant::text,
    'jobCode', v_source.job_code,
    'community', v_source.community,
    'builderName', v_source.builder_name,
    'phaseCode', v_source.phase_code,
    'building', coalesce(v_source.building, ''),
    'lotStartLabel', coalesce(v_source.lot_start_label, ''),
    'lotEndLabel', coalesce(v_source.lot_end_label, ''),
    'superintendentName', v_token.recipient_name,
    'superintendentEmail', v_token.recipient_email,
    'reason', v_reason
  );

  insert into valtrim.builder_follow_up_response_emails (
    response_token_id,
    notification_type,
    recipient_emails,
    snapshot,
    idempotency_key
  ) values (
    v_token.id,
    'JOBSITE_RECEIPT',
    array[v_token.recipient_email]::valtrim.email_address[],
    v_snapshot,
    'valtrim-follow-up-response-' || v_token.id::text || '-jobsite'
  ) returning id into v_notification_id;
  v_notification_ids := jsonb_build_array(v_notification_id::text);

  if v_response = 'NOT_READY' then
    select setting.recipient_emails into v_internal_recipients
    from valtrim.builder_follow_up_escalation_settings setting
    where setting.id = 1
      and setting.is_enabled;

    if coalesce(cardinality(v_internal_recipients), 0) > 0 then
      insert into valtrim.builder_follow_up_response_emails (
        response_token_id,
        notification_type,
        recipient_emails,
        snapshot,
        idempotency_key
      ) values (
        v_token.id,
        'INTERNAL_ALERT',
        v_internal_recipients,
        v_snapshot,
        'valtrim-follow-up-response-' || v_token.id::text || '-internal'
      ) returning id into v_notification_id;
      v_notification_ids := v_notification_ids || jsonb_build_array(v_notification_id::text);
    end if;
  end if;

  perform private.refresh_builder_follow_up_checkpoints();
  perform private.refresh_builder_follow_up_escalations();

  return jsonb_build_object(
    'alreadySubmitted', false,
    'scheduleId', v_token.schedule_id::text,
    'checkpointId', v_token.checkpoint_id::text,
    'responseAction', v_response,
    'respondedAt', v_token.responded_at,
    'workDate', v_token.target_work_date::text,
    'proposedWorkDate', p_proposed_work_date::text,
    'finalWorkDate', v_final_work_date::text,
    'currentWorkDate', v_final_work_date::text,
    'requestStatus', case when v_request_id is null then null else 'APPROVED' end,
    'requestId', v_request_id::text,
    'recipientName', v_token.recipient_name,
    'notificationIds', v_notification_ids
  );
end;
$$;

create function valtrim.prepare_builder_follow_up_response_email(
  p_notification_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
  v_notification valtrim.builder_follow_up_response_emails%rowtype;
begin
  if not v_is_service then
    raise exception 'Only the email service can prepare response notifications'
      using errcode = '42501';
  end if;

  select email.* into v_notification
  from valtrim.builder_follow_up_response_emails email
  where email.id = p_notification_id
  for update;

  if not found then
    raise exception 'The response notification is unavailable'
      using errcode = 'P0002';
  end if;

  if v_notification.status = 'SENT' then
    return jsonb_build_object(
      'alreadySent', true,
      'notificationId', v_notification.id::text,
      'providerMessageId', v_notification.provider_message_id
    );
  end if;

  if v_notification.status = 'CANCELLED' then
    raise exception 'The response notification was cancelled'
      using errcode = 'P0002';
  end if;

  if v_notification.status = 'PROCESSING'
     and v_notification.processing_started_at > now() - interval '15 minutes' then
    raise exception 'The response notification is already being processed'
      using errcode = '55P03';
  end if;

  if v_notification.attempt_count >= 20 then
    raise exception 'The response notification reached its retry limit'
      using errcode = '23514';
  end if;

  update valtrim.builder_follow_up_response_emails email
  set status = 'PROCESSING',
      attempt_count = email.attempt_count + 1,
      processing_started_at = now(),
      last_error = null
  where email.id = v_notification.id;

  return v_notification.snapshot || jsonb_build_object(
    'alreadySent', false,
    'notificationId', v_notification.id::text,
    'notificationType', v_notification.notification_type,
    'recipientEmails', to_jsonb(v_notification.recipient_emails),
    'idempotencyKey', v_notification.idempotency_key
  );
end;
$$;

create function valtrim.finish_builder_follow_up_response_email(
  p_notification_id bigint,
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
  v_is_service boolean := coalesce((select auth.jwt() ->> 'role') = 'service_role', false);
  v_notification valtrim.builder_follow_up_response_emails%rowtype;
  v_sent_at timestamptz;
begin
  if not v_is_service then
    raise exception 'Only the email service can finish response notifications'
      using errcode = '42501';
  end if;

  select email.* into v_notification
  from valtrim.builder_follow_up_response_emails email
  where email.id = p_notification_id
  for update;

  if not found then
    raise exception 'The response notification is unavailable'
      using errcode = 'P0002';
  end if;

  if v_notification.status = 'SENT' then
    return v_notification.sent_at;
  end if;

  if v_notification.status <> 'PROCESSING' then
    raise exception 'The response notification is not being processed'
      using errcode = '55000';
  end if;

  if p_success and nullif(btrim(p_provider_message_id), '') is null then
    raise exception 'The provider message id is required after delivery'
      using errcode = '22023';
  end if;

  update valtrim.builder_follow_up_response_emails email
  set status = case when p_success then 'SENT' else 'FAILED' end,
      subject = left(nullif(btrim(p_subject), ''), 200),
      text_body = p_text_body,
      html_body = p_html_body,
      provider_message_id = case
        when p_success then left(btrim(p_provider_message_id), 200)
        else null
      end,
      sent_at = case when p_success then now() else null end,
      processing_started_at = null,
      last_error = case
        when p_success then null
        else left(coalesce(nullif(btrim(p_last_error), ''), 'Unknown delivery error'), 1000)
      end
  where email.id = v_notification.id
  returning email.sent_at into v_sent_at;

  return v_sent_at;
end;
$$;

create view valtrim.builder_follow_up_response_history
with (security_invoker = true)
as
select
  event.id as response_event_id,
  event.schedule_id,
  event.action as response_action,
  event.target_work_date,
  request.proposed_work_date,
  coalesce(request.proposed_work_date, event.target_work_date) as final_work_date,
  schedule.scheduled_date as current_work_date,
  request.id as request_id,
  request.status as request_status,
  event.created_at as responded_at,
  event.contact_id as superintendent_contact_id,
  event.contact_name as superintendent_name,
  event.contact_email as superintendent_email,
  request.reason,
  stage.stage_type,
  schedule.variant,
  job.code as job_code,
  job.community,
  builder.name as builder_name,
  phase.code as phase_code,
  phase.building,
  schedule.lot_start_label,
  schedule.lot_end_label
from valtrim.builder_follow_up_events event
join valtrim.production_schedules schedule on schedule.id = event.schedule_id
join valtrim.production_stages stage on stage.id = schedule.stage_id
join valtrim.production_activities activity on activity.id = schedule.activity_id
join valtrim.jobs job on job.id = activity.job_id
join valtrim.builders builder on builder.id = job.builder_id
join valtrim.phases phase on phase.id = activity.phase_id
left join valtrim.builder_follow_up_reschedule_requests request
  on request.response_token_id = event.response_token_id
where event.action in ('CONFIRMED', 'NOT_READY')
  and event.response_token_id is not null;

alter table valtrim.builder_follow_up_response_emails enable row level security;

revoke all on table valtrim.builder_follow_up_response_emails,
  valtrim.builder_follow_up_response_history
  from public, anon, authenticated;
revoke all on sequence valtrim.builder_follow_up_response_emails_id_seq
  from public, anon, authenticated;
revoke execute on function valtrim.prepare_builder_follow_up_response_email(bigint),
  valtrim.finish_builder_follow_up_response_email(
    bigint, boolean, text, text, text, text, text
  ) from public, anon, authenticated;

grant all on table valtrim.builder_follow_up_response_emails to service_role;
grant usage, select on sequence valtrim.builder_follow_up_response_emails_id_seq
  to service_role;
grant select on table valtrim.builder_follow_up_response_history
  to authenticated, service_role;
grant execute on function valtrim.prepare_builder_follow_up_response_email(bigint),
  valtrim.finish_builder_follow_up_response_email(
    bigint, boolean, text, text, text, text, text
  ) to service_role;

comment on table valtrim.builder_follow_up_response_emails is
  'Durable acknowledgement and internal-alert outbox for explicit Superintendent responses.';
comment on view valtrim.builder_follow_up_response_history is
  'Recent secure Superintendent confirmations and automatically applied date changes.';
comment on table valtrim.builder_follow_up_reschedule_requests is
  'Audit log of Superintendent-proposed dates; new secure responses are applied automatically.';
comment on function valtrim.submit_builder_follow_up_response(uuid, text, date, text) is
  'Service-only idempotent response recording. NOT_READY atomically changes the Production date and enqueues acknowledgement emails.';

notify pgrst, 'reload schema';

commit;
