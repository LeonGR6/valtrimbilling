-- Phase 8: persist Draw & Invoice Packages and their calculated financial
-- snapshots. Document uploads, QuickBooks, payments and Customer Service stay
-- closed.
--
-- Active authenticated users can read packages and calculated invoice lines.
-- ADMIN and PROJECT_MANAGEMENT create packages and manage the package workflow
-- through role-checked atomic RPCs. Browser clients never write package,
-- invoice, calculated-line or audit columns directly.

begin;

-- Preserve the broader baseline status and its audit history for future
-- issuance/payment integrations. This phase adds the four-state operational
-- workflow used by the current UI without rewriting legacy billing history.
create type valtrim.package_workflow_status as enum (
  'DRAFT',
  'READY_TO_SUBMIT',
  'AWAITING_PAYMENT',
  'PAID_CLOSED'
);

alter table valtrim.draw_packages
  add column workflow_status valtrim.package_workflow_status
    not null default 'DRAFT',
  add column status_changed_at timestamptz not null default now(),
  add column status_changed_by uuid;

alter table valtrim.draw_packages
  add constraint draw_packages_status_changed_by_fkey
    foreign key (status_changed_by)
    references valtrim.app_users(id)
    on delete restrict
    not valid;

create index draw_packages_workflow_status_idx
  on valtrim.draw_packages (workflow_status, package_date desc);

create index draw_packages_status_changed_by_idx
  on valtrim.draw_packages (status_changed_by)
  where status_changed_by is not null;

create function valtrim.validate_package_workflow_status_change()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
begin
  if new.workflow_status is not distinct from old.workflow_status then
    return new;
  end if;

  if new.workflow_status <> 'DRAFT'
     and not exists (
       select 1
       from valtrim.package_draws package_draw
       where package_draw.package_id = new.id
     ) then
    raise exception 'A package without calculated lines cannot leave DRAFT'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger draw_packages_validate_workflow_status
before update of workflow_status on valtrim.draw_packages
for each row
execute function valtrim.validate_package_workflow_status_change();

-- The private implementation derives the actor from auth.uid(). Its exposed
-- wrapper is security invoker and contains no privileged behavior.
create function private.create_draw_invoice_package(
  p_phase_id bigint,
  p_draw_numbers smallint[],
  p_lot_ids bigint[] default null,
  p_package_date date default current_date,
  p_period_start date default null,
  p_period_end date default null,
  p_notes text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_package_id bigint;
  v_builder_id bigint;
  v_job_id bigint;
  v_version_id bigint;
  v_expected integer;
  v_found integer;
  v_inserted integer;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to change Draw & Invoice Packages'
      using errcode = '42501';
  end if;

  if p_phase_id is null or p_phase_id <= 0 then
    raise exception 'Select an active Phase'
      using errcode = '23503';
  end if;

  if p_draw_numbers is null or cardinality(p_draw_numbers) = 0 then
    raise exception 'Select at least one Draw'
      using errcode = '23514';
  end if;

  if p_lot_ids is null or cardinality(p_lot_ids) = 0 then
    raise exception 'Select at least one Lot'
      using errcode = '23514';
  end if;

  if p_package_date is null then
    raise exception 'Select a Package date'
      using errcode = '23514';
  end if;

  if p_period_start is not null
     and p_period_end is not null
     and p_period_end < p_period_start then
    raise exception 'Billing period end cannot precede its start'
      using errcode = '23514';
  end if;

  if p_notes is not null and char_length(btrim(p_notes)) > 500 then
    raise exception 'Package notes must contain 500 characters or fewer'
      using errcode = '23514';
  end if;

  select job.builder_id, job.id, job.billing_setup_version_id
  into v_builder_id, v_job_id, v_version_id
  from valtrim.phases phase
  join valtrim.jobs job on job.id = phase.job_id
  join valtrim.billing_setup_versions version
    on version.id = job.billing_setup_version_id
   and version.builder_id = job.builder_id
  where phase.id = p_phase_id
    and phase.is_active
    and job.is_active
    and version.status in ('ACTIVE', 'SUPERSEDED')
  for update of phase;

  if v_job_id is null then
    raise exception 'The Phase, Job or Billing Setup is no longer available'
      using errcode = '23503';
  end if;

  select count(distinct requested) into v_expected
  from unnest(p_draw_numbers) requested;

  select count(*) into v_found
  from valtrim.billing_draws draw
  where draw.setup_version_id = v_version_id
    and draw.draw_number = any(p_draw_numbers);

  if v_expected <> cardinality(p_draw_numbers) or v_expected <> v_found then
    raise exception 'Every Draw must be unique and belong to the Billing Setup'
      using errcode = '23503';
  end if;

  select count(distinct requested) into v_expected
  from unnest(p_lot_ids) requested;

  select count(*) into v_found
  from valtrim.lots lot
  where lot.phase_id = p_phase_id
    and lot.id = any(p_lot_ids);

  if v_expected <> cardinality(p_lot_ids) or v_expected <> v_found then
    raise exception 'Every Lot must be unique and belong to the selected Phase'
      using errcode = '23503';
  end if;

  insert into valtrim.draw_packages (
    builder_id,
    job_id,
    phase_id,
    setup_version_id,
    package_date,
    billing_period_start,
    billing_period_end,
    payment_terms_days,
    invoice_line_format,
    notes,
    workflow_status,
    status_changed_by,
    created_by,
    updated_by
  )
  select
    v_builder_id,
    v_job_id,
    p_phase_id,
    v_version_id,
    p_package_date,
    p_period_start,
    p_period_end,
    version.payment_terms_days,
    version.invoice_line_format,
    nullif(btrim(p_notes), ''),
    'DRAFT'::valtrim.package_workflow_status,
    v_actor_id,
    v_actor_id,
    v_actor_id
  from valtrim.billing_setup_versions version
  where version.id = v_version_id
  returning id into v_package_id;

  insert into valtrim.invoices (package_id, created_by, updated_by)
  values (v_package_id, v_actor_id, v_actor_id);

  insert into valtrim.package_draws (package_id, lot_id, draw_id)
  select v_package_id, lot.id, draw.id
  from valtrim.lots lot
  cross join valtrim.billing_draws draw
  where lot.phase_id = p_phase_id
    and lot.id = any(p_lot_ids)
    and draw.setup_version_id = v_version_id
    and draw.draw_number = any(p_draw_numbers);

  get diagnostics v_inserted = row_count;

  if v_inserted <> cardinality(p_lot_ids) * cardinality(p_draw_numbers) then
    raise exception 'The package did not generate every requested calculated line'
      using errcode = '23514';
  end if;

  return v_package_id;
end;
$$;

create function valtrim.create_draw_invoice_package(
  p_phase_id bigint,
  p_draw_numbers smallint[],
  p_lot_ids bigint[] default null,
  p_package_date date default current_date,
  p_period_start date default null,
  p_period_end date default null,
  p_notes text default null
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.create_draw_invoice_package(
    p_phase_id,
    p_draw_numbers,
    p_lot_ids,
    p_package_date,
    p_period_start,
    p_period_end,
    p_notes
  );
$$;

create function private.set_draw_package_workflow_status(
  p_package_id bigint,
  p_status valtrim.package_workflow_status
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_package_id bigint;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to change Draw & Invoice Packages'
      using errcode = '42501';
  end if;

  if p_status is null then
    raise exception 'Select a valid Package status'
      using errcode = '23514';
  end if;

  update valtrim.draw_packages package
  set workflow_status = p_status,
      status_changed_at = now(),
      status_changed_by = v_actor_id,
      updated_by = v_actor_id
  where package.id = p_package_id
  returning package.id into v_package_id;

  if v_package_id is null then
    raise exception 'The Draw & Invoice Package no longer exists'
      using errcode = 'P0002';
  end if;

  return v_package_id;
end;
$$;

create function valtrim.set_draw_package_workflow_status(
  p_package_id bigint,
  p_status valtrim.package_workflow_status
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.set_draw_package_workflow_status(p_package_id, p_status);
$$;

alter table valtrim.draw_packages enable row level security;
alter table valtrim.invoices enable row level security;
alter table valtrim.package_draws enable row level security;
alter table valtrim.package_options enable row level security;

revoke all on table valtrim.draw_packages from public, anon, authenticated;
revoke all on table valtrim.invoices from public, anon, authenticated;
revoke all on table valtrim.package_draws from public, anon, authenticated;
revoke all on table valtrim.package_options from public, anon, authenticated;

revoke all on sequence valtrim.draw_packages_id_seq from public, anon, authenticated;
revoke all on sequence valtrim.invoices_id_seq from public, anon, authenticated;

grant select (
  id,
  package_number,
  builder_id,
  job_id,
  phase_id,
  setup_version_id,
  package_date,
  billing_period_start,
  billing_period_end,
  payment_terms_days,
  invoice_line_format,
  portal_name,
  workflow_status,
  notes,
  created_at,
  updated_at,
  status_changed_at,
  status_changed_by
) on valtrim.draw_packages to authenticated;

grant select (
  id,
  package_id,
  invoice_number,
  invoice_date,
  due_date,
  gross_amount,
  retention_amount,
  wrap_amount,
  net_amount,
  paid_amount,
  status
) on valtrim.invoices to authenticated;

grant select (
  package_id,
  lot_id,
  draw_id,
  lot_number,
  plan_code,
  draw_number,
  draw_name,
  base_draw_amount,
  hardware_amount,
  options_amount,
  gross_amount,
  retention_amount,
  wrap_amount,
  net_amount
) on valtrim.package_draws to authenticated;

grant select (
  package_id,
  lot_id,
  option_id,
  draw_id,
  option_code,
  option_name,
  option_price
) on valtrim.package_options to authenticated;

create policy draw_packages_select
on valtrim.draw_packages for select to authenticated
using ((select private.is_active_user()));

create policy invoices_select
on valtrim.invoices for select to authenticated
using ((select private.is_active_user()));

create policy package_draws_select
on valtrim.package_draws for select to authenticated
using ((select private.is_active_user()));

create policy package_options_select
on valtrim.package_options for select to authenticated
using ((select private.is_active_user()));

revoke execute on function private.create_draw_invoice_package(
  bigint, smallint[], bigint[], date, date, date, text
) from public, anon, authenticated;
revoke execute on function private.set_draw_package_workflow_status(
  bigint, valtrim.package_workflow_status
) from public, anon, authenticated;
revoke execute on function valtrim.create_draw_invoice_package(
  bigint, smallint[], bigint[], date, date, date, text
) from public, anon, authenticated;
revoke execute on function valtrim.set_draw_package_workflow_status(
  bigint, valtrim.package_workflow_status
) from public, anon, authenticated;

grant execute on function private.create_draw_invoice_package(
  bigint, smallint[], bigint[], date, date, date, text
) to authenticated, service_role;
grant execute on function private.set_draw_package_workflow_status(
  bigint, valtrim.package_workflow_status
) to authenticated, service_role;
grant execute on function valtrim.create_draw_invoice_package(
  bigint, smallint[], bigint[], date, date, date, text
) to authenticated, service_role;
grant execute on function valtrim.set_draw_package_workflow_status(
  bigint, valtrim.package_workflow_status
) to authenticated, service_role;

-- Dormant legacy Invoice/submission functions remain closed until their own
-- persistence phase.
revoke execute on function valtrim.issue_invoice(bigint, text, date, uuid)
  from public, anon, authenticated;
revoke execute on function valtrim.submit_draw_package(bigint, uuid)
  from public, anon, authenticated;

revoke all on valtrim.draw_package_overview from public, anon, authenticated;

comment on type valtrim.package_workflow_status is
  'Operational Draw Package status: DRAFT, READY_TO_SUBMIT, AWAITING_PAYMENT or PAID_CLOSED.';

comment on column valtrim.draw_packages.workflow_status is
  'Manual four-state workflow used by Draw & Invoice without rewriting the dormant integration status.';

comment on function valtrim.create_draw_invoice_package(
  bigint, smallint[], bigint[], date, date, date, text
) is
  'Creates one Draw Package, calculated line snapshots and one Invoice total atomically. ADMIN and PROJECT_MANAGEMENT only.';

comment on function valtrim.set_draw_package_workflow_status(
  bigint, valtrim.package_workflow_status
) is
  'Changes the operational Package status and audit actor. ADMIN and PROJECT_MANAGEMENT only.';

comment on policy draw_packages_select on valtrim.draw_packages is
  'Active authenticated users can read Draw Packages.';
comment on policy invoices_select on valtrim.invoices is
  'Active authenticated users can read calculated Invoice totals.';
comment on policy package_draws_select on valtrim.package_draws is
  'Active authenticated users can read immutable Package Draw snapshots.';
comment on policy package_options_select on valtrim.package_options is
  'Active authenticated users can read immutable Package Option snapshots.';

notify pgrst, 'reload schema';

commit;
