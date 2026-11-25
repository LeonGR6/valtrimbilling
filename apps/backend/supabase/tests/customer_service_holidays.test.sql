begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- US holidays Valtrim closes (24 Nov 2026; it works the day after Thanksgiving, 25 Nov).

select is((select name::text from valtrim.service_holidays where holiday_date = '2026-11-26'), 'Thanksgiving Day',
  'Thanksgiving is a holiday');
select is((select name::text from valtrim.service_holidays where holiday_date = '2026-07-03'), 'Independence Day',
  'A Saturday holiday is observed on the Friday before');
select ok(not exists (select 1 from valtrim.service_holidays where holiday_date in ('2026-11-27', '2027-11-26', '2028-11-24')),
  'The day after Thanksgiving is a work day');
select is((select count(*) from valtrim.service_holidays where holiday_date between '2027-01-01' and '2027-12-31'), 7::bigint,
  'Six holidays a year, plus the next New Year''s Day observed on a Friday in December');

-- Due dates skip weekends and holidays.
select is(valtrim.calculate_business_due_date('2026-11-23', 5), '2026-12-01'::date,
  'Reported Monday Nov 23: Thanksgiving does not count, so it is due Tuesday Dec 1');
select is(valtrim.calculate_business_due_date('2026-11-16', 5), '2026-11-23'::date,
  'A week without holidays is unchanged');
select is(valtrim.calculate_business_due_date('2026-12-21', 5), '2026-12-29'::date,
  'Christmas Friday does not count either');

-- Admins edit the days; schedulers only read them; field users do not see them.
create temporary table holiday_fixture as select gen_random_uuid() as admin_id, gen_random_uuid() as scheduler_id,
  gen_random_uuid() as field_id;
insert into auth.users(id, email, raw_user_meta_data)
select admin_id, admin_id::text || '@example.com', '{"name":"Holiday Admin Test"}'::jsonb from holiday_fixture
union all select scheduler_id, scheduler_id::text || '@example.com', '{"name":"Holiday Scheduler Test"}'::jsonb from holiday_fixture
union all select field_id, field_id::text || '@example.com', '{"name":"Holiday Field Test"}'::jsonb from holiday_fixture;
update valtrim.app_users set role = 'ADMIN' where id = (select admin_id from holiday_fixture);
update valtrim.app_users set role = 'SCHEDULING' where id = (select scheduler_id from holiday_fixture);
update valtrim.app_users set role = 'FIELD' where id = (select field_id from holiday_fixture);
grant select on holiday_fixture to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select scheduler_id::text from holiday_fixture), true);
select ok((select count(*) from valtrim.service_holidays) > 0, 'A scheduler reads the holidays');
update valtrim.service_holidays set name = 'Changed' where holiday_date = '2026-12-25';
select is((select name::text from valtrim.service_holidays where holiday_date = '2026-12-25'), 'Christmas Day',
  'A scheduler cannot change them');
select set_config('request.jwt.claim.sub', (select field_id::text from holiday_fixture), true);
select is((select count(*) from valtrim.service_holidays), 0::bigint, 'A field user does not see them');
select set_config('request.jwt.claim.sub', (select admin_id::text from holiday_fixture), true);
select lives_ok($$insert into valtrim.service_holidays (holiday_date, name) values ('2029-01-01', 'New Year''s Day')$$,
  'An admin adds a holiday');
reset role;
select set_config('request.jwt.claim.sub', '', true);

select * from finish();
rollback;
