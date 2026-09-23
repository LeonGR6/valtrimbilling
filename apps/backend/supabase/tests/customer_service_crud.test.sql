begin;

create extension if not exists pgtap with schema extensions;

select plan(41);

select has_view(
  'valtrim',
  'service_request_detail',
  'Customer Service has a secure detail view'
);

select has_function(
  'valtrim',
  'create_customer_service_request',
  array['jsonb', 'jsonb', 'jsonb'],
  'The request creation RPC exists'
);

select has_function(
  'valtrim',
  'update_customer_service_request',
  array['bigint', 'jsonb', 'jsonb', 'jsonb'],
  'The request update RPC exists'
);

select has_function(
  'valtrim',
  'close_customer_service_request',
  array['bigint', 'text'],
  'The request close RPC exists'
);

select has_function(
  'valtrim',
  'reopen_customer_service_request',
  array['bigint', 'text'],
  'The request reopen RPC exists'
);

select has_function(
  'private',
  'require_customer_service_actor',
  array[]::text[],
  'The private authorization helper exists'
);

select has_function(
  'private',
  'replace_customer_service_availability_internal',
  array['bigint', 'jsonb', 'date', 'date', 'uuid'],
  'The private availability replacement helper exists'
);

select has_function(
  'private',
  'create_customer_service_request_internal',
  array['jsonb', 'jsonb', 'jsonb'],
  'The privileged request creation implementation stays private'
);

select has_function(
  'private',
  'update_customer_service_request_internal',
  array['bigint', 'jsonb', 'jsonb', 'jsonb'],
  'The privileged request update implementation stays private'
);

select has_function(
  'private',
  'close_customer_service_request_internal',
  array['bigint', 'text'],
  'The privileged request close implementation stays private'
);

select has_function(
  'private',
  'reopen_customer_service_request_internal',
  array['bigint', 'text'],
  'The privileged request reopen implementation stays private'
);

select ok(
  (
    select function_record.prosecdef
    from pg_proc function_record
    where function_record.oid =
      'valtrim.create_customer_service_request(jsonb, jsonb, jsonb)'::regprocedure
  ),
  'The exposed creation RPC can perform its atomic writes with definer rights'
);

select ok(
  (
    select function_record.prosecdef
    from pg_proc function_record
    where function_record.oid =
      'private.create_customer_service_request_internal(jsonb, jsonb, jsonb)'::regprocedure
  ),
  'The private creation implementation uses definer rights'
);

select ok(
  (
    select function_record.prosecdef
    from pg_proc function_record
    where function_record.oid =
      'private.update_customer_service_request_internal(bigint, jsonb, jsonb, jsonb)'::regprocedure
  ),
  'The private update implementation uses definer rights'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.create_customer_service_request(jsonb, jsonb, jsonb)',
    'execute'
  ),
  'Authenticated users can invoke creation subject to its role check'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.update_customer_service_request(bigint, jsonb, jsonb, jsonb)',
    'execute'
  ),
  'Authenticated users can invoke updates subject to its role check'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.close_customer_service_request(bigint, text)',
    'execute'
  ),
  'Authenticated users can invoke close subject to its role check'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.reopen_customer_service_request(bigint, text)',
    'execute'
  ),
  'Authenticated users can invoke reopen subject to its role check'
);

select ok(
  not has_function_privilege(
    'anon',
    'valtrim.create_customer_service_request(jsonb, jsonb, jsonb)',
    'execute'
  ),
  'Anonymous clients cannot invoke request creation'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.create_customer_service_request_internal(jsonb, jsonb, jsonb)',
    'execute'
  ),
  'Authenticated clients cannot invoke the private creation implementation'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.require_customer_service_actor()',
    'execute'
  ),
  'Authenticated clients cannot invoke the private authorization helper'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'valtrim.service_properties',
    'address',
    'insert'
  ),
  'Browser clients cannot insert properties directly'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'valtrim.service_properties',
    'address',
    'update'
  ),
  'Browser clients cannot update properties directly'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'valtrim.service_requests',
    'work_type',
    'insert'
  ),
  'Browser clients cannot insert requests directly'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'valtrim.service_requests',
    'work_type',
    'update'
  ),
  'Browser clients cannot update requests directly'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'valtrim.service_request_availability',
    'insert'
  ),
  'Browser clients cannot insert availability directly'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'valtrim.service_request_availability',
    'update'
  ),
  'Browser clients cannot update availability directly'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'valtrim.service_request_availability',
    'delete'
  ),
  'Browser clients cannot delete availability directly'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'valtrim.service_appointments',
    'starts_at',
    'insert'
  ),
  'Browser clients cannot insert appointments directly'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'valtrim.service_appointments',
    'starts_at',
    'update'
  ),
  'Browser clients cannot update appointments directly'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'valtrim.service_requests',
    'delete'
  ),
  'Customer Service requests cannot be hard deleted'
);

select ok(
  not has_sequence_privilege(
    'authenticated',
    'valtrim.service_properties_id_seq',
    'usage'
  ),
  'Only the creation RPC can allocate property identities'
);

select ok(
  not has_sequence_privilege(
    'authenticated',
    'valtrim.service_requests_id_seq',
    'usage'
  ),
  'Only the creation RPC can allocate request identities'
);

select ok(
  not has_sequence_privilege(
    'authenticated',
    'valtrim.service_request_folio_seq',
    'usage'
  ),
  'Only the creation RPC can allocate request folios'
);

select ok(
  not has_sequence_privilege(
    'authenticated',
    'valtrim.service_request_availability_id_seq',
    'usage'
  ),
  'Only the CRUD RPCs can allocate availability identities'
);

select ok(
  has_table_privilege(
    'authenticated',
    'valtrim.service_request_detail',
    'select'
  ),
  'Authenticated users can read the detail view subject to base-table RLS'
);

select ok(
  (
    select 'security_invoker=true' = any(view_record.reloptions)
    from pg_class view_record
    join pg_namespace schema_record
      on schema_record.oid = view_record.relnamespace
    where schema_record.nspname = 'valtrim'
      and view_record.relname = 'service_request_detail'
  ),
  'The detail view evaluates base-table RLS as the caller'
);

select ok(
  (
    select function_record.prosecdef
    from pg_proc function_record
    where function_record.oid =
      'private.audit_customer_service_request_change()'::regprocedure
  ),
  'The Customer Service audit trigger keeps definer rights'
);

select ok(
  pg_get_functiondef(
    'private.audit_customer_service_request_change()'::regprocedure
  ) like '%SERVICE_REQUEST_CLOSED%',
  'Activity History distinguishes closed requests'
);

select ok(
  pg_get_functiondef(
    'private.audit_customer_service_request_change()'::regprocedure
  ) like '%SERVICE_REQUEST_REOPENED%',
  'Activity History distinguishes reopened requests'
);

select throws_ok(
  $$
    select valtrim.create_customer_service_request(
      '{}'::jsonb,
      '{}'::jsonb,
      '[]'::jsonb
    )
  $$,
  '42501',
  'You do not have permission to manage Customer Service requests',
  'The creation RPC rejects calls without an authenticated manager'
);

select * from finish();

rollback;
