-- Utility Building Phases keep stable internal row identities while remaining
-- outside every Lot count, Lot range and Production workflow. Each Utility row
-- snapshots one complete Plan Price on the single Draw selected by the user.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table valtrim.phases
  add column is_utility_building boolean not null default false;

comment on column valtrim.phases.is_utility_building is
  'Marks a Phase whose ordered rows are Utility Building Plan charges, not Lots.';

alter table valtrim.package_draws
  add column is_utility_building boolean not null default false,
  add column utility_amount valtrim.amount not null default 0;

comment on column valtrim.package_draws.is_utility_building is
  'Immutable snapshot identifying a Utility Building row rather than a Lot.';
comment on column valtrim.package_draws.utility_amount is
  'Complete Utility Building Plan Price charged once on the selected Draw.';

do $migration$
declare
  v_constraint record;
begin
  for v_constraint in
    select constraint_record.conname
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'valtrim.package_draws'::regclass
      and constraint_record.contype = 'c'
      and pg_get_constraintdef(constraint_record.oid) ilike '%gross_amount%'
      and pg_get_constraintdef(constraint_record.oid) ilike '%base_draw_amount%'
      and pg_get_constraintdef(constraint_record.oid) ilike '%hardware_amount%'
      and pg_get_constraintdef(constraint_record.oid) ilike '%options_amount%'
  loop
    execute format(
      'alter table valtrim.package_draws drop constraint %I',
      v_constraint.conname
    );
  end loop;
end;
$migration$;

alter table valtrim.package_draws
  add constraint package_draws_gross_snapshot_check
  check (
    gross_amount = base_draw_amount + hardware_amount
      + options_amount + utility_amount
  ),
  add constraint package_draws_utility_snapshot_check
  check (
    (
      is_utility_building
      and base_draw_amount = 0
      and hardware_amount = 0
      and options_amount = 0
      and utility_amount = base_price
    )
    or (
      not is_utility_building
      and utility_amount = 0
    )
  );

grant select (
  is_utility_building,
  utility_amount
) on valtrim.package_draws to authenticated;

create function valtrim.save_sequence_sheet_phase(
  p_job_id bigint,
  p_phase_id bigint,
  p_code text,
  p_building text,
  p_lots jsonb,
  p_is_utility_building boolean
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_building text := upper(btrim(coalesce(p_building, '')));
  v_is_utility_building boolean := coalesce(p_is_utility_building, false);
  v_utility_enabled boolean;
  v_phase_id bigint;
  v_phase_active boolean;
  v_existing_is_utility boolean;
  v_lot record;
  v_lot_id bigint;
  v_kept_lot_ids bigint[] := '{}'::bigint[];
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to change Sequence Sheets'
      using errcode = '42501';
  end if;

  if p_job_id is null or p_job_id <= 0 then
    raise exception 'Select an active Job' using errcode = '23503';
  end if;
  if v_code = '' or char_length(v_code) > 40 then
    raise exception 'Enter a Phase code with 40 characters or fewer'
      using errcode = '23514';
  end if;
  if v_building = '' or char_length(v_building) > 50 then
    raise exception 'Enter a Building code with 50 characters or fewer'
      using errcode = '23514';
  end if;
  if p_lots is null
     or jsonb_typeof(p_lots) <> 'array'
     or jsonb_array_length(p_lots) < 1
     or jsonb_array_length(p_lots) > 500 then
    raise exception 'A Phase must contain between 1 and 500 rows'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lots) requested(value)
    where jsonb_typeof(requested.value) <> 'object'
  ) then
    raise exception 'Every Phase row must be an object' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
    where nullif(requested.value ->> 'plan_id', '')::bigint <= 0
       or (
         nullif(requested.value ->> 'id', '') is not null
         and nullif(requested.value ->> 'id', '')::bigint <= 0
       )
       or jsonb_typeof(coalesce(requested.value -> 'option_ids', '[]'::jsonb)) <> 'array'
       or (
         not v_is_utility_building
         and (
           nullif(btrim(requested.value ->> 'lot_number'), '') is null
           or char_length(btrim(requested.value ->> 'lot_number')) > 30
         )
       )
  ) then
    raise exception 'Review the row Plan, Lot number and selected Options'
      using errcode = '23514';
  end if;
  if v_is_utility_building and exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
    where coalesce((requested.value ->> 'is_reverse')::boolean, false)
       or jsonb_array_length(
         coalesce(requested.value -> 'option_ids', '[]'::jsonb)
       ) > 0
  ) then
    raise exception 'Utility Building rows cannot include Reverse or Options'
      using errcode = '23514';
  end if;
  if not v_is_utility_building and (
    select count(*) from jsonb_array_elements(p_lots) requested(value)
  ) <> (
    select count(distinct upper(btrim(requested.value ->> 'lot_number')))
    from jsonb_array_elements(p_lots) requested(value)
  ) then
    raise exception 'Each Lot number can appear only once in a Phase'
      using errcode = '23505';
  end if;
  if (
    select count(nullif(requested.value ->> 'id', ''))
    from jsonb_array_elements(p_lots) requested(value)
  ) <> (
    select count(distinct nullif(requested.value ->> 'id', '')::bigint)
    from jsonb_array_elements(p_lots) requested(value)
  ) then
    raise exception 'Each existing row can appear only once'
      using errcode = '23505';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
    cross join lateral jsonb_array_elements_text(
      coalesce(requested.value -> 'option_ids', '[]'::jsonb)
    ) selected(option_id)
    where selected.option_id !~ '^[1-9][0-9]*$'
  ) then
    raise exception 'Every selected Option must have a valid id'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from (
      select requested.position,
        count(*) as option_count,
        count(distinct selected.option_id::bigint) as distinct_option_count
      from jsonb_array_elements(p_lots) with ordinality requested(value, position)
      cross join lateral jsonb_array_elements_text(
        coalesce(requested.value -> 'option_ids', '[]'::jsonb)
      ) selected(option_id)
      group by requested.position
    ) option_counts
    where option_counts.option_count <> option_counts.distinct_option_count
  ) then
    raise exception 'Each Option can be selected only once per Lot'
      using errcode = '23505';
  end if;

  select version.utility_building
  into v_utility_enabled
  from valtrim.jobs job
  join valtrim.billing_setup_versions version
    on version.id = job.billing_setup_version_id
   and version.builder_id = job.builder_id
  where job.id = p_job_id
    and job.is_active
    and version.status in ('ACTIVE', 'SUPERSEDED')
  for update of job;

  if v_utility_enabled is null then
    raise exception 'Select an active Job with an available Billing Setup'
      using errcode = '23503';
  end if;
  if v_is_utility_building and not v_utility_enabled then
    raise exception 'Utility Building is inactive for this Job Billing Setup'
      using errcode = '23514';
  end if;

  if p_phase_id is null then
    select phase.id, phase.is_active
    into v_phase_id, v_phase_active
    from valtrim.phases phase
    where phase.job_id = p_job_id and phase.code = v_code
    for update;

    if v_phase_id is null then
      insert into valtrim.phases (
        job_id, code, building, is_utility_building
      ) values (
        p_job_id, v_code, v_building, v_is_utility_building
      ) returning id into v_phase_id;
    elsif v_phase_active then
      raise exception 'This Phase already exists for the selected Job'
        using errcode = '23505';
    else
      update valtrim.phases
      set building = v_building,
          is_utility_building = v_is_utility_building,
          is_active = true
      where id = v_phase_id;
    end if;
  else
    select phase.id, phase.is_utility_building
    into v_phase_id, v_existing_is_utility
    from valtrim.phases phase
    where phase.id = p_phase_id
      and phase.job_id = p_job_id
      and phase.is_active
    for update;

    if v_phase_id is null then
      raise exception 'Select an active Phase from the selected Job'
        using errcode = '23503';
    end if;
    if v_existing_is_utility is distinct from v_is_utility_building then
      raise exception 'An existing Phase cannot change between Lots and Utility Building rows'
        using errcode = '23514';
    end if;

    update valtrim.phases
    set code = v_code,
        building = v_building
    where id = v_phase_id;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
    where nullif(requested.value ->> 'id', '') is not null
      and not exists (
        select 1 from valtrim.lots lot
        where lot.id = (requested.value ->> 'id')::bigint
          and lot.phase_id = v_phase_id
      )
  ) then
    raise exception 'An existing row does not belong to the selected Phase'
      using errcode = '23503';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
    where not exists (
      select 1 from valtrim.plans plan
      where plan.id = (requested.value ->> 'plan_id')::bigint
        and plan.job_id = p_job_id
        and plan.is_active
    )
  ) then
    raise exception 'Every Phase row must use an active Plan from the selected Job'
      using errcode = '23503';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lots) requested(value)
    cross join lateral jsonb_array_elements_text(
      coalesce(requested.value -> 'option_ids', '[]'::jsonb)
    ) selected(option_id)
    where not exists (
      select 1 from valtrim.plan_options option
      where option.id = selected.option_id::bigint
        and option.plan_id = (requested.value ->> 'plan_id')::bigint
        and option.is_active
    )
  ) then
    raise exception 'Every selected Option must belong to the Lot Plan'
      using errcode = '23503';
  end if;

  update valtrim.lots
  set lot_number = 'SYNC-' || id::text
  where phase_id = v_phase_id;

  for v_lot in
    select
      nullif(requested.value ->> 'id', '')::bigint as id,
      case
        when v_is_utility_building then 'UTILITY-' || requested.position::text
        else upper(btrim(requested.value ->> 'lot_number'))
      end as lot_number,
      (requested.value ->> 'plan_id')::bigint as plan_id,
      case
        when v_is_utility_building then false
        else coalesce((requested.value ->> 'is_reverse')::boolean, false)
      end as is_reverse,
      case
        when v_is_utility_building then '[]'::jsonb
        else coalesce(requested.value -> 'option_ids', '[]'::jsonb)
      end as option_ids,
      (requested.position - 1)::integer as display_order
    from jsonb_array_elements(p_lots) with ordinality requested(value, position)
    order by requested.position
  loop
    if v_lot.id is null then
      insert into valtrim.lots (
        phase_id, job_id, plan_id, lot_number, is_reverse, display_order
      ) values (
        v_phase_id, p_job_id, v_lot.plan_id, v_lot.lot_number,
        v_lot.is_reverse, v_lot.display_order
      ) returning id into v_lot_id;
    else
      v_lot_id := v_lot.id;
      delete from valtrim.lot_options selected
      where selected.lot_id = v_lot_id;

      update valtrim.lots
      set plan_id = v_lot.plan_id,
          lot_number = v_lot.lot_number,
          is_reverse = v_lot.is_reverse,
          display_order = v_lot.display_order
      where id = v_lot_id and phase_id = v_phase_id;
    end if;

    if not v_is_utility_building then
      insert into valtrim.lot_options (lot_id, plan_id, option_id)
      select v_lot_id, v_lot.plan_id, selected.option_id::bigint
      from jsonb_array_elements_text(v_lot.option_ids) selected(option_id);
    end if;

    v_kept_lot_ids := array_append(v_kept_lot_ids, v_lot_id);
  end loop;

  delete from valtrim.lots lot
  where lot.phase_id = v_phase_id
    and not (lot.id = any(v_kept_lot_ids));

  return v_phase_id;
end;
$$;

create or replace function valtrim.save_sequence_sheet_phase(
  p_job_id bigint,
  p_phase_id bigint,
  p_code text,
  p_building text,
  p_lots jsonb
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select valtrim.save_sequence_sheet_phase(
    p_job_id,
    p_phase_id,
    p_code,
    p_building,
    p_lots,
    case
      when p_phase_id is null then false
      else coalesce((
        select phase.is_utility_building
        from valtrim.phases phase
        where phase.id = p_phase_id and phase.job_id = p_job_id
      ), false)
    end
  );
$$;

revoke execute on function valtrim.save_sequence_sheet_phase(
  bigint, bigint, text, text, jsonb, boolean
) from public, anon, authenticated;
grant execute on function valtrim.save_sequence_sheet_phase(
  bigint, bigint, text, text, jsonb, boolean
) to authenticated, service_role;

comment on function valtrim.save_sequence_sheet_phase(
  bigint, bigint, text, text, jsonb, boolean
) is
  'Atomically saves either ordinary Lot assignments or Utility Building Plan rows. Utility rows require the immutable Job Billing Setup capability and cannot include Reverse or Options.';

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
  v_option_charge jsonb := coalesce(
    nullif(current_setting('valtrim.draw_package_option_charge', true), '')::jsonb,
    '{}'::jsonb
  );
begin
  select
    package.job_id,
    phase.id as phase_id,
    phase.is_utility_building,
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
    version.utility_building as utility_building_enabled,
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
    -- Serialize attempts to bill the same Utility row without preventing a
    -- legitimate rebill after its prior Package has been voided.
    perform pg_catalog.pg_advisory_xact_lock(new.lot_id);

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

    if (v_option_charge ->> 'anchor_lot_id')::bigint = new.lot_id
       and jsonb_array_length(
         coalesce(v_option_charge -> 'package_options', '[]'::jsonb)
       ) > 0 then
      raise exception 'Utility Building rows cannot charge Options'
        using errcode = '23514';
    end if;

    new.base_draw_amount := 0;
    new.utility_amount := new.base_price;
  else
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
  'Builds immutable Lot / Draw snapshots. Ordinary Lots allocate the complete Plan Price by Draw percentage; Utility Building rows charge the complete Plan Price once on the selected Draw and never include Options or Hardware.';

create or replace function valtrim.reject_utility_production_activity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from valtrim.phases phase
    where phase.id = new.phase_id
      and phase.is_utility_building
  ) then
    raise exception 'Utility Building Phases do not belong to Production or Calendar Lot ranges'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger production_activities_reject_utility_phase
before insert or update of phase_id on valtrim.production_activities
for each row execute function valtrim.reject_utility_production_activity();

revoke execute on function valtrim.reject_utility_production_activity()
  from public, anon, authenticated;
grant execute on function valtrim.reject_utility_production_activity()
  to service_role;

notify pgrst, 'reload schema';

commit;
