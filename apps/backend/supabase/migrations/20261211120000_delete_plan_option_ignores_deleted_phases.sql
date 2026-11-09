-- A Plan or an Option can be deleted when only the Lots of deleted Phases still use it.
--
-- A Phase that is deleted after its Production events were cancelled keeps its Lots (the cancelled history points
-- at them), and those Lots keep pointing at their Plan and their Options. valtrim.deactivate_job_plan and
-- valtrim.deactivate_plan_option counted those kept Lots too, so a Job whose Sequence Sheet was empty still refused
-- ("Reassign or remove the Lots that use this Plan first") while the screen, which only reads the Lots of active
-- Phases, showed nothing that used the Plan.
--
-- From now on only the Lots of active Phases block the deletion, the same Lots the screen shows. The kept Lots stay
-- as they are: the Plan and the Option are deactivated, not removed, so the cancelled history keeps pointing at them.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

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
  'valtrim.deactivate_job_plan(bigint)'::regprocedure,
  E'    from valtrim.lots lot\n    where lot.plan_id = p_plan_id\n',
  E'    from valtrim.lots lot\n    join valtrim.phases phase on phase.id = lot.phase_id\n    where lot.plan_id = p_plan_id\n      and phase.is_active\n'
);

select pg_temp.patch_function(
  'valtrim.deactivate_plan_option(bigint)'::regprocedure,
  E'    from valtrim.lot_options selected\n    where selected.option_id = p_option_id\n',
  E'    from valtrim.lot_options selected\n    join valtrim.lots lot on lot.id = selected.lot_id\n    join valtrim.phases phase on phase.id = lot.phase_id\n    where selected.option_id = p_option_id\n      and phase.is_active\n'
);

notify pgrst, 'reload schema';

commit;
