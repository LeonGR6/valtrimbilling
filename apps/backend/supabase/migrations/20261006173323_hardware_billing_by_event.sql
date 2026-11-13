-- Separate Hardware charges follow the Builder Setup's immutable EXT / DM / HW
-- allocation. Historic FULL setups remain readable and billable, while new
-- BY_EVENT setup versions produce suggested, auditable Package portions.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table valtrim.billing_setup_versions
  add column hardware_billing_mode text not null default 'FULL',
  add column hardware_ext_percentage valtrim.percentage not null default 0,
  add column hardware_dm_percentage valtrim.percentage not null default 0,
  add column hardware_hw_percentage valtrim.percentage not null default 0,
  add constraint billing_setup_versions_hardware_billing_check
  check (
    (
      not separate_hardware_price
      and hardware_billing_mode = 'FULL'
      and hardware_ext_percentage = 0
      and hardware_dm_percentage = 0
      and hardware_hw_percentage = 0
    )
    or (
      separate_hardware_price
      and hardware_billing_mode = 'FULL'
      and hardware_ext_percentage = 0
      and hardware_dm_percentage = 0
      and hardware_hw_percentage = 0
    )
    or (
      separate_hardware_price
      and hardware_billing_mode = 'BY_EVENT'
      and hardware_ext_percentage
        + hardware_dm_percentage
        + hardware_hw_percentage = 100
    )
  );

comment on column valtrim.billing_setup_versions.hardware_billing_mode is
  'FULL preserves historic one-time Hardware charges; BY_EVENT allocates Hardware Price across EXT, DM and HW.';
comment on column valtrim.billing_setup_versions.hardware_ext_percentage is
  'Immutable Separate Hardware Price allocation for EXT.';
comment on column valtrim.billing_setup_versions.hardware_dm_percentage is
  'Immutable Separate Hardware Price allocation for DM.';
comment on column valtrim.billing_setup_versions.hardware_hw_percentage is
  'Immutable Separate Hardware Price allocation for HW.';

grant select (
  hardware_billing_mode,
  hardware_ext_percentage,
  hardware_dm_percentage,
  hardware_hw_percentage
) on valtrim.billing_setup_versions to authenticated;

alter table valtrim.package_draws
  add column hardware_billing_mode text not null default 'FULL',
  add column hardware_event_type valtrim.production_stage_type,
  add column hardware_percentage valtrim.percentage not null default 0;

update valtrim.package_draws
set hardware_percentage = 100
where hardware_amount > 0;

alter table valtrim.package_draws
  add constraint package_draws_hardware_snapshot_check
  check (
    (
      is_utility_building
      and hardware_amount = 0
      and hardware_billing_mode = 'FULL'
      and hardware_event_type is null
      and hardware_percentage = 0
    )
    or (
      not is_utility_building
      and hardware_billing_mode = 'FULL'
      and hardware_event_type is null
      and (
        (hardware_percentage = 0 and hardware_amount = 0)
        or (hardware_percentage = 100 and hardware_amount = hardware_price)
      )
    )
    or (
      not is_utility_building
      and hardware_billing_mode = 'BY_EVENT'
      and (
        (
          hardware_percentage = 0
          and hardware_event_type is null
          and hardware_amount = 0
        )
        or (
          hardware_percentage > 0
          and hardware_event_type is not null
          and hardware_amount <= hardware_price
        )
      )
    )
  );

comment on column valtrim.package_draws.hardware_billing_mode is
  'Immutable FULL or BY_EVENT Hardware rule used by this Package line.';
comment on column valtrim.package_draws.hardware_event_type is
  'EXT, DM or HW portion charged by a BY_EVENT Hardware Package line.';
comment on column valtrim.package_draws.hardware_percentage is
  'Immutable percentage of Separate Hardware Price charged by this Package line.';

grant select (
  hardware_billing_mode,
  hardware_event_type,
  hardware_percentage
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
    $source$setup_id, builder_id, version_number, separate_hardware_price,
      utility_building, utility_billing_mode,$source$,
    $source$setup_id, builder_id, version_number, separate_hardware_price,
      hardware_billing_mode,
      hardware_ext_percentage, hardware_dm_percentage, hardware_hw_percentage,
      utility_building, utility_billing_mode,$source$
  );
  if v_updated = v_definition then
    raise exception 'Builder Setup Hardware insert columns did not match the expected definition';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $source$coalesce((p_config->>'separateHardwarePrice')::boolean, false),
      coalesce((p_config->>'utilityBuilding')::boolean, false),$source$,
    $source$coalesce((p_config->>'separateHardwarePrice')::boolean, false),
      coalesce(nullif(p_config->>'hardwareBillingMode', ''), 'FULL'),
      coalesce((p_config->>'hardwareExtPercentage')::valtrim.percentage, 0),
      coalesce((p_config->>'hardwareDmPercentage')::valtrim.percentage, 0),
      coalesce((p_config->>'hardwareHwPercentage')::valtrim.percentage, 0),
      coalesce((p_config->>'utilityBuilding')::boolean, false),$source$
  );
  if v_updated = v_definition then
    raise exception 'Builder Setup Hardware insert values did not match the expected definition';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $source$separate_hardware_price = coalesce((p_config->>'separateHardwarePrice')::boolean, false),
      utility_building = coalesce((p_config->>'utilityBuilding')::boolean, false),$source$,
    $source$separate_hardware_price = coalesce((p_config->>'separateHardwarePrice')::boolean, false),
      hardware_billing_mode = coalesce(
        nullif(p_config->>'hardwareBillingMode', ''), 'FULL'),
      hardware_ext_percentage = coalesce(
        (p_config->>'hardwareExtPercentage')::valtrim.percentage, 0),
      hardware_dm_percentage = coalesce(
        (p_config->>'hardwareDmPercentage')::valtrim.percentage, 0),
      hardware_hw_percentage = coalesce(
        (p_config->>'hardwareHwPercentage')::valtrim.percentage, 0),
      utility_building = coalesce((p_config->>'utilityBuilding')::boolean, false),$source$
  );
  if v_updated = v_definition then
    raise exception 'Builder Setup Hardware update values did not match the expected definition';
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
  v_separate_hardware boolean;
  v_hardware_mode text;
  v_hardware_ext numeric;
  v_hardware_dm numeric;
  v_hardware_hw numeric;
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
    separate_hardware_price,
    hardware_billing_mode,
    hardware_ext_percentage,
    hardware_dm_percentage,
    hardware_hw_percentage,
    utility_building,
    utility_billing_mode,
    utility_ext_percentage,
    utility_dm_percentage,
    utility_hw_percentage
  into
    v_options_draw,
    v_hardware_draw,
    v_separate_hardware,
    v_hardware_mode,
    v_hardware_ext,
    v_hardware_dm,
    v_hardware_hw,
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

  if v_separate_hardware and v_hardware_mode = 'BY_EVENT' then
    if v_hardware_ext + v_hardware_dm + v_hardware_hw <> 100 then
      raise exception 'Hardware event percentages must total 100'
        using errcode = '23514';
    end if;
    if (v_hardware_ext > 0 and not exists (
      select 1 from billing_draws
      where setup_version_id = p_version_id and event_type = 'EXT'
    )) or (v_hardware_dm > 0 and not exists (
      select 1 from billing_draws
      where setup_version_id = p_version_id and event_type = 'DM'
    )) or (v_hardware_hw > 0 and not exists (
      select 1 from billing_draws
      where setup_version_id = p_version_id and event_type = 'HW'
    )) then
      raise exception 'Every Hardware allocation needs a matching Draw event'
        using errcode = '23514';
    end if;
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

do $migration$
declare
  v_definition text;
  v_updated text;
  v_hardware_block text := $source$  v_charge_hardware := private.package_hardware_charge_is_selected(
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
  end;$source$;
  v_hardware_replacement text := $source$  v_charge_hardware := private.package_hardware_charge_is_selected(
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

  new.hardware_billing_mode := case
    when v_record.is_utility_building or not v_record.separate_hardware_price
      then 'FULL'
    else v_record.hardware_billing_mode
  end;
  new.hardware_event_type := null;
  new.hardware_percentage := 0;
  new.hardware_amount := 0;

  if v_charge_hardware then
    perform pg_catalog.pg_advisory_xact_lock(new.lot_id);

    if v_record.hardware_billing_mode = 'FULL' then
      if exists (
        select 1
        from valtrim.package_draws prior_line
        join valtrim.draw_packages prior_package
          on prior_package.id = prior_line.package_id
         and prior_package.status <> 'VOIDED'
        where prior_package.job_id = v_record.job_id
          and prior_line.lot_id = new.lot_id
          and (
            prior_line.hardware_percentage > 0
            or prior_line.hardware_amount > 0
          )
      ) then
        raise exception 'Hardware for this Lot was already billed in another Draw Package'
          using errcode = '23505';
      end if;
      new.hardware_percentage := 100;
      new.hardware_amount := new.hardware_price;
    elsif v_record.hardware_billing_mode = 'BY_EVENT' then
      v_hardware_percentage := case v_record.event_type
        when 'EXT' then v_record.hardware_ext_percentage
        when 'DM' then v_record.hardware_dm_percentage
        when 'HW' then v_record.hardware_hw_percentage
        else 0
      end;
      v_hardware_event_order := case v_record.event_type
        when 'EXT' then 1 when 'DM' then 2 when 'HW' then 3 else 0 end;

      if coalesce(v_hardware_percentage, 0) <= 0 then
        raise exception 'This Draw event has no Hardware allocation in the Builder Setup'
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
          and (
            prior_line.hardware_billing_mode = 'FULL'
            or prior_line.hardware_event_type = v_record.event_type
          )
          and (
            prior_line.hardware_percentage > 0
            or prior_line.hardware_amount > 0
          )
      ) then
        raise exception 'This Hardware event portion was already billed in another Draw Package'
          using errcode = '23505';
      end if;

      new.hardware_event_type := v_record.event_type;
      new.hardware_percentage := v_hardware_percentage;

      if not exists (
        select 1
        from (values
          (1, v_record.hardware_ext_percentage),
          (2, v_record.hardware_dm_percentage),
          (3, v_record.hardware_hw_percentage)
        ) as later_event(event_order, percentage)
        where later_event.event_order > v_hardware_event_order
          and later_event.percentage > 0
      ) then
        select coalesce(sum(round(
          new.hardware_price * prior_event.percentage / 100, 2
        )), 0)
        into v_prior_amount
        from (values
          (1, v_record.hardware_ext_percentage),
          (2, v_record.hardware_dm_percentage),
          (3, v_record.hardware_hw_percentage)
        ) as prior_event(event_order, percentage)
        where prior_event.event_order < v_hardware_event_order
          and prior_event.percentage > 0;
        new.hardware_amount := new.hardware_price - v_prior_amount;
      else
        new.hardware_amount := round(
          new.hardware_price * v_hardware_percentage / 100, 2
        );
      end if;
    else
      raise exception 'The Hardware billing mode is not supported'
        using errcode = '23514';
    end if;
  end if;$source$;
begin
  select pg_get_functiondef('valtrim.prepare_package_draw()'::regprocedure)
  into v_definition;

  v_updated := replace(
    v_definition,
    $source$  v_utility_percentage numeric(5,2);
  v_utility_event_order integer;$source$,
    $source$  v_utility_percentage numeric(5,2);
  v_utility_event_order integer;
  v_hardware_percentage numeric(5,2);
  v_hardware_event_order integer;$source$
  );
  if v_updated = v_definition then
    raise exception 'prepare_package_draw Hardware declarations did not match';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $source$    version.separate_hardware_price,
    version.utility_building as utility_building_enabled,$source$,
    $source$    version.separate_hardware_price,
    version.hardware_billing_mode,
    version.hardware_ext_percentage,
    version.hardware_dm_percentage,
    version.hardware_hw_percentage,
    version.utility_building as utility_building_enabled,$source$
  );
  if v_updated = v_definition then
    raise exception 'prepare_package_draw Hardware setup snapshot did not match';
  end if;
  v_definition := v_updated;

  if position(v_hardware_block in v_definition) = 0 then
    raise exception 'prepare_package_draw Hardware calculation did not match';
  end if;

  execute replace(v_definition, v_hardware_block, v_hardware_replacement);
end;
$migration$;

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'private.create_retention_release_package(bigint,bigint,text)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    $source$  v_separate_hardware boolean;
  v_invoice_line_format valtrim.invoice_line_format;$source$,
    $source$  v_separate_hardware boolean;
  v_hardware_mode text;
  v_hardware_ext numeric;
  v_hardware_dm numeric;
  v_hardware_hw numeric;
  v_invoice_line_format valtrim.invoice_line_format;$source$
  );
  if v_updated = v_definition then
    raise exception 'Retention Hardware declarations did not match';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $source$    version.separate_hardware_price,
    version.invoice_line_format
  into
    v_builder_id,
    v_setup_version_id,
    v_scope_type,
    v_retention_enabled,
    v_separate_hardware,
    v_invoice_line_format$source$,
    $source$    version.separate_hardware_price,
    version.hardware_billing_mode,
    version.hardware_ext_percentage,
    version.hardware_dm_percentage,
    version.hardware_hw_percentage,
    version.invoice_line_format
  into
    v_builder_id,
    v_setup_version_id,
    v_scope_type,
    v_retention_enabled,
    v_separate_hardware,
    v_hardware_mode,
    v_hardware_ext,
    v_hardware_dm,
    v_hardware_hw,
    v_invoice_line_format$source$
  );
  if v_updated = v_definition then
    raise exception 'Retention Hardware setup selection did not match';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $source$  select count(distinct line.lot_id)
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
    );$source$,
    $source$  select count(*)
  into v_completed_lots
  from (
    select line.lot_id
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
    group by line.lot_id
    having (
      not v_separate_hardware
      and bool_or(draw.event_type = 'HW')
    ) or (
      v_separate_hardware
      and v_hardware_mode = 'FULL'
      and bool_or(
        line.hardware_billing_mode = 'FULL'
        and (line.hardware_percentage > 0 or line.hardware_amount > 0)
      )
    ) or (
      v_separate_hardware
      and v_hardware_mode = 'BY_EVENT'
      and count(distinct line.hardware_event_type) filter (
        where line.hardware_billing_mode = 'BY_EVENT'
          and line.hardware_percentage > 0
      ) = (
        (v_hardware_ext > 0)::integer
        + (v_hardware_dm > 0)::integer
        + (v_hardware_hw > 0)::integer
      )
    )
  ) completed;$source$
  );
  if v_updated = v_definition then
    raise exception 'Retention Hardware completion query did not match';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $source$      and (
        (v_separate_hardware and line.hardware_amount > 0)
        or (not v_separate_hardware and draw.event_type = 'HW')
      )$source$,
    $source$      and (
        (
          v_separate_hardware
          and v_hardware_mode = 'FULL'
          and line.hardware_billing_mode = 'FULL'
          and (line.hardware_percentage > 0 or line.hardware_amount > 0)
        )
        or (
          v_separate_hardware
          and v_hardware_mode = 'BY_EVENT'
          and line.hardware_billing_mode = 'BY_EVENT'
          and line.hardware_percentage > 0
        )
        or (not v_separate_hardware and draw.event_type = 'HW')
      )$source$
  );
  if v_updated = v_definition then
    raise exception 'Retention Hardware cutoff query did not match';
  end if;

  execute v_updated;
end;
$migration$;

comment on function valtrim.prepare_package_draw() is
  'Builds immutable Lot / Draw snapshots. Separate Hardware and Utility can charge once in FULL mode or once per configured EXT, DM and HW event portion in BY_EVENT mode.';

notify pgrst, 'reload schema';

commit;
