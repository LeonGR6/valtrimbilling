-- Keep secure Jobsite response events for audit, but project only responses
-- that still belong to an active Production activity and schedule.

begin;

create or replace view valtrim.builder_follow_up_response_history
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
  and event.response_token_id is not null
  and schedule.is_active
  and activity.status = 'ACTIVE'::valtrim.production_activity_status;

revoke all on table valtrim.builder_follow_up_response_history
  from public, anon, authenticated;
grant select on table valtrim.builder_follow_up_response_history
  to authenticated, service_role;

comment on view valtrim.builder_follow_up_response_history is
  'Recent secure Superintendent responses for active Production activities; cancelled activity responses remain in the audit tables.';

notify pgrst, 'reload schema';

commit;
