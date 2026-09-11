begin;

create extension if not exists pgtap with schema extensions;

select plan(40);

select has_table('valtrim', 'draw_packages', 'Draw Packages table is available');
select has_table('valtrim', 'invoices', 'Invoices table is available');
select has_table('valtrim', 'package_draws', 'Package Draw snapshots are available');
select has_table('valtrim', 'package_options', 'Package Option snapshots are available');

select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.draw_packages'::regclass),
  'Draw Packages have RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.invoices'::regclass),
  'Invoices have RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.package_draws'::regclass),
  'Package Draw snapshots have RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.package_options'::regclass),
  'Package Option snapshots have RLS enabled'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.draw_packages', 'id', 'select'),
  'Authenticated users can select Package identities subject to RLS'
);
select ok(
  has_column_privilege(
    'authenticated', 'valtrim.draw_packages', 'workflow_status', 'select'
  ),
  'Authenticated users can select Package workflow status subject to RLS'
);
select ok(
  not has_column_privilege(
    'authenticated', 'valtrim.draw_packages', 'quickbooks_status', 'select'
  )
  and not has_column_privilege(
    'authenticated', 'valtrim.draw_packages', 'quickbooks_reference', 'select'
  ),
  'QuickBooks fields stay unavailable to browser clients'
);
select ok(
  not has_table_privilege('authenticated', 'valtrim.draw_packages', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.draw_packages', 'update')
  and not has_table_privilege('authenticated', 'valtrim.draw_packages', 'delete'),
  'Browser clients cannot mutate Draw Packages directly'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.invoices', 'net_amount', 'select'),
  'Authenticated users can select calculated Invoices subject to RLS'
);
select ok(
  not has_column_privilege('authenticated', 'valtrim.invoices', 'created_by', 'select')
  and not has_column_privilege('authenticated', 'valtrim.invoices', 'updated_by', 'select'),
  'Invoice audit columns stay unavailable to browser clients'
);
select ok(
  not has_table_privilege('authenticated', 'valtrim.invoices', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.invoices', 'update')
  and not has_table_privilege('authenticated', 'valtrim.invoices', 'delete'),
  'Browser clients cannot mutate Invoices directly'
);
select ok(
  has_column_privilege(
    'authenticated', 'valtrim.package_draws', 'gross_amount', 'select'
  ),
  'Authenticated users can select immutable Draw snapshots subject to RLS'
);
select ok(
  not has_column_privilege(
    'authenticated', 'valtrim.package_draws', 'plan_price_id', 'select'
  ),
  'Internal Draw snapshot foreign keys stay unavailable to browser clients'
);
select ok(
  not has_table_privilege('authenticated', 'valtrim.package_draws', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.package_draws', 'update')
  and not has_table_privilege('authenticated', 'valtrim.package_draws', 'delete'),
  'Browser clients cannot mutate Draw snapshots directly'
);
select ok(
  has_column_privilege(
    'authenticated', 'valtrim.package_options', 'option_price', 'select'
  ),
  'Authenticated users can select immutable Option snapshots subject to RLS'
);
select ok(
  not has_column_privilege(
    'authenticated', 'valtrim.package_options', 'option_price_id', 'select'
  ),
  'Internal Option price identities stay unavailable to browser clients'
);
select ok(
  not has_table_privilege('authenticated', 'valtrim.package_options', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.package_options', 'update')
  and not has_table_privilege('authenticated', 'valtrim.package_options', 'delete'),
  'Browser clients cannot mutate Option snapshots directly'
);

select ok(
  not has_sequence_privilege('authenticated', 'valtrim.draw_packages_id_seq', 'usage')
  and not has_sequence_privilege('authenticated', 'valtrim.invoices_id_seq', 'usage'),
  'Only the atomic creator can allocate Package and Invoice identities'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.create_draw_invoice_package(bigint,smallint[],bigint[],date,date,date,text)',
    'execute'
  ),
  'Authenticated users can call the role-checked Package creator'
);
select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.set_draw_package_workflow_status(bigint,valtrim.package_workflow_status)',
    'execute'
  ),
  'Authenticated users can call the role-checked status updater'
);
select ok(
  not has_function_privilege(
    'anon',
    'valtrim.create_draw_invoice_package(bigint,smallint[],bigint[],date,date,date,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'valtrim.set_draw_package_workflow_status(bigint,valtrim.package_workflow_status)',
    'execute'
  ),
  'Anonymous clients cannot call Package mutation RPCs'
);

select ok(
  (
    select prosecdef
    from pg_proc
    where oid = 'private.create_draw_invoice_package(bigint,smallint[],bigint[],date,date,date,text)'::regprocedure
  )
  and (
    select prosecdef
    from pg_proc
    where oid = 'private.set_draw_package_workflow_status(bigint,valtrim.package_workflow_status)'::regprocedure
  ),
  'Private Package mutation implementations use definer rights after role checks'
);
select ok(
  not (
    select prosecdef
    from pg_proc
    where oid = 'valtrim.create_draw_invoice_package(bigint,smallint[],bigint[],date,date,date,text)'::regprocedure
  )
  and not (
    select prosecdef
    from pg_proc
    where oid = 'valtrim.set_draw_package_workflow_status(bigint,valtrim.package_workflow_status)'::regprocedure
  ),
  'Exposed Package RPC wrappers run as the caller'
);
select ok(
  coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'private.create_draw_invoice_package(bigint,smallint[],bigint[],date,date,date,text)'::regprocedure
  ), false)
  and coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'private.set_draw_package_workflow_status(bigint,valtrim.package_workflow_status)'::regprocedure
  ), false),
  'Private Package mutation implementations pin an empty search path'
);

select set_eq(
  $$
    select enum_value::text
    from unnest(enum_range(null::valtrim.package_workflow_status)) enum_value
  $$,
  $$ values
    ('DRAFT'),
    ('READY_TO_SUBMIT'),
    ('AWAITING_PAYMENT'),
    ('PAID_CLOSED')
  $$,
  'Package status contains exactly the four operational states'
);

select set_eq(
  $$
    select tablename || ':' || policyname
    from pg_policies
    where schemaname = 'valtrim'
      and tablename in (
        'draw_packages', 'invoices', 'package_draws', 'package_options'
      )
  $$,
  $$ values
    ('draw_packages:draw_packages_select'),
    ('invoices:invoices_select'),
    ('package_draws:package_draws_select'),
    ('package_options:package_options_select')
  $$,
  'Opened Draw & Invoice tables expose only active-user read policies'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.draw_packages'::regclass
      and conname = 'draw_packages_status_changed_by_fkey'
      and contype = 'f'
  ),
  'Package status actor has an application-user foreign key'
);
select has_index(
  'valtrim',
  'draw_packages',
  'draw_packages_workflow_status_idx',
  'Package workflow status has a lookup index'
);
select has_index(
  'valtrim',
  'draw_packages',
  'draw_packages_status_changed_by_idx',
  'Package status actor audit foreign key is indexed'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'valtrim.draw_packages'::regclass
      and tgname = 'draw_packages_validate_workflow_status'
      and not tgisinternal
  ),
  'Package status changes retain database validation'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.draw_package_overview', 'select'),
  'Aggregate Package view stays closed in this direct-repository phase'
);
select ok(
  not has_table_privilege('authenticated', 'valtrim.package_documents', 'select')
  and not has_table_privilege('authenticated', 'valtrim.package_documents', 'insert'),
  'Package documents and uploads remain closed'
);
select ok(
  not has_table_privilege('authenticated', 'valtrim.invoice_payments', 'select')
  and not has_table_privilege('authenticated', 'valtrim.invoice_payments', 'insert'),
  'Invoice payment records remain closed'
);
select ok(
  not has_table_privilege('authenticated', 'valtrim.service_requests', 'select'),
  'Customer Service remains closed'
);
select ok(
  not has_function_privilege(
    'authenticated', 'valtrim.issue_invoice(bigint,text,date,uuid)', 'execute'
  ),
  'Invoice issuance stays closed'
);
select ok(
  not has_function_privilege(
    'authenticated', 'valtrim.submit_draw_package(bigint,uuid)', 'execute'
  ),
  'Package submission integration stays closed'
);

select * from finish();

rollback;
