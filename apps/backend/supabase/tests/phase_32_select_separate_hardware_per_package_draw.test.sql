begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

select ok(
  not exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'valtrim.billing_setup_versions'::regclass
      and constraint_record.contype = 'c'
      and pg_get_constraintdef(constraint_record.oid)
        ilike '%separate_hardware_price%hardware_billing_draw_number%'
  ),
  'Separate Hardware no longer requires one fixed Builder Setup Draw'
);

select has_function(
  'private',
  'package_hardware_charge_is_selected',
  array['bigint', 'smallint'],
  'A private helper resolves per-Package Hardware selections'
);

select lives_ok(
  $$select set_config(
    'valtrim.draw_package_hardware_charge',
    '[{"lot_id":41,"draw_number":2,"charge_hardware":true}]',
    true
  )$$,
  'A transaction can provide explicit Hardware selections'
);

select ok(
  private.package_hardware_charge_is_selected(41, 2),
  'The selected Lot and Draw charges Hardware'
);

select ok(
  not private.package_hardware_charge_is_selected(41, 1)
  and not private.package_hardware_charge_is_selected(42, 2),
  'Other Draw and Lot cells do not charge Hardware'
);

select ok(coalesce((
  select procedure.prosrc like '%new.draw_base := new.base_price;%'
    and procedure.prosrc like '%package_hardware_charge_is_selected%'
    and procedure.prosrc like '%Hardware for this Lot was already billed%'
    and procedure.prosrc not like '%hardware_billing_draw_number%'
  from pg_proc procedure
  where procedure.oid = 'valtrim.prepare_package_draw()'::regprocedure
), false), 'Package Draw calculation uses the complete Plan Price and explicit Hardware selection');

select ok(coalesce((
  select procedure.prosrc like '%valtrim.draw_package_hardware_charge%'
    and procedure.prosrc like '%p_selections::text%'
  from pg_proc procedure
  where procedure.oid = 'private.create_draw_invoice_package(bigint,jsonb,date,text)'::regprocedure
), false), 'Package creation forwards its exact Hardware selections to the snapshot trigger');

select ok(coalesce((
  select procedure.prosrc like '%valtrim.draw_package_hardware_charge%'
    and procedure.prosrc like '%coalesce(p_selections, ''[]''::jsonb)::text%'
  from pg_proc procedure
  where procedure.oid = 'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,text)'::regprocedure
), false), 'Package corrections preserve explicit Hardware selections');

select ok(coalesce((
  select procedure.prosrc like '%hardware_billing_draw_number = null%'
    and procedure.prosrc not like '%hardwareBillingDrawNumber%'
  from pg_proc procedure
  where procedure.oid = 'valtrim.save_billing_setup_version(bigint,jsonb,jsonb,jsonb,bigint,uuid)'::regprocedure
), false), 'New Builder Setup versions no longer persist a fixed Hardware Draw');

select * from finish();

rollback;
