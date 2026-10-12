begin;

create extension if not exists pgtap with schema extensions;

select plan(2);

select ok(
  coalesce((
    select procedure.prosrc like '%PAYMENT_SCHEDULE%'
      and procedure.prosrc not like '%PURCHASE_ORDER%'
    from pg_proc procedure
    where procedure.oid =
      'private.sync_payment_schedule_template_document()'::regprocedure
  ), false),
  'Payment Schedule templates accept PAYMENT_SCHEDULE documents only'
);

select has_trigger(
  'valtrim',
  'payment_schedule_templates',
  'payment_schedule_templates_sync_document',
  'The document type rule is enforced on every insert and update'
);

select * from finish();

rollback;
