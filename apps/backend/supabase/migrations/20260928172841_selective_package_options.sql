-- Allow Package creators to exclude individual Lot Options from the configured
-- Options billing Draw while preserving immutable calculated snapshots.
begin;

create or replace function private.package_option_is_selected(
  p_lot_id bigint,
  p_draw_number smallint,
  p_option_id bigint
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_request_text text := current_setting(
    'valtrim.draw_package_selections', true
  );
  v_selection jsonb;
begin
  -- Corrections and older callers do not provide an explicit Option choice.
  -- Their established behavior remains: include every Option selected on the Lot.
  if v_request_text is null or v_request_text = '' then
    return true;
  end if;

  v_selection := v_request_text::jsonb
    -> (p_lot_id::text || ':' || p_draw_number::text);

  if v_selection is null or not (v_selection ? 'option_ids') then
    return true;
  end if;

  return exists (
    select 1
    from jsonb_array_elements_text(v_selection->'option_ids') selected(option_id)
    where selected.option_id::bigint = p_option_id
  );
end;
$$;

revoke execute on function private.package_option_is_selected(
  bigint, smallint, bigint
) from public, anon, authenticated;

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
    select count(*)
    into v_options_count
    from valtrim.lot_options selected
    where selected.lot_id = new.lot_id
      and private.package_option_is_selected(
        new.lot_id, v_record.draw_number, selected.option_id
      );

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
    where selected.lot_id = new.lot_id
      and private.package_option_is_selected(
        new.lot_id, v_record.draw_number, selected.option_id
      );

    if v_options_count <> v_priced_options_count then
      raise exception 'Una o mas options seleccionadas del lot no tienen precio vigente';
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

create or replace function valtrim.populate_package_options()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.draw_number = (
    select options_billing_draw_number
    from valtrim.billing_setup_versions where id = new.setup_version_id
  ) then
    insert into valtrim.package_options (
      package_id, lot_id, option_id, draw_id, option_price_id,
      option_code, option_name, option_price
    )
    select new.package_id, new.lot_id, selected.option_id, new.draw_id,
           price.id, option.code, option.name, price.price
    from valtrim.lot_options selected
    join valtrim.plan_options option on option.id = selected.option_id
    join valtrim.draw_packages package on package.id = new.package_id
    join lateral (
      select candidate.* from valtrim.option_prices candidate
      where candidate.option_id = selected.option_id
        and candidate.effective_from <= package.package_date
        and (
          candidate.effective_to is null
          or candidate.effective_to >= package.package_date
        )
      order by candidate.effective_from desc
      limit 1
    ) price on true
    where selected.lot_id = new.lot_id
      and private.package_option_is_selected(
        new.lot_id, new.draw_number, selected.option_id
      );
  end if;
  return new;
end;
$$;

create or replace function private.create_draw_invoice_package(
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
  v_options_billing_draw_number smallint;
  v_single_phase_id bigint;
  v_phase_count integer;
  v_requested integer;
  v_unique integer;
  v_invalid integer;
  v_found integer;
  v_inserted integer;
  v_requested_options integer;
  v_found_options integer;
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
  if exists (
    select 1
    from jsonb_array_elements(p_selections) item
    where item ? 'option_ids'
      and jsonb_typeof(item->'option_ids') is distinct from 'array'
  ) then
    raise exception 'Option selections must be JSON arrays'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_selections) item
    cross join lateral jsonb_array_elements(item->'option_ids') option_id
    where item ? 'option_ids'
      and (
        jsonb_typeof(option_id) <> 'number'
        or option_id #>> '{}' !~ '^[1-9][0-9]*$'
      )
  ) then
    raise exception 'Every selected Option must have a valid identity'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_selections) item
    where item ? 'option_ids'
      and jsonb_array_length(item->'option_ids') <> (
        select count(distinct option_id::bigint)
        from jsonb_array_elements_text(item->'option_ids') selected(option_id)
      )
  ) then
    raise exception 'Every selected Option must be unique within its Lot'
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

  select
    job.builder_id,
    job.billing_setup_version_id,
    version.options_billing_draw_number
  into v_builder_id, v_version_id, v_options_billing_draw_number
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

  if exists (
    select 1
    from jsonb_array_elements(p_selections) item
    where item ? 'option_ids'
      and jsonb_array_length(item->'option_ids') > 0
      and (item->>'draw_number')::smallint
        is distinct from v_options_billing_draw_number
  ) then
    raise exception 'Options may only be selected on the configured Options billing Draw'
      using errcode = '23514';
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

  select count(*), count(selected.option_id)
  into v_requested_options, v_found_options
  from jsonb_array_elements(p_selections) item
  cross join lateral jsonb_array_elements_text(item->'option_ids') requested(option_id)
  left join valtrim.lot_options selected
    on selected.lot_id = (item->>'lot_id')::bigint
   and selected.option_id = requested.option_id::bigint
  where item ? 'option_ids';

  if v_requested_options <> v_found_options then
    raise exception 'Every selected Option must belong to its selected Lot'
      using errcode = '23503';
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

  perform set_config(
    'valtrim.draw_package_selections',
    (
      select jsonb_object_agg(
        item->>'lot_id' || ':' || item->>'draw_number',
        item
      )::text
      from jsonb_array_elements(p_selections) item
    ),
    true
  );

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
  perform set_config('valtrim.draw_package_selections', '', true);

  if v_inserted <> v_requested then
    raise exception 'The Package did not generate every selected Lot / Draw cell'
      using errcode = '23514';
  end if;

  return v_package_id;
end;
$$;

comment on function valtrim.create_draw_invoice_package(
  bigint, jsonb, date, date, date, text
) is
  'Creates one Package from exact Lot / Draw cells. Billing-draw selections may include validated option_ids; omitted option_ids preserve the legacy include-all behavior.';

notify pgrst, 'reload schema';

commit;
