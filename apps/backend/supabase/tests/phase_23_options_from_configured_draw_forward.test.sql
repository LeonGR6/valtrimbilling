begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

select ok(coalesce((
  select prosrc like '%v_record.draw_number = v_record.options_billing_draw_number%'
    and prosrc like '%current_setting(''valtrim.draw_package_option_charge'', true)%'
  from pg_proc
  where oid = 'valtrim.prepare_package_draw()'::regprocedure
), false), 'Draw totals support an explicit Option charge after the configured Draw');

select ok(coalesce((
  select prosrc like '%new.draw_number = (%'
    and prosrc like '%current_setting(''valtrim.draw_package_option_charge'', true)%'
  from pg_proc
  where oid = 'valtrim.populate_package_options()'::regprocedure
), false), 'Option snapshots support an explicit later-Draw anchor');

select ok(coalesce((
  select prosrc like '%(item->>''draw_number'')::smallint%< v_options_billing_draw_number%'
  from pg_proc
  where oid = 'private.create_draw_invoice_package(bigint,jsonb,date,date,date,text)'::regprocedure
), false), 'The Package creator rejects Option anchors only before the configured Draw');

select ok(coalesce((
  select prosrc like '%current_selection.draw_number >= v_options_billing_draw_number%'
  from pg_proc
  where oid = 'private.create_draw_invoice_package(bigint,jsonb,date,date,date,text)'::regprocedure
), false), 'A currently selected Lot is eligible at or after its configured Draw');

select ok(coalesce((
  select prosrc like '%prior_line.draw_number%>= prior_version.options_billing_draw_number%'
  from pg_proc
  where oid = 'private.create_draw_invoice_package(bigint,jsonb,date,date,date,text)'::regprocedure
), false), 'A Lot used by a prior Package remains eligible after its configured Draw');

select ok(coalesce((
  select prosrc like '%reached or passed the Options billing Draw%'
    and prosrc like '%One or more selected Options were already billed%'
  from pg_proc
  where oid = 'private.create_draw_invoice_package(bigint,jsonb,date,date,date,text)'::regprocedure
), false), 'The creator enforces reached-Draw eligibility and one-time billing');

select is(
  (
    select count(*)::integer
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'valtrim'
      and procedure.proname = 'create_draw_invoice_package'
  ),
  1,
  'PostgREST exposes one unambiguous Package creator'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.package_option_charge_is_selected(bigint,smallint,bigint,bigint)',
    'execute'
  ),
  'Browser clients still cannot call the internal Option charge predicate'
);

do $$
begin
  perform set_config(
    'valtrim.draw_package_option_charge',
    '{"anchor_lot_id":8,"anchor_draw_number":3,'
      || '"package_options":[{"lot_id":7,"option_id":101}]}',
    true
  );
end;
$$;

select ok(
  private.package_option_charge_is_selected(8, 3::smallint, 7, 101),
  'A later selected Draw can carry a pending Option from another eligible Lot'
);

select ok(
  not private.package_option_charge_is_selected(8, 3::smallint, 7, 102),
  'A pending Option omitted from the Package remains unbilled'
);

select * from finish();

rollback;
