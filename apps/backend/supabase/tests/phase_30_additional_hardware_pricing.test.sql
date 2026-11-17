begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

select ok(
  not exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'valtrim.plan_prices'::regclass
      and constraint_record.contype = 'c'
      and pg_get_constraintdef(constraint_record.oid) ilike '%hardware_price%'
      and pg_get_constraintdef(constraint_record.oid) ilike '%base_price%'
  ),
  'Hardware Price is no longer capped by Plan Price'
);

select ok(coalesce((
  select procedure.prosrc not like '%p_hardware_price > p_base_price%'
    and procedure.prosrc like '%p_hardware_price > 999999999999.99%'
  from pg_proc procedure
  where procedure.oid = 'valtrim.set_plan_price(bigint,numeric,numeric)'::regprocedure
), false), 'Plan pricing accepts an independent additional Hardware Price');

select ok(coalesce((
  select procedure.prosrc like '%new.draw_base := new.base_price;%'
    and procedure.prosrc not like '%new.base_price - new.hardware_price%'
  from pg_proc procedure
  where procedure.oid = 'valtrim.prepare_package_draw()'::regprocedure
), false), 'Package Draws allocate the complete Plan Price');

select ok(
  exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'valtrim.package_draws'::regclass
      and constraint_record.conname = 'package_draws_plan_price_snapshot_check'
  ),
  'Package Draw snapshots enforce compatible Plan Price semantics'
);

select ok(coalesce((
  select pg_get_constraintdef(constraint_record.oid) ilike '%draw_base = base_price%'
    and pg_get_constraintdef(constraint_record.oid)
      ilike '%draw_base + hardware_price = base_price%'
  from pg_constraint constraint_record
  where constraint_record.conrelid = 'valtrim.package_draws'::regclass
    and constraint_record.conname = 'package_draws_plan_price_snapshot_check'
), false), 'The snapshot constraint preserves history and accepts the new complete Plan Price');

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.set_plan_price(bigint,numeric,numeric)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'valtrim.set_plan_price(bigint,numeric,numeric)',
    'execute'
  ),
  'Plan pricing RPC privileges remain unchanged'
);

select ok(
  col_description(
    'valtrim.plan_prices'::regclass,
    (
      select attribute.attnum
      from pg_attribute attribute
      where attribute.attrelid = 'valtrim.plan_prices'::regclass
        and attribute.attname = 'hardware_price'
    )
  ) like '%addition to the complete Plan Price%',
  'Hardware Price documents its additional-charge behavior'
);

select * from finish();

rollback;
