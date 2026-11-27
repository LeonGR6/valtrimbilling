-- The Retention Release is the Conditional Final Release when the setup releases retention at the
-- same level the Final Release is set to.
--
-- A Builder setup says where a Final Release applies (Final release scope: Phase, Building or
-- Project) and, separately, how retention is released (Per Job or Per Building). When the setup has
-- retention and both go the same way, the last Draw Package is not the end of the Job: the Retention
-- Release is. So:
--
--   Per Job + Project       the Draw Packages always use the Conditional Progress Release; the
--                           Retention Release of the Job uses the Conditional Final Release.
--   Per Building + Building the Draw Packages always use Progress; the Retention Release of each
--                           Building uses Final, for that Building.
--
-- Every other setup keeps working as before: without retention the Draw Package that finishes the
-- scope is the Final, and a Retention Release with a setup that does not line up has no Release.
-- Every active Retention Release of the Job uses the Final one, however many there are.
--
-- get_final_release_status is what the Release screen reads (through get_package_release_values), so
-- nothing else changes: the Release is still filled with the through date (the cutoff), the amount of
-- the Package and the unpaid earlier Packages as exceptions.

begin;

create or replace function private.get_final_release_status(p_package_id bigint)
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
  v_retention_on boolean;
  v_retention_scope text;
  v_retention_final boolean;
  v_release record;
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

  -- The setup the Job is pinned to; when it predates this option, the
  -- Builder's current setup decides.
  select coalesce(pinned.final_release_scope, current_setup.final_release_scope),
         pinned.separate_hardware_price,
         pinned.hardware_billing_mode,
         pinned.hardware_ext_percentage,
         pinned.hardware_dm_percentage,
         pinned.hardware_hw_percentage,
         pinned.retention_enabled and pinned.retention_percentage > 0,
         pinned.retention_release_scope
    into v_scope,
         v_separate_hardware,
         v_hardware_mode,
         v_hardware_ext,
         v_hardware_dm,
         v_hardware_hw,
         v_retention_on,
         v_retention_scope
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

  -- Retention is released at the level the Final Release is set to: the Retention Release is the
  -- last Package, not the last Draw Package.
  v_retention_final := coalesce(v_retention_on, false) and (
    (v_retention_scope = 'JOB' and v_scope = 'PROJECT')
    or (v_retention_scope = 'BUILDING' and v_scope = 'BUILDING')
  );

  if v_package.package_type <> 'DRAW' then
    if v_package.package_type = 'RETENTION_RELEASE' and v_retention_final then
      select release.scope_type,
             release.phase_id,
             release.phase_code,
             release.building
        into v_release
      from valtrim.retention_releases release
      where release.package_id = p_package_id;

      if found then
        return jsonb_build_object(
          'applicable', true,
          'reason', null,
          'scope', v_scope,
          'is_final', true,
          'retention_final', true,
          'scopes', jsonb_build_array(jsonb_build_object(
            'key', case when v_release.scope_type = 'JOB' then 'job' else v_release.phase_id::text end,
            'label', case
              when v_release.scope_type = 'JOB' then 'the Job'
              else 'Phase ' || v_release.phase_code || coalesce(' - Building ' || v_release.building, '')
            end,
            'total', 0,
            'covered_before', 0,
            'covered_after', 0,
            'remaining_after', 0,
            'closes', true
          ))
        );
      end if;
    end if;

    -- The other Packages that are not Draw Packages have no Release to fill here.
    return jsonb_build_object(
      'applicable', false,
      'reason', v_package.package_type,
      'scope', null,
      'is_final', false,
      'scopes', '[]'::jsonb
    );
  end if;

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
             else 'Phase ' || phase.code || coalesce(' - Building ' || phase.building, '')
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
    -- still a progress payment. With retention released at the same level, the
    -- Retention Release is the Final, so a Draw Package never is.
    'is_final', v_touched > 0 and v_closing = v_touched and not v_retention_final,
    -- Whether the Retention Release of this Job is the Final, so the screen can say why a last
    -- Draw Package still uses the Progress form.
    'retention_final', v_retention_final,
    'scopes', v_scopes
  );
end;
$$;

comment on function private.get_final_release_status(bigint) is
  'Whether a Package is the one that finishes its Final Release scope (Phase, Building or Project). When retention is released at the same level, the Retention Release is the Final and the Draw Packages are never.';

commit;
