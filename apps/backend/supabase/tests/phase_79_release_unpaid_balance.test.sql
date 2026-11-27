begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

select ok(coalesce((
  select procedure.prosrc like '%''balance_amount''%'
    and procedure.prosrc like '%''balance_source''%'
    and procedure.prosrc like '%quickbooks_invoice_syncs%'
    and procedure.prosrc like '%qbo_balance%'
  from pg_proc procedure
  where procedure.oid = 'private.get_package_release_values(bigint)'::regprocedure
), false), 'Each unpaid earlier Package carries the balance QuickBooks reports');

select ok(coalesce((
  select procedure.prosrc like '%''OPEN'', ''OVERDUE'', ''PARTIALLY_PAID''%'
    and procedure.prosrc like '%least(qbo.qbo_balance%'
  from pg_proc procedure
  where procedure.oid = 'private.get_package_release_values(bigint)'::regprocedure
), false), 'Only an open invoice has a balance, and it is never more than the net amount');

select ok(coalesce((
  select procedure.prosrc like '%''net_amount'', invoice.net_amount%'
    and procedure.prosrc like '%other.workflow_status <> ''PAID_CLOSED''%'
    and procedure.prosrc like '%final_release%'
  from pg_proc procedure
  where procedure.oid = 'private.get_package_release_values(bigint)'::regprocedure
), false), 'The net amount, the unpaid filter and the Final Release status stay');

select ok(
  not has_function_privilege('anon', 'private.get_package_release_values(bigint)', 'execute'),
  'The values are still not open to anonymous users'
);

select * from finish();

rollback;
