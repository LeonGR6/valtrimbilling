begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

select has_table('valtrim', 'change_orders', 'There is a table of Change Orders');
select has_table('valtrim', 'change_order_lines', 'A Change Order has a table of lines');
select has_table('valtrim', 'change_order_status_history', 'A Change Order keeps the history of its status');

select ok(
  (
    select array_agg(enumlabel::text order by enumsortorder)
    from pg_enum
    where enumtypid = 'valtrim.change_order_status'::regtype
  ) = array['DRAFT', 'PENDING', 'APPROVED', 'CANCELLED'],
  'A Change Order is Draft, Pending, Approved or Cancelled'
);

select ok(
  exists (
    select 1
    from pg_attrdef default_value
    join pg_attribute column_info
      on column_info.attrelid = default_value.adrelid
     and column_info.attnum = default_value.adnum
    where default_value.adrelid = 'valtrim.change_orders'::regclass
      and column_info.attname = 'change_order_number'
      and pg_get_expr(default_value.adbin, default_value.adrelid) like '%next_change_order_number%'
  )
  and exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.change_orders'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (change_order_number)'
  ),
  'Every Change Order gets its own number, CO-0001, CO-0002 ...'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.change_orders'::regclass
      and contype = 'f'
      and confrelid = 'valtrim.jobs'::regclass
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (job_id, builder_id)%'
      and confdeltype = 'r'
  ),
  'A Change Order belongs to a Job and to the Builder of that Job, and the Job cannot be deleted under it'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.change_order_lines'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'
  )
  and exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.change_order_lines'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (change_order_id, lot_id)'
  ),
  'A line has an id of its own, and a Lot is in a Change Order only once'
);

select ok(
  (
    select count(*) = 3
    from pg_constraint
    where conrelid = 'valtrim.change_order_lines'::regclass
      and contype = 'f'
      and confdeltype = 'r'
      and pg_get_constraintdef(oid) in (
        'FOREIGN KEY (change_order_id, job_id) REFERENCES valtrim.change_orders(id, job_id) ON DELETE RESTRICT',
        'FOREIGN KEY (lot_id, phase_id) REFERENCES valtrim.lots(id, phase_id) ON DELETE RESTRICT',
        'FOREIGN KEY (phase_id, job_id) REFERENCES valtrim.phases(id, job_id) ON DELETE RESTRICT'
      )
  ),
  'A line points at a Lot of its Phase and Job, and none of them can be deleted under it'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.change_order_lines'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%amount <> (0)::numeric%'
  ),
  'A line cannot have an Amount of zero, and a negative Amount is a credit'
);

select ok(
  (
    select count(*) = 4
    from information_schema.columns
    where table_schema = 'valtrim'
      and table_name = 'change_order_lines'
      and column_name in ('scope_of_work', 'amount', 'line_number', 'job_id')
      and is_nullable = 'NO'
  ),
  'Every line has a Scope of Work, an Amount, a place in the order and a Job'
);

select ok(
  (
    select count(*) = 7
    from information_schema.columns
    where table_schema = 'valtrim'
      and table_name = 'change_order_lines'
      and column_name in (
        'lot_id', 'phase_id', 'phase_code', 'lot_number', 'plan_code', 'plan_name', 'location'
      )
      and is_nullable = 'YES'
  )
  and exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.change_order_lines'::regclass
      and contype = 'c'
      and conname = 'change_order_lines_lot_or_location'
      and pg_get_constraintdef(oid) like '%location IS NULL%'
      and pg_get_constraintdef(oid) like '%location IS NOT NULL%'
  ),
  'A line is a Lot with its copied labels, or a place in words with no Lot, Phase or Plan'
);

select ok(
  (
    select bool_and(relrowsecurity)
    from pg_class
    where oid in (
      'valtrim.change_orders'::regclass,
      'valtrim.change_order_lines'::regclass,
      'valtrim.change_order_status_history'::regclass
    )
  )
  and not has_table_privilege('authenticated', 'valtrim.change_orders', 'INSERT')
  and not has_table_privilege('authenticated', 'valtrim.change_orders', 'UPDATE')
  and not has_table_privilege('authenticated', 'valtrim.change_orders', 'DELETE')
  and not has_table_privilege('authenticated', 'valtrim.change_order_lines', 'INSERT')
  and not has_table_privilege('authenticated', 'valtrim.change_order_lines', 'UPDATE')
  and not has_table_privilege('authenticated', 'valtrim.change_order_lines', 'DELETE')
  and not has_table_privilege('authenticated', 'valtrim.change_order_status_history', 'INSERT')
  and has_table_privilege('authenticated', 'valtrim.change_orders', 'SELECT')
  and not has_table_privilege('anon', 'valtrim.change_orders', 'SELECT'),
  'The browser only reads: every write goes through a function'
);

select ok(
  (
    select count(*) = 3
    from pg_policies
    where schemaname = 'valtrim'
      and tablename in ('change_orders', 'change_order_lines', 'change_order_status_history')
      and cmd = 'SELECT'
      and qual like '%is_active_user%'
  ),
  'Every active user reads Change Orders'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'valtrim.change_orders'::regclass
      and tgname = 'change_orders_guard_update'
      and pg_get_triggerdef(oid) like '%BEFORE UPDATE%'
  )
  and exists (
    select 1
    from pg_trigger
    where tgrelid = 'valtrim.change_order_lines'::regclass
      and tgname = 'change_order_lines_guard_change'
      and pg_get_triggerdef(oid) like '%INSERT OR DELETE OR UPDATE%'
  )
  and exists (
    select 1
    from pg_trigger
    where tgrelid = 'valtrim.change_orders'::regclass
      and tgname = 'change_orders_record_status'
      and pg_get_triggerdef(oid) like '%INSERT OR UPDATE OF status%'
  ),
  'The database guards the status, freezes an approved Change Order and writes the history itself'
);

select ok(
  private.change_order_transition_allowed('DRAFT', 'PENDING')
  and private.change_order_transition_allowed('PENDING', 'DRAFT')
  and private.change_order_transition_allowed('PENDING', 'APPROVED')
  and private.change_order_transition_allowed('APPROVED', 'CANCELLED')
  and not private.change_order_transition_allowed('APPROVED', 'PENDING')
  and not private.change_order_transition_allowed('APPROVED', 'DRAFT')
  and not private.change_order_transition_allowed('CANCELLED', 'DRAFT')
  and not private.change_order_transition_allowed('CANCELLED', 'PENDING'),
  'Approved goes only to Cancelled, and Cancelled is final'
);

select ok(
  coalesce((
    select procedure.prosecdef
      and procedure.prosrc like '%has_app_role(''ADMIN'', ''PROJECT_MANAGEMENT'')%'
      and procedure.prosrc like '%(select auth.uid())%'
      and procedure.prosrc like '%has_app_role(''ADMIN'')%'
    from pg_proc procedure
    where procedure.oid = 'private.create_change_order(bigint,text,text,jsonb,text,date,date,jsonb,valtrim.change_order_status)'::regprocedure
  ), false)
  and coalesce((
    select procedure.prosrc like '%has_app_role(''ADMIN'', ''PROJECT_MANAGEMENT'')%'
      and procedure.prosrc like '%has_app_role(''ADMIN'')%'
      and procedure.prosrc like '%Write the reason for cancelling%'
    from pg_proc procedure
    where procedure.oid = 'private.set_change_order_status(bigint,valtrim.change_order_status,text)'::regprocedure
  ), false),
  'ADMIN and PROJECT_MANAGEMENT write Change Orders as the signed-in user; only ADMIN approves, and cancelling needs a reason'
);

select ok(
  has_function_privilege('authenticated', 'valtrim.create_change_order(bigint,text,text,jsonb,text,date,date,jsonb,valtrim.change_order_status)', 'execute')
  and has_function_privilege('authenticated', 'valtrim.update_change_order(bigint,bigint,text,text,jsonb,text,date,date,jsonb)', 'execute')
  and has_function_privilege('authenticated', 'valtrim.set_change_order_status(bigint,valtrim.change_order_status,text)', 'execute')
  and not has_function_privilege('anon', 'valtrim.create_change_order(bigint,text,text,jsonb,text,date,date,jsonb,valtrim.change_order_status)', 'execute')
  and not has_function_privilege('authenticated', 'private.replace_change_order_lines(bigint,bigint,jsonb,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.next_change_order_number()', 'execute'),
  'Signed-in users call the three writers; nobody calls the helpers, and anonymous users call nothing'
);

select ok(
  has_function_privilege('authenticated', 'valtrim.next_change_order_number()', 'execute')
  and not has_function_privilege('anon', 'valtrim.next_change_order_number()', 'execute')
  and not has_function_privilege('authenticated', 'private.format_change_order_number(bigint)', 'execute')
  and coalesce((
    select procedure.prosecdef
      and procedure.prosrc like '%has_app_role(''ADMIN'', ''PROJECT_MANAGEMENT'')%'
      and procedure.prosrc like '%(select auth.uid())%'
    from pg_proc procedure
    where procedure.oid = 'private.peek_change_order_number()'::regprocedure
  ), false),
  'Whoever can create a Change Order can see the next number; nobody else, and nobody can use the helper'
);

select ok(
  private.format_change_order_number(1) = 'CO-0001'
  and private.format_change_order_number(42) = 'CO-0042'
  and private.format_change_order_number(9999) = 'CO-9999'
  and private.format_change_order_number(10000) = 'CO-10000',
  'A number is written CO-0001, with more than four digits once it passes 9999'
);

select ok(
  has_function_privilege('authenticated', 'valtrim.delete_change_order(bigint)', 'execute')
  and not has_function_privilege('anon', 'valtrim.delete_change_order(bigint)', 'execute')
  and coalesce((
    select procedure.prosecdef
      and procedure.prosrc like '%has_app_role(''ADMIN'', ''PROJECT_MANAGEMENT'')%'
      and procedure.prosrc like '%(select auth.uid())%'
      and procedure.prosrc like '%Only a Draft Change Order can be deleted%'
    from pg_proc procedure
    where procedure.oid = 'private.delete_change_order(bigint)'::regprocedure
  ), false),
  'ADMIN and PROJECT_MANAGEMENT delete a Change Order as the signed-in user, and only a Draft; anonymous users cannot'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'valtrim' and table_name = 'change_order_lines' and column_name = 'billing_event'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'valtrim' and table_name = 'change_order_lines' and column_name = 'billing_event_date'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.change_order_lines'::regclass
      and conname in ('change_order_lines_billing_event_pair', 'change_order_lines_billing_event_on_lot')
    having count(*) = 2
  ),
  'A line can say which Calendar event (EXT, DM or HW) it is charged with, with the date it had, and only on a Lot'
);

select ok(
  has_function_privilege('authenticated', 'valtrim.change_order_lot_events(bigint)', 'execute')
  and not has_function_privilege('anon', 'valtrim.change_order_lot_events(bigint)', 'execute')
  and not has_function_privilege('anon', 'private.lot_event_dates(bigint[])', 'execute')
  and not has_function_privilege('anon', 'private.change_order_event_status(date, date)', 'execute'),
  'Signed-in users read the Calendar events of a Job''s Lots; anonymous users cannot'
);

select ok(
  private.is_us_federal_holiday('2026-07-03')
  and not private.is_us_federal_holiday('2026-07-04')
  and private.is_us_federal_holiday('2026-11-26')
  and private.business_days_ahead('2026-11-05', '2026-11-13') = 6
  and private.business_days_ahead('2026-11-23', '2026-11-30') = 4
  and private.change_order_event_status('2026-11-13', '2026-11-05') = 'AVAILABLE'
  and private.change_order_event_status('2026-11-12', '2026-11-05') = 'TOO_CLOSE'
  and private.change_order_event_status('2026-11-04', '2026-11-05') = 'PASSED',
  'An event can be charged with only when more than 5 business days (no weekends or US federal holidays) are left'
);

select * from finish();

rollback;
