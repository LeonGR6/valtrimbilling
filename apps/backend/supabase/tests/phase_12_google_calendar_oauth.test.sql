begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

select has_table(
  'valtrim',
  'google_oauth_states',
  'Short-lived Google OAuth states are persisted'
);
select has_table(
  'valtrim',
  'google_calendar_connections',
  'Google Calendar connections are persisted'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.google_oauth_states'::regclass),
  'OAuth states have RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.google_calendar_connections'::regclass),
  'Google Calendar connections have RLS enabled'
);
select ok(
  not has_table_privilege('authenticated', 'valtrim.google_oauth_states', 'select')
  and not has_table_privilege('authenticated', 'valtrim.google_oauth_states', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.google_oauth_states', 'update')
  and not has_table_privilege('authenticated', 'valtrim.google_oauth_states', 'delete'),
  'Browser clients cannot access OAuth state rows'
);
select ok(
  has_column_privilege(
    'authenticated',
    'valtrim.google_calendar_connections',
    'calendar_summary',
    'select'
  ),
  'Authenticated users can read safe connection metadata subject to RLS'
);
select ok(
  not has_column_privilege(
    'authenticated',
    'valtrim.google_calendar_connections',
    'refresh_token_secret_id',
    'select'
  ),
  'Browser clients cannot read the Vault secret reference'
);
select ok(
  not has_table_privilege('authenticated', 'valtrim.google_calendar_connections', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.google_calendar_connections', 'update')
  and not has_table_privilege('authenticated', 'valtrim.google_calendar_connections', 'delete'),
  'Browser clients cannot mutate Google Calendar connections'
);
select policies_are(
  'valtrim',
  'google_oauth_states',
  array[]::text[],
  'OAuth states expose no browser policies'
);
select policies_are(
  'valtrim',
  'google_calendar_connections',
  array['google_calendar_connections_select_own'],
  'Connections expose only an owner-scoped SELECT policy'
);
select has_function(
  'valtrim',
  'complete_google_calendar_connection',
  array['uuid', 'text', 'text', 'text', 'text'],
  'Service completion boundary is available'
);
select has_function(
  'private',
  'delete_google_calendar_refresh_token',
  array[]::text[],
  'Vault token cleanup trigger function is available'
);
select ok(
  (select prosecdef from pg_proc where oid =
    'valtrim.complete_google_calendar_connection(uuid,text,text,text,text)'::regprocedure),
  'Connection completion uses definer rights for Vault access'
);
select ok(
  coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid =
      'valtrim.complete_google_calendar_connection(uuid,text,text,text,text)'::regprocedure
  ), false),
  'Connection completion pins an empty search path'
);
select ok(
  has_function_privilege(
    'service_role',
    'valtrim.complete_google_calendar_connection(uuid,text,text,text,text)',
    'execute'
  ),
  'Service role can complete a Google Calendar connection'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'valtrim.complete_google_calendar_connection(uuid,text,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'valtrim.complete_google_calendar_connection(uuid,text,text,text,text)',
    'execute'
  ),
  'Browser roles cannot call the Vault-writing completion boundary'
);
select ok(
  not has_function_privilege(
    'public',
    'private.delete_google_calendar_refresh_token()',
    'execute'
  ),
  'The Vault cleanup trigger cannot be called publicly'
);
select ok(
  to_regclass('valtrim.google_oauth_states_user_expiry_idx') is not null,
  'OAuth state cleanup has a supporting index'
);
select ok(
  to_regclass('valtrim.google_calendar_connections_calendar_uq') is not null,
  'A Google calendar cannot be linked twice'
);
select is(
  obj_description(
    'valtrim.complete_google_calendar_connection(uuid,text,text,text,text)'::regprocedure,
    'pg_proc'
  ),
  'Service-role-only boundary that encrypts a Google refresh token in Vault and records its dedicated calendar.',
  'The privileged completion boundary documents its purpose'
);

select * from finish();

rollback;
