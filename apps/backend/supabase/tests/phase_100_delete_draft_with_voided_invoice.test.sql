begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

-- The cancel guard of a Draft Package.
select ok(
  pg_get_functiondef(
    'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,text)'::regprocedure
  ) like '%p_action = ''CANCEL''%and v_target.quickbooks_status = ''VOIDED''%and document.document_type = ''INVOICE''%',
  'A cancel of a Package with a voided invoice skips its saved INVOICE document'
);

select ok(
  pg_get_functiondef(
    'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,text)'::regprocedure
  ) like '%document.file_id is not null%or document.status in (''COMPLETE'', ''WAIVED'')%',
  'Any other generated document (Release, Payment Schedule) still blocks the correction'
);

-- Deleting the Draw cells of the cancelled Package.
select ok(
  pg_get_functiondef('valtrim.reject_package_line_change()'::regprocedure)
    like '%package.quickbooks_status = ''VOIDED''%and document.document_type = ''INVOICE''%',
  'Deleting the Draw cells of a cancelled Package skips the INVOICE document of a voided invoice'
);

select ok(
  pg_get_functiondef('valtrim.reject_package_line_change()'::regprocedure)
    like '%document.file_id is not null%or document.status in (''COMPLETE'', ''WAIVED'')%',
  'The Draw cell guard still counts every other document'
);

-- The rights of both functions did not change.
select ok(
  has_function_privilege('authenticated', 'valtrim.cancel_draw_invoice_package(bigint,text)', 'execute')
  and not has_function_privilege('anon', 'valtrim.cancel_draw_invoice_package(bigint,text)', 'execute'),
  'Cancelling stays callable by signed-in users only'
);

select ok(
  (select prosecdef from pg_proc
   where oid = 'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,text)'::regprocedure)
  and (select proconfig::text from pg_proc
       where oid = 'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,text)'::regprocedure)
      like '%search_path%',
  'The correction function keeps SECURITY DEFINER and its fixed search_path'
);

select * from finish();

rollback;
