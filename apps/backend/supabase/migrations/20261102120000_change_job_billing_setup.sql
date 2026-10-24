-- Fixing the billing setup a Job uses, while nothing has been billed with it.
--
-- A Job takes the ACTIVE version of its Builder's billing setup when it is created, and keeps that
-- version. If the version was wrong (a 1% wrap that should have been 2%), the Builder's setup is
-- corrected, which creates a new version, and the Job can then be moved to it, as long as the Job
-- has no Package that is not voided: a Package freezes the version, its Draws and its retention and
-- wrap percentages.
--
--   preview_job_billing_setup_change(job, version)  what would stop the change, and what to check
--   change_job_billing_setup(job, version, reason)  does it, and records it
--
-- Both are for Admin and Project Management. Browsers still cannot write jobs.billing_setup_version_id
-- (it has no column grant); the change goes through change_job_billing_setup, which tells the
-- validate_job trigger that this update is allowed to move the version.

begin;

-- What was changed, by whom and why ---------------------------------------------------------

create table valtrim.job_billing_setup_changes (
  id bigint generated always as identity primary key,
  -- Deleting a Job deletes its history.
  job_id bigint not null references valtrim.jobs(id) on delete cascade,
  from_version_id bigint not null
    references valtrim.billing_setup_versions(id) on delete restrict,
  to_version_id bigint not null
    references valtrim.billing_setup_versions(id) on delete restrict,
  reason text check (reason is null or char_length(reason) <= 500),
  changed_by uuid references valtrim.app_users(id) on delete set null,
  changed_at timestamptz not null default now(),
  constraint job_billing_setup_changes_moved check (from_version_id <> to_version_id)
);

create index job_billing_setup_changes_job_idx
  on valtrim.job_billing_setup_changes (job_id, changed_at desc);

alter table valtrim.job_billing_setup_changes enable row level security;

revoke all on valtrim.job_billing_setup_changes from public, anon, authenticated;
grant select on valtrim.job_billing_setup_changes to authenticated;
grant select, insert, update, delete
  on valtrim.job_billing_setup_changes to service_role;

create policy job_billing_setup_changes_select
on valtrim.job_billing_setup_changes for select to authenticated
using ((select private.is_active_user()));

comment on table valtrim.job_billing_setup_changes is
  'Every time a Job was moved to another version of its Builder billing setup. Written only by change_job_billing_setup.';

-- validate_job: the version moves only through change_job_billing_setup ---------------------

create or replace function valtrim.validate_job()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
declare
  v_assignment record;
begin
  new.community := btrim(new.community);

  if not exists (
    select 1
    from valtrim.people person
    join valtrim.person_roles role
      on role.person_id = person.id
     and role.role = 'SUPERVISOR'
    where person.id = new.supervisor_id
      and person.is_active
  ) then
    raise exception 'El supervisor debe estar activo y tener rol SUPERVISOR';
  end if;

  if not exists (
    select 1
    from valtrim.builders builder
    where builder.id = new.builder_id
      and builder.is_active
  ) then
    raise exception 'El builder debe estar activo';
  end if;

  -- The Jobsite Superintendent works for the Builder: it must belong to the
  -- Job's Builder and still be active.
  if not exists (
    select 1
    from valtrim.builder_contacts contact
    where contact.id = new.superintendent_id
      and contact.builder_id = new.builder_id
      and contact.type = 'JOBSITE_SUPERINTENDENT'
      and contact.is_active
  ) then
    raise exception
      'El Jobsite Superintendent debe estar activo y pertenecer al builder';
  end if;

  -- The other contacts are optional Company Contacts with the matching type.
  for v_assignment in
    select *
    from (values
      (new.estimator_id, 'ESTIMATOR'::valtrim.person_role, 'Estimator'),
      (new.job_coordinator_id, 'JOB_COORDINATOR'::valtrim.person_role, 'Job Coordinator'),
      (new.purchasing_id, 'PURCHASING'::valtrim.person_role, 'Purchasing contact'),
      (new.scheduling_id, 'SCHEDULING'::valtrim.person_role, 'Scheduling contact'),
      (new.options_coordinator_id, 'OPTIONS_COORDINATOR'::valtrim.person_role, 'Options Coordinator'),
      (new.project_manager_id, 'PROJECT_MANAGER'::valtrim.person_role, 'Project Manager')
    ) as assignment(contact_id, contact_role, label)
    -- These contacts are optional: only the ones a Job has are checked.
    where assignment.contact_id is not null
  loop
    if not exists (
      select 1
      from valtrim.people person
      join valtrim.person_roles role
        on role.person_id = person.id
       and role.role = v_assignment.contact_role
      where person.id = v_assignment.contact_id
        and person.is_active
    ) then
      raise exception
        'El % debe estar activo y tener ese tipo de contacto', v_assignment.label;
    end if;
  end loop;

  if tg_op = 'INSERT'
     or new.builder_id is distinct from old.builder_id then
    select version.id
    into new.billing_setup_version_id
    from valtrim.billing_setup_versions version
    where version.builder_id = new.builder_id
      and version.status = 'ACTIVE';

    if new.billing_setup_version_id is null then
      raise exception
        'El builder debe tener una version ACTIVE de Billing Setup';
    end if;
  else
    -- The setup version is a historical snapshot selected by PostgreSQL. A
    -- normal Job edit cannot silently move the Job to another setup. Only
    -- change_job_billing_setup, which first checks that nothing was billed with
    -- the current one, says so for the length of its own transaction.
    if coalesce(current_setting('valtrim.job_setup_change', true), '') <> 'on' then
      new.billing_setup_version_id := old.billing_setup_version_id;
    end if;

    if not exists (
      select 1
      from valtrim.billing_setup_versions version
      where version.id = new.billing_setup_version_id
        and version.builder_id = new.builder_id
        and version.status in ('ACTIVE', 'SUPERSEDED')
    ) then
      raise exception
        'El Job debe conservar una version valida de Billing Setup';
    end if;
  end if;

  return new;
end;
$$;

-- What stops a Job from taking a version, and what to check first --------------------------

create function private.job_billing_setup_change_check(
  p_job_id bigint,
  p_version_id bigint
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job record;
  v_new record;
  v_count integer;
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

  -- Utility Buildings: every Phase needs a Utility row when the setup uses them, and none may
  -- have one when it does not (the same rule Sequence Sheets apply when a Phase is saved).
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
      v_blockers := v_blockers || jsonb_build_object(
        'code', 'UTILITY_ROWS_MISSING',
        'message', format(
          'This setup uses a Utility Building, and %s Phase%s of the Job %s no Utility row. Add one in the Sequence Sheet first.',
          v_count,
          case when v_count = 1 then '' else 's' end,
          case when v_count = 1 then 'has' else 'have' end
        )
      );
    end if;
  else
    select count(*) into v_count
    from valtrim.lots lot
    join valtrim.phases phase on phase.id = lot.phase_id
    where phase.job_id = p_job_id
      and phase.is_active
      and lot.is_utility_building;
    if v_count > 0 then
      v_blockers := v_blockers || jsonb_build_object(
        'code', 'UTILITY_ROWS_PRESENT',
        'message', format(
          'This setup does not use a Utility Building, and the Job has %s Utility row%s. Remove %s in the Sequence Sheet first.',
          v_count,
          case when v_count = 1 then '' else 's' end,
          case when v_count = 1 then 'it' else 'them' end
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
$$;

revoke all on function private.job_billing_setup_change_check(bigint, bigint)
  from public, anon, authenticated;

-- The two functions the app calls -------------------------------------------------------------

create function valtrim.preview_job_billing_setup_change(
  p_job_id bigint,
  p_version_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to change Job billing setups'
      using errcode = '42501';
  end if;

  return private.job_billing_setup_change_check(p_job_id, p_version_id);
end;
$$;

create function valtrim.change_job_billing_setup(
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

revoke all on function valtrim.preview_job_billing_setup_change(bigint, bigint)
  from public, anon, authenticated;
revoke all on function valtrim.change_job_billing_setup(bigint, bigint, text)
  from public, anon, authenticated;
grant execute on function valtrim.preview_job_billing_setup_change(bigint, bigint)
  to authenticated;
grant execute on function valtrim.change_job_billing_setup(bigint, bigint, text)
  to authenticated;

commit;

notify pgrst, 'reload schema';
