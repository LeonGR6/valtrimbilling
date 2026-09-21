begin;

do $$
declare
  v_admin_id uuid;
  v_schedule_id bigint;
  v_checkpoint_id bigint;
  v_outbox_id bigint;
  v_public_id uuid;
  v_repeat_public_id uuid;
  v_request_id bigint;
  v_snapshot jsonb;
  v_result jsonb;
begin
  select app_user.id into v_admin_id
  from valtrim.app_users app_user
  where app_user.is_active
    and app_user.role = 'ADMIN'
  order by app_user.created_at, app_user.id
  limit 1;

  if v_admin_id is null then
    raise exception 'An active Administrator is required for Phase 18 validation';
  end if;

  select schedule.id into v_schedule_id
  from valtrim.production_schedules schedule
  join valtrim.production_stages stage
    on stage.id = schedule.stage_id
   and stage.stage_type in ('EXT', 'DM', 'HW')
   and stage.is_enabled
  join valtrim.production_activities activity
    on activity.id = schedule.activity_id
   and activity.status = 'ACTIVE'
  join valtrim.jobs job
    on job.id = activity.job_id
   and job.is_active
  join valtrim.builder_contacts superintendent
    on superintendent.id = job.superintendent_id
   and superintendent.builder_id = job.builder_id
   and superintendent.type = 'JOBSITE_SUPERINTENDENT'
   and superintendent.is_active
  where schedule.is_active
  order by schedule.id
  limit 1;

  if v_schedule_id is null then
    raise exception 'An active EXT, DM or HW schedule is required for Phase 18 validation';
  end if;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  update valtrim.production_schedules schedule
  set scheduled_date = current_date + 7,
      updated_by = v_admin_id
  where schedule.id = v_schedule_id;

  perform valtrim.refresh_builder_follow_up_checkpoints();

  select checkpoint.id into v_checkpoint_id
  from valtrim.builder_follow_up_checkpoints checkpoint
  join valtrim.builder_follow_up_rules rule on rule.id = checkpoint.rule_id
  where checkpoint.schedule_id = v_schedule_id
    and checkpoint.work_date = current_date + 7
    and checkpoint.status = 'PENDING'
    and rule.days_before = 7
  order by checkpoint.id desc
  limit 1;

  if v_checkpoint_id is null then
    raise exception 'The due one-week response checkpoint was not created';
  end if;

  select valtrim.prepare_builder_follow_up_email(v_checkpoint_id, false)
  into v_snapshot;
  v_outbox_id := (v_snapshot ->> 'outboxId')::bigint;

  select (valtrim.issue_builder_follow_up_response_token(v_outbox_id) ->> 'publicId')::uuid
  into v_public_id;
  select (valtrim.issue_builder_follow_up_response_token(v_outbox_id) ->> 'publicId')::uuid
  into v_repeat_public_id;

  if v_public_id is null or v_public_id is distinct from v_repeat_public_id then
    raise exception 'The response public id is missing or changed across an email retry';
  end if;

  perform valtrim.finish_builder_follow_up_email(
    v_outbox_id,
    true,
    'Phase 18 rollback-only email',
    'Phase 18 rollback-only text',
    '<p>Phase 18 rollback-only HTML</p>',
    'phase-18-provider-message',
    null
  );

  select valtrim.get_builder_follow_up_response(v_public_id) into v_snapshot;
  if (v_snapshot ->> 'alreadySubmitted')::boolean
     or v_snapshot ->> 'scheduleId' <> v_schedule_id::text
     or v_snapshot ->> 'workDate' <> (current_date + 7)::text
     or nullif(v_snapshot ->> 'jobCode', '') is null then
    raise exception 'The public response snapshot is invalid';
  end if;

  select valtrim.submit_builder_follow_up_response(
    v_public_id,
    'NOT_READY',
    current_date + 14,
    'Phase 18 rollback-only readiness conflict.'
  ) into v_result;
  v_request_id := (v_result ->> 'requestId')::bigint;

  if v_request_id is null
     or not exists (
       select 1
       from valtrim.builder_follow_up_states state
       where state.schedule_id = v_schedule_id
         and state.status = 'RESCHEDULE_REQUESTED'
     )
     or not exists (
       select 1
       from valtrim.builder_follow_up_reschedule_queue queue
       where queue.request_id = v_request_id
         and queue.status = 'PENDING'
         and queue.current_work_date = current_date + 7
         and queue.proposed_work_date = current_date + 14
     ) then
    raise exception 'Not ready did not create a pending requested date without moving Production';
  end if;

  select valtrim.submit_builder_follow_up_response(
    v_public_id,
    'NOT_READY',
    current_date + 14,
    'A repeated submit must be idempotent.'
  ) into v_result;
  if not (v_result ->> 'alreadySubmitted')::boolean then
    raise exception 'A repeated Not ready submit was not idempotent';
  end if;

  begin
    perform valtrim.submit_builder_follow_up_response(
      v_public_id,
      'CONFIRMED',
      null,
      null
    );
    raise exception 'The same token accepted two different responses';
  exception
    when unique_violation then null;
  end;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', v_admin_id::text)::text,
    true
  );
  select valtrim.resolve_builder_follow_up_reschedule_request(
    v_request_id,
    'APPROVED',
    'Phase 18 rollback-only approval.'
  ) into v_result;

  if v_result ->> 'decision' <> 'APPROVED'
     or not exists (
       select 1
       from valtrim.production_schedules schedule
       where schedule.id = v_schedule_id
         and schedule.scheduled_date = current_date + 14
     )
     or not exists (
       select 1
       from valtrim.builder_follow_up_reschedule_requests request
       where request.id = v_request_id
         and request.status = 'APPROVED'
     ) then
    raise exception 'Approving the requested date did not update Production and the request';
  end if;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform valtrim.refresh_builder_follow_up_checkpoints();

  select checkpoint.id into v_checkpoint_id
  from valtrim.builder_follow_up_checkpoints checkpoint
  join valtrim.builder_follow_up_rules rule on rule.id = checkpoint.rule_id
  where checkpoint.schedule_id = v_schedule_id
    and checkpoint.work_date = current_date + 14
    and checkpoint.status = 'PENDING'
    and rule.days_before = 14
  order by checkpoint.id desc
  limit 1;

  select valtrim.prepare_builder_follow_up_email(v_checkpoint_id, false)
  into v_snapshot;
  v_outbox_id := (v_snapshot ->> 'outboxId')::bigint;
  select (valtrim.issue_builder_follow_up_response_token(v_outbox_id) ->> 'publicId')::uuid
  into v_public_id;
  perform valtrim.finish_builder_follow_up_email(
    v_outbox_id,
    true,
    'Phase 18 confirmation email',
    'Phase 18 confirmation text',
    '<p>Phase 18 confirmation HTML</p>',
    'phase-18-confirmation-message',
    null
  );
  select valtrim.submit_builder_follow_up_response(
    v_public_id,
    'CONFIRMED',
    null,
    null
  ) into v_result;

  if v_result ->> 'responseAction' <> 'CONFIRMED'
     or not exists (
       select 1
       from valtrim.builder_follow_up_states state
       where state.schedule_id = v_schedule_id
         and state.status = 'CONFIRMED'
         and state.confirmed_for_date = current_date + 14
     ) then
    raise exception 'The explicit confirmation did not bind to the current Production date';
  end if;
end;
$$;

rollback;

select 'phase_18_builder_follow_up_public_responses_remote_ok' as result;
