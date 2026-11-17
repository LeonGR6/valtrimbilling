-- A Job now also points at the Builder's Estimator, Job Coordinator,
-- Purchasing, Scheduling and Options Coordinator contacts, next to the
-- Jobsite Superintendent it already had.
--
-- Each column is tied to builder_contacts by (id, builder_id, type), exactly
-- like superintendent_id, so a Job can only reference a contact of its own
-- Builder and of the matching type. The new enum values were committed by the
-- previous migration, so they can be used here.
--
-- Existing Jobs get one "<Role> Example" contact per Builder so the columns
-- can be NOT NULL right away; the team can rename or replace them from the
-- Job form.

begin;

alter table valtrim.jobs
  add column estimator_id bigint,
  add column estimator_type valtrim.contact_type generated always as
    ('ESTIMATOR'::valtrim.contact_type) stored,
  add column job_coordinator_id bigint,
  add column job_coordinator_type valtrim.contact_type generated always as
    ('JOB_COORDINATOR'::valtrim.contact_type) stored,
  add column purchasing_id bigint,
  add column purchasing_type valtrim.contact_type generated always as
    ('PURCHASING'::valtrim.contact_type) stored,
  add column scheduling_id bigint,
  add column scheduling_type valtrim.contact_type generated always as
    ('SCHEDULING'::valtrim.contact_type) stored,
  add column options_coordinator_id bigint,
  add column options_coordinator_type valtrim.contact_type generated always as
    ('OPTIONS_COORDINATOR'::valtrim.contact_type) stored;

-- The Jobs that exist today were created without these contacts. validate_job
-- also rejects edits to Jobs of inactive Builders, which would block this
-- one-time backfill, so it is paused only while the backfill runs.
alter table valtrim.jobs disable trigger jobs_validate;

with needed as (
  select distinct builder_id from valtrim.jobs
), created as (
  insert into valtrim.builder_contacts (builder_id, name, type, email)
  select
    builder_id,
    'Estimator Example',
    'ESTIMATOR'::valtrim.contact_type,
    'estimator.example.b' || builder_id || '@example.com'
  from needed
  returning id, builder_id
)
update valtrim.jobs job
set estimator_id = created.id
from created
where created.builder_id = job.builder_id;

with needed as (
  select distinct builder_id from valtrim.jobs
), created as (
  insert into valtrim.builder_contacts (builder_id, name, type, email)
  select
    builder_id,
    'Job Coordinator Example',
    'JOB_COORDINATOR'::valtrim.contact_type,
    'job.coordinator.example.b' || builder_id || '@example.com'
  from needed
  returning id, builder_id
)
update valtrim.jobs job
set job_coordinator_id = created.id
from created
where created.builder_id = job.builder_id;

with needed as (
  select distinct builder_id from valtrim.jobs
), created as (
  insert into valtrim.builder_contacts (builder_id, name, type, email)
  select
    builder_id,
    'Purchasing Example',
    'PURCHASING'::valtrim.contact_type,
    'purchasing.example.b' || builder_id || '@example.com'
  from needed
  returning id, builder_id
)
update valtrim.jobs job
set purchasing_id = created.id
from created
where created.builder_id = job.builder_id;

with needed as (
  select distinct builder_id from valtrim.jobs
), created as (
  insert into valtrim.builder_contacts (builder_id, name, type, email)
  select
    builder_id,
    'Scheduling Example',
    'SCHEDULING'::valtrim.contact_type,
    'scheduling.example.b' || builder_id || '@example.com'
  from needed
  returning id, builder_id
)
update valtrim.jobs job
set scheduling_id = created.id
from created
where created.builder_id = job.builder_id;

with needed as (
  select distinct builder_id from valtrim.jobs
), created as (
  insert into valtrim.builder_contacts (builder_id, name, type, email)
  select
    builder_id,
    'Options Coordinator Example',
    'OPTIONS_COORDINATOR'::valtrim.contact_type,
    'options.coordinator.example.b' || builder_id || '@example.com'
  from needed
  returning id, builder_id
)
update valtrim.jobs job
set options_coordinator_id = created.id
from created
where created.builder_id = job.builder_id;

alter table valtrim.jobs enable trigger jobs_validate;

alter table valtrim.jobs
  alter column estimator_id set not null,
  alter column job_coordinator_id set not null,
  alter column purchasing_id set not null,
  alter column scheduling_id set not null,
  alter column options_coordinator_id set not null,
  add constraint jobs_estimator_fkey
    foreign key (estimator_id, builder_id, estimator_type)
    references valtrim.builder_contacts (id, builder_id, type)
    on delete restrict,
  add constraint jobs_job_coordinator_fkey
    foreign key (job_coordinator_id, builder_id, job_coordinator_type)
    references valtrim.builder_contacts (id, builder_id, type)
    on delete restrict,
  add constraint jobs_purchasing_fkey
    foreign key (purchasing_id, builder_id, purchasing_type)
    references valtrim.builder_contacts (id, builder_id, type)
    on delete restrict,
  add constraint jobs_scheduling_fkey
    foreign key (scheduling_id, builder_id, scheduling_type)
    references valtrim.builder_contacts (id, builder_id, type)
    on delete restrict,
  add constraint jobs_options_coordinator_fkey
    foreign key (options_coordinator_id, builder_id, options_coordinator_type)
    references valtrim.builder_contacts (id, builder_id, type)
    on delete restrict;

create index jobs_estimator_idx on valtrim.jobs (estimator_id, builder_id);
create index jobs_job_coordinator_idx on valtrim.jobs (job_coordinator_id, builder_id);
create index jobs_purchasing_idx on valtrim.jobs (purchasing_id, builder_id);
create index jobs_scheduling_idx on valtrim.jobs (scheduling_id, builder_id);
create index jobs_options_coordinator_idx on valtrim.jobs (options_coordinator_id, builder_id);

grant insert (
  estimator_id,
  job_coordinator_id,
  purchasing_id,
  scheduling_id,
  options_coordinator_id
) on valtrim.jobs to authenticated;

grant update (
  estimator_id,
  job_coordinator_id,
  purchasing_id,
  scheduling_id,
  options_coordinator_id
) on valtrim.jobs to authenticated;

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

  -- Every Builder contact on the Job must belong to the Job's Builder, be of
  -- the matching type and still be active.
  for v_assignment in
    select *
    from (values
      (new.superintendent_id, 'JOBSITE_SUPERINTENDENT'::valtrim.contact_type, 'Jobsite Superintendent'),
      (new.estimator_id, 'ESTIMATOR'::valtrim.contact_type, 'Estimator'),
      (new.job_coordinator_id, 'JOB_COORDINATOR'::valtrim.contact_type, 'Job Coordinator'),
      (new.purchasing_id, 'PURCHASING'::valtrim.contact_type, 'Purchasing contact'),
      (new.scheduling_id, 'SCHEDULING'::valtrim.contact_type, 'Scheduling contact'),
      (new.options_coordinator_id, 'OPTIONS_COORDINATOR'::valtrim.contact_type, 'Options Coordinator')
    ) as assignment(contact_id, contact_type, label)
  loop
    if not exists (
      select 1
      from valtrim.builder_contacts contact
      where contact.id = v_assignment.contact_id
        and contact.builder_id = new.builder_id
        and contact.type = v_assignment.contact_type
        and contact.is_active
    ) then
      raise exception
        'El % debe estar activo y pertenecer al builder', v_assignment.label;
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

comment on table valtrim.jobs is
  'Jobs are identified by code. Community is required text; the Supervisor and the Builder contacts (Jobsite Superintendent, Estimator, Job Coordinator, Purchasing, Scheduling and Options Coordinator) are the Job-level assignments.';

notify pgrst, 'reload schema';

commit;
