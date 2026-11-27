begin;

create extension if not exists pgtap with schema extensions;

select plan(36);

select has_table('valtrim', 'production_activities', 'Production activities table is available');
select has_table('valtrim', 'production_activity_lots', 'Production activity Lots table is available');
select has_table('valtrim', 'production_stages', 'Production stages table is available');
select has_table('valtrim', 'production_schedules', 'Production schedules table is available');
select has_table('valtrim', 'production_schedule_lots', 'Production schedule Lots table is available');
select has_table('valtrim', 'production_date_history', 'Production date history table is available');

select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.production_activities'::regclass),
  'Production activities have RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.production_activity_lots'::regclass),
  'Production activity Lots have RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.production_stages'::regclass),
  'Production stages have RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.production_schedules'::regclass),
  'Production schedules have RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.production_schedule_lots'::regclass),
  'Production schedule Lots have RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.production_date_history'::regclass),
  'Production date history has RLS enabled'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.production_activities', 'id', 'select'),
  'Authenticated users can select Production activity identities subject to RLS'
);
select ok(
  has_column_privilege('authenticated', 'valtrim.production_activity_lots', 'lot_id', 'select'),
  'Authenticated users can select Production activity Lots subject to RLS'
);
select ok(
  has_column_privilege('authenticated', 'valtrim.production_stages', 'stage_type', 'select'),
  'Authenticated users can select Production stages subject to RLS'
);
select ok(
  has_column_privilege('authenticated', 'valtrim.production_schedules', 'scheduled_date', 'select'),
  'Authenticated users can select Production dates subject to RLS'
);
select ok(
  has_column_privilege('authenticated', 'valtrim.production_schedule_lots', 'lot_id', 'select'),
  'Authenticated users can select Production schedule Lots subject to RLS'
);
select ok(
  has_column_privilege('authenticated', 'valtrim.production_date_history', 'previous_note', 'select'),
  'Authenticated users can select the persisted date audit subject to RLS'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.production_activities', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.production_activities', 'update')
  and not has_table_privilege('authenticated', 'valtrim.production_activities', 'delete')
  and not has_table_privilege('authenticated', 'valtrim.production_activity_lots', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.production_stages', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.production_schedules', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.production_schedule_lots', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.production_date_history', 'insert'),
  'Browser clients cannot mutate Production tables directly'
);

select ok(
  not has_sequence_privilege('authenticated', 'valtrim.production_activities_id_seq', 'usage')
  and not has_sequence_privilege('authenticated', 'valtrim.production_stages_id_seq', 'usage')
  and not has_sequence_privilege('authenticated', 'valtrim.production_schedules_id_seq', 'usage')
  and not has_sequence_privilege('authenticated', 'valtrim.production_date_history_id_seq', 'usage'),
  'Only the atomic Production saver can allocate identities'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.save_builder_date_configuration(bigint,smallint,smallint,smallint)',
    'execute'
  ),
  'Authenticated users can call the role-checked Builder date configuration saver'
);
select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.save_production_activity(bigint,bigint,bigint[],jsonb,text)',
    'execute'
  ),
  'Authenticated users can call the role-checked Production saver'
);
select ok(
  not has_function_privilege(
    'anon',
    'valtrim.save_builder_date_configuration(bigint,smallint,smallint,smallint)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'valtrim.save_production_activity(bigint,bigint,bigint[],jsonb,text)',
    'execute'
  ),
  'Anonymous clients cannot call Calendar mutation RPCs'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'valtrim.create_production_activity(bigint,jsonb,bigint[],text,uuid)',
    'execute'
  ),
  'The legacy actor-parameter Production creator stays closed'
);

select ok(
  (select prosecdef from pg_proc where oid =
    'private.save_builder_date_configuration(bigint,smallint,smallint,smallint)'::regprocedure)
  and (select prosecdef from pg_proc where oid =
    'private.save_production_activity(bigint,bigint,bigint[],jsonb,text)'::regprocedure),
  'Private Calendar mutation implementations use definer rights after role checks'
);
select ok(
  not (select prosecdef from pg_proc where oid =
    'valtrim.save_builder_date_configuration(bigint,smallint,smallint,smallint)'::regprocedure)
  and not (select prosecdef from pg_proc where oid =
    'valtrim.save_production_activity(bigint,bigint,bigint[],jsonb,text)'::regprocedure),
  'Exposed Calendar RPC wrappers run as the caller'
);
select ok(
  coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'private.save_builder_date_configuration(bigint,smallint,smallint,smallint)'::regprocedure
  ), false)
  and coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'private.save_production_activity(bigint,bigint,bigint[],jsonb,text)'::regprocedure
  ), false),
  'Private Calendar mutation implementations pin an empty search path'
);

select is(
  (
    select column_default::text
    from information_schema.columns
    where table_schema = 'valtrim'
      and table_name = 'builders'
      and column_name = 'ext_to_dm_weeks'
  ),
  '4'::text,
  'New Builders default EXT to DM to four weeks'
);
select has_column('valtrim', 'production_date_history', 'previous_note', 'Date history stores the previous note');
select has_column('valtrim', 'production_date_history', 'new_note', 'Date history stores the replacement note');

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.production_schedules'::regclass
      and conname = 'production_schedules_note_length_check'
      and contype = 'c'
  ),
  'Production schedule notes have a database length boundary'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'valtrim.production_schedules'::regclass
      and tgname = 'production_schedules_history'
      and not tgisinternal
  ),
  'Production date changes retain their database audit trigger'
);

select set_eq(
  $$
    select tablename || ':' || policyname
    from pg_policies
    where schemaname = 'valtrim'
      and tablename in (
        'production_activities',
        'production_activity_lots',
        'production_stages',
        'production_schedules',
        'production_schedule_lots',
        'production_date_history'
      )
  $$,
  $$ values
    ('production_activities:production_activities_select'),
    ('production_activity_lots:production_activity_lots_select'),
    ('production_stages:production_stages_select'),
    ('production_schedules:production_schedules_select'),
    ('production_schedule_lots:production_schedule_lots_select'),
    ('production_date_history:production_date_history_select')
  $$,
  'Opened Production tables expose only active-user read policies'
);

select ok(
  to_regclass('valtrim.production_activities_created_by_idx') is not null
  and to_regclass('valtrim.production_activities_updated_by_idx') is not null
  and to_regclass('valtrim.production_schedules_created_by_idx') is not null
  and to_regclass('valtrim.production_schedules_updated_by_idx') is not null
  and to_regclass('valtrim.production_date_history_changed_by_idx') is not null,
  'Opened Production audit foreign keys have covering indexes'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.service_requests', 'select')
  and not has_table_privilege('authenticated', 'valtrim.service_requests', 'insert'),
  'Customer Service remains closed'
);
select ok(
  to_regclass('valtrim.change_orders') is null
  and to_regclass('valtrim.extra_orders') is null,
  'Extra and Change Orders remain outside the persisted schema'
);

select * from finish();

rollback;
