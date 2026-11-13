-- Give every Utility Building row a user-defined display name while retaining
-- its generated lot_number as a stable internal identity. Package snapshots
-- persist the name so historical Draw Packages never change after a rename.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table valtrim.lots
  add column utility_name varchar(80);

update valtrim.lots
set utility_name = case
  when lot_number ~* '^UTILITY-[0-9]+$'
    then 'Utility ' || substring(lot_number from '([0-9]+)$')
  else 'Utility Building'
end
where is_utility_building;

alter table valtrim.lots
  add constraint lots_utility_name_check
  check (
    (
      is_utility_building
      and utility_name is not null
      and btrim(utility_name) <> ''
      and char_length(btrim(utility_name)) <= 80
    )
    or (
      not is_utility_building
      and utility_name is null
    )
  );

comment on column valtrim.lots.utility_name is
  'User-defined display name for a Utility Building row. Ordinary Lots keep this column null.';

grant select (utility_name) on valtrim.lots to authenticated;

alter table valtrim.package_draws
  add column utility_name varchar(80);

update valtrim.package_draws
set utility_name = case
  when lot_number ~* '^UTILITY-[0-9]+$'
    then 'Utility ' || substring(lot_number from '([0-9]+)$')
  else 'Utility Building'
end
where is_utility_building;

alter table valtrim.package_draws
  add constraint package_draws_utility_name_snapshot_check
  check (
    (
      is_utility_building
      and utility_name is not null
      and btrim(utility_name) <> ''
      and char_length(btrim(utility_name)) <= 80
    )
    or (
      not is_utility_building
      and utility_name is null
    )
  );

comment on column valtrim.package_draws.utility_name is
  'Immutable user-defined Utility Building name captured when the Draw Package is created.';

grant select (utility_name) on valtrim.package_draws to authenticated;

-- Extend the already-deployed atomic Phase save function without duplicating
-- its authorization, validation and concurrency behavior.
do $migration$
declare
  v_definition text;
  v_original text;
begin
  select pg_get_functiondef(
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure
  ) into v_definition;
  v_original := v_definition;

  if position(
    'or jsonb_typeof(coalesce(requested.value -> ''option_ids'', ''[]''::jsonb)) <> ''array''' in v_definition
  ) = 0 then
    raise exception 'save_sequence_sheet_phase does not match the expected row validation definition';
  end if;

  v_definition := replace(
    v_definition,
    'or jsonb_typeof(coalesce(requested.value -> ''option_ids'', ''[]''::jsonb)) <> ''array''',
    'or jsonb_typeof(coalesce(requested.value -> ''option_ids'', ''[]''::jsonb)) <> ''array''
       or (
         coalesce(
           (requested.value ->> ''is_utility_building'')::boolean,
           v_legacy_all_utility
         )
         and (
           nullif(btrim(requested.value ->> ''utility_name''), '''') is null
           or char_length(btrim(requested.value ->> ''utility_name'')) > 80
         )
       )'
  );

  if position(
    'requested.is_utility_building,
      (requested.position - 1)::integer as display_order' in v_definition
  ) = 0 then
    raise exception 'save_sequence_sheet_phase does not match the expected normalized row definition';
  end if;

  v_definition := replace(
    v_definition,
    'requested.is_utility_building,
      (requested.position - 1)::integer as display_order',
    'requested.is_utility_building,
      case when requested.is_utility_building
        then btrim(requested.value ->> ''utility_name'')
        else null
      end as utility_name,
      (requested.position - 1)::integer as display_order'
  );

  if position(
    'is_utility_building, display_order
      ) values (' in v_definition
  ) = 0 or position(
    'v_lot.is_reverse, v_lot.is_utility_building, v_lot.display_order' in v_definition
  ) = 0 then
    raise exception 'save_sequence_sheet_phase does not match the expected insert definition';
  end if;

  v_definition := replace(
    v_definition,
    'is_utility_building, display_order
      ) values (',
    'is_utility_building, utility_name, display_order
      ) values ('
  );
  v_definition := replace(
    v_definition,
    'v_lot.is_reverse, v_lot.is_utility_building, v_lot.display_order',
    'v_lot.is_reverse, v_lot.is_utility_building, v_lot.utility_name,
        v_lot.display_order'
  );

  if position(
    'is_utility_building = v_lot.is_utility_building,
          display_order = v_lot.display_order' in v_definition
  ) = 0 then
    raise exception 'save_sequence_sheet_phase does not match the expected update definition';
  end if;

  v_definition := replace(
    v_definition,
    'is_utility_building = v_lot.is_utility_building,
          display_order = v_lot.display_order',
    'is_utility_building = v_lot.is_utility_building,
          utility_name = v_lot.utility_name,
          display_order = v_lot.display_order'
  );

  if v_definition = v_original then
    raise exception 'save_sequence_sheet_phase was not updated';
  end if;

  execute v_definition;
end;
$migration$;

comment on function valtrim.save_sequence_sheet_phase(
  bigint, bigint, text, text, jsonb, boolean
) is
  'Atomically saves mixed ordinary Lots and named Plan-only Utility Building rows in one Phase. The boolean parameter remains only for compatibility with the short-lived Phase-level client.';

-- Copy the user-facing name into every immutable Draw Package row.
do $migration$
declare
  v_definition text;
  v_original text;
begin
  select pg_get_functiondef('valtrim.prepare_package_draw()'::regprocedure)
  into v_definition;
  v_original := v_definition;

  if position('lot.is_utility_building,' in v_definition) = 0 then
    raise exception 'prepare_package_draw does not match the expected Utility row select';
  end if;
  v_definition := replace(
    v_definition,
    'lot.is_utility_building,',
    'lot.is_utility_building,
    lot.utility_name,'
  );

  if position(
    'new.is_utility_building := v_record.is_utility_building;' in v_definition
  ) = 0 then
    raise exception 'prepare_package_draw does not match the expected snapshot assignment';
  end if;
  v_definition := replace(
    v_definition,
    'new.is_utility_building := v_record.is_utility_building;',
    'new.is_utility_building := v_record.is_utility_building;
  new.utility_name := case when v_record.is_utility_building
    then v_record.utility_name else null end;'
  );

  if v_definition = v_original then
    raise exception 'prepare_package_draw was not updated';
  end if;

  execute v_definition;
end;
$migration$;

comment on function valtrim.prepare_package_draw() is
  'Builds immutable mixed Phase snapshots, including the user-defined Utility Building name. Ordinary Lots allocate the complete Plan Price by Draw percentage; Utility rows charge it once and never include Options or Hardware.';

notify pgrst, 'reload schema';

commit;
