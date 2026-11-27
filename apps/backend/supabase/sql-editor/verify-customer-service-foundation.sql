-- Run this read-only verification in Supabase SQL Editor after applying
-- migration 20260921120000_customer_service_foundation.sql.

with foundation_checks as (
  select
    'migration_applied'::text as check_name,
    exists (
      select 1
      from supabase_migrations.schema_migrations migration
      where migration.version = '20260921120000'
    ) as passed,
    'Migration 20260921120000 is registered by Supabase.'::text as details

  union all

  select
    'foundation_tables',
    to_regclass('valtrim.service_scheduling_settings') is not null
      and to_regclass('valtrim.service_request_availability') is not null
      and to_regclass('valtrim.service_communications') is not null
      and to_regclass('private.service_confirmation_tokens') is not null,
    'Settings, availability, communications and private tokens exist.'

  union all

  select
    'no_lunch_configuration',
    not exists (
      select 1
      from information_schema.columns column_record
      where column_record.table_schema = 'valtrim'
        and column_record.table_name = 'service_scheduling_settings'
        and column_record.column_name in ('lunch_starts_at', 'lunch_ends_at')
    ),
    'No lunch fields exist in scheduling settings.'

  union all

  select
    'five_business_days',
    valtrim.calculate_business_due_date(date '2026-09-21', 5)
      = date '2026-09-25',
    'A Monday request is due Friday; the reported day counts as day one.'

  union all

  select
    'default_settings',
    exists (
      select 1
      from valtrim.service_scheduling_settings settings
      where settings.id = 1
        and settings.business_days_to_complete = 5
        and settings.reminder_after_hours = 24
        and settings.distance_green_max_miles = 10
        and settings.distance_yellow_max_miles = 20
    ),
    'Five days, 24-hour reminder and 10/20-mile indicators are configured.'

  union all

  select
    'company_location',
    exists (
      select 1
      from valtrim.service_scheduling_settings settings
      where settings.id = 1
        and settings.company_address =
          '1526 Seventh St, Riverside, CA 92507, United States'
        and settings.company_latitude = 33.986588
        and settings.company_longitude = -117.343021
    ),
    'The Riverside office address and coordinates are configured.'

  union all

  select
    'customer_service_rls',
    (
      select count(*)
      from pg_class table_record
      join pg_namespace schema_record
        on schema_record.oid = table_record.relnamespace
      where schema_record.nspname = 'valtrim'
        and table_record.relname in (
          'service_scheduling_settings',
          'service_request_availability',
          'service_communications'
        )
        and table_record.relrowsecurity
    ) = 3,
    'Every new Data API table has Row Level Security enabled.'

  union all

  select
    'customer_service_policies',
    (
      select count(*)
      from pg_policies policy
      where policy.schemaname = 'valtrim'
        and policy.policyname like 'service_%'
    ) >= 21,
    'Customer Service has its required ADMIN/SCHEDULING policies.'

  union all

  select
    'activity_history_triggers',
    exists (
      select 1
      from pg_trigger trigger_record
      where trigger_record.tgrelid = 'valtrim.service_requests'::regclass
        and trigger_record.tgname = 'customer_service_requests_audit'
        and not trigger_record.tgisinternal
    )
    and exists (
      select 1
      from pg_trigger trigger_record
      where trigger_record.tgrelid = 'valtrim.service_appointments'::regclass
        and trigger_record.tgname = 'customer_service_appointments_audit'
        and not trigger_record.tgisinternal
    ),
    'Requests and appointments are connected to Activity History.'
)
select
  check_name,
  case when passed then 'PASS' else 'FAIL' end as result,
  details
from foundation_checks
order by check_name;

select
  settings.business_days_to_complete,
  settings.workday_starts_at,
  settings.workday_ends_at,
  settings.time_zone,
  settings.company_address,
  settings.company_latitude,
  settings.company_longitude,
  settings.reminder_after_hours,
  settings.distance_green_max_miles,
  settings.distance_yellow_max_miles
from valtrim.service_scheduling_settings settings
where settings.id = 1;
