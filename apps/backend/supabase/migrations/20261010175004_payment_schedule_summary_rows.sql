-- Phase 57: Summary rows in the Payment Schedule mapping.
--
-- A matrix Payment Schedule leaves two rows blank for every invoice, "Previously
-- Invoiced" and "This Request", with a "$" in each draw's cell. The analysis now
-- finds those cells and the confirmed mapping can keep them, so a Package can
-- write its amounts there. They are optional (a list layout has none, and a
-- reviewer can leave them out), and the rest of the mapping is unchanged.
--
-- Mapping shape (version 1), the new key last:
--   { "version": 1, "layout": "matrix", "cells": [ ... ],
--     "summaryRows": {
--       "previouslyInvoiced": [ { "draw": 1, "page": 1, "rect": { "x": 0.3, "y": 0.5, "w": 0.05, "h": 0.01 } } ],
--       "thisRequest":        [ { "draw": 1, "page": 1, "rect": { ... } } ] } }
-- Each list holds one box per draw (1 to 5, no repeats), in the same normalized
-- coordinates as the cells.

begin;

create or replace function private.validate_payment_schedule_mapping(
  p_mapping jsonb,
  p_page_count integer
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_cell jsonb;
  v_rect jsonb;
  v_key text;
  v_page numeric;
  v_draw numeric;
  v_amount numeric;
  v_x numeric;
  v_y numeric;
  v_w numeric;
  v_h numeric;
  v_count integer;
  v_distinct integer;
  v_list_key text;
  v_list jsonb;
  v_target jsonb;
  v_target_draws numeric[];
begin
  if p_mapping is null
     or jsonb_typeof(p_mapping) <> 'object'
     or p_mapping -> 'version' is distinct from to_jsonb(1)
     or jsonb_typeof(p_mapping -> 'layout') is distinct from 'string'
     or (p_mapping ->> 'layout') not in ('matrix', 'line_items')
     or jsonb_typeof(p_mapping -> 'cells') is distinct from 'array'
     or exists (
       select 1 from jsonb_object_keys(p_mapping) key
       where key not in ('version', 'layout', 'cells', 'summaryRows')
     ) then
    raise exception
      'The mapping must be a version 1 object with a layout and a cells list'
      using errcode = '23514';
  end if;

  v_count := jsonb_array_length(p_mapping -> 'cells');
  if v_count not between 1 and 5000 then
    raise exception 'Map between 1 and 5000 cells'
      using errcode = '23514';
  end if;

  for v_cell in
    select item.value from jsonb_array_elements(p_mapping -> 'cells') item
  loop
    if jsonb_typeof(v_cell) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(v_cell) key
         where key not in ('phase', 'lot', 'draw', 'amount', 'page', 'rect')
       ) then
      raise exception 'Each cell must be an object with known properties'
        using errcode = '23514';
    end if;

    if jsonb_typeof(v_cell -> 'lot') is distinct from 'string'
       or btrim(v_cell ->> 'lot') <> (v_cell ->> 'lot')
       or char_length(v_cell ->> 'lot') not between 1 and 40 then
      raise exception 'Each cell needs a Lot of 1 to 40 characters'
        using errcode = '23514';
    end if;

    if v_cell ? 'phase'
       and jsonb_typeof(v_cell -> 'phase') <> 'null'
       and (
         jsonb_typeof(v_cell -> 'phase') <> 'string'
         or btrim(v_cell ->> 'phase') <> (v_cell ->> 'phase')
         or char_length(v_cell ->> 'phase') not between 1 and 40
       ) then
      raise exception 'A cell Phase must be empty or 1 to 40 characters'
        using errcode = '23514';
    end if;

    if jsonb_typeof(v_cell -> 'draw') is distinct from 'number' then
      raise exception 'Each cell needs a draw number from 1 to 5'
        using errcode = '23514';
    end if;
    v_draw := (v_cell ->> 'draw')::numeric;
    if v_draw <> trunc(v_draw) or v_draw not between 1 and 5 then
      raise exception 'Each cell needs a draw number from 1 to 5'
        using errcode = '23514';
    end if;

    if jsonb_typeof(v_cell -> 'amount') is distinct from 'number' then
      raise exception 'Each cell needs an amount with at most two decimals'
        using errcode = '23514';
    end if;
    v_amount := (v_cell ->> 'amount')::numeric;
    if v_amount < 0
       or v_amount > 9999999999.99
       or v_amount <> round(v_amount, 2) then
      raise exception 'Each cell needs an amount with at most two decimals'
        using errcode = '23514';
    end if;

    if jsonb_typeof(v_cell -> 'page') is distinct from 'number' then
      raise exception 'The cell page is outside the document'
        using errcode = '23514';
    end if;
    v_page := (v_cell ->> 'page')::numeric;
    if v_page <> trunc(v_page)
       or v_page < 1
       or v_page > coalesce(p_page_count, 0) then
      raise exception 'The cell page is outside the document'
        using errcode = '23514';
    end if;

    v_rect := v_cell -> 'rect';
    if jsonb_typeof(v_rect) is distinct from 'object'
       or exists (
         select 1 from jsonb_object_keys(v_rect) key
         where key not in ('x', 'y', 'w', 'h')
       ) then
      raise exception 'Each cell needs a rectangle with x, y, w and h'
        using errcode = '23514';
    end if;

    foreach v_key in array array['x', 'y', 'w', 'h']
    loop
      if jsonb_typeof(v_rect -> v_key) is distinct from 'number' then
        raise exception 'Each cell needs a rectangle with x, y, w and h'
          using errcode = '23514';
      end if;
    end loop;

    v_x := (v_rect ->> 'x')::numeric;
    v_y := (v_rect ->> 'y')::numeric;
    v_w := (v_rect ->> 'w')::numeric;
    v_h := (v_rect ->> 'h')::numeric;

    if v_x < 0 or v_x > 1 or v_y < 0 or v_y > 1
       or v_w <= 0 or v_h <= 0
       or v_x + v_w > 1.000001 or v_y + v_h > 1.000001 then
      raise exception 'The cell rectangle must stay inside the page'
        using errcode = '23514';
    end if;
  end loop;

  select count(*)
    into v_distinct
  from (
    select distinct
      coalesce(cell.value ->> 'phase', ''),
      cell.value ->> 'lot',
      cell.value ->> 'draw'
    from jsonb_array_elements(p_mapping -> 'cells') cell
  ) distinct_cells;

  if v_distinct <> v_count then
    raise exception 'Each Phase, Lot and draw can appear only once'
      using errcode = '23514';
  end if;

  -- Optional boxes for the "Previously Invoiced" and "This Request" rows of a
  -- matrix schedule: { "previouslyInvoiced": [ { draw, page, rect } ], "thisRequest": [...] }
  if p_mapping ? 'summaryRows' then
    if p_mapping ->> 'layout' <> 'matrix' then
      raise exception 'The summary rows only apply to the matrix layout'
        using errcode = '23514';
    end if;

    if jsonb_typeof(p_mapping -> 'summaryRows') <> 'object'
       or (p_mapping -> 'summaryRows') = '{}'::jsonb
       or exists (
         select 1 from jsonb_object_keys(p_mapping -> 'summaryRows') key
         where key not in ('previouslyInvoiced', 'thisRequest')
       ) then
      raise exception 'The summary rows need a previouslyInvoiced or a thisRequest list'
        using errcode = '23514';
    end if;

    for v_list_key in
      select key from jsonb_object_keys(p_mapping -> 'summaryRows') key
    loop
      v_list := p_mapping -> 'summaryRows' -> v_list_key;
      if jsonb_typeof(v_list) <> 'array'
         or jsonb_array_length(v_list) not between 1 and 5 then
        raise exception 'Each summary row needs between 1 and 5 boxes, one per draw'
          using errcode = '23514';
      end if;

      v_target_draws := '{}';
      for v_target in
        select item.value from jsonb_array_elements(v_list) item
      loop
        if jsonb_typeof(v_target) <> 'object'
           or exists (
             select 1 from jsonb_object_keys(v_target) key
             where key not in ('draw', 'page', 'rect')
           ) then
          raise exception 'Each summary box must be an object with known properties'
            using errcode = '23514';
        end if;

        if jsonb_typeof(v_target -> 'draw') is distinct from 'number' then
          raise exception 'Each summary box needs a draw number from 1 to 5, used once'
            using errcode = '23514';
        end if;
        v_draw := (v_target ->> 'draw')::numeric;
        if v_draw <> trunc(v_draw)
           or v_draw not between 1 and 5
           or v_draw = any (v_target_draws) then
          raise exception 'Each summary box needs a draw number from 1 to 5, used once'
            using errcode = '23514';
        end if;
        v_target_draws := v_target_draws || v_draw;

        if jsonb_typeof(v_target -> 'page') is distinct from 'number' then
          raise exception 'The summary box page is outside the document'
            using errcode = '23514';
        end if;
        v_page := (v_target ->> 'page')::numeric;
        if v_page <> trunc(v_page)
           or v_page < 1
           or v_page > coalesce(p_page_count, 0) then
          raise exception 'The summary box page is outside the document'
            using errcode = '23514';
        end if;

        v_rect := v_target -> 'rect';
        if jsonb_typeof(v_rect) is distinct from 'object'
           or exists (
             select 1 from jsonb_object_keys(v_rect) key
             where key not in ('x', 'y', 'w', 'h')
           ) then
          raise exception 'Each summary box needs a rectangle with x, y, w and h'
            using errcode = '23514';
        end if;

        foreach v_key in array array['x', 'y', 'w', 'h']
        loop
          if jsonb_typeof(v_rect -> v_key) is distinct from 'number' then
            raise exception 'Each summary box needs a rectangle with x, y, w and h'
              using errcode = '23514';
          end if;
        end loop;

        v_x := (v_rect ->> 'x')::numeric;
        v_y := (v_rect ->> 'y')::numeric;
        v_w := (v_rect ->> 'w')::numeric;
        v_h := (v_rect ->> 'h')::numeric;

        if v_x < 0 or v_x > 1 or v_y < 0 or v_y > 1
           or v_w <= 0 or v_h <= 0
           or v_x + v_w > 1.000001 or v_y + v_h > 1.000001 then
          raise exception 'The summary box rectangle must stay inside the page'
            using errcode = '23514';
        end if;
      end loop;
    end loop;
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
