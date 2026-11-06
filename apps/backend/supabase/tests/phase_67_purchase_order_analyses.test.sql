begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

select has_table('valtrim', 'purchase_order_analyses',
  'Each Purchase Order document has one analysis');
select has_table('valtrim', 'purchase_order_lines',
  'The option lines of a Purchase Order are stored');
select has_table('valtrim', 'purchase_order_aliases',
  'Phase and Plan names matched by a reviewer are remembered per Job');
select has_view('valtrim', 'purchase_order_current_lines',
  'The latest revision of each Lot option is a view');

select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.purchase_order_analyses'::regclass)
  and (select relrowsecurity from pg_class where oid = 'valtrim.purchase_order_lines'::regclass)
  and (select relrowsecurity from pg_class where oid = 'valtrim.purchase_order_aliases'::regclass),
  'Purchase Order tables have RLS enabled'
);

select ok(
  has_table_privilege('authenticated', 'valtrim.purchase_order_analyses', 'select')
  and has_table_privilege('authenticated', 'valtrim.purchase_order_lines', 'select')
  and has_table_privilege('authenticated', 'valtrim.purchase_order_aliases', 'select'),
  'Signed-in users can read Purchase Order analyses subject to RLS'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.purchase_order_analyses', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.purchase_order_analyses', 'update')
  and not has_table_privilege('authenticated', 'valtrim.purchase_order_analyses', 'delete')
  and not has_table_privilege('authenticated', 'valtrim.purchase_order_lines', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.purchase_order_lines', 'update')
  and not has_table_privilege('authenticated', 'valtrim.purchase_order_lines', 'delete')
  and not has_table_privilege('authenticated', 'valtrim.purchase_order_aliases', 'insert'),
  'Browser clients cannot write Purchase Order tables directly'
);

select ok(
  not has_table_privilege('anon', 'valtrim.purchase_order_analyses', 'select')
  and not has_table_privilege('anon', 'valtrim.purchase_order_lines', 'select')
  and not has_table_privilege('anon', 'valtrim.purchase_order_aliases', 'select')
  and not has_table_privilege('anon', 'valtrim.purchase_order_current_lines', 'select'),
  'Anonymous clients cannot read Purchase Order data'
);

select ok(
  has_table_privilege('service_role', 'valtrim.purchase_order_analyses', 'insert')
  and has_table_privilege('service_role', 'valtrim.purchase_order_lines', 'insert'),
  'The analyze Edge Function writes as service_role'
);

select col_is_unique('valtrim', 'purchase_order_analyses', 'job_document_id',
  'A document has a single analysis');

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.purchase_order_analyses'::regclass
      and contype = 'f'
      and confrelid = 'valtrim.job_documents'::regclass
      and confdeltype = 'c'
  ),
  'Deleting the PDF deletes its analysis'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.purchase_order_lines'::regclass
      and contype = 'f'
      and confrelid = 'valtrim.purchase_order_analyses'::regclass
      and confdeltype = 'c'
  ),
  'Deleting an analysis deletes its lines'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'valtrim.purchase_order_analyses'::regclass
      and tgname = 'purchase_order_analyses_sync_document'
      and not tgisinternal
  ),
  'The analysis takes its Job from the document and only accepts Purchase Orders'
);

select ok(
  pg_get_functiondef('private.sync_purchase_order_analysis_document()'::regprocedure)
    like '%PURCHASE_ORDER%',
  'Only PURCHASE_ORDER documents can be analyzed as Purchase Orders'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.purchase_order_lines'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%plan_mismatch%lot_not_found%'
  ),
  'A line records how its header matched the Job'
);

select has_index('valtrim', 'purchase_order_lines',
  'purchase_order_lines_job_lot_option_idx',
  'Lines are indexed by Job, Lot and option code');

select ok(
  has_function_privilege(
    'service_role',
    'valtrim.save_purchase_order_analysis(uuid,text,jsonb,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'valtrim.save_purchase_order_analysis(uuid,text,jsonb,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'valtrim.save_purchase_order_analysis(uuid,text,jsonb,jsonb)',
    'execute'
  ),
  'Only the Edge Function can save an analysis'
);

select ok(
  (select prosecdef from pg_proc
    where oid = 'valtrim.save_purchase_order_analysis(uuid,text,jsonb,jsonb)'::regprocedure),
  'Saving an analysis replaces the lines through its own authorization boundary'
);

select ok(
  has_function_privilege('authenticated', 'valtrim.compare_purchase_orders(bigint)', 'execute')
  and has_function_privilege('authenticated', 'valtrim.purchase_order_uncovered_options(bigint)', 'execute')
  and not has_function_privilege('anon', 'valtrim.compare_purchase_orders(bigint)', 'execute')
  and not has_function_privilege('anon', 'valtrim.purchase_order_uncovered_options(bigint)', 'execute'),
  'Signed-in users compare Purchase Orders with the system; anonymous clients cannot'
);

select ok(
  not (select prosecdef from pg_proc
    where oid = 'valtrim.compare_purchase_orders(bigint)'::regprocedure)
  and not (select prosecdef from pg_proc
    where oid = 'valtrim.purchase_order_uncovered_options(bigint)'::regprocedure),
  'The comparison runs with the caller''s own permissions'
);

select is(
  private.option_code_key('2fin-5006 '),
  '2FIN5006',
  'An option code is compared without case or separators'
);

select ok(
  pg_get_functiondef('valtrim.compare_purchase_orders(bigint)'::regprocedure)
    like '%selected.option_price_id%'
  and pg_get_functiondef('valtrim.compare_purchase_orders(bigint)'::regprocedure)
    like '%open_price%',
  'The system price is the one the Lot bills: its pinned price, else today''s'
);

select * from finish();

rollback;
