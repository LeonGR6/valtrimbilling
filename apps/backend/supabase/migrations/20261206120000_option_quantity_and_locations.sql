-- The same Option can be on a Lot more than once: one unit per place it is installed (1st floor,
-- 2nd floor, ...). It is still ONE row per Lot and Option, at one price, with a quantity and the
-- places it applies to.
--
--   lot_options.quantity       how many units (1 to 99). Billed as price x quantity.
--   lot_options.locations      where they go, up to one text of 100 characters per unit. May be empty or
--                              shorter than the quantity; it never bills anything.
--   package_options.quantity   the quantity the Package billed. package_options.option_price is the amount of
--                              the WHOLE row (unit price x quantity), so every sum of option_price already in
--                              the Packages, the invoices and the Retention Release stays right as it is.
--
-- A Package that is already issued keeps quantity 1 and its amount: every existing row has quantity 1.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Columns -------------------------------------------------------------------

alter table valtrim.lot_options
  add column quantity integer not null default 1,
  add column locations text[] not null default '{}'::text[],
  add constraint lot_options_quantity_check check (quantity between 1 and 99),
  add constraint lot_options_locations_check check (cardinality(locations) <= quantity);

comment on column valtrim.lot_options.quantity is
  'How many units of the Option this Lot has (1 to 99), billed at the Option price each.';
comment on column valtrim.lot_options.locations is
  'Where the units go (for example 1st floor, 2nd floor). At most one per unit; informative, never billed.';

grant select (quantity, locations) on valtrim.lot_options to authenticated;

alter table valtrim.package_options
  add column quantity integer not null default 1,
  add constraint package_options_quantity_check check (quantity between 1 and 99);

comment on column valtrim.package_options.quantity is
  'The quantity of the Option this row billed. option_price is the amount of the whole row (unit price x quantity).';

grant select (quantity) on valtrim.package_options to authenticated;

-- An Option on a Package keeps the quantity it was billed with.
create function private.lot_option_quantity_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.quantity is distinct from old.quantity
     and exists (
       select 1
       from valtrim.package_options billed
       where billed.lot_id = old.lot_id
         and billed.option_id = old.option_id
     ) then
    raise exception 'An Option that is already on a Package cannot change its quantity'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.lot_option_quantity_guard() from public, anon, authenticated;

create trigger lot_options_quantity_guard
before update of quantity on valtrim.lot_options
for each row execute function private.lot_option_quantity_guard();

-- What a saved Lot asks for ---------------------------------------------------
-- option_ids is the list of selected Options; option_details optionally gives some of them a quantity and
-- locations. An Option with no detail has quantity 1 and no locations.

create function private.sequence_sheet_option_wants(p_option_ids jsonb, p_details jsonb)
returns table (option_id bigint, quantity integer, locations text[])
language sql
stable
set search_path = ''
as $$
  select
    picked.value::bigint,
    coalesce((detail.value ->> 'quantity')::integer, 1),
    coalesce(
      array(
        select btrim(place.value)
        from jsonb_array_elements_text(
          coalesce(detail.value -> 'locations', '[]'::jsonb)
        ) place(value)
      ),
      '{}'::text[]
    )
  from jsonb_array_elements_text(coalesce(p_option_ids, '[]'::jsonb)) picked(value)
  left join lateral (
    select candidate.value
    from jsonb_array_elements(coalesce(p_details, '[]'::jsonb)) candidate(value)
    where (candidate.value ->> 'option_id')::bigint = picked.value::bigint
    limit 1
  ) detail on true
$$;

revoke all on function private.sequence_sheet_option_wants(jsonb, jsonb)
  from public, anon, authenticated;

-- Function patching ----------------------------------------------------------
-- Functions are rewritten from their live definition, and the patch aborts when
-- the text it expects is not there.

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
    raise exception 'Cannot patch %: expected % occurrence(s) of the old text, found %',
      p_signature, p_expected_count, v_count;
  end if;
  execute pg_catalog.replace(v_definition, p_old, p_new);
end;
$$;

-- Sequence Sheet: save the quantity and locations --------------------------

select pg_temp.patch_function(
  'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure,
$old$    raise exception 'Each Option can be selected only once per Lot'
      using errcode = '23505';
  end if;
$old$,
$new$    raise exception 'Each Option can be selected only once per Lot'
      using errcode = '23505';
  end if;

  -- option_details: [{ option_id, quantity, locations: [text] }], optional, for Options of the same row.
  if exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
    where jsonb_typeof(coalesce(requested.value -> 'option_details', '[]'::jsonb)) <> 'array'
  ) then
    raise exception 'The Option details of a row must be a list'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
    cross join lateral jsonb_array_elements(
      coalesce(requested.value -> 'option_details', '[]'::jsonb)
    ) detail(value)
    where jsonb_typeof(detail.value) <> 'object'
       or coalesce(detail.value ->> 'option_id', '') !~ '^[1-9][0-9]*$'
       or coalesce(detail.value ->> 'quantity', '1') !~ '^[1-9][0-9]?$'
       or jsonb_typeof(coalesce(detail.value -> 'locations', '[]'::jsonb)) <> 'array'
  ) then
    raise exception 'Every Option detail needs an Option, a quantity from 1 to 99 and a list of locations'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
    cross join lateral jsonb_array_elements(
      coalesce(requested.value -> 'option_details', '[]'::jsonb)
    ) detail(value)
    cross join lateral jsonb_array_elements(
      coalesce(detail.value -> 'locations', '[]'::jsonb)
    ) place(value)
    where jsonb_typeof(place.value) <> 'string'
       or btrim(place.value #>> '{}') = ''
       or char_length(btrim(place.value #>> '{}')) > 100
  ) then
    raise exception 'Every location needs between 1 and 100 characters'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
    cross join lateral jsonb_array_elements(
      coalesce(requested.value -> 'option_details', '[]'::jsonb)
    ) detail(value)
    where jsonb_array_length(coalesce(detail.value -> 'locations', '[]'::jsonb))
        > coalesce((detail.value ->> 'quantity')::integer, 1)
       or not exists (
         select 1
         from jsonb_array_elements_text(
           coalesce(requested.value -> 'option_ids', '[]'::jsonb)
         ) picked(value)
         where picked.value::bigint = (detail.value ->> 'option_id')::bigint
       )
  ) then
    raise exception 'An Option cannot have more locations than its quantity, and its details need it selected'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from (
      select requested.position, detail.value ->> 'option_id' as option_id, count(*) as detail_count
      from jsonb_array_elements(p_lots) with ordinality requested(value, position)
      cross join lateral jsonb_array_elements(
        coalesce(requested.value -> 'option_details', '[]'::jsonb)
      ) detail(value)
      group by requested.position, detail.value ->> 'option_id'
    ) detail_counts
    where detail_counts.detail_count > 1
  ) then
    raise exception 'Each Option can have its details only once per Lot'
      using errcode = '23505';
  end if;
$new$
);

select pg_temp.patch_function(
  'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure,
$old$      (requested.position - 1)::integer as display_order
    from normalized_rows requested$old$,
$new$      (requested.position - 1)::integer as display_order,
      case when requested.is_utility_building then null::jsonb
        else requested.value -> 'option_details'
      end as option_details
    from normalized_rows requested$new$
);

select pg_temp.patch_function(
  'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure,
$old$      insert into valtrim.lot_options (lot_id, plan_id, option_id)
      select v_lot_id, v_lot.plan_id, selected.option_id::bigint
      from jsonb_array_elements_text(v_lot.option_ids) selected(option_id)
      where not exists (
        select 1
        from valtrim.lot_options existing
        where existing.lot_id = v_lot_id
          and existing.option_id = selected.option_id::bigint
      );$old$,
$new$      insert into valtrim.lot_options (lot_id, plan_id, option_id, quantity, locations)
      select v_lot_id, v_lot.plan_id, wanted.option_id, wanted.quantity, wanted.locations
      from private.sequence_sheet_option_wants(v_lot.option_ids, v_lot.option_details) wanted
      where not exists (
        select 1
        from valtrim.lot_options existing
        where existing.lot_id = v_lot_id
          and existing.option_id = wanted.option_id
      );

      -- A save that sends no details leaves the quantity and locations of the kept Options as they are.
      if v_lot.option_details is not null then
        update valtrim.lot_options existing
        set quantity = wanted.quantity,
            locations = wanted.locations
        from private.sequence_sheet_option_wants(v_lot.option_ids, v_lot.option_details) wanted
        where existing.lot_id = v_lot_id
          and existing.option_id = wanted.option_id
          and (existing.quantity, existing.locations)
            is distinct from (wanted.quantity, wanted.locations);
      end if;$new$
);

-- Packages bill price x quantity ------------------------------------------------

-- A Draw Package line: the Options of the Lot.
select pg_temp.patch_function(
  'valtrim.prepare_package_draw()'::regprocedure,
$old$    select count(*), coalesce(sum(price.price), 0)$old$,
$new$    select count(*), coalesce(sum(price.price * selected.quantity), 0)$new$
);

-- The Options a Draw Package line bills are saved with their quantity.
select pg_temp.patch_function(
  'valtrim.populate_package_options()'::regprocedure,
$old$      option_price,
      option_not_applicable,$old$,
$new$      option_price,
      quantity,
      option_not_applicable,$new$
);

select pg_temp.patch_function(
  'valtrim.populate_package_options()'::regprocedure,
$old$      price.price,
      price.is_not_applicable,$old$,
$new$      price.price * selected.quantity,
      selected.quantity,
      price.is_not_applicable,$new$
);

-- An Options Package: the amount, the Retention and the WRAP of each row are for the whole quantity.
select pg_temp.patch_function(
  'private.create_options_package(bigint,jsonb,date,text)'::regprocedure,
$old$    option_price,
    option_not_applicable,$old$,
$new$    option_price,
    quantity,
    option_not_applicable,$new$
);

select pg_temp.patch_function(
  'private.create_options_package(bigint,jsonb,date,text)'::regprocedure,
$old$    price.price,
    price.is_not_applicable,$old$,
$new$    price.price * selected.quantity,
    selected.quantity,
    price.is_not_applicable,$new$
);

select pg_temp.patch_function(
  'private.create_options_package(bigint,jsonb,date,text)'::regprocedure,
$old$    round(price.price * v_retention_percentage / 100, 2),
    round(price.price * v_wrap_percentage / 100, 2)$old$,
$new$    round(price.price * selected.quantity * v_retention_percentage / 100, 2),
    round(price.price * selected.quantity * v_wrap_percentage / 100, 2)$new$
);

-- A price that moved is applied to every unit of the row.
select pg_temp.patch_function(
  'private.package_line_new_amounts(valtrim.package_draws)'::regprocedure,
$old$        then coalesce(current_price.price, billed.option_price)$old$,
$new$        then coalesce(current_price.price * billed.quantity, billed.option_price)$new$
);

notify pgrst, 'reload schema';

commit;
