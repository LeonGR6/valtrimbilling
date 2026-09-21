-- Allow one Draw & Invoice Package to contain Lot / Draw cells from multiple
-- Phases, while keeping the Job and Billing Setup immutable.
begin;

-- phase_id remains a compatibility shortcut for single-Phase Packages. It is
-- NULL when the Package contains more than one Phase (or has been cancelled).
alter table valtrim.draw_packages
  alter column phase_id drop not null;

alter table valtrim.package_draws
  drop constraint package_draws_package_id_phase_id_fkey;

comment on column valtrim.draw_packages.phase_id is
  'Single Phase shortcut. NULL for multi-Phase or empty/cancelled Packages; authoritative Phase scope is stored on package_draws.';

-- These immutable snapshot columns are needed to render and group each Phase
-- without joining mutable catalog rows in the browser.
grant select (phase_id, phase_code, building)
  on valtrim.package_draws to authenticated;

create or replace function valtrim.prepare_draw_package()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_terms smallint;
  v_line_format valtrim.invoice_line_format;
  v_portal varchar(80);
begin
  if tg_op = 'UPDATE' then
    if new.builder_id is distinct from old.builder_id
       or new.job_id is distinct from old.job_id
       or new.setup_version_id is distinct from old.setup_version_id
       or new.package_date is distinct from old.package_date
       or new.payment_terms_days is distinct from old.payment_terms_days
       or new.invoice_line_format is distinct from old.invoice_line_format
       or new.portal_name is distinct from old.portal_name then
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

  select version.payment_terms_days, version.invoice_line_format, version.portal_name
  into v_terms, v_line_format, v_portal
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

  if v_terms is null then
    raise exception 'Job, Phases y billing setup no forman un package valido';
  end if;

  new.payment_terms_days := v_terms;
  new.invoice_line_format := v_line_format;
  new.portal_name := v_portal;
  return new;
end;
$$;

create or replace function valtrim.prepare_package_draw()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_record record;
  v_options_count integer;
  v_priced_options_count integer;
  v_prior_amount numeric(14,2);
begin
  select
    phase.id as phase_id,
    package.builder_id,
    package.setup_version_id,
    package.package_date,
    phase.code as phase_code,
    phase.building,
    lot.plan_id,
    lot.lot_number,
    lot.is_reverse,
    plan.code as plan_code,
    plan.name as plan_name,
    plan_price.id as plan_price_id,
    plan_price.base_price,
    plan_price.hardware_price as configured_hardware,
    draw.draw_number,
    draw.name as draw_name,
    draw.percentage as draw_percentage,
    version.separate_hardware_price,
    version.hardware_billing_draw_number,
    version.options_billing_draw_number,
    version.retention_percentage,
    version.wrap_percentage
  into v_record
  from valtrim.draw_packages package
  join valtrim.lots lot on lot.id = new.lot_id
  join valtrim.phases phase
    on phase.id = lot.phase_id and phase.job_id = package.job_id
  join valtrim.plans plan
    on plan.id = lot.plan_id and plan.job_id = package.job_id
  join valtrim.billing_draws draw
    on draw.id = new.draw_id
   and draw.setup_version_id = package.setup_version_id
  join valtrim.billing_setup_versions version
    on version.id = package.setup_version_id
  join lateral (
    select candidate.*
    from valtrim.plan_prices candidate
    where candidate.plan_id = lot.plan_id
      and candidate.effective_from <= package.package_date
      and (
        candidate.effective_to is null
        or candidate.effective_to >= package.package_date
      )
    order by candidate.effective_from desc
    limit 1
  ) plan_price on true
  where package.id = new.package_id and package.status = 'DRAFT';

  if v_record.plan_id is null then
    raise exception 'No se pudo calcular el draw: revise Job, Phase, Lot, Draw y precio vigente';
  end if;

  new.phase_id := v_record.phase_id;
  new.builder_id := v_record.builder_id;
  new.setup_version_id := v_record.setup_version_id;
  new.plan_id := v_record.plan_id;
  new.plan_price_id := v_record.plan_price_id;
  new.lot_number := v_record.lot_number;
  new.phase_code := v_record.phase_code;
  new.building := v_record.building;
  new.plan_code := v_record.plan_code;
  new.plan_name := v_record.plan_name;
  new.is_reverse := v_record.is_reverse;
  new.base_price := v_record.base_price;
  new.hardware_price := case when v_record.separate_hardware_price
    then v_record.configured_hardware else 0 end;
  new.draw_base := new.base_price - new.hardware_price;
  new.draw_number := v_record.draw_number;
  new.draw_name := v_record.draw_name;
  new.draw_percentage := v_record.draw_percentage;

  if v_record.draw_number = (
    select max(draw_number)
    from valtrim.billing_draws
    where setup_version_id = v_record.setup_version_id
  ) then
    select coalesce(sum(round(new.draw_base * percentage / 100, 2)), 0)
    into v_prior_amount
    from valtrim.billing_draws
    where setup_version_id = v_record.setup_version_id
      and draw_number < v_record.draw_number;
    new.base_draw_amount := new.draw_base - v_prior_amount;
  else
    new.base_draw_amount := round(
      new.draw_base * v_record.draw_percentage / 100, 2
    );
  end if;

  new.hardware_amount := case
    when v_record.separate_hardware_price
      and v_record.draw_number = v_record.hardware_billing_draw_number
    then new.hardware_price else 0 end;

  new.options_amount := 0;
  if v_record.draw_number = v_record.options_billing_draw_number then
    select count(*) into v_options_count
    from valtrim.lot_options where lot_id = new.lot_id;

    select count(*), coalesce(sum(price.price), 0)
    into v_priced_options_count, new.options_amount
    from valtrim.lot_options selected
    join lateral (
      select candidate.price
      from valtrim.option_prices candidate
      where candidate.option_id = selected.option_id
        and candidate.effective_from <= v_record.package_date
        and (
          candidate.effective_to is null
          or candidate.effective_to >= v_record.package_date
        )
      order by candidate.effective_from desc
      limit 1
    ) price on true
    where selected.lot_id = new.lot_id;

    if v_options_count <> v_priced_options_count then
      raise exception 'Una o mas options del lot no tienen precio vigente';
    end if;
  end if;

  new.gross_amount := new.base_draw_amount + new.hardware_amount + new.options_amount;
  new.retention_percentage := v_record.retention_percentage;
  new.retention_amount := round(
    new.gross_amount * new.retention_percentage / 100, 2
  );
  new.wrap_percentage := v_record.wrap_percentage;
  new.wrap_amount := round(new.gross_amount * new.wrap_percentage / 100, 2);
  new.net_amount := new.gross_amount - new.retention_amount - new.wrap_amount;
  return new;
end;
$$;

-- The first bigint now identifies the Job. The signature stays singular so
-- PostgREST exposes only one unambiguous creator.
revoke execute on function valtrim.create_draw_invoice_package(
  bigint, jsonb, date, date, date, text
) from public, anon, authenticated, service_role;
revoke execute on function private.create_draw_invoice_package(
  bigint, jsonb, date, date, date, text
) from public, anon, authenticated, service_role;

drop function valtrim.create_draw_invoice_package(
  bigint, jsonb, date, date, date, text
);
drop function private.create_draw_invoice_package(
  bigint, jsonb, date, date, date, text
);

create function private.create_draw_invoice_package(
  p_job_id bigint,
  p_selections jsonb,
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
  v_version_id bigint;
  v_single_phase_id bigint;
  v_phase_count integer;
  v_requested integer;
  v_unique integer;
  v_invalid integer;
  v_found integer;
  v_inserted integer;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to change Draw & Invoice Packages'
      using errcode = '42501';
  end if;

  if p_job_id is null or p_job_id <= 0 then
    raise exception 'Select an active Job' using errcode = '23503';
  end if;
  if jsonb_typeof(p_selections) is distinct from 'array' then
    raise exception 'Selections must be a JSON array' using errcode = '23514';
  end if;
  if jsonb_array_length(p_selections) = 0
     or jsonb_array_length(p_selections) > 5000 then
    raise exception 'Select between 1 and 5000 Lot / Draw cells'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_selections) item
    where jsonb_typeof(item) <> 'object'
       or not item ? 'lot_id'
       or not item ? 'draw_number'
  ) then
    raise exception 'Every selection must contain a Lot and Draw'
      using errcode = '23514';
  end if;

  select count(*),
    count(distinct row(selection.lot_id, selection.draw_number)),
    count(*) filter (
      where selection.lot_id is null or selection.lot_id <= 0
         or selection.draw_number is null or selection.draw_number <= 0
    )
  into v_requested, v_unique, v_invalid
  from jsonb_to_recordset(p_selections)
    as selection(lot_id bigint, draw_number smallint);

  if v_requested <> jsonb_array_length(p_selections)
     or v_unique <> v_requested or v_invalid <> 0 then
    raise exception 'Every Lot / Draw selection must be unique and valid'
      using errcode = '23514';
  end if;
  if p_package_date is null then
    raise exception 'Select a Package date' using errcode = '23514';
  end if;
  if p_period_start is not null and p_period_end is not null
     and p_period_end < p_period_start then
    raise exception 'Billing period end cannot precede its start'
      using errcode = '23514';
  end if;
  if p_notes is not null and char_length(btrim(p_notes)) > 500 then
    raise exception 'Package notes must contain 500 characters or fewer'
      using errcode = '23514';
  end if;

  select job.builder_id, job.billing_setup_version_id
  into v_builder_id, v_version_id
  from valtrim.jobs job
  join valtrim.billing_setup_versions version
    on version.id = job.billing_setup_version_id
   and version.builder_id = job.builder_id
  where job.id = p_job_id
    and job.is_active
    and version.status in ('ACTIVE', 'SUPERSEDED')
  for update of job;

  if v_builder_id is null then
    raise exception 'The Job or Billing Setup is no longer available'
      using errcode = '23503';
  end if;

  select count(*), count(distinct phase.id), min(phase.id)
  into v_found, v_phase_count, v_single_phase_id
  from jsonb_to_recordset(p_selections)
    as selection(lot_id bigint, draw_number smallint)
  join valtrim.lots lot on lot.id = selection.lot_id
  join valtrim.phases phase
    on phase.id = lot.phase_id
   and phase.job_id = p_job_id
   and phase.is_active
  join valtrim.billing_draws draw
    on draw.draw_number = selection.draw_number
   and draw.setup_version_id = v_version_id;

  if v_found <> v_requested then
    raise exception 'Every selected cell must belong to an active Phase in the same Job and Billing Setup'
      using errcode = '23503';
  end if;
  if v_phase_count <> 1 then
    v_single_phase_id := null;
  end if;

  insert into valtrim.draw_packages (
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
  returning id into v_package_id;

  insert into valtrim.invoices (package_id, created_by, updated_by)
  values (v_package_id, v_actor_id, v_actor_id);

  insert into valtrim.package_draws (package_id, lot_id, draw_id)
  select v_package_id, lot.id, draw.id
  from jsonb_to_recordset(p_selections)
    as selection(lot_id bigint, draw_number smallint)
  join valtrim.lots lot on lot.id = selection.lot_id
  join valtrim.phases phase
    on phase.id = lot.phase_id and phase.job_id = p_job_id
  join valtrim.billing_draws draw
    on draw.draw_number = selection.draw_number
   and draw.setup_version_id = v_version_id
  order by phase.code, selection.draw_number, lot.lot_number;

  get diagnostics v_inserted = row_count;
  if v_inserted <> v_requested then
    raise exception 'The Package did not generate every selected Lot / Draw cell'
      using errcode = '23514';
  end if;

  return v_package_id;
end;
$$;

create function valtrim.create_draw_invoice_package(
  p_job_id bigint,
  p_selections jsonb,
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
    p_job_id, p_selections, p_package_date,
    p_period_start, p_period_end, p_notes
  );
$$;

revoke execute on function private.create_draw_invoice_package(
  bigint, jsonb, date, date, date, text
) from public, anon, authenticated;
revoke execute on function valtrim.create_draw_invoice_package(
  bigint, jsonb, date, date, date, text
) from public, anon, authenticated;
grant execute on function private.create_draw_invoice_package(
  bigint, jsonb, date, date, date, text
) to authenticated, service_role;
grant execute on function valtrim.create_draw_invoice_package(
  bigint, jsonb, date, date, date, text
) to authenticated, service_role;

comment on function valtrim.create_draw_invoice_package(
  bigint, jsonb, date, date, date, text
) is
  'Creates one Package from exact Lot / Draw cells across one or more Phases of the same Job. ADMIN and PROJECT_MANAGEMENT only.';

create or replace function private.correct_draw_invoice_package(
  p_action text,
  p_package_id bigint,
  p_other_package_id bigint,
  p_selections jsonb,
  p_reason text,
  p_period_start date,
  p_period_end date,
  p_notes text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_job_id bigint;
  v_target record;
  v_source record;
  v_requested integer;
  v_unique integer;
  v_invalid integer;
  v_found integer;
  v_changed integer;
  v_source_remaining integer;
  v_removed jsonb := '[]'::jsonb;
  v_added jsonb := '[]'::jsonb;
  v_old_details jsonb;
  v_new_details jsonb;
  v_reason text := nullif(btrim(p_reason), '');
  v_notes text := nullif(btrim(p_notes), '');
begin
  if v_actor is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to correct Draw Packages'
      using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('EDIT', 'TRANSFER', 'CANCEL')
     or p_package_id is null or p_package_id <= 0 then
    raise exception 'Select a valid Package correction' using errcode = '23514';
  end if;
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'Enter a correction reason of 500 characters or fewer'
      using errcode = '23514';
  end if;

  select job_id into v_job_id
  from valtrim.draw_packages where id = p_package_id;
  if v_job_id is null then
    raise exception 'The Draw Package no longer exists' using errcode = 'P0002';
  end if;

  -- Creation and corrections serialize at the Job boundary, because all
  -- Phases in the Package necessarily belong to that Job.
  perform 1 from valtrim.jobs where id = v_job_id for update;
  perform 1
  from valtrim.draw_packages
  where id = p_package_id
     or (p_action = 'TRANSFER' and id = p_other_package_id)
  order by id
  for update;

  select package.*, invoice.status as invoice_status,
    invoice.invoice_number, invoice.invoice_date, invoice.paid_amount
  into v_target
  from valtrim.draw_packages package
  join valtrim.invoices invoice on invoice.package_id = package.id
  where package.id = p_package_id;

  if v_target.id is null
     or v_target.status <> 'DRAFT'
     or v_target.workflow_status not in ('DRAFT', 'READY_TO_SUBMIT')
     or v_target.quickbooks_status <> 'NOT_CREATED'
     or v_target.quickbooks_reference is not null
     or v_target.submission_status <> 'NOT_SUBMITTED'
     or v_target.submitted_at is not null
     or v_target.invoice_status <> 'DRAFT'
     or v_target.invoice_number is not null
     or v_target.invoice_date is not null
     or v_target.paid_amount <> 0
     or exists (
       select 1 from valtrim.invoice_payments payment
       join valtrim.invoices invoice on invoice.id = payment.invoice_id
       where invoice.package_id = p_package_id
     )
     or exists (
       select 1 from valtrim.package_documents document
       where document.package_id = p_package_id
         and (
           document.file_id is not null
           or document.status in ('COMPLETE', 'WAIVED')
         )
     ) then
    raise exception 'Only an unissued, unsynced draft Package can be corrected'
      using errcode = '23514';
  end if;

  if p_action = 'TRANSFER' then
    if p_other_package_id is null or p_other_package_id = p_package_id then
      raise exception 'Choose a different source Package' using errcode = '23514';
    end if;

    select package.*, invoice.status as invoice_status,
      invoice.invoice_number, invoice.invoice_date, invoice.paid_amount
    into v_source
    from valtrim.draw_packages package
    join valtrim.invoices invoice on invoice.package_id = package.id
    where package.id = p_other_package_id;

    if v_source.id is null
       or v_source.setup_version_id <> v_target.setup_version_id
       or v_source.job_id <> v_target.job_id
       or v_source.status <> 'DRAFT'
       or v_source.workflow_status not in ('DRAFT', 'READY_TO_SUBMIT')
       or v_source.quickbooks_status <> 'NOT_CREATED'
       or v_source.quickbooks_reference is not null
       or v_source.submission_status <> 'NOT_SUBMITTED'
       or v_source.submitted_at is not null
       or v_source.invoice_status <> 'DRAFT'
       or v_source.invoice_number is not null
       or v_source.invoice_date is not null
       or v_source.paid_amount <> 0
       or exists (
         select 1 from valtrim.invoice_payments payment
         join valtrim.invoices invoice on invoice.id = payment.invoice_id
         where invoice.package_id = p_other_package_id
       )
       or exists (
         select 1 from valtrim.package_documents document
         where document.package_id = p_other_package_id
           and (
             document.file_id is not null
             or document.status in ('COMPLETE', 'WAIVED')
           )
       ) then
      raise exception 'Source and destination must be editable Packages for the same Job and Billing Setup'
        using errcode = '23514';
    end if;
  elsif p_other_package_id is not null then
    raise exception 'Only a transfer may name another Package'
      using errcode = '23514';
  end if;

  if p_action <> 'CANCEL' then
    if jsonb_typeof(p_selections) is distinct from 'array' then
      raise exception 'Selections must be a JSON array' using errcode = '23514';
    end if;
    if jsonb_array_length(p_selections) = 0
       or jsonb_array_length(p_selections) > 5000 then
      raise exception 'Select between 1 and 5000 Lot / Draw cells'
        using errcode = '23514';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_selections) item
      where jsonb_typeof(item) <> 'object'
         or not item ? 'lot_id'
         or not item ? 'draw_number'
    ) then
      raise exception 'Every selection must contain a Lot and Draw'
        using errcode = '23514';
    end if;

    select count(*),
      count(distinct row(selection.lot_id, selection.draw_number)),
      count(*) filter (
        where selection.lot_id is null or selection.lot_id <= 0
           or selection.draw_number is null or selection.draw_number <= 0
      )
    into v_requested, v_unique, v_invalid
    from jsonb_to_recordset(p_selections)
      as selection(lot_id bigint, draw_number smallint);

    if v_requested <> jsonb_array_length(p_selections)
       or v_unique <> v_requested or v_invalid <> 0 then
      raise exception 'Every Lot / Draw cell must be unique and valid'
        using errcode = '23514';
    end if;

    select count(*) into v_found
    from jsonb_to_recordset(p_selections)
      as selection(lot_id bigint, draw_number smallint)
    join valtrim.lots lot on lot.id = selection.lot_id
    join valtrim.phases phase
      on phase.id = lot.phase_id and phase.job_id = v_target.job_id
    join valtrim.billing_draws draw
      on draw.draw_number = selection.draw_number
     and draw.setup_version_id = v_target.setup_version_id;
    if v_found <> v_requested then
      raise exception 'Every cell must belong to a Phase in the Package Job and Billing Setup'
        using errcode = '23503';
    end if;
  end if;

  perform set_config('valtrim.draw_package_correction', 'on', true);

  if p_action = 'EDIT' then
    if v_notes is not null and char_length(v_notes) > 500 then
      raise exception 'Package notes must contain 500 characters or fewer'
        using errcode = '23514';
    end if;
    if p_period_start is not null and p_period_end is not null
       and p_period_end < p_period_start then
      raise exception 'Billing period end cannot precede its start'
        using errcode = '23514';
    end if;
    if exists (
      select 1
      from jsonb_to_recordset(p_selections)
        as selection(lot_id bigint, draw_number smallint)
      join valtrim.billing_draws draw
        on draw.draw_number = selection.draw_number
       and draw.setup_version_id = v_target.setup_version_id
      join valtrim.package_draws occupied
        on occupied.lot_id = selection.lot_id and occupied.draw_id = draw.id
      where occupied.package_id <> p_package_id
    ) then
      raise exception 'A requested cell belongs to another Package; use Transfer instead'
        using errcode = '23505';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'phase_id', line.phase_id,
      'lot_id', line.lot_id,
      'draw_number', line.draw_number
    ) order by line.phase_id, line.draw_number, line.lot_id), '[]'::jsonb)
    into v_removed
    from valtrim.package_draws line
    where line.package_id = p_package_id
      and not exists (
        select 1 from jsonb_to_recordset(p_selections)
          as selection(lot_id bigint, draw_number smallint)
        where selection.lot_id = line.lot_id
          and selection.draw_number = line.draw_number
      );

    select coalesce(jsonb_agg(jsonb_build_object(
      'phase_id', lot.phase_id,
      'lot_id', selection.lot_id,
      'draw_number', selection.draw_number
    ) order by lot.phase_id, selection.draw_number, selection.lot_id), '[]'::jsonb)
    into v_added
    from jsonb_to_recordset(p_selections)
      as selection(lot_id bigint, draw_number smallint)
    join valtrim.lots lot on lot.id = selection.lot_id
    where not exists (
      select 1 from valtrim.package_draws line
      where line.package_id = p_package_id
        and line.lot_id = selection.lot_id
        and line.draw_number = selection.draw_number
    );

    delete from valtrim.package_options option
    using valtrim.package_draws line
    where option.package_id = p_package_id
      and line.package_id = p_package_id
      and line.lot_id = option.lot_id
      and line.draw_id = option.draw_id
      and not exists (
        select 1 from jsonb_to_recordset(p_selections)
          as selection(lot_id bigint, draw_number smallint)
        where selection.lot_id = line.lot_id
          and selection.draw_number = line.draw_number
      );

    delete from valtrim.package_draws line
    where line.package_id = p_package_id
      and not exists (
        select 1 from jsonb_to_recordset(p_selections)
          as selection(lot_id bigint, draw_number smallint)
        where selection.lot_id = line.lot_id
          and selection.draw_number = line.draw_number
      );

    insert into valtrim.package_draws (package_id, lot_id, draw_id)
    select p_package_id, lot.id, draw.id
    from jsonb_to_recordset(p_selections)
      as selection(lot_id bigint, draw_number smallint)
    join valtrim.lots lot on lot.id = selection.lot_id
    join valtrim.phases phase
      on phase.id = lot.phase_id and phase.job_id = v_target.job_id
    join valtrim.billing_draws draw
      on draw.draw_number = selection.draw_number
     and draw.setup_version_id = v_target.setup_version_id
    where not exists (
      select 1 from valtrim.package_draws line
      where line.package_id = p_package_id
        and line.lot_id = lot.id and line.draw_id = draw.id
    )
    order by phase.code, selection.draw_number, lot.lot_number;
    get diagnostics v_changed = row_count;
    if v_changed <> jsonb_array_length(v_added) then
      raise exception 'The edit did not insert every new cell'
        using errcode = '23514';
    end if;

    v_old_details := jsonb_build_object(
      'period_start', v_target.billing_period_start,
      'period_end', v_target.billing_period_end,
      'notes', v_target.notes
    );
    v_new_details := jsonb_build_object(
      'period_start', p_period_start,
      'period_end', p_period_end,
      'notes', v_notes
    );
    if v_removed = '[]'::jsonb and v_added = '[]'::jsonb
       and v_old_details = v_new_details then
      raise exception 'The Package has no changes to save' using errcode = '23514';
    end if;

    update valtrim.draw_packages
    set phase_id = (
          select case when count(distinct line.phase_id) = 1
            then min(line.phase_id) else null end
          from valtrim.package_draws line
          where line.package_id = p_package_id
        ),
        billing_period_start = p_period_start,
        billing_period_end = p_period_end,
        notes = v_notes,
        workflow_status = 'DRAFT',
        status_changed_at = now(),
        status_changed_by = v_actor,
        updated_by = v_actor,
        updated_at = now()
    where id = p_package_id;

  elsif p_action = 'TRANSFER' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'phase_id', line.phase_id,
      'lot_id', selection.lot_id,
      'draw_number', selection.draw_number
    ) order by line.phase_id, selection.draw_number, selection.lot_id), '[]'::jsonb)
    into v_added
    from jsonb_to_recordset(p_selections)
      as selection(lot_id bigint, draw_number smallint)
    join valtrim.package_draws line
      on line.package_id = p_other_package_id
     and line.lot_id = selection.lot_id
     and line.draw_number = selection.draw_number;
    v_removed := v_added;

    select count(*) into v_found
    from jsonb_to_recordset(p_selections)
      as selection(lot_id bigint, draw_number smallint)
    join valtrim.package_draws line
      on line.package_id = p_other_package_id
     and line.lot_id = selection.lot_id
     and line.draw_number = selection.draw_number;
    if v_found <> v_requested then
      raise exception 'Every transferred cell must currently belong to the source Package'
        using errcode = '23514';
    end if;

    delete from valtrim.package_options option
    using valtrim.package_draws line,
      jsonb_to_recordset(p_selections)
        as selection(lot_id bigint, draw_number smallint)
    where option.package_id = p_other_package_id
      and line.package_id = p_other_package_id
      and line.lot_id = option.lot_id
      and line.draw_id = option.draw_id
      and line.lot_id = selection.lot_id
      and line.draw_number = selection.draw_number;

    delete from valtrim.package_draws line
    using jsonb_to_recordset(p_selections)
      as selection(lot_id bigint, draw_number smallint)
    where line.package_id = p_other_package_id
      and line.lot_id = selection.lot_id
      and line.draw_number = selection.draw_number;
    get diagnostics v_changed = row_count;
    if v_changed <> v_requested then
      raise exception 'The transfer did not release every source cell'
        using errcode = '23514';
    end if;

    insert into valtrim.package_draws (package_id, lot_id, draw_id)
    select p_package_id, lot.id, draw.id
    from jsonb_to_recordset(p_selections)
      as selection(lot_id bigint, draw_number smallint)
    join valtrim.lots lot on lot.id = selection.lot_id
    join valtrim.phases phase
      on phase.id = lot.phase_id and phase.job_id = v_target.job_id
    join valtrim.billing_draws draw
      on draw.draw_number = selection.draw_number
     and draw.setup_version_id = v_target.setup_version_id
    order by phase.code, selection.draw_number, lot.lot_number;
    get diagnostics v_changed = row_count;
    if v_changed <> v_requested then
      raise exception 'The transfer did not add every destination cell'
        using errcode = '23514';
    end if;

    select count(*) into v_source_remaining
    from valtrim.package_draws where package_id = p_other_package_id;
    if v_source_remaining = 0 then
      update valtrim.draw_packages
      set phase_id = null,
          status = 'VOIDED',
          voided_at = now(),
          voided_by = v_actor,
          void_reason = v_reason,
          updated_by = v_actor,
          updated_at = now(),
          status_changed_at = now(),
          status_changed_by = v_actor
      where id = p_other_package_id;
    else
      update valtrim.draw_packages
      set phase_id = (
            select case when count(distinct line.phase_id) = 1
              then min(line.phase_id) else null end
            from valtrim.package_draws line
            where line.package_id = p_other_package_id
          ),
          workflow_status = 'DRAFT',
          updated_by = v_actor,
          updated_at = now(),
          status_changed_at = now(),
          status_changed_by = v_actor
      where id = p_other_package_id;
    end if;

    update valtrim.draw_packages
    set phase_id = (
          select case when count(distinct line.phase_id) = 1
            then min(line.phase_id) else null end
          from valtrim.package_draws line
          where line.package_id = p_package_id
        ),
        workflow_status = 'DRAFT',
        updated_by = v_actor,
        updated_at = now(),
        status_changed_at = now(),
        status_changed_by = v_actor
    where id = p_package_id;

  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'phase_id', line.phase_id,
      'lot_id', line.lot_id,
      'draw_number', line.draw_number
    ) order by line.phase_id, line.draw_number, line.lot_id), '[]'::jsonb)
    into v_removed
    from valtrim.package_draws line where line.package_id = p_package_id;

    delete from valtrim.package_options where package_id = p_package_id;
    delete from valtrim.package_draws where package_id = p_package_id;
    update valtrim.draw_packages
    set phase_id = null,
        status = 'VOIDED',
        voided_at = now(),
        voided_by = v_actor,
        void_reason = v_reason,
        updated_by = v_actor,
        updated_at = now(),
        status_changed_at = now(),
        status_changed_by = v_actor
    where id = p_package_id;
  end if;

  insert into valtrim.draw_package_corrections (
    package_id, other_package_id, action, removed_cells, added_cells,
    previous_details, next_details, reason, changed_by
  ) values (
    p_package_id, p_other_package_id, p_action, v_removed, v_added,
    v_old_details, v_new_details, v_reason, v_actor
  );

  perform set_config('valtrim.draw_package_correction', 'off', true);
  return p_package_id;
end;
$$;

comment on function private.correct_draw_invoice_package(
  text, bigint, bigint, jsonb, text, date, date, text
) is
  'Edits, transfers or cancels draft Package cells across Phases of one immutable Job.';

notify pgrst, 'reload schema';

commit;
