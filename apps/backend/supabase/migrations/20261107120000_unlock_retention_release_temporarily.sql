-- TEMPORARY: lifts the one-month hold of the Retention Release.
--
-- A Retention Release becomes available one month after the cutoff of the last qualifying Hardware
-- Package: create_retention_release_package computes that date with private.add_one_month_clamped
-- and refuses to create the Package before it ("Retention becomes available on ..."). That helper is
-- used only there.
--
-- While the screens are being reviewed, the helper returns the cutoff date itself, so the release can
-- be created as soon as the Hardware is billed, its Packages qualify and that cutoff has arrived.
-- Everything else the release checks stays: the Hardware gate, the configured cutoff and the
-- qualifying Package statuses. The date cannot be earlier than the cutoff: the release row checks
-- available_date >= source_cutoff_date.
--
-- The screen lifts the same hold (HOLD_RETENTION_ONE_MONTH in retentionSuggestions.js); both go back
-- together. To put the one-month hold back, run this and set that constant to true:
--
--   create or replace function private.add_one_month_clamped(p_date date)
--   returns date
--   language sql
--   immutable
--   set search_path = ''
--   as $$
--     with target as (
--       select (date_trunc('month', p_date)::date + interval '1 month')::date
--         as month_start
--     )
--     select make_date(
--       extract(year from month_start)::integer,
--       extract(month from month_start)::integer,
--       least(
--         extract(day from p_date)::integer,
--         extract(day from (month_start + interval '1 month - 1 day'))::integer
--       )
--     )
--     from target;
--   $$;

begin;

create or replace function private.add_one_month_clamped(p_date date)
returns date
language sql
immutable
set search_path = ''
as $$
  select p_date;
$$;

comment on function private.add_one_month_clamped(date) is
  'TEMPORARY: returns the date itself, so the Retention Release is not held one month after the last cutoff. The original one-month rule is in migration 20261005201944.';

commit;
