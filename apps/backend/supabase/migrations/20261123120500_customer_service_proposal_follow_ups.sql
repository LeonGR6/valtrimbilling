-- Block B, step B7 (docs/customer-service-block-b-plan.md): follow-ups of a proposal
-- still waiting for the customer.
--
-- - 24 hours after sending, the customer gets one reminder email from the same
--   mailbox (decisions of 18-19 Nov 2026: calendar hours, weekends included). The Edge
--   Function customer-service-proposal-reminders decides which proposals are due; this
--   migration only adds the guarded write that claims them, so two runs never remind the
--   same proposal twice, and schedules the function every 15 minutes.
-- - 48 hours after sending, the screen asks the coordinator to call the Builder (the
--   Job's jobsite superintendent, decided 23 Nov 2026) and to record it with "Builder
--   contacted".
-- Both columns already exist (20261119120000) and the proposal audit already names
-- both events. No business rule lives here.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 1. Claim reminders: only proposals still SENT and not reminded yet. The reminder is
-- the system's, not the coordinator's who sent the proposal.
create function valtrim.mark_customer_service_proposal_reminders(p_proposal_ids bigint[])
returns bigint[]
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claimed bigint[];
begin
  if p_proposal_ids is null or cardinality(p_proposal_ids) = 0 then
    return '{}'::bigint[];
  end if;
  perform pg_catalog.set_config('valtrim.system_actor', 'on', true);
  with claimed as (
    update valtrim.service_proposals proposal
    set reminder_sent_at = pg_catalog.now()
    where proposal.id = any(p_proposal_ids)
      and proposal.status = 'SENT'
      and proposal.reminder_sent_at is null
    returning proposal.id
  )
  select coalesce(array_agg(claimed.id order by claimed.id), '{}'::bigint[]) into v_claimed from claimed;
  perform pg_catalog.set_config('valtrim.system_actor', '', true);
  return v_claimed;
end;
$function$;

-- 2. Builder contacted: the signed-in coordinator records the call. A second click
-- keeps the first time.
create function valtrim.mark_customer_service_proposal_builder_contacted(p_proposal_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_customer_service_actor();
  v_proposal valtrim.service_proposals%rowtype;
begin
  select * into v_proposal from valtrim.service_proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'The proposal was not found' using errcode = 'P0002';
  end if;
  if v_proposal.status <> 'SENT' then
    raise exception 'Only a proposal waiting for the customer can be followed up' using errcode = '55000';
  end if;
  if v_proposal.builder_contacted_at is not null then
    return jsonb_build_object('proposalId', p_proposal_id, 'builderContactedAt', v_proposal.builder_contacted_at,
      'alreadyRecorded', true);
  end if;

  update valtrim.service_proposals
  set builder_contacted_at = pg_catalog.now(), updated_by = v_actor_id
  where id = p_proposal_id
  returning * into v_proposal;

  return jsonb_build_object('proposalId', p_proposal_id, 'builderContactedAt', v_proposal.builder_contacted_at,
    'alreadyRecorded', false);
end;
$function$;

revoke all on function valtrim.mark_customer_service_proposal_reminders(bigint[]) from public, anon, authenticated;
revoke all on function valtrim.mark_customer_service_proposal_builder_contacted(bigint) from public, anon, authenticated;
grant execute on function valtrim.mark_customer_service_proposal_reminders(bigint[]) to service_role;
grant execute on function valtrim.mark_customer_service_proposal_builder_contacted(bigint) to authenticated;

comment on function valtrim.mark_customer_service_proposal_reminders(bigint[]) is
  'Service role only. Marks the reminder of each listed proposal that is still SENT and not reminded yet, as the system, and returns the ids it marked.';
comment on function valtrim.mark_customer_service_proposal_builder_contacted(bigint) is
  'ADMIN/SCHEDULING only. Records that the Builder was called about a proposal still waiting for the customer.';

-- 3. Every 15 minutes, so a reminder leaves at most 15 minutes after the 24 hours. The
-- project URL is the one already configured for the Customer Service email automation.
-- Run details of this job are kept one week.
select cron.schedule(
  'customer-service-proposal-reminders',
  '*/15 * * * *',
  $cron$
    select net.http_post(
      url := (select automation.project_url from private.customer_service_email_automation automation where automation.singleton)
        || '/functions/v1/customer-service-proposal-reminders',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
    delete from cron.job_run_details
    where jobid = (select jobid from cron.job where jobname = 'customer-service-proposal-reminders')
      and end_time < now() - interval '7 days';
  $cron$
);

notify pgrst, 'reload schema';
commit;
