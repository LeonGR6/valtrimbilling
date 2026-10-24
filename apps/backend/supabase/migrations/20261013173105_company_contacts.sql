-- Company Contacts.
--
-- Estimator, Job Coordinator, Purchasing, Scheduling, Options Coordinator and
-- Project Manager were saved as Builder Contacts, but they work for Valtrim.
-- They are now roles of a Company Contact (valtrim.people, next to SUPERVISOR)
-- and are no longer tied to a Builder. A Builder keeps only the contacts that
-- work for it: the Jobsite Superintendent, the AP Contact and any other
-- contact whose type the team typed (kept in builder_contact_types).
--
-- The new enum values were committed by the previous migration.

begin;

----------------------------------------------------------------------------
-- 1. Move the existing contacts of those types to Company Contacts.
----------------------------------------------------------------------------

create temporary table moved_builder_contacts on commit drop as
select
  contact.id as contact_id,
  contact.type::text as role_name,
  contact.name,
  lower(contact.email) as email,
  contact.phone,
  contact.office_phone,
  contact.is_active
from valtrim.builder_contacts contact
where contact.type::text in (
  'ESTIMATOR',
  'JOB_COORDINATOR',
  'PURCHASING',
  'SCHEDULING',
  'OPTIONS_COORDINATOR',
  'PROJECT_MANAGER'
);

-- A person who is already a Company Contact (same email) keeps their record
-- and just gains the role.
insert into valtrim.people (name, email, phone, office_phone, is_active)
select moved.name, moved.email, moved.phone, moved.office_phone, moved.is_active
from moved_builder_contacts moved
where not exists (
  select 1 from valtrim.people person where lower(person.email) = moved.email
);

create temporary table moved_contact_people on commit drop as
select moved.contact_id, person.id as person_id, moved.role_name
from moved_builder_contacts moved
join valtrim.people person on lower(person.email) = moved.email;

insert into valtrim.person_roles (person_id, role)
select distinct moved.person_id, moved.role_name::valtrim.person_role
from moved_contact_people moved
on conflict do nothing;

----------------------------------------------------------------------------
-- 2. A Job points at Company Contacts for those roles.
----------------------------------------------------------------------------

alter table valtrim.jobs
  drop constraint jobs_estimator_fkey,
  drop constraint jobs_job_coordinator_fkey,
  drop constraint jobs_purchasing_fkey,
  drop constraint jobs_scheduling_fkey,
  drop constraint jobs_options_coordinator_fkey;

drop index valtrim.jobs_estimator_idx;
drop index valtrim.jobs_job_coordinator_idx;
drop index valtrim.jobs_purchasing_idx;
drop index valtrim.jobs_scheduling_idx;
drop index valtrim.jobs_options_coordinator_idx;

alter table valtrim.jobs
  drop column estimator_type,
  drop column job_coordinator_type,
  drop column purchasing_type,
  drop column scheduling_type,
  drop column options_coordinator_type;

-- validate_job also rejects edits to Jobs of inactive Builders, which would
-- block this one-time repointing, so it is paused only while it runs.
alter table valtrim.jobs disable trigger jobs_validate;

update valtrim.jobs job
set
  estimator_id = (
    select moved.person_id from moved_contact_people moved
    where moved.contact_id = job.estimator_id
  ),
  job_coordinator_id = (
    select moved.person_id from moved_contact_people moved
    where moved.contact_id = job.job_coordinator_id
  ),
  purchasing_id = (
    select moved.person_id from moved_contact_people moved
    where moved.contact_id = job.purchasing_id
  ),
  scheduling_id = (
    select moved.person_id from moved_contact_people moved
    where moved.contact_id = job.scheduling_id
  ),
  options_coordinator_id = (
    select moved.person_id from moved_contact_people moved
    where moved.contact_id = job.options_coordinator_id
  );

alter table valtrim.jobs enable trigger jobs_validate;

alter table valtrim.jobs
  add constraint jobs_estimator_fkey
    foreign key (estimator_id) references valtrim.people (id) on delete restrict,
  add constraint jobs_job_coordinator_fkey
    foreign key (job_coordinator_id) references valtrim.people (id) on delete restrict,
  add constraint jobs_purchasing_fkey
    foreign key (purchasing_id) references valtrim.people (id) on delete restrict,
  add constraint jobs_scheduling_fkey
    foreign key (scheduling_id) references valtrim.people (id) on delete restrict,
  add constraint jobs_options_coordinator_fkey
    foreign key (options_coordinator_id) references valtrim.people (id) on delete restrict;

create index jobs_estimator_idx on valtrim.jobs (estimator_id);
create index jobs_job_coordinator_idx on valtrim.jobs (job_coordinator_id);
create index jobs_purchasing_idx on valtrim.jobs (purchasing_id);
create index jobs_scheduling_idx on valtrim.jobs (scheduling_id);
create index jobs_options_coordinator_idx on valtrim.jobs (options_coordinator_id);

-- Nothing points at the moved contacts any more.
delete from valtrim.builder_contacts contact
using moved_builder_contacts moved
where contact.id = moved.contact_id;

----------------------------------------------------------------------------
-- 3. Builder contacts: the two fixed types plus typed ones.
----------------------------------------------------------------------------

create table valtrim.builder_contact_types (
  id bigint generated always as identity primary key,
  name varchar(60) not null check (btrim(name) <> ''),
  created_by uuid,
  created_at timestamptz not null default now()
);

create unique index builder_contact_types_name_uq
  on valtrim.builder_contact_types (lower(name));

alter table valtrim.builder_contact_types enable row level security;

grant select on valtrim.builder_contact_types to authenticated;
grant insert (name) on valtrim.builder_contact_types to authenticated;
grant usage on sequence valtrim.builder_contact_types_id_seq to authenticated;

create policy builder_contact_types_select
on valtrim.builder_contact_types for select to authenticated
using ((select private.is_active_user()));

create policy builder_contact_types_insert
on valtrim.builder_contact_types for insert to authenticated
with check ((select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')));

alter table valtrim.builder_contacts
  add column custom_type_id bigint
    references valtrim.builder_contact_types (id) on delete restrict;

create index builder_contacts_custom_type_idx
  on valtrim.builder_contacts (custom_type_id)
  where custom_type_id is not null;

alter table valtrim.builder_contacts
  add constraint builder_contacts_type_check
    check (type::text in ('JOBSITE_SUPERINTENDENT', 'AP_CONTACT', 'OTHER')),
  add constraint builder_contacts_custom_type_check
    check ((type::text = 'OTHER') = (custom_type_id is not null));

grant insert (custom_type_id) on valtrim.builder_contacts to authenticated;
grant update (custom_type_id) on valtrim.builder_contacts to authenticated;

----------------------------------------------------------------------------
-- 4. Company Contacts are visible to every active user, like Builders.
----------------------------------------------------------------------------

drop policy supervisor_people_select on valtrim.people;
drop policy supervisor_people_update on valtrim.people;
drop policy supervisor_roles_select on valtrim.person_roles;

create policy company_people_select
on valtrim.people for select to authenticated
using ((select private.is_active_user()));

create policy company_people_update
on valtrim.people for update to authenticated
using ((select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')))
with check ((select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')));

create policy company_roles_select
on valtrim.person_roles for select to authenticated
using ((select private.is_active_user()));

----------------------------------------------------------------------------
-- 5. Creating a Company Contact and changing its types.
----------------------------------------------------------------------------

create function private.company_contact_roles_check(
  p_roles valtrim.person_role[],
  p_territory text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_roles is null or cardinality(p_roles) = 0 then
    raise exception 'Select at least one contact type'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from unnest(p_roles) as role
    where role::text not in (
      'SUPERVISOR',
      'ESTIMATOR',
      'JOB_COORDINATOR',
      'PURCHASING',
      'SCHEDULING',
      'OPTIONS_COORDINATOR',
      'PROJECT_MANAGER'
    )
  ) then
    raise exception 'Select a supported contact type'
      using errcode = '23514';
  end if;

  if 'SUPERVISOR'::valtrim.person_role = any (p_roles)
     and nullif(btrim(p_territory), '') is null then
    raise exception 'A Supervisor needs a territory'
      using errcode = '23514';
  end if;
end;
$$;

create function private.create_company_contact_internal(
  p_name text,
  p_email text,
  p_phone text,
  p_office_phone text,
  p_territory text,
  p_roles valtrim.person_role[]
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person_id bigint;
begin
  if not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to create Company Contacts'
      using errcode = '42501';
  end if;

  perform private.company_contact_roles_check(p_roles, p_territory);

  insert into valtrim.people (name, email, phone, office_phone, territory, is_active)
  values (
    btrim(p_name),
    lower(btrim(p_email)),
    nullif(btrim(p_phone), ''),
    nullif(btrim(p_office_phone), ''),
    case
      when 'SUPERVISOR'::valtrim.person_role = any (p_roles)
        then nullif(btrim(p_territory), '')
      else null
    end,
    true
  )
  returning id into v_person_id;

  insert into valtrim.person_roles (person_id, role)
  select v_person_id, role
  from (select distinct unnest(p_roles) as role) roles;

  return v_person_id;
end;
$$;

revoke all on function private.create_company_contact_internal(
  text, text, text, text, text, valtrim.person_role[]
) from public, anon, authenticated;
grant execute on function private.create_company_contact_internal(
  text, text, text, text, text, valtrim.person_role[]
) to authenticated;

create function valtrim.create_company_contact(
  p_name text,
  p_email text,
  p_phone text,
  p_office_phone text,
  p_territory text,
  p_roles valtrim.person_role[]
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.create_company_contact_internal(
    p_name, p_email, p_phone, p_office_phone, p_territory, p_roles
  );
$$;

revoke all on function valtrim.create_company_contact(
  text, text, text, text, text, valtrim.person_role[]
) from public, anon, authenticated;
grant execute on function valtrim.create_company_contact(
  text, text, text, text, text, valtrim.person_role[]
) to authenticated;

-- Replaces the types of a Company Contact. A type that a Job still uses the
-- person for cannot be taken away.
create function private.set_company_contact_roles_internal(
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

revoke all on function private.set_company_contact_roles_internal(
  bigint, valtrim.person_role[]
) from public, anon, authenticated;
grant execute on function private.set_company_contact_roles_internal(
  bigint, valtrim.person_role[]
) to authenticated;

create function valtrim.set_company_contact_roles(
  p_person_id bigint,
  p_roles valtrim.person_role[]
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.set_company_contact_roles_internal(p_person_id, p_roles);
$$;

revoke all on function valtrim.set_company_contact_roles(
  bigint, valtrim.person_role[]
) from public, anon, authenticated;
grant execute on function valtrim.set_company_contact_roles(
  bigint, valtrim.person_role[]
) to authenticated;

----------------------------------------------------------------------------
-- 6. A Job checks its contacts against the right place.
----------------------------------------------------------------------------

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

  -- The other contacts are Company Contacts with the matching type.
  for v_assignment in
    select *
    from (values
      (new.estimator_id, 'ESTIMATOR'::valtrim.person_role, 'Estimator'),
      (new.job_coordinator_id, 'JOB_COORDINATOR'::valtrim.person_role, 'Job Coordinator'),
      (new.purchasing_id, 'PURCHASING'::valtrim.person_role, 'Purchasing contact'),
      (new.scheduling_id, 'SCHEDULING'::valtrim.person_role, 'Scheduling contact'),
      (new.options_coordinator_id, 'OPTIONS_COORDINATOR'::valtrim.person_role, 'Options Coordinator')
    ) as assignment(contact_id, contact_role, label)
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

comment on table valtrim.jobs is
  'Jobs are identified by code. Community is required text; the Supervisor, Estimator, Job Coordinator, Purchasing, Scheduling and Options Coordinator are Company Contacts, and the Jobsite Superintendent is a Builder contact.';

notify pgrst, 'reload schema';

commit;
