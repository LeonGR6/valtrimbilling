-- Keep the delivery history visible and let each matrix checkpoint remain
-- independently sendable after the Superintendent confirms the work date.

begin;

create or replace function private.refresh_builder_follow_up_checkpoints()
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
    raise exception 'You do not have permission to refresh Builder follow-ups'
      using errcode = '42501';
  end if;

  insert into valtrim.builder_follow_up_states (schedule_id, status)
  select schedule.id, 'SCHEDULED'
  from valtrim.production_schedules schedule
  join valtrim.production_stages stage
    on stage.id = schedule.stage_id
   and stage.is_enabled
   and stage.stage_type in ('EXT', 'DM', 'HW')
  join valtrim.production_activities activity
    on activity.id = schedule.activity_id
   and activity.status = 'ACTIVE'
  where schedule.is_active
  on conflict (schedule_id) do nothing;

  update valtrim.builder_follow_up_checkpoints checkpoint
  set status = 'CANCELLED',
      resolution = case
        when not rule.is_active then 'RULE_DISABLED'
        when schedule.scheduled_date <> checkpoint.work_date then 'WORK_DATE_CHANGED'
        else state.status
      end,
      completed_at = now()
  from valtrim.builder_follow_up_rules rule,
    valtrim.production_schedules schedule,
    valtrim.production_stages stage,
    valtrim.production_activities activity,
    valtrim.builder_follow_up_states state
  where checkpoint.rule_id = rule.id
    and schedule.id = checkpoint.schedule_id
    and stage.id = schedule.stage_id
    and activity.id = schedule.activity_id
    and state.schedule_id = checkpoint.schedule_id
    and checkpoint.status = 'PENDING'
    and (
      not rule.is_active
      or not schedule.is_active
      or not stage.is_enabled
      or activity.status <> 'ACTIVE'
      or schedule.scheduled_date <> checkpoint.work_date
      or state.status in ('ON_HOLD', 'COMPLETED', 'CANCELLED')
    );
  get diagnostics v_count = row_count;
  v_affected := v_affected + v_count;

  update valtrim.builder_follow_up_emails email
  set status = 'CANCELLED',
      last_error = coalesce(email.last_error, 'The source follow-up checkpoint was cancelled.')
  from valtrim.builder_follow_up_checkpoints checkpoint
  where checkpoint.id = email.checkpoint_id
    and checkpoint.status = 'CANCELLED'
    and email.status in ('PROCESSING', 'FAILED');

  insert into valtrim.builder_follow_up_checkpoints (
    schedule_id,
    rule_id,
    work_date,
    due_on,
    requires_approval
  )
  select
    schedule.id,
    rule.id,
    schedule.scheduled_date,
    schedule.scheduled_date - rule.days_before,
    rule.requires_approval
  from valtrim.production_schedules schedule
  join valtrim.production_stages stage
    on stage.id = schedule.stage_id
   and stage.is_enabled
  join valtrim.production_activities activity
    on activity.id = schedule.activity_id
   and activity.status = 'ACTIVE'
  join valtrim.builder_follow_up_rules rule
    on rule.stage_type = stage.stage_type
   and rule.is_active
   and not rule.is_exception
  join valtrim.builder_follow_up_states state
    on state.schedule_id = schedule.id
  where schedule.is_active
    and state.status not in ('ON_HOLD', 'COMPLETED', 'CANCELLED')
  on conflict (schedule_id, rule_id, work_date) do update
  set due_on = excluded.due_on,
      requires_approval = excluded.requires_approval
  where valtrim.builder_follow_up_checkpoints.status = 'PENDING';
  get diagnostics v_count = row_count;
  v_affected := v_affected + v_count;

  update valtrim.builder_follow_up_checkpoints checkpoint
  set status = 'SKIPPED',
      resolution = 'WORK_DATE_PASSED',
      completed_at = now()
  where checkpoint.status = 'PENDING'
    and checkpoint.work_date < current_date;
  get diagnostics v_count = row_count;
  v_affected := v_affected + v_count;

  update valtrim.builder_follow_up_checkpoints checkpoint
  set status = 'SKIPPED',
      resolution = 'SUPERSEDED_BY_LATER_CHECKPOINT',
      completed_at = now()
  where checkpoint.status = 'PENDING'
    and checkpoint.due_on <= current_date
    and exists (
      select 1
      from valtrim.builder_follow_up_checkpoints later_checkpoint
      where later_checkpoint.schedule_id = checkpoint.schedule_id
        and later_checkpoint.work_date = checkpoint.work_date
        and later_checkpoint.status = 'PENDING'
        and later_checkpoint.due_on <= current_date
        and later_checkpoint.due_on > checkpoint.due_on
    );
  get diagnostics v_count = row_count;
  v_affected := v_affected + v_count;

  update valtrim.builder_follow_up_emails email
  set status = 'CANCELLED',
      last_error = coalesce(
        email.last_error,
        'A later checkpoint became due before this email was sent.'
      )
  from valtrim.builder_follow_up_checkpoints checkpoint
  where checkpoint.id = email.checkpoint_id
    and checkpoint.status = 'SKIPPED'
    and email.status in ('PROCESSING', 'FAILED');

  return v_affected;
end;
$$;

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

  if p_status in ('ON_HOLD', 'COMPLETED', 'CANCELLED') then
    update valtrim.builder_follow_up_checkpoints checkpoint
    set status = 'CANCELLED',
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
      and checkpoint.status in ('SKIPPED', 'CANCELLED')
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

create or replace function valtrim.prepare_builder_follow_up_email(
  p_checkpoint_id bigint,
  p_preview boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checkpoint record;
  v_outbox valtrim.builder_follow_up_emails%rowtype;
  v_idempotency_key text;
begin
  perform private.refresh_builder_follow_up_checkpoints();

  select
    checkpoint.id as checkpoint_id,
    checkpoint.work_date,
    checkpoint.due_on,
    checkpoint.status as checkpoint_status,
    checkpoint.requires_approval,
    schedule.id as schedule_id,
    schedule.variant,
    stage.stage_type,
    activity.id as activity_id,
    job.code as job_code,
    job.community,
    builder.name as builder_name,
    phase.code as phase_code,
    phase.building,
    schedule.lot_start_label,
    schedule.lot_end_label,
    superintendent.id as recipient_contact_id,
    superintendent.name as recipient_name,
    superintendent.email as recipient_email,
    superintendent.is_active as recipient_is_active,
    state.status as follow_up_status,
    state.confirmed_for_date,
    rule.checkpoint_code,
    rule.days_before
  into v_checkpoint
  from valtrim.builder_follow_up_checkpoints checkpoint
  join valtrim.builder_follow_up_rules rule
    on rule.id = checkpoint.rule_id
   and rule.is_active
  join valtrim.production_schedules schedule
    on schedule.id = checkpoint.schedule_id
   and schedule.is_active
   and schedule.scheduled_date = checkpoint.work_date
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
  join valtrim.builder_follow_up_states state
    on state.schedule_id = schedule.id
  where checkpoint.id = p_checkpoint_id
  for update of checkpoint;

  if not found then
    raise exception 'The Builder follow-up checkpoint is unavailable'
      using errcode = 'P0002';
  end if;

  if v_checkpoint.checkpoint_status <> 'PENDING'
     or v_checkpoint.requires_approval
     or not v_checkpoint.recipient_is_active
     or v_checkpoint.follow_up_status in ('ON_HOLD', 'COMPLETED', 'CANCELLED') then
    raise exception 'The Builder follow-up checkpoint is not eligible for email'
      using errcode = 'P0002';
  end if;

  if not p_preview and v_checkpoint.due_on > current_date then
    raise exception 'The Builder follow-up checkpoint is not due yet'
      using errcode = '22023';
  end if;

  v_idempotency_key := 'valtrim-follow-up-'
    || v_checkpoint.checkpoint_id::text || '-' || v_checkpoint.work_date::text;

  if not p_preview then
    select email.* into v_outbox
    from valtrim.builder_follow_up_emails email
    where email.checkpoint_id = v_checkpoint.checkpoint_id
    for update;

    if v_outbox.status = 'SENT' then
      return jsonb_build_object(
        'alreadySent', true,
        'outboxId', v_outbox.id::text,
        'providerMessageId', v_outbox.provider_message_id
      );
    end if;

    if v_outbox.status = 'PROCESSING'
       and v_outbox.processing_started_at > now() - interval '15 minutes' then
      raise exception 'This Builder follow-up email is already being processed'
        using errcode = '55P03';
    end if;

    if v_outbox.id is null then
      insert into valtrim.builder_follow_up_emails (
        checkpoint_id,
        status,
        recipient_contact_id,
        recipient_name,
        recipient_email,
        idempotency_key,
        processing_started_at
      ) values (
        v_checkpoint.checkpoint_id,
        'PROCESSING',
        v_checkpoint.recipient_contact_id,
        v_checkpoint.recipient_name,
        v_checkpoint.recipient_email,
        v_idempotency_key,
        now()
      ) returning * into v_outbox;
    else
      update valtrim.builder_follow_up_emails email
      set status = 'PROCESSING',
          recipient_contact_id = v_checkpoint.recipient_contact_id,
          recipient_name = v_checkpoint.recipient_name,
          recipient_email = v_checkpoint.recipient_email,
          attempt_count = least(email.attempt_count + 1, 20),
          processing_started_at = now(),
          last_error = null
      where email.id = v_outbox.id
      returning * into v_outbox;
    end if;
  end if;

  return jsonb_build_object(
    'alreadySent', false,
    'outboxId', case when p_preview then null else v_outbox.id::text end,
    'idempotencyKey', v_idempotency_key,
    'checkpointId', v_checkpoint.checkpoint_id::text,
    'scheduleId', v_checkpoint.schedule_id::text,
    'activityId', v_checkpoint.activity_id::text,
    'checkpointCode', v_checkpoint.checkpoint_code,
    'daysBefore', v_checkpoint.days_before,
    'dueOn', v_checkpoint.due_on::text,
    'workDate', v_checkpoint.work_date::text,
    'stageType', v_checkpoint.stage_type::text,
    'variant', v_checkpoint.variant::text,
    'jobCode', v_checkpoint.job_code,
    'community', v_checkpoint.community,
    'builderName', v_checkpoint.builder_name,
    'phaseCode', v_checkpoint.phase_code,
    'building', coalesce(v_checkpoint.building, ''),
    'lotStartLabel', coalesce(v_checkpoint.lot_start_label, ''),
    'lotEndLabel', coalesce(v_checkpoint.lot_end_label, ''),
    'recipientContactId', v_checkpoint.recipient_contact_id::text,
    'recipientName', v_checkpoint.recipient_name,
    'recipientEmail', v_checkpoint.recipient_email::text
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
      'RESCHEDULE_REQUESTED', 'ON_HOLD', 'COMPLETED', 'CANCELLED'
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
  end if;

  if v_response = 'NOT_READY' then
    update valtrim.builder_follow_up_emails email
    set status = 'CANCELLED',
        last_error = 'The Superintendent moved the Production work date.'
    from valtrim.builder_follow_up_checkpoints checkpoint
    where checkpoint.id = email.checkpoint_id
      and checkpoint.schedule_id = v_token.schedule_id
      and checkpoint.work_date = v_token.target_work_date
      and email.status in ('PROCESSING', 'FAILED');
  end if;

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

create or replace view valtrim.builder_follow_up_queue
with (security_invoker = true)
as
select
  checkpoint.id as checkpoint_id,
  schedule.id as schedule_id,
  activity.id as activity_id,
  rule.checkpoint_code,
  rule.days_before,
  stage.stage_type,
  schedule.variant,
  checkpoint.work_date,
  checkpoint.due_on,
  checkpoint.status as checkpoint_status,
  state.status as follow_up_status,
  state.confirmed_for_date,
  job.code as job_code,
  job.community,
  builder.name as builder_name,
  phase.code as phase_code,
  phase.building,
  schedule.lot_start_label,
  schedule.lot_end_label,
  superintendent.id as recipient_contact_id,
  superintendent.name as recipient_name,
  superintendent.email as recipient_email,
  superintendent.is_active as recipient_is_active,
  email.status as email_status,
  email.sent_at,
  email.last_error,
  case
    when email.status = 'SENT' then 'SENT'
    when checkpoint.status <> 'PENDING' then checkpoint.status
    when email.status = 'PROCESSING' then 'PROCESSING'
    when email.status = 'FAILED' then 'FAILED'
    when checkpoint.due_on < current_date then 'OVERDUE'
    when checkpoint.due_on = current_date then 'DUE'
    else 'UPCOMING'
  end as delivery_status,
  checkpoint.due_on - current_date as days_until_due,
  state.confirmed_at,
  state.last_response_at
from valtrim.builder_follow_up_checkpoints checkpoint
join valtrim.builder_follow_up_rules rule
  on rule.id = checkpoint.rule_id
 and rule.is_active
join valtrim.production_schedules schedule
  on schedule.id = checkpoint.schedule_id
 and schedule.is_active
 and schedule.scheduled_date = checkpoint.work_date
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
join valtrim.builder_follow_up_states state on state.schedule_id = schedule.id
left join valtrim.builder_follow_up_emails email
  on email.checkpoint_id = checkpoint.id
where checkpoint.status = 'PENDING'
   or (checkpoint.status = 'COMPLETED' and email.status = 'SENT');

-- Restore only current checkpoints that the previous confirmation behavior
-- closed. Successfully sent checkpoints remain immutable delivery history.
update valtrim.builder_follow_up_checkpoints checkpoint
set status = 'PENDING',
    resolution = null,
    completed_at = null,
    completed_by = null
from valtrim.production_schedules schedule,
  valtrim.production_stages stage,
  valtrim.production_activities activity,
  valtrim.jobs job,
  valtrim.builder_follow_up_rules rule
where schedule.id = checkpoint.schedule_id
  and stage.id = schedule.stage_id
  and activity.id = schedule.activity_id
  and job.id = activity.job_id
  and rule.id = checkpoint.rule_id
  and schedule.is_active
  and schedule.scheduled_date = checkpoint.work_date
  and stage.is_enabled
  and activity.status = 'ACTIVE'
  and job.is_active
  and rule.is_active
  and checkpoint.status in ('SKIPPED', 'CANCELLED')
  and checkpoint.resolution = 'CONFIRMED'
  and not exists (
    select 1
    from valtrim.builder_follow_up_emails email
    where email.checkpoint_id = checkpoint.id
      and email.status = 'SENT'
  );

comment on function private.refresh_builder_follow_up_checkpoints() is
  'Idempotently rebuilds independent follow-up checkpoints without treating a confirmation as delivery completion.';
comment on view valtrim.builder_follow_up_queue is
  'Current Builder follow-up matrix with scheduled and sent email checkpoints kept visible independently from the latest Jobsite response.';

commit;
