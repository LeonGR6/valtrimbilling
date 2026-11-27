begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

select has_table(
  'valtrim',
  'audit_events',
  'The global application audit trail exists'
);

select has_column(
  'valtrim',
  'audit_events',
  'correlation_id',
  'Related audit rows can be correlated'
);

select has_column(
  'valtrim',
  'audit_events',
  'previous_values',
  'Audit rows preserve prior values'
);

select has_column(
  'valtrim',
  'audit_events',
  'new_values',
  'Audit rows preserve new values'
);

select ok(
  (
    select table_record.relrowsecurity
    from pg_class table_record
    join pg_namespace schema_record
      on schema_record.oid = table_record.relnamespace
    where schema_record.nspname = 'valtrim'
      and table_record.relname = 'audit_events'
  ),
  'Audit events have RLS enabled'
);

select ok(
  has_table_privilege('authenticated', 'valtrim.audit_events', 'select'),
  'Authenticated administrators can query through RLS'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.audit_events', 'insert'),
  'Browser clients cannot forge audit events'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.audit_events', 'update'),
  'Browser clients cannot rewrite audit events'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.audit_events', 'delete'),
  'Browser clients cannot erase audit events'
);

select * from finish();

rollback;
