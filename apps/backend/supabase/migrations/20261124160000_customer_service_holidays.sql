-- US construction holidays (decided 24 Nov 2026): New Year's Day, Memorial Day,
-- Independence Day, Labor Day, Thanksgiving, the day after Thanksgiving and Christmas,
-- on the weekday they are observed (Saturday moves to Friday, Sunday to Monday).
-- They are configuration, not code: admins can add or remove days in this table.
-- A holiday is not a business day: it shows in Calendar, no visit is offered or
-- registered on it, and it does not count toward due dates, the lead days or the visit
-- reminder. The browser and the Edge Functions read the table; due dates are computed
-- here, so calculate_business_due_date now skips the holidays too.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table valtrim.service_holidays (
  holiday_date date primary key,
  name varchar(80) not null check (btrim(name) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table valtrim.service_holidays is
  'Days Valtrim is closed (US construction holidays). Not business days for Customer Service scheduling and due dates.';

create trigger service_holidays_set_updated_at
before update on valtrim.service_holidays
for each row execute function valtrim.set_updated_at();

alter table valtrim.service_holidays enable row level security;
revoke all on valtrim.service_holidays from public, anon;
grant select, insert, update, delete on valtrim.service_holidays to authenticated;
grant select on valtrim.service_holidays to service_role;

create policy service_holidays_select
on valtrim.service_holidays for select to authenticated
using ((select private.has_app_role('ADMIN', 'SCHEDULING')));

create policy service_holidays_admin_write
on valtrim.service_holidays for all to authenticated
using ((select private.has_app_role('ADMIN')))
with check ((select private.has_app_role('ADMIN')));

insert into valtrim.service_holidays (holiday_date, name) values
  ('2026-01-01', 'New Year''s Day'),
  ('2026-05-25', 'Memorial Day'),
  ('2026-07-03', 'Independence Day'),
  ('2026-09-07', 'Labor Day'),
  ('2026-11-26', 'Thanksgiving Day'),
  ('2026-11-27', 'Day after Thanksgiving'),
  ('2026-12-25', 'Christmas Day'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-05-31', 'Memorial Day'),
  ('2027-07-05', 'Independence Day'),
  ('2027-09-06', 'Labor Day'),
  ('2027-11-25', 'Thanksgiving Day'),
  ('2027-11-26', 'Day after Thanksgiving'),
  ('2027-12-24', 'Christmas Day'),
  ('2027-12-31', 'New Year''s Day'),
  ('2028-05-29', 'Memorial Day'),
  ('2028-07-04', 'Independence Day'),
  ('2028-09-04', 'Labor Day'),
  ('2028-11-23', 'Thanksgiving Day'),
  ('2028-11-24', 'Day after Thanksgiving'),
  ('2028-12-25', 'Christmas Day')
on conflict do nothing;

-- Due dates skip weekends and holidays. It reads the holidays, so it is stable, and it
-- runs as its owner so every caller sees the same days whatever their role.
create or replace function valtrim.calculate_business_due_date(p_start_date date, p_business_days integer)
returns date
language plpgsql
stable
strict
security definer
set search_path = ''
as $function$
declare
  v_date date := p_start_date;
  v_days_counted integer := 0;
begin
  if p_business_days < 1 then
    raise exception 'Business days must be greater than zero';
  end if;

  while v_days_counted < p_business_days loop
    v_date := v_date + 1;

    if extract(isodow from v_date) between 1 and 5
       and not exists (select 1 from valtrim.service_holidays holiday where holiday.holiday_date = v_date) then
      v_days_counted := v_days_counted + 1;
    end if;
  end loop;

  return v_date;
end;
$function$;

-- Open requests get the due date the new rule gives (the trigger recomputes it from
-- reported_on on every write, so touching due_on is enough).
update valtrim.service_requests request
set due_on = valtrim.calculate_business_due_date(request.reported_on, coalesce(
  (select settings.business_days_to_complete from valtrim.service_scheduling_settings settings where settings.id = 1), 5))
where request.closed_at is null
  and request.workflow_stage <> 'COMPLETED'
  and request.reported_on is not null
  and request.due_on is distinct from valtrim.calculate_business_due_date(request.reported_on, coalesce(
    (select settings.business_days_to_complete from valtrim.service_scheduling_settings settings where settings.id = 1), 5));

notify pgrst, 'reload schema';
commit;
