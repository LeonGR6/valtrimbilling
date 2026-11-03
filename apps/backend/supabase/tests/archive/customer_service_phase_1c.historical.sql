-- Historical route approval retired by 20261021141000. Retirement and the
-- absence of appointment creation are covered by the cleanup and ready suites.
begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

select has_column(
  'valtrim',
  'service_appointments',
  'approved_proposal_id',
  'Appointments retain the approved route source'
);

select has_column(
  'valtrim',
  'service_appointments',
  'manual_adjustment_reason',
  'Appointments retain the exceptional adjustment reason'
);

select has_index(
  'valtrim',
  'service_appointments',
  'service_appointments_approved_proposal_request_uq',
  'A proposal cannot create the same request appointment twice'
);

select ok(
  exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid =
      'valtrim.service_appointments'::regclass
      and constraint_record.contype = 'c'
      and constraint_record.conname =
        'service_appointments_manual_adjustment_reason_check'
  ),
  'Blank manual adjustment reasons are rejected'
);

select ok(
  exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid =
      'valtrim.service_schedule_proposals'::regclass
      and constraint_record.contype = 'c'
      and constraint_record.conname =
        'service_schedule_proposals_review_check'
  ),
  'Reviewed proposal states require reviewer metadata'
);

select has_function(
  'valtrim',
  'approve_service_schedule_proposal',
  array['bigint', 'jsonb', 'text'],
  'Dispatchers have one route approval RPC'
);

select has_function(
  'private',
  'approve_service_schedule_proposal_internal',
  array['bigint', 'jsonb', 'text'],
  'Transactional approval implementation stays private'
);

select ok(
  (
    select function_record.prosecdef
    from pg_proc function_record
    where function_record.oid =
      'valtrim.approve_service_schedule_proposal(bigint,jsonb,text)'::regprocedure
  ),
  'The approval RPC uses definer rights for its atomic writes'
);

select ok(
  (
    select function_record.prosecdef
    from pg_proc function_record
    where function_record.oid =
      'private.approve_service_schedule_proposal_internal(bigint,jsonb,text)'::regprocedure
  ),
  'The private approval implementation uses definer rights'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.approve_service_schedule_proposal(bigint,jsonb,text)',
    'execute'
  ),
  'Authenticated dispatchers can invoke approval subject to its role check'
);

select ok(
  not has_function_privilege(
    'anon',
    'valtrim.approve_service_schedule_proposal(bigint,jsonb,text)',
    'execute'
  ),
  'Anonymous users cannot approve routes'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.approve_service_schedule_proposal_internal(bigint,jsonb,text)',
    'execute'
  ),
  'Browser clients cannot invoke the private approval implementation'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'valtrim.replace_current_service_appointment(bigint,timestamp with time zone,timestamp with time zone,bigint,text,uuid)',
    'execute'
  ),
  'The legacy reason-free scheduling helper is not exposed'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'valtrim.service_appointments',
    'starts_at',
    'insert'
  ),
  'Browser clients still cannot insert appointments directly'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'valtrim.service_schedule_proposals',
    'status',
    'update'
  ),
  'Browser clients cannot approve a proposal with a direct update'
);

select ok(
  pg_get_functiondef(
    'private.approve_service_schedule_proposal_internal(bigint,jsonb,text)'::regprocedure
  ) like '%confirmation_status%NOT_SENT%',
  'Approval creates appointments with confirmation status NOT_SENT'
);

select ok(
  pg_get_functiondef(
    'private.approve_service_schedule_proposal_internal(bigint,jsonb,text)'::regprocedure
  ) like '%confirmation_sent_at%',
  'Approval explicitly leaves confirmation_sent_at empty'
);

select ok(
  pg_get_functiondef(
    'private.approve_service_schedule_proposal_internal(bigint,jsonb,text)'::regprocedure
  ) like '%status = ''REJECTED''%',
  'Approving an option rejects the competing alternatives'
);

select throws_ok(
  $$
    select valtrim.approve_service_schedule_proposal(1, '[]'::jsonb, null)
  $$,
  '42501',
  'You do not have permission to manage Customer Service requests',
  'Approval rejects callers without a scheduling role'
);

select * from finish();

rollback;
