begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

select has_column(
  'valtrim',
  'service_requests',
  'customer_unavailable_dates',
  'Customer Service stores unavailable business days'
);

select has_column(
  'valtrim',
  'service_requests',
  'customer_needs_contact',
  'Customer Service stores the contact request flag'
);

select col_type_is(
  'valtrim',
  'service_requests',
  'customer_unavailable_dates',
  'date[]',
  'Unavailable days use a structured date array'
);

select has_column(
  'valtrim',
  'service_requests',
  'customer_unavailable_dates',
  'The request retains unavailable days after retiring the old view'
);

select has_column(
  'valtrim',
  'service_requests',
  'customer_needs_contact',
  'The request retains the contact request flag after retiring the old view'
);

select is(
  (
    select settings.workday_starts_at
    from valtrim.service_scheduling_settings settings
    where settings.id = 1
  ),
  time '07:00',
  'The Valtrim workday starts at 7:00 AM'
);

select is(
  (
    select settings.workday_ends_at
    from valtrim.service_scheduling_settings settings
    where settings.id = 1
  ),
  time '15:30',
  'The Valtrim workday ends at 3:30 PM (confirmed 5 Nov 2026)'
);

select hasnt_column(
  'valtrim',
  'service_scheduling_settings',
  'travel_buffer_minutes',
  'The fixed travel buffer was retired in 20261105120000'
);

select ok(
  not exists (
    select 1
    from valtrim.service_technician_profiles profile
    where profile.workday_starts_at <> time '07:00'
      or profile.workday_ends_at <> time '15:30'
  ),
  'Existing technician profiles use the 7:00 AM to 3:30 PM workday'
);

select is(
  private.parse_customer_unavailable_dates(
    '["2026-09-23", "2026-09-24"]'::jsonb,
    date '2026-09-21',
    date '2026-09-25'
  ),
  array[date '2026-09-23', date '2026-09-24'],
  'Unavailable days are parsed and sorted'
);

select is(
  jsonb_array_length(
    private.build_customer_service_availability(
      date '2026-09-21',
      date '2026-09-25',
      array[date '2026-09-23']
    )
  ),
  4,
  'One unavailable day leaves four schedulable business days'
);

select is(
  (
    (
      private.build_customer_service_availability(
        date '2026-09-21',
        date '2026-09-25',
        '{}'::date[]
      ) -> 0 ->> 'availableFrom'
    )::timestamptz at time zone 'America/Los_Angeles'
  ),
  timestamp '2026-09-21 07:00:00',
  'Generated scheduling windows begin at 7:00 AM local time'
);

select throws_ok(
  $$
    select private.parse_customer_unavailable_dates(
      '["2026-09-23", "2026-09-23"]'::jsonb,
      date '2026-09-21',
      date '2026-09-25'
    )
  $$,
  '22023',
  'Customer unavailable dates cannot repeat',
  'Duplicate unavailable days are rejected'
);

select throws_ok(
  $$
    select private.parse_customer_unavailable_dates(
      '["2026-09-26"]'::jsonb,
      date '2026-09-21',
      date '2026-09-27'
    )
  $$,
  '22023',
  'Customer unavailable dates must be business days inside the request deadline',
  'Weekend restrictions are rejected'
);

select * from finish();

rollback;
