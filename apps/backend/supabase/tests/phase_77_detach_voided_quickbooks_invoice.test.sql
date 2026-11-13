begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

select has_function(
  'valtrim',
  'detach_voided_quickbooks_invoice',
  array['bigint', 'uuid'],
  'A voided invoice can be detached from its Package'
);

select ok(
  not has_function_privilege('authenticated', 'valtrim.detach_voided_quickbooks_invoice(bigint,uuid)', 'execute')
  and not has_function_privilege('anon', 'valtrim.detach_voided_quickbooks_invoice(bigint,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'valtrim.archive_quickbooks_invoice_sync(bigint,uuid,text)', 'execute')
  and not has_function_privilege('anon', 'valtrim.archive_quickbooks_invoice_sync(bigint,uuid,text)', 'execute')
  and has_function_privilege('service_role', 'valtrim.detach_voided_quickbooks_invoice(bigint,uuid)', 'execute'),
  'Detaching is service-role-only and the archiving helper is not callable by app users'
);

select is(
  (select count(*)
   from information_schema.columns sync
   where sync.table_schema = 'valtrim'
     and sync.table_name = 'quickbooks_invoice_syncs'
     and not exists (
       select 1
       from information_schema.columns archived
       where archived.table_schema = 'valtrim'
         and archived.table_name = 'quickbooks_invoice_sync_archive'
         and archived.column_name = sync.column_name
     )),
  0::bigint,
  'The archive has every column of the sync table, so archiving cannot miss one'
);

-- The rows below point at jobs, builders and setups that do not exist; their foreign
-- keys, and the triggers of a real Package, are not what is tested here.
set local session_replication_role = replica;

insert into valtrim.draw_packages (
  id, builder_id, job_id, setup_version_id, invoice_line_format,
  status, quickbooks_status, quickbooks_reference, quickbooks_environment,
  workflow_status, voided_at, void_reason
) overriding system value values
  -- 1: invoice voided, Package still a draft
  (-201, -1, -1, -1, 'SINGLE', 'DRAFT', 'VOIDED', '99101', 'production', 'DRAFT', null, null),
  -- 2: Package cancelled
  (-202, -1, -1, -1, 'SINGLE', 'VOIDED', 'VOIDED', '99102', 'production', 'DRAFT', now(), 'Cancelled'),
  -- 3: invoice not voided
  (-203, -1, -1, -1, 'SINGLE', 'DRAFT', 'CREATED', '99103', 'production', 'AWAITING_PAYMENT', null, null),
  -- 4: invoice voided but something was paid
  (-204, -1, -1, -1, 'SINGLE', 'DRAFT', 'VOIDED', '99104', 'production', 'DRAFT', null, null),
  -- 5: invoice voided in QuickBooks while the Package waited for payment
  (-205, -1, -1, -1, 'SINGLE', 'DRAFT', 'VOIDED', '99105', 'production', 'AWAITING_PAYMENT', null, null),
  -- 6: a Test invoice, for the Test reset that shares the archiving
  (-206, -1, -1, -1, 'SINGLE', 'DRAFT', 'CREATED', '99106', 'sandbox', 'AWAITING_PAYMENT', null, null);

insert into valtrim.invoices (package_id, net_amount, paid_amount)
values (-201, 100, 0), (-202, 100, 0), (-203, 100, 0), (-204, 100, 50), (-205, 100, 0), (-206, 100, 0);

insert into valtrim.quickbooks_invoice_syncs (
  package_id, status, environment, realm_id, invoice_number, qbo_invoice_id, qbo_doc_number,
  qbo_invoice_date
) values
  (-201, 'VOIDED', 'production', 'r1', '99101', '1', '99101', null),
  (-205, 'CREATED', 'production', 'r1', '99105', '5', '99105', null),
  (-206, 'CREATED', 'sandbox', 'r2', '99106', '6', '99106', '2026-10-01');

select is(
  valtrim.detach_voided_quickbooks_invoice(-201, null) ->> 'voided_invoice_number',
  '99101',
  'Detaching says which invoice number was voided'
);

select is(
  (select package.quickbooks_status = 'NOT_CREATED'
     and package.quickbooks_reference is null
     and package.quickbooks_environment is null
   from valtrim.draw_packages package where package.id = -201),
  true,
  'The Package goes back to having no QuickBooks invoice'
);

select is(
  (select count(*) from valtrim.quickbooks_invoice_syncs sync where sync.package_id = -201),
  0::bigint,
  'The Package no longer points at the voided invoice, so a new one can be made'
);

select is(
  (select count(*)
   from valtrim.quickbooks_invoice_sync_archive archived
   where archived.package_id = -201
     and archived.status = 'VOIDED'
     and archived.qbo_doc_number = '99101'
     and archived.archive_reason like 'Voided invoice detached%'),
  1::bigint,
  'The voided invoice is kept in the archive'
);

select is(
  (select candidate.voided
   from valtrim.quickbooks_invoice_number_candidates('production') candidate
   where candidate.invoice_number = '99101'),
  true,
  'An archived voided invoice still counts as a used number, to be checked in QuickBooks'
);

select is(
  valtrim.release_quickbooks_voided_invoice_number('production', '99101'),
  true,
  'The number of an archived voided invoice is released too'
);

select is(
  (select count(*)
   from valtrim.quickbooks_invoice_number_candidates('production') candidate
   where candidate.invoice_number = '99101'),
  0::bigint,
  'A released archived number no longer counts as used'
);

select throws_ok(
  $$ select valtrim.detach_voided_quickbooks_invoice(-202, null) $$,
  '23514',
  'A cancelled Package cannot get a new invoice',
  'A cancelled Package does not get a new invoice'
);

select throws_ok(
  $$ select valtrim.detach_voided_quickbooks_invoice(-203, null) $$,
  '23514',
  'Only a Package whose QuickBooks invoice was voided can get a new invoice',
  'An invoice that stands is never detached'
);

select throws_ok(
  $$ select valtrim.detach_voided_quickbooks_invoice(-204, null) $$,
  '23514',
  'Only an unpaid Package that was not submitted can get a new invoice',
  'A Package with a payment does not get a new invoice'
);

select lives_ok(
  $$ select valtrim.detach_voided_quickbooks_invoice(-205, null) $$,
  'A Package whose invoice was voided in QuickBooks can be detached too'
);

select is(
  (select package.workflow_status::text from valtrim.draw_packages package where package.id = -205),
  'DRAFT',
  'A Package that waited for the voided invoice goes back to Draft'
);

select is(
  valtrim.reset_quickbooks_test_invoice(-206, null, 'test') ? 'removed_storage_path',
  true,
  'A Test invoice can be moved back to Production again'
);

select is(
  (select archived.qbo_invoice_date
   from valtrim.quickbooks_invoice_sync_archive archived where archived.package_id = -206),
  '2026-10-01'::date,
  'The Test reset keeps the invoice date in the archive'
);

select * from finish();

rollback;
