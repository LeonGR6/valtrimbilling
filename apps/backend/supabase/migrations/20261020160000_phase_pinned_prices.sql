-- A Phase keeps the price it was created with.
--
-- Until now a Plan or Option price was looked up by the Package date, so changing
-- a price changed what every Phase not yet billed would charge. Each Lot now
-- points at the Plan price (lots.plan_price_id) and each selected Option at the
-- Option price (lot_options.option_price_id) that were current when the Phase
-- was created. Packages bill the price the Lot points at; a price changed later
-- only reaches the Phases created after the change.
--
-- Rules kept by the triggers below:
--   * A new Lot takes the price its Phase already uses for that Plan (so adding
--     a row to an older Phase does not mix prices); otherwise the current one.
--   * Changing a Lot's Plan pins the new Plan's price the same way.
--   * A new selected Option takes the price the Phase already uses for it;
--     otherwise the current one. Editing a Phase keeps the Options it already
--     had, with their price.
--   * A Lot or Option with no pinned price (data from before this change that
--     had no price yet) keeps billing the price effective on the Package date.
--
-- Pinned price rows must not change, so setting a price twice in one day closes
-- the first row on that same day and opens a new one when anything points at it.

begin;

-- Pinned prices ------------------------------------------------------------

alter table valtrim.lots
  add column plan_price_id bigint,
  add constraint lots_plan_price_fkey
    foreign key (plan_price_id, plan_id)
    references valtrim.plan_prices (id, plan_id) on delete restrict;

alter table valtrim.lot_options
  add column option_price_id bigint,
  add constraint lot_options_option_price_fkey
    foreign key (option_price_id, option_id)
    references valtrim.option_prices (id, option_id) on delete restrict;

create index lots_plan_price_id_idx on valtrim.lots (plan_price_id)
  where plan_price_id is not null;
create index lot_options_option_price_id_idx on valtrim.lot_options (option_price_id)
  where option_price_id is not null;

comment on column valtrim.lots.plan_price_id is
  'Plan price this Lot bills. Pinned when the Lot is created; NULL only for older data that had no price yet.';
comment on column valtrim.lot_options.option_price_id is
  'Option price this selected Option bills. Pinned when the Option is selected; NULL only for older data that had no price yet.';

-- Both tables expose their columns one by one.
grant select (plan_price_id) on valtrim.lots to authenticated;
grant select (option_price_id) on valtrim.lot_options to authenticated;

-- Today's price of a Plan or Option: the one row still open.
create or replace function private.current_plan_price_id(p_plan_id bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select price.id
  from valtrim.plan_prices price
  where price.plan_id = p_plan_id
    and price.effective_to is null
$$;

create or replace function private.current_option_price_id(p_option_id bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select price.id
  from valtrim.option_prices price
  where price.option_id = p_option_id
    and price.effective_to is null
$$;

revoke all on function private.current_plan_price_id(bigint) from public, anon, authenticated;
revoke all on function private.current_option_price_id(bigint) from public, anon, authenticated;

create or replace function private.pin_lot_plan_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.plan_price_id is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.plan_id is not distinct from old.plan_id then
    return new;
  end if;

  select sibling.plan_price_id
  into new.plan_price_id
  from valtrim.lots sibling
  where sibling.phase_id = new.phase_id
    and sibling.plan_id = new.plan_id
    and sibling.id is distinct from new.id
    and sibling.plan_price_id is not null
  order by sibling.id
  limit 1;

  if new.plan_price_id is null then
    new.plan_price_id := private.current_plan_price_id(new.plan_id);
  end if;
  return new;
end;
$$;

create trigger lots_pin_plan_price
  before insert or update of plan_id on valtrim.lots
  for each row execute function private.pin_lot_plan_price();

create or replace function private.pin_lot_option_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.option_price_id is not null then
    return new;
  end if;

  select sibling.option_price_id
  into new.option_price_id
  from valtrim.lots own_lot
  join valtrim.lots sibling_lot on sibling_lot.phase_id = own_lot.phase_id
  join valtrim.lot_options sibling
    on sibling.lot_id = sibling_lot.id
   and sibling.option_id = new.option_id
   and sibling.lot_id <> new.lot_id
   and sibling.option_price_id is not null
  where own_lot.id = new.lot_id
  order by sibling.lot_id
  limit 1;

  if new.option_price_id is null then
    new.option_price_id := private.current_option_price_id(new.option_id);
  end if;
  return new;
end;
$$;

create trigger lot_options_pin_option_price
  before insert on valtrim.lot_options
  for each row execute function private.pin_lot_option_price();

-- Existing Phases keep billing what they bill today: the current price.
update valtrim.lots lot
set plan_price_id = private.current_plan_price_id(lot.plan_id)
where lot.plan_price_id is null;

update valtrim.lot_options selected
set option_price_id = private.current_option_price_id(selected.option_id)
where selected.option_price_id is null;

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

-- Packages bill the pinned Plan price (Draw lines).
select pg_temp.patch_function(
  'valtrim.prepare_package_draw()'::regprocedure,
$old$
      and candidate.effective_from <= package.package_date
      and (
        candidate.effective_to is null
        or candidate.effective_to >= package.package_date
      )
    order by candidate.effective_from desc
    limit 1
  ) plan_price on true
$old$,
$new$
      and (
        candidate.id = lot.plan_price_id
        or (
          lot.plan_price_id is null
          and candidate.effective_from <= package.package_date
          and (
            candidate.effective_to is null
            or candidate.effective_to >= package.package_date
          )
        )
      )
    order by candidate.effective_from desc, candidate.id desc
    limit 1
  ) plan_price on true
$new$
);

-- ...and the pinned Option price (Options total of a Draw line).
select pg_temp.patch_function(
  'valtrim.prepare_package_draw()'::regprocedure,
$old$
      where candidate.option_id = selected.option_id
        and candidate.effective_from <= v_record.package_date
        and (
          candidate.effective_to is null
          or candidate.effective_to >= v_record.package_date
        )
      order by candidate.effective_from desc
      limit 1
    ) price on true
$old$,
$new$
      where candidate.option_id = selected.option_id
        and (
          candidate.id = selected.option_price_id
          or (
            selected.option_price_id is null
            and candidate.effective_from <= v_record.package_date
            and (
              candidate.effective_to is null
              or candidate.effective_to >= v_record.package_date
            )
          )
        )
      order by candidate.effective_from desc, candidate.id desc
      limit 1
    ) price on true
$new$
);

-- ...and the pinned Option price (Package Option snapshot).
select pg_temp.patch_function(
  'valtrim.populate_package_options()'::regprocedure,
$old$
      where candidate.option_id = selected.option_id
        and candidate.effective_from <= package.package_date
        and (
          candidate.effective_to is null
          or candidate.effective_to >= package.package_date
        )
      order by candidate.effective_from desc
      limit 1
    ) price on true
$old$,
$new$
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
$new$
);

-- Separate Hardware billed by Calendar event uses the pinned Plan price too.
select pg_temp.patch_function(
  'valtrim.prepare_package_hardware_line()'::regprocedure,
$old$
      and candidate.effective_from <= package.package_date
      and (
        candidate.effective_to is null
        or candidate.effective_to >= package.package_date
      )
    order by candidate.effective_from desc
    limit 1
  ) price on true
$old$,
$new$
      and (
        candidate.id = lot.plan_price_id
        or (
          lot.plan_price_id is null
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
$new$
);

select pg_temp.patch_function(
  'private.create_draw_invoice_package_with_hardware_events(bigint,jsonb,jsonb,date,text)'::regprocedure,
$old$
      and candidate.effective_from <= p_package_date
      and (
        candidate.effective_to is null
        or candidate.effective_to >= p_package_date
      )
    order by candidate.effective_from desc
    limit 1
  ) price on true
$old$,
$new$
      and (
        candidate.id = lot.plan_price_id
        or (
          lot.plan_price_id is null
          and candidate.effective_from <= p_package_date
          and (
            candidate.effective_to is null
            or candidate.effective_to >= p_package_date
          )
        )
      )
    order by candidate.effective_from desc, candidate.id desc
    limit 1
  ) price on true
$new$
);

-- Editing a Phase no longer deletes and re-adds every selected Option: the ones
-- it keeps stay as they were, with their price. A new Option needs a price.
select pg_temp.patch_function(
  'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure,
$old$
      delete from valtrim.lot_options selected
      where selected.lot_id = v_lot_id;
$old$,
$new$
      delete from valtrim.lot_options selected
      where selected.lot_id = v_lot_id
        and (
          selected.plan_id <> v_lot.plan_id
          or v_lot.is_utility_building
          or not exists (
            select 1
            from jsonb_array_elements_text(v_lot.option_ids) keep(option_id)
            where keep.option_id::bigint = selected.option_id
          )
        );
$new$
);

select pg_temp.patch_function(
  'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure,
$old$
      insert into valtrim.lot_options (lot_id, plan_id, option_id)
      select v_lot_id, v_lot.plan_id, selected.option_id::bigint
      from jsonb_array_elements_text(v_lot.option_ids) selected(option_id);
$old$,
$new$
      if exists (
        select 1
        from jsonb_array_elements_text(v_lot.option_ids) selected(option_id)
        where not exists (
          select 1
          from valtrim.lot_options existing
          where existing.lot_id = v_lot_id
            and existing.option_id = selected.option_id::bigint
        )
          and private.current_option_price_id(selected.option_id::bigint) is null
      ) then
        raise exception 'Every Option added to a Phase needs a price (a number or NA)'
          using errcode = '23514';
      end if;

      insert into valtrim.lot_options (lot_id, plan_id, option_id)
      select v_lot_id, v_lot.plan_id, selected.option_id::bigint
      from jsonb_array_elements_text(v_lot.option_ids) selected(option_id)
      where not exists (
        select 1
        from valtrim.lot_options existing
        where existing.lot_id = v_lot_id
          and existing.option_id = selected.option_id::bigint
      );
$new$
);

-- Setting a price twice in one day -----------------------------------------
-- When something already points at today's price, close it today and open a new
-- one instead of changing it in place. Two rows can then start on the same day.

select pg_temp.patch_function(
  'valtrim.prevent_price_overlap()'::regprocedure,
$old$
        and p.id <> coalesce(new.id, 0)
$old$,
$new$
        and p.id <> coalesce(new.id, 0)
        and p.effective_from <> new.effective_from
$new$,
  2
);

select pg_temp.patch_function(
  'valtrim.set_plan_price(bigint,numeric,numeric)'::regprocedure,
$old$
  elsif v_effective_from = current_date then
$old$,
$new$
  elsif v_effective_from = current_date and exists (
    select 1 from valtrim.lots where plan_price_id = v_current_id
    union all
    select 1 from valtrim.package_draws where plan_price_id = v_current_id
    union all
    select 1 from valtrim.package_hardware_lines where plan_price_id = v_current_id
  ) then
    update valtrim.plan_prices
    set effective_to = effective_from
    where id = v_current_id;

    insert into valtrim.plan_prices (
      plan_id,
      base_price,
      hardware_price,
      effective_from,
      created_by
    )
    values (
      p_plan_id,
      p_base_price::valtrim.amount,
      p_hardware_price::valtrim.amount,
      current_date,
      v_actor_id
    )
    returning id into v_current_id;
  elsif v_effective_from = current_date then
$new$
);

select pg_temp.patch_function(
  'valtrim.set_option_price(bigint,numeric,boolean)'::regprocedure,
$old$
  elsif v_effective_from = current_date then
$old$,
$new$
  elsif v_effective_from = current_date and exists (
    select 1 from valtrim.lot_options where option_price_id = v_current_id
    union all
    select 1 from valtrim.package_options where option_price_id = v_current_id
  ) then
    update valtrim.option_prices
    set effective_to = effective_from
    where id = v_current_id;

    insert into valtrim.option_prices (
      option_id,
      price,
      is_not_applicable,
      effective_from,
      created_by
    )
    values (
      p_option_id,
      v_price,
      v_not_applicable,
      current_date,
      v_actor_id
    )
    returning id into v_current_id;
  elsif v_effective_from = current_date then
$new$
);

commit;
