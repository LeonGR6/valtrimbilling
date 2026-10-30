-- A Builder setup can ask for a single invoice per Phase or per Building.
--
--   PHASE    every Building of a Phase goes in one Package, so on one invoice,
--   BUILDING each Building goes in its own Package and invoice.
--
-- With it, a Package carries everything available of each Phase (or Building) it bills, and a
-- selection that spans several of them is made as several Packages. The option changes no amount
-- and the screen is what applies it; the database only keeps it with the setup version, like the
-- Conditional Final Release scope. Null is "not configured": existing versions keep billing as
-- they did, and a Job follows the version it is pinned to.

begin;

alter table valtrim.billing_setup_versions
  add column single_invoice_scope text
    check (
      single_invoice_scope is null
      or single_invoice_scope in ('PHASE', 'BUILDING')
    );

comment on column valtrim.billing_setup_versions.single_invoice_scope is
  'Whether the Builder takes one invoice per PHASE or per BUILDING (everything available of each in one Package). Null when not configured.';

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
  v_single_invoice_scope text;
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

  v_single_invoice_scope := nullif(upper(btrim(p_config->>'singleInvoiceScope')), '');
  if v_single_invoice_scope is not null
     and v_single_invoice_scope not in ('PHASE', 'BUILDING') then
    raise exception 'Select Per Phase or Per Building for the single invoice'
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
      retention_release_scope, final_release_scope, single_invoice_scope, wrap_enabled, wrap_percentage, invoice_line_format,
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
      v_single_invoice_scope,
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
      single_invoice_scope = v_single_invoice_scope,
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

commit;
