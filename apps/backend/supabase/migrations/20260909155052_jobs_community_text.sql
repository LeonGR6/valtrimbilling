-- Align Jobs with the application model: Community is required free text on
-- each Job, not a catalog-backed entity. This migration intentionally does
-- not add grants or RLS policies for Jobs.

begin;

-- Add the replacement column without a default so existing rows can be
-- migrated from their current referenced Community without inventing data.
alter table valtrim.jobs
  add column community text;

update valtrim.jobs job
set community = btrim(community.name)
from valtrim.communities community
where community.id = job.community_id
  and community.builder_id = job.builder_id;

do $$
begin
  if exists (
    select 1
    from valtrim.jobs
    where community is null or btrim(community) = ''
  ) then
    raise exception
      'No se pudo migrar community para todos los Jobs existentes';
  end if;
end;
$$;

-- The view depends on community_id, so replace it around the column change.
drop view valtrim.job_overview;

drop index valtrim.jobs_community_idx;

alter table valtrim.jobs
  drop constraint jobs_community_id_builder_id_fkey,
  drop constraint jobs_id_community_id_key,
  drop column community_id,
  alter column community set not null,
  add constraint jobs_community_normalized_check check (
    community = btrim(community)
    and community <> ''
    and char_length(community) <= 100
  );

create index jobs_builder_community_idx
  on valtrim.jobs (builder_id, lower(community));

create or replace function valtrim.validate_job()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
begin
  -- Match the form's normalization while the constraint guarantees the
  -- stored invariant for every writer.
  new.community := btrim(new.community);

  if not exists (
    select 1
    from people p
    join person_roles r on r.person_id = p.id and r.role = 'SUPERVISOR'
    where p.id = new.supervisor_id and p.is_active
  ) then
    raise exception 'El supervisor debe estar activo y tener rol SUPERVISOR';
  end if;
  if not exists (
    select 1 from builders where id = new.builder_id and is_active
  ) then
    raise exception 'El builder debe estar activo';
  end if;
  if not exists (
    select 1 from builder_contacts
    where id in (new.superintendent_id, new.ap_contact_id)
      and builder_id = new.builder_id and is_active
    group by builder_id
    having count(*) = 2
  ) then
    raise exception 'Superintendent y AP Contact deben estar activos y pertenecer al builder';
  end if;
  if not exists (
    select 1 from billing_setup_versions
    where id = new.billing_setup_version_id
      and builder_id = new.builder_id and status = 'ACTIVE'
  ) then
    raise exception 'El job debe usar una version ACTIVE de billing del builder';
  end if;
  return new;
end;
$$;

create view valtrim.job_overview
with (security_invoker = true)
as
select
  j.id,
  j.code,
  j.name,
  j.status,
  j.is_active,
  j.builder_id,
  b.name as builder_name,
  j.community,
  j.supervisor_id,
  supervisor.name as supervisor_name,
  j.superintendent_id,
  superintendent.name as superintendent_name,
  j.ap_contact_id,
  ap.name as ap_contact_name,
  j.billing_setup_version_id,
  count(distinct p.id) as phase_count,
  count(distinct l.id) as lot_count
from valtrim.jobs j
join valtrim.builders b on b.id = j.builder_id
join valtrim.people supervisor on supervisor.id = j.supervisor_id
join valtrim.builder_contacts superintendent on superintendent.id = j.superintendent_id
join valtrim.builder_contacts ap on ap.id = j.ap_contact_id
left join valtrim.phases p on p.job_id = j.id
left join valtrim.lots l on l.phase_id = p.id
group by j.id, b.name, supervisor.name, superintendent.name, ap.name;

comment on column valtrim.jobs.community is
  'Required Community or Project label stored directly on the Job; normalized with btrim and not backed by valtrim.communities.';

comment on table valtrim.communities is
  'Legacy catalog pending retirement. Do not use for Jobs. It remains closed while user_community_access and service_properties still depend on it.';

-- Recreating the view must not make Jobs readable before its persistence and
-- authorization phase is designed.
revoke all on valtrim.job_overview from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
