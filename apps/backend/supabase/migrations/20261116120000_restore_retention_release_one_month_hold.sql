-- Puts the one-month hold of the Retention Release back.
--
-- A Retention Release is available one month after the cutoff of the last qualifying Hardware
-- Package, and create_retention_release_package refuses to create it before that date
-- ("Retention becomes available on ..."). Migrations 20261107120000 and 20261108120000 lifted both
-- parts for review: the helper returned the cutoff itself, and the date check was switched off with
-- `if false and ...`. The screen can review a release while it waits for its date, but creating it
-- has to wait, so both go back as they were in 20261005201944.
--
-- Releases created while the hold was lifted keep the available date they were saved with (the
-- cutoff); the table only requires available_date >= source_cutoff_date, so they stay valid.

begin;

create or replace function private.add_one_month_clamped(p_date date)
returns date
language sql
immutable
set search_path = ''
as $$
  with target as (
    select (date_trunc('month', p_date)::date + interval '1 month')::date
      as month_start
  )
  select make_date(
    extract(year from month_start)::integer,
    extract(month from month_start)::integer,
    least(
      extract(day from p_date)::integer,
      extract(day from (month_start + interval '1 month - 1 day'))::integer
    )
  )
  from target;
$$;

comment on function private.add_one_month_clamped(date) is null;

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'private.create_retention_release_package(bigint,bigint,text)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    'if false and current_date < v_available_date then',
    'if current_date < v_available_date then'
  );

  if v_updated = v_definition then
    raise exception 'The Retention Release date check is not switched off';
  end if;

  execute v_updated;
end;
$migration$;

commit;
