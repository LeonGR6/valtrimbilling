-- TEMPORARY: the Retention Release no longer waits for its date.
--
-- create_retention_release_package refuses to create the Package before the available date
-- ("Retention becomes available on ..."). Migration 20261107120000 made that date the cutoff of the
-- last qualifying Hardware Package instead of one month after it, but a cutoff can still be ahead
-- (a Package dated Oct 26 with a monthly cutoff on the 25th has its cutoff on Nov 25), so the release
-- kept waiting. The date check is switched off here; the release keeps the cutoff as its available
-- date, which the table requires to be on or after the source cutoff. Everything else the release
-- checks stays: the Hardware gate, the configured cutoff and the qualifying Package statuses.
--
-- The screen lifts the same hold (HOLD_RETENTION_ONE_MONTH in retentionSuggestions.js); all go back
-- together. To put the date check back, run this and restore the one-month helper of 20261107120000:
--
--   do $restore$
--   declare
--     v_definition text;
--     v_updated text;
--   begin
--     select pg_get_functiondef(
--       'private.create_retention_release_package(bigint,bigint,text)'::regprocedure
--     ) into v_definition;
--     v_updated := replace(
--       v_definition,
--       'if false and current_date < v_available_date then',
--       'if current_date < v_available_date then'
--     );
--     if v_updated = v_definition then
--       raise exception 'The Retention Release date check is not switched off';
--     end if;
--     execute v_updated;
--   end;
--   $restore$;

begin;

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
    'if current_date < v_available_date then',
    'if false and current_date < v_available_date then'
  );

  if v_updated = v_definition then
    raise exception 'The Retention Release date check did not match the expected definition';
  end if;

  execute v_updated;
end;
$migration$;

commit;
