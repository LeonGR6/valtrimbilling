begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select has_function(
  'valtrim',
  'quickbooks_invoice_number_candidates',
  array['text'],
  'The numbers used in an environment can be listed'
);

select has_function(
  'valtrim',
  'release_quickbooks_voided_invoice_number',
  array['text', 'text'],
  'The number of a voided invoice can be released'
);

select ok(
  not has_function_privilege('authenticated', 'valtrim.quickbooks_invoice_number_candidates(text)', 'execute')
  and not has_function_privilege('anon', 'valtrim.quickbooks_invoice_number_candidates(text)', 'execute')
  and not has_function_privilege('authenticated', 'valtrim.release_quickbooks_voided_invoice_number(text,text)', 'execute')
  and not has_function_privilege('anon', 'valtrim.release_quickbooks_voided_invoice_number(text,text)', 'execute')
  and has_function_privilege('service_role', 'valtrim.quickbooks_invoice_number_candidates(text)', 'execute')
  and has_function_privilege('service_role', 'valtrim.release_quickbooks_voided_invoice_number(text,text)', 'execute'),
  'Both functions are service-role-only'
);

-- The rows below point at Packages that do not exist; their foreign keys are not what is tested.
set local session_replication_role = replica;

insert into valtrim.quickbooks_invoice_syncs (
  package_id, status, environment, realm_id, invoice_number, qbo_invoice_id, qbo_doc_number
) values
  (-1, 'VOIDED', 'production', 'r1', '99002', '1', '99002'),
  (-2, 'CREATED', 'production', 'r1', '98879', '2', '98879'),
  (-3, 'VOIDED', 'production', 'r1', '98700', '3', '98700'),
  (-4, 'FAILED', 'production', 'r1', '99999', null, null),
  (-5, 'VOIDED', 'sandbox', 'r2', '99500', '4', '99500'),
  (-6, 'CREATED', 'production', 'r1', 'ABC-1', '5', 'ABC-1');

select is(
  (select array_agg(candidate.invoice_number order by candidate.invoice_number::numeric desc)
   from valtrim.quickbooks_invoice_number_candidates('production') candidate
   where candidate.invoice_number in ('99002', '98879', '98700', '99999', 'ABC-1')),
  array['99002', '98879', '98700'],
  'Only the numeric numbers of invoices that were made are listed, highest first'
);

select is(
  (select candidate.voided
   from valtrim.quickbooks_invoice_number_candidates('production') candidate
   where candidate.invoice_number = '99002'),
  true,
  'A voided invoice is marked as voided'
);

select is(
  (select candidate.voided
   from valtrim.quickbooks_invoice_number_candidates('production') candidate
   where candidate.invoice_number = '98879'),
  false,
  'An invoice that is not voided is not marked'
);

select is(
  (select count(*)
   from valtrim.quickbooks_invoice_number_candidates('production') candidate
   where candidate.invoice_number = '99500'),
  0::bigint,
  'The numbers of another environment are not listed'
);

select is(
  valtrim.release_quickbooks_voided_invoice_number('production', '99002'),
  true,
  'The number of a voided invoice is released'
);

select is(
  (select sync.invoice_number is null and sync.qbo_doc_number = '99002'
   from valtrim.quickbooks_invoice_syncs sync where sync.package_id = -1),
  true,
  'Releasing clears the number but the invoice keeps it in its QuickBooks number'
);

select is(
  (select count(*)
   from valtrim.quickbooks_invoice_number_candidates('production') candidate
   where candidate.invoice_number = '99002'),
  0::bigint,
  'A released number is no longer listed, so it no longer counts as the last one used'
);

select is(
  valtrim.release_quickbooks_voided_invoice_number('production', '98879'),
  false,
  'A number of an invoice that is not voided is never released'
);

select is(
  valtrim.release_quickbooks_voided_invoice_number('production', '99500'),
  false,
  'A number is only released in its own environment'
);

select * from finish();

rollback;
