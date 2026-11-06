-- OCIP / WRAP insurance can be a fraction of a percent.
--
-- A Billing Setup's OCIP / WRAP percentage now goes from 0.001% up to 10%
-- (until now it was 1% to 100%, with two decimals). The shared `percentage`
-- domain is numeric(5,2), so the three columns that hold the insurance
-- percentage become numeric(5,3): the Billing Setup version, and the Draw and
-- Separate Hardware lines that copy it when a Package is built. Everything else
-- keeps using `percentage`. Retention is not touched.
--
-- Packages already built keep what they billed: a stored percentage is only
-- widened, never rewritten. The new range check fails the migration if a
-- Billing Setup version still carries more than 10% of insurance.

begin;

do $migration$
declare
  v_constraint text;
begin
  -- The old rule is an unnamed check that mixes retention and insurance.
  for v_constraint in
    select constraint_row.conname
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'valtrim.billing_setup_versions'::regclass
      and constraint_row.contype = 'c'
      and pg_get_constraintdef(constraint_row.oid) like '%wrap_percentage%'
  loop
    execute format(
      'alter table valtrim.billing_setup_versions drop constraint %I',
      v_constraint
    );
  end loop;
end;
$migration$;

alter table valtrim.billing_setup_versions
  alter column wrap_percentage type numeric(5,3);

alter table valtrim.billing_setup_versions
  add constraint billing_setup_versions_deductions_check
  check (
    retention_percentage + wrap_percentage <= 100
    and (
      (retention_enabled and retention_percentage between 1 and 100)
      or (not retention_enabled and retention_percentage = 0)
    )
    and (
      (wrap_enabled and wrap_percentage between 0.001 and 10)
      or (not wrap_enabled and wrap_percentage = 0)
    )
  );

-- Packages copy the percentage of the setup version they were built with. The
-- `percentage` domain also checked 0 to 100; keep that on the wider column.
alter table valtrim.package_draws
  alter column wrap_percentage type numeric(5,3),
  add constraint package_draws_wrap_percentage_check
    check (wrap_percentage between 0 and 100);

alter table valtrim.package_hardware_lines
  alter column wrap_percentage type numeric(5,3),
  add constraint package_hardware_lines_wrap_percentage_check
    check (wrap_percentage between 0 and 100);

comment on column valtrim.billing_setup_versions.wrap_percentage is
  'OCIP / WRAP insurance deducted from every Package line: 0.001 to 10 when enabled, 0 when not.';

CREATE OR REPLACE FUNCTION valtrim.save_billing_setup_version(p_builder_id bigint, p_config jsonb, p_draws jsonb, p_required_documents jsonb DEFAULT '[]'::jsonb, p_version_id bigint DEFAULT NULL::bigint, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'valtrim', 'pg_catalog'
AS $function$
declare
  v_setup_id bigint;
  v_version_id bigint;
  v_version_number integer;
  v_submission_method text;
  v_submission_destination text;
  v_final_release_scope text;
begin
  if jsonb_typeof(p_config) <> 'object'
     or jsonb_typeof(p_draws) <> 'array'
     or jsonb_typeof(p_required_documents) <> 'array' then
    raise exception 'Config, draws y required documents deben ser JSON validos';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_draws) as draw(value)
    where coalesce(draw.value->>'eventType', '') not in ('EXT', 'DM', 'HW')
  ) then
    raise exception 'Cada draw debe tener un event type EXT, DM o HW'
      using errcode = '23514';
  end if;

  -- A lag only makes sense between Draws that share an event: it says how long
  -- after that event this Draw is billed.
  if exists (
    select 1
    from jsonb_array_elements(p_draws) as draw(value)
    where nullif(draw.value->>'lagValue', '') is not null
      and (
        select count(*)
        from jsonb_array_elements(p_draws) as other(value)
        where other.value->>'eventType' = draw.value->>'eventType'
      ) < 2
  ) then
    raise exception 'A Draw lag needs another Draw with the same event type'
      using errcode = '23514';
  end if;

  v_submission_method := coalesce(
    nullif(upper(btrim(p_config->>'submissionMethod')), ''),
    'PORTAL'
  );
  v_submission_destination := coalesce(
    nullif(btrim(p_config->>'submissionDestination'), ''),
    case
      when v_submission_method = 'PORTAL'
      then nullif(btrim(p_config->>'portalName'), '')
    end
  );

  -- How the Conditional Final Release is handled. Only meaningful when a
  -- Release is required to submit; null means it is not configured.
  v_final_release_scope := nullif(upper(btrim(p_config->>'finalReleaseScope')), '');
  if v_final_release_scope is not null
     and v_final_release_scope not in ('PHASE', 'BUILDING', 'PROJECT') then
    raise exception 'Select Per Phase, Per Building or Per Project for the Conditional Final Release'
      using errcode = '23514';
  end if;
  if v_final_release_scope is not null and not exists (
    select 1
    from jsonb_array_elements(p_required_documents) as document(value)
    where document.value->>'type' = 'RELEASE'
      and coalesce((document.value->>'required')::boolean, true)
  ) then
    raise exception 'The Conditional Final Release scope needs Release to be required to submit'
      using errcode = '23514';
  end if;

  select id into v_setup_id
  from billing_setups
  where builder_id = p_builder_id
  for update;

  if v_setup_id is null then
    raise exception 'Builder % no existe o no tiene billing setup', p_builder_id;
  end if;

  if p_version_id is null then
    select coalesce(max(version_number), 0) + 1
    into v_version_number
    from billing_setup_versions
    where setup_id = v_setup_id;

    insert into billing_setup_versions (
      setup_id, builder_id, version_number, separate_hardware_price,
      hardware_billing_mode,
      hardware_ext_percentage, hardware_dm_percentage, hardware_hw_percentage,
      utility_building, utility_billing_mode,
      utility_ext_percentage, utility_dm_percentage, utility_hw_percentage,
      options_billing_draw_number, hardware_billing_draw_number,
      frequency, cutoff_any_date, cutoff_day, cutoff_days, cutoff_weekday,
      payment_terms_days, retention_enabled, retention_percentage,
      retention_release_scope, final_release_scope, wrap_enabled, wrap_percentage, invoice_line_format,
      submission_method, submission_destination, portal_name, notes,
      created_by
    ) values (
      v_setup_id, p_builder_id, v_version_number,
      coalesce((p_config->>'separateHardwarePrice')::boolean, false),
      coalesce(nullif(p_config->>'hardwareBillingMode', ''), 'FULL'),
      coalesce((p_config->>'hardwareExtPercentage')::valtrim.percentage, 0),
      coalesce((p_config->>'hardwareDmPercentage')::valtrim.percentage, 0),
      coalesce((p_config->>'hardwareHwPercentage')::valtrim.percentage, 0),
      coalesce((p_config->>'utilityBuilding')::boolean, false),
      coalesce(nullif(p_config->>'utilityBillingMode', ''), 'FULL'),
      coalesce((p_config->>'utilityExtPercentage')::valtrim.percentage, 0),
      coalesce((p_config->>'utilityDmPercentage')::valtrim.percentage, 0),
      coalesce((p_config->>'utilityHwPercentage')::valtrim.percentage, 0),
      nullif(p_config->>'optionsBillingDrawNumber', '')::smallint,
      null,
      (p_config->>'frequency')::billing_frequency,
      coalesce((p_config->>'cutoffAnyDate')::boolean, false),
      nullif(p_config->>'cutoffDay', '')::smallint,
      coalesce(array(
        select value::smallint
        from jsonb_array_elements_text(coalesce(p_config->'cutoffDays', '[]'::jsonb))
      ), '{}'::smallint[]),
      nullif(p_config->>'cutoffWeekday', '')::smallint,
      coalesce((p_config->>'paymentTermsDays')::smallint, 30),
      coalesce((p_config->>'retentionEnabled')::boolean, false),
      case when coalesce((p_config->>'retentionEnabled')::boolean, false)
        then coalesce((p_config->>'retentionPercentage')::percentage, 0) else 0 end,
      coalesce(nullif(p_config->>'retentionReleaseScope', ''), 'JOB'),
      v_final_release_scope,
      coalesce((p_config->>'wrapEnabled')::boolean, false),
      case when coalesce((p_config->>'wrapEnabled')::boolean, false)
        then coalesce((p_config->>'wrapPercentage')::numeric(5,3), 0) else 0 end,
      coalesce((p_config->>'invoiceLineFormat')::invoice_line_format, 'LOT_SCOPE'),
      v_submission_method,
      v_submission_destination,
      case when v_submission_method = 'PORTAL'
        then v_submission_destination end,
      nullif(btrim(p_config->>'notes'), ''),
      p_actor_id
    ) returning id into v_version_id;
  else
    select id into v_version_id
    from billing_setup_versions
    where id = p_version_id and setup_id = v_setup_id and status = 'DRAFT'
    for update;

    if v_version_id is null then
      raise exception 'La version no existe, no pertenece al builder o ya no es DRAFT';
    end if;

    update billing_setup_versions set
      separate_hardware_price = coalesce((p_config->>'separateHardwarePrice')::boolean, false),
      hardware_billing_mode = coalesce(
        nullif(p_config->>'hardwareBillingMode', ''), 'FULL'),
      hardware_ext_percentage = coalesce(
        (p_config->>'hardwareExtPercentage')::valtrim.percentage, 0),
      hardware_dm_percentage = coalesce(
        (p_config->>'hardwareDmPercentage')::valtrim.percentage, 0),
      hardware_hw_percentage = coalesce(
        (p_config->>'hardwareHwPercentage')::valtrim.percentage, 0),
      utility_building = coalesce((p_config->>'utilityBuilding')::boolean, false),
      utility_billing_mode = coalesce(
        nullif(p_config->>'utilityBillingMode', ''), 'FULL'),
      utility_ext_percentage = coalesce(
        (p_config->>'utilityExtPercentage')::valtrim.percentage, 0),
      utility_dm_percentage = coalesce(
        (p_config->>'utilityDmPercentage')::valtrim.percentage, 0),
      utility_hw_percentage = coalesce(
        (p_config->>'utilityHwPercentage')::valtrim.percentage, 0),
      options_billing_draw_number = nullif(p_config->>'optionsBillingDrawNumber', '')::smallint,
      hardware_billing_draw_number = null,
      frequency = (p_config->>'frequency')::billing_frequency,
      cutoff_any_date = coalesce((p_config->>'cutoffAnyDate')::boolean, false),
      cutoff_day = nullif(p_config->>'cutoffDay', '')::smallint,
      cutoff_days = coalesce(array(
        select value::smallint
        from jsonb_array_elements_text(coalesce(p_config->'cutoffDays', '[]'::jsonb))
      ), '{}'::smallint[]),
      cutoff_weekday = nullif(p_config->>'cutoffWeekday', '')::smallint,
      payment_terms_days = coalesce((p_config->>'paymentTermsDays')::smallint, 30),
      retention_enabled = coalesce((p_config->>'retentionEnabled')::boolean, false),
      retention_percentage = case
        when coalesce((p_config->>'retentionEnabled')::boolean, false)
        then coalesce((p_config->>'retentionPercentage')::percentage, 0) else 0 end,
      retention_release_scope = coalesce(
        nullif(p_config->>'retentionReleaseScope', ''), 'JOB'),
      final_release_scope = v_final_release_scope,
      wrap_enabled = coalesce((p_config->>'wrapEnabled')::boolean, false),
      wrap_percentage = case when coalesce((p_config->>'wrapEnabled')::boolean, false)
        then coalesce((p_config->>'wrapPercentage')::numeric(5,3), 0) else 0 end,
      invoice_line_format = coalesce(
        (p_config->>'invoiceLineFormat')::invoice_line_format, 'LOT_SCOPE'),
      submission_method = v_submission_method,
      submission_destination = v_submission_destination,
      portal_name = case when v_submission_method = 'PORTAL'
        then v_submission_destination end,
      notes = nullif(btrim(p_config->>'notes'), ''),
      updated_at = now()
    where id = v_version_id;

    delete from billing_draws where setup_version_id = v_version_id;
    delete from billing_required_documents where setup_version_id = v_version_id;
  end if;

  insert into billing_draws (
    setup_version_id,
    draw_number,
    name,
    percentage,
    event_type,
    lag_value,
    lag_unit
  )
  select
    v_version_id,
    (draw.value->>'drawNumber')::smallint,
    nullif(btrim(draw.value->>'name'), ''),
    (draw.value->>'percentage')::percentage,
    (draw.value->>'eventType')::production_stage_type,
    nullif(draw.value->>'lagValue', '')::smallint,
    case
      when nullif(draw.value->>'lagValue', '') is null then null
      else upper(btrim(draw.value->>'lagUnit'))
    end
  from jsonb_array_elements(p_draws) as draw(value);

  insert into billing_required_documents (
    setup_version_id, document_type, label, is_required, display_order
  ) values (v_version_id, 'INVOICE', 'Invoice', true, 0);

  insert into billing_required_documents (
    setup_version_id, document_type, label, is_required, display_order
  )
  select v_version_id, (document.value->>'type')::billing_document_type,
         btrim(document.value->>'label'),
         coalesce((document.value->>'required')::boolean, true),
         coalesce((document.value->>'displayOrder')::smallint, 0)
  from jsonb_array_elements(p_required_documents) as document(value)
  where (document.value->>'type')::billing_document_type <> 'INVOICE';

  perform validate_setup_version(v_version_id);
  return v_version_id;
end;
$function$;

notify pgrst, 'reload schema';

commit;
