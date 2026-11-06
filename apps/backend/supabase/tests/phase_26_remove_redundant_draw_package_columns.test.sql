begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

select hasnt_column(
  'valtrim', 'draw_packages', 'billing_period_start',
  'Draw Packages no longer duplicate a billing period start'
);

select hasnt_column(
  'valtrim', 'draw_packages', 'billing_period_end',
  'Draw Packages no longer duplicate a billing period end'
);

select hasnt_column(
  'valtrim', 'draw_packages', 'payment_terms_days',
  'Draw Packages resolve payment terms from their immutable Billing Setup'
);

select hasnt_column(
  'valtrim', 'draw_packages', 'portal_name',
  'Draw Packages resolve the portal from their immutable Billing Setup'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'valtrim' and table_name = 'draw_packages'
      and column_name = 'submitted_at'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'valtrim' and table_name = 'draw_packages'
      and column_name = 'submitted_by'
  ),
  'Submission audit fields remain available for an actual submission'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'valtrim' and table_name = 'draw_packages'
      and column_name = 'created_at'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'valtrim' and table_name = 'draw_packages'
      and column_name = 'created_by'
  ),
  'Creation time and actor have dedicated audit fields'
);

select col_not_null(
  'valtrim', 'draw_packages', 'created_at',
  'Every Draw Package has a creation timestamp'
);

select ok(
  to_regprocedure(
    'valtrim.create_draw_package(bigint,smallint[],bigint[],date,date,date,text,uuid)'
  ) is null,
  'The obsolete single-Phase creator with billing period dates is removed'
);

select ok(
  to_regprocedure(
    'valtrim.create_draw_invoice_package(bigint,jsonb,date,date,date,text)'
  ) is null,
  'The former public Package creator with billing period dates is removed'
);

select ok(
  to_regprocedure(
    'valtrim.create_draw_invoice_package(bigint,jsonb,date,text)'
  ) is not null,
  'The public Package creator accepts no billing period dates'
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
  'PostgREST exposes one unambiguous Package creator'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.create_draw_invoice_package(bigint,jsonb,date,text)',
    'execute'
  ),
  'Authenticated application users can call the role-checked creator'
);

select ok(
  not has_function_privilege(
    'anon',
    'valtrim.create_draw_invoice_package(bigint,jsonb,date,text)',
    'execute'
  ),
  'Anonymous users cannot create Draw Packages'
);

select ok(not (
  select prosecdef
  from pg_proc
  where oid = 'valtrim.create_draw_invoice_package(bigint,jsonb,date,text)'::regprocedure
), 'The public Package creator remains security invoker');

select ok((
  select prosecdef
  from pg_proc
  where oid = 'private.create_draw_invoice_package(bigint,jsonb,date,text)'::regprocedure
), 'The private Package creator owns the atomic authorized transaction');

select ok(coalesce((
  select prosrc !~ 'p_period_start|p_period_end|billing_period_start|billing_period_end|payment_terms_days|portal_name'
  from pg_proc
  where oid = 'private.create_draw_invoice_package(bigint,jsonb,date,text)'::regprocedure
), false), 'Package creation contains no obsolete or duplicated fields');

select ok(coalesce((
  select prosrc !~ 'payment_terms_days|portal_name|billing_period_start|billing_period_end'
    and prosrc like '%new.invoice_line_format := v_line_format%'
  from pg_proc
  where oid = 'valtrim.prepare_draw_package()'::regprocedure
), false), 'Package validation retains only the required line-format snapshot');

select ok(coalesce((
  select prosrc like '%join valtrim.billing_setup_versions version%'
    and prosrc like '%version.payment_terms_days%'
    and prosrc not like '%from draw_packages where%'
  from pg_proc
  where oid = 'valtrim.prepare_invoice()'::regprocedure
), false), 'Invoice payment terms are resolved from the Package Billing Setup version');

select ok(coalesce((
  select prosrc like '%created_by, updated_by%'
    and prosrc like '%v_actor_id, v_actor_id%'
  from pg_proc
  where oid = 'private.create_draw_invoice_package(bigint,jsonb,date,text)'::regprocedure
), false), 'Package creation records the authenticated creator');

select ok(
  col_description(
    'valtrim.draw_packages'::regclass,
    (select attnum from pg_attribute
     where attrelid = 'valtrim.draw_packages'::regclass
       and attname = 'submitted_at')
  ) like '%actually submitted%'
  and col_description(
    'valtrim.draw_packages'::regclass,
    (select attnum from pg_attribute
     where attrelid = 'valtrim.draw_packages'::regclass
       and attname = 'created_at')
  ) like '%created%',
  'Database comments distinguish creation from submission audit data'
);

select * from finish();

rollback;
