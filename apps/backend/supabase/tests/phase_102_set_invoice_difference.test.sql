begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

select has_function(
  'valtrim', 'set_invoice_difference',
  array['uuid', 'bigint', 'text', 'numeric', 'boolean'],
  'The difference line of an invoiced Package can be set'
);

select ok(
  not has_function_privilege('authenticated', 'valtrim.set_invoice_difference(uuid,bigint,text,numeric,boolean)', 'execute')
  and not has_function_privilege('anon', 'valtrim.set_invoice_difference(uuid,bigint,text,numeric,boolean)', 'execute')
  and has_function_privilege('service_role', 'valtrim.set_invoice_difference(uuid,bigint,text,numeric,boolean)', 'execute'),
  'Only the Edge Function (service role) can set it'
);

select ok(
  (select prosecdef from pg_proc where oid = 'valtrim.set_invoice_difference(uuid,bigint,text,numeric,boolean)'::regprocedure)
  and (select proconfig::text like '%search_path=%' from pg_proc where oid = 'valtrim.set_invoice_difference(uuid,bigint,text,numeric,boolean)'::regprocedure),
  'It runs as its owner with an empty search path'
);

select ok(
  (select prosrc ~ 'ADMIN.*ACCOUNTING.*DRAW_INVOICE'
   from pg_proc where oid = 'valtrim.set_invoice_difference(uuid,bigint,text,numeric,boolean)'::regprocedure),
  'It names Admin, Accounting and Draw & Invoice, like the edit of an invoiced Package'
);

select ok(
  (select prosrc like '%AWAITING_PAYMENT%' and prosrc like '%update_pending%' and prosrc like '%invoice_payments%'
     and prosrc like '%invoice_difference_limit%'
   from pg_proc where oid = 'valtrim.set_invoice_difference(uuid,bigint,text,numeric,boolean)'::regprocedure),
  'It only works on a Package waiting for payment, with nothing pending and nothing paid, within the limit'
);

select ok(
  (select prosrc like '%INVOICE_DIFFERENCE%' and prosrc like '%gen_random_uuid()%' and prosrc like '%document_type::text = ''RELEASE''%'
   from pg_proc where oid = 'valtrim.set_invoice_difference(uuid,bigint,text,numeric,boolean)'::regprocedure),
  'It writes the history, marks the invoice as waiting for QuickBooks with a new request id and removes the Release'
);

select ok(
  (select prosrc !~ 'PAYMENT_SCHEDULE'
   from pg_proc where oid = 'valtrim.set_invoice_difference(uuid,bigint,text,numeric,boolean)'::regprocedure),
  'The Payment Schedule, which does not print the difference, is left alone'
);

select * from finish();

rollback;
