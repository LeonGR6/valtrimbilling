begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

select ok(to_regclass('valtrim.draw_package_corrections') is not null,
  'Package corrections have one audit table');

select ok((select relrowsecurity from pg_class
  where oid = 'valtrim.draw_package_corrections'::regclass),
  'Correction history has RLS');

select ok(has_column_privilege('authenticated',
  'valtrim.draw_package_corrections', 'id', 'select'),
  'Active authenticated users can read correction history');

select ok(not has_table_privilege('authenticated',
  'valtrim.draw_package_corrections', 'insert')
  and not has_table_privilege('authenticated',
    'valtrim.draw_package_corrections', 'update')
  and not has_table_privilege('authenticated',
    'valtrim.draw_package_corrections', 'delete'),
  'Browser users cannot write correction history directly');

select ok(not has_table_privilege('authenticated',
  'valtrim.package_draws', 'delete')
  and not has_table_privilege('authenticated',
    'valtrim.package_options', 'delete'),
  'Calculated lines still have no direct browser DELETE grant');

select ok(coalesce((select tgtype::integer & 8 <> 0
  from pg_trigger where tgrelid = 'valtrim.package_draws'::regclass
    and tgname = 'package_draws_recalculate_invoice'), false),
  'Deleting a Draw cell recalculates draft Invoice totals');

select ok(has_function_privilege('authenticated',
  'valtrim.edit_draw_invoice_package(bigint,jsonb,text,date,date,text)', 'execute'),
  'The role-checked edit RPC is callable');

select ok(has_function_privilege('authenticated',
  'valtrim.transfer_draw_package_cells(bigint,bigint,jsonb,text)', 'execute'),
  'The role-checked transfer RPC is callable');

select ok(has_function_privilege('authenticated',
  'valtrim.cancel_draw_invoice_package(bigint,text)', 'execute'),
  'The role-checked cancel RPC is callable');

select ok(not has_function_privilege('anon',
  'valtrim.edit_draw_invoice_package(bigint,jsonb,text,date,date,text)', 'execute')
  and not has_function_privilege('anon',
    'valtrim.transfer_draw_package_cells(bigint,bigint,jsonb,text)', 'execute')
  and not has_function_privilege('anon',
    'valtrim.cancel_draw_invoice_package(bigint,text)', 'execute'),
  'Anonymous users cannot correct Packages');

select ok(not (select prosecdef from pg_proc where oid =
  'valtrim.edit_draw_invoice_package(bigint,jsonb,text,date,date,text)'::regprocedure)
  and not (select prosecdef from pg_proc where oid =
    'valtrim.transfer_draw_package_cells(bigint,bigint,jsonb,text)'::regprocedure)
  and not (select prosecdef from pg_proc where oid =
    'valtrim.cancel_draw_invoice_package(bigint,text)'::regprocedure),
  'Public RPC wrappers use the caller privileges');

select ok((select prosecdef from pg_proc where oid =
  'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,date,date,text)'::regprocedure),
  'The private role-checked correction implementation owns the transaction');

select ok(coalesce((select proconfig @> array['search_path=""']
  from pg_proc where oid =
  'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,date,date,text)'::regprocedure), false),
  'The private implementation has an empty search path');

select ok(coalesce((select prosrc like '%perform 1 from valtrim.phases%for update%'
  from pg_proc where oid =
  'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,date,date,text)'::regprocedure), false),
  'Corrections lock the Phase before Packages');

select ok(coalesce((select prosrc like '%where occupied.package_id <> p_package_id%'
  from pg_proc where oid =
  'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,date,date,text)'::regprocedure), false),
  'An edit rejects cells occupied by another Package');

select ok(coalesce((select prosrc like '%v_source_remaining = 0%'
  from pg_proc where oid =
  'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,date,date,text)'::regprocedure), false),
  'A transfer automatically cancels an emptied source');

select ok(not has_column_privilege('authenticated',
  'valtrim.draw_packages', 'quickbooks_status', 'select')
  and not has_table_privilege('authenticated',
    'valtrim.package_documents', 'select'),
  'QuickBooks and document internals remain outside the browser slice');

select * from finish();

rollback;
