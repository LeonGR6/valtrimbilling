-- Retention is accumulated from immutable Draw Package lines and released only
-- after every non-Utility Lot in the configured Job or Building scope has a
-- qualifying Hardware charge. Release Packages are positive invoices and do
-- not apply retention or WRAP a second time.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table valtrim.billing_setup_versions
  add column retention_release_scope text not null default 'JOB',
  add constraint billing_setup_versions_retention_release_scope_check
    check (retention_release_scope in ('BUILDING', 'JOB'));

comment on column valtrim.billing_setup_versions.retention_release_scope is
  'Immutable scope used to release accumulated retention after Hardware completion: BUILDING or JOB.';

grant select (retention_release_scope)
  on valtrim.billing_setup_versions to authenticated;

-- Preserve the current setup-version implementation while adding one immutable
-- field. Historical versions default to JOB so existing retention is not split
-- retroactively without an explicit Builder Setup decision.
do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'valtrim.save_billing_setup_version(bigint,jsonb,jsonb,jsonb,bigint,uuid)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    'payment_terms_days, retention_enabled, retention_percentage,
      wrap_enabled',
    'payment_terms_days, retention_enabled, retention_percentage,
      retention_release_scope, wrap_enabled'
  );
  if v_updated = v_definition then
    raise exception 'Builder Setup retention release insert columns did not match the expected definition';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $original$case when coalesce((p_config->>'retentionEnabled')::boolean, false)
        then coalesce((p_config->>'retentionPercentage')::percentage, 0) else 0 end,
      coalesce((p_config->>'wrapEnabled')::boolean, false),$original$,
    $replacement$case when coalesce((p_config->>'retentionEnabled')::boolean, false)
        then coalesce((p_config->>'retentionPercentage')::percentage, 0) else 0 end,
      coalesce(nullif(p_config->>'retentionReleaseScope', ''), 'JOB'),
      coalesce((p_config->>'wrapEnabled')::boolean, false),$replacement$
  );
  if v_updated = v_definition then
    raise exception 'Builder Setup retention release insert value did not match the expected definition';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $original$retention_percentage = case
        when coalesce((p_config->>'retentionEnabled')::boolean, false)
        then coalesce((p_config->>'retentionPercentage')::percentage, 0) else 0 end,
      wrap_enabled =$original$,
    $replacement$retention_percentage = case
        when coalesce((p_config->>'retentionEnabled')::boolean, false)
        then coalesce((p_config->>'retentionPercentage')::percentage, 0) else 0 end,
      retention_release_scope = coalesce(
        nullif(p_config->>'retentionReleaseScope', ''), 'JOB'),
      wrap_enabled =$replacement$
  );
  if v_updated = v_definition then
    raise exception 'Builder Setup retention release update value did not match the expected definition';
  end if;

  execute v_updated;
end;
$migration$;

alter table valtrim.draw_packages
  add column package_type text not null default 'DRAW',
  add constraint draw_packages_package_type_check
    check (package_type in ('DRAW', 'RETENTION_RELEASE'));

comment on column valtrim.draw_packages.package_type is
  'DRAW contains immutable Lot / Draw lines. RETENTION_RELEASE is a positive release of previously retained line amounts.';

grant select (package_type) on valtrim.draw_packages to authenticated;

create or replace function valtrim.prepare_draw_package()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_line_format valtrim.invoice_line_format;
begin
  if tg_op = 'UPDATE' then
    if new.builder_id is distinct from old.builder_id
       or new.job_id is distinct from old.job_id
       or new.setup_version_id is distinct from old.setup_version_id
       or new.package_date is distinct from old.package_date
       or new.invoice_line_format is distinct from old.invoice_line_format
       or new.package_type is distinct from old.package_type then
      raise exception 'La configuracion, tipo y alcance del Job de un package son inmutables';
    end if;

    if new.phase_id is distinct from old.phase_id
       and not (
         current_setting('valtrim.draw_package_correction', true) = 'on'
         and (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT'))
       ) then
      raise exception 'El alcance de Phase solo cambia mediante una correccion del package';
    end if;

    if new.phase_id is not null and not exists (
      select 1
      from valtrim.phases phase
      where phase.id = new.phase_id and phase.job_id = new.job_id
    ) then
      raise exception 'Phase y Job no forman un package valido';
    end if;
    return new;
  end if;

  select version.invoice_line_format
  into v_line_format
  from valtrim.jobs job
  join valtrim.billing_setup_versions version
    on version.id = job.billing_setup_version_id
   and version.builder_id = job.builder_id
  where job.id = new.job_id
    and job.builder_id = new.builder_id
    and new.setup_version_id = job.billing_setup_version_id
    and (job.is_active or new.package_type = 'RETENTION_RELEASE')
    and version.status in ('ACTIVE', 'SUPERSEDED')
    and (
      new.phase_id is null
      or exists (
        select 1
        from valtrim.phases phase
        where phase.id = new.phase_id
          and phase.job_id = job.id
          and (phase.is_active or new.package_type = 'RETENTION_RELEASE')
      )
    );

  if v_line_format is null then
    raise exception 'Job, Phases y billing setup no forman un package valido';
  end if;

  new.invoice_line_format := v_line_format;
  return new;
end;
$$;

create table valtrim.retention_releases (
  package_id bigint primary key
    references valtrim.draw_packages(id) on delete restrict,
  job_id bigint not null references valtrim.jobs(id) on delete restrict,
  scope_type text not null check (scope_type in ('BUILDING', 'JOB')),
  phase_id bigint,
  phase_code varchar(40),
  building varchar(80),
  source_cutoff_date date not null,
  available_date date not null,
  retained_amount valtrim.amount not null check (retained_amount > 0),
  created_by uuid not null references valtrim.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (phase_id, job_id)
    references valtrim.phases(id, job_id) on delete restrict,
  check (
    (scope_type = 'BUILDING' and phase_id is not null and phase_code is not null)
    or (scope_type = 'JOB' and phase_id is null and phase_code is null and building is null)
  ),
  check (available_date >= source_cutoff_date)
);

create table valtrim.retention_release_lines (
  package_id bigint not null
    references valtrim.retention_releases(package_id) on delete restrict,
  source_package_id bigint not null,
  source_lot_id bigint not null,
  source_draw_id bigint not null,
  phase_id bigint not null,
  retention_amount valtrim.amount not null check (retention_amount > 0),
  created_at timestamptz not null default now(),
  primary key (
    package_id, source_package_id, source_lot_id, source_draw_id
  )
);

create index retention_releases_job_scope_idx
  on valtrim.retention_releases (job_id, scope_type, phase_id);

create index retention_releases_phase_id_idx
  on valtrim.retention_releases (phase_id)
  where phase_id is not null;

create index retention_releases_created_by_idx
  on valtrim.retention_releases (created_by);

create index retention_release_lines_source_idx
  on valtrim.retention_release_lines (
    source_package_id, source_lot_id, source_draw_id
  );

create index retention_release_lines_phase_id_idx
  on valtrim.retention_release_lines (phase_id);

comment on table valtrim.retention_releases is
  'One auditable positive Retention Release Package for a Builder Setup Job or Building scope.';
comment on table valtrim.retention_release_lines is
  'Immutable source Package lines whose retained amounts were included in one Retention Release Package.';

alter table valtrim.retention_releases enable row level security;
alter table valtrim.retention_release_lines enable row level security;

revoke all on valtrim.retention_releases from public, anon, authenticated;
revoke all on valtrim.retention_release_lines from public, anon, authenticated;

grant select on valtrim.retention_releases to authenticated;
grant select on valtrim.retention_release_lines to authenticated;

create policy retention_releases_select
on valtrim.retention_releases for select to authenticated
using ((select private.is_active_user()));

create policy retention_release_lines_select
on valtrim.retention_release_lines for select to authenticated
using ((select private.is_active_user()));

create function valtrim.reject_retention_release_snapshot_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Retention Release snapshots are immutable'
    using errcode = '42501';
end;
$$;

create trigger retention_releases_immutable
before update or delete on valtrim.retention_releases
for each row execute function valtrim.reject_retention_release_snapshot_change();

create trigger retention_release_lines_immutable
before update or delete on valtrim.retention_release_lines
for each row execute function valtrim.reject_retention_release_snapshot_change();

-- Returns the first configured cutoff on or after the Package date. Monthly
-- and semimonthly days are clamped to the final day of short months.
create function private.resolve_billing_cutoff_date(
  p_package_date date,
  p_setup_version_id bigint
)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  v_frequency valtrim.billing_frequency;
  v_any_date boolean;
  v_cutoff_day smallint;
  v_cutoff_days smallint[];
  v_cutoff_weekday smallint;
  v_month_start date;
  v_month_end date;
  v_candidate date;
  v_day smallint;
  v_offset integer;
begin
  select
    version.frequency,
    version.cutoff_any_date,
    version.cutoff_day,
    version.cutoff_days,
    version.cutoff_weekday
  into
    v_frequency,
    v_any_date,
    v_cutoff_day,
    v_cutoff_days,
    v_cutoff_weekday
  from valtrim.billing_setup_versions version
  where version.id = p_setup_version_id;

  if p_package_date is null or v_frequency is null or v_any_date then
    return null;
  end if;

  if v_frequency = 'SEMIMONTHLY' then
    select array_agg(day order by day)
    into v_cutoff_days
    from unnest(v_cutoff_days) as day;
  end if;

  if v_frequency = 'MONTHLY' then
    for v_offset in 0..1 loop
      v_month_start := (
        date_trunc('month', p_package_date)::date
        + make_interval(months => v_offset)
      )::date;
      v_month_end := (v_month_start + interval '1 month - 1 day')::date;
      v_candidate := make_date(
        extract(year from v_month_start)::integer,
        extract(month from v_month_start)::integer,
        least(v_cutoff_day, extract(day from v_month_end)::integer)
      );
      if v_candidate >= p_package_date then
        return v_candidate;
      end if;
    end loop;
  elsif v_frequency = 'SEMIMONTHLY' then
    for v_offset in 0..1 loop
      v_month_start := (
        date_trunc('month', p_package_date)::date
        + make_interval(months => v_offset)
      )::date;
      v_month_end := (v_month_start + interval '1 month - 1 day')::date;
      foreach v_day in array v_cutoff_days loop
        v_candidate := make_date(
          extract(year from v_month_start)::integer,
          extract(month from v_month_start)::integer,
          least(v_day, extract(day from v_month_end)::integer)
        );
        if v_candidate >= p_package_date then
          return v_candidate;
        end if;
      end loop;
    end loop;
  elsif v_frequency = 'WEEKLY' then
    return p_package_date + (
      (v_cutoff_weekday - extract(dow from p_package_date)::integer + 7) % 7
    );
  end if;

  return null;
end;
$$;

create function private.add_one_month_clamped(p_date date)
returns date
language sql
immutable
set search_path = ''
as $$
  with target as (
    select (date_trunc('month', p_date)::date + interval '1 month')::date
      as month_start
  )
  select make_date(
    extract(year from month_start)::integer,
    extract(month from month_start)::integer,
    least(
      extract(day from p_date)::integer,
      extract(day from (month_start + interval '1 month - 1 day'))::integer
    )
  )
  from target;
$$;

revoke execute on function private.resolve_billing_cutoff_date(date, bigint)
  from public, anon, authenticated;
revoke execute on function private.add_one_month_clamped(date)
  from public, anon, authenticated;
grant execute on function private.resolve_billing_cutoff_date(date, bigint)
  to service_role;
grant execute on function private.add_one_month_clamped(date)
  to service_role;

create or replace function valtrim.validate_package_workflow_status_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workflow_status is not distinct from old.workflow_status then
    return new;
  end if;

  if new.package_type = 'DRAW'
     and new.workflow_status = 'DRAFT'
     and exists (
       select 1
       from valtrim.retention_release_lines allocated
       join valtrim.draw_packages release_package
         on release_package.id = allocated.package_id
        and release_package.status <> 'VOIDED'
       where allocated.source_package_id = new.id
     ) then
    raise exception 'Cancel the active Retention Release before returning its source Package to Draft'
      using errcode = '23514';
  end if;

  if new.workflow_status <> 'DRAFT'
     and not exists (
       select 1
       from valtrim.package_draws package_draw
       where package_draw.package_id = new.id
     )
     and not exists (
       select 1
       from valtrim.retention_release_lines release_line
       where release_line.package_id = new.id
     ) then
    raise exception 'A package without calculated lines cannot leave DRAFT'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create function valtrim.reject_retention_release_draw_line()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from valtrim.draw_packages package
    where package.id = new.package_id
      and package.package_type = 'RETENTION_RELEASE'
  ) then
    raise exception 'A Retention Release Package cannot contain Draw lines'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger package_draws_reject_retention_release
before insert on valtrim.package_draws
for each row execute function valtrim.reject_retention_release_draw_line();

-- A cancelled Retention Release keeps its source snapshots for audit, but no
-- longer reserves those source lines. Active releases must be cancelled before
-- their source Package can be edited, transferred or cancelled.
create or replace function valtrim.reject_package_line_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_package_id bigint := old.package_id;
begin
  if tg_op = 'DELETE'
     and current_setting('valtrim.draw_package_correction', true) = 'on'
     and (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT'))
     and not exists (
       select 1
       from valtrim.retention_release_lines allocated
       join valtrim.draw_packages release_package
         on release_package.id = allocated.package_id
        and release_package.status <> 'VOIDED'
       where allocated.source_package_id = v_package_id
         and allocated.source_lot_id = old.lot_id
         and allocated.source_draw_id = old.draw_id
     )
     and exists (
       select 1
       from valtrim.draw_packages package
       join valtrim.invoices invoice on invoice.package_id = package.id
       where package.id = v_package_id
         and package.status = 'DRAFT'
         and package.workflow_status in ('DRAFT', 'READY_TO_SUBMIT')
         and package.quickbooks_status = 'NOT_CREATED'
         and package.quickbooks_reference is null
         and package.submission_status = 'NOT_SUBMITTED'
         and package.submitted_at is null
         and invoice.status = 'DRAFT'
         and invoice.invoice_number is null
         and invoice.invoice_date is null
         and invoice.paid_amount = 0
         and not exists (
           select 1 from valtrim.invoice_payments payment
           where payment.invoice_id = invoice.id
         )
         and not exists (
           select 1 from valtrim.package_documents document
           where document.package_id = package.id
             and (
               document.file_id is not null
               or document.status in ('COMPLETE', 'WAIVED')
             )
         )
     ) then
    return old;
  end if;

  raise exception 'Calculated Package lines are immutable or reserved by an active Retention Release'
    using errcode = '42501';
end;
$$;

create function valtrim.prevent_allocated_source_package_void()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.package_type = 'DRAW'
     and new.status = 'VOIDED'
     and old.status <> 'VOIDED'
     and exists (
       select 1
       from valtrim.retention_release_lines allocated
       join valtrim.draw_packages release_package
         on release_package.id = allocated.package_id
        and release_package.status <> 'VOIDED'
       where allocated.source_package_id = new.id
     ) then
    raise exception 'Cancel the active Retention Release before cancelling its source Package'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger draw_packages_prevent_allocated_source_void
before update of status on valtrim.draw_packages
for each row execute function valtrim.prevent_allocated_source_package_void();

create function private.create_retention_release_package(
  p_job_id bigint,
  p_phase_id bigint default null,
  p_notes text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_builder_id bigint;
  v_setup_version_id bigint;
  v_scope_type text;
  v_retention_enabled boolean;
  v_separate_hardware boolean;
  v_invoice_line_format valtrim.invoice_line_format;
  v_phase_code text;
  v_building text;
  v_expected_lots integer;
  v_completed_lots integer;
  v_source_cutoff_date date;
  v_available_date date;
  v_missing_cutoff boolean;
  v_retained_amount numeric(14,2);
  v_package_id bigint;
  v_inserted integer;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to release retention'
      using errcode = '42501';
  end if;

  if p_job_id is null or p_job_id <= 0 then
    raise exception 'Select a valid Job' using errcode = '23503';
  end if;
  if p_notes is not null and char_length(btrim(p_notes)) > 500 then
    raise exception 'Package notes must contain 500 characters or fewer'
      using errcode = '23514';
  end if;

  -- Package creation/correction already locks the Job first. Keeping the same
  -- order prevents deadlocks while making the source status and balance stable.
  perform 1 from valtrim.jobs where id = p_job_id for update;

  select
    job.builder_id,
    job.billing_setup_version_id,
    version.retention_release_scope,
    version.retention_enabled,
    version.separate_hardware_price,
    version.invoice_line_format
  into
    v_builder_id,
    v_setup_version_id,
    v_scope_type,
    v_retention_enabled,
    v_separate_hardware,
    v_invoice_line_format
  from valtrim.jobs job
  join valtrim.billing_setup_versions version
    on version.id = job.billing_setup_version_id
   and version.builder_id = job.builder_id
  where job.id = p_job_id
    and version.status in ('ACTIVE', 'SUPERSEDED');

  if v_builder_id is null then
    raise exception 'The Job Billing Setup is unavailable'
      using errcode = '23503';
  end if;
  if not v_retention_enabled then
    raise exception 'Retention is not enabled for this Job Billing Setup'
      using errcode = '23514';
  end if;

  if v_scope_type = 'BUILDING' then
    if p_phase_id is null or p_phase_id <= 0 then
      raise exception 'Select the Building to release'
        using errcode = '23514';
    end if;
    select phase.code, phase.building
    into v_phase_code, v_building
    from valtrim.phases phase
    where phase.id = p_phase_id
      and phase.job_id = p_job_id
      and not phase.is_utility_building;
    if v_phase_code is null then
      raise exception 'The selected Building does not belong to this Job'
        using errcode = '23503';
    end if;
  elsif v_scope_type = 'JOB' then
    if p_phase_id is not null then
      raise exception 'This Builder Setup releases retention Per Job'
        using errcode = '23514';
    end if;
  else
    raise exception 'The retention release scope is invalid'
      using errcode = '23514';
  end if;

  perform 1
  from valtrim.draw_packages package
  where package.job_id = p_job_id
  order by package.id
  for update;

  select count(*)
  into v_expected_lots
  from valtrim.lots lot
  join valtrim.phases phase
    on phase.id = lot.phase_id and phase.job_id = p_job_id
  where not lot.is_utility_building
    and (v_scope_type = 'JOB' or phase.id = p_phase_id);

  if v_expected_lots = 0 then
    raise exception 'This retention scope has no billable Lots'
      using errcode = '23514';
  end if;

  select count(distinct line.lot_id)
  into v_completed_lots
  from valtrim.package_draws line
  join valtrim.draw_packages package
    on package.id = line.package_id
   and package.job_id = p_job_id
   and package.package_type = 'DRAW'
   and package.status <> 'VOIDED'
   and package.workflow_status in (
     'READY_TO_SUBMIT', 'AWAITING_PAYMENT', 'PAID_CLOSED'
   )
  join valtrim.lots lot
    on lot.id = line.lot_id and not lot.is_utility_building
  join valtrim.billing_draws draw
    on draw.id = line.draw_id
  where (v_scope_type = 'JOB' or line.phase_id = p_phase_id)
    and (
      (v_separate_hardware and line.hardware_amount > 0)
      or (not v_separate_hardware and draw.event_type = 'HW')
    );

  if v_completed_lots <> v_expected_lots then
    raise exception 'Hardware must be billed for every Lot in this retention scope (% of % complete)',
      v_completed_lots, v_expected_lots
      using errcode = '23514';
  end if;

  select
    max(source.cutoff_date),
    bool_or(source.cutoff_date is null)
  into v_source_cutoff_date, v_missing_cutoff
  from (
    select distinct
      package.id,
      private.resolve_billing_cutoff_date(
        package.package_date,
        package.setup_version_id
      ) as cutoff_date
    from valtrim.package_draws line
    join valtrim.draw_packages package
      on package.id = line.package_id
     and package.job_id = p_job_id
     and package.package_type = 'DRAW'
     and package.status <> 'VOIDED'
     and package.workflow_status in (
       'READY_TO_SUBMIT', 'AWAITING_PAYMENT', 'PAID_CLOSED'
     )
    join valtrim.lots lot
      on lot.id = line.lot_id and not lot.is_utility_building
    join valtrim.billing_draws draw
      on draw.id = line.draw_id
    where (v_scope_type = 'JOB' or line.phase_id = p_phase_id)
      and (
        (v_separate_hardware and line.hardware_amount > 0)
        or (not v_separate_hardware and draw.event_type = 'HW')
      )
  ) source;

  if coalesce(v_missing_cutoff, true) or v_source_cutoff_date is null then
    raise exception 'The final Hardware Package needs a configured cutoff date before retention can be released'
      using errcode = '23514';
  end if;

  v_available_date := private.add_one_month_clamped(v_source_cutoff_date);
  if current_date < v_available_date then
    raise exception 'Retention becomes available on %', v_available_date
      using errcode = '23514';
  end if;

  select coalesce(sum(line.retention_amount), 0)
  into v_retained_amount
  from valtrim.package_draws line
  join valtrim.draw_packages package
    on package.id = line.package_id
   and package.job_id = p_job_id
   and package.package_type = 'DRAW'
   and package.status <> 'VOIDED'
   and package.workflow_status in (
     'READY_TO_SUBMIT', 'AWAITING_PAYMENT', 'PAID_CLOSED'
   )
  where line.retention_amount > 0
    and (v_scope_type = 'JOB' or line.phase_id = p_phase_id)
    and not exists (
      select 1
      from valtrim.retention_release_lines allocated
      join valtrim.draw_packages release_package
        on release_package.id = allocated.package_id
       and release_package.status <> 'VOIDED'
      where allocated.source_package_id = line.package_id
        and allocated.source_lot_id = line.lot_id
        and allocated.source_draw_id = line.draw_id
    );

  if v_retained_amount <= 0 then
    raise exception 'This retention scope has no unreleased amount'
      using errcode = '23514';
  end if;

  insert into valtrim.draw_packages (
    package_number,
    package_type,
    builder_id,
    job_id,
    phase_id,
    setup_version_id,
    package_date,
    invoice_line_format,
    notes,
    workflow_status,
    status_changed_by,
    created_by,
    updated_by
  ) values (
    'RP-' || lpad(nextval('valtrim.draw_package_number_seq')::text, 8, '0'),
    'RETENTION_RELEASE',
    v_builder_id,
    p_job_id,
    case when v_scope_type = 'BUILDING' then p_phase_id end,
    v_setup_version_id,
    current_date,
    v_invoice_line_format,
    nullif(btrim(p_notes), ''),
    'DRAFT',
    v_actor_id,
    v_actor_id,
    v_actor_id
  ) returning id into v_package_id;

  insert into valtrim.invoices (
    package_id,
    gross_amount,
    retention_amount,
    wrap_amount,
    net_amount,
    created_by,
    updated_by
  ) values (
    v_package_id,
    v_retained_amount,
    0,
    0,
    v_retained_amount,
    v_actor_id,
    v_actor_id
  );

  insert into valtrim.retention_releases (
    package_id,
    job_id,
    scope_type,
    phase_id,
    phase_code,
    building,
    source_cutoff_date,
    available_date,
    retained_amount,
    created_by
  ) values (
    v_package_id,
    p_job_id,
    v_scope_type,
    case when v_scope_type = 'BUILDING' then p_phase_id end,
    case when v_scope_type = 'BUILDING' then v_phase_code end,
    case when v_scope_type = 'BUILDING' then v_building end,
    v_source_cutoff_date,
    v_available_date,
    v_retained_amount,
    v_actor_id
  );

  insert into valtrim.retention_release_lines (
    package_id,
    source_package_id,
    source_lot_id,
    source_draw_id,
    phase_id,
    retention_amount
  )
  select
    v_package_id,
    line.package_id,
    line.lot_id,
    line.draw_id,
    line.phase_id,
    line.retention_amount
  from valtrim.package_draws line
  join valtrim.draw_packages package
    on package.id = line.package_id
   and package.job_id = p_job_id
   and package.package_type = 'DRAW'
   and package.status <> 'VOIDED'
   and package.workflow_status in (
     'READY_TO_SUBMIT', 'AWAITING_PAYMENT', 'PAID_CLOSED'
   )
  where line.retention_amount > 0
    and (v_scope_type = 'JOB' or line.phase_id = p_phase_id)
    and not exists (
      select 1
      from valtrim.retention_release_lines allocated
      join valtrim.draw_packages release_package
        on release_package.id = allocated.package_id
       and release_package.status <> 'VOIDED'
      where allocated.source_package_id = line.package_id
        and allocated.source_lot_id = line.lot_id
        and allocated.source_draw_id = line.draw_id
    )
  order by line.package_id, line.phase_id, line.lot_id, line.draw_id;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    raise exception 'The Retention Release did not allocate any source lines'
      using errcode = '23514';
  end if;

  return v_package_id;
end;
$$;

create function valtrim.create_retention_release_package(
  p_job_id bigint,
  p_phase_id bigint default null,
  p_notes text default null
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.create_retention_release_package(
    p_job_id, p_phase_id, p_notes
  );
$$;

revoke execute on function private.create_retention_release_package(
  bigint, bigint, text
) from public, anon, authenticated;
revoke execute on function valtrim.create_retention_release_package(
  bigint, bigint, text
) from public, anon, authenticated;
grant execute on function private.create_retention_release_package(
  bigint, bigint, text
) to authenticated, service_role;
grant execute on function valtrim.create_retention_release_package(
  bigint, bigint, text
) to authenticated, service_role;

comment on function valtrim.create_retention_release_package(
  bigint, bigint, text
) is
  'Creates a positive Retention Release Package after qualifying Hardware completion and the one-month cutoff hold. DRAFT source Packages never contribute.';

notify pgrst, 'reload schema';

commit;
