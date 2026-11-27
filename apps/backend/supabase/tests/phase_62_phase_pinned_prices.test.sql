begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

select has_column('valtrim', 'lots', 'plan_price_id',
  'A Lot points at the Plan price it bills');
select has_column('valtrim', 'lot_options', 'option_price_id',
  'A selected Option points at the Option price it bills');

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.lots'::regclass
      and conname = 'lots_plan_price_fkey'
      and contype = 'f'
      and confrelid = 'valtrim.plan_prices'::regclass
  ),
  'A Lot price must be a price of the Lot Plan'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.lot_options'::regclass
      and conname = 'lot_options_option_price_fkey'
      and contype = 'f'
      and confrelid = 'valtrim.option_prices'::regclass
  ),
  'A selected Option price must be a price of that Option'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.lots', 'plan_price_id', 'select')
  and has_column_privilege('authenticated', 'valtrim.lot_options', 'option_price_id', 'select')
  and not has_column_privilege('authenticated', 'valtrim.lots', 'plan_price_id', 'update')
  and not has_column_privilege('authenticated', 'valtrim.lot_options', 'option_price_id', 'update'),
  'The browser can read pinned prices but never change them'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'valtrim.lots'::regclass
      and tgname = 'lots_pin_plan_price'
      and not tgisinternal
  ),
  'A new Lot, or a Lot that changes Plan, pins a Plan price'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'valtrim.lot_options'::regclass
      and tgname = 'lot_options_pin_option_price'
      and not tgisinternal
  ),
  'A newly selected Option pins an Option price'
);

select ok(
  not has_function_privilege('authenticated', 'private.current_plan_price_id(bigint)', 'execute')
  and not has_function_privilege('authenticated', 'private.current_option_price_id(bigint)', 'execute'),
  'The current-price helpers are not callable from the browser'
);

select ok(
  pg_get_functiondef('valtrim.prepare_package_draw()'::regprocedure)
    like '%candidate.id = lot.plan_price_id%'
  and pg_get_functiondef('valtrim.prepare_package_draw()'::regprocedure)
    like '%candidate.id = selected.option_price_id%',
  'A Draw line bills the pinned Plan and Option prices'
);

select ok(
  pg_get_functiondef('valtrim.populate_package_options()'::regprocedure)
    like '%candidate.id = selected.option_price_id%',
  'A Package Option snapshot takes the pinned Option price'
);

select ok(
  pg_get_functiondef('valtrim.prepare_package_hardware_line()'::regprocedure)
    like '%candidate.id = lot.plan_price_id%',
  'A Separate Hardware event line bills the pinned Plan price'
);

select ok(
  pg_get_functiondef(
    'private.create_draw_invoice_package_with_hardware_events(bigint,jsonb,jsonb,date,text)'::regprocedure
  ) like '%candidate.id = lot.plan_price_id%',
  'The Hardware event Package entry point resolves the pinned Plan price'
);

select ok(
  pg_get_functiondef('valtrim.populate_package_options()'::regprocedure)
    like '%selected.option_price_id is null%'
  and pg_get_functiondef('valtrim.prepare_package_draw()'::regprocedure)
    like '%lot.plan_price_id is null%',
  'Older rows with no pinned price keep billing the price effective on the Package date'
);

select ok(
  pg_get_functiondef(
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure
  ) like '%Every Option added to a Phase needs a price%',
  'An Option without a price cannot be added to a Phase'
);

select ok(
  pg_get_functiondef(
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure
  ) like '%not exists (%keep(option_id)%',
  'Editing a Phase keeps the Options it already had instead of re-adding them'
);

select ok(
  pg_get_functiondef('valtrim.set_plan_price(bigint,numeric,numeric)'::regprocedure)
    like '%set effective_to = effective_from%'
  and pg_get_functiondef('valtrim.set_option_price(bigint,numeric,boolean)'::regprocedure)
    like '%set effective_to = effective_from%',
  'A price that something points at is closed the same day instead of rewritten'
);

select ok(
  pg_get_functiondef('valtrim.prevent_price_overlap()'::regprocedure)
    like '%p.effective_from <> new.effective_from%',
  'Two prices can start on the same day when the first was closed that day'
);

select is(
  (
    select count(*)::integer
    from valtrim.lots lot
    where lot.plan_price_id is null
      and exists (
        select 1 from valtrim.plan_prices price
        where price.plan_id = lot.plan_id and price.effective_to is null
      )
  ),
  0,
  'Every existing Lot whose Plan has a price is pinned to it'
);

select is(
  (
    select count(*)::integer
    from valtrim.lot_options selected
    where selected.option_price_id is null
      and exists (
        select 1 from valtrim.option_prices price
        where price.option_id = selected.option_id and price.effective_to is null
      )
  ),
  0,
  'Every existing selected Option that has a price is pinned to it'
);

select ok(
  not exists (
    select 1
    from valtrim.lots lot
    join valtrim.plan_prices price on price.id = lot.plan_price_id
    where price.plan_id <> lot.plan_id
  ),
  'No Lot is pinned to the price of another Plan'
);

select * from finish();

rollback;
