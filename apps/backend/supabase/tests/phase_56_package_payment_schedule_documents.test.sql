begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select has_function(
  'valtrim',
  'register_package_payment_schedule',
  array['bigint', 'text', 'text', 'bigint', 'text'],
  'The role-checked registration RPC is available'
);

select has_function(
  'valtrim',
  'delete_package_payment_schedule',
  array['bigint'],
  'The role-checked removal RPC is available'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.register_package_payment_schedule(bigint,text,text,bigint,text)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'valtrim.delete_package_payment_schedule(bigint)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'valtrim.register_package_payment_schedule(bigint,text,text,bigint,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'valtrim.delete_package_payment_schedule(bigint)',
    'execute'
  ),
  'Only signed-in users can call the Payment Schedule document RPCs'
);

select ok(
  (
    select prosecdef
    from pg_proc
    where oid =
      'private.register_package_payment_schedule(bigint,text,text,bigint,text)'::regprocedure
  )
  and (
    select prosecdef
    from pg_proc
    where oid = 'private.delete_package_payment_schedule(bigint)'::regprocedure
  )
  and not (
    select prosecdef
    from pg_proc
    where oid =
      'valtrim.register_package_payment_schedule(bigint,text,text,bigint,text)'::regprocedure
  )
  and not (
    select prosecdef
    from pg_proc
    where oid = 'valtrim.delete_package_payment_schedule(bigint)'::regprocedure
  ),
  'Both use definer rights only behind their role check'
);

select ok(
  coalesce((
    select bool_and(array_to_string(proconfig, ',') = 'search_path=""')
    from pg_proc
    where oid in (
      'private.register_package_payment_schedule(bigint,text,text,bigint,text)'::regprocedure,
      'private.delete_package_payment_schedule(bigint)'::regprocedure
    )
  ), false),
  'The private functions pin an empty search path'
);

select ok(
  coalesce((
    select procedure.prosrc like '%has_app_role%'
      and procedure.prosrc like '%payment_schedule_templates%'
      and procedure.prosrc like '%/payment_schedule/%'
      and procedure.prosrc like '%owner_id%'
    from pg_proc procedure
    where procedure.oid =
      'private.register_package_payment_schedule(bigint,text,text,bigint,text)'::regprocedure
  ), false),
  'Registering checks the role, a confirmed schedule, the Storage path and its owner'
);

select ok(
  coalesce((
    select procedure.prosrc like '%has_app_role%'
      and procedure.prosrc like '%unissued%'
      and procedure.prosrc like '%is_required%'
      and procedure.prosrc like '%''MISSING''%'
    from pg_proc procedure
    where procedure.oid =
      'private.delete_package_payment_schedule(bigint)'::regprocedure
  ), false),
  'Removing checks the role and the draft state, and keeps a required document as MISSING'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'package_documents_objects_insert'
      and with_check like '%payment_schedule%'
      and with_check like '%release%'
  ),
  'Package documents can be uploaded to the release and payment_schedule folders'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'valtrim'
      and tablename = 'package_documents'
      and indexname = 'package_documents_fixed_type_uq'
  ),
  'A Package keeps one document per fixed type, so one Payment Schedule'
);

select throws_ok(
  $$ select valtrim.register_package_payment_schedule(1, 'x', 'x.pdf', 1, null) $$,
  '42501',
  'You do not have permission to save Package documents',
  'Anonymous callers cannot register a Payment Schedule'
);

select throws_ok(
  $$ select valtrim.delete_package_payment_schedule(1) $$,
  '42501',
  'You do not have permission to remove Package documents',
  'Anonymous callers cannot remove a Payment Schedule'
);

select * from finish();

rollback;
