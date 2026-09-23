-- Align the closed Jobs model with the fields owned by the application.
--
-- A Job is identified only by code and needs a Supervisor plus a Builder's
-- Jobsite Superintendent. PostgreSQL selects the Builder's ACTIVE Billing
-- Setup version on insert (or when the Builder is explicitly changed), then
-- keeps that version stable for the Job's later financial history.

begin;

-- Both views depend on columns removed below. Recreate them with the real Job
-- shape while preserving their closed Data API posture.
drop view valtrim.draw_package_overview;
drop view valtrim.job_overview;

drop index valtrim.jobs_builder_name_uq;
drop index valtrim.jobs_ap_contact_idx;

alter table valtrim.jobs
  drop constraint jobs_ap_contact_id_builder_id_ap_contact_type_fkey,
  drop column name,
  drop column ap_contact_id,
  drop column ap_contact_type;

create or replace function valtrim.validate_job()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
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

  if not exists (
    select 1
    from valtrim.builder_contacts superintendent
    where superintendent.id = new.superintendent_id
      and superintendent.builder_id = new.builder_id
      and superintendent.type = 'JOBSITE_SUPERINTENDENT'
      and superintendent.is_active
  ) then
    raise exception
      'El Jobsite Superintendent debe estar activo y pertenecer al builder';
  end if;

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

create view valtrim.job_overview
with (security_invoker = true)
as
select
  job.id,
  job.code,
  job.status,
  job.is_active,
  job.builder_id,
  builder.name as builder_name,
  job.community,
  job.supervisor_id,
  supervisor.name as supervisor_name,
  job.superintendent_id,
  superintendent.name as superintendent_name,
  job.billing_setup_version_id,
  count(distinct phase.id) as phase_count,
  count(distinct lot.id) as lot_count
from valtrim.jobs job
join valtrim.builders builder on builder.id = job.builder_id
join valtrim.people supervisor on supervisor.id = job.supervisor_id
join valtrim.builder_contacts superintendent
  on superintendent.id = job.superintendent_id
left join valtrim.phases phase on phase.job_id = job.id
left join valtrim.lots lot on lot.phase_id = phase.id
group by job.id, builder.name, supervisor.name, superintendent.name;

create view valtrim.draw_package_overview
with (security_invoker = true)
as
select
  package.id,
  package.package_number,
  package.package_date,
  package.status,
  package.builder_id,
  builder.name as builder_name,
  package.job_id,
  job.code as job_code,
  package.phase_id,
  phase.code as phase_code,
  invoice.id as invoice_id,
  invoice.invoice_number,
  invoice.status as invoice_status,
  invoice.gross_amount,
  invoice.retention_amount,
  invoice.wrap_amount,
  invoice.net_amount,
  invoice.paid_amount,
  count(distinct package_draw.lot_id) as lot_count,
  count(*) as line_count
from valtrim.draw_packages package
join valtrim.builders builder on builder.id = package.builder_id
join valtrim.jobs job on job.id = package.job_id
join valtrim.phases phase on phase.id = package.phase_id
join valtrim.invoices invoice on invoice.package_id = package.id
left join valtrim.package_draws package_draw
  on package_draw.package_id = package.id
group by package.id, builder.name, job.code, phase.code, invoice.id;

comment on table valtrim.jobs is
  'Jobs are identified by code. Community is required text; Supervisor and Jobsite Superintendent are the only Job-level contact assignments.';

comment on column valtrim.jobs.billing_setup_version_id is
  'Assigned automatically from the Builder ACTIVE Billing Setup version on Job creation or Builder change, then retained as an immutable historical reference.';

revoke all on valtrim.job_overview from public, anon, authenticated;
revoke all on valtrim.draw_package_overview from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
