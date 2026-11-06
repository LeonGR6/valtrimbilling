-- Store how each immutable Builder Setup version is submitted. Historical
-- versions remain Portal submissions and keep using portal_name as a fallback.

begin;

alter table valtrim.billing_setup_versions
  add column submission_method text not null default 'PORTAL',
  add column submission_destination text;

alter table valtrim.billing_setup_versions
  add constraint billing_setup_versions_submission_check
  check (
    submission_method in ('PORTAL', 'EMAIL', 'MAIL')
    and (
      (
        submission_method = 'PORTAL'
        and (
          submission_destination is null
          or (
            char_length(submission_destination) between 1 and 80
            and btrim(submission_destination) = submission_destination
          )
        )
      )
      or (
        submission_method = 'EMAIL'
        and submission_destination is not null
        and char_length(submission_destination) between 1 and 254
        and btrim(submission_destination) = submission_destination
        and submission_destination
          ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
      )
      or (
        submission_method = 'MAIL'
        and submission_destination is not null
        and char_length(submission_destination) between 1 and 500
        and btrim(submission_destination) = submission_destination
      )
    )
  );

comment on column valtrim.billing_setup_versions.submission_method is
  'Billing submission channel: PORTAL, EMAIL or MAIL.';

comment on column valtrim.billing_setup_versions.submission_destination is
  'Portal name, email address or mailing address for the selected submission method.';

comment on column valtrim.billing_setup_versions.portal_name is
  'Legacy Portal-only copy retained for compatibility with historical database routines.';

create or replace function valtrim.save_billing_setup_version(
  p_builder_id bigint,
  p_config jsonb,
  p_draws jsonb,
  p_required_documents jsonb default '[]'::jsonb,
  p_version_id bigint default null,
  p_actor_id uuid default null
)
returns bigint
language plpgsql
set search_path = valtrim, pg_catalog
as $$
declare
  v_setup_id bigint;
  v_version_id bigint;
  v_version_number integer;
  v_submission_method text;
  v_submission_destination text;
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
      options_billing_draw_number, hardware_billing_draw_number,
      frequency, cutoff_any_date, cutoff_day, cutoff_days, cutoff_weekday,
      payment_terms_days, retention_enabled, retention_percentage,
      wrap_enabled, wrap_percentage, invoice_line_format,
      submission_method, submission_destination, portal_name, notes,
      created_by
    ) values (
      v_setup_id, p_builder_id, v_version_number,
      coalesce((p_config->>'separateHardwarePrice')::boolean, false),
      nullif(p_config->>'optionsBillingDrawNumber', '')::smallint,
      case when coalesce((p_config->>'separateHardwarePrice')::boolean, false)
        then nullif(p_config->>'hardwareBillingDrawNumber', '')::smallint end,
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
      coalesce((p_config->>'wrapEnabled')::boolean, false),
      case when coalesce((p_config->>'wrapEnabled')::boolean, false)
        then coalesce((p_config->>'wrapPercentage')::percentage, 0) else 0 end,
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
      options_billing_draw_number = nullif(p_config->>'optionsBillingDrawNumber', '')::smallint,
      hardware_billing_draw_number = case
        when coalesce((p_config->>'separateHardwarePrice')::boolean, false)
        then nullif(p_config->>'hardwareBillingDrawNumber', '')::smallint end,
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
      wrap_enabled = coalesce((p_config->>'wrapEnabled')::boolean, false),
      wrap_percentage = case when coalesce((p_config->>'wrapEnabled')::boolean, false)
        then coalesce((p_config->>'wrapPercentage')::percentage, 0) else 0 end,
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
    event_type
  )
  select
    v_version_id,
    (draw.value->>'drawNumber')::smallint,
    nullif(btrim(draw.value->>'name'), ''),
    (draw.value->>'percentage')::percentage,
    (draw.value->>'eventType')::production_stage_type
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
$$;

comment on function valtrim.save_billing_setup_version(
  bigint, jsonb, jsonb, jsonb, bigint, uuid
) is
  'Creates or updates a Builder billing setup version, including its Portal, Email or Mail submission destination.';

notify pgrst, 'reload schema';

commit;
