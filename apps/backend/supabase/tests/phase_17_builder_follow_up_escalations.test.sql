begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

select has_table(
  'valtrim',
  'builder_follow_up_escalation_settings',
  'No-response escalation settings are persisted'
);
select has_table(
  'valtrim',
  'builder_follow_up_escalations',
  'No-response escalation delivery attempts are persisted'
);
select has_view(
  'valtrim',
  'builder_follow_up_attention_queue',
  'The immediate no-response attention queue is available'
);

select is(
  (
    select jsonb_build_object(
      'enabled', is_enabled,
      'wait', wait_business_days,
      'recipients', to_jsonb(recipient_emails)
    )
    from valtrim.builder_follow_up_escalation_settings
    where id = 1
  ),
  '{"enabled":true,"wait":2,"recipients":["andres@valtrim.com"]}'::jsonb,
  'The production default waits two business days and alerts Andres'
);

select is(
  private.add_builder_follow_up_business_days(date '2026-09-18', 2),
  date '2026-09-22',
  'Friday plus two business days lands on Tuesday'
);
select is(
  private.add_builder_follow_up_business_days(date '2026-09-21', 2),
  date '2026-09-23',
  'Monday plus two business days lands on Wednesday'
);

select ok(
  (select relrowsecurity from pg_class where oid =
    'valtrim.builder_follow_up_escalation_settings'::regclass)
  and (select relrowsecurity from pg_class where oid =
    'valtrim.builder_follow_up_escalations'::regclass),
  'Every exposed escalation table has RLS enabled'
);

select set_eq(
  $$
    select tablename || ':' || policyname
    from pg_policies
    where schemaname = 'valtrim'
      and tablename in (
        'builder_follow_up_escalation_settings',
        'builder_follow_up_escalations'
      )
  $$,
  $$ values
    ('builder_follow_up_escalation_settings:builder_follow_up_escalation_settings_select'),
    ('builder_follow_up_escalations:builder_follow_up_escalations_select')
  $$,
  'Escalation tables expose only active-user read policies'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'valtrim.builder_follow_up_escalation_settings',
    'update'
  )
  and not has_table_privilege(
    'authenticated',
    'valtrim.builder_follow_up_escalations',
    'insert'
  ),
  'Browser clients cannot mutate escalation configuration or outbox rows directly'
);

select ok(
  has_table_privilege(
    'authenticated',
    'valtrim.builder_follow_up_attention_queue',
    'select'
  ),
  'Authenticated users can read the immediate attention queue'
);

select ok(
  coalesce((
    select reloptions @> array['security_invoker=true']
    from pg_class
    where oid = 'valtrim.builder_follow_up_attention_queue'::regclass
  ), false),
  'The attention view preserves caller RLS with security_invoker'
);

select has_function(
  'private',
  'add_builder_follow_up_business_days',
  array['date', 'integer'],
  'The deterministic weekday offset helper is available'
);
select has_function(
  'valtrim',
  'refresh_builder_follow_up_escalations',
  array[]::text[],
  'The role-checked escalation refresh RPC is available'
);
select has_function(
  'valtrim',
  'save_builder_follow_up_escalation_settings',
  array['boolean', 'smallint', 'text[]'],
  'The Administrator escalation configuration RPC is available'
);
select has_function(
  'valtrim',
  'prepare_builder_follow_up_escalation',
  array['bigint', 'boolean'],
  'The service-only escalation snapshot and lease boundary is available'
);
select has_function(
  'valtrim',
  'finish_builder_follow_up_escalation',
  array['bigint', 'boolean', 'text', 'text', 'text', 'text', 'text'],
  'The service-only escalation result boundary is available'
);

select ok(
  not (select prosecdef from pg_proc where oid =
    'valtrim.refresh_builder_follow_up_escalations()'::regprocedure)
  and not (select prosecdef from pg_proc where oid =
    'valtrim.save_builder_follow_up_escalation_settings(boolean,smallint,text[])'::regprocedure),
  'Browser escalation RPC wrappers execute as the caller'
);

select ok(
  (select prosecdef from pg_proc where oid =
    'private.refresh_builder_follow_up_escalations()'::regprocedure)
  and (select prosecdef from pg_proc where oid =
    'private.save_builder_follow_up_escalation_settings(boolean,smallint,text[])'::regprocedure)
  and (select prosecdef from pg_proc where oid =
    'valtrim.prepare_builder_follow_up_escalation(bigint,boolean)'::regprocedure)
  and (select prosecdef from pg_proc where oid =
    'valtrim.finish_builder_follow_up_escalation(bigint,boolean,text,text,text,text,text)'::regprocedure),
  'Privileged escalation implementations use definer rights'
);

select ok(
  coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'private.refresh_builder_follow_up_escalations()'::regprocedure
  ), false)
  and coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'private.save_builder_follow_up_escalation_settings(boolean,smallint,text[])'::regprocedure
  ), false)
  and coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'valtrim.prepare_builder_follow_up_escalation(bigint,boolean)'::regprocedure
  ), false)
  and coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'valtrim.finish_builder_follow_up_escalation(bigint,boolean,text,text,text,text,text)'::regprocedure
  ), false),
  'Every escalation definer boundary pins an empty search path'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.refresh_builder_follow_up_escalations()',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'valtrim.save_builder_follow_up_escalation_settings(boolean,smallint,text[])',
    'execute'
  ),
  'Authenticated users receive only role-checked escalation RPCs'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'valtrim.prepare_builder_follow_up_escalation(bigint,boolean)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'valtrim.finish_builder_follow_up_escalation(bigint,boolean,text,text,text,text,text)',
    'execute'
  ),
  'Browser clients cannot lease or finish internal escalation deliveries'
);

select ok(
  has_function_privilege(
    'service_role',
    'valtrim.prepare_builder_follow_up_escalation(bigint,boolean)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'valtrim.finish_builder_follow_up_escalation(bigint,boolean,text,text,text,text,text)',
    'execute'
  ),
  'The Edge Function service role can use the escalation outbox boundaries'
);

select has_index(
  'valtrim',
  'builder_follow_up_escalations',
  'builder_follow_up_escalations_due_idx',
  'Due escalation lookups use a partial index'
);
select has_index(
  'valtrim',
  'builder_follow_up_escalations',
  'builder_follow_up_escalations_schedule_idx',
  'Escalation schedule lookups are indexed'
);
select has_index(
  'valtrim',
  'builder_follow_up_escalation_settings',
  'builder_follow_up_escalation_settings_updated_by_idx',
  'Escalation setting actor foreign keys are indexed'
);

select col_is_unique(
  'valtrim',
  'builder_follow_up_escalations',
  'no_response_event_id',
  'Only one internal escalation exists per no-response episode'
);
select col_is_unique(
  'valtrim',
  'builder_follow_up_escalations',
  'idempotency_key',
  'Internal escalation provider idempotency keys cannot be reused'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'valtrim.builder_follow_up_escalations'::regclass
      and tgname = 'builder_follow_up_escalations_set_updated_at'
      and not tgisinternal
  ),
  'Escalation delivery updates maintain updated_at'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'valtrim.builder_follow_up_escalation_settings'::regclass
      and tgname = 'builder_follow_up_escalation_settings_set_updated_at'
      and not tgisinternal
  ),
  'Escalation configuration updates maintain updated_at'
);

select ok(
  (select prosecdef from pg_proc where oid =
    'private.record_builder_follow_up_status(bigint,text,text)'::regprocedure)
  and coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'private.record_builder_follow_up_status(bigint,text,text)'::regprocedure
  ), false),
  'The no-response deduplication boundary remains secured'
);

select * from finish();

rollback;
