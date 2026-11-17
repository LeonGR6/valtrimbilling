-- Deleting a Phase whose Lots an Extra / Change Order points at.
--
-- Deleting a Phase deletes its Lots, unless Production history keeps them. The lines of an Extra / CO and
-- the charges of a "Specific plan types" one point at Lots too, so deleting such a Phase failed with a bare
-- foreign key error ("A selected Job, Phase, Plan or Option is no longer available" on the screen), even
-- when the Extra / CO was cancelled and only kept its lines as history.
--
-- From now on:
--   * an Extra / CO that stands (Draft, Pending or Approved) with Lots in the Phase stops the delete, and
--     says which: cancel it, or take those Lots off it, first;
--   * when only cancelled Extras / COs (or released charges) point at its Lots, the Phase is deleted and
--     its Lots are kept, like the Lots of a Phase with cancelled Production history, so the history of
--     those Extras / COs still shows them.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function pg_temp.patch_function(
  p_signature regprocedure,
  p_old text,
  p_new text,
  p_expected_count integer default 1
)
returns void
language plpgsql
as $$
declare
  v_definition text := pg_catalog.pg_get_functiondef(p_signature);
  v_count integer;
begin
  v_count := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, p_old, '')))
    / pg_catalog.length(p_old);
  if v_count <> p_expected_count then
    raise exception 'Cannot patch %: expected % occurrence(s) of "%", found %',
      p_signature, p_expected_count, left(p_old, 60), v_count;
  end if;
  execute pg_catalog.replace(v_definition, p_old, p_new);
end;
$$;

select pg_temp.patch_function(
  'valtrim.deactivate_sequence_sheet_phase(bigint)'::regprocedure,
  $old$  v_has_cancelled_production_history boolean;
begin$old$,
  $new$  v_has_cancelled_production_history boolean;
  v_change_orders text;
begin$new$
);

select pg_temp.patch_function(
  'valtrim.deactivate_sequence_sheet_phase(bigint)'::regprocedure,
  $old$  if not v_has_cancelled_production_history then
    delete from valtrim.lots lot
    where lot.phase_id = p_phase_id;
  end if;$old$,
  $new$  -- An Extra / CO that stands and charges Lots of this Phase stops the delete.
  select string_agg(distinct change_order.change_order_number, ', ' order by change_order.change_order_number)
  into v_change_orders
  from valtrim.change_order_lines line
  join valtrim.change_orders change_order on change_order.id = line.change_order_id
  where line.phase_id = p_phase_id
    and change_order.status <> 'CANCELLED';
  if v_change_orders is not null then
    raise exception 'This Phase cannot be deleted because Extra / CO % charges its Lots. Cancel it, or take those Lots off it, first', v_change_orders
      using errcode = '23514';
  end if;

  -- Lots that a cancelled Extra / CO or a charge still points at are kept, like the ones of cancelled
  -- Production history: the Phase goes, their history stays.
  if not v_has_cancelled_production_history
     and not exists (
       select 1 from valtrim.change_order_lines line where line.phase_id = p_phase_id
     )
     and not exists (
       select 1
       from valtrim.change_order_plan_charges charge
       join valtrim.lots lot on lot.id = charge.lot_id
       where lot.phase_id = p_phase_id
     ) then
    delete from valtrim.lots lot
    where lot.phase_id = p_phase_id;
  end if;$new$
);

notify pgrst, 'reload schema';

commit;
