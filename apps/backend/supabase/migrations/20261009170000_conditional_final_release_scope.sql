-- Phase 49: Conditional Final Release scope.
--
-- A Builder setup can say how the Conditional Final Release is handled:
--   PHASE    every Building of a Phase finishes together,
--   BUILDING each Building finishes on its own,
--   PROJECT  the whole Job finishes together.
-- The Release of a Draw Package is a Conditional Final when that Package is the
-- last one possible for its scope (nothing is left to bill once it is
-- included), and a Conditional Progress otherwise.
--
-- The option is asked where Release is required to submit, so it is saved with
-- the setup version. A Job pinned to a version older than this option uses the
-- Builder's current setup, because the option changes no amount.

begin;

alter table valtrim.billing_setup_versions
  add column final_release_scope text
    check (
      final_release_scope is null
      or final_release_scope in ('PHASE', 'BUILDING', 'PROJECT')
    );

comment on column valtrim.billing_setup_versions.final_release_scope is
  'How the Conditional Final Release is handled: PHASE, BUILDING or PROJECT. Null when not configured (only Conditional Progress is used).';

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
$function$;

create function private.get_final_release_status(p_package_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_package record;
  v_scope text;
  v_separate_hardware boolean;
  v_hardware_mode text;
  v_hardware_ext numeric;
  v_hardware_dm numeric;
  v_hardware_hw numeric;
  v_scopes jsonb;
  v_touched integer;
  v_closing integer;
begin
  select package.id,
         package.job_id,
         package.builder_id,
         package.package_date,
         package.package_type,
         package.setup_version_id
    into v_package
  from valtrim.draw_packages package
  where package.id = p_package_id;

  if not found then
    return null;
  end if;

  -- Retention Release Packages are left out until their Release is defined.
  if v_package.package_type <> 'DRAW' then
    return jsonb_build_object(
      'applicable', false,
      'reason', 'RETENTION_RELEASE',
      'scope', null,
      'is_final', false,
      'scopes', '[]'::jsonb
    );
  end if;

  -- The setup the Job is pinned to; when it predates this option, the
  -- Builder's current setup decides.
  select coalesce(pinned.final_release_scope, current_setup.final_release_scope),
         pinned.separate_hardware_price,
         pinned.hardware_billing_mode,
         pinned.hardware_ext_percentage,
         pinned.hardware_dm_percentage,
         pinned.hardware_hw_percentage
    into v_scope,
         v_separate_hardware,
         v_hardware_mode,
         v_hardware_ext,
         v_hardware_dm,
         v_hardware_hw
  from valtrim.billing_setup_versions pinned
  left join lateral (
    select version.final_release_scope
    from valtrim.billing_setup_versions version
    where version.builder_id = v_package.builder_id
      and version.status = 'ACTIVE'
    order by version.version_number desc
    limit 1
  ) current_setup on true
  where pinned.id = v_package.setup_version_id;

  if v_scope is null then
    return jsonb_build_object(
      'applicable', false,
      'reason', 'NOT_CONFIGURED',
      'scope', null,
      'is_final', false,
      'scopes', '[]'::jsonb
    );
  end if;

  with scope_phase as (
    select phase.id as phase_id,
           case v_scope
             when 'PROJECT' then 'job'
             when 'PHASE' then phase.code::text
             else phase.id::text
           end as scope_key,
           case v_scope
             when 'PROJECT' then 'the Job'
             when 'PHASE' then 'Phase ' || phase.code
             else 'Phase ' || phase.code || ' - Building ' || phase.building
           end as scope_label
    from valtrim.phases phase
    where phase.job_id = v_package.job_id
      and phase.is_active
  ),
  touched as (
    select distinct scope.scope_key
    from (
      select line.phase_id
      from valtrim.package_draws line
      where line.package_id = p_package_id
      union
      select line.phase_id
      from valtrim.package_hardware_lines line
      where line.package_id = p_package_id
    ) lines
    join scope_phase scope on scope.phase_id = lines.phase_id
  ),
  -- Everything that can be billed in a scope: every Lot (Utility rows too) in
  -- every Draw, and the Separate Hardware parts when the setup has them.
  expected as (
    select scope.scope_key, 'D'::text as kind, lot.id as lot_id,
           draw.draw_number::text as part
    from scope_phase scope
    join valtrim.lots lot on lot.phase_id = scope.phase_id
    join valtrim.billing_draws draw
      on draw.setup_version_id = v_package.setup_version_id
    union all
    select scope.scope_key, 'H', lot.id, hardware.part
    from scope_phase scope
    join valtrim.lots lot
      on lot.phase_id = scope.phase_id and not lot.is_utility_building
    cross join lateral unnest(
      case
        when not coalesce(v_separate_hardware, false) then array[]::text[]
        when v_hardware_mode = 'BY_EVENT' then array_remove(array[
          case when v_hardware_ext > 0 then 'EXT' end,
          case when v_hardware_dm > 0 then 'DM' end,
          case when v_hardware_hw > 0 then 'HW' end
        ], null)
        else array['FULL']
      end
    ) as hardware(part)
  ),
  -- What the Job's Draw Packages (not voided) already bill, and when.
  covered as (
    select scope.scope_key, 'D'::text as kind, line.lot_id,
           line.draw_number::text as part,
           package.package_date, package.id as package_id
    from valtrim.package_draws line
    join valtrim.draw_packages package
      on package.id = line.package_id
     and package.job_id = v_package.job_id
     and package.package_type = 'DRAW'
     and package.status <> 'VOIDED'
    join scope_phase scope on scope.phase_id = line.phase_id
    union all
    select scope.scope_key, 'H', line.lot_id,
           case
             when line.hardware_billing_mode = 'FULL' then 'FULL'
             else line.hardware_event_type::text
           end,
           package.package_date, package.id
    from valtrim.package_draws line
    join valtrim.draw_packages package
      on package.id = line.package_id
     and package.job_id = v_package.job_id
     and package.package_type = 'DRAW'
     and package.status <> 'VOIDED'
    join scope_phase scope on scope.phase_id = line.phase_id
    where coalesce(v_separate_hardware, false)
      and (
        (line.hardware_billing_mode = 'FULL'
          and (line.hardware_percentage > 0 or line.hardware_amount > 0))
        or (line.hardware_billing_mode = 'BY_EVENT'
          and line.hardware_percentage > 0)
      )
    union all
    select scope.scope_key, 'H', line.lot_id, line.hardware_event_type::text,
           package.package_date, package.id
    from valtrim.package_hardware_lines line
    join valtrim.draw_packages package
      on package.id = line.package_id
     and package.job_id = v_package.job_id
     and package.package_type = 'DRAW'
     and package.status <> 'VOIDED'
    join scope_phase scope on scope.phase_id = line.phase_id
    where coalesce(v_separate_hardware, false)
      and v_hardware_mode = 'BY_EVENT'
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'key', touched.scope_key,
        'label', (
          select min(scope.scope_label)
          from scope_phase scope
          where scope.scope_key = touched.scope_key
        ),
        'total', stats.total,
        'covered_before', stats.covered_before,
        'covered_after', stats.covered_after,
        'remaining_after', stats.total - stats.covered_after,
        'closes', stats.covered_after = stats.total
          and stats.covered_before < stats.total
      )
      order by touched.scope_key
    ), '[]'::jsonb),
    count(*),
    count(*) filter (
      where stats.covered_after = stats.total
        and stats.covered_before < stats.total
    )
  into v_scopes, v_touched, v_closing
  from touched
  cross join lateral (
    select
      count(*) as total,
      count(*) filter (where exists (
        select 1
        from covered done
        where done.scope_key = expected.scope_key
          and done.kind = expected.kind
          and done.lot_id = expected.lot_id
          and done.part = expected.part
          and (done.package_date, done.package_id)
            < (v_package.package_date, v_package.id)
      )) as covered_before,
      count(*) filter (where exists (
        select 1
        from covered done
        where done.scope_key = expected.scope_key
          and done.kind = expected.kind
          and done.lot_id = expected.lot_id
          and done.part = expected.part
          and (done.package_date, done.package_id)
            <= (v_package.package_date, v_package.id)
      )) as covered_after
    from expected
    where expected.scope_key = touched.scope_key
  ) stats;

  return jsonb_build_object(
    'applicable', true,
    'reason', null,
    'scope', v_scope,
    -- Final only when this Package is the one that finishes every scope it
    -- touches; a Package that finishes one scope and leaves another open is
    -- still a progress payment.
    'is_final', v_touched > 0 and v_closing = v_touched,
    'scopes', v_scopes
  );
end;
$$;

create or replace function private.get_package_release_values(p_package_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_package record;
  v_invoice record;
  v_cutoff date;
  v_pending jsonb;
begin
  if (select auth.uid()) is null or not (select private.is_active_user()) then
    raise exception 'You do not have permission to read Package values'
      using errcode = '42501';
  end if;

  select package.id,
         package.job_id,
         package.package_number,
         package.package_date,
         package.setup_version_id,
         package.package_type
    into v_package
  from valtrim.draw_packages package
  where package.id = p_package_id;

  if not found then
    raise exception 'The Package is no longer available'
      using errcode = 'P0002';
  end if;

  v_cutoff := private.resolve_billing_cutoff_date(
    v_package.package_date,
    v_package.setup_version_id
  );

  select invoice.invoice_number,
         invoice.gross_amount,
         invoice.retention_amount,
         invoice.wrap_amount,
         invoice.net_amount
    into v_invoice
  from valtrim.invoices invoice
  where invoice.package_id = p_package_id;

  -- Earlier Draw Packages of the same Job that are not paid yet. Voided ones
  -- are not owed. "Earlier" is by Package date, then by id.
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'package_id', other.id,
      'package_number', other.package_number,
      'package_date', other.package_date,
      'cutoff_date', coalesce(
        private.resolve_billing_cutoff_date(
          other.package_date,
          other.setup_version_id
        ),
        other.package_date
      ),
      'cutoff_source', case
        when private.resolve_billing_cutoff_date(
          other.package_date,
          other.setup_version_id
        ) is null then 'package_date'
        else 'builder_setup'
      end,
      'net_amount', invoice.net_amount,
      'status', other.status,
      'workflow_status', other.workflow_status
    )
    order by other.package_date, other.id
  ), '[]'::jsonb)
    into v_pending
  from valtrim.draw_packages other
  left join valtrim.invoices invoice on invoice.package_id = other.id
  where other.job_id = v_package.job_id
    and other.id <> v_package.id
    and other.package_type = 'DRAW'
    and other.status not in ('VOIDED', 'PAID')
    and other.workflow_status <> 'PAID_CLOSED'
    and (other.package_date, other.id) < (v_package.package_date, v_package.id);

  return jsonb_build_object(
    'package_id', v_package.id,
    'job_id', v_package.job_id,
    'package_number', v_package.package_number,
    'package_type', v_package.package_type,
    'package_date', v_package.package_date,
    'cutoff_date', coalesce(v_cutoff, v_package.package_date),
    'cutoff_source', case
      when v_cutoff is null then 'package_date'
      else 'builder_setup'
    end,
    'invoice_number', v_invoice.invoice_number,
    'gross_amount', v_invoice.gross_amount,
    'retention_amount', v_invoice.retention_amount,
    'wrap_amount', v_invoice.wrap_amount,
    'net_amount', v_invoice.net_amount,
    'pending_packages', v_pending,
    'final_release', private.get_final_release_status(p_package_id)
  );
end;
$$;

revoke execute on function private.get_final_release_status(bigint)
  from public, anon, authenticated;
grant execute on function private.get_final_release_status(bigint)
  to service_role;

comment on function private.get_final_release_status(bigint) is
  'Whether a Draw Package is the last possible one for its Conditional Final Release scope, with what is left per scope.';

notify pgrst, 'reload schema';

commit;
