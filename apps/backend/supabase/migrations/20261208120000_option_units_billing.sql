-- An Option that is on a Lot more than once (quantity 3: 1st floor, 2nd floor, 3rd floor) is billed unit
-- by unit, so a Package can charge one location and leave the others for another Package.
--
-- Before, a Package billed the whole row of lot_options: one package_options row per Lot and Option, with
-- the quantity and the amount of all its units. Now a package_options row is ONE unit:
--
--   unit_no     1..quantity of the lot_options row; the primary key is (lot_id, option_id, unit_no)
--   unit_label  the location of that unit when the Package was made (locations[unit_no]), null when
--               the unit has no location
--   quantity    always 1, and option_price is the price of one unit
--
-- A selection names units: { lot_id, option_id, unit_no }. Without unit_no it means every unit of
-- the Option, so older clients keep working. A unit that is on a Package cannot be billed again.
--
-- What changes:
--   package_options / retention_release_option_lines  unit_no, new keys
--   private.expand_option_units                       { lot_id, option_id, unit_no? } -> one row per unit
--   private.package_option_unit_is_selected           the Draw Package option selection, per unit
--   valtrim.prepare_package_draw / populate_package_options   a Draw line bills the selected units
--   private.create_draw_invoice_package               expands the selection into units
--   private.create_options_package                    same, for an Options Package
--   private.recalculate_draft_package                 a rebuilt Package keeps its units
--   private.create_retention_release_package          retention is released unit by unit
--   private.lot_option_quantity_guard                 a billed unit and its location cannot be changed

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- The rows that exist were all billed whole with a quantity of 1. A row with another quantity would need
-- to be split into units first; stop here instead of guessing.
do $check$
begin
  if exists (select 1 from valtrim.package_options where quantity <> 1) then
    raise exception 'package_options has rows with a quantity other than 1; split them into units first';
  end if;
end;
$check$;

-- --- Columns and keys -------------------------------------------------------------------------

alter table valtrim.retention_release_option_lines
  drop constraint retention_release_option_line_source_lot_id_source_option__fkey;
alter table valtrim.retention_release_option_lines
  drop constraint retention_release_option_lines_pkey;

alter table valtrim.package_options
  add column unit_no integer not null default 1,
  add column unit_label text;
alter table valtrim.package_options
  add constraint package_options_unit_no_check check (unit_no between 1 and 99),
  add constraint package_options_unit_label_check
    check (unit_label is null or (btrim(unit_label) <> '' and char_length(unit_label) <= 100)),
  add constraint package_options_unit_quantity_check check (quantity = 1);

alter table valtrim.package_options drop constraint package_options_pkey;
alter table valtrim.package_options
  add constraint package_options_pkey primary key (lot_id, option_id, unit_no);

alter table valtrim.retention_release_option_lines
  add column source_unit_no integer not null default 1;
alter table valtrim.retention_release_option_lines
  add constraint retention_release_option_lines_pkey
    primary key (package_id, source_lot_id, source_option_id, source_unit_no),
  add constraint retention_release_option_lines_source_fkey
    foreign key (source_lot_id, source_option_id, source_unit_no)
    references valtrim.package_options (lot_id, option_id, unit_no) on delete restrict;

drop index if exists valtrim.retention_release_option_lines_source_idx;
create index retention_release_option_lines_source_idx
  on valtrim.retention_release_option_lines (source_lot_id, source_option_id, source_unit_no);

grant select (unit_no, unit_label) on valtrim.package_options to authenticated;
grant select (source_unit_no) on valtrim.retention_release_option_lines to authenticated;

-- --- A selection of Options, one row per unit ---------------------------------------------------

create function private.expand_option_units(p_items jsonb)
returns table (lot_id bigint, option_id bigint, unit_no integer)
language plpgsql
stable
set search_path = ''
as $$
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Options must be a JSON array' using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where item ? 'unit_no'
      and jsonb_typeof(item->'unit_no') <> 'null'
      and (
        jsonb_typeof(item->'unit_no') <> 'number'
        or item->>'unit_no' !~ '^[1-9][0-9]?$'
      )
  ) then
    raise exception 'Every unit of an Option must be a number from 1 to 99'
      using errcode = '23514';
  end if;

  return query
  select
    requested.lot_id,
    requested.option_id,
    unit.no
  from jsonb_to_recordset(p_items)
    as requested(lot_id bigint, option_id bigint, unit_no integer)
  left join valtrim.lot_options selected
    on selected.lot_id = requested.lot_id
   and selected.option_id = requested.option_id
  cross join lateral generate_series(
    coalesce(requested.unit_no, 1),
    coalesce(requested.unit_no, selected.quantity, 1)
  ) as unit(no);
end;
$$;

revoke all on function private.expand_option_units(jsonb) from public, anon, authenticated;

-- The Draw Package option selection, for one unit. A request without units charges every unit.
create function private.package_option_unit_is_selected(
  p_billing_lot_id bigint,
  p_draw_number smallint,
  p_option_lot_id bigint,
  p_option_id bigint,
  p_unit_no integer
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_request_text text := current_setting('valtrim.draw_package_option_charge', true);
  v_request jsonb;
begin
  -- Correction flows and older clients retain their established behavior:
  -- each billing-Draw line collects every Option on its own Lot.
  if v_request_text is null or v_request_text = '' then
    return p_option_lot_id = p_billing_lot_id;
  end if;

  v_request := v_request_text::jsonb;
  if (v_request->>'anchor_lot_id')::bigint <> p_billing_lot_id
     or (v_request->>'anchor_draw_number')::smallint <> p_draw_number then
    return false;
  end if;

  return exists (
    select 1
    from jsonb_to_recordset(v_request->'package_options')
      as selected(lot_id bigint, option_id bigint, unit_no integer)
    where selected.lot_id = p_option_lot_id
      and selected.option_id = p_option_id
      and (selected.unit_no is null or selected.unit_no = p_unit_no)
  );
end;
$$;

-- --- A Draw line saves the units it bills ------------------------------------------------------

create or replace function valtrim.populate_package_options()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.draw_number = (
    select options_billing_draw_number
    from valtrim.billing_setup_versions where id = new.setup_version_id
  ) or nullif(
    current_setting('valtrim.draw_package_option_charge', true), ''
  ) is not null then
    insert into valtrim.package_options (
      package_id,
      billing_lot_id,
      lot_id,
      option_id,
      unit_no,
      unit_label,
      draw_id,
      option_price_id,
      option_code,
      option_name,
      option_price,
      quantity,
      option_not_applicable,
      phase_id,
      phase_code,
      building,
      lot_number,
      plan_code
    )
    select
      new.package_id,
      new.lot_id,
      selected.lot_id,
      selected.option_id,
      unit.no,
      nullif(btrim(selected.locations[unit.no]), ''),
      new.draw_id,
      price.id,
      option.code,
      option.name,
      price.price,
      1,
      price.is_not_applicable,
      phase.id,
      phase.code,
      phase.building,
      lot.lot_number,
      plan.code
    from valtrim.lot_options selected
    cross join lateral generate_series(1, selected.quantity) as unit(no)
    join valtrim.lots lot on lot.id = selected.lot_id
    join valtrim.phases phase on phase.id = lot.phase_id
    join valtrim.plans plan on plan.id = lot.plan_id
    join valtrim.plan_options option on option.id = selected.option_id
    join valtrim.draw_packages package on package.id = new.package_id
    join lateral (
      select candidate.* from valtrim.option_prices candidate
      where candidate.option_id = selected.option_id
        and (
          candidate.id = selected.option_price_id
          or (
            selected.option_price_id is null
            and candidate.effective_from <= package.package_date
            and (
              candidate.effective_to is null
              or candidate.effective_to >= package.package_date
            )
          )
        )
      order by candidate.effective_from desc, candidate.id desc
      limit 1
    ) price on true
    where private.package_option_unit_is_selected(
      new.lot_id,
      new.draw_number,
      selected.lot_id,
      selected.option_id,
      unit.no
    );
  end if;
  return new;
end;
$$;

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

-- The amount of a Draw line: the price of every selected unit.
select pg_temp.patch_function(
  'valtrim.prepare_package_draw()'::regprocedure,
$old$    from valtrim.lot_options selected
    where private.package_option_charge_is_selected(
      new.lot_id,
      v_record.draw_number,
      selected.lot_id,
      selected.option_id
    );

    select count(*), coalesce(sum(price.price * selected.quantity), 0)
    into v_priced_options_count, new.options_amount
    from valtrim.lot_options selected
    join lateral ($old$,
$new$    from valtrim.lot_options selected
    cross join lateral generate_series(1, selected.quantity) as unit(no)
    where private.package_option_unit_is_selected(
      new.lot_id,
      v_record.draw_number,
      selected.lot_id,
      selected.option_id,
      unit.no
    );

    select count(*), coalesce(sum(price.price), 0)
    into v_priced_options_count, new.options_amount
    from valtrim.lot_options selected
    cross join lateral generate_series(1, selected.quantity) as unit(no)
    join lateral ($new$
);
select pg_temp.patch_function(
  'valtrim.prepare_package_draw()'::regprocedure,
$old$    ) price on true
    where private.package_option_charge_is_selected(
      new.lot_id,
      v_record.draw_number,
      selected.lot_id,
      selected.option_id
    );$old$,
$new$    ) price on true
    where private.package_option_unit_is_selected(
      new.lot_id,
      v_record.draw_number,
      selected.lot_id,
      selected.option_id,
      unit.no
    );$new$
);

-- --- A Draw Package expands its Option selection into units ---------------------------------------

select pg_temp.patch_function(
  'private.create_draw_invoice_package(bigint,jsonb,date,text)'::regprocedure,
$old$    select coalesce(jsonb_agg(jsonb_build_object(
      'lot_id', requested.lot_id,
      'option_id', requested.option_id
    ) order by requested.lot_id, requested.option_id), '[]'::jsonb)
    into v_selected_options
    from jsonb_array_elements(p_selections) item
    cross join lateral jsonb_to_recordset(item->'package_options')
      as requested(lot_id bigint, option_id bigint)
    where item ? 'package_options';$old$,
$new$    select coalesce(jsonb_agg(jsonb_build_object(
      'lot_id', requested.lot_id,
      'option_id', requested.option_id,
      'unit_no', requested.unit_no
    ) order by requested.lot_id, requested.option_id, requested.unit_no), '[]'::jsonb)
    into v_selected_options
    from jsonb_array_elements(p_selections) item
    cross join lateral jsonb_to_recordset(item->'package_options')
      as requested(lot_id bigint, option_id bigint, unit_no integer)
    where item ? 'package_options';$new$
);
select pg_temp.patch_function(
  'private.create_draw_invoice_package(bigint,jsonb,date,text)'::regprocedure,
$old$  if v_explicit_package_options or v_explicit_legacy_options then
    select count(*), count(distinct row(selected.lot_id, selected.option_id))
    into v_requested_options, v_unique
    from jsonb_to_recordset(v_selected_options)
      as selected(lot_id bigint, option_id bigint);$old$,
$new$  if v_explicit_package_options or v_explicit_legacy_options then
    -- An Option without a unit means every unit of it; from here on each unit is one selection.
    select coalesce(jsonb_agg(jsonb_build_object(
      'lot_id', unit.lot_id,
      'option_id', unit.option_id,
      'unit_no', unit.unit_no
    ) order by unit.lot_id, unit.option_id, unit.unit_no), '[]'::jsonb)
    into v_selected_options
    from private.expand_option_units(v_selected_options) unit;

    select count(*), count(distinct row(selected.lot_id, selected.option_id, selected.unit_no))
    into v_requested_options, v_unique
    from jsonb_to_recordset(v_selected_options)
      as selected(lot_id bigint, option_id bigint, unit_no integer);$new$
);
select pg_temp.patch_function(
  'private.create_draw_invoice_package(bigint,jsonb,date,text)'::regprocedure,
$old$    from jsonb_to_recordset(v_selected_options)
      as requested(lot_id bigint, option_id bigint)
    left join valtrim.lot_options selected
      on selected.lot_id = requested.lot_id
     and selected.option_id = requested.option_id
$old$,
$new$    from jsonb_to_recordset(v_selected_options)
      as requested(lot_id bigint, option_id bigint, unit_no integer)
    left join valtrim.lot_options selected
      on selected.lot_id = requested.lot_id
     and selected.option_id = requested.option_id
     and selected.quantity >= requested.unit_no
$new$
);
select pg_temp.patch_function(
  'private.create_draw_invoice_package(bigint,jsonb,date,text)'::regprocedure,
$old$    left join valtrim.package_options billed
      on billed.lot_id = requested.lot_id
     and billed.option_id = requested.option_id;$old$,
$new$    left join valtrim.package_options billed
      on billed.lot_id = requested.lot_id
     and billed.option_id = requested.option_id
     and billed.unit_no = requested.unit_no;$new$
);

-- --- An Options Package bills the units it names ---------------------------------------------------

select pg_temp.patch_function(
  'private.create_options_package(bigint,jsonb,date,text)'::regprocedure,
$old$  select count(*), count(distinct row(requested.lot_id, requested.option_id))
  into v_requested, v_unique
  from jsonb_to_recordset(p_options) as requested(lot_id bigint, option_id bigint);$old$,
$new$  -- An Option without a unit means every unit of it; from here on each unit is one selection.
  p_options := coalesce((
    select jsonb_agg(jsonb_build_object(
      'lot_id', unit.lot_id,
      'option_id', unit.option_id,
      'unit_no', unit.unit_no
    ) order by unit.lot_id, unit.option_id, unit.unit_no)
    from private.expand_option_units(p_options) unit
  ), '[]'::jsonb);
  if jsonb_array_length(p_options) > 5000 then
    raise exception 'Select between 1 and 5000 Options' using errcode = '23514';
  end if;

  select count(*), count(distinct row(requested.lot_id, requested.option_id, requested.unit_no))
  into v_requested, v_unique
  from jsonb_to_recordset(p_options)
    as requested(lot_id bigint, option_id bigint, unit_no integer);$new$
);
select pg_temp.patch_function(
  'private.create_options_package(bigint,jsonb,date,text)'::regprocedure,
  'as requested(lot_id bigint, option_id bigint)',
  'as requested(lot_id bigint, option_id bigint, unit_no integer)',
  3
);
select pg_temp.patch_function(
  'private.create_options_package(bigint,jsonb,date,text)'::regprocedure,
$old$  left join valtrim.lot_options selected
    on selected.lot_id = requested.lot_id
   and selected.option_id = requested.option_id
  left join valtrim.lots lot on lot.id = selected.lot_id$old$,
$new$  left join valtrim.lot_options selected
    on selected.lot_id = requested.lot_id
   and selected.option_id = requested.option_id
   and selected.quantity >= requested.unit_no
  left join valtrim.lots lot on lot.id = selected.lot_id$new$
);
select pg_temp.patch_function(
  'private.create_options_package(bigint,jsonb,date,text)'::regprocedure,
$old$  left join valtrim.package_options billed
    on billed.lot_id = requested.lot_id
   and billed.option_id = requested.option_id
  left join lateral ($old$,
$new$  left join valtrim.package_options billed
    on billed.lot_id = requested.lot_id
   and billed.option_id = requested.option_id
   and billed.unit_no = requested.unit_no
  left join lateral ($new$
);
select pg_temp.patch_function(
  'private.create_options_package(bigint,jsonb,date,text)'::regprocedure,
$old$  join valtrim.lot_options selected
    on selected.lot_id = requested.lot_id
   and selected.option_id = requested.option_id
  join valtrim.lots lot on lot.id = selected.lot_id
  join valtrim.phases phase on phase.id = lot.phase_id$old$,
$new$  join valtrim.lot_options selected
    on selected.lot_id = requested.lot_id
   and selected.option_id = requested.option_id
   and selected.quantity >= requested.unit_no
  join valtrim.lots lot on lot.id = selected.lot_id
  join valtrim.phases phase on phase.id = lot.phase_id$new$
);
select pg_temp.patch_function(
  'private.create_options_package(bigint,jsonb,date,text)'::regprocedure,
$old$    option_price,
    quantity,
    option_not_applicable,
    phase_id,
    phase_code,
    building,
    lot_number,
    plan_code,
    retention_amount,
    wrap_amount
  )$old$,
$new$    option_price,
    quantity,
    unit_no,
    unit_label,
    option_not_applicable,
    phase_id,
    phase_code,
    building,
    lot_number,
    plan_code,
    retention_amount,
    wrap_amount
  )$new$
);
select pg_temp.patch_function(
  'private.create_options_package(bigint,jsonb,date,text)'::regprocedure,
$old$    price.price * selected.quantity,
    selected.quantity,
    price.is_not_applicable,
    phase.id,
    phase.code,
    phase.building,
    lot.lot_number,
    plan.code,
    round(price.price * selected.quantity * v_retention_percentage / 100, 2),
    round(price.price * selected.quantity * v_wrap_percentage / 100, 2)$old$,
$new$    price.price,
    1,
    requested.unit_no,
    nullif(btrim(selected.locations[requested.unit_no]), ''),
    price.is_not_applicable,
    phase.id,
    phase.code,
    phase.building,
    lot.lot_number,
    plan.code,
    round(price.price * v_retention_percentage / 100, 2),
    round(price.price * v_wrap_percentage / 100, 2)$new$
);
select pg_temp.patch_function(
  'private.create_options_package(bigint,jsonb,date,text)'::regprocedure,
$old$  order by phase.code, lot.lot_number, option.code;$old$,
$new$  order by phase.code, lot.lot_number, option.code, requested.unit_no;$new$
);

-- --- A rebuilt Package keeps its units -------------------------------------------------------------

select pg_temp.patch_function(
  'private.recalculate_draft_package(bigint,text,boolean)'::regprocedure,
$old$jsonb_build_object('lot_id', billed.lot_id, 'option_id', billed.option_id)
          order by billed.lot_id, billed.option_id$old$,
$new$jsonb_build_object(
            'lot_id', billed.lot_id, 'option_id', billed.option_id, 'unit_no', billed.unit_no
          )
          order by billed.lot_id, billed.option_id, billed.unit_no$new$
);

-- --- Retention is released unit by unit -------------------------------------------------------------

select pg_temp.patch_function(
  'private.create_retention_release_package(bigint,bigint,text)'::regprocedure,
$old$        where allocated.source_lot_id = billed.lot_id
          and allocated.source_option_id = billed.option_id
      )
  ) source;$old$,
$new$        where allocated.source_lot_id = billed.lot_id
          and allocated.source_option_id = billed.option_id
          and allocated.source_unit_no = billed.unit_no
      )
  ) source;$new$
);
select pg_temp.patch_function(
  'private.create_retention_release_package(bigint,bigint,text)'::regprocedure,
$old$    source_option_id,
    phase_id,
    retention_amount
  )
  select
    v_package_id,
    billed.package_id,
    billed.lot_id,
    billed.option_id,
    billed.phase_id,$old$,
$new$    source_option_id,
    source_unit_no,
    phase_id,
    retention_amount
  )
  select
    v_package_id,
    billed.package_id,
    billed.lot_id,
    billed.option_id,
    billed.unit_no,
    billed.phase_id,$new$
);
select pg_temp.patch_function(
  'private.create_retention_release_package(bigint,bigint,text)'::regprocedure,
$old$      where allocated.source_lot_id = billed.lot_id
        and allocated.source_option_id = billed.option_id
    )
  order by billed.package_id, billed.phase_id, billed.lot_id, billed.option_id;$old$,
$new$      where allocated.source_lot_id = billed.lot_id
        and allocated.source_option_id = billed.option_id
        and allocated.source_unit_no = billed.unit_no
    )
  order by billed.package_id, billed.phase_id, billed.lot_id, billed.option_id, billed.unit_no;$new$
);

-- --- A billed unit and its location are fixed ---------------------------------------------------

create or replace function private.lot_option_quantity_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A unit that is on a Package cannot be taken away. Raising the quantity only adds units.
  if new.quantity < old.quantity
     and exists (
       select 1
       from valtrim.package_options billed
       where billed.lot_id = old.lot_id
         and billed.option_id = old.option_id
         and billed.unit_no > new.quantity
     ) then
    raise exception 'A unit of an Option that is already on a Package cannot be removed'
      using errcode = '23514';
  end if;

  -- The location a Package billed stays where it is: unit 2 is still the 2nd location.
  if new.locations is distinct from old.locations
     and exists (
       select 1
       from valtrim.package_options billed
       where billed.lot_id = old.lot_id
         and billed.option_id = old.option_id
         and old.locations[billed.unit_no] is not null
         and old.locations[billed.unit_no] is distinct from new.locations[billed.unit_no]
     ) then
    raise exception 'A location that is already on a Package cannot change'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger lot_options_quantity_guard on valtrim.lot_options;
create trigger lot_options_quantity_guard
before update of quantity, locations on valtrim.lot_options
for each row execute function private.lot_option_quantity_guard();

notify pgrst, 'reload schema';

commit;
