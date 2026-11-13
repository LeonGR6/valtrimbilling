begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select has_function(
  'valtrim',
  'apply_quickbooks_invoice_states',
  array['jsonb'],
  'Several QuickBooks states can be applied in one call'
);

select ok(
  not has_function_privilege('authenticated', 'valtrim.apply_quickbooks_invoice_states(jsonb)', 'execute')
  and not has_function_privilege('anon', 'valtrim.apply_quickbooks_invoice_states(jsonb)', 'execute')
  and has_function_privilege('service_role', 'valtrim.apply_quickbooks_invoice_states(jsonb)', 'execute'),
  'Only the service role can apply QuickBooks states'
);

-- The rows below point at jobs, builders and setups that do not exist; their foreign
-- keys, and the triggers of a real Package, are not what is tested here.
set local session_replication_role = replica;

insert into valtrim.draw_packages (
  id, builder_id, job_id, setup_version_id, invoice_line_format,
  status, quickbooks_status, quickbooks_reference, quickbooks_environment, workflow_status
) overriding system value values
  (-301, -1, -1, -1, 'SINGLE', 'DRAFT', 'CREATED', '99301', 'production', 'DRAFT'),
  (-302, -1, -1, -1, 'SINGLE', 'DRAFT', 'CREATED', '99302', 'production', 'AWAITING_PAYMENT'),
  (-303, -1, -1, -1, 'SINGLE', 'DRAFT', 'CREATED', '99303', 'production', 'AWAITING_PAYMENT');

insert into valtrim.invoices (package_id, net_amount, paid_amount)
values (-301, 100, 0), (-302, 100, 0), (-303, 100, 100);

insert into valtrim.quickbooks_invoice_syncs (
  package_id, status, environment, realm_id, invoice_number, qbo_invoice_id, qbo_doc_number
) values
  (-301, 'CREATED', 'production', 'r1', '99301', '1', '99301'),
  (-302, 'CREATED', 'production', 'r1', '99302', '2', '99302'),
  (-303, 'CREATED', 'production', 'r1', '99303', '3', '99303');

create temp table batch_result as
select valtrim.apply_quickbooks_invoice_states('[
  {"package_id": -301, "state": "OPEN", "total": 100, "balance": 100,
   "due_date": "2026-12-01", "overdue": false, "linked": [], "qbo_last_updated": "2026-11-13T10:00:00Z"},
  {"package_id": -302, "state": "NOT_A_STATE", "total": 100, "balance": 100,
   "due_date": null, "overdue": false, "linked": [], "qbo_last_updated": null},
  {"package_id": -303, "state": "PAID", "total": 100, "balance": 0,
   "due_date": null, "overdue": false, "linked": ["Payment"], "qbo_last_updated": null},
  {"package_id": -999, "state": "OPEN", "total": 1, "balance": 1,
   "due_date": null, "overdue": false, "linked": [], "qbo_last_updated": null}
]'::jsonb) as result;

select is(
  (select jsonb_array_length(result) from batch_result),
  4,
  'Every Package of the call gets a row in the answer'
);

select is(
  (select result -> 0 ->> 'workflow_status' from batch_result),
  'AWAITING_PAYMENT',
  'An open invoice moves a Draft Package to Awaiting payment, as the single call does'
);

select is(
  (select workflow_status::text from valtrim.draw_packages where id = -301),
  'AWAITING_PAYMENT',
  'The Package itself was updated'
);

select is(
  (select sync.qbo_state || '/' || sync.qbo_balance::text || '/' || sync.qbo_due_date::text
   from valtrim.quickbooks_invoice_syncs sync where sync.package_id = -301),
  'OPEN/100.00/2026-12-01',
  'The state, balance and due date are recorded'
);

select ok(
  (select result -> 1 ->> 'error' is not null and result -> 1 -> 'workflow_status' = 'null'::jsonb
   from batch_result),
  'An unknown state is reported in its own row'
);

select is(
  (select workflow_status::text from valtrim.draw_packages where id = -302),
  'AWAITING_PAYMENT',
  'A failing Package is left as it was'
);

select is(
  (select workflow_status::text || '/' || paid_via_quickbooks::text
   from valtrim.draw_packages where id = -303),
  'PAID_CLOSED/true',
  'A Package after the failing one is still applied: one failure does not undo the others'
);

select ok(
  (select result -> 3 ->> 'error' is not null from batch_result),
  'A Package with no QuickBooks invoice is reported in its own row'
);

select throws_ok(
  $$select valtrim.apply_quickbooks_invoice_states('{"package_id": 1}'::jsonb)$$,
  '22023',
  'Send the QuickBooks states as a JSON array',
  'Something that is not a list is refused'
);

select is(
  valtrim.apply_quickbooks_invoice_states('[]'::jsonb),
  '[]'::jsonb,
  'An empty list does nothing'
);

select * from finish();

rollback;
