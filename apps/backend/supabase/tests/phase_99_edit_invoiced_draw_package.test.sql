begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select has_function(
  'valtrim', 'edit_invoiced_draw_package',
  array['uuid', 'bigint', 'jsonb', 'jsonb', 'jsonb', 'text', 'text', 'boolean'],
  'A Package waiting for payment can be edited through one function'
);

select ok(
  not has_function_privilege('authenticated', 'valtrim.edit_invoiced_draw_package(uuid,bigint,jsonb,jsonb,jsonb,text,text,boolean)', 'execute')
  and not has_function_privilege('anon', 'valtrim.edit_invoiced_draw_package(uuid,bigint,jsonb,jsonb,jsonb,text,text,boolean)', 'execute')
  and has_function_privilege('service_role', 'valtrim.edit_invoiced_draw_package(uuid,bigint,jsonb,jsonb,jsonb,text,text,boolean)', 'execute'),
  'Only the Edge Function (service role) can edit an invoiced Package, so QuickBooks is always told'
);

select ok(
  not has_function_privilege('authenticated', 'valtrim.complete_quickbooks_invoice_update(bigint,text,numeric,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'valtrim.fail_quickbooks_invoice_update(bigint,text,boolean)', 'execute')
  and has_function_privilege('service_role', 'valtrim.complete_quickbooks_invoice_update(bigint,text,numeric,jsonb)', 'execute')
  and has_function_privilege('service_role', 'valtrim.fail_quickbooks_invoice_update(bigint,text,boolean)', 'execute'),
  'Only the service role records what QuickBooks answered to an invoice update'
);

select ok(
  (select prosecdef from pg_proc where oid = 'valtrim.edit_invoiced_draw_package(uuid,bigint,jsonb,jsonb,jsonb,text,text,boolean)'::regprocedure)
  and (select proconfig::text like '%search_path=%' from pg_proc where oid = 'valtrim.edit_invoiced_draw_package(uuid,bigint,jsonb,jsonb,jsonb,text,text,boolean)'::regprocedure),
  'The edit runs as its owner with an empty search path'
);

select ok(
  (select count(*) = 4
   from information_schema.columns
   where table_schema = 'valtrim' and table_name = 'quickbooks_invoice_syncs'
     and column_name in ('update_pending', 'update_error', 'update_request_id', 'updated_in_quickbooks_at')),
  'An invoice records that a change to its lines still has to reach QuickBooks'
);

select ok(
  (select count(*) = 4
   from information_schema.columns
   where table_schema = 'valtrim' and table_name = 'quickbooks_invoice_sync_archive'
     and column_name in ('update_pending', 'update_error', 'update_request_id', 'updated_in_quickbooks_at')),
  'The archive of voided invoices keeps the same columns'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.quickbooks_invoice_syncs', 'update_pending', 'select')
  and has_column_privilege('authenticated', 'valtrim.quickbooks_invoice_syncs', 'update_error', 'select')
  and not has_column_privilege('authenticated', 'valtrim.quickbooks_invoice_syncs', 'update_request_id', 'select'),
  'Users see whether an update is pending and why it failed, not the request id'
);

select ok(
  (select pg_get_constraintdef(oid) like '%EDIT_INVOICED%'
   from pg_constraint
   where conrelid = 'valtrim.draw_package_corrections'::regclass
     and conname = 'draw_package_corrections_action_check'),
  'The correction history knows the edit of an invoiced Package'
);

select ok(
  (select prosrc like '%valtrim.invoiced_package_edit%' from pg_proc
   where oid = 'valtrim.reject_package_line_change()'::regprocedure)
  and (select prosrc like '%valtrim.invoiced_package_edit%' from pg_proc
   where oid = 'valtrim.reject_package_hardware_line_change()'::regprocedure),
  'The line guards let the edit delete lines of the Package it names, and nothing else'
);

select ok(
  (select prosrc like '%valtrim.invoiced_package_edit%' from pg_proc
   where oid = 'valtrim.prepare_draw_package()'::regprocedure),
  'The Package may change its Phase while the edit names it'
);

select ok(
  (select prosrc like '%update_pending%' from pg_proc
   where oid = 'valtrim.archive_quickbooks_invoice_sync(bigint,uuid,text)'::regprocedure),
  'Voiding an invoice archives the update columns too'
);

select ok(
  (select count(*) = 0
   from pg_proc procedure
   join pg_namespace namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'valtrim'
     and procedure.proname = 'edit_invoiced_draw_package'
     and procedure.prosrc !~ 'DRAW_INVOICE'),
  'The edit names the Draw & Invoice role next to Admin and Accounting'
);

select * from finish();

rollback;
