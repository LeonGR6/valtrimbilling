begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

select col_is_null('valtrim', 'phases', 'building', 'A Phase can be saved without a Building');

select has_trigger('valtrim', 'phases', 'phases_building_consistency',
  'One Phase code cannot be used with and without a Building in the same Job');

select ok(
  pg_get_functiondef('valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure)
    not like '%v_building = ''''%',
  'Saving a Phase no longer rejects an empty Building'
);

select ok(
  pg_get_functiondef('valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure)
    like '%nullif(v_building, %',
  'An empty Building is stored as NULL'
);

select ok(
  pg_get_functiondef('private.get_final_release_status(bigint)'::regprocedure)
    like '%coalesce('' - Building ''%',
  'The Final Release label keeps the Phase when there is no Building'
);

select * from finish();

rollback;
