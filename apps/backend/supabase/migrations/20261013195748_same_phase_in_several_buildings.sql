-- A Phase code can now be used by several Buildings of the same Job: "Phase 1
-- Building 2", "Phase 1 Building 3" and "Phase 1 Building 4" are three Phases.
-- What cannot repeat is the Phase and Building together.
--
-- Everything else already points at a Phase by its id (Lots, Production,
-- Draw Packages, follow-ups) and keeps the Phase code and the Building as
-- separate snapshots, so only the uniqueness rule and the create check change.

begin;

drop index valtrim.phases_job_active_code_uq;

create unique index phases_job_active_code_building_uq
  on valtrim.phases (job_id, code, coalesce(building, ''))
  where is_active;

comment on index valtrim.phases_job_active_code_building_uq is
  'Keeps an active Phase code and Building unique per Job: the same Phase code can exist in several Buildings.';

-- Creating a Phase refused any active Phase with the same code. It now refuses
-- only the same code in the same Building.
do $migration$
declare
  v_definition text;
  v_updated text;
begin
  v_definition := pg_get_functiondef(
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure
  );

  v_updated := replace(
    v_definition,
    E'      and phase.code = v_code\n      and phase.is_active\n    for update;',
    E'      and phase.code = v_code\n      and coalesce(phase.building, '''') = v_building\n      and phase.is_active\n    for update;'
  );

  if v_updated = v_definition then
    raise exception 'save_sequence_sheet_phase does not have the expected Phase lookup';
  end if;

  v_updated := replace(
    v_updated,
    'This Phase already exists for the selected Job',
    'This Phase and Building already exist for the selected Job'
  );

  execute v_updated;
end;
$migration$;

notify pgrst, 'reload schema';

commit;
