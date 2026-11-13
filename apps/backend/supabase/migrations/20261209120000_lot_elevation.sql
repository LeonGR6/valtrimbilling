-- The elevation of a Lot (A, B, C, D, ...) is its own attribute, apart from the Plan: "Lot 1, Plan 1, elevation A"
-- and "Lot 2, Plan 1, elevation B". It only tells Lots apart; no price, Option or amount reads it.
--
-- What changes:
--   lots.elevation                                   optional, upper case, up to 20 characters
--   package_draws / package_hardware_lines /
--     package_options .lot_elevation                 the elevation the Lot had when the Package took the line,
--                                                    like plan_code. Lines made before this stay without one.
--   valtrim.save_sequence_sheet_phase                saves it; a client that does not send it keeps the one saved
--   valtrim.prepare_package_draw /
--     valtrim.prepare_package_hardware_line          copy it to the Draw and Hardware lines
--   valtrim.populate_package_options /
--     private.create_options_package                 copy it to the Option lines

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- --- Columns ---------------------------------------------------------------------------------------

alter table valtrim.lots
  add column elevation text,
  add constraint lots_elevation_check
    check (elevation is null or (elevation = upper(btrim(elevation)) and elevation <> '' and char_length(elevation) <= 20));

alter table valtrim.package_draws
  add column lot_elevation text,
  add constraint package_draws_lot_elevation_check
    check (lot_elevation is null or (btrim(lot_elevation) <> '' and char_length(lot_elevation) <= 20));
alter table valtrim.package_hardware_lines
  add column lot_elevation text,
  add constraint package_hardware_lines_lot_elevation_check
    check (lot_elevation is null or (btrim(lot_elevation) <> '' and char_length(lot_elevation) <= 20));
alter table valtrim.package_options
  add column lot_elevation text,
  add constraint package_options_lot_elevation_check
    check (lot_elevation is null or (btrim(lot_elevation) <> '' and char_length(lot_elevation) <= 20));

grant select (elevation) on valtrim.lots to authenticated;
grant select, insert, update, references (elevation) on valtrim.lots to service_role;
grant select (lot_elevation) on valtrim.package_draws to authenticated;
grant select, insert, update, references (lot_elevation) on valtrim.package_draws to service_role;
grant select (lot_elevation) on valtrim.package_hardware_lines to authenticated;
grant select, insert, update, references (lot_elevation) on valtrim.package_hardware_lines to service_role;
grant select (lot_elevation) on valtrim.package_options to authenticated;
grant select, insert, update, references (lot_elevation) on valtrim.package_options to service_role;

-- --- Functions ---------------------------------------------------------------------------------------

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

-- A Draw line and a Hardware line take the elevation of the Lot, as they take its Plan code.
select pg_temp.patch_function(
  'valtrim.prepare_package_draw()'::regprocedure,
  E'    lot.is_reverse,\n',
  E'    lot.is_reverse,\n    nullif(btrim(lot.elevation), '''') as lot_elevation,\n'
);
select pg_temp.patch_function(
  'valtrim.prepare_package_draw()'::regprocedure,
  E'  new.is_reverse := v_record.is_reverse;\n',
  E'  new.is_reverse := v_record.is_reverse;\n  new.lot_elevation := v_record.lot_elevation;\n'
);
select pg_temp.patch_function(
  'valtrim.prepare_package_hardware_line()'::regprocedure,
  E'    lot.is_reverse,\n',
  E'    lot.is_reverse,\n    nullif(btrim(lot.elevation), '''') as lot_elevation,\n'
);
select pg_temp.patch_function(
  'valtrim.prepare_package_hardware_line()'::regprocedure,
  E'  new.is_reverse := v_record.is_reverse;\n',
  E'  new.is_reverse := v_record.is_reverse;\n  new.lot_elevation := v_record.lot_elevation;\n'
);

-- An Option line, whether it rides on a Draw line or on an Options Package.
select pg_temp.patch_function(
  'valtrim.populate_package_options()'::regprocedure,
  E'      lot_number,\n      plan_code\n    )',
  E'      lot_number,\n      plan_code,\n      lot_elevation\n    )'
);
select pg_temp.patch_function(
  'valtrim.populate_package_options()'::regprocedure,
  E'      lot.lot_number,\n      plan.code\n    from valtrim.lot_options selected',
  E'      lot.lot_number,\n      plan.code,\n      nullif(btrim(lot.elevation), '''')\n    from valtrim.lot_options selected'
);
select pg_temp.patch_function(
  'private.create_options_package(bigint,jsonb,date,text)'::regprocedure,
  E'    lot_number,\n    plan_code,\n    retention_amount,',
  E'    lot_number,\n    plan_code,\n    lot_elevation,\n    retention_amount,'
);
select pg_temp.patch_function(
  'private.create_options_package(bigint,jsonb,date,text)'::regprocedure,
  E'    lot.lot_number,\n    plan.code,\n    round(price.price * v_retention_percentage / 100, 2),',
  E'    lot.lot_number,\n    plan.code,\n    nullif(btrim(lot.elevation), ''''),\n    round(price.price * v_retention_percentage / 100, 2),'
);

-- The Sequence Sheet saves it. A save that does not name an elevation leaves the one the Lot has.
select pg_temp.patch_function(
  'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure,
  E'      ) as is_reverse,\n',
  E'      ) as is_reverse,\n      requested.value ? ''elevation'' as has_elevation,\n      nullif(upper(btrim(requested.value ->> ''elevation'')), '''') as elevation,\n'
);
select pg_temp.patch_function(
  'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure,
  E'        phase_id, job_id, plan_id, lot_number, is_reverse,\n        is_utility_building, utility_name, display_order\n      ) values (\n        v_phase_id, p_job_id, v_lot.plan_id, v_lot.lot_number,\n        v_lot.is_reverse, v_lot.is_utility_building, v_lot.utility_name,\n        v_lot.display_order\n',
  E'        phase_id, job_id, plan_id, lot_number, is_reverse, elevation,\n        is_utility_building, utility_name, display_order\n      ) values (\n        v_phase_id, p_job_id, v_lot.plan_id, v_lot.lot_number,\n        v_lot.is_reverse, case when v_lot.is_utility_building then null else v_lot.elevation end,\n        v_lot.is_utility_building, v_lot.utility_name,\n        v_lot.display_order\n'
);
select pg_temp.patch_function(
  'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure,
  E'          is_reverse = v_lot.is_reverse,\n',
  E'          is_reverse = v_lot.is_reverse,\n          elevation = case\n            when v_lot.is_utility_building then null\n            when v_lot.has_elevation then v_lot.elevation\n            else valtrim.lots.elevation\n          end,\n'
);
notify pgrst, 'reload schema';

commit;
