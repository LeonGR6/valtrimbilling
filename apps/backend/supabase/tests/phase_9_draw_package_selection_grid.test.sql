begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

select ok(
  to_regprocedure(
    'valtrim.create_draw_invoice_package(bigint,smallint[],bigint[],date,date,date,text)'
  ) is null,
  'The Cartesian-product Package creator is no longer exposed'
);

select ok(
  to_regprocedure(
    'valtrim.create_draw_invoice_package(bigint,jsonb,date,date,date,text)'
  ) is not null,
  'The Package creator accepts exact Lot / Draw selections as JSONB'
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
  'The exposed Package creator is not overloaded'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.create_draw_invoice_package(bigint,jsonb,date,date,date,text)',
    'execute'
  ),
  'Authenticated users can call the role-checked exact-selection creator'
);

select ok(
  not has_function_privilege(
    'anon',
    'valtrim.create_draw_invoice_package(bigint,jsonb,date,date,date,text)',
    'execute'
  ),
  'Anonymous users cannot create a Package'
);

select ok(
  not (
    select prosecdef
    from pg_proc
    where oid = 'valtrim.create_draw_invoice_package(bigint,jsonb,date,date,date,text)'::regprocedure
  ),
  'The exposed Package creator runs as the caller'
);

select ok(
  (
    select prosecdef
    from pg_proc
    where oid = 'private.create_draw_invoice_package(bigint,jsonb,date,date,date,text)'::regprocedure
  ),
  'The private implementation owns the atomic insert after its role check'
);

select ok(
  coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'private.create_draw_invoice_package(bigint,jsonb,date,date,date,text)'::regprocedure
  ), false),
  'The private creator has an empty search path'
);

select ok(
  coalesce((
    select prosrc like '%jsonb_to_recordset(p_selections)%'
    from pg_proc
    where oid = 'private.create_draw_invoice_package(bigint,jsonb,date,date,date,text)'::regprocedure
  ), false),
  'The creator expands explicit selection records'
);

select ok(
  coalesce((
    select prosrc not like '%cross join%'
    from pg_proc
    where oid = 'private.create_draw_invoice_package(bigint,jsonb,date,date,date,text)'::regprocedure
  ), false),
  'The creator no longer builds a Cartesian product'
);

select ok(
  coalesce((
    select prosrc like '%v_inserted <> v_requested%'
    from pg_proc
    where oid = 'private.create_draw_invoice_package(bigint,jsonb,date,date,date,text)'::regprocedure
  ), false),
  'The creator verifies every requested cell was inserted'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.package_draws', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.package_draws', 'update')
  and not has_table_privilege('authenticated', 'valtrim.package_draws', 'delete'),
  'Calculated Package lines remain immutable to browser clients'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.set_draw_package_workflow_status(bigint,valtrim.package_workflow_status)',
    'execute'
  ),
  'The four-state Package workflow remains available'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.package_documents', 'select')
  and not has_column_privilege(
    'authenticated', 'valtrim.draw_packages', 'quickbooks_status', 'select'
  ),
  'Documents and QuickBooks remain outside the exposed slice'
);

select * from finish();

rollback;
