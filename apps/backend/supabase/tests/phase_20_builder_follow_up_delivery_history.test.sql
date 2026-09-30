begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

select has_column(
  'valtrim',
  'builder_follow_up_queue',
  'confirmed_at',
  'The queue exposes the current confirmation timestamp'
);
select has_column(
  'valtrim',
  'builder_follow_up_queue',
  'last_response_at',
  'The queue exposes the latest Jobsite response timestamp'
);

select ok(
  pg_get_viewdef('valtrim.builder_follow_up_queue'::regclass, true)
    like '%WHEN email.status%''SENT''%THEN ''SENT''%',
  'Sent emails remain visible in the operator queue'
);
select ok(
  pg_get_viewdef('valtrim.builder_follow_up_queue'::regclass, true)
    like '%checkpoint.status%''PENDING''%'
  and pg_get_viewdef('valtrim.builder_follow_up_queue'::regclass, true)
    like '%checkpoint.status%''COMPLETED''%',
  'The queue contains both scheduled and successfully sent checkpoints'
);
select ok(
  coalesce((
    select reloptions @> array['security_invoker=true']
    from pg_class
    where oid = 'valtrim.builder_follow_up_queue'::regclass
  ), false),
  'The expanded queue continues to preserve caller RLS'
);
select ok(
  has_table_privilege('authenticated', 'valtrim.builder_follow_up_queue', 'select'),
  'Authenticated app users keep read access to the queue'
);

select ok(
  pg_get_functiondef(
    'private.refresh_builder_follow_up_checkpoints()'::regprocedure
  ) not like '%state.status = ''CONFIRMED''%',
  'Refreshing checkpoints does not close or suppress future reminders after confirmation'
);
select ok(
  pg_get_functiondef(
    'private.record_builder_follow_up_status(bigint,text,text)'::regprocedure
  ) not like '%p_status in (''CONFIRMED'', ''ON_HOLD''%',
  'Manual confirmation does not close pending checkpoints'
);
select ok(
  pg_get_functiondef(
    'valtrim.prepare_builder_follow_up_email(bigint,boolean)'::regprocedure
  ) not like '%v_checkpoint.follow_up_status = ''CONFIRMED''%',
  'A later checkpoint remains sendable after an earlier confirmation'
);
select ok(
  pg_get_functiondef(
    'valtrim.submit_builder_follow_up_response(uuid,text,date,text)'::regprocedure
  ) not like '%set status = ''SKIPPED''%'
  and lower(pg_get_functiondef(
    'valtrim.submit_builder_follow_up_response(uuid,text,date,text)'::regprocedure
  )) !~ 'state\.status\s+not\s+in\s*\(\s*''confirmed''',
  'Secure confirmations can be repeated from later checkpoints without deleting the matrix'
);

select * from finish();

rollback;
