-- An Option can be a credit: its price may be negative, and when it is billed it
-- is subtracted from the Draw it is charged with (Retention and WRAP are taken
-- from the reduced amount, like any other charge).
--
-- The money columns that carry an Option price (the price itself, its Package
-- snapshot and the Lot's Options total) move from the non-negative `amount`
-- domain to a plain numeric(14,2). Everything else keeps its rule: a Draw line's
-- gross, an invoice and a payment are still never negative, so a credit larger
-- than what its Draw bills for the Lot is rejected with a clear message instead
-- of a domain error.

begin;

alter table valtrim.option_prices
  alter column price type numeric(14,2),
  add constraint option_prices_price_range_check
    check (price between -999999999999.99 and 999999999999.99);

alter table valtrim.package_options
  alter column option_price type numeric(14,2),
  add constraint package_options_option_price_range_check
    check (option_price between -999999999999.99 and 999999999999.99);

alter table valtrim.package_draws
  alter column options_amount type numeric(14,2),
  add constraint package_draws_options_amount_range_check
    check (options_amount between -999999999999.99 and 999999999999.99);

comment on column valtrim.option_prices.price is
  'Option price in dollars. Negative for a credit that is subtracted when the Option is billed.';

-- Keep the current implementations and change only what this feature needs.
do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'valtrim.set_option_price(bigint,numeric)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    'or p_price < 0',
    'or p_price < -999999999999.99'
  );
  if v_updated = v_definition then
    raise exception 'set_option_price lower bound did not match the expected definition';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    'p_price::valtrim.amount',
    'p_price::numeric(14,2)'
  );
  if v_updated = v_definition then
    raise exception 'set_option_price casts did not match the expected definition';
  end if;

  execute v_updated;

  select pg_get_functiondef(
    'valtrim.prepare_package_draw()'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    'new.gross_amount := new.base_draw_amount + new.hardware_amount',
    $replacement$if new.base_draw_amount + new.hardware_amount
       + new.options_amount + new.utility_amount < 0 then
    raise exception 'The Options credit is larger than what this Draw bills for the Lot'
      using errcode = '23514';
  end if;

  new.gross_amount := new.base_draw_amount + new.hardware_amount$replacement$
  );
  if v_updated = v_definition then
    raise exception 'prepare_package_draw gross total did not match the expected definition';
  end if;

  execute v_updated;
end;
$migration$;

notify pgrst, 'reload schema';

commit;
