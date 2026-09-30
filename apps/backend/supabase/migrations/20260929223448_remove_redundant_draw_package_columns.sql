-- Draw Packages already retain an immutable Billing Setup version. Remove
-- duplicated setup data and the obsolete billing-period fields, then resolve
-- payment terms directly from that immutable version when an Invoice is dated.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Retire the original single-Phase creator. It has not been exposed to browser
-- users since the role/RLS migration and its billing-period arguments belong to
-- the superseded Package workflow.
drop function if exists valtrim.create_draw_package(
  bigint, smallint[], bigint[], date, date, date, text, uuid
);

drop function valtrim.create_draw_invoice_package(
  bigint, jsonb, date, date, date, text
);

-- Preserve the current multi-Phase and deferred-Options implementation while
-- removing only the obsolete date parameters and duplicated Package columns.
do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'private.create_draw_invoice_package(bigint,jsonb,date,date,date,text)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    'CREATE OR REPLACE FUNCTION private.create_draw_invoice_package(p_job_id bigint, p_selections jsonb, p_package_date date DEFAULT CURRENT_DATE, p_period_start date DEFAULT NULL::date, p_period_end date DEFAULT NULL::date, p_notes text DEFAULT NULL::text)',
    'CREATE OR REPLACE FUNCTION private.create_draw_invoice_package(p_job_id bigint, p_selections jsonb, p_package_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text)'
  );

  if v_updated = v_definition then
    raise exception 'Package creator signature did not match the expected definition';
  end if;

  v_definition := v_updated;
  v_updated := replace(
    v_definition,
    $original$  if p_period_start is not null and p_period_end is not null
     and p_period_end < p_period_start then
    raise exception 'Billing period end cannot precede its start'
      using errcode = '23514';
  end if;
$original$,
    ''
  );

  if v_updated = v_definition then
    raise exception 'Package creator billing-period validation did not match the expected definition';
  end if;

  v_definition := v_updated;
  v_updated := replace(
    v_definition,
    $original$  insert into valtrim.draw_packages (
    builder_id, job_id, phase_id, setup_version_id, package_date,
    billing_period_start, billing_period_end, payment_terms_days,
    invoice_line_format, notes, workflow_status, status_changed_by,
    created_by, updated_by
  )
  select
    v_builder_id, p_job_id, v_single_phase_id, v_version_id, p_package_date,
    p_period_start, p_period_end, version.payment_terms_days,
    version.invoice_line_format, nullif(btrim(p_notes), ''),
    'DRAFT'::valtrim.package_workflow_status, v_actor_id, v_actor_id, v_actor_id
  from valtrim.billing_setup_versions version
  where version.id = v_version_id
  returning id into v_package_id;$original$,
    $replacement$  insert into valtrim.draw_packages (
    builder_id, job_id, phase_id, setup_version_id, package_date,
    invoice_line_format, notes, workflow_status, status_changed_by,
    created_by, updated_by
  )
  select
    v_builder_id, p_job_id, v_single_phase_id, v_version_id, p_package_date,
    version.invoice_line_format, nullif(btrim(p_notes), ''),
    'DRAFT'::valtrim.package_workflow_status, v_actor_id, v_actor_id, v_actor_id
  from valtrim.billing_setup_versions version
  where version.id = v_version_id
  returning id into v_package_id;$replacement$
  );

  if v_updated = v_definition then
    raise exception 'Package creator INSERT did not match the expected definition';
  end if;

  if v_updated ~ 'p_period_start|p_period_end|billing_period_start|billing_period_end|payment_terms_days|portal_name' then
    raise exception 'Obsolete Draw Package fields remain in the new creator';
  end if;

  drop function private.create_draw_invoice_package(
    bigint, jsonb, date, date, date, text
  );
  execute v_updated;
end;
$migration$;

create function valtrim.create_draw_invoice_package(
  p_job_id bigint,
  p_selections jsonb,
  p_package_date date default current_date,
  p_notes text default null
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.create_draw_invoice_package(
    p_job_id, p_selections, p_package_date, p_notes
  );
$$;

revoke execute on function private.create_draw_invoice_package(
  bigint, jsonb, date, text
) from public, anon, authenticated;
revoke execute on function valtrim.create_draw_invoice_package(
  bigint, jsonb, date, text
) from public, anon, authenticated;
grant execute on function private.create_draw_invoice_package(
  bigint, jsonb, date, text
) to authenticated, service_role;
grant execute on function valtrim.create_draw_invoice_package(
  bigint, jsonb, date, text
) to authenticated, service_role;

comment on function valtrim.create_draw_invoice_package(
  bigint, jsonb, date, text
) is
  'Creates one Package from exact Lot / Draw cells. Billing behavior is resolved through the immutable Billing Setup version; ADMIN and PROJECT_MANAGEMENT only.';

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
       or new.invoice_line_format is distinct from old.invoice_line_format then
      raise exception 'La configuracion y alcance del Job de un package son inmutables';
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
    and job.is_active
    and version.status in ('ACTIVE', 'SUPERSEDED')
    and (
      new.phase_id is null
      or exists (
        select 1
        from valtrim.phases phase
        where phase.id = new.phase_id
          and phase.job_id = job.id
          and phase.is_active
      )
    );

  if v_line_format is null then
    raise exception 'Job, Phases y billing setup no forman un package valido';
  end if;

  new.invoice_line_format := v_line_format;
  return new;
end;
$$;

create or replace function valtrim.prepare_invoice()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_terms smallint;
begin
  if new.invoice_date is not null then
    select version.payment_terms_days
    into v_terms
    from valtrim.draw_packages package
    join valtrim.billing_setup_versions version
      on version.id = package.setup_version_id
     and version.builder_id = package.builder_id
    where package.id = new.package_id;

    if v_terms is null then
      raise exception 'The Package Billing Setup is unavailable'
        using errcode = '23503';
    end if;

    new.due_date := new.invoice_date + v_terms;
  else
    new.due_date := null;
  end if;
  return new;
end;
$$;

alter table valtrim.draw_packages
  drop column if exists billing_period_start,
  drop column if exists billing_period_end,
  drop column if exists payment_terms_days,
  drop column if exists portal_name;

comment on column valtrim.draw_packages.created_at is
  'Timestamp when the Package was created.';
comment on column valtrim.draw_packages.created_by is
  'Authenticated application user who created the Package.';
comment on column valtrim.draw_packages.submitted_at is
  'Timestamp when an issued Package was actually submitted; NULL before submission.';
comment on column valtrim.draw_packages.submitted_by is
  'Application user who actually submitted the Package; NULL before submission.';

notify pgrst, 'reload schema';

commit;
