-- The first and last Lot of a Production schedule, in the order a person reads Lots.
--
-- A Production schedule keeps the first and last Lot it covers (lot_start_label and
-- lot_end_label), and the builder follow-up emails print them as "Lots 6–11". They were the
-- smallest and the largest Lot as TEXT, so "10" came before "9": 24 schedules already read
-- from "10" to "9". Lots with a decimal (12 and 12.1 are different, related Lots) would make
-- it worse, so the order is now the number a Lot starts with, then its text:
-- 2, 9, 10, 12, 12A, 12.1, 13 ... and a Lot with no number in front ("UTILITY-1") goes last.
--
-- save_production_activity is patched in place, like the Baseboard install migration did,
-- so nothing else in it can drift; the patch stops if the definition is not the expected one.
-- The 27 schedules whose labels differ from that order are corrected. Only the two labels
-- change: no date, owner or Lot moves, so no date history is written, no follow-up is
-- invalidated, and updated_at is left as it was.

begin;

create function private.lot_number_order(p_lot_number text)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select substring(p_lot_number from '^[0-9]+(?:\.[0-9]+)?')::numeric
$$;

revoke all on function private.lot_number_order(text) from public, anon, authenticated;

comment on function private.lot_number_order(text) is
  'The number a Lot starts with, to sort Lots as a person reads them: 9 before 10, 12 before 12.1 before 13. Null when the Lot starts with a letter.';

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'private.save_production_activity(bigint,bigint,bigint[],jsonb,text)'::regprocedure
  ) into v_definition;

  -- Each of the two labels is written twice: when a schedule is created and when it is updated.
  if length(v_definition) - length(replace(v_definition, 'min(lot.lot_number)', ''))
       <> 2 * length('min(lot.lot_number)')
     or length(v_definition) - length(replace(v_definition, 'max(lot.lot_number)', ''))
       <> 2 * length('max(lot.lot_number)') then
    raise exception 'save_production_activity lot labels did not match the expected definition';
  end if;

  v_updated := replace(
    v_definition,
    'min(lot.lot_number)',
    '(array_agg(lot.lot_number order by private.lot_number_order(lot.lot_number) nulls last, lot.lot_number))[1]'
  );
  v_updated := replace(
    v_updated,
    'max(lot.lot_number)',
    '(array_agg(lot.lot_number order by private.lot_number_order(lot.lot_number) desc nulls first, lot.lot_number desc))[1]'
  );

  execute v_updated;
end;
$migration$;

-- Schedules that already hold the wrong first or last Lot.
alter table valtrim.production_schedules disable trigger production_schedules_set_updated_at;

with ordered as (
  select
    schedule_lot.schedule_id,
    (array_agg(
      lot.lot_number
      order by private.lot_number_order(lot.lot_number) nulls last, lot.lot_number
    ))[1] as first_lot,
    (array_agg(
      lot.lot_number
      order by private.lot_number_order(lot.lot_number) desc nulls first, lot.lot_number desc
    ))[1] as last_lot
  from valtrim.production_schedule_lots schedule_lot
  join valtrim.lots lot on lot.id = schedule_lot.lot_id
  group by schedule_lot.schedule_id
)
update valtrim.production_schedules schedule
set lot_start_label = ordered.first_lot,
    lot_end_label = ordered.last_lot
from ordered
where ordered.schedule_id = schedule.id
  and (
    schedule.lot_start_label is distinct from ordered.first_lot
    or schedule.lot_end_label is distinct from ordered.last_lot
  );

alter table valtrim.production_schedules enable trigger production_schedules_set_updated_at;

notify pgrst, 'reload schema';

commit;
