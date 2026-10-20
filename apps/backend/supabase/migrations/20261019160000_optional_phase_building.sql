-- A Phase does not need a Building. `phases.building` was already nullable and
-- the unique index already treats "no Building" as its own value, so what changes
-- is the function that saves a Phase (it rejected an empty Building), a rule that
-- keeps one Phase code from existing with and without a Building in the same Job,
-- and a label that went blank for a Phase without a Building.
--
-- BUILDING scopes (retention release, Final Release) are decided per Phase row,
-- so a Phase without a Building is simply its own unit there.

begin;

-- One Phase code is either used with Buildings or without them within a Job, never
-- both: "Phase 1" next to "Phase 1 / Building A" would be ambiguous in every list.
create or replace function private.enforce_phase_building_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_active and exists (
    select 1
    from valtrim.phases other
    where other.job_id = new.job_id
      and other.code = new.code
      and other.is_active
      and other.id is distinct from new.id
      and (other.building is null) <> (new.building is null)
  ) then
    raise exception 'Phase % is already used % a Building in this Job. Use a Building for every row of this Phase, or for none',
      new.code,
      case when new.building is null then 'with' else 'without' end
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger phases_building_consistency
before insert or update of code, building, is_active on valtrim.phases
for each row execute function private.enforce_phase_building_consistency();

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  -- The Building may be left empty: it is stored as NULL.
  select pg_get_functiondef(
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    'if v_building = '''' or char_length(v_building) > 50 then',
    'if char_length(v_building) > 50 then'
  );
  if v_updated = v_definition then
    raise exception 'save_sequence_sheet_phase building check did not match the expected definition';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    'and coalesce(phase.building, '''') = v_building',
    'and coalesce(phase.building, '''') = v_building'
  );
  -- The comparison already treats NULL as '' and v_building is '' when empty.
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    'values (p_job_id, v_code, v_building, false)',
    'values (p_job_id, v_code, nullif(v_building, ''''), false)'
  );
  if v_updated = v_definition then
    raise exception 'save_sequence_sheet_phase insert did not match the expected definition';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    'building = v_building,',
    'building = nullif(v_building, ''''),'
  );
  if v_updated = v_definition then
    raise exception 'save_sequence_sheet_phase update did not match the expected definition';
  end if;

  execute v_updated;

  -- "Phase 1 - Building " || NULL was NULL: a Phase without a Building lost its label.
  select pg_get_functiondef(
    'private.get_final_release_status(bigint)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    '''Phase '' || phase.code || '' - Building '' || phase.building',
    '''Phase '' || phase.code || coalesce('' - Building '' || phase.building, '''')'
  );
  if v_updated = v_definition then
    raise exception 'get_final_release_status label did not match the expected definition';
  end if;

  execute v_updated;
end;
$migration$;

notify pgrst, 'reload schema';

commit;
