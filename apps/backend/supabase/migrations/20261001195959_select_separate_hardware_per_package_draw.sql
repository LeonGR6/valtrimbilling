-- Separate Hardware remains a Builder-level capability, but the billed Draw is
-- now chosen per Lot while creating a Draw Package. The resulting amount stays
-- on the immutable package_draws snapshot.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $migration$
declare
  v_constraint record;
begin
  for v_constraint in
    select constraint_record.conname
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'valtrim.billing_setup_versions'::regclass
      and constraint_record.contype = 'c'
      and pg_get_constraintdef(constraint_record.oid)
        ilike '%separate_hardware_price%hardware_billing_draw_number%'
  loop
    execute format(
      'alter table valtrim.billing_setup_versions drop constraint %I',
      v_constraint.conname
    );
  end loop;
end;
$migration$;

comment on column valtrim.billing_setup_versions.hardware_billing_draw_number is
  'Legacy fixed Hardware Draw retained only on historical Builder Setup versions. New versions leave it NULL and choose Hardware charges per Draw Package.';

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
    $original$case WHEN COALESCE((p_config ->> 'separateHardwarePrice'::text)::boolean, false) THEN NULLIF(p_config ->> 'hardwareBillingDrawNumber'::text, ''::text)::smallint ELSE NULL::smallint
        END,$original$,
    'NULL::smallint,'
  );

  if v_updated = v_definition then
    v_updated := replace(
      v_definition,
      $original$case when coalesce((p_config->>'separateHardwarePrice')::boolean, false)
        then nullif(p_config->>'hardwareBillingDrawNumber', '')::smallint end,$original$,
      'null,'
    );
  end if;

  if v_updated = v_definition then
    raise exception 'Builder Setup Hardware insert value did not match the expected definition';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $original$hardware_billing_draw_number = CASE
            WHEN COALESCE((p_config ->> 'separateHardwarePrice'::text)::boolean, false) THEN NULLIF(p_config ->> 'hardwareBillingDrawNumber'::text, ''::text)::smallint
            ELSE NULL::smallint
        END,$original$,
    'hardware_billing_draw_number = NULL::smallint,'
  );

  if v_updated = v_definition then
    v_updated := replace(
      v_definition,
      $original$hardware_billing_draw_number = case
        when coalesce((p_config->>'separateHardwarePrice')::boolean, false)
        then nullif(p_config->>'hardwareBillingDrawNumber', '')::smallint end,$original$,
      'hardware_billing_draw_number = null,'
    );
  end if;

  if v_updated = v_definition then
    raise exception 'Builder Setup Hardware update value did not match the expected definition';
  end if;

  execute v_updated;
end;
$migration$;

create or replace function private.package_hardware_charge_is_selected(
  p_lot_id bigint,
  p_draw_number smallint
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from jsonb_to_recordset(
      coalesce(
        nullif(
          current_setting('valtrim.draw_package_hardware_charge', true),
          ''
        )::jsonb,
        '[]'::jsonb
      )
    ) as selection(
      lot_id bigint,
      draw_number smallint,
      charge_hardware boolean
    )
    where selection.lot_id = p_lot_id
      and selection.draw_number = p_draw_number
      and coalesce(selection.charge_hardware, false)
  );
$$;

revoke execute on function private.package_hardware_charge_is_selected(
  bigint, smallint
) from public, anon, authenticated;
grant execute on function private.package_hardware_charge_is_selected(
  bigint, smallint
) to service_role;

comment on function private.package_hardware_charge_is_selected(
  bigint, smallint
) is
  'Reads the transaction-local per-Lot Hardware selections supplied by Package creation or correction RPCs.';

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
begin
  select
    package.job_id,
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
  new.draw_base := new.base_price;
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

  v_charge_hardware := private.package_hardware_charge_is_selected(
    new.lot_id,
    v_record.draw_number
  );

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

comment on function valtrim.prepare_package_draw() is
  'Builds immutable Lot / Draw snapshots from the full Plan Price and adds separate Hardware only when that exact cell was selected by the Package RPC.';

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'private.create_draw_invoice_package(bigint,jsonb,date,text)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    '  insert into valtrim.package_draws (package_id, lot_id, draw_id)',
    $replacement$  perform set_config(
    'valtrim.draw_package_hardware_charge',
    p_selections::text,
    true
  );

  insert into valtrim.package_draws (package_id, lot_id, draw_id)$replacement$
  );
  if v_updated = v_definition then
    raise exception 'Package creator Draw insertion did not match the expected definition';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $original$  get diagnostics v_inserted = row_count;
  perform set_config('valtrim.draw_package_option_charge', '', true);$original$,
    $replacement$  get diagnostics v_inserted = row_count;
  perform set_config('valtrim.draw_package_option_charge', '', true);
  perform set_config('valtrim.draw_package_hardware_charge', '', true);$replacement$
  );
  if v_updated = v_definition then
    raise exception 'Package creator cleanup did not match the expected definition';
  end if;

  execute v_updated;
end;
$migration$;

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,text)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    $original$  perform set_config('valtrim.draw_package_correction', 'on', true);$original$,
    $replacement$  perform set_config('valtrim.draw_package_correction', 'on', true);
  perform set_config(
    'valtrim.draw_package_hardware_charge',
    coalesce(p_selections, '[]'::jsonb)::text,
    true
  );$replacement$
  );
  if v_updated = v_definition then
    raise exception 'Package correction setup did not match the expected definition';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $original$  perform set_config('valtrim.draw_package_correction', 'off', true);
  return p_package_id;$original$,
    $replacement$  perform set_config('valtrim.draw_package_hardware_charge', '', true);
  perform set_config('valtrim.draw_package_correction', 'off', true);
  return p_package_id;$replacement$
  );
  if v_updated = v_definition then
    raise exception 'Package correction cleanup did not match the expected definition';
  end if;

  execute v_updated;
end;
$migration$;

comment on function valtrim.create_draw_invoice_package(
  bigint, jsonb, date, text
) is
  'Creates one Package from exact Lot / Draw cells. A selection may set charge_hardware=true; each Lot Hardware price can be billed only once across active Packages.';

notify pgrst, 'reload schema';

commit;
