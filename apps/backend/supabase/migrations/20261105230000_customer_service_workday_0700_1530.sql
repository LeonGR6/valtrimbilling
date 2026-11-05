-- User-confirmed (5 Nov 2026): the Customer Service workday is 7:00 AM to
-- 3:30 PM (California), the same one the planner already applies through
-- functions/_shared/customerServiceScheduling.mjs (customerServiceWorkday).
--
-- Effects of the settings change, both intended:
-- * a request created at or after 3:30 PM starts its window the next day;
-- * customer availability windows built from now on end at 3:30 PM.
-- Availability rows already stored are not rewritten.
begin;

alter table valtrim.service_scheduling_settings
  alter column workday_starts_at set default time '07:00',
  alter column workday_ends_at set default time '15:30';

update valtrim.service_scheduling_settings
set workday_starts_at = time '07:00',
    workday_ends_at = time '15:30'
where id = 1;

alter table valtrim.service_technician_profiles
  alter column workday_starts_at set default time '07:00',
  alter column workday_ends_at set default time '15:30';

-- Jorge Murillo and Hilario Najera were registered with the form default
-- (8:00 AM to 5:00 PM); every profile takes the confirmed workday.
update valtrim.service_technician_profiles
set workday_starts_at = time '07:00',
    workday_ends_at = time '15:30'
where workday_starts_at <> time '07:00'
   or workday_ends_at <> time '15:30';

commit;
