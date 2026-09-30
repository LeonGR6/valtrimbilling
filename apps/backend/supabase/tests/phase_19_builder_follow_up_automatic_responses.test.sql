begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

select has_table(
  'valtrim',
  'builder_follow_up_response_emails',
  'Response acknowledgements have a durable outbox'
);
select has_view(
  'valtrim',
  'builder_follow_up_response_history',
  'Scheduling can read recent secure Jobsite responses'
);
select has_column(
  'valtrim',
  'builder_follow_up_events',
  'response_token_id',
  'Response audit events link to their one-time response token'
);
select has_index(
  'valtrim',
  'builder_follow_up_events',
  'builder_follow_up_events_response_token_idx',
  'Each response token owns at most one explicit response audit event'
);
select has_index(
  'valtrim',
  'builder_follow_up_response_emails',
  'builder_follow_up_response_emails_delivery_idx',
  'Pending and failed response emails have a focused retry index'
);

select ok(
  (select relrowsecurity from pg_class where oid =
    'valtrim.builder_follow_up_response_emails'::regclass),
  'The response email outbox has RLS enabled'
);
select is_empty(
  $$
    select policyname
    from pg_policies
    where schemaname = 'valtrim'
      and tablename = 'builder_follow_up_response_emails'
  $$,
  'The service-only response email outbox exposes no browser policy'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'valtrim.builder_follow_up_response_emails',
    'select'
  )
  and not has_sequence_privilege(
    'authenticated',
    'valtrim.builder_follow_up_response_emails_id_seq',
    'usage'
  ),
  'Browser clients cannot read or allocate response email rows'
);
select ok(
  has_table_privilege(
    'authenticated',
    'valtrim.builder_follow_up_response_history',
    'select'
  ),
  'Authenticated app users can read recent responses'
);
select ok(
  coalesce((
    select reloptions @> array['security_invoker=true']
    from pg_class
    where oid = 'valtrim.builder_follow_up_response_history'::regclass
  ), false),
  'Recent responses preserve caller RLS with security_invoker'
);
select ok(
  pg_get_viewdef(
    'valtrim.builder_follow_up_response_history'::regclass,
    true
  ) like '%schedule.is_active%'
  and pg_get_viewdef(
    'valtrim.builder_follow_up_response_history'::regclass,
    true
  ) like '%activity.status = ''ACTIVE''%',
  'Recent responses exclude inactive schedules and cancelled Production activities'
);

select has_function(
  'valtrim',
  'prepare_builder_follow_up_response_email',
  array['bigint'],
  'The email service can acquire a response notification lease'
);
select has_function(
  'valtrim',
  'finish_builder_follow_up_response_email',
  array['bigint', 'boolean', 'text', 'text', 'text', 'text', 'text'],
  'The email service can finalize a response notification attempt'
);
select ok(
  (select prosecdef from pg_proc where oid =
    'valtrim.prepare_builder_follow_up_response_email(bigint)'::regprocedure)
  and (select prosecdef from pg_proc where oid =
    'valtrim.finish_builder_follow_up_response_email(bigint,boolean,text,text,text,text,text)'::regprocedure),
  'Response email lease boundaries use definer rights'
);
select ok(
  has_function_privilege(
    'service_role',
    'valtrim.prepare_builder_follow_up_response_email(bigint)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'valtrim.prepare_builder_follow_up_response_email(bigint)',
    'execute'
  ),
  'Only the email service can acquire response email leases'
);
select ok(
  coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'valtrim.prepare_builder_follow_up_response_email(bigint)'::regprocedure
  ), false)
  and coalesce((
    select array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'valtrim.finish_builder_follow_up_response_email(bigint,boolean,text,text,text,text,text)'::regprocedure
  ), false),
  'Response email definer functions pin an empty search path'
);

select ok(
  pg_get_functiondef(
    'valtrim.submit_builder_follow_up_response(uuid,text,date,text)'::regprocedure
  ) like '%update valtrim.production_schedules%',
  'A Not ready response updates the Production schedule in the response transaction'
);
select ok(
  pg_get_functiondef(
    'valtrim.submit_builder_follow_up_response(uuid,text,date,text)'::regprocedure
  ) like '%builder_follow_up_response_emails%',
  'Every accepted response enqueues its durable acknowledgement in the same transaction'
);
select is(
  obj_description('valtrim.builder_follow_up_response_emails'::regclass, 'pg_class'),
  'Durable acknowledgement and internal-alert outbox for explicit Superintendent responses.',
  'The response email outbox documents its delivery boundary'
);

select * from finish();

rollback;
