-- A Job's team: only the Supervisor and the Jobsite Superintendent are required now.
-- The Estimator, Job Coordinator, Purchasing, Scheduling and Options Coordinator
-- contacts become optional, and a Job can also name a Project Manager (a Company
-- Contact of that type).

begin;

alter table valtrim.jobs
  alter column estimator_id drop not null,
  alter column job_coordinator_id drop not null,
  alter column purchasing_id drop not null,
  alter column scheduling_id drop not null,
  alter column options_coordinator_id drop not null,
  add column project_manager_id bigint,
  add constraint jobs_project_manager_fkey
    foreign key (project_manager_id) references valtrim.people (id)
    on delete restrict;

create index jobs_project_manager_idx on valtrim.jobs (project_manager_id);

-- A contact that is left empty is not checked; one that is filled in still has to be
-- active and have the matching type.
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
    -- normal Job edit cannot silently move the Job to a newer Builder setup.
    new.billing_setup_version_id := old.billing_setup_version_id;

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

-- A type that an active Job still uses the person for cannot be taken away, the
-- Project Manager included.
create or replace function private.set_company_contact_roles_internal(
  p_person_id bigint,
  p_roles valtrim.person_role[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person valtrim.people%rowtype;
  v_role valtrim.person_role;
  v_in_use boolean;
begin
  if not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to change Company Contacts'
      using errcode = '42501';
  end if;

  select * into v_person from valtrim.people where id = p_person_id;
  if not found then
    raise exception 'The Company Contact no longer exists'
      using errcode = 'P0002';
  end if;

  perform private.company_contact_roles_check(p_roles, v_person.territory);

  for v_role in
    select role
    from valtrim.person_roles
    where person_id = p_person_id
      and not (role = any (p_roles))
  loop
    select exists (
      select 1
      from valtrim.jobs job
      where job.is_active
        and p_person_id = case v_role::text
          when 'SUPERVISOR' then job.supervisor_id
          when 'ESTIMATOR' then job.estimator_id
          when 'JOB_COORDINATOR' then job.job_coordinator_id
          when 'PURCHASING' then job.purchasing_id
          when 'SCHEDULING' then job.scheduling_id
          when 'OPTIONS_COORDINATOR' then job.options_coordinator_id
          when 'PROJECT_MANAGER' then job.project_manager_id
          else null
        end
    ) into v_in_use;

    if v_in_use then
      raise exception 'An active Job still uses this contact as its %',
        initcap(replace(lower(v_role::text), '_', ' '))
        using errcode = '23503';
    end if;
  end loop;

  delete from valtrim.person_roles
  where person_id = p_person_id
    and not (role = any (p_roles));

  insert into valtrim.person_roles (person_id, role)
  select p_person_id, role
  from (select distinct unnest(p_roles) as role) roles
  on conflict do nothing;
end;
$$;

comment on table valtrim.jobs is
  'Jobs are identified by code. Community is required text; the Supervisor is a Company Contact and the Jobsite Superintendent a Builder contact, both required. The Estimator, Job Coordinator, Purchasing, Scheduling, Options Coordinator and Project Manager are optional Company Contacts.';

commit;

notify pgrst, 'reload schema';
