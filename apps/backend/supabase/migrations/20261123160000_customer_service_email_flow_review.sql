-- Review of the Customer Service email flow (23 Nov 2026; docs/customer-service-flujo-actual.md,
-- "Cambios a aplicar", parts B to D).
--
-- B. A confirmed appointment and a sent proposal are not cancelled: that is the rule.
--    Coordinators may still cancel them while customer emails are in test mode, to clean
--    up tests. The system closes a proposal itself when Microsoft refuses its invitation,
--    or when a new proposal replaces one whose offered days all started unanswered.
-- C. The coordinator who sent a proposal gets an email when they must act. The 48-hour
--    and "days passed" emails are claimed here so two runs never send them twice.
-- D. The customer gets a reminder of the visit the business day before. Claimed here
--    too; the Edge Function customer-service-visit-reminders decides when it is due and
--    pg_cron calls it every 15 minutes.
-- The Edge Functions decide when; this migration only adds the guarded writes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 1. Test mode (part B). Turned off together with live customer emails
-- (CUSTOMER_SERVICE_CUSTOMER_EMAILS=LIVE), so cancelling disappears for everyone.
alter table valtrim.service_scheduling_settings
  add column test_mode boolean not null default true;
comment on column valtrim.service_scheduling_settings.test_mode is
  'While true, coordinators may cancel a confirmed appointment or a sent proposal to clean up tests. Turn it off when customer emails go live (decided 23 Nov 2026).';

create function private.customer_service_test_mode()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((select settings.test_mode from valtrim.service_scheduling_settings settings where settings.id = 1), false);
$function$;
revoke all on function private.customer_service_test_mode() from public, anon, authenticated;

-- 2. Cancel an appointment: only in test mode. Otherwise unchanged from 20261106120000.
create or replace function valtrim.cancel_customer_service_appointment(
  p_appointment_id bigint,
  p_expected_updated_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_customer_service_actor();
  v_appointment valtrim.service_appointments%rowtype;
  v_time_zone text;
  v_day date;
  v_technician_id bigint;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if not private.customer_service_test_mode() then
    raise exception 'A confirmed appointment cannot be cancelled. Call the customer to agree on a change.'
      using errcode = '55000';
  end if;
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'Enter a cancellation reason of 500 characters or fewer' using errcode = '22023';
  end if;

  select * into v_appointment from valtrim.service_appointments where id = p_appointment_id;
  if not found then
    raise exception 'The appointment was not found' using errcode = 'P0002';
  end if;
  select settings.time_zone into strict v_time_zone
  from valtrim.service_scheduling_settings settings where settings.id = 1;
  v_day := (v_appointment.window_starts_at at time zone v_time_zone)::date;
  foreach v_technician_id in array (
    select array_agg(technician_id order by technician_id) from unnest(v_appointment.technician_ids) technician_id
  ) loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(format('service-appointments:%s:%s', v_technician_id, v_day), 0)
    );
  end loop;

  select * into v_appointment from valtrim.service_appointments where id = p_appointment_id for update;
  if p_expected_updated_at is null or v_appointment.updated_at is distinct from p_expected_updated_at then
    raise exception 'This appointment changed after you opened it. Reload and try again.' using errcode = '40001';
  end if;
  if not v_appointment.is_current or v_appointment.state <> 'SCHEDULED' then
    raise exception 'Only a scheduled appointment can be cancelled' using errcode = '55000';
  end if;

  update valtrim.service_appointments
  set state = 'CANCELLED', cancelled_at = pg_catalog.now(), is_current = false,
      cancel_reason = v_reason
  where id = p_appointment_id;

  update valtrim.service_requests
  set workflow_stage = 'READY_TO_PROPOSE'
  where id = v_appointment.request_id and workflow_stage in ('CONFIRMED', 'WORKING');

  return jsonb_build_object('appointmentId', p_appointment_id, 'requestId', v_appointment.request_id);
end;
$function$;

comment on function valtrim.cancel_customer_service_appointment(bigint, timestamptz, text) is
  'ADMIN/SCHEDULING only, and only in test mode. Cancels a scheduled appointment with a reason and returns the request to READY_TO_PROPOSE.';

-- 3. Cancel a proposal: only in test mode. Otherwise unchanged from 20261119120000.
create or replace function valtrim.cancel_customer_service_proposal(
  p_proposal_id bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_customer_service_actor();
  v_reason text := nullif(btrim(p_reason), '');
  v_proposal valtrim.service_proposals%rowtype;
begin
  if not private.customer_service_test_mode() then
    raise exception 'A sent proposal cannot be cancelled. Record the customer''s answer instead.'
      using errcode = '55000';
  end if;
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'Enter a cancellation reason of 500 characters or fewer' using errcode = '22023';
  end if;

  select * into v_proposal from valtrim.service_proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'The proposal was not found' using errcode = 'P0002';
  end if;
  if v_proposal.status <> 'SENT' then
    raise exception 'Only a proposal waiting for the customer can be cancelled' using errcode = '55000';
  end if;

  update valtrim.service_proposals
  set status = 'CANCELLED', cancelled_at = pg_catalog.now(), cancel_reason = v_reason,
      updated_by = v_actor_id
  where id = p_proposal_id;

  update valtrim.service_requests
  set workflow_stage = 'READY_TO_PROPOSE', updated_by = v_actor_id
  where id = v_proposal.request_id and workflow_stage = 'AWAITING_CUSTOMER';

  return jsonb_build_object('proposalId', p_proposal_id, 'requestId', v_proposal.request_id);
end;
$function$;

comment on function valtrim.cancel_customer_service_proposal(bigint, text) is
  'ADMIN/SCHEDULING only, and only in test mode. Cancels a SENT proposal with a reason, releases its options and returns the request to READY_TO_PROPOSE.';

-- 4. The system closes a proposal: its invitation was refused, or (p_require_days_passed)
-- every offered day started without an answer and a new proposal replaces it. Closing
-- twice returns the first result.
create function valtrim.close_customer_service_proposal(
  p_proposal_id bigint,
  p_reason text,
  p_require_days_passed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_reason text := nullif(btrim(p_reason), '');
  v_proposal valtrim.service_proposals%rowtype;
begin
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'Enter a closing reason of 500 characters or fewer' using errcode = '22023';
  end if;

  select * into v_proposal from valtrim.service_proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'The proposal was not found' using errcode = 'P0002';
  end if;
  if v_proposal.status = 'CANCELLED' then
    return jsonb_build_object('proposalId', p_proposal_id, 'requestId', v_proposal.request_id, 'alreadyClosed', true);
  end if;
  if v_proposal.status <> 'SENT' then
    raise exception 'This proposal was already answered' using errcode = '55000';
  end if;
  if coalesce(p_require_days_passed, false) and exists (
    select 1 from valtrim.service_proposal_options option
    where option.proposal_id = p_proposal_id and option.window_starts_at > pg_catalog.now()
  ) then
    raise exception 'This proposal still offers a day that has not started' using errcode = '55000';
  end if;

  perform pg_catalog.set_config('valtrim.system_actor', 'on', true);
  update valtrim.service_proposals
  set status = 'CANCELLED', cancelled_at = pg_catalog.now(), cancel_reason = v_reason, updated_by = null
  where id = p_proposal_id;

  update valtrim.service_requests
  set workflow_stage = 'READY_TO_PROPOSE', updated_by = null
  where id = v_proposal.request_id and workflow_stage = 'AWAITING_CUSTOMER';
  perform pg_catalog.set_config('valtrim.system_actor', '', true);

  return jsonb_build_object('proposalId', p_proposal_id, 'requestId', v_proposal.request_id, 'alreadyClosed', false);
end;
$function$;

revoke all on function valtrim.close_customer_service_proposal(bigint, text, boolean) from public, anon, authenticated;
grant execute on function valtrim.close_customer_service_proposal(bigint, text, boolean) to service_role;
comment on function valtrim.close_customer_service_proposal(bigint, text, boolean) is
  'Service role only. Closes a SENT proposal as the system (invitation refused, or every offered day started when p_require_days_passed), releases its options and returns the request to READY_TO_PROPOSE.';

-- 5. Coordinator emails (part C). The 48-hour Builder call and "days passed" go out
-- once per proposal; the communications log records them.
alter type valtrim.service_communication_type add value if not exists 'COORDINATOR_NOTICE';

alter table valtrim.service_proposals
  add column builder_call_notified_at timestamptz,
  add column days_passed_notified_at timestamptz;
comment on column valtrim.service_proposals.builder_call_notified_at is
  'When the coordinator was emailed to call the Builder (48 hours without an answer).';
comment on column valtrim.service_proposals.days_passed_notified_at is
  'When the coordinator was emailed that every offered day started without an answer.';

create function valtrim.mark_customer_service_proposal_notices(p_kind text, p_proposal_ids bigint[])
returns bigint[]
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claimed bigint[];
begin
  if p_kind not in ('BUILDER_CALL', 'DAYS_PASSED') then
    raise exception 'Unknown proposal notice' using errcode = '22023';
  end if;
  if p_proposal_ids is null or cardinality(p_proposal_ids) = 0 then
    return '{}'::bigint[];
  end if;
  perform pg_catalog.set_config('valtrim.system_actor', 'on', true);
  with claimed as (
    update valtrim.service_proposals proposal
    set builder_call_notified_at = case when p_kind = 'BUILDER_CALL' then pg_catalog.now() else proposal.builder_call_notified_at end,
        days_passed_notified_at = case when p_kind = 'DAYS_PASSED' then pg_catalog.now() else proposal.days_passed_notified_at end
    where proposal.id = any(p_proposal_ids)
      and proposal.status = 'SENT'
      and case when p_kind = 'BUILDER_CALL' then proposal.builder_call_notified_at
          else proposal.days_passed_notified_at end is null
    returning proposal.id
  )
  select coalesce(array_agg(claimed.id order by claimed.id), '{}'::bigint[]) into v_claimed from claimed;
  perform pg_catalog.set_config('valtrim.system_actor', '', true);
  return v_claimed;
end;
$function$;

revoke all on function valtrim.mark_customer_service_proposal_notices(text, bigint[]) from public, anon, authenticated;
grant execute on function valtrim.mark_customer_service_proposal_notices(text, bigint[]) to service_role;
comment on function valtrim.mark_customer_service_proposal_notices(text, bigint[]) is
  'Service role only. Marks the BUILDER_CALL or DAYS_PASSED email of each listed proposal still SENT and not notified yet, as the system, and returns the ids it marked.';

-- 6. Visit reminder (part D): once per scheduled appointment.
alter table valtrim.service_appointments
  add column visit_reminder_sent_at timestamptz;
comment on column valtrim.service_appointments.visit_reminder_sent_at is
  'When the customer was reminded of the visit (the business day before, from 3:00 PM California time).';

create function valtrim.mark_customer_service_visit_reminders(p_appointment_ids bigint[])
returns bigint[]
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claimed bigint[];
begin
  if p_appointment_ids is null or cardinality(p_appointment_ids) = 0 then
    return '{}'::bigint[];
  end if;
  perform pg_catalog.set_config('valtrim.system_actor', 'on', true);
  with claimed as (
    update valtrim.service_appointments appointment
    set visit_reminder_sent_at = pg_catalog.now()
    where appointment.id = any(p_appointment_ids)
      and appointment.is_current
      and appointment.state = 'SCHEDULED'
      and appointment.visit_reminder_sent_at is null
    returning appointment.id
  )
  select coalesce(array_agg(claimed.id order by claimed.id), '{}'::bigint[]) into v_claimed from claimed;
  perform pg_catalog.set_config('valtrim.system_actor', '', true);
  return v_claimed;
end;
$function$;

revoke all on function valtrim.mark_customer_service_visit_reminders(bigint[]) from public, anon, authenticated;
grant execute on function valtrim.mark_customer_service_visit_reminders(bigint[]) to service_role;
comment on function valtrim.mark_customer_service_visit_reminders(bigint[]) is
  'Service role only. Marks the visit reminder of each listed current scheduled appointment not reminded yet, as the system, and returns the ids it marked.';

-- 7. Every 15 minutes, like the proposal reminders. Run details are kept one week.
select cron.schedule(
  'customer-service-visit-reminders',
  '*/15 * * * *',
  $cron$
    select net.http_post(
      url := (select automation.project_url from private.customer_service_email_automation automation where automation.singleton)
        || '/functions/v1/customer-service-visit-reminders',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
    delete from cron.job_run_details
    where jobid = (select jobid from cron.job where jobname = 'customer-service-visit-reminders')
      and end_time < now() - interval '7 days';
  $cron$
);

notify pgrst, 'reload schema';
commit;
