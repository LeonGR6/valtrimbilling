-- Dry run of 20261230120000_payment_schedule_utility_cells.sql: migration + checks, rolled back.
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




create function pg_temp.mapping_ok(p_mapping jsonb, p_pages integer)
returns boolean language plpgsql as $f$
begin
  perform private.validate_payment_schedule_mapping(p_mapping, p_pages);
  return true;
exception when sqlstate '23514' then
  return false;
end;
$f$;

-- Checks, run after the migration above inside the same transaction.
create temporary table phase109_results (name text primary key, ok boolean not null) on commit drop;

create function pg_temp.check_mapping(p_name text, p_mapping jsonb, p_expect_ok boolean, p_pages integer default 3)
returns void language plpgsql as $f$
declare
  v_ok boolean := true;
begin
  begin
    perform private.validate_payment_schedule_mapping(p_mapping, p_pages);
  exception when sqlstate '23514' then
    v_ok := false;
  end;
  insert into phase109_results values (p_name, v_ok = p_expect_ok);
end;
$f$;

do $t$
declare
  v_cell jsonb := '{"phase": "1", "lot": "001", "draw": 1, "amount": 908.6, "page": 1, "rect": {"x": 0.1, "y": 0.1, "w": 0.5, "h": 0.02}}';
  v_utility jsonb := '{"phase": "1", "lot": "001", "amount": 630, "page": 2, "rect": {"x": 0.1, "y": 0.3, "w": 0.5, "h": 0.02}}';
  v_base jsonb;
begin
  v_base := jsonb_build_object('version', 1, 'layout', 'line_items', 'cells', jsonb_build_array(v_cell));
  perform pg_temp.check_mapping('01 draws only still valid', v_base, true);
  perform pg_temp.check_mapping('02 draws and Utility valid',
    v_base || jsonb_build_object('utilityCells', jsonb_build_array(v_utility,
      jsonb_set(v_utility, '{lot}', '"002"'))), true);
  perform pg_temp.check_mapping('03 Utility without phase valid',
    v_base || jsonb_build_object('utilityCells', jsonb_build_array(v_utility - 'phase')), true);
  perform pg_temp.check_mapping('04 empty Utility list rejected',
    v_base || '{"utilityCells": []}'::jsonb, false);
  perform pg_temp.check_mapping('05 Utility list not an array rejected',
    v_base || '{"utilityCells": {}}'::jsonb, false);
  perform pg_temp.check_mapping('06 duplicate Phase and Lot rejected',
    v_base || jsonb_build_object('utilityCells', jsonb_build_array(v_utility, v_utility)), false);
  perform pg_temp.check_mapping('07 Utility with a draw rejected',
    v_base || jsonb_build_object('utilityCells', jsonb_build_array(v_utility || '{"draw": 1}'::jsonb)), false);
  perform pg_temp.check_mapping('08 Utility page outside rejected',
    v_base || jsonb_build_object('utilityCells', jsonb_build_array(jsonb_set(v_utility, '{page}', '9'))), false);
  perform pg_temp.check_mapping('09 Utility amount with 3 decimals rejected',
    v_base || jsonb_build_object('utilityCells', jsonb_build_array(jsonb_set(v_utility, '{amount}', '1.234'))), false);
  perform pg_temp.check_mapping('10 Utility rect outside page rejected',
    v_base || jsonb_build_object('utilityCells', jsonb_build_array(jsonb_set(v_utility, '{rect,w}', '0.95'))), false);
  perform pg_temp.check_mapping('11 Utility blank Lot rejected',
    v_base || jsonb_build_object('utilityCells', jsonb_build_array(jsonb_set(v_utility, '{lot}', '""'))), false);
  perform pg_temp.check_mapping('12 other unknown key still rejected', v_base || '{"foo": 1}'::jsonb, false);
  perform pg_temp.check_mapping('13 no draw cells still rejected',
    jsonb_build_object('version', 1, 'layout', 'line_items', 'cells', '[]'::jsonb,
      'utilityCells', jsonb_build_array(v_utility)), false);
  perform pg_temp.check_mapping('14 draw rules unchanged (draw 6 rejected)',
    jsonb_build_object('version', 1, 'layout', 'line_items',
      'cells', jsonb_build_array(jsonb_set(v_cell, '{draw}', '6'))), false);
  perform pg_temp.check_mapping('15 null mapping rejected', null, false);
end;
$t$;

insert into phase109_results
select '16 draw validator kept under its new name',
  to_regprocedure('private.validate_payment_schedule_draw_mapping(jsonb,integer)') is not null;
insert into phase109_results
select '17 authenticated can execute the validator',
  has_function_privilege('authenticated', 'private.validate_payment_schedule_mapping(jsonb,integer)', 'execute');
insert into phase109_results
select '18 anon cannot execute the validator',
  not has_function_privilege('anon', 'private.validate_payment_schedule_mapping(jsonb,integer)', 'execute');
insert into phase109_results
select '19 every confirmed mapping still valid',
  not exists (
    select 1 from valtrim.payment_schedule_templates t
    where t.status = 'confirmed'
      and not (select pg_temp.mapping_ok(t.mapping, t.page_count))
  );

-- Report and undo everything: the exception rolls the whole transaction back.
do $r$
declare
  v_report text;
  v_failed integer;
begin
  select string_agg(name || ' = ' || ok, E'\n' order by name), count(*) filter (where not ok)
    into v_report, v_failed
  from phase109_results;
  raise exception E'DRY RUN (rolled back), % failed:\n%', v_failed, v_report;
end;
$r$;

rollback;
