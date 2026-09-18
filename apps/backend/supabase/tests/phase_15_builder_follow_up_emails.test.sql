begin;

create extension if not exists pgtap with schema extensions;

select plan(36);

select has_table('valtrim', 'builder_follow_up_rules', 'Follow-up rules are persisted');
select has_table('valtrim', 'builder_follow_up_states', 'Per-schedule confirmation state is persisted');
select has_table('valtrim', 'builder_follow_up_checkpoints', 'Follow-up checkpoints are persisted');
select has_table('valtrim', 'builder_follow_up_emails', 'The durable email outbox is persisted');
select has_table('valtrim', 'builder_follow_up_events', 'Follow-up activity history is persisted');
select has_view('valtrim', 'builder_follow_up_queue', 'The operator queue is available');

select set_eq(
  $$
    select stage_type::text || ':' || days_before::text
    from valtrim.builder_follow_up_rules
    where is_active and not is_exception
  $$,
  $$ values
    ('DM:56'), ('DM:28'), ('DM:14'), ('DM:7'),
    ('EXT:28'), ('EXT:14'), ('EXT:7'),
    ('HW:28'), ('HW:14'), ('HW:7')
  $$,
  'The initial DM, EXT and HW matrix matches the approved calendar-day offsets'
);

select is(
  (select count(*)::integer from valtrim.builder_follow_up_rules where is_exception),
  0,
  'Exception reminders remain disabled until structured exception conditions exist'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.builder_follow_up_rules'::regclass)
  and (select relrowsecurity from pg_class where oid = 'valtrim.builder_follow_up_states'::regclass)
  and (select relrowsecurity from pg_class where oid = 'valtrim.builder_follow_up_checkpoints'::regclass)
  and (select relrowsecurity from pg_class where oid = 'valtrim.builder_follow_up_emails'::regclass)
  and (select relrowsecurity from pg_class where oid = 'valtrim.builder_follow_up_events'::regclass),
  'Every exposed follow-up table has RLS enabled'
);

select set_eq(
  $$
    select tablename || ':' || policyname
    from pg_policies
    where schemaname = 'valtrim'
      and tablename like 'builder_follow_up_%'
  $$,
  $$ values
    ('builder_follow_up_rules:builder_follow_up_rules_select'),
    ('builder_follow_up_states:builder_follow_up_states_select'),
    ('builder_follow_up_checkpoints:builder_follow_up_checkpoints_select'),
    ('builder_follow_up_emails:builder_follow_up_emails_select'),
    ('builder_follow_up_events:builder_follow_up_events_select')
  $$,
  'Follow-up tables expose only active-user read policies'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.builder_follow_up_rules', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.builder_follow_up_states', 'update')
  and not has_table_privilege('authenticated', 'valtrim.builder_follow_up_checkpoints', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.builder_follow_up_emails', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.builder_follow_up_events', 'insert'),
  'Browser clients cannot mutate follow-up state or the outbox directly'
);

select ok(
  has_table_privilege('authenticated', 'valtrim.builder_follow_up_queue', 'select'),
  'Authenticated users can read the RLS-backed queue view'
);

select ok(
  coalesce((
    select reloptions @> array['security_invoker=true']
    from pg_class
    where oid = 'valtrim.builder_follow_up_queue'::regclass
  ), false),
  'The queue view preserves caller RLS with security_invoker'
);

select has_function(
  'valtrim',
  'refresh_builder_follow_up_checkpoints',
  array[]::text[],
  'The role-checked checkpoint refresh RPC is available'
);
select has_function(
  'valtrim',
  'record_builder_follow_up_status',
  array['bigint', 'text', 'text'],
  'The role-checked response RPC is available'
);
select has_function(
  'valtrim',
  'prepare_builder_follow_up_email',
  array['bigint', 'boolean'],
  'The service-only email snapshot and lease boundary is available'
);
select has_function(
  'valtrim',
  'finish_builder_follow_up_email',
  array['bigint', 'boolean', 'text', 'text', 'text', 'text', 'text'],
  'The service-only email result boundary is available'
);

select ok(
  not (select prosecdef from pg_proc where oid =
    'valtrim.refresh_builder_follow_up_checkpoints()'::regprocedure)
  and not (select prosecdef from pg_proc where oid =
    'valtrim.record_builder_follow_up_status(bigint,text,text)'::regprocedure),
  'Browser RPC wrappers execute as the caller'
);

select ok(
  (select prosecdef from pg_proc where oid =
    'private.refresh_builder_follow_up_checkpoints()'::regprocedure)
  and (select prosecdef from pg_proc where oid =
    'private.record_builder_follow_up_status(bigint,text,text)'::regprocedure)
  and (select prosecdef from pg_proc where oid =
    'valtrim.prepare_builder_follow_up_email(bigint,boolean)'::regprocedure)
  and (select prosecdef from pg_proc where oid =
    'valtrim.finish_builder_follow_up_email(bigint,boolean,text,text,text,text,text)'::regprocedure),
  'Privileged implementations use definer rights'
);

select ok(
  coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'private.refresh_builder_follow_up_checkpoints()'::regprocedure
  ), false)
  and coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'private.record_builder_follow_up_status(bigint,text,text)'::regprocedure
  ), false)
  and coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'valtrim.prepare_builder_follow_up_email(bigint,boolean)'::regprocedure
  ), false)
  and coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'valtrim.finish_builder_follow_up_email(bigint,boolean,text,text,text,text,text)'::regprocedure
  ), false),
  'Every definer boundary pins an empty search path'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.refresh_builder_follow_up_checkpoints()',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'valtrim.record_builder_follow_up_status(bigint,text,text)',
    'execute'
  ),
  'Authenticated users receive only role-checked operator RPCs'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'valtrim.prepare_builder_follow_up_email(bigint,boolean)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'valtrim.finish_builder_follow_up_email(bigint,boolean,text,text,text,text,text)',
    'execute'
  ),
  'Browser clients cannot lease or finish outbox deliveries'
);

select ok(
  has_function_privilege(
    'service_role',
    'valtrim.prepare_builder_follow_up_email(bigint,boolean)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'valtrim.finish_builder_follow_up_email(bigint,boolean,text,text,text,text,text)',
    'execute'
  ),
  'The Edge Function service role can use the outbox boundaries'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'valtrim.production_schedules'::regclass
      and tgname = 'production_schedules_invalidate_builder_follow_up'
      and not tgisinternal
  ),
  'A Production date change invalidates prior confirmation and checkpoints'
);

select has_index(
  'valtrim',
  'builder_follow_up_checkpoints',
  'builder_follow_up_checkpoints_due_idx',
  'Due queue lookups are indexed'
);
select has_index(
  'valtrim',
  'builder_follow_up_emails',
  'builder_follow_up_emails_status_idx',
  'Email lease and retry lookups are indexed'
);
select has_index(
  'valtrim',
  'builder_follow_up_checkpoints',
  'builder_follow_up_checkpoints_rule_idx',
  'Follow-up rule foreign keys are indexed'
);
select has_index(
  'valtrim',
  'builder_follow_up_emails',
  'builder_follow_up_emails_recipient_contact_idx',
  'Snapshotted recipient foreign keys are indexed'
);
select has_index(
  'valtrim',
  'builder_follow_up_events',
  'builder_follow_up_events_checkpoint_idx',
  'Follow-up event checkpoint foreign keys are indexed'
);
select has_index(
  'valtrim',
  'builder_follow_up_events',
  'builder_follow_up_events_contact_idx',
  'Follow-up event contact foreign keys are indexed'
);

select col_is_unique(
  'valtrim',
  'builder_follow_up_emails',
  'checkpoint_id',
  'One durable outbox item exists per checkpoint'
);
select col_is_unique(
  'valtrim',
  'builder_follow_up_emails',
  'idempotency_key',
  'Provider idempotency keys cannot be reused across checkpoints'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.builder_follow_up_states'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%confirmed_for_date IS NOT NULL%'
  ),
  'A confirmed state must be bound to a specific Production date'
);

select is(
  obj_description('valtrim.builder_follow_up_emails'::regclass, 'pg_class'),
  'Server-written durable email outbox with one idempotent delivery per follow-up checkpoint.',
  'The outbox documents its server-only write boundary'
);

select ok(
  not exists (
    select 1
    from valtrim.builder_follow_up_rules
    where stage_type = 'SHUTTER'
  ),
  'Shutter is intentionally absent from the approved follow-up matrix'
);

select ok(
  not has_sequence_privilege(
    'authenticated',
    'valtrim.builder_follow_up_emails_id_seq',
    'usage'
  ),
  'Browser clients cannot allocate outbox identities'
);

select * from finish();

rollback;
