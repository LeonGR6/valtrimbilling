-- Utility Building charges may remain a single selectable 100% charge or be
-- allocated by Production event. Builder Setup versions and Package lines keep
-- immutable snapshots of the selected rule.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table valtrim.billing_setup_versions
  add column utility_billing_mode text not null default 'FULL',
  add column utility_ext_percentage valtrim.percentage not null default 0,
  add column utility_dm_percentage valtrim.percentage not null default 0,
  add column utility_hw_percentage valtrim.percentage not null default 0,
  add constraint billing_setup_versions_utility_billing_check
  check (
    (
      not utility_building
      and utility_billing_mode = 'FULL'
      and utility_ext_percentage = 0
      and utility_dm_percentage = 0
      and utility_hw_percentage = 0
    )
    or (
      utility_building
      and utility_billing_mode = 'FULL'
      and utility_ext_percentage = 0
      and utility_dm_percentage = 0
      and utility_hw_percentage = 0
    )
    or (
      utility_building
      and utility_billing_mode = 'BY_EVENT'
      and utility_ext_percentage
        + utility_dm_percentage
        + utility_hw_percentage = 100
    )
  );

comment on column valtrim.billing_setup_versions.utility_billing_mode is
  'FULL charges one complete Utility Plan Price; BY_EVENT allocates it once across configured EXT, DM and HW percentages.';
comment on column valtrim.billing_setup_versions.utility_ext_percentage is
  'Immutable Utility Plan Price allocation for the EXT event.';
comment on column valtrim.billing_setup_versions.utility_dm_percentage is
  'Immutable Utility Plan Price allocation for the DM event.';
comment on column valtrim.billing_setup_versions.utility_hw_percentage is
  'Immutable Utility Plan Price allocation for the HW event.';

grant select (
  utility_billing_mode,
  utility_ext_percentage,
  utility_dm_percentage,
  utility_hw_percentage
) on valtrim.billing_setup_versions to authenticated;

alter table valtrim.package_draws
  add column utility_billing_mode text not null default 'FULL',
  add column utility_event_type valtrim.production_stage_type,
  add column utility_percentage valtrim.percentage not null default 0;

update valtrim.package_draws
set utility_percentage = 100
where is_utility_building;

alter table valtrim.package_draws
  drop constraint package_draws_utility_snapshot_check,
  add constraint package_draws_utility_snapshot_check
  check (
    (
      is_utility_building
      and base_draw_amount = 0
      and hardware_amount = 0
      and options_amount = 0
      and utility_billing_mode = 'FULL'
      and utility_event_type is null
      and utility_percentage = 100
      and utility_amount = base_price
    )
    or (
      is_utility_building
      and base_draw_amount = 0
      and hardware_amount = 0
      and options_amount = 0
      and utility_billing_mode = 'BY_EVENT'
      and utility_event_type is not null
      and utility_percentage > 0
      and utility_amount <= base_price
    )
    or (
      not is_utility_building
      and utility_amount = 0
      and utility_billing_mode = 'FULL'
      and utility_event_type is null
      and utility_percentage = 0
    )
  );

comment on column valtrim.package_draws.utility_billing_mode is
  'Immutable FULL or BY_EVENT Utility billing rule used by this Package line.';
comment on column valtrim.package_draws.utility_event_type is
  'EXT, DM or HW allocation charged by a BY_EVENT Utility Package line.';
comment on column valtrim.package_draws.utility_percentage is
  'Immutable percentage of the Utility Plan Price charged by this Package line.';

grant select (
  utility_billing_mode,
  utility_event_type,
  utility_percentage
) on valtrim.package_draws to authenticated;

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
    'setup_id, builder_id, version_number, separate_hardware_price,
      utility_building, options_billing_draw_number, hardware_billing_draw_number,',
    'setup_id, builder_id, version_number, separate_hardware_price,
      utility_building, utility_billing_mode,
      utility_ext_percentage, utility_dm_percentage, utility_hw_percentage,
      options_billing_draw_number, hardware_billing_draw_number,'
  );
  if v_updated = v_definition then
    raise exception 'Builder Setup Utility insert columns did not match the expected definition';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    'coalesce((p_config->>''utilityBuilding'')::boolean, false),
      nullif(p_config->>''optionsBillingDrawNumber'', '''')::smallint,',
    'coalesce((p_config->>''utilityBuilding'')::boolean, false),
      coalesce(nullif(p_config->>''utilityBillingMode'', ''''), ''FULL''),
      coalesce((p_config->>''utilityExtPercentage'')::valtrim.percentage, 0),
      coalesce((p_config->>''utilityDmPercentage'')::valtrim.percentage, 0),
      coalesce((p_config->>''utilityHwPercentage'')::valtrim.percentage, 0),
      nullif(p_config->>''optionsBillingDrawNumber'', '''')::smallint,'
  );
  if v_updated = v_definition then
    raise exception 'Builder Setup Utility insert values did not match the expected definition';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    'utility_building = coalesce((p_config->>''utilityBuilding'')::boolean, false),
      options_billing_draw_number',
    'utility_building = coalesce((p_config->>''utilityBuilding'')::boolean, false),
      utility_billing_mode = coalesce(
        nullif(p_config->>''utilityBillingMode'', ''''), ''FULL''),
      utility_ext_percentage = coalesce(
        (p_config->>''utilityExtPercentage'')::valtrim.percentage, 0),
      utility_dm_percentage = coalesce(
        (p_config->>''utilityDmPercentage'')::valtrim.percentage, 0),
      utility_hw_percentage = coalesce(
        (p_config->>''utilityHwPercentage'')::valtrim.percentage, 0),
      options_billing_draw_number'
  );
  if v_updated = v_definition then
    raise exception 'Builder Setup Utility update values did not match the expected definition';
  end if;

  execute v_updated;
end;
$migration$;

create or replace function valtrim.validate_setup_version(p_version_id bigint)
returns void
language plpgsql
set search_path = valtrim, pg_catalog
as $$
declare
  v_count integer;
  v_min smallint;
  v_max smallint;
  v_total numeric;
  v_options_draw smallint;
  v_hardware_draw smallint;
  v_utility_building boolean;
  v_utility_mode text;
  v_utility_ext numeric;
  v_utility_dm numeric;
  v_utility_hw numeric;
begin
  select count(*), min(draw_number), max(draw_number), sum(percentage)
  into v_count, v_min, v_max, v_total
  from billing_draws
  where setup_version_id = p_version_id;

  if v_count < 2 or v_count > 5 then
    raise exception 'La configuracion debe tener entre 2 y 5 draws';
  end if;
  if v_min <> 1 or v_max <> v_count then
    raise exception 'Los draws deben ser consecutivos y comenzar en 1';
  end if;
  if v_total <> 100 then
    raise exception 'Los porcentajes de los draws deben sumar 100';
  end if;

  select
    options_billing_draw_number,
    hardware_billing_draw_number,
    utility_building,
    utility_billing_mode,
    utility_ext_percentage,
    utility_dm_percentage,
    utility_hw_percentage
  into
    v_options_draw,
    v_hardware_draw,
    v_utility_building,
    v_utility_mode,
    v_utility_ext,
    v_utility_dm,
    v_utility_hw
  from billing_setup_versions
  where id = p_version_id;

  if v_options_draw is not null and not exists (
    select 1 from billing_draws
    where setup_version_id = p_version_id and draw_number = v_options_draw
  ) then
    raise exception 'El draw configurado para options no existe';
  end if;
  if v_hardware_draw is not null and not exists (
    select 1 from billing_draws
    where setup_version_id = p_version_id and draw_number = v_hardware_draw
  ) then
    raise exception 'El draw configurado para hardware no existe';
  end if;

  if v_utility_building and v_utility_mode = 'BY_EVENT' then
    if v_utility_ext + v_utility_dm + v_utility_hw <> 100 then
      raise exception 'Utility event percentages must total 100'
        using errcode = '23514';
    end if;
    if (v_utility_ext > 0 and not exists (
      select 1 from billing_draws
      where setup_version_id = p_version_id and event_type = 'EXT'
    )) or (v_utility_dm > 0 and not exists (
      select 1 from billing_draws
      where setup_version_id = p_version_id and event_type = 'DM'
    )) or (v_utility_hw > 0 and not exists (
      select 1 from billing_draws
      where setup_version_id = p_version_id and event_type = 'HW'
    )) then
      raise exception 'Every Utility allocation needs a matching Draw event'
        using errcode = '23514';
    end if;
  end if;
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
  v_charge_hardware boolean;
  v_utility_percentage numeric(5,2);
  v_utility_event_order integer;
  v_option_charge jsonb := coalesce(
    nullif(current_setting('valtrim.draw_package_option_charge', true), '')::jsonb,
    '{}'::jsonb
  );
begin
  select
    package.job_id,
    phase.id as phase_id,
    lot.is_utility_building,
    lot.utility_name,
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
    draw.event_type,
    version.separate_hardware_price,
    version.utility_building as utility_building_enabled,
    version.utility_billing_mode,
    version.utility_ext_percentage,
    version.utility_dm_percentage,
    version.utility_hw_percentage,
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
    raise exception 'No se pudo calcular el draw: revise Job, Phase, fila, Draw y precio vigente';
  end if;
  if v_record.is_utility_building and not v_record.utility_building_enabled then
    raise exception 'Utility Building is inactive for this Package Billing Setup'
      using errcode = '23514';
  end if;

  new.phase_id := v_record.phase_id;
  new.builder_id := v_record.builder_id;
  new.setup_version_id := v_record.setup_version_id;
  new.plan_id := v_record.plan_id;
  new.plan_price_id := v_record.plan_price_id;
  new.lot_number := v_record.lot_number;
  new.utility_name := case when v_record.is_utility_building
    then v_record.utility_name end;
  new.phase_code := v_record.phase_code;
  new.building := v_record.building;
  new.plan_code := v_record.plan_code;
  new.plan_name := v_record.plan_name;
  new.is_reverse := case when v_record.is_utility_building
    then false else v_record.is_reverse end;
  new.is_utility_building := v_record.is_utility_building;
  new.base_price := v_record.base_price;
  new.hardware_price := case
    when v_record.is_utility_building then 0
    when v_record.separate_hardware_price then v_record.configured_hardware
    else 0
  end;
  new.draw_base := new.base_price;
  new.draw_number := v_record.draw_number;
  new.draw_name := v_record.draw_name;
  new.draw_percentage := v_record.draw_percentage;

  if v_record.is_utility_building then
    perform pg_catalog.pg_advisory_xact_lock(new.lot_id);

    new.base_draw_amount := 0;
    new.utility_billing_mode := v_record.utility_billing_mode;

    if v_record.utility_billing_mode = 'FULL' then
      if exists (
        select 1
        from valtrim.package_draws prior_line
        join valtrim.draw_packages prior_package
          on prior_package.id = prior_line.package_id
         and prior_package.status <> 'VOIDED'
        where prior_package.job_id = v_record.job_id
          and prior_line.lot_id = new.lot_id
          and prior_line.is_utility_building
      ) then
        raise exception 'This Utility Building row was already billed in another Draw Package'
          using errcode = '23505';
      end if;

      new.utility_event_type := null;
      new.utility_percentage := 100;
      new.utility_amount := new.base_price;
    elsif v_record.utility_billing_mode = 'BY_EVENT' then
      v_utility_percentage := case v_record.event_type
        when 'EXT' then v_record.utility_ext_percentage
        when 'DM' then v_record.utility_dm_percentage
        when 'HW' then v_record.utility_hw_percentage
        else 0
      end;
      v_utility_event_order := case v_record.event_type
        when 'EXT' then 1 when 'DM' then 2 when 'HW' then 3 else 0 end;

      if coalesce(v_utility_percentage, 0) <= 0 then
        raise exception 'This Draw event has no Utility allocation in the Builder Setup'
          using errcode = '23514';
      end if;
      if exists (
        select 1
        from valtrim.package_draws prior_line
        join valtrim.draw_packages prior_package
          on prior_package.id = prior_line.package_id
         and prior_package.status <> 'VOIDED'
        where prior_package.job_id = v_record.job_id
          and prior_line.lot_id = new.lot_id
          and prior_line.is_utility_building
          and (
            prior_line.utility_billing_mode = 'FULL'
            or prior_line.utility_event_type = v_record.event_type
          )
      ) then
        raise exception 'This Utility Building event portion was already billed in another Draw Package'
          using errcode = '23505';
      end if;

      new.utility_event_type := v_record.event_type;
      new.utility_percentage := v_utility_percentage;

      if not exists (
        select 1
        from (values
          (1, v_record.utility_ext_percentage),
          (2, v_record.utility_dm_percentage),
          (3, v_record.utility_hw_percentage)
        ) as later_event(event_order, percentage)
        where later_event.event_order > v_utility_event_order
          and later_event.percentage > 0
      ) then
        select coalesce(sum(round(
          new.base_price * prior_event.percentage / 100, 2
        )), 0)
        into v_prior_amount
        from (values
          (1, v_record.utility_ext_percentage),
          (2, v_record.utility_dm_percentage),
          (3, v_record.utility_hw_percentage)
        ) as prior_event(event_order, percentage)
        where prior_event.event_order < v_utility_event_order
          and prior_event.percentage > 0;
        new.utility_amount := new.base_price - v_prior_amount;
      else
        new.utility_amount := round(
          new.base_price * v_utility_percentage / 100, 2
        );
      end if;
    else
      raise exception 'The Utility billing mode is not supported'
        using errcode = '23514';
    end if;

    if (v_option_charge ->> 'anchor_lot_id')::bigint = new.lot_id
       and jsonb_array_length(
         coalesce(v_option_charge -> 'package_options', '[]'::jsonb)
       ) > 0 then
      raise exception 'Utility Building rows cannot charge Options'
        using errcode = '23514';
    end if;
  else
    new.utility_billing_mode := 'FULL';
    new.utility_event_type := null;
    new.utility_percentage := 0;
    new.utility_amount := 0;
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
  end if;

  v_charge_hardware := private.package_hardware_charge_is_selected(
    new.lot_id,
    v_record.draw_number
  );
  if v_record.is_utility_building and v_charge_hardware then
    raise exception 'Utility Building rows cannot charge Hardware'
      using errcode = '23514';
  end if;
  if v_charge_hardware and not v_record.separate_hardware_price then
    raise exception 'Hardware cannot be charged because Separate Hardware Price is inactive for this Builder Setup'
      using errcode = '23514';
  end if;
  if v_charge_hardware and exists (
    select 1
    from valtrim.package_draws prior_line
    join valtrim.draw_packages prior_package
      on prior_package.id = prior_line.package_id
     and prior_package.status <> 'VOIDED'
    where prior_package.job_id = v_record.job_id
      and prior_line.lot_id = new.lot_id
      and prior_line.hardware_amount > 0
  ) then
    raise exception 'Hardware for this Lot was already billed in another Draw Package'
      using errcode = '23505';
  end if;

  new.hardware_amount := case
    when v_charge_hardware then new.hardware_price
    else 0
  end;
  new.options_amount := 0;

  if not v_record.is_utility_building
     and v_record.draw_number = v_record.options_billing_draw_number then
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

  new.gross_amount := new.base_draw_amount + new.hardware_amount
    + new.options_amount + new.utility_amount;
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

comment on function valtrim.prepare_package_draw() is
  'Builds immutable Lot / Draw snapshots. Utility rows charge once in FULL mode or once per configured EXT, DM and HW event portion in BY_EVENT mode.';

notify pgrst, 'reload schema';

commit;
