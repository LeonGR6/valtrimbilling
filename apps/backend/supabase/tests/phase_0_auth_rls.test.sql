begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

select has_table(
  'valtrim',
  'app_users',
  'Phase 0 creates application profiles'
);

select has_table(
  'valtrim',
  'user_community_access',
  'Phase 0 creates community access scopes'
);

select has_trigger(
  'auth',
  'users',
  'valtrim_on_auth_user_created',
  'Auth identities create application profiles'
);

select is(
  (
    select count(*)
    from pg_class table_record
    join pg_namespace schema_record
      on schema_record.oid = table_record.relnamespace
    where schema_record.nspname = 'valtrim'
      and table_record.relkind in ('r', 'p')
      and not table_record.relrowsecurity
  ),
  0::bigint,
  'Every Valtrim table has RLS enabled'
);

select ok(
  not has_schema_privilege('anon', 'valtrim', 'usage'),
  'Anonymous clients cannot access the Valtrim schema'
);

select ok(
  has_schema_privilege('authenticated', 'valtrim', 'usage'),
  'Authenticated clients can address the Valtrim schema'
);

select ok(
  has_table_privilege('authenticated', 'valtrim.app_users', 'select'),
  'Authenticated users can read the profiles allowed by RLS'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.app_users', 'update'),
  'Profile and access mutations require a trusted backend'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.jobs', 'select'),
  'Unopened business tables remain closed until their feature migration'
);

select * from finish();

rollback;
