-- Prevent catch-up storms when ValtrimBilling begins tracking a schedule after
-- more than one matrix checkpoint has already passed. Keep only the most
-- recent due checkpoint open, and never remind after the work date itself.

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
        when state.status = 'CONFIRMED'
             and state.confirmed_for_date = checkpoint.work_date then 'CONFIRMED'
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
      or (state.status = 'CONFIRMED' and state.confirmed_for_date = checkpoint.work_date)
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
    and not (
      state.status = 'CONFIRMED'
      and state.confirmed_for_date = schedule.scheduled_date
    )
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

comment on function private.refresh_builder_follow_up_checkpoints() is
  'Idempotently rebuilds follow-up checkpoints and suppresses obsolete catch-up email attempts.';

commit;
