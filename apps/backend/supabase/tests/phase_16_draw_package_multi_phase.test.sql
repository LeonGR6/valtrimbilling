begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select col_is_null(
  'valtrim', 'draw_packages', 'phase_id',
  'A Package may omit its single-Phase shortcut when it spans multiple Phases'
);

select ok(not exists (
  select 1
  from pg_constraint
  where conrelid = 'valtrim.package_draws'::regclass
    and conname = 'package_draws_package_id_phase_id_fkey'
), 'Package lines no longer require every line to match one Package Phase');

select ok(exists (
  select 1
  from pg_constraint
  where conrelid = 'valtrim.package_draws'::regclass
    and conname = 'package_draws_lot_id_phase_id_fkey'
), 'Every calculated line still ties its Phase snapshot to its Lot');

select ok(
  has_column_privilege('authenticated', 'valtrim.package_draws', 'phase_id', 'select')
  and has_column_privilege('authenticated', 'valtrim.package_draws', 'phase_code', 'select')
  and has_column_privilege('authenticated', 'valtrim.package_draws', 'building', 'select'),
  'Authenticated readers can group immutable Package lines by Phase'
);

select is(
  (
    select count(*)::integer
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'valtrim'
      and procedure.proname = 'create_draw_invoice_package'
  ),
  1,
  'PostgREST still exposes one unambiguous Package creator'
);

select is(
  (
    select proargnames[1]
    from pg_proc
    where oid = 'valtrim.create_draw_invoice_package(bigint,jsonb,date,date,date,text)'::regprocedure
  ),
  'p_job_id',
  'The exposed creator receives a Job instead of one Phase'
);

select ok(has_function_privilege(
  'authenticated',
  'valtrim.create_draw_invoice_package(bigint,jsonb,date,date,date,text)',
  'execute'
), 'Authenticated users can call the role-checked Job-scoped creator');

select ok(not has_function_privilege(
  'anon',
  'valtrim.create_draw_invoice_package(bigint,jsonb,date,date,date,text)',
  'execute'
), 'Anonymous users cannot create multi-Phase Packages');

select ok(not (
  select prosecdef
  from pg_proc
  where oid = 'valtrim.create_draw_invoice_package(bigint,jsonb,date,date,date,text)'::regprocedure
), 'The public creator remains a security-invoker wrapper');

select ok((
  select prosecdef
  from pg_proc
  where oid = 'private.create_draw_invoice_package(bigint,jsonb,date,date,date,text)'::regprocedure
), 'The private creator owns the atomic role-checked transaction');

select ok(coalesce((
  select prosrc like '%phase.job_id = p_job_id%'
    and prosrc like '%count(distinct phase.id)%'
    and prosrc like '%v_phase_count <> 1%'
  from pg_proc
  where oid = 'private.create_draw_invoice_package(bigint,jsonb,date,date,date,text)'::regprocedure
), false), 'Creation accepts several Phases only through Lots in the selected Job');

select ok(coalesce((
  select prosrc like '%from valtrim.jobs job%for update of job%'
  from pg_proc
  where oid = 'private.create_draw_invoice_package(bigint,jsonb,date,date,date,text)'::regprocedure
), false), 'Creation serializes allocation at the Job boundary');

select ok(coalesce((
  select prosrc like '%join valtrim.lots lot on lot.id = new.lot_id%'
    and prosrc like '%phase.job_id = package.job_id%'
  from pg_proc
  where oid = 'valtrim.prepare_package_draw()'::regprocedure
), false), 'A calculated line derives its Phase from the Lot and enforces the Package Job');

select ok(coalesce((
  select proconfig @> array['search_path=""']
  from pg_proc
  where oid = 'valtrim.prepare_package_draw()'::regprocedure
), false), 'The calculated-line trigger uses an empty search path');

select ok(coalesce((
  select prosrc like '%perform 1 from valtrim.jobs%for update%'
    and prosrc not like '%v_source.phase_id <> v_target.phase_id%'
  from pg_proc
  where oid = 'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,date,date,text)'::regprocedure
), false), 'Corrections lock the Job and transfers no longer require one shared Phase');

select ok(coalesce((
  select prosrc like '%count(distinct line.phase_id) = 1%'
    and prosrc like '%set phase_id = null%'
  from pg_proc
  where oid = 'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,date,date,text)'::regprocedure
), false), 'Corrections refresh the single-Phase shortcut after edits, transfers and cancellation');

select ok(not has_table_privilege('authenticated', 'valtrim.package_draws', 'insert')
  and not has_table_privilege('authenticated', 'valtrim.package_draws', 'update')
  and not has_table_privilege('authenticated', 'valtrim.package_draws', 'delete'),
  'Browser clients still cannot bypass the calculated-line RPC boundary');

select ok(coalesce((
  select prosrc like '%new.phase_id is distinct from old.phase_id%'
    and prosrc like '%valtrim.draw_package_correction%'
  from pg_proc
  where oid = 'valtrim.prepare_draw_package()'::regprocedure
), false), 'The compatibility Phase can change only inside an authorized correction');

select * from finish();

rollback;
