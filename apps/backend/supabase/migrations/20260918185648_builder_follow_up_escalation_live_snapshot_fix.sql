-- Preserve the full joined escalation snapshot after acquiring the live
-- delivery lease. Returning only escalation.* would discard schedule/contact
-- fields from the polymorphic record before the JSON snapshot is built.

begin;

create or replace function valtrim.prepare_builder_follow_up_escalation(
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
    where escalation.id = v_escalation.id;
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

revoke execute on function valtrim.prepare_builder_follow_up_escalation(bigint, boolean)
  from public, anon, authenticated;
grant execute on function valtrim.prepare_builder_follow_up_escalation(bigint, boolean)
  to service_role;

comment on function valtrim.prepare_builder_follow_up_escalation(bigint, boolean) is
  'Service-role-only validation, snapshot and lease for one internal no-response escalation email.';

notify pgrst, 'reload schema';

commit;
