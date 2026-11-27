-- A Job moving to another billing setup version no longer deadlocks on Utility Building rows.
--
-- Before: a Job on a setup that requires Utility could not drop its Utility rows (the Sequence
-- Sheet requires one per Phase), and could not move to a setup without Utility while it had
-- them (the change check refused it). The reverse move was locked the same way.
--
-- Now:
--   * To a setup WITHOUT Utility: the change itself removes the Job's Utility rows, in the same
--     transaction, and the preview says which ones. It is still refused when a Utility row is
--     used by something (a Package, a Change Order, Production), because then it cannot go.
--   * To a setup WITH Utility: Phases without a Utility row are a warning, not a blocker. The
--     Sequence Sheet asks for the row the next time each Phase is saved.

begin;

create or replace function private.job_billing_setup_change_check(p_job_id bigint, p_version_id bigint)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_job record;
  v_new record;
  v_count integer;
  v_in_use integer;
  v_names text;
  v_old_draws integer;
  v_new_draws integer;
  v_old_options_draw smallint;
  v_blockers jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
begin
  select job.id, job.builder_id, job.is_active, job.billing_setup_version_id
  into v_job
  from valtrim.jobs job
  where job.id = p_job_id;
  if not found then
    raise exception 'Select an existing Job' using errcode = 'P0002';
  end if;

  select version.id, version.builder_id, version.status, version.utility_building,
         version.separate_hardware_price, version.options_billing_draw_number
  into v_new
  from valtrim.billing_setup_versions version
  where version.id = p_version_id;
  if not found then
    raise exception 'Select an existing billing setup version' using errcode = 'P0002';
  end if;

  -- Blockers: the change is refused.
  if not v_job.is_active then
    v_blockers := v_blockers || jsonb_build_object(
      'code', 'JOB_INACTIVE',
      'message', 'Only an active Job can change its billing setup.'
    );
  end if;

  if v_new.builder_id is distinct from v_job.builder_id
     or v_new.status not in ('ACTIVE', 'SUPERSEDED') then
    v_blockers := v_blockers || jsonb_build_object(
      'code', 'VERSION_NOT_AVAILABLE',
      'message', 'Choose a version of this Job''s Builder that is not a draft.'
    );
  end if;

  if v_new.id = v_job.billing_setup_version_id then
    v_blockers := v_blockers || jsonb_build_object(
      'code', 'SAME_VERSION',
      'message', 'The Job already uses this version.'
    );
  end if;

  select count(*) into v_count
  from valtrim.draw_packages package
  where package.job_id = p_job_id
    and package.status <> 'VOIDED';
  if v_count > 0 then
    v_blockers := v_blockers || jsonb_build_object(
      'code', 'HAS_PACKAGES',
      'message', format(
        'This Job already has %s Package%s that %s not voided, and a Package freezes the billing setup it was made with. Void %s first.',
        v_count,
        case when v_count = 1 then '' else 's' end,
        case when v_count = 1 then 'is' else 'are' end,
        case when v_count = 1 then 'it' else 'them' end
      )
    );
  end if;

  -- Utility Buildings. The Sequence Sheet keeps each Phase in line with the setup when the Phase
  -- is saved; the change only has to make sure it never leaves rows the new setup cannot have.
  if v_new.utility_building then
    select count(*) into v_count
    from valtrim.phases phase
    where phase.job_id = p_job_id
      and phase.is_active
      and not exists (
        select 1 from valtrim.lots lot
        where lot.phase_id = phase.id and lot.is_utility_building
      );
    if v_count > 0 then
      v_warnings := v_warnings || jsonb_build_object(
        'code', 'UTILITY_ROWS_MISSING',
        'message', format(
          'This setup uses a Utility Building, and %s Phase%s of the Job %s no Utility row. The Sequence Sheet will ask for one the next time %s saved.',
          v_count,
          case when v_count = 1 then '' else 's' end,
          case when v_count = 1 then 'has' else 'have' end,
          case when v_count = 1 then 'that Phase is' else 'each of them is' end
        )
      );
    end if;
  else
    select
      count(*),
      count(*) filter (where private.job_utility_row_in_use(lot.id)),
      string_agg(coalesce(nullif(btrim(lot.utility_name), ''), lot.lot_number), ', '
                 order by phase.code, lot.display_order, lot.id)
    into v_count, v_in_use, v_names
    from valtrim.lots lot
    join valtrim.phases phase on phase.id = lot.phase_id
    where lot.job_id = p_job_id
      and lot.is_utility_building;
    if v_in_use > 0 then
      v_blockers := v_blockers || jsonb_build_object(
        'code', 'UTILITY_ROWS_IN_USE',
        'message', format(
          'This setup does not use a Utility Building, and %s Utility row%s of the Job %s used by a Package, a Change Order or Production, so %s cannot be removed.',
          v_in_use,
          case when v_in_use = 1 then '' else 's' end,
          case when v_in_use = 1 then 'is' else 'are' end,
          case when v_in_use = 1 then 'it' else 'they' end
        )
      );
    elsif v_count > 0 then
      v_warnings := v_warnings || jsonb_build_object(
        'code', 'UTILITY_ROWS_REMOVED',
        'message', format(
          'This setup does not use a Utility Building, so the change removes the %s Utility row%s of the Job from the Sequence Sheet (%s).',
          v_count,
          case when v_count = 1 then '' else 's' end,
          v_names
        )
      );
    end if;
  end if;

  -- Warnings: the change is allowed, and something may need a look.
  select count(*) into v_old_draws
  from valtrim.billing_draws draw
  where draw.setup_version_id = v_job.billing_setup_version_id;
  select count(*) into v_new_draws
  from valtrim.billing_draws draw
  where draw.setup_version_id = v_new.id;
  if v_old_draws <> v_new_draws then
    select count(*) into v_count
    from valtrim.payment_schedule_templates template
    where template.job_id = p_job_id and template.status = 'confirmed';
    if v_count > 0 then
      v_warnings := v_warnings || jsonb_build_object(
        'code', 'DRAWS_CHANGED_WITH_SCHEDULES',
        'message', format(
          'The number of Draws goes from %s to %s, and the Job has %s confirmed Payment Schedule%s. Check that each one still matches the Draws.',
          v_old_draws,
          v_new_draws,
          v_count,
          case when v_count = 1 then '' else 's' end
        )
      );
    end if;
  end if;

  if v_new.separate_hardware_price and not coalesce((
    select version.separate_hardware_price
    from valtrim.billing_setup_versions version
    where version.id = v_job.billing_setup_version_id
  ), false) then
    select count(*) into v_count
    from valtrim.plans plan
    where plan.job_id = p_job_id
      and plan.is_active
      and not exists (
        select 1 from valtrim.plan_prices price
        where price.plan_id = plan.id
          and price.effective_to is null
          and price.hardware_price is not null
      );
    if v_count > 0 then
      v_warnings := v_warnings || jsonb_build_object(
        'code', 'HARDWARE_PRICES_MISSING',
        'message', format(
          'This setup bills Hardware as a separate price, and %s Plan%s of the Job %s no Hardware price yet.',
          v_count,
          case when v_count = 1 then '' else 's' end,
          case when v_count = 1 then 'has' else 'have' end
        )
      );
    end if;
  end if;

  select version.options_billing_draw_number into v_old_options_draw
  from valtrim.billing_setup_versions version
  where version.id = v_job.billing_setup_version_id;
  if v_old_options_draw is distinct from v_new.options_billing_draw_number then
    v_warnings := v_warnings || jsonb_build_object(
      'code', 'OPTIONS_DRAW_CHANGED',
      'message', format(
        'The Options are billed in %s instead of %s.',
        coalesce('Draw ' || v_new.options_billing_draw_number, 'no Draw'),
        coalesce('Draw ' || v_old_options_draw, 'no Draw')
      )
    );
  end if;

  return jsonb_build_object(
    'allowed', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'warnings', v_warnings,
    'fromVersionId', v_job.billing_setup_version_id,
    'toVersionId', v_new.id
  );
end;
$function$;

-- Whether a Utility row is used by something that keeps it from being deleted (every table whose
-- foreign key to valtrim.lots restricts the delete).
create or replace function private.job_utility_row_in_use(p_lot_id bigint)
returns boolean
language sql
stable
set search_path to ''
as $function$
  select exists (select 1 from valtrim.package_draws x where x.lot_id = p_lot_id)
      or exists (select 1 from valtrim.package_utility_lines x where x.lot_id = p_lot_id)
      or exists (select 1 from valtrim.package_hardware_lines x where x.lot_id = p_lot_id)
      or exists (select 1 from valtrim.change_order_lines x where x.lot_id = p_lot_id)
      or exists (select 1 from valtrim.change_order_event_lots x where x.lot_id = p_lot_id)
      or exists (select 1 from valtrim.change_order_plan_charges x where x.lot_id = p_lot_id)
      or exists (select 1 from valtrim.production_activity_lots x where x.lot_id = p_lot_id)
      or exists (select 1 from valtrim.production_schedule_lots x where x.lot_id = p_lot_id);
$function$;

revoke all on function private.job_utility_row_in_use(bigint) from public, anon, authenticated;

create or replace function valtrim.change_job_billing_setup(
  p_job_id bigint,
  p_version_id bigint,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_from_version_id bigint;
  v_check jsonb;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to change Job billing setups'
      using errcode = '42501';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'Use 500 characters or fewer for the reason'
      using errcode = '23514';
  end if;

  -- Locking the Job row also makes a Package being created for it wait: its foreign key takes a
  -- conflicting lock, so the Packages counted below are the Packages there will be.
  select job.billing_setup_version_id
  into v_from_version_id
  from valtrim.jobs job
  where job.id = p_job_id
  for update;
  if not found then
    raise exception 'Select an existing Job' using errcode = 'P0002';
  end if;

  v_check := private.job_billing_setup_change_check(p_job_id, p_version_id);
  if not (v_check ->> 'allowed')::boolean then
    raise exception '%', (
      select string_agg(blocker ->> 'message', ' ')
      from jsonb_array_elements(v_check -> 'blockers') blocker
    ) using errcode = '55000';
  end if;

  -- A setup without Utility cannot keep Utility rows: the check above made sure none is in use.
  if not (
    select version.utility_building
    from valtrim.billing_setup_versions version
    where version.id = p_version_id
  ) then
    delete from valtrim.lots lot
    where lot.job_id = p_job_id
      and lot.is_utility_building;
  end if;

  perform set_config('valtrim.job_setup_change', 'on', true);
  update valtrim.jobs
  set billing_setup_version_id = p_version_id
  where id = p_job_id;
  perform set_config('valtrim.job_setup_change', '', true);

  insert into valtrim.job_billing_setup_changes (
    job_id, from_version_id, to_version_id, reason, changed_by
  )
  values (p_job_id, v_from_version_id, p_version_id, v_reason, v_actor_id);

  return v_check || jsonb_build_object('changed', true);
end;
$$;

commit;

notify pgrst, 'reload schema';
