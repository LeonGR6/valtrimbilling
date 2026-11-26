-- Customer Service proposal fit, block R6 (docs/customer-service-proposal-fit-plan.md).
-- Day-before traffic check, approved by the user (10 Nov 2026; on-screen warning only,
-- decision D6). The rule lives in the Edge Function customer-service-travel-check
-- (functions/_shared/customerServiceTravelCheck.ts): it asks Google again for the legs
-- of the next business day and saves them in service_travel_estimates. This migration
-- adds the run log the screens read and that keeps a second run within six hours from
-- spending anything, and schedules the function every afternoon.
begin;

create table valtrim.service_travel_check_runs (
  target_date date primary key,
  checked_at timestamptz not null default now(),
  legs smallint not null default 0 check (legs >= 0),
  refreshed smallint not null default 0 check (refreshed >= 0),
  failed smallint not null default 0 check (failed >= 0)
);

comment on table valtrim.service_travel_check_runs is
  'Last day-before traffic check per visit date. Written only by the Edge Function customer-service-travel-check (service role).';

alter table valtrim.service_travel_check_runs enable row level security;
revoke all on valtrim.service_travel_check_runs from public, anon, authenticated;
grant select on valtrim.service_travel_check_runs to authenticated;

create policy service_travel_check_runs_select
on valtrim.service_travel_check_runs for select to authenticated
using ((select private.has_app_role('ADMIN', 'SCHEDULING')));

-- Every day at 00:00 UTC: 4:00 PM in California with standard time (November–March)
-- and 5:00 PM with daylight time, after the 3:30 PM end of the workday. The project
-- URL is the one already configured for the Customer Service email automation. Run
-- details of this job are kept one week.
select cron.schedule(
  'customer-service-travel-check',
  '0 0 * * *',
  $cron$
    select net.http_post(
      url := (select automation.project_url from private.customer_service_email_automation automation where automation.singleton)
        || '/functions/v1/customer-service-travel-check',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
    delete from cron.job_run_details
    where jobid = (select jobid from cron.job where jobname = 'customer-service-travel-check')
      and end_time < now() - interval '7 days';
  $cron$
);

notify pgrst, 'reload schema';

commit;
