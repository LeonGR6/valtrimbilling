-- Phase 45: Release template signature date.
--
-- "Date of Signature" exists in all four statutory Release forms, including
-- the Unconditional Final form, which has neither a Through Date nor a check
-- amount. Adding it to the catalog lets every Release type be confirmed.
-- It uses the same date formats as through_date.

begin;

create or replace function private.release_template_variables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['through_date', 'check_amount', 'signature_date']::text[];
$$;

create or replace function private.validate_release_template_mapping(
  p_mapping jsonb,
  p_page_count integer
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_field jsonb;
  v_target jsonb;
  v_variable text;
  v_format text;
  v_font numeric;
  v_key text;
  v_page numeric;
  v_x numeric;
  v_y numeric;
  v_w numeric;
  v_h numeric;
  v_count integer;
begin
  if p_mapping is null
     or jsonb_typeof(p_mapping) <> 'object'
     or p_mapping -> 'version' is distinct from to_jsonb(1)
     or jsonb_typeof(p_mapping -> 'fields') is distinct from 'array'
     or exists (
       select 1 from jsonb_object_keys(p_mapping) key
       where key not in ('version', 'fields')
     ) then
    raise exception 'The mapping must be a version 1 object with a fields list'
      using errcode = '23514';
  end if;

  v_count := jsonb_array_length(p_mapping -> 'fields');
  if v_count not between 1 and 12 then
    raise exception 'Map between 1 and 12 fields'
      using errcode = '23514';
  end if;

  for v_field in
    select item.value from jsonb_array_elements(p_mapping -> 'fields') item
  loop
    if jsonb_typeof(v_field) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(v_field) key
         where key not in ('variable', 'target', 'fontSize', 'format', 'cover')
       ) then
      raise exception 'Each mapped field must be an object with known properties'
        using errcode = '23514';
    end if;

    if jsonb_typeof(v_field -> 'variable') is distinct from 'string'
       or (v_field ->> 'variable') <> all (private.release_template_variables()) then
      raise exception 'Select a supported Release variable'
        using errcode = '23514';
    end if;
    v_variable := v_field ->> 'variable';

    v_format := v_field ->> 'format';
    if jsonb_typeof(v_field -> 'format') is distinct from 'string'
       or not (
         (v_variable in ('through_date', 'signature_date')
           and v_format in ('MM/DD/YYYY', 'MMMM D, YYYY', 'YYYY-MM-DD'))
         or (v_variable = 'check_amount'
           and v_format in ('currency', 'plain'))
       ) then
      raise exception 'Select a supported format for %', v_variable
        using errcode = '23514';
    end if;

    if jsonb_typeof(v_field -> 'fontSize') is distinct from 'number' then
      raise exception 'Enter a font size between 4 and 48'
        using errcode = '23514';
    end if;
    v_font := (v_field ->> 'fontSize')::numeric;
    if v_font < 4 or v_font > 48 then
      raise exception 'Enter a font size between 4 and 48'
        using errcode = '23514';
    end if;

    if v_field ? 'cover'
       and jsonb_typeof(v_field -> 'cover') <> 'boolean' then
      raise exception 'The cover option must be true or false'
        using errcode = '23514';
    end if;

    v_target := v_field -> 'target';
    if jsonb_typeof(v_target) is distinct from 'object' then
      raise exception 'Each mapped field needs a target'
        using errcode = '23514';
    end if;

    if v_target ->> 'kind' = 'rect' then
      if exists (
        select 1 from jsonb_object_keys(v_target) key
        where key not in ('kind', 'page', 'x', 'y', 'w', 'h')
      ) then
        raise exception 'A rectangle target has unknown properties'
          using errcode = '23514';
      end if;

      foreach v_key in array array['page', 'x', 'y', 'w', 'h']
      loop
        if jsonb_typeof(v_target -> v_key) is distinct from 'number' then
          raise exception 'A rectangle target needs numeric page, x, y, w and h'
            using errcode = '23514';
        end if;
      end loop;

      v_page := (v_target ->> 'page')::numeric;
      v_x := (v_target ->> 'x')::numeric;
      v_y := (v_target ->> 'y')::numeric;
      v_w := (v_target ->> 'w')::numeric;
      v_h := (v_target ->> 'h')::numeric;

      if v_page <> trunc(v_page)
         or v_page < 1
         or v_page > coalesce(p_page_count, 0) then
        raise exception 'The rectangle page is outside the document'
          using errcode = '23514';
      end if;

      if v_x < 0 or v_x > 1 or v_y < 0 or v_y > 1
         or v_w <= 0 or v_h <= 0
         or v_x + v_w > 1.000001 or v_y + v_h > 1.000001 then
        raise exception 'The rectangle must stay inside the page'
          using errcode = '23514';
      end if;
    elsif v_target ->> 'kind' = 'acroform' then
      if exists (
        select 1 from jsonb_object_keys(v_target) key
        where key not in ('kind', 'fieldName')
      ) then
        raise exception 'A form field target has unknown properties'
          using errcode = '23514';
      end if;

      if jsonb_typeof(v_target -> 'fieldName') is distinct from 'string'
         or btrim(v_target ->> 'fieldName') <> (v_target ->> 'fieldName')
         or char_length(v_target ->> 'fieldName') not between 1 and 200 then
        raise exception 'A form field target needs a field name'
          using errcode = '23514';
      end if;
    else
      raise exception 'Select a rectangle or form field target'
        using errcode = '23514';
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;
