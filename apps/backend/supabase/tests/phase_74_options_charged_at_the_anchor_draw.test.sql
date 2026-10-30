begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

select has_function('valtrim', 'prepare_package_draw', array[]::text[],
  'The amounts of a Package line are still calculated by one trigger function');

select ok(
  pg_get_functiondef('valtrim.prepare_package_draw()'::regprocedure)
    like '%v_record.draw_number = v_record.options_billing_draw_number%',
  'The exact Options billing Draw still collects its Options when nothing says otherwise'
);

select ok(
  pg_get_functiondef('valtrim.prepare_package_draw()'::regprocedure)
    like '%nullif(current_setting(''valtrim.draw_package_option_charge'', true), '''') is not null%',
  'A Package that names the line carrying its Options adds them there, on any Draw at or after the Options Draw'
);

select ok(
  pg_get_functiondef('valtrim.populate_package_options()'::regprocedure)
    like '%nullif(%current_setting(''valtrim.draw_package_option_charge'', true), ''''%is not null%',
  'The Options are saved on the same line the amounts are calculated on'
);

select ok(
  pg_get_functiondef('private.create_draw_invoice_package(bigint,jsonb,date,text)'::regprocedure)
    like '%do not add up to what its lines bill%',
  'A Package whose saved Options do not add up to its lines is not created'
);

select * from finish();

rollback;
