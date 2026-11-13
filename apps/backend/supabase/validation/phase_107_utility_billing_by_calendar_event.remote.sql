-- Utility Building billed by Calendar event and Builder Setups with a single Draw, against the real
-- database, inside a transaction that is rolled back. Run it after migration 20261223120000; every row
-- of the last result must have ok = true. The Package number sequence is put back as it was found.
--
-- It uses the real Jobs that have Utility rows: MONTE VISTA 1323 (EXT 20 / DM 60 / HW 20, nothing
-- billed), TRUMARK 1307 (EXT 100, B3 billed on a Draw row before this change, B5 not billed),
-- CITY VENTURES 1314 (DM 100) and PULTE 1265 (the old FULL mode).

begin;

create temporary table ut_results (step serial primary key, name text not null, ok boolean not null, detail text) on commit drop;
create temporary table ut_out (name text primary key, outcome text) on commit drop;
create temporary table ut_ctx (
  admin_id uuid,
  seq_last bigint,
  seq_called boolean,
  mv_job bigint,
  mv_lot bigint,
  mv_plain_lot bigint,
  mv_spare_lot bigint,
  mv_base numeric,
  tm_job bigint,
  tm_billed_lot bigint,
  tm_lot bigint,
  tm_base numeric,
  cv_job bigint,
  cv_lot bigint,
  pu_job bigint,
  pu_lot bigint
) on commit drop;

create function pg_temp.check_that(p_name text, p_ok boolean, p_detail text default null)
returns void
language sql
as $$
  insert into ut_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
$$;

create function pg_temp.run_as(p_user uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  v_result text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    execute p_sql into v_result;
    reset role;
    return 'ok:' || coalesce(v_result, '');
  exception when others then
    reset role;
    return 'err:' || sqlstate || ':' || sqlerrm;
  end;
end;
$$;

create function pg_temp.run_owner(p_user uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  v_result text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  begin
    execute p_sql into v_result;
    return 'ok:' || coalesce(v_result, '');
  exception when others then
    return 'err:' || sqlstate || ':' || sqlerrm;
  end;
end;
$$;

create function pg_temp.attempt(p_sql text)
returns text
language plpgsql
as $$
declare
  v_result text;
begin
  execute p_sql into v_result;
  return 'ok:' || coalesce(v_result, '');
exception when others then
  return 'err:' || sqlstate || ':' || sqlerrm;
end;
$$;

-- A Package of the Job with these Utility portions (and nothing else), as an ADMIN.
create function pg_temp.utility_package(p_job bigint, p_utility jsonb, p_selections jsonb default '[]'::jsonb)
returns text
language sql
as $$
  select pg_temp.run_as(
    (select admin_id from ut_ctx),
    format(
      'select valtrim.create_draw_invoice_package_with_hardware_events(%s, %L::jsonb, ''[]''::jsonb, current_date, null, %L::jsonb)::text',
      p_job, p_selections, p_utility
    )
  );
$$;

create function pg_temp.package_of(p_name text)
returns bigint
language sql
as $$
  select nullif(substr(outcome, 4), '')::bigint from ut_out where name = p_name and outcome like 'ok:%';
$$;

create function pg_temp.utility_base(p_lot bigint)
returns numeric
language sql
as $$
  select price.base_price
  from valtrim.lots lot
  join lateral (
    select candidate.base_price
    from valtrim.plan_prices candidate
    where candidate.plan_id = lot.plan_id
      and (
        candidate.id = lot.plan_price_id
        or (lot.plan_price_id is null and candidate.effective_from <= current_date
          and (candidate.effective_to is null or candidate.effective_to >= current_date))
      )
    order by candidate.effective_from desc, candidate.id desc
    limit 1
  ) price on true
  where lot.id = p_lot;
$$;

insert into ut_ctx (admin_id, seq_last, seq_called)
select
  (select id from valtrim.app_users where role = 'ADMIN' and is_active order by created_at limit 1),
  (select last_value from valtrim.draw_package_number_seq),
  (select is_called from valtrim.draw_package_number_seq);

update ut_ctx set
  mv_job = (select id from valtrim.jobs where code = '1323'),
  tm_job = (select id from valtrim.jobs where code = '1307'),
  cv_job = (select id from valtrim.jobs where code = '1314'),
  pu_job = (select id from valtrim.jobs where code = '1265');

update ut_ctx set
  mv_lot = (select lot.id from valtrim.lots lot join valtrim.phases phase on phase.id = lot.phase_id and phase.is_active
            where phase.job_id = ut_ctx.mv_job and lot.is_utility_building and lot.utility_name = 'B3' limit 1),
  mv_spare_lot = (select lot.id from valtrim.lots lot join valtrim.phases phase on phase.id = lot.phase_id and phase.is_active
            where phase.job_id = ut_ctx.mv_job and lot.is_utility_building and lot.utility_name = 'B4' limit 1),
  mv_plain_lot = (select lot.id from valtrim.lots lot join valtrim.phases phase on phase.id = lot.phase_id and phase.is_active
            where phase.job_id = ut_ctx.mv_job and not lot.is_utility_building order by lot.id limit 1),
  tm_billed_lot = (select lot.id from valtrim.lots lot join valtrim.phases phase on phase.id = lot.phase_id and phase.is_active
            where phase.job_id = ut_ctx.tm_job and lot.is_utility_building and lot.utility_name = 'B3' limit 1),
  tm_lot = (select lot.id from valtrim.lots lot join valtrim.phases phase on phase.id = lot.phase_id and phase.is_active
            where phase.job_id = ut_ctx.tm_job and lot.is_utility_building and lot.utility_name = 'B5' limit 1),
  cv_lot = (select lot.id from valtrim.lots lot join valtrim.phases phase on phase.id = lot.phase_id and phase.is_active
            where phase.job_id = ut_ctx.cv_job and lot.is_utility_building and lot.utility_name = 'B4' limit 1),
  pu_lot = (select lot.id from valtrim.lots lot join valtrim.phases phase on phase.id = lot.phase_id and phase.is_active
            where phase.job_id = ut_ctx.pu_job and lot.is_utility_building order by lot.id limit 1);

update ut_ctx set mv_base = pg_temp.utility_base(mv_lot), tm_base = pg_temp.utility_base(tm_lot);

select pg_temp.check_that('the real Jobs and Utility rows are there',
  (select admin_id is not null and mv_lot is not null and mv_spare_lot is not null and mv_plain_lot is not null
     and tm_billed_lot is not null and tm_lot is not null and cv_lot is not null and pu_lot is not null
     and mv_base > 0 and tm_base > 0 from ut_ctx),
  (select row_to_json(ut_ctx)::text from ut_ctx));

-- 1. The schema ------------------------------------------------------------------------------------------------

select pg_temp.check_that('Utility lines and their retention have tables with RLS and a read policy',
  to_regclass('valtrim.package_utility_lines') is not null
  and to_regclass('valtrim.retention_release_utility_lines') is not null
  and (select relrowsecurity from pg_class where oid = 'valtrim.package_utility_lines'::regclass)
  and (select relrowsecurity from pg_class where oid = 'valtrim.retention_release_utility_lines'::regclass)
  and exists (select 1 from pg_policies where tablename = 'package_utility_lines' and policyname = 'package_utility_lines_select')
  and exists (select 1 from pg_policies where tablename = 'retention_release_utility_lines'));

select pg_temp.check_that('every function that reads Hardware lines reads Utility lines too',
  (select bool_and(pg_get_functiondef(p.oid) like '%package_utility_lines%')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('valtrim', 'private') and p.prokind = 'f'
     and pg_get_functiondef(p.oid) like '%package_hardware_lines%'
     and p.proname not in ('prepare_package_hardware_line', 'package_hardware_line_new_amounts')),
  (select string_agg(n.nspname || '.' || p.proname, ', ')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('valtrim', 'private') and p.prokind = 'f'
     and pg_get_functiondef(p.oid) like '%package_hardware_lines%'
     and pg_get_functiondef(p.oid) not like '%package_utility_lines%'
     and p.proname not in ('prepare_package_hardware_line', 'package_hardware_line_new_amounts')));

select pg_temp.check_that('only the new creation functions exist (one signature each)',
  (select count(*) from pg_proc where proname = 'create_draw_invoice_package_with_hardware_events') = 2
  and (select count(*) from pg_proc where proname = 'create_draw_package_with_price_differences') = 2
  and has_function_privilege('authenticated',
    'valtrim.create_draw_invoice_package_with_hardware_events(bigint,jsonb,jsonb,date,text,jsonb)', 'execute'));

-- 2. Builder Setup rules ----------------------------------------------------------------------------------------

insert into ut_out select 'validate monte vista', pg_temp.attempt(
  'select valtrim.validate_setup_version(' || (select billing_setup_version_id from valtrim.jobs where id = mv_job) || ')::text') from ut_ctx;
select pg_temp.check_that('a Utility split whose events are Draws still validates',
  (select outcome like 'ok:%' from ut_out where name = 'validate monte vista'),
  (select outcome from ut_out where name = 'validate monte vista'));

insert into ut_out select 'validate pulte', pg_temp.attempt(
  'select valtrim.validate_setup_version(' || (select billing_setup_version_id from valtrim.jobs where id = pu_job) || ')::text') from ut_ctx;
select pg_temp.check_that('an old FULL Utility setup cannot be saved again without an event allocation',
  (select outcome like 'err:23514:New Utility Building setups must allocate%' from ut_out where name = 'validate pulte'),
  (select outcome from ut_out where name = 'validate pulte'));

insert into ut_out select 'one draw setup', pg_temp.attempt(format(
  'select valtrim.save_billing_setup_version(%s, %L::jsonb, %L::jsonb, ''[]''::jsonb, null, %L::uuid)::text',
  (select builder_id from valtrim.jobs where id = cv_job),
  jsonb_build_object(
    'frequency', 'MONTHLY', 'cutoffAnyDate', true, 'paymentTermsDays', 30,
    'invoiceLineFormat', 'LOT_SCOPE', 'submissionMethod', 'EMAIL', 'submissionDestination', 'test@example.com',
    'separateHardwarePrice', true, 'hardwareBillingMode', 'BY_EVENT',
    'hardwareExtPercentage', 0, 'hardwareDmPercentage', 0, 'hardwareHwPercentage', 100,
    'utilityBuilding', true, 'utilityBillingMode', 'BY_EVENT',
    'utilityExtPercentage', 100, 'utilityDmPercentage', 0, 'utilityHwPercentage', 0),
  jsonb_build_array(jsonb_build_object('drawNumber', 1, 'name', 'TRIM', 'percentage', 100, 'eventType', 'DM')),
  admin_id)) from ut_ctx;
select pg_temp.check_that('a setup with 1 Draw (DM 100), Hardware HW 100 and Utility EXT 100 saves',
  (select outcome like 'ok:%' from ut_out where name = 'one draw setup')
  and (select count(*) from valtrim.billing_draws
       where setup_version_id = (select substr(outcome, 4)::bigint from ut_out where name = 'one draw setup' and outcome like 'ok:%')) = 1,
  (select outcome from ut_out where name = 'one draw setup'));

insert into ut_out select 'full utility setup', pg_temp.attempt(format(
  'select valtrim.save_billing_setup_version(%s, %L::jsonb, %L::jsonb, ''[]''::jsonb, null, %L::uuid)::text',
  (select builder_id from valtrim.jobs where id = cv_job),
  jsonb_build_object(
    'frequency', 'MONTHLY', 'cutoffAnyDate', true, 'paymentTermsDays', 30,
    'invoiceLineFormat', 'LOT_SCOPE', 'submissionMethod', 'EMAIL', 'submissionDestination', 'test@example.com',
    'utilityBuilding', true, 'utilityBillingMode', 'FULL'),
  jsonb_build_array(jsonb_build_object('drawNumber', 1, 'name', 'TRIM', 'percentage', 100, 'eventType', 'DM')),
  admin_id)) from ut_ctx;
select pg_temp.check_that('a new setup cannot use the FULL Utility mode',
  (select outcome like 'err:%New Utility Building setups must allocate%' from ut_out where name = 'full utility setup'),
  (select outcome from ut_out where name = 'full utility setup'));

-- 3. Creating Packages ------------------------------------------------------------------------------------------

insert into ut_out select 'mv ext', pg_temp.utility_package(mv_job,
  jsonb_build_array(jsonb_build_object('lot_id', mv_lot, 'event_type', 'EXT'))) from ut_ctx;
select pg_temp.check_that('a Package with only a Utility EXT portion is created, with 20% of the Utility Plan Price',
  pg_temp.package_of('mv ext') is not null
  and (select utility_amount = round(mv_base * 20 / 100, 2) and utility_percentage = 20 and gross_amount = utility_amount
         and utility_name = 'B3' and phase_id is not null
       from valtrim.package_utility_lines, ut_ctx
       where package_id = pg_temp.package_of('mv ext')),
  (select outcome from ut_out where name = 'mv ext'));

select pg_temp.check_that('its invoice totals are the Utility line',
  (select invoice.gross_amount = line.gross_amount and invoice.net_amount = line.net_amount
       and invoice.retention_amount = line.retention_amount
   from valtrim.invoices invoice
   join valtrim.package_utility_lines line on line.package_id = invoice.package_id
   where invoice.package_id = pg_temp.package_of('mv ext'))
  and (select phase_id from valtrim.draw_packages where id = pg_temp.package_of('mv ext'))
    = (select phase_id from valtrim.lots, ut_ctx where lots.id = mv_lot));

insert into ut_out select 'mv ext again', pg_temp.utility_package(mv_job,
  jsonb_build_array(jsonb_build_object('lot_id', mv_lot, 'event_type', 'EXT'))) from ut_ctx;
select pg_temp.check_that('the same Utility portion cannot be billed twice',
  (select outcome like 'err:23505:%already billed%' from ut_out where name = 'mv ext again'),
  (select outcome from ut_out where name = 'mv ext again'));

insert into ut_out select 'mv dm hw', pg_temp.utility_package(mv_job, jsonb_build_array(
  jsonb_build_object('lot_id', mv_lot, 'event_type', 'HW'),
  jsonb_build_object('lot_id', mv_lot, 'event_type', 'DM'))) from ut_ctx;
select pg_temp.check_that('DM and HW in one Package bill 60% and the rest, so the three add up to the Plan Price',
  pg_temp.package_of('mv dm hw') is not null
  and (select sum(utility_amount) from valtrim.package_utility_lines, ut_ctx where lot_id = mv_lot)
    = (select mv_base from ut_ctx)
  and (select utility_amount from valtrim.package_utility_lines, ut_ctx
       where lot_id = mv_lot and utility_event_type = 'DM') = (select round(mv_base * 60 / 100, 2) from ut_ctx),
  (select outcome from ut_out where name = 'mv dm hw'));

insert into ut_out select 'tm legacy', pg_temp.utility_package(tm_job,
  jsonb_build_array(jsonb_build_object('lot_id', tm_billed_lot, 'event_type', 'EXT'))) from ut_ctx;
select pg_temp.check_that('a Utility row billed on a Draw row before this change counts as billed',
  (select outcome like 'err:23505:%already billed%' from ut_out where name = 'tm legacy'),
  (select outcome from ut_out where name = 'tm legacy'));

insert into ut_out select 'tm b5', pg_temp.utility_package(tm_job,
  jsonb_build_array(jsonb_build_object('lot_id', tm_lot, 'event_type', 'EXT'))) from ut_ctx;
select pg_temp.check_that('TRUMARK B5 EXT bills 100% of its Plan Price',
  (select utility_amount = (select tm_base from ut_ctx) and utility_percentage = 100
   from valtrim.package_utility_lines where package_id = pg_temp.package_of('tm b5')),
  (select outcome from ut_out where name = 'tm b5'));

insert into ut_out select 'pulte', pg_temp.utility_package(pu_job,
  jsonb_build_array(jsonb_build_object('lot_id', pu_lot, 'event_type', 'DM'))) from ut_ctx;
select pg_temp.check_that('a Job on an old FULL Utility setup cannot bill Utility by event',
  (select outcome like 'err:23514:%does not bill the Utility Building by Calendar event%' from ut_out where name = 'pulte'),
  (select outcome from ut_out where name = 'pulte'));

insert into ut_out select 'cv hw', pg_temp.utility_package(cv_job,
  jsonb_build_array(jsonb_build_object('lot_id', cv_lot, 'event_type', 'HW'))) from ut_ctx;
select pg_temp.check_that('an event with no Utility share in the setup is refused',
  (select outcome like 'err:23514:%no Utility Building allocation%' from ut_out where name = 'cv hw'),
  (select outcome from ut_out where name = 'cv hw'));

insert into ut_out select 'plain lot', pg_temp.utility_package(mv_job,
  jsonb_build_array(jsonb_build_object('lot_id', mv_plain_lot, 'event_type', 'EXT'))) from ut_ctx;
select pg_temp.check_that('a Lot that is not a Utility row cannot be a Utility selection',
  (select outcome like 'err:23503:%Utility row%' from ut_out where name = 'plain lot'),
  (select outcome from ut_out where name = 'plain lot'));

insert into ut_out select 'bad event', pg_temp.utility_package(mv_job,
  jsonb_build_array(jsonb_build_object('lot_id', mv_spare_lot, 'event_type', 'BASEBOARD'))) from ut_ctx;
select pg_temp.check_that('only EXT, DM and HW are Utility events',
  (select outcome like 'err:23514:%' from ut_out where name = 'bad event'),
  (select outcome from ut_out where name = 'bad event'));

insert into ut_out select 'legacy cell', pg_temp.utility_package(mv_job, '[]'::jsonb,
  jsonb_build_array(jsonb_build_object('phase_id', (select phase_id from valtrim.lots where id = mv_spare_lot),
    'lot_id', mv_spare_lot, 'draw_number', 1))) from ut_ctx;
select pg_temp.check_that('a Utility row can no longer be billed by event on a Draw cell',
  (select outcome like 'err:%on its own lines%' from ut_out where name = 'legacy cell'),
  (select outcome from ut_out where name = 'legacy cell'));

select pg_temp.check_that('the Lot history lists the Packages of the Utility row',
  (select jsonb_array_length(private.lot_billing_packages(mv_lot)) = 2 from ut_ctx));

-- 4. Draft Packages: recalculate, cancel, Final Release ---------------------------------------------------------

insert into ut_out select 'recalculate', pg_temp.run_owner(admin_id, format(
  'select private.recalculate_draft_package(%s, %L, false)::text', pg_temp.package_of('mv dm hw'), 'validation'))
from ut_ctx;
select pg_temp.check_that('a Draft with Utility lines recalculates to the same lines and amounts',
  (select outcome like 'ok:%' from ut_out where name = 'recalculate')
  and (select count(*) from valtrim.package_utility_lines where package_id = pg_temp.package_of('mv dm hw')) = 2
  and (select sum(utility_amount) from valtrim.package_utility_lines, ut_ctx where lot_id = mv_lot)
    = (select mv_base from ut_ctx),
  (select outcome from ut_out where name = 'recalculate'));

insert into ut_out select 'final release', pg_temp.attempt(format(
  'select private.get_final_release_status(%s)::text', pg_temp.package_of('mv dm hw')));
select pg_temp.check_that('the Final Release status reads Utility lines',
  (select outcome like 'ok:%' from ut_out where name = 'final release'),
  (select outcome from ut_out where name = 'final release'));

insert into ut_out select 'cancel', pg_temp.run_as(admin_id, format(
  'select valtrim.cancel_draw_invoice_package(%s, %L)::text', pg_temp.package_of('tm b5'), 'validation'))
from ut_ctx;
select pg_temp.check_that('cancelling the Package removes its Utility lines',
  (select outcome like 'ok:%' from ut_out where name = 'cancel')
  and not exists (select 1 from valtrim.package_utility_lines where package_id = pg_temp.package_of('tm b5'))
  and (select status = 'VOIDED' from valtrim.draw_packages where id = pg_temp.package_of('tm b5')),
  (select outcome from ut_out where name = 'cancel'));

insert into ut_out select 'tm b5 again', pg_temp.utility_package(tm_job,
  jsonb_build_array(jsonb_build_object('lot_id', tm_lot, 'event_type', 'EXT'))) from ut_ctx;
select pg_temp.check_that('after the cancel the portion can be billed again',
  (select outcome like 'ok:%' from ut_out where name = 'tm b5 again'),
  (select outcome from ut_out where name = 'tm b5 again'));

insert into ut_out select 'direct delete', pg_temp.run_owner(admin_id, format(
  'delete from valtrim.package_utility_lines where package_id = %s returning 1', pg_temp.package_of('tm b5 again')))
from ut_ctx;
select pg_temp.check_that('a Utility line cannot be deleted or changed directly',
  (select outcome like 'err:42501:Calculated Utility Building lines are immutable%' from ut_out where name = 'direct delete')
  and exists (select 1 from valtrim.package_utility_lines where package_id = pg_temp.package_of('tm b5 again')),
  (select outcome from ut_out where name = 'direct delete'));

insert into ut_out select 'leave draft', pg_temp.run_owner(admin_id, format(
  'update valtrim.draw_packages set workflow_status = ''READY_TO_SUBMIT'' where id = %s returning id',
  pg_temp.package_of('mv ext')))
from ut_ctx;
select pg_temp.check_that('a Package with only Utility lines counts as having calculated lines',
  (select outcome like 'ok:%' or (outcome like 'err:%' and outcome not like '%without calculated lines%')
   from ut_out where name = 'leave draft'),
  (select outcome from ut_out where name = 'leave draft'));

-- 4b. A Package billed before this change, with its Utility on a Draw row ----------------------------------------

insert into ut_out select 'legacy reopen', pg_temp.run_owner(admin_id, format(
  'update valtrim.draw_packages set workflow_status = ''DRAFT'' where id = %s returning workflow_status::text',
  (select package_id from valtrim.package_draws where lot_id = tm_billed_lot and is_utility_building limit 1)))
from ut_ctx;
insert into ut_out select 'legacy recalculate', pg_temp.run_owner(admin_id, format(
  'select private.recalculate_draft_package(%s, %L, false)::text',
  (select package_id from valtrim.package_draws where lot_id = tm_billed_lot and is_utility_building limit 1), 'validation'))
from ut_ctx;
select pg_temp.check_that('an old Package with its Utility on a Draw row, back in Draft, recalculates to the same amounts',
  (select outcome like 'ok:%' from ut_out where name = 'legacy recalculate')
  and (select (substr(outcome, 4)::jsonb ->> 'gross_before') = (substr(outcome, 4)::jsonb ->> 'gross_after')
        and (substr(outcome, 4)::jsonb ->> 'net_before') = (substr(outcome, 4)::jsonb ->> 'net_after')
       from ut_out where name = 'legacy recalculate')
  and exists (select 1 from valtrim.package_draws, ut_ctx
              where lot_id = tm_billed_lot and is_utility_building and utility_event_type = 'EXT'),
  (select outcome from ut_out where name = 'legacy recalculate'));

-- 5. Price changes ----------------------------------------------------------------------------------------------

select pg_temp.check_that('price differences accept a UTILITY_EVENT line',
  (select pg_get_constraintdef(oid) like '%UTILITY_EVENT%' from pg_constraint
   where conname = 'package_price_differences_line_kind_check')
  and (select pg_get_constraintdef(oid) like '%UTILITY_EVENT%' from pg_constraint
   where conname = 'price_adjustment_lines_line_kind_check'));

-- Put back the Package number sequence the test used.
select setval('valtrim.draw_package_number_seq', seq_last, seq_called) from ut_ctx;

select step, name, ok, detail from ut_results order by step;

rollback;
