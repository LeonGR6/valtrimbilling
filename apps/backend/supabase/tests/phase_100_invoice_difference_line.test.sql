begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select is(
  array[
    valtrim.invoice_difference_limit(0),
    valtrim.invoice_difference_limit(5000),
    valtrim.invoice_difference_limit(5000.01),
    valtrim.invoice_difference_limit(6700),
    valtrim.invoice_difference_limit(10000.01),
    valtrim.invoice_difference_limit(15000.01),
    valtrim.invoice_difference_limit(null)
  ],
  array[5, 5, 10, 10, 15, 20, 5]::numeric[],
  'The most a difference may be is $5 for every $5,000 of invoice, started'
);

select ok(
  (select count(*) = 5
   from information_schema.columns
   where table_schema = 'valtrim' and table_name = 'quickbooks_invoice_syncs'
     and column_name in (
       'difference_description', 'difference_amount', 'difference_limit', 'difference_by', 'difference_at'
     )),
  'An invoice records its manual difference line, who added it and when'
);

select ok(
  (select count(*) = 5
   from information_schema.columns
   where table_schema = 'valtrim' and table_name = 'quickbooks_invoice_sync_archive'
     and column_name in (
       'difference_description', 'difference_amount', 'difference_limit', 'difference_by', 'difference_at'
     )),
  'The archive of cleared invoices keeps the same columns'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.quickbooks_invoice_syncs'::regclass
      and conname = 'quickbooks_invoice_syncs_difference_check'
      and contype = 'c'
  ),
  'The table itself refuses a difference above its limit or half a difference'
);

select has_function(
  'valtrim', 'complete_quickbooks_invoice_sync',
  array['bigint', 'text', 'text', 'text', 'numeric', 'jsonb', 'text', 'numeric', 'text'],
  'Recording the invoice also records its difference and, when it adds money, the reason'
);

select hasnt_function(
  'valtrim', 'complete_quickbooks_invoice_sync',
  array['bigint', 'text', 'text', 'text', 'numeric', 'jsonb', 'text', 'numeric'],
  'The old form is gone, so a call cannot reach the function without going through the difference check'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'valtrim.complete_quickbooks_invoice_sync(bigint,text,text,text,numeric,jsonb,text,numeric,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'valtrim.complete_quickbooks_invoice_sync(bigint,text,text,text,numeric,jsonb,text,numeric,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'valtrim.complete_quickbooks_invoice_sync(bigint,text,text,text,numeric,jsonb,text,numeric,text)',
    'execute'
  ),
  'Only the Edge Function (service role) records an invoice'
);

select ok(
  (select prosecdef from pg_proc
   where oid = 'valtrim.complete_quickbooks_invoice_sync(bigint,text,text,text,numeric,jsonb,text,numeric,text)'::regprocedure)
  and (select proconfig::text like '%search_path=%' from pg_proc
       where oid = 'valtrim.complete_quickbooks_invoice_sync(bigint,text,text,text,numeric,jsonb,text,numeric,text)'::regprocedure),
  'The recording runs as its owner with an empty search path'
);

select ok(
  has_function_privilege('authenticated', 'valtrim.invoice_difference_limit(numeric)', 'execute')
  and not has_function_privilege('anon', 'valtrim.invoice_difference_limit(numeric)', 'execute'),
  'Signed-in users can ask for the limit; anonymous visitors cannot'
);

select ok(
  (select pg_get_constraintdef(oid) like '%INVOICE_DIFFERENCE%'
   from pg_constraint
   where conrelid = 'valtrim.draw_package_corrections'::regclass
     and conname = 'draw_package_corrections_action_check'),
  'The Package history knows the invoice difference, next to the other changes'
);

select ok(
  (select pg_get_constraintdef(oid) like '%EDIT_INVOICED%'
   from pg_constraint
   where conrelid = 'valtrim.draw_package_corrections'::regclass
     and conname = 'draw_package_corrections_action_check'),
  'The history still knows the edit of an invoiced Package'
);

select ok(
  (select pg_get_functiondef('private.get_package_release_values(bigint)'::regprocedure) like '%balance_with_difference%'),
  'The Release values say what is owed with and without the difference'
);

select * from finish();

rollback;
