begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

select has_function(
  'valtrim',
  'void_quickbooks_invoice_sync',
  array['bigint', 'uuid'],
  'A Package''s QuickBooks invoice can be voided'
);

select has_function(
  'valtrim',
  'register_quickbooks_invoice_pdf',
  array['bigint', 'uuid', 'text', 'text', 'bigint', 'text'],
  'The QuickBooks invoice PDF can be saved'
);

select ok(
  not has_function_privilege('authenticated', 'valtrim.void_quickbooks_invoice_sync(bigint,uuid)', 'execute')
  and not has_function_privilege('anon', 'valtrim.void_quickbooks_invoice_sync(bigint,uuid)', 'execute')
  and has_function_privilege('service_role', 'valtrim.void_quickbooks_invoice_sync(bigint,uuid)', 'execute'),
  'Only the service role can void'
);

select ok(
  not has_function_privilege('authenticated', 'valtrim.register_quickbooks_invoice_pdf(bigint,uuid,text,text,bigint,text)', 'execute')
  and has_function_privilege('service_role', 'valtrim.register_quickbooks_invoice_pdf(bigint,uuid,text,text,bigint,text)', 'execute'),
  'Only the service role can save the invoice PDF'
);

select ok(
  (
    select bool_and(prosecdef and array_to_string(proconfig, ',') = 'search_path=""')
    from pg_proc
    where oid in (
      'valtrim.void_quickbooks_invoice_sync(bigint,uuid)'::regprocedure,
      'valtrim.register_quickbooks_invoice_pdf(bigint,uuid,text,text,bigint,text)'::regprocedure
    )
  ),
  'Both functions use definer rights with an empty search path'
);

select throws_ok(
  $$ select valtrim.void_quickbooks_invoice_sync(-1, gen_random_uuid()) $$,
  'P0002',
  'The Package no longer exists',
  'Voiding a missing Package fails'
);

select throws_ok(
  $$ select valtrim.register_quickbooks_invoice_pdf(-1, null, '-1/invoice/00000000-0000-4000-8000-000000000000.pdf', 'x.pdf', 10, null) $$,
  '23503',
  'The Package is no longer available',
  'Saving a PDF for a missing Package fails'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.quickbooks_invoice_syncs'::regclass
      and conname = 'quickbooks_invoice_syncs_status_check'
      and pg_get_constraintdef(oid) like '%VOIDED%'
  ),
  'An invoice attempt can end as VOIDED'
);

select ok(
  (
    select bool_and(prosrc like '%VOIDED%')
    from pg_proc
    where oid in (
      'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,text)'::regprocedure,
      'private.delete_package_release(bigint)'::regprocedure,
      'private.delete_package_payment_schedule(bigint)'::regprocedure,
      'valtrim.reject_package_line_change()'::regprocedure
    )
  ),
  'The Package checks accept a Package whose QuickBooks invoice was voided'
);

select ok(
  (
    select prosrc like '%p_action = ''CANCEL'' and v_target.quickbooks_status = ''VOIDED''%'
    from pg_proc
    where oid = 'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,text)'::regprocedure
  ),
  'Only a cancellation is allowed after voiding; edits and transfers still are not'
);

select * from finish();

rollback;
