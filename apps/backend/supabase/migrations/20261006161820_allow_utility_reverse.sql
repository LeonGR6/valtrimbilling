-- Utility Building rows use the same orientation control as ordinary Lots.
-- Keep Options and Hardware excluded, while preserving Reverse in both the
-- Sequence Sheet row and the immutable Draw Package snapshot.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $migration$
declare
  v_definition text;
  v_updated text;
  v_expected_validation text := $source$
  if exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
    where coalesce(
      (requested.value ->> 'is_utility_building')::boolean,
      v_legacy_all_utility
    )
    and (
      coalesce((requested.value ->> 'is_reverse')::boolean, false)
      or jsonb_array_length(
        coalesce(requested.value -> 'option_ids', '[]'::jsonb)
      ) > 0
    )
  ) then
    raise exception 'Utility Building rows cannot include Reverse or Options'
      using errcode = '23514';
  end if;
$source$;
  v_replacement_validation text := $source$
  if exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
    where coalesce(
      (requested.value ->> 'is_utility_building')::boolean,
      v_legacy_all_utility
    )
    and jsonb_array_length(
      coalesce(requested.value -> 'option_ids', '[]'::jsonb)
    ) > 0
  ) then
    raise exception 'Utility Building rows cannot include Options'
      using errcode = '23514';
  end if;
$source$;
  v_expected_orientation text := $source$case when requested.is_utility_building then false
        else coalesce((requested.value ->> 'is_reverse')::boolean, false)
      end as is_reverse,$source$;
  v_replacement_orientation text := $source$coalesce(
        (requested.value ->> 'is_reverse')::boolean,
        false
      ) as is_reverse,$source$;
begin
  select pg_get_functiondef(
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure
  ) into v_definition;

  if position(v_expected_validation in v_definition) = 0 then
    raise exception 'save_sequence_sheet_phase does not match the expected Utility validation definition';
  end if;

  v_updated := replace(
    v_definition,
    v_expected_validation,
    v_replacement_validation
  );

  if position(v_expected_orientation in v_updated) = 0 then
    raise exception 'save_sequence_sheet_phase does not match the expected Utility orientation definition';
  end if;

  execute replace(
    v_updated,
    v_expected_orientation,
    v_replacement_orientation
  );
end;
$migration$;

do $migration$
declare
  v_definition text;
  v_expected text := $source$new.is_reverse := case when v_record.is_utility_building
    then false else v_record.is_reverse end;$source$;
  v_replacement text := $source$new.is_reverse := v_record.is_reverse;$source$;
begin
  select pg_get_functiondef('valtrim.prepare_package_draw()'::regprocedure)
  into v_definition;

  if position(v_expected in v_definition) = 0 then
    raise exception 'prepare_package_draw does not match the expected Utility orientation definition';
  end if;

  execute replace(v_definition, v_expected, v_replacement);
end;
$migration$;

comment on function valtrim.save_sequence_sheet_phase(
  bigint, bigint, text, text, jsonb, boolean
) is
  'Atomically saves mixed ordinary Lots and named Utility Building rows in one Phase. Both row types preserve Reverse; Utility rows cannot include Options.';

comment on function valtrim.prepare_package_draw() is
  'Builds immutable Lot / Draw snapshots, including Reverse orientation. Utility rows charge once in FULL mode or once per configured EXT, DM and HW event portion in BY_EVENT mode.';

notify pgrst, 'reload schema';

commit;
