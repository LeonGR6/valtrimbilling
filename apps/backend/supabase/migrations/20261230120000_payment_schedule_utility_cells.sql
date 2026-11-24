-- Phase 109: Utility amounts in the Payment Schedule mapping.
--
-- Some builders print the Utility building on the Payment Schedule, split among the
-- Lots of its Phase (Monte Vista: a "Utility Closet" purchase order of $630 on each of
-- the 5 Lots of a $3,150 building). A Package bills the Utility by Phase and Calendar
-- event, not by Lot and draw, so these amounts are not draws: they are kept in their
-- own optional list, and a Package that bills a Phase's Utility highlights all of them.
--
-- Mapping shape (version 1), the new key optional:
--   { "version": 1, "layout": "line_items", "cells": [ ... ],
--     "utilityCells": [ { "phase": "1", "lot": "001", "amount": 630, "page": 5,
--                         "rect": { "x": 0.05, "y": 0.2, "w": 0.9, "h": 0.02 } } ] }
-- A Utility cell is a draw cell without the draw: one per Phase and Lot.
--
-- The draw rules do not change: the existing validator is kept under a new name and
-- checks the mapping without the Utility list.

begin;

alter function private.validate_payment_schedule_mapping(jsonb, integer)
  rename to validate_payment_schedule_draw_mapping;

create function private.validate_payment_schedule_mapping(
  p_mapping jsonb,
  p_page_count integer
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_list jsonb;
  v_cell jsonb;
  v_rect jsonb;
  v_key text;
  v_page numeric;
  v_amount numeric;
  v_x numeric;
  v_y numeric;
  v_w numeric;
  v_h numeric;
  v_count integer;
  v_distinct integer;
begin
  if p_mapping is not null
     and jsonb_typeof(p_mapping) = 'object'
     and p_mapping ? 'utilityCells' then
    v_list := p_mapping -> 'utilityCells';
    if jsonb_typeof(v_list) <> 'array' then
      raise exception 'The Utility amounts must be a list'
        using errcode = '23514';
    end if;

    v_count := jsonb_array_length(v_list);
    if v_count not between 1 and 5000 then
      raise exception 'Map between 1 and 5000 Utility amounts, or leave them out'
        using errcode = '23514';
    end if;

    for v_cell in
      select item.value from jsonb_array_elements(v_list) item
    loop
      if jsonb_typeof(v_cell) <> 'object'
         or exists (
           select 1 from jsonb_object_keys(v_cell) key
           where key not in ('phase', 'lot', 'amount', 'page', 'rect')
         ) then
        raise exception 'Each Utility amount must be an object with known properties'
          using errcode = '23514';
      end if;

      if jsonb_typeof(v_cell -> 'lot') is distinct from 'string'
         or btrim(v_cell ->> 'lot') <> (v_cell ->> 'lot')
         or char_length(v_cell ->> 'lot') not between 1 and 40 then
        raise exception 'Each Utility amount needs a Lot of 1 to 40 characters'
          using errcode = '23514';
      end if;

      if v_cell ? 'phase'
         and jsonb_typeof(v_cell -> 'phase') <> 'null'
         and (
           jsonb_typeof(v_cell -> 'phase') <> 'string'
           or btrim(v_cell ->> 'phase') <> (v_cell ->> 'phase')
           or char_length(v_cell ->> 'phase') not between 1 and 40
         ) then
        raise exception 'A Utility amount Phase must be empty or 1 to 40 characters'
          using errcode = '23514';
      end if;

      if jsonb_typeof(v_cell -> 'amount') is distinct from 'number' then
        raise exception 'Each Utility amount needs an amount with at most two decimals'
          using errcode = '23514';
      end if;
      v_amount := (v_cell ->> 'amount')::numeric;
      if v_amount < 0
         or v_amount > 9999999999.99
         or v_amount <> round(v_amount, 2) then
        raise exception 'Each Utility amount needs an amount with at most two decimals'
          using errcode = '23514';
      end if;

      if jsonb_typeof(v_cell -> 'page') is distinct from 'number' then
        raise exception 'The Utility amount page is outside the document'
          using errcode = '23514';
      end if;
      v_page := (v_cell ->> 'page')::numeric;
      if v_page <> trunc(v_page)
         or v_page < 1
         or v_page > coalesce(p_page_count, 0) then
        raise exception 'The Utility amount page is outside the document'
          using errcode = '23514';
      end if;

      v_rect := v_cell -> 'rect';
      if jsonb_typeof(v_rect) is distinct from 'object'
         or exists (
           select 1 from jsonb_object_keys(v_rect) key
           where key not in ('x', 'y', 'w', 'h')
         ) then
        raise exception 'Each Utility amount needs a rectangle with x, y, w and h'
          using errcode = '23514';
      end if;

      foreach v_key in array array['x', 'y', 'w', 'h']
      loop
        if jsonb_typeof(v_rect -> v_key) is distinct from 'number' then
          raise exception 'Each Utility amount needs a rectangle with x, y, w and h'
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
        raise exception 'The Utility amount rectangle must stay inside the page'
          using errcode = '23514';
      end if;
    end loop;

    select count(*)
      into v_distinct
    from (
      select distinct coalesce(cell.value ->> 'phase', ''), cell.value ->> 'lot'
      from jsonb_array_elements(v_list) cell
    ) distinct_cells;

    if v_distinct <> v_count then
      raise exception 'Each Phase and Lot can have only one Utility amount'
        using errcode = '23514';
    end if;
  end if;

  -- The draws, the summary rows and the shape of the rest, as before.
  perform private.validate_payment_schedule_draw_mapping(
    case
      when jsonb_typeof(p_mapping) = 'object' then p_mapping - 'utilityCells'
      else p_mapping
    end,
    p_page_count
  );
end;
$$;

revoke execute on function private.validate_payment_schedule_mapping(jsonb, integer)
  from public, anon, authenticated;
grant execute on function private.validate_payment_schedule_mapping(jsonb, integer)
  to authenticated, service_role;

comment on function private.validate_payment_schedule_mapping(jsonb, integer) is
  'Checks a Payment Schedule mapping: the draw cells and summary rows (validate_payment_schedule_draw_mapping) and the optional utilityCells list.';

notify pgrst, 'reload schema';

commit;
