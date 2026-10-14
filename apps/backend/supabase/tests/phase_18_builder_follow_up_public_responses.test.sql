begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

select has_table(
  'valtrim',
  'builder_follow_up_response_tokens',
  'Public response token lifecycle is persisted'
);
select has_table(
  'valtrim',
  'builder_follow_up_reschedule_requests',
  'Superintendent requested dates are persisted'
);
select has_view(
  'valtrim',
  'builder_follow_up_reschedule_queue',
  'Scheduling has a requested-date review queue'
);

select ok(
  (select relrowsecurity from pg_class where oid =
    'valtrim.builder_follow_up_response_tokens'::regclass)
  and (select relrowsecurity from pg_class where oid =
    'valtrim.builder_follow_up_reschedule_requests'::regclass),
  'Both new tables have RLS enabled'
);

select set_eq(
  $$
    select tablename || ':' || policyname
    from pg_policies
    where schemaname = 'valtrim'
      and tablename in (
        'builder_follow_up_response_tokens',
        'builder_follow_up_reschedule_requests'
      )
  $$,
  $$ values
    ('builder_follow_up_reschedule_requests:builder_follow_up_reschedule_requests_select')
  $$,
  'Only requested dates expose an active-user read policy'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'valtrim.builder_follow_up_response_tokens',
    'select'
  )
  and not has_table_privilege(
    'authenticated',
    'valtrim.builder_follow_up_reschedule_requests',
    'insert'
  ),
  'Browser clients cannot read tokens or insert requested dates directly'
);

select ok(
  has_table_privilege(
    'authenticated',
    'valtrim.builder_follow_up_reschedule_requests',
    'select'
  )
  and has_table_privilege(
    'authenticated',
    'valtrim.builder_follow_up_reschedule_queue',
    'select'
  ),
  'Authenticated users can read the RLS-backed review queue'
);

select ok(
  coalesce((
    select reloptions @> array['security_invoker=true']
    from pg_class
    where oid = 'valtrim.builder_follow_up_reschedule_queue'::regclass
  ), false),
  'The requested-date view preserves caller RLS with security_invoker'
);

select has_function(
  'valtrim',
  'issue_builder_follow_up_response_token',
  array['bigint'],
  'The email service can issue one stable public response id'
);
select has_function(
  'valtrim',
  'get_builder_follow_up_response',
  array['uuid'],
  'The response service can read a validated response snapshot'
);
select has_function(
  'valtrim',
  'submit_builder_follow_up_response',
  array['uuid', 'text', 'date', 'text'],
  'The response service can submit an explicit response'
);
select has_function(
  'valtrim',
  'resolve_builder_follow_up_reschedule_request',
  array['bigint', 'text', 'text'],
  'Scheduling can resolve a requested date'
);

select ok(
  (select prosecdef from pg_proc where oid =
    'valtrim.issue_builder_follow_up_response_token(bigint)'::regprocedure)
  and (select prosecdef from pg_proc where oid =
    'valtrim.get_builder_follow_up_response(uuid)'::regprocedure)
  and (select prosecdef from pg_proc where oid =
    'valtrim.submit_builder_follow_up_response(uuid,text,date,text)'::regprocedure)
  and (select prosecdef from pg_proc where oid =
    'valtrim.resolve_builder_follow_up_reschedule_request(bigint,text,text)'::regprocedure),
  'Every privileged response boundary uses definer rights'
);

select ok(
  coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'valtrim.issue_builder_follow_up_response_token(bigint)'::regprocedure
  ), false)
  and coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'valtrim.get_builder_follow_up_response(uuid)'::regprocedure
  ), false)
  and coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'valtrim.submit_builder_follow_up_response(uuid,text,date,text)'::regprocedure
  ), false)
  and coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'valtrim.resolve_builder_follow_up_reschedule_request(bigint,text,text)'::regprocedure
  ), false),
  'Every response definer boundary pins an empty search path'
);

select ok(
  has_function_privilege(
    'service_role',
    'valtrim.issue_builder_follow_up_response_token(bigint)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'valtrim.get_builder_follow_up_response(uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'valtrim.submit_builder_follow_up_response(uuid,text,date,text)',
    'execute'
  ),
  'The Edge Functions can use the token and response boundaries'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'valtrim.issue_builder_follow_up_response_token(bigint)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'valtrim.get_builder_follow_up_response(uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'valtrim.submit_builder_follow_up_response(uuid,text,date,text)',
    'execute'
  ),
  'Signed response service RPCs are not browser-callable'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.resolve_builder_follow_up_reschedule_request(bigint,text,text)',
    'execute'
  ),
  'Authenticated users receive only the role-checked review RPC'
);

select col_is_unique(
  'valtrim',
  'builder_follow_up_response_tokens',
  'public_id',
  'Every signed link has a unique public id'
);
select col_is_unique(
  'valtrim',
  'builder_follow_up_response_tokens',
  'outbox_id',
  'One stable response id exists per email outbox item'
);
select col_is_unique(
  'valtrim',
  'builder_follow_up_reschedule_requests',
  'response_token_id',
  'One requested date exists per submitted response token'
);

select has_index(
  'valtrim',
  'builder_follow_up_response_tokens',
  'builder_follow_up_response_tokens_expiry_idx',
  'Active token expiry lookups use a partial index'
);
select has_index(
  'valtrim',
  'builder_follow_up_reschedule_requests',
  'builder_follow_up_reschedule_requests_pending_idx',
  'Only one pending requested date exists per schedule and source date'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'valtrim.builder_follow_up_response_tokens'::regclass
      and tgname = 'builder_follow_up_response_tokens_set_updated_at'
      and not tgisinternal
  )
  and exists (
    select 1 from pg_trigger
    where tgrelid = 'valtrim.builder_follow_up_reschedule_requests'::regclass
      and tgname = 'builder_follow_up_reschedule_requests_set_updated_at'
      and not tgisinternal
  ),
  'Response and requested-date updates maintain updated_at'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.builder_follow_up_states'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%RESCHEDULE_REQUESTED%'
  ),
  'Follow-up state distinguishes a requested date from a completed reschedule'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.builder_follow_up_events'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%NOT_READY%'
  ),
  'The audit log records an explicit Not ready response'
);

select ok(
  not has_sequence_privilege(
    'authenticated',
    'valtrim.builder_follow_up_response_tokens_id_seq',
    'usage'
  )
  and not has_sequence_privilege(
    'authenticated',
    'valtrim.builder_follow_up_reschedule_requests_id_seq',
    'usage'
  ),
  'Browser clients cannot allocate response or request identities'
);

select is(
  obj_description('valtrim.builder_follow_up_response_tokens'::regclass, 'pg_class'),
  'Server-only lifecycle for signed Superintendent response links; raw signed tokens are never persisted.',
  'The token table documents that raw signed links are not stored'
);

select * from finish();

rollback;
