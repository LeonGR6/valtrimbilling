begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

select has_table('valtrim', 'people', 'People table is available');
select has_table('valtrim', 'person_roles', 'Person roles table is available');

select ok(
  has_table_privilege('authenticated', 'valtrim.people', 'select'),
  'Authenticated users can select supervisor People subject to RLS'
);

select ok(
  has_table_privilege('authenticated', 'valtrim.person_roles', 'select'),
  'Authenticated users can select SUPERVISOR role rows subject to RLS'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.people', 'name', 'update'),
  'Authenticated users can update supervisor fields subject to RLS'
);

select ok(
  not has_column_privilege('authenticated', 'valtrim.people', 'created_by', 'update'),
  'Browser clients cannot update the creator audit field'
);

select ok(
  not has_column_privilege('authenticated', 'valtrim.people', 'updated_by', 'update'),
  'Browser clients cannot update the updater audit field'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.people', 'insert'),
  'Browser clients cannot create arbitrary People rows'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.person_roles', 'insert'),
  'Browser clients cannot assign arbitrary person roles'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.people', 'delete'),
  'Supervisors cannot be hard deleted from the browser'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.person_roles', 'delete'),
  'SUPERVISOR roles cannot be removed from the browser'
);

select ok(
  not has_sequence_privilege('authenticated', 'valtrim.people_id_seq', 'usage'),
  'Only the narrow creation function can allocate a People identity'
);

select has_function(
  'valtrim',
  'create_supervisor',
  array['text', 'text', 'text', 'text', 'text'],
  'Atomic supervisor creation function is available'
);

select has_function(
  'private',
  'create_supervisor_internal',
  array['text', 'text', 'text', 'text', 'text'],
  'Privileged supervisor creation implementation stays private'
);

select ok(
  not (
    select function_record.prosecdef
    from pg_proc function_record
    where function_record.oid =
      'valtrim.create_supervisor(text, text, text, text, text)'::regprocedure
  ),
  'The Data API function uses invoker rights'
);

select ok(
  (
    select function_record.prosecdef
    from pg_proc function_record
    where function_record.oid =
      'private.create_supervisor_internal(text, text, text, text, text)'::regprocedure
  ),
  'Only the private implementation uses definer rights'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.create_supervisor(text, text, text, text, text)',
    'execute'
  ),
  'Authenticated users can call supervisor creation subject to its role check'
);

select ok(
  not has_function_privilege(
    'anon',
    'valtrim.create_supervisor(text, text, text, text, text)',
    'execute'
  ),
  'Anonymous clients cannot call supervisor creation'
);

select ok(
  not has_function_privilege(
    'anon',
    'private.create_supervisor_internal(text, text, text, text, text)',
    'execute'
  ),
  'Anonymous clients cannot call the private implementation'
);

select has_index(
  'valtrim',
  'people',
  'people_created_by_idx',
  'People creator references have a covering index'
);

select has_index(
  'valtrim',
  'people',
  'people_updated_by_idx',
  'People updater references have a covering index'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'valtrim'
      and tablename in ('people', 'person_roles')
  ),
  3::bigint,
  'People and person roles have the three expected RLS policies'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.communities', 'select'),
  'Communities and jobsites remain closed after the Supervisor phase'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.jobs', 'select'),
  'Jobs remain closed after the Supervisor phase'
);

select * from finish();

rollback;
