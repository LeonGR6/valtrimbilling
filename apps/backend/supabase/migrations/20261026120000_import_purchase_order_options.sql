-- Import the options a Purchase Order prints into the Job.
--
-- compare_purchase_orders says which options of a PDF are not in the system. This
-- lets an Admin or Project Management user act on that, line by line and only on
-- purpose:
--
--   MISSING_OPTION  the Plan has no option with that code -> the option is created
--                   in the Plan (name and description from the PDF, price = the
--                   PDF's price) and selected for the Lot.
--   NOT_IN_LOT      the option exists in the Plan -> it is selected for the Lot
--                   at the price the Plan holds today. A different PDF price is
--                   not applied here: it is shown as a difference.
--
-- The whole call is one transaction: either everything asked for is saved, or
-- nothing is. Lines that cannot be imported are skipped and reported, never
-- guessed:
--
--   header_not_confirmed  the PDF's Lot was only suggested; confirm it first
--   not_importable        the line is no longer missing or not selected (importing
--                         twice does nothing the second time)
--   not_current           a newer Purchase Order replaced the line
--   utility_lot           utility buildings have no options
--   inactive              the Job, Phase or Plan is inactive
--   phase_billed          a Package already billed a Lot of that Phase
--   no_price              the option has no price to bill

begin;

create function valtrim.import_purchase_order_options(p_line_ids bigint[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_job_count integer;
  v_job_id bigint;
  v_line record;
  v_option_id bigint;
  v_name text;
  v_description text;
  v_created integer := 0;
  v_added integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_seen bigint[] := '{}';
  v_reason text;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to import Purchase Order options'
      using errcode = '42501';
  end if;

  if p_line_ids is null
     or cardinality(p_line_ids) not between 1 and 500 then
    raise exception 'Select between 1 and 500 Purchase Order lines'
      using errcode = '22023';
  end if;

  select count(distinct current_line.job_id), min(current_line.job_id)
    into v_job_count, v_job_id
  from valtrim.purchase_order_current_lines current_line
  where current_line.id = any(p_line_ids);

  if v_job_count <> 1 then
    -- Either the lines are of different Jobs or none of them is current any more.
    if v_job_count = 0 then
      select jsonb_agg(
               jsonb_build_object('line_id', requested, 'reason', 'not_current')
             )
        into v_skipped
      from unnest(p_line_ids) requested;
      return jsonb_build_object(
        'created_options', 0,
        'added_to_lots', 0,
        'skipped', coalesce(v_skipped, '[]'::jsonb)
      );
    end if;
    raise exception 'Import the lines of one Job at a time'
      using errcode = '22023';
  end if;

  -- Two people importing the same Job at once must not create the option twice.
  perform pg_advisory_xact_lock(hashtextextended('purchase_order_import', 0) # v_job_id);

  perform 1 from valtrim.jobs job where job.id = v_job_id and job.is_active;
  if not found then
    raise exception 'Select an active Job' using errcode = '23503';
  end if;

  for v_line in
    select
      comparison.line_id,
      comparison.status,
      comparison.header_status,
      comparison.lot_id,
      comparison.plan_id,
      comparison.plan_option_id,
      comparison.option_code_raw,
      comparison.description_lines,
      comparison.po_unit_price,
      lot.phase_id,
      lot.is_utility_building as lot_is_utility,
      (phase.is_active and plan.is_active) as active,
      (
        exists (
          select 1
          from valtrim.package_draws billed_draw
          join valtrim.lots billed_lot on billed_lot.id = billed_draw.lot_id
          where billed_lot.phase_id = lot.phase_id
        )
        or exists (
          select 1
          from valtrim.package_hardware_lines billed_line
          join valtrim.lots billed_lot on billed_lot.id = billed_line.lot_id
          where billed_lot.phase_id = lot.phase_id
        )
      ) as phase_billed
    from valtrim.compare_purchase_orders(v_job_id) comparison
    left join valtrim.lots lot on lot.id = comparison.lot_id
    left join valtrim.phases phase on phase.id = lot.phase_id
    left join valtrim.plans plan on plan.id = lot.plan_id
    where comparison.line_id = any(p_line_ids)
    order by comparison.lot_number, comparison.option_code_raw, comparison.line_id
  loop
    v_seen := array_append(v_seen, v_line.line_id);
    v_reason := case
      when v_line.status not in ('MISSING_OPTION', 'NOT_IN_LOT') then 'not_importable'
      when v_line.header_status <> 'resolved' then 'header_not_confirmed'
      when v_line.lot_is_utility then 'utility_lot'
      when not coalesce(v_line.active, false) then 'inactive'
      when v_line.phase_billed then 'phase_billed'
    end;

    if v_reason is null then
      if v_line.status = 'MISSING_OPTION' then
        -- A sibling Lot of the same Plan may have just created it in this call.
        select option.id
          into v_option_id
        from valtrim.plan_options option
        where option.plan_id = v_line.plan_id
          and option.is_active
          and private.option_code_key(option.code)
            = private.option_code_key(v_line.option_code_raw)
        order by option.id
        limit 1;

        if v_option_id is null then
          v_name := left(
            coalesce(nullif(btrim(v_line.description_lines[1]), ''), v_line.option_code_raw),
            300
          );
          v_description := nullif(
            left(array_to_string(v_line.description_lines[2:], ' · '), 300),
            ''
          );

          insert into valtrim.plan_options (plan_id, code, name, description)
          values (
            v_line.plan_id,
            left(btrim(v_line.option_code_raw), 40),
            v_name,
            v_description
          )
          returning id into v_option_id;

          perform valtrim.set_option_price(v_option_id, v_line.po_unit_price, false);
          v_created := v_created + 1;
        end if;
      else
        v_option_id := v_line.plan_option_id;
      end if;

      if private.current_option_price_id(v_option_id) is null then
        v_reason := 'no_price';
      elsif not exists (
        select 1
        from valtrim.lot_options existing
        where existing.lot_id = v_line.lot_id
          and existing.option_id = v_option_id
      ) then
        insert into valtrim.lot_options (lot_id, plan_id, option_id)
        values (v_line.lot_id, v_line.plan_id, v_option_id);
        v_added := v_added + 1;
      end if;
    end if;

    if v_reason is not null then
      v_skipped := v_skipped || jsonb_build_object(
        'line_id', v_line.line_id,
        'reason', v_reason
      );
    end if;
  end loop;

  -- Lines that never came back from the comparison are no longer current.
  select coalesce(v_skipped, '[]'::jsonb) || coalesce(jsonb_agg(
           jsonb_build_object('line_id', requested, 'reason', 'not_current')
         ), '[]'::jsonb)
    into v_skipped
  from unnest(p_line_ids) requested
  where not (requested = any(v_seen));

  return jsonb_build_object(
    'created_options', v_created,
    'added_to_lots', v_added,
    'skipped', v_skipped
  );
end;
$$;

revoke execute on function valtrim.import_purchase_order_options(bigint[])
  from public, anon;
grant execute on function valtrim.import_purchase_order_options(bigint[])
  to authenticated;

comment on function valtrim.import_purchase_order_options(bigint[]) is
  'Creates the options a Purchase Order prints that the Plan lacks and selects them for the Lot. Admin and Project Management only; skips and reports what cannot be imported.';

commit;
