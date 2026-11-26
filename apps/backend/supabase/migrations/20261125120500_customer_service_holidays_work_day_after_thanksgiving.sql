-- Valtrim works the day after Thanksgiving (decided 25 Nov 2026): it is not a federal
-- holiday, so it leaves service_holidays. Six holidays a year remain: New Year's Day,
-- Memorial Day, Independence Day, Labor Day, Thanksgiving and Christmas. Open requests get
-- the due date the remaining days give.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

delete from valtrim.service_holidays
where (holiday_date, name) in (
  ('2026-11-27'::date, 'Day after Thanksgiving'),
  ('2027-11-26'::date, 'Day after Thanksgiving'),
  ('2028-11-24'::date, 'Day after Thanksgiving')
);

update valtrim.service_requests request
set due_on = valtrim.calculate_business_due_date(request.reported_on, coalesce(
  (select settings.business_days_to_complete from valtrim.service_scheduling_settings settings where settings.id = 1), 5))
where request.closed_at is null
  and request.workflow_stage <> 'COMPLETED'
  and request.reported_on is not null
  and request.due_on is distinct from valtrim.calculate_business_due_date(request.reported_on, coalesce(
    (select settings.business_days_to_complete from valtrim.service_scheduling_settings settings where settings.id = 1), 5));

commit;
