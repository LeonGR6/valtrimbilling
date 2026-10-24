begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.draw_packages'::regclass
      and conname = 'draw_packages_package_type_check'
      and pg_get_constraintdef(oid) like '%PRICE_ADJUSTMENT%'
      and pg_get_constraintdef(oid) like '%RETENTION_RELEASE%'
      and pg_get_constraintdef(oid) like '%DRAW%'
  ),
  'A Package is a Draw, a Retention Release or a Price Adjustment'
);

select has_table('valtrim', 'price_adjustments', 'A Price Adjustment records what it invoices');
select has_table('valtrim', 'price_adjustment_lines', 'It has one line per collected difference');
select has_table('valtrim', 'retention_release_adjustment_lines',
  'A Retention Release records what adjustments retained');

select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.price_adjustments'::regclass)
  and (select relrowsecurity from pg_class where oid = 'valtrim.price_adjustment_lines'::regclass)
  and (select relrowsecurity from pg_class where oid = 'valtrim.retention_release_adjustment_lines'::regclass),
  'The three tables have RLS enabled'
);

select ok(
  has_table_privilege('authenticated', 'valtrim.price_adjustments', 'select')
  and has_table_privilege('authenticated', 'valtrim.price_adjustment_lines', 'select')
  and has_table_privilege('authenticated', 'valtrim.retention_release_adjustment_lines', 'select')
  and not has_table_privilege('authenticated', 'valtrim.price_adjustments', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.price_adjustment_lines', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.retention_release_adjustment_lines', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.price_adjustments', 'update')
  and not has_table_privilege('authenticated', 'valtrim.price_adjustment_lines', 'delete')
  and not has_table_privilege('anon', 'valtrim.price_adjustments', 'select'),
  'The tables are readable by signed-in users and never written from the browser'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.price_adjustments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%net_amount)::numeric > %'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.price_adjustments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%gross_amount%retention_amount%wrap_amount%'
  ),
  'An adjustment invoices a positive amount and its net is gross minus Retention and WRAP'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.price_adjustment_lines'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%net%gross%retention%wrap%'
  ),
  'Every line adds up, credits included'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.price_adjustment_lines'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%difference_id%'
  ),
  'A difference is collected in at most one adjustment line'
);

select ok(
  (select count(*) from pg_trigger
   where not tgisinternal
     and tgname in (
       'price_adjustments_immutable',
       'price_adjustment_lines_immutable',
       'retention_release_adjustment_lines_immutable'
     )) = 3,
  'The adjustment snapshots are immutable'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'valtrim'
      and tablename = 'package_price_differences'
      and cmd = 'SELECT'
      and qual like '%ACCOUNTING%'
      and qual like '%PROJECT_MANAGEMENT%'
      and qual like '%ADMIN%'
  ),
  'Accounting can see the pending differences it will collect'
);

select ok(
  has_column('valtrim', 'package_price_differences', 'adjustment_package_id')
  and has_column_privilege('authenticated', 'valtrim.package_price_differences', 'adjustment_package_id', 'select'),
  'A collected difference says which adjustment collected it'
);

select ok(
  (select prosecdef from pg_proc
   where oid = 'private.create_price_adjustment_package(bigint,bigint[],text)'::regprocedure)
  and not (select prosecdef from pg_proc
   where oid = 'valtrim.create_price_adjustment_package(bigint,bigint[],text)'::regprocedure),
  'The wrapper runs as the caller; the private function holds the authority'
);

select ok(
  has_function_privilege('authenticated', 'valtrim.create_price_adjustment_package(bigint,bigint[],text)', 'execute')
  and has_function_privilege('authenticated', 'private.create_price_adjustment_package(bigint,bigint[],text)', 'execute')
  and not has_function_privilege('anon', 'valtrim.create_price_adjustment_package(bigint,bigint[],text)', 'execute')
  and not has_function_privilege('anon', 'private.create_price_adjustment_package(bigint,bigint[],text)', 'execute'),
  'Only signed-in users can create an adjustment'
);

select ok(
  pg_get_functiondef('private.create_price_adjustment_package(bigint,bigint[],text)'::regprocedure)
    like '%has_app_role(''ADMIN'', ''PROJECT_MANAGEMENT'')%'
  and pg_get_functiondef('private.create_price_adjustment_package(bigint,bigint[],text)'::regprocedure)
    like '%''PA-''%'
  and pg_get_functiondef('private.create_price_adjustment_package(bigint,bigint[],text)'::regprocedure)
    like '%set status = ''COLLECTED''%',
  'Only ADMIN and PROJECT_MANAGEMENT create it, with its own PA- number, collecting what it invoices'
);

select ok(
  pg_get_functiondef('private.create_price_adjustment_package(bigint,bigint[],text)'::regprocedure)
    like '%v_net <= 0%'
  and pg_get_functiondef('private.create_price_adjustment_package(bigint,bigint[],text)'::regprocedure)
    like '%v_retention < 0%'
  and pg_get_functiondef('private.create_price_adjustment_package(bigint,bigint[],text)'::regprocedure)
    like '%nothing to invoice%',
  'Nothing is created unless credits and charges add up to a positive amount'
);

select ok(
  pg_get_functiondef('private.create_price_adjustment_package(bigint,bigint[],text)'::regprocedure)
    like '%from valtrim.jobs job where job.id = p_job_id for update%'
  and pg_get_functiondef('private.create_price_adjustment_package(bigint,bigint[],text)'::regprocedure)
    like '%from valtrim.package_price_differences difference%for update%',
  'The Job and the differences are locked, so a price update cannot overlap it'
);

select ok(
  pg_get_functiondef('private.record_package_price_differences(bigint,bigint[],uuid)'::regprocedure)
    like '%collected.status = ''COLLECTED''%'
  and pg_get_functiondef('private.record_package_price_differences(bigint,bigint[],uuid)'::regprocedure)
    like '%- v_collected.gross%',
  'A difference is worked out minus what was already collected, so nothing is invoiced twice'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'valtrim.draw_packages'::regclass
      and tgname = 'draw_packages_release_adjustment_differences'
      and not tgisinternal
  )
  and pg_get_functiondef('private.release_differences_of_voided_adjustment()'::regprocedure)
    like '%set status = ''DISMISSED''%'
  and pg_get_functiondef('private.release_differences_of_voided_adjustment()'::regprocedure)
    like '%private.record_package_price_differences%',
  'Cancelling an adjustment gives its differences back'
);

select ok(
  pg_get_functiondef('valtrim.validate_package_workflow_status_change()'::regprocedure)
    like '%price_adjustment_lines%'
  and pg_get_functiondef('valtrim.validate_package_workflow_status_change()'::regprocedure)
    like '%retention_release_adjustment_lines%',
  'An adjustment can leave Draft, and cannot return to it while a Retention Release holds it'
);

select ok(
  pg_get_functiondef('valtrim.reject_retention_release_draw_line()'::regprocedure)
    like '%package_type <> ''DRAW''%'
  and pg_get_functiondef('valtrim.reject_retention_release_hardware_line()'::regprocedure)
    like '%package_type <> ''DRAW''%',
  'Only a Draw Package can hold Draw and Separate Hardware lines'
);

select ok(
  pg_get_functiondef('valtrim.prevent_allocated_source_package_void()'::regprocedure)
    like '%''PRICE_ADJUSTMENT''%'
  and pg_get_functiondef('valtrim.prevent_allocated_source_package_void()'::regprocedure)
    like '%retention_release_adjustment_lines%',
  'An adjustment whose retention a release holds cannot be cancelled'
);

select ok(
  pg_get_functiondef('private.create_retention_release_package(bigint,bigint,text)'::regprocedure)
    like '%from valtrim.price_adjustment_lines line%'
  and pg_get_functiondef('private.create_retention_release_package(bigint,bigint,text)'::regprocedure)
    like '%insert into valtrim.retention_release_adjustment_lines%'
  and pg_get_functiondef('private.create_retention_release_package(bigint,bigint,text)'::regprocedure)
    like '%v_inserted + v_inserted_hardware + v_inserted_adjustment%',
  'The Retention Release includes what adjustments retained, and allocates those lines'
);

select ok(
  pg_get_functiondef('private.create_retention_release_package(bigint,bigint,text)'::regprocedure)
    like '%package.package_type = ''PRICE_ADJUSTMENT''%'
  and pg_get_functiondef('private.create_retention_release_package(bigint,bigint,text)'::regprocedure)
    like '%line.retention <> 0%',
  'Only adjustments that were sent or paid count, and a credit takes away from the release'
);

select ok(
  pg_get_functiondef('private.get_final_release_status(bigint)'::regprocedure)
    like '%''reason'', v_package.package_type%',
  'A Package that is not a Draw reports its own type as the reason it has no Final Release'
);

select is(
  (select count(*)::integer
   from valtrim.package_price_differences difference
   where difference.status = 'COLLECTED' and difference.adjustment_package_id is null),
  0,
  'Every collected difference belongs to an adjustment'
);

select is(
  (select count(*)::integer
   from valtrim.price_adjustments adjustment
   where adjustment.line_count <> (
     select count(*) from valtrim.price_adjustment_lines line
     where line.package_id = adjustment.package_id
   )
   or adjustment.net_amount <> (
     select coalesce(sum(line.net), 0) from valtrim.price_adjustment_lines line
     where line.package_id = adjustment.package_id
   )),
  0,
  'Every adjustment total is the total of its lines'
);

select * from finish();

rollback;
