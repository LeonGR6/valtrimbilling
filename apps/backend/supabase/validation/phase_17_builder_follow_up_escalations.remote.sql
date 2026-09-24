begin;

do $$
declare
  v_admin_id uuid;
  v_schedule_id bigint;
  v_first_event_id bigint;
  v_duplicate_event_id bigint;
  v_second_event_id bigint;
  v_escalation_id bigint;
  v_snapshot jsonb;
begin
  select app_user.id into v_admin_id
  from valtrim.app_users app_user
  where app_user.is_active
    and app_user.role = 'ADMIN'
  order by app_user.created_at, app_user.id
  limit 1;

  if v_admin_id is null then
    raise exception 'An active Administrator is required for Phase 17 validation';
  end if;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform valtrim.refresh_builder_follow_up_checkpoints();

  select queue.schedule_id into v_schedule_id
  from valtrim.builder_follow_up_queue queue
  where queue.checkpoint_status = 'PENDING'
    and queue.work_date >= current_date
  order by queue.work_date, queue.schedule_id
  limit 1;

  if v_schedule_id is null then
    raise exception 'An open Builder follow-up schedule is required for Phase 17 validation';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'authenticated',
      'sub', v_admin_id::text
    )::text,
    true
  );

  select valtrim.record_builder_follow_up_status(
    v_schedule_id,
    'NO_RESPONSE',
    'Phase 17 rollback-only validation.'
  ) into v_first_event_id;

  select valtrim.record_builder_follow_up_status(
    v_schedule_id,
    'NO_RESPONSE',
    'Repeated click must not create a duplicate episode.'
  ) into v_duplicate_event_id;

  if v_first_event_id is distinct from v_duplicate_event_id then
    raise exception 'Repeated NO_RESPONSE created a duplicate episode';
  end if;

  select escalation.id into v_escalation_id
  from valtrim.builder_follow_up_escalations escalation
  where escalation.no_response_event_id = v_first_event_id;

  if v_escalation_id is null then
    raise exception 'NO_RESPONSE did not create a durable internal escalation';
  end if;

  if (
    select count(*)
    from valtrim.builder_follow_up_escalations escalation
    where escalation.no_response_event_id = v_first_event_id
  ) <> 1 then
    raise exception 'More than one internal escalation exists for the same episode';
  end if;

  if not exists (
    select 1
    from valtrim.builder_follow_up_attention_queue queue
    where queue.schedule_id = v_schedule_id
      and queue.no_response_event_id = v_first_event_id
      and queue.recipient_emails @> array['andres@valtrim.com'::valtrim.email_address]
      and queue.due_on = private.add_builder_follow_up_business_days(
        (queue.no_response_since at time zone 'UTC')::date,
        2
      )
  ) then
    raise exception 'The immediate attention signal or two-business-day due date is invalid';
  end if;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select valtrim.prepare_builder_follow_up_escalation(v_escalation_id, true)
  into v_snapshot;

  if v_snapshot ->> 'escalationId' <> v_escalation_id::text
     or v_snapshot ->> 'noResponseEventId' <> v_first_event_id::text
     or v_snapshot -> 'recipientEmails' <> '["andres@valtrim.com"]'::jsonb
     or (v_snapshot ->> 'waitBusinessDays')::integer <> 2 then
    raise exception 'The internal escalation preview snapshot is invalid';
  end if;

  if exists (
    select 1
    from valtrim.builder_follow_up_escalations escalation
    where escalation.id = v_escalation_id
      and (escalation.status <> 'PENDING' or escalation.attempt_count <> 0)
  ) then
    raise exception 'Preview acquired or mutated the escalation delivery lease';
  end if;

  update valtrim.builder_follow_up_events
  set created_at = now() - interval '7 days'
  where id = v_first_event_id;

  select valtrim.prepare_builder_follow_up_escalation(v_escalation_id, false)
  into v_snapshot;

  if nullif(v_snapshot ->> 'jobCode', '') is null
     or nullif(v_snapshot ->> 'superintendentEmail', '') is null
     or not exists (
       select 1
       from valtrim.builder_follow_up_escalations escalation
       where escalation.id = v_escalation_id
         and escalation.status = 'PROCESSING'
         and escalation.attempt_count = 1
     ) then
    raise exception 'The live delivery lease lost its joined escalation snapshot';
  end if;

  perform valtrim.finish_builder_follow_up_escalation(
    v_escalation_id,
    false,
    'Rollback-only subject',
    'Rollback-only text',
    '<p>Rollback-only HTML</p>',
    null,
    'Rollback-only provider failure.'
  );

  if not exists (
    select 1
    from valtrim.builder_follow_up_escalations escalation
    where escalation.id = v_escalation_id
      and escalation.status = 'FAILED'
      and escalation.attempt_count = 1
  ) then
    raise exception 'A failed live escalation was not preserved for retry';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'authenticated',
      'sub', v_admin_id::text
    )::text,
    true
  );
  perform valtrim.record_builder_follow_up_status(
    v_schedule_id,
    'SCHEDULED',
    'Phase 17 validation response reset.'
  );

  if not exists (
    select 1
    from valtrim.builder_follow_up_escalations escalation
    where escalation.id = v_escalation_id
      and escalation.status = 'CANCELLED'
      and escalation.cancellation_reason = 'RESPONSE_STATUS_CHANGED'
  ) then
    raise exception 'A later response state did not cancel the unsent escalation';
  end if;

  select valtrim.record_builder_follow_up_status(
    v_schedule_id,
    'NO_RESPONSE',
    'Phase 17 second rollback-only episode.'
  ) into v_second_event_id;

  if v_second_event_id = v_first_event_id
     or not exists (
       select 1
       from valtrim.builder_follow_up_escalations escalation
       where escalation.no_response_event_id = v_second_event_id
         and escalation.status = 'PENDING'
     ) then
    raise exception 'A later contact cycle could not open a new no-response episode';
  end if;
end;
$$;

rollback;

select 'phase_17_builder_follow_up_escalations_remote_ok' as result;
