begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

select has_function(
  'valtrim', 'set_invoice_difference',
  array['uuid', 'bigint', 'text', 'numeric', 'text', 'boolean'],
  'The difference line of an invoiced Package can be set'
);

select ok(
  not has_function_privilege('authenticated', 'valtrim.set_invoice_difference(uuid,bigint,text,numeric,text,boolean)', 'execute')
  and not has_function_privilege('anon', 'valtrim.set_invoice_difference(uuid,bigint,text,numeric,text,boolean)', 'execute')
  and has_function_privilege('service_role', 'valtrim.set_invoice_difference(uuid,bigint,text,numeric,text,boolean)', 'execute'),
  'Only the Edge Function (service role) can set it'
);

select ok(
  (select prosecdef from pg_proc where oid = 'valtrim.set_invoice_difference(uuid,bigint,text,numeric,text,boolean)'::regprocedure)
  and (select proconfig::text like '%search_path=%' from pg_proc where oid = 'valtrim.set_invoice_difference(uuid,bigint,text,numeric,text,boolean)'::regprocedure),
  'It runs as its owner with an empty search path'
);

select ok(
  (select prosrc ~ 'ADMIN.*ACCOUNTING.*DRAW_INVOICE'
   from pg_proc where oid = 'valtrim.set_invoice_difference(uuid,bigint,text,numeric,text,boolean)'::regprocedure),
  'It names Admin, Accounting and Draw & Invoice, like the edit of an invoiced Package'
);

select ok(
  (select prosrc like '%AWAITING_PAYMENT%' and prosrc like '%update_pending%' and prosrc like '%invoice_payments%'
     and prosrc like '%invoice_difference_limit%'
   from pg_proc where oid = 'valtrim.set_invoice_difference(uuid,bigint,text,numeric,text,boolean)'::regprocedure),
  'It only works on a Package waiting for payment, with nothing pending and nothing paid, within the limit'
);

select ok(
  (select prosrc like '%INVOICE_DIFFERENCE%' and prosrc like '%gen_random_uuid()%' and prosrc like '%document_type::text = ''RELEASE''%'
   from pg_proc where oid = 'valtrim.set_invoice_difference(uuid,bigint,text,numeric,text,boolean)'::regprocedure),
  'It writes the history, marks the invoice as waiting for QuickBooks with a new request id and removes the Release'
);

select ok(
  (select prosrc !~ 'PAYMENT_SCHEDULE'
   from pg_proc where oid = 'valtrim.set_invoice_difference(uuid,bigint,text,numeric,text,boolean)'::regprocedure),
  'The Payment Schedule, which does not print the difference, is left alone'
);

select hasnt_function(
  'valtrim', 'set_invoice_difference',
  array['uuid', 'bigint', 'text', 'numeric', 'boolean'],
  'The form without the reason is gone'
);

select ok(
  (select prosrc ~ 'p_amount < 0 and abs\(p_amount\) > v_limit' and prosrc like '%write the reason%'
   from pg_proc where oid = 'valtrim.set_invoice_difference(uuid,bigint,text,numeric,text,boolean)'::regprocedure)
  and (select pg_get_constraintdef(oid) like '%difference_amount > (0)::numeric%'
      from pg_constraint where conrelid = 'valtrim.quickbooks_invoice_syncs'::regclass
        and conname = 'quickbooks_invoice_syncs_difference_check'),
  'The limit only holds a line that takes off, a line that adds money needs a reason, and the table agrees'
);

select * from finish();

rollback;
