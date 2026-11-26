-- Customer Service proposal fit, decision P5 (12 Nov 2026, docs/customer-service-proposal-fit-plan.md,
-- section 8). The day-before traffic check also asks Google for legs typed by hand, without
-- changing them, so the screens can warn when the typed minutes are lower than Google's.
-- Written only by the Edge Function customer-service-travel-check (service role); the
-- existing read grant and policy on the table cover the new columns.
begin;

alter table valtrim.service_travel_estimates
  add column google_minutes smallint check (google_minutes between 0 and 999),
  add column google_checked_at timestamptz;

comment on column valtrim.service_travel_estimates.google_minutes is
  'For MANUAL legs: minutes Google gave with traffic at the planned departure in the day-before check. Never used as the leg minutes.';
comment on column valtrim.service_travel_estimates.google_checked_at is
  'When the day-before check saved google_minutes.';

notify pgrst, 'reload schema';

commit;
