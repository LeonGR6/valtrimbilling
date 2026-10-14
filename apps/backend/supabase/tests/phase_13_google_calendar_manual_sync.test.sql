begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

select has_table(
  'valtrim',
  'google_calendar_event_links',
  'Google Calendar event mappings are persisted'
);
select ok(
  (select relrowsecurity from pg_class where oid =
    'valtrim.google_calendar_event_links'::regclass),
  'Google Calendar event mappings have RLS enabled'
);
select policies_are(
  'valtrim',
  'google_calendar_event_links',
  array[]::text[],
  'Event mappings expose no browser policies'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'valtrim.google_calendar_event_links',
    'select'
  )
  and not has_table_privilege(
    'authenticated',
    'valtrim.google_calendar_event_links',
    'insert'
  )
  and not has_table_privilege(
    'authenticated',
    'valtrim.google_calendar_event_links',
    'update'
  )
  and not has_table_privilege(
    'authenticated',
    'valtrim.google_calendar_event_links',
    'delete'
  ),
  'Browser clients cannot access event mappings'
);
select ok(
  has_table_privilege('service_role', 'valtrim.google_calendar_event_links', 'select')
  and has_table_privilege('service_role', 'valtrim.google_calendar_event_links', 'insert')
  and has_table_privilege('service_role', 'valtrim.google_calendar_event_links', 'update')
  and has_table_privilege('service_role', 'valtrim.google_calendar_event_links', 'delete'),
  'The Edge Function service role can maintain event mappings'
);
select has_pk(
  'valtrim',
  'google_calendar_event_links',
  'Each user and Production schedule has one event mapping'
);
select has_index(
  'valtrim',
  'google_calendar_event_links',
  'google_calendar_event_links_google_event_uq',
  'Google event IDs are unique inside a connected calendar'
);
select has_index(
  'valtrim',
  'google_calendar_event_links',
  'google_calendar_event_links_status_idx',
  'Event mapping status lookups are indexed'
);
select has_function(
  'valtrim',
  'begin_google_calendar_sync',
  array['uuid'],
  'The service-only sync snapshot boundary is available'
);
select has_function(
  'valtrim',
  'finish_google_calendar_sync',
  array[
    'uuid', 'jsonb', 'integer', 'integer', 'integer', 'integer', 'integer',
    'text', 'boolean'
  ],
  'The service-only sync result boundary is available'
);
select ok(
  (select prosecdef from pg_proc where oid =
    'valtrim.begin_google_calendar_sync(uuid)'::regprocedure),
  'The snapshot boundary uses definer rights for Vault access'
);
select ok(
  (select prosecdef from pg_proc where oid =
    'valtrim.finish_google_calendar_sync(uuid,jsonb,integer,integer,integer,integer,integer,text,boolean)'::regprocedure),
  'The result boundary uses definer rights for protected writes'
);
select ok(
  coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'valtrim.begin_google_calendar_sync(uuid)'::regprocedure
  ), false),
  'The snapshot boundary pins an empty search path'
);
select ok(
  coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid =
      'valtrim.finish_google_calendar_sync(uuid,jsonb,integer,integer,integer,integer,integer,text,boolean)'::regprocedure
  ), false),
  'The result boundary pins an empty search path'
);
select ok(
  has_function_privilege(
    'service_role',
    'valtrim.begin_google_calendar_sync(uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'valtrim.finish_google_calendar_sync(uuid,jsonb,integer,integer,integer,integer,integer,text,boolean)',
    'execute'
  ),
  'Only the server role receives the synchronization RPC grants'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'valtrim.begin_google_calendar_sync(uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'valtrim.finish_google_calendar_sync(uuid,jsonb,integer,integer,integer,integer,integer,text,boolean)',
    'execute'
  ),
  'Authenticated browser clients cannot invoke privileged sync RPCs'
);
select has_column(
  'valtrim',
  'google_calendar_connections',
  'last_sync_at',
  'Connections record the last manual synchronization time'
);
select has_column(
  'valtrim',
  'google_calendar_connections',
  'last_sync_status',
  'Connections record the last manual synchronization outcome'
);
select ok(
  has_column_privilege(
    'authenticated',
    'valtrim.google_calendar_connections',
    'last_sync_status',
    'select'
  ),
  'Authenticated owners can read safe synchronization metadata subject to RLS'
);
select is(
  obj_description('valtrim.google_calendar_event_links'::regclass, 'pg_class'),
  'Server-only mapping from a persisted Production schedule to its Google Calendar event.',
  'The mapping table documents its server-only boundary'
);

select * from finish();

rollback;
