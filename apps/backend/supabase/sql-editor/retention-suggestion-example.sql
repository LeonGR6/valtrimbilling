-- Example data to see a READY Retention Suggestion (run in the Supabase SQL editor
-- of the TEST project; it is not a migration).
--
-- Creates Job 1406 (Builder Example, community "RetentionReady") with one Phase,
-- three Lots and one Package dated 2026-08-20 that bills every Draw, including the
-- Hardware Draw. With the Builder's cutoffs (10 and 25) that Package's cutoff is
-- 2026-08-25, so the Retention becomes available on 2026-09-25: the suggestion is
-- READY from then on. Nothing existing is changed.
--
-- Builder Example uses Billing Setup version 39: retention 5% released per Job,
-- Draws EXT 20% / DM 60% / HW 20%, hardware billed as the third Draw.

begin;

do $$
declare
  v_actor uuid := 'ec6eec15-4260-437c-94e8-b678a3a70ade';
  v_job bigint;
  v_phase bigint;
  v_plan bigint;
  v_package bigint;
  v_prices numeric[] := array[1000, 2000, 3000];
  v_i int;
begin
  if exists (select 1 from valtrim.jobs where code = '1406') then
    raise exception 'Job 1406 already exists';
  end if;

  -- superintendent_type is a generated column, so it is not inserted.
  insert into valtrim.jobs (
    code, builder_id, billing_setup_version_id, community, supervisor_id,
    superintendent_id, status, is_active, created_by, updated_by
  ) values (
    '1406', 12, 39, 'RetentionReady', 17, 9,
    'ACTIVE', true, v_actor, v_actor
  ) returning id into v_job;

  insert into valtrim.phases (job_id, code, building, is_active, created_by, updated_by)
  values (v_job, '1', '1', true, v_actor, v_actor)
  returning id into v_phase;

  for v_i in 1..3 loop
    insert into valtrim.plans (job_id, code, name, is_active, created_by, updated_by)
    values (v_job, v_i::text, v_i::text, true, v_actor, v_actor)
    returning id into v_plan;

    -- Effective before the Package date, or the Package cannot be priced.
    insert into valtrim.plan_prices (plan_id, base_price, hardware_price, effective_from, created_by)
    values (v_plan, v_prices[v_i], null, date '2026-08-01', v_actor);

    insert into valtrim.lots (
      phase_id, job_id, plan_id, lot_number, is_reverse, display_order,
      is_utility_building, created_by, updated_by
    ) values (
      v_phase, v_job, v_plan, v_i::text, false, v_i - 1, false, v_actor, v_actor
    );
  end loop;

  insert into valtrim.draw_packages (
    builder_id, job_id, phase_id, setup_version_id, package_date, invoice_line_format,
    notes, workflow_status, status_changed_by, created_by, updated_by
  )
  select 12, v_job, v_phase, 39, date '2026-08-20', version.invoice_line_format,
         'Example: every Draw, including Hardware, billed more than a month ago (Retention Suggestions).',
         'DRAFT', v_actor, v_actor, v_actor
  from valtrim.billing_setup_versions version
  where version.id = 39
  returning id into v_package;

  insert into valtrim.invoices (package_id, created_by, updated_by)
  values (v_package, v_actor, v_actor);

  -- The package_draws trigger calculates every amount and the retention.
  insert into valtrim.package_draws (package_id, lot_id, draw_id)
  select v_package, lot.id, draw.id
  from valtrim.lots lot
  cross join valtrim.billing_draws draw
  where lot.job_id = v_job and draw.setup_version_id = 39
  order by draw.draw_number, lot.lot_number;

  -- A Package only counts for Retention once it is Ready to submit or later.
  update valtrim.draw_packages
  set workflow_status = 'READY_TO_SUBMIT'
  where id = v_package;

  raise notice 'Created Job % and Package %', v_job, v_package;
end $$;

commit;

-- To check it:
--   select p.package_number, p.workflow_status, p.package_date, sum(d.retention_amount) retention
--   from valtrim.draw_packages p join valtrim.package_draws d on d.package_id = p.id
--   where p.job_id = (select id from valtrim.jobs where code = '1406') group by 1, 2, 3;
--
-- To remove it later: in the app open the Package and use "Delete draft" (or set it back to
-- Draft first), then deactivate Job 1406. Package lines are immutable, so do not delete rows by SQL.
