begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

select ok(
  to_regprocedure(
    'private.package_option_charge_is_selected(bigint,smallint,bigint,bigint)'
  ) is not null,
  'Package Option charging has one internal predicate'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.package_option_charge_is_selected(bigint,smallint,bigint,bigint)',
    'execute'
  ),
  'Browser clients cannot call the internal charge predicate'
);

select is(
  (
    select provolatile::text
    from pg_proc
    where oid = 'private.package_option_charge_is_selected(bigint,smallint,bigint,bigint)'::regprocedure
  ),
  's',
  'The charge predicate is stable within one Package creation statement'
);

select is(
  (
    select count(*)::integer
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'valtrim'
      and procedure.proname = 'create_draw_invoice_package'
  ),
  1,
  'PostgREST still exposes one unambiguous Package creator'
);

select columns_are(
  'valtrim',
  'package_options',
  array[
    'package_id', 'lot_id', 'option_id', 'draw_id', 'option_price_id',
    'option_code', 'option_name', 'option_price', 'created_at',
    'billing_lot_id', 'phase_id', 'phase_code', 'building', 'lot_number',
    'plan_code'
  ],
  'Package Options preserve both origin and billing-line snapshots'
);

select fk_ok(
  'valtrim',
  'package_options',
  array['package_id', 'billing_lot_id', 'draw_id'],
  'valtrim',
  'package_draws',
  array['package_id', 'lot_id', 'draw_id'],
  'Each charged Option belongs to one current Package billing-Draw line'
);

select col_is_pk(
  'valtrim',
  'package_options',
  array['lot_id', 'option_id'],
  'A Lot Option can still be billed only once globally'
);

select ok(
  has_column_privilege(
    'authenticated', 'valtrim.package_options', 'phase_id', 'select'
  ) and has_column_privilege(
    'authenticated', 'valtrim.package_options', 'lot_number', 'select'
  ),
  'Authenticated readers can load the immutable origin Lot snapshot'
);

select ok(coalesce((
  select prosrc like '%Package Option selections must be a JSON array%'
    and prosrc like '%must have reached%Options billing Draw%'
    and prosrc like '%were already billed%'
    and prosrc like '%valtrim.draw_package_option_charge%'
  from pg_proc
  where oid = 'private.create_draw_invoice_package(bigint,jsonb,date,date,date,text)'::regprocedure
), false), 'The creator validates deferred, reached and previously billed Options');

select ok(coalesce((
  select prosrc like '%private.package_option_charge_is_selected(%'
  from pg_proc
  where oid = 'valtrim.prepare_package_draw()'::regprocedure
), false), 'Draw totals include only the Package Options assigned to the anchor');

select ok(coalesce((
  select prosrc like '%billing_lot_id%'
    and prosrc like '%private.package_option_charge_is_selected(%'
  from pg_proc
  where oid = 'valtrim.populate_package_options()'::regprocedure
), false), 'Option snapshots retain their origin Lot and anchor billing Lot');

select ok(
  private.package_option_charge_is_selected(7, 2::smallint, 7, 101),
  'Callers without an explicit payload retain same-Lot include-all behavior'
);

do $$
begin
  perform set_config(
    'valtrim.draw_package_option_charge',
    '{"anchor_lot_id":8,"anchor_draw_number":2,'
      || '"package_options":[{"lot_id":7,"option_id":101}]}',
    true
  );
end;
$$;

select ok(
  private.package_option_charge_is_selected(8, 2::smallint, 7, 101),
  'A pending Option from a previously reached Lot is assigned to the anchor'
);

select ok(
  not private.package_option_charge_is_selected(8, 2::smallint, 7, 102),
  'An Option omitted from the explicit Package list is excluded'
);

select ok(
  not private.package_option_charge_is_selected(9, 2::smallint, 7, 101),
  'A non-anchor Lot cannot duplicate the selected Option amount'
);

select * from finish();

rollback;
