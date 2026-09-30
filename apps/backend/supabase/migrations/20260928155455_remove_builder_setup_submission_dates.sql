-- Builder billing setups now use the cutoff as the only accepted-work and
-- invoice date. Remove the retired submission deadline configuration from
-- both persisted versions and the atomic save path.

begin;

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
begin
  if jsonb_typeof(p_config) <> 'object'
     or jsonb_typeof(p_draws) <> 'array'
     or jsonb_typeof(p_required_documents) <> 'array' then
    raise exception 'Config, draws y required documents deben ser JSON validos';
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
      options_billing_draw_number, hardware_billing_draw_number,
      frequency, cutoff_day, cutoff_days, cutoff_weekday,
      payment_terms_days, retention_enabled, retention_percentage,
      wrap_enabled, wrap_percentage, invoice_line_format, portal_name, notes,
      created_by
    ) values (
      v_setup_id, p_builder_id, v_version_number,
      coalesce((p_config->>'separateHardwarePrice')::boolean, false),
      nullif(p_config->>'optionsBillingDrawNumber', '')::smallint,
      case when coalesce((p_config->>'separateHardwarePrice')::boolean, false)
        then nullif(p_config->>'hardwareBillingDrawNumber', '')::smallint end,
      (p_config->>'frequency')::billing_frequency,
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
      nullif(btrim(p_config->>'portalName'), ''),
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
      portal_name = nullif(btrim(p_config->>'portalName'), ''),
      notes = nullif(btrim(p_config->>'notes'), ''),
      updated_at = now()
    where id = v_version_id;

    delete from billing_draws where setup_version_id = v_version_id;
    delete from billing_required_documents where setup_version_id = v_version_id;
  end if;

  insert into billing_draws (setup_version_id, draw_number, name, percentage)
  select v_version_id, (d.value->>'drawNumber')::smallint,
         nullif(btrim(d.value->>'name'), ''),
         (d.value->>'percentage')::percentage
  from jsonb_array_elements(p_draws) as d(value);

  insert into billing_required_documents (
    setup_version_id, document_type, label, is_required, display_order
  ) values (v_version_id, 'INVOICE', 'Invoice', true, 0);

  insert into billing_required_documents (
    setup_version_id, document_type, label, is_required, display_order
  )
  select v_version_id, (d.value->>'type')::billing_document_type,
         btrim(d.value->>'label'),
         coalesce((d.value->>'required')::boolean, true),
         coalesce((d.value->>'displayOrder')::smallint, 0)
  from jsonb_array_elements(p_required_documents) as d(value)
  where (d.value->>'type')::billing_document_type <> 'INVOICE';

  perform validate_setup_version(v_version_id);
  return v_version_id;
end;
$$;

alter table valtrim.billing_setup_versions
  drop column submission_day,
  drop column submission_offset_days,
  drop column work_accepted_through,
  drop column invoice_date_rule;

drop type valtrim.work_accepted_through;
drop type valtrim.invoice_date_rule;

alter table valtrim.billing_setup_versions
  add constraint billing_setup_versions_frequency_cutoff_check
  check (
    (
      frequency = 'MONTHLY'
      and cutoff_day is not null
      and cardinality(cutoff_days) = 0
      and cutoff_weekday is null
    )
    or (
      frequency = 'SEMIMONTHLY'
      and cutoff_day is null
      and cardinality(cutoff_days) = 2
      and cutoff_days[1] between 1 and 31
      and cutoff_days[2] between 1 and 31
      and cutoff_days[1] <> cutoff_days[2]
      and cutoff_weekday is null
    )
    or (
      frequency = 'WEEKLY'
      and cutoff_day is null
      and cardinality(cutoff_days) = 0
      and cutoff_weekday is not null
    )
  );

comment on function valtrim.save_billing_setup_version(
  bigint, jsonb, jsonb, jsonb, bigint, uuid
) is
  'Creates or updates a Builder billing setup version using cutoff-only billing dates.';

notify pgrst, 'reload schema';

commit;
