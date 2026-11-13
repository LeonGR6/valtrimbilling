-- Let a later Package collect still-pending Options after their Lot already
-- reached the configured Options billing Draw. The charged Option keeps its
-- origin Lot snapshot while one current billing-Draw cell carries the amount.
begin;

alter table valtrim.package_options
  add column billing_lot_id bigint,
  add column phase_id bigint,
  add column phase_code varchar(40),
  add column building varchar(80),
  add column lot_number varchar(40),
  add column plan_code varchar(40);

alter table valtrim.package_options
  disable trigger package_options_immutable;

update valtrim.package_options option
set billing_lot_id = option.lot_id,
    phase_id = line.phase_id,
    phase_code = line.phase_code,
    building = line.building,
    lot_number = line.lot_number,
    plan_code = line.plan_code
from valtrim.package_draws line
where line.package_id = option.package_id
  and line.lot_id = option.lot_id
  and line.draw_id = option.draw_id;

alter table valtrim.package_options
  enable trigger package_options_immutable;

alter table valtrim.package_options
  alter column billing_lot_id set not null,
  alter column phase_id set not null,
  alter column phase_code set not null,
  alter column lot_number set not null,
  alter column plan_code set not null,
  drop constraint if exists package_options_package_id_lot_id_draw_id_fkey,
  add constraint package_options_package_billing_draw_fkey
    foreign key (package_id, billing_lot_id, draw_id)
    references valtrim.package_draws(package_id, lot_id, draw_id)
    on delete cascade;

create index package_options_package_billing_draw_idx
  on valtrim.package_options (package_id, billing_lot_id, draw_id);

grant select (
  billing_lot_id,
  phase_id,
  phase_code,
  building,
  lot_number,
  plan_code
) on valtrim.package_options to authenticated;

comment on column valtrim.package_options.billing_lot_id is
  'Lot whose current Package billing-Draw line carries this Option amount. The Option origin remains lot_id.';
comment on column valtrim.package_options.phase_id is
  'Immutable Phase snapshot for the Option origin Lot.';
comment on column valtrim.package_options.lot_number is
  'Immutable Lot number snapshot for the Option origin Lot.';

create function private.package_option_charge_is_selected(
  p_billing_lot_id bigint,
  p_draw_number smallint,
  p_option_lot_id bigint,
  p_option_id bigint
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_request_text text := current_setting(
    'valtrim.draw_package_option_charge', true
  );
  v_request jsonb;
begin
  -- Correction flows and older clients retain their established behavior:
  -- each billing-Draw line collects every Option on its own Lot.
  if v_request_text is null or v_request_text = '' then
    return p_option_lot_id = p_billing_lot_id;
  end if;

  v_request := v_request_text::jsonb;
  if (v_request->>'anchor_lot_id')::bigint <> p_billing_lot_id
     or (v_request->>'anchor_draw_number')::smallint <> p_draw_number then
    return false;
  end if;

  return exists (
    select 1
    from jsonb_to_recordset(v_request->'package_options')
      as selected(lot_id bigint, option_id bigint)
    where selected.lot_id = p_option_lot_id
      and selected.option_id = p_option_id
  );
end;
$$;

revoke execute on function private.package_option_charge_is_selected(
  bigint, smallint, bigint, bigint
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
    where private.package_option_charge_is_selected(
      new.lot_id,
      v_record.draw_number,
      selected.lot_id,
      selected.option_id
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
    where private.package_option_charge_is_selected(
      new.lot_id,
      v_record.draw_number,
      selected.lot_id,
      selected.option_id
    );

    if v_options_count <> v_priced_options_count then
      raise exception 'Una o mas options seleccionadas no tienen precio vigente';
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
      package_id,
      billing_lot_id,
      lot_id,
      option_id,
      draw_id,
      option_price_id,
      option_code,
      option_name,
      option_price,
      phase_id,
      phase_code,
      building,
      lot_number,
      plan_code
    )
    select
      new.package_id,
      new.lot_id,
      selected.lot_id,
      selected.option_id,
      new.draw_id,
      price.id,
      option.code,
      option.name,
      price.price,
      phase.id,
      phase.code,
      phase.building,
      lot.lot_number,
      plan.code
    from valtrim.lot_options selected
    join valtrim.lots lot on lot.id = selected.lot_id
    join valtrim.phases phase on phase.id = lot.phase_id
    join valtrim.plans plan on plan.id = lot.plan_id
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
    where private.package_option_charge_is_selected(
      new.lot_id,
      new.draw_number,
      selected.lot_id,
      selected.option_id
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
  v_requested_options integer := 0;
  v_found_options integer := 0;
  v_reached_options integer := 0;
  v_billed_options integer := 0;
  v_explicit_package_options boolean;
  v_explicit_legacy_options boolean;
  v_anchor_lot_id bigint;
  v_anchor_draw_number smallint;
  v_selected_options jsonb := '[]'::jsonb;
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

  select
    bool_or(item ? 'package_options'),
    bool_or(item ? 'option_ids')
  into v_explicit_package_options, v_explicit_legacy_options
  from jsonb_array_elements(p_selections) item;

  if v_explicit_package_options and v_explicit_legacy_options then
    raise exception 'Use one Option selection format per Package'
      using errcode = '23514';
  end if;
  if (
    select count(*)
    from jsonb_array_elements(p_selections) item
    where item ? 'package_options'
  ) > 1 then
    raise exception 'Only one billing-Draw cell may carry Package Options'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_selections) item
    where item ? 'package_options'
      and jsonb_typeof(item->'package_options') is distinct from 'array'
  ) then
    raise exception 'Package Option selections must be a JSON array'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_selections) item
    cross join lateral jsonb_array_elements(item->'package_options') selected
    where item ? 'package_options'
      and (
        jsonb_typeof(selected) <> 'object'
        or jsonb_typeof(selected->'lot_id') is distinct from 'number'
        or jsonb_typeof(selected->'option_id') is distinct from 'number'
        or selected->>'lot_id' !~ '^[1-9][0-9]*$'
        or selected->>'option_id' !~ '^[1-9][0-9]*$'
      )
  ) then
    raise exception 'Every Package Option must have a valid Lot and Option identity'
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
    where (item ? 'package_options' or item ? 'option_ids')
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

  if v_explicit_package_options then
    select
      (item->>'lot_id')::bigint,
      (item->>'draw_number')::smallint
    into v_anchor_lot_id, v_anchor_draw_number
    from jsonb_array_elements(p_selections) item
    where item ? 'package_options';

    select coalesce(jsonb_agg(jsonb_build_object(
      'lot_id', requested.lot_id,
      'option_id', requested.option_id
    ) order by requested.lot_id, requested.option_id), '[]'::jsonb)
    into v_selected_options
    from jsonb_array_elements(p_selections) item
    cross join lateral jsonb_to_recordset(item->'package_options')
      as requested(lot_id bigint, option_id bigint)
    where item ? 'package_options';
  elsif v_explicit_legacy_options then
    select
      (item->>'lot_id')::bigint,
      (item->>'draw_number')::smallint
    into v_anchor_lot_id, v_anchor_draw_number
    from jsonb_array_elements(p_selections) item
    where item ? 'option_ids'
    order by (item->>'lot_id')::bigint
    limit 1;

    select coalesce(jsonb_agg(jsonb_build_object(
      'lot_id', (item->>'lot_id')::bigint,
      'option_id', requested.option_id::bigint
    ) order by (item->>'lot_id')::bigint, requested.option_id::bigint), '[]'::jsonb)
    into v_selected_options
    from jsonb_array_elements(p_selections) item
    cross join lateral jsonb_array_elements_text(item->'option_ids')
      requested(option_id)
    where item ? 'option_ids';
  end if;

  if v_explicit_package_options or v_explicit_legacy_options then
    select count(*), count(distinct row(selected.lot_id, selected.option_id))
    into v_requested_options, v_unique
    from jsonb_to_recordset(v_selected_options)
      as selected(lot_id bigint, option_id bigint);

    if v_unique <> v_requested_options or v_requested_options > 5000 then
      raise exception 'Every Package Option must be unique; select at most 5000'
        using errcode = '23514';
    end if;

    select
      count(*) filter (where phase.id is not null),
      count(*) filter (
        where phase.id is not null
          and (
            exists (
              select 1
              from jsonb_to_recordset(p_selections)
                as current_selection(lot_id bigint, draw_number smallint)
              where current_selection.lot_id = requested.lot_id
                and current_selection.draw_number = v_options_billing_draw_number
            )
            or exists (
              select 1
              from valtrim.package_draws prior_line
              join valtrim.draw_packages prior_package
                on prior_package.id = prior_line.package_id
               and prior_package.job_id = p_job_id
              join valtrim.billing_setup_versions prior_version
                on prior_version.id = prior_line.setup_version_id
              where prior_line.lot_id = requested.lot_id
                and prior_line.draw_number
                  = prior_version.options_billing_draw_number
            )
          )
      ),
      count(billed.option_id)
    into v_found_options, v_reached_options, v_billed_options
    from jsonb_to_recordset(v_selected_options)
      as requested(lot_id bigint, option_id bigint)
    left join valtrim.lot_options selected
      on selected.lot_id = requested.lot_id
     and selected.option_id = requested.option_id
    left join valtrim.lots lot on lot.id = selected.lot_id
    left join valtrim.phases phase
      on phase.id = lot.phase_id
     and phase.job_id = p_job_id
     and phase.is_active
    left join valtrim.package_options billed
      on billed.lot_id = requested.lot_id
     and billed.option_id = requested.option_id;

    if v_found_options <> v_requested_options then
      raise exception 'Every selected Option must belong to an active Lot in this Job'
        using errcode = '23503';
    end if;
    if v_reached_options <> v_requested_options then
      raise exception 'Every selected Option Lot must have reached the Options billing Draw'
        using errcode = '23514';
    end if;
    if v_billed_options <> 0 then
      raise exception 'One or more selected Options were already billed'
        using errcode = '23505';
    end if;
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

  if v_explicit_package_options or v_explicit_legacy_options then
    perform set_config(
      'valtrim.draw_package_option_charge',
      jsonb_build_object(
        'anchor_lot_id', v_anchor_lot_id,
        'anchor_draw_number', v_anchor_draw_number,
        'package_options', v_selected_options
      )::text,
      true
    );
  else
    perform set_config('valtrim.draw_package_option_charge', '', true);
  end if;

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
  perform set_config('valtrim.draw_package_option_charge', '', true);

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
  'Creates one Package from exact Lot / Draw cells. One Options billing-Draw cell may carry pending package_options from any Lot in the Job that previously reached that Draw; each Lot Option can be billed only once.';

notify pgrst, 'reload schema';

commit;
