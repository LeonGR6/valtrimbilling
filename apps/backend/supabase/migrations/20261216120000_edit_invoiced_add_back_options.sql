-- Putting free Options back on an invoiced Package (the edit of a Package in Awaiting payment).
--
-- edit_invoiced_draw_package could take Options off a Package but never put one on: an Option unit rides on a
-- Lot / Draw cell that is already in the Package, so a unit released by an earlier edit stayed free (on no
-- Package) with nowhere to go but an Options Package, which is only offered once every cell of its Phase is
-- billed. This migration adds a last argument, p_added_options, to put free units back:
--
--   p_added_options   single Options to bill on the Package, as [{lot_id, option_id, unit_no}]
--
-- The rules are the ones of the creation of a Package (create_draw_invoice_package):
--   * the unit exists on an active Lot of the Job (lot_options.quantity >= unit_no) and no Package bills it,
--   * its Lot reached the Options billing Draw: the Package keeps a cell of the Lot at or after that Draw, or an
--     earlier Package of the Job billed one,
--   * the units ride on ONE cell of the Package at or after the Options billing Draw -- the cell that already
--     carries the Options of the Package when there is one, else the first cell by Draw and Lot -- which is
--     generated again with the units it had plus the new ones, so the price (Package date or the price pinned on
--     the Lot), retention and wrap are calculated by the same triggers as at creation.
-- A unit cannot be released and added in the same edit. The result and the correction history list what was added
-- ("added_options") next to what was released.
--
-- The function is rebuilt from its own definition (pg_get_functiondef) with each change checked to apply exactly
-- once, so nothing else about it is rewritten by hand.

begin;

-- 1. One cell generated again, with the Options it carries plus others -----------------------------------------
--
-- Same steps the edit uses when a cell loses an Option (its line is immutable): the Options and the line of the
-- cell go, and the line is inserted again with the GUC that tells populate_package_options and
-- prepare_package_draw which units this cell charges.

create function private.regenerate_package_option_cell(
  p_package_id bigint,
  p_lot_id bigint,
  p_draw_id bigint,
  p_draw_number smallint,
  p_extra_options jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_had_hardware boolean;
  v_kept jsonb;
begin
  select line.hardware_amount > 0
  into v_had_hardware
  from valtrim.package_draws line
  where line.package_id = p_package_id
    and line.lot_id = p_lot_id
    and line.draw_id = p_draw_id;

  if v_had_hardware is null then
    raise exception 'The cell that carries the Options is no longer in the Package'
      using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'lot_id', billed.lot_id,
    'option_id', billed.option_id,
    'unit_no', billed.unit_no
  ) order by billed.lot_id, billed.option_id, billed.unit_no), '[]'::jsonb)
  into v_kept
  from valtrim.package_options billed
  where billed.package_id = p_package_id
    and billed.billing_lot_id = p_lot_id
    and billed.draw_id = p_draw_id;

  delete from valtrim.package_options billed
  where billed.package_id = p_package_id
    and billed.billing_lot_id = p_lot_id
    and billed.draw_id = p_draw_id;

  delete from valtrim.package_draws line
  where line.package_id = p_package_id
    and line.lot_id = p_lot_id
    and line.draw_id = p_draw_id;

  perform set_config(
    'valtrim.draw_package_option_charge',
    jsonb_build_object(
      'anchor_lot_id', p_lot_id,
      'anchor_draw_number', p_draw_number,
      'package_options', v_kept || coalesce(p_extra_options, '[]'::jsonb)
    )::text,
    true
  );
  perform set_config(
    'valtrim.draw_package_hardware_charge',
    jsonb_build_array(jsonb_build_object(
      'lot_id', p_lot_id,
      'draw_number', p_draw_number,
      'charge_hardware', v_had_hardware
    ))::text,
    true
  );

  insert into valtrim.package_draws (package_id, lot_id, draw_id)
  values (p_package_id, p_lot_id, p_draw_id);

  perform set_config('valtrim.draw_package_option_charge', '', true);
  perform set_config('valtrim.draw_package_hardware_charge', '', true);

  if (
    select coalesce(sum(billed.option_price), 0)
    from valtrim.package_options billed
    where billed.package_id = p_package_id
      and billed.billing_lot_id = p_lot_id
      and billed.draw_id = p_draw_id
  ) <> (
    select coalesce(sum(line.options_amount), 0)
    from valtrim.package_draws line
    where line.package_id = p_package_id
      and line.lot_id = p_lot_id
      and line.draw_id = p_draw_id
  ) then
    raise exception 'The Options on a cell do not add up to what its line bills'
      using errcode = '23514';
  end if;
end;
$$;

revoke all on function private.regenerate_package_option_cell(bigint, bigint, bigint, smallint, jsonb)
  from public, anon, authenticated;

comment on function private.regenerate_package_option_cell(bigint, bigint, bigint, smallint, jsonb) is
  'Generates one Lot / Draw cell of an invoiced Package again with the Options it carries plus the extra units. Used by edit_invoiced_draw_package only.';

-- 2. The edit, with the new argument ---------------------------------------------------------------------------

create function pg_temp.replace_once(p_text text, p_old text, p_new text)
returns text
language plpgsql
as $$
declare
  v_count integer;
begin
  v_count := (pg_catalog.length(p_text) - pg_catalog.length(pg_catalog.replace(p_text, p_old, '')))
    / pg_catalog.length(p_old);
  if v_count <> 1 then
    raise exception 'Cannot patch edit_invoiced_draw_package: expected 1 occurrence of "%", found %',
      left(p_old, 70), v_count;
  end if;
  return pg_catalog.replace(p_text, p_old, p_new);
end;
$$;

do $migration$
declare
  v_old constant regprocedure :=
    'valtrim.edit_invoiced_draw_package(uuid,bigint,jsonb,jsonb,jsonb,text,text,boolean)'::regprocedure;
  v_definition text := pg_catalog.pg_get_functiondef(v_old);
begin
  -- The new argument, last so every call that does not name it keeps working.
  v_definition := pg_temp.replace_once(
    v_definition,
    'p_dry_run boolean DEFAULT false)',
    'p_dry_run boolean DEFAULT false, p_added_options jsonb DEFAULT ''[]''::jsonb)'
  );

  v_definition := pg_temp.replace_once(
    v_definition,
    E'  v_released_unique integer;\n',
    E'  v_released_unique integer;\n'
    || E'  v_added_requested integer;\n'
    || E'  v_added_unique integer;\n'
    || E'  v_added_options jsonb := ''[]''::jsonb;\n'
    || E'  v_target record;\n'
  );

  v_definition := pg_temp.replace_once(
    v_definition,
    E'     or jsonb_typeof(p_released_options) is distinct from ''array'' then\n'
    || E'    raise exception ''Cells, Hardware lines and released Options must be JSON arrays''\n',
    E'     or jsonb_typeof(p_released_options) is distinct from ''array''\n'
    || E'     or jsonb_typeof(p_added_options) is distinct from ''array'' then\n'
    || E'    raise exception ''Cells, Hardware lines, released Options and added Options must be JSON arrays''\n'
  );

  v_definition := pg_temp.replace_once(
    v_definition,
    E'     or jsonb_array_length(p_released_options) > 5000 then\n',
    E'     or jsonb_array_length(p_released_options) > 5000\n'
    || E'     or jsonb_array_length(p_added_options) > 5000 then\n'
  );

  -- Checks of the Options to add, with the other checks of the request.
  v_definition := pg_temp.replace_once(
    v_definition,
    E'  -- Before ------------------------------------------------------------------------------------\n',
    $check$  -- Free Options to put back ---------------------------------------------------------------------
  if exists (
    select 1 from jsonb_array_elements(p_added_options) item
    where jsonb_typeof(item) <> 'object'
       or jsonb_typeof(item -> 'lot_id') is distinct from 'number'
       or jsonb_typeof(item -> 'option_id') is distinct from 'number'
       or jsonb_typeof(item -> 'unit_no') is distinct from 'number'
       or item ->> 'lot_id' !~ '^[1-9][0-9]*$'
       or item ->> 'option_id' !~ '^[1-9][0-9]*$'
       or item ->> 'unit_no' !~ '^[1-9][0-9]?$'
  ) then
    raise exception 'Every added Option needs a valid Lot, Option and unit'
      using errcode = '23514';
  end if;

  select count(*), count(distinct row(added.lot_id, added.option_id, added.unit_no))
  into v_added_requested, v_added_unique
  from jsonb_to_recordset(p_added_options)
    as added(lot_id bigint, option_id bigint, unit_no integer);
  if v_added_unique <> v_added_requested then
    raise exception 'Every added Option must be unique' using errcode = '23514';
  end if;

  if v_added_requested > 0 then
    if v_version.options_billing_draw_number is null then
      raise exception 'This Job Billing Setup does not bill Options' using errcode = '23514';
    end if;

    if exists (
      select 1
      from jsonb_to_recordset(p_added_options) as added(lot_id bigint, option_id bigint, unit_no integer)
      join jsonb_to_recordset(p_released_options)
        as released(lot_id bigint, option_id bigint, unit_no integer)
        on released.lot_id = added.lot_id
       and released.option_id = added.option_id
       and released.unit_no = added.unit_no
    ) then
      raise exception 'An Option unit cannot be released and added in the same edit'
        using errcode = '23514';
    end if;

    select count(*) into v_found
    from jsonb_to_recordset(p_added_options) as added(lot_id bigint, option_id bigint, unit_no integer)
    join valtrim.lot_options selected
      on selected.lot_id = added.lot_id
     and selected.option_id = added.option_id
     and selected.quantity >= added.unit_no
    join valtrim.lots lot on lot.id = selected.lot_id
    join valtrim.phases phase
      on phase.id = lot.phase_id
     and phase.job_id = v_package.job_id
     and phase.is_active;
    if v_found <> v_added_requested then
      raise exception 'Every added Option must belong to an active Lot in this Job'
        using errcode = '23503';
    end if;

    if exists (
      select 1
      from jsonb_to_recordset(p_added_options) as added(lot_id bigint, option_id bigint, unit_no integer)
      join valtrim.package_options billed
        on billed.lot_id = added.lot_id
       and billed.option_id = added.option_id
       and billed.unit_no = added.unit_no
    ) then
      raise exception 'One or more added Options are already billed'
        using errcode = '23505';
    end if;

    -- The Lot reached the Options billing Draw: this Package keeps a cell of it at or after that Draw,
    -- or an earlier Package of the Job billed one.
    if exists (
      select 1
      from jsonb_to_recordset(p_added_options) as added(lot_id bigint, option_id bigint, unit_no integer)
      where not exists (
        select 1
        from jsonb_to_recordset(p_selections) as selection(lot_id bigint, draw_number smallint)
        where selection.lot_id = added.lot_id
          and selection.draw_number >= v_version.options_billing_draw_number
      )
      and not exists (
        select 1
        from valtrim.package_draws prior_line
        join valtrim.draw_packages prior_package
          on prior_package.id = prior_line.package_id
         and prior_package.job_id = v_package.job_id
         and prior_package.id <> p_package_id
        join valtrim.billing_setup_versions prior_version
          on prior_version.id = prior_line.setup_version_id
        where prior_line.lot_id = added.lot_id
          and prior_line.draw_number >= prior_version.options_billing_draw_number
      )
    ) then
      raise exception 'Every added Option Lot must have reached or passed the Options billing Draw'
        using errcode = '23514';
    end if;

    if not exists (
      select 1
      from jsonb_to_recordset(p_selections) as selection(lot_id bigint, draw_number smallint)
      where selection.draw_number >= v_version.options_billing_draw_number
    ) then
      raise exception 'The Package needs a cell at or after the Options billing Draw to carry the Options'
        using errcode = '23514';
    end if;
  end if;

  -- Before ------------------------------------------------------------------------------------
$check$
  );

  -- Adding Options is a change of its own.
  v_definition := pg_temp.replace_once(
    v_definition,
    E'       and v_released = ''[]''::jsonb\n'
    || E'       and v_removed_hardware = ''[]''::jsonb and v_added_hardware = ''[]''::jsonb\n',
    E'       and v_released = ''[]''::jsonb\n'
    || E'       and p_added_options = ''[]''::jsonb\n'
    || E'       and v_removed_hardware = ''[]''::jsonb and v_added_hardware = ''[]''::jsonb\n'
  );

  -- The units ride on one cell, generated again once the cells and Hardware of the edit are in place.
  v_definition := pg_temp.replace_once(
    v_definition,
    E'      raise exception ''Every Separate Hardware line needs a current Plan price''\n'
    || E'        using errcode = ''23503'';\n'
    || E'    end if;\n',
    E'      raise exception ''Every Separate Hardware line needs a current Plan price''\n'
    || E'        using errcode = ''23503'';\n'
    || E'    end if;\n'
    || $add$
    -- Free Options put back ride on one cell: the one that carries the Options already, else the first cell
    -- at or after the Options billing Draw (a Lot before a Utility building), as the creation of a Package does.
    if v_added_requested > 0 then
      select candidate.lot_id, candidate.draw_id, candidate.draw_number
      into v_target
      from (
        select line.lot_id, line.draw_id, line.draw_number, lot.is_utility_building,
          exists (
            select 1 from valtrim.package_options billed
            where billed.package_id = p_package_id
              and billed.billing_lot_id = line.lot_id
              and billed.draw_id = line.draw_id
          ) as carries_options
        from valtrim.package_draws line
        join valtrim.lots lot on lot.id = line.lot_id
        where line.package_id = p_package_id
          and line.draw_number >= v_version.options_billing_draw_number
      ) candidate
      order by candidate.carries_options desc, candidate.is_utility_building,
        candidate.draw_number, candidate.lot_id
      limit 1;

      if v_target.lot_id is null then
        raise exception 'The Package needs a cell at or after the Options billing Draw to carry the Options'
          using errcode = '23514';
      end if;

      perform private.regenerate_package_option_cell(
        p_package_id, v_target.lot_id, v_target.draw_id, v_target.draw_number, p_added_options
      );

      select coalesce(jsonb_agg(jsonb_build_object(
        'lot_id', billed.lot_id,
        'option_id', billed.option_id,
        'unit_no', billed.unit_no,
        'phase_code', billed.phase_code,
        'lot_number', billed.lot_number,
        'option_code', billed.option_code,
        'option_name', billed.option_name,
        'option_price', billed.option_price
      ) order by billed.phase_code, billed.lot_number, billed.option_id, billed.unit_no), '[]'::jsonb)
      into v_added_options
      from valtrim.package_options billed
      join jsonb_to_recordset(p_added_options)
        as added(lot_id bigint, option_id bigint, unit_no integer)
        on added.lot_id = billed.lot_id
       and added.option_id = billed.option_id
       and added.unit_no = billed.unit_no
      where billed.package_id = p_package_id;

      if jsonb_array_length(v_added_options) <> v_added_requested then
        raise exception 'Every added Option needs a current price on the Package date'
          using errcode = '23503';
      end if;
    end if;
$add$
  );

  -- What the history and the answer say.
  v_definition := pg_temp.replace_once(
    v_definition,
    E'        ''released_options'', v_released,\n'
    || E'        ''removed_hardware'', v_removed_hardware,\n',
    E'        ''released_options'', v_released,\n'
    || E'        ''added_options'', v_added_options,\n'
    || E'        ''removed_hardware'', v_removed_hardware,\n'
  );
  v_definition := pg_temp.replace_once(
    v_definition,
    E'      ''released_options'', v_released,\n'
    || E'      ''removed_hardware'', v_removed_hardware,\n'
    || E'      ''added_hardware'', v_added_hardware,\n'
    || E'      ''removed_documents'', v_documents,\n',
    E'      ''released_options'', v_released,\n'
    || E'      ''added_options'', v_added_options,\n'
    || E'      ''removed_hardware'', v_removed_hardware,\n'
    || E'      ''added_hardware'', v_added_hardware,\n'
    || E'      ''removed_documents'', v_documents,\n'
  );

  drop function valtrim.edit_invoiced_draw_package(uuid, bigint, jsonb, jsonb, jsonb, text, text, boolean);
  execute v_definition;
end;
$migration$;

-- 3. Only the Edge Function (service role) can use it ----------------------------------------------------------

revoke execute on function valtrim.edit_invoiced_draw_package(
  uuid, bigint, jsonb, jsonb, jsonb, text, text, boolean, jsonb
) from public, anon, authenticated;

grant execute on function valtrim.edit_invoiced_draw_package(
  uuid, bigint, jsonb, jsonb, jsonb, text, text, boolean, jsonb
) to service_role;

comment on function valtrim.edit_invoiced_draw_package(
  uuid, bigint, jsonb, jsonb, jsonb, text, text, boolean, jsonb
) is
  'Edits the cells, Separate Hardware lines and single Options of an unpaid Draw Package that waits for payment (taking Options off or putting free ones back), removes its Release and Payment Schedule, and marks the QuickBooks invoice as waiting for the new lines. With p_dry_run nothing is kept. Service role only.';

notify pgrst, 'reload schema';

commit;
