-- Adopt the price a Purchase Order prints for an option.
--
-- compare_purchase_orders reports PRICE_DIFF when the PDF and the Lot disagree. A
-- price is never changed by itself: an Admin or Project Management user chooses
-- the Lots that should bill the PDF's price, and this does it in two steps inside
-- one transaction:
--
--   1. The option's price in its Plan becomes the PDF's price (set_option_price),
--      unless the Plan already holds it. That reaches the Phases created from now on.
--   2. The chosen Lots move to that price with apply_phase_price_changes, the same
--      step the Pricing screen uses. It asks for a reason, recalculates the Draft
--      Packages that bill the option, keeps the amount of Packages that cannot
--      change and records what is left to collect.
--
-- If the second step fails, the first is undone. Lots of the Plan not chosen here
-- keep the price they bill until they are moved too. Lines that no longer need it
-- are skipped and reported, so repeating the call changes nothing.
--
--   not_price_difference  the line matches now, or is not a price difference
--   header_not_confirmed  the PDF's Lot was only suggested; confirm it first
--   inactive              the Phase of the Lot is inactive
--   not_current           a newer Purchase Order replaced the line

begin;

create function valtrim.use_purchase_order_price(
  p_line_ids bigint[],
  p_reason text,
  p_remove_documents boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  v_job_count integer;
  v_job_id bigint;
  v_line record;
  v_lot_ids bigint[] := '{}';
  v_option_ids bigint[] := '{}';
  v_prices numeric[] := '{}';
  v_option_id bigint;
  v_price numeric;
  v_open record;
  v_price_set boolean := false;
  v_skipped jsonb := '[]'::jsonb;
  v_seen bigint[] := '{}';
  v_reason_skipped text;
  v_result jsonb;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to change option prices'
      using errcode = '42501';
  end if;

  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'Enter the reason for this price change (3 to 500 characters)'
      using errcode = '23514';
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

  if v_job_count > 1 then
    raise exception 'Change the prices of one Job at a time'
      using errcode = '22023';
  end if;

  if v_job_count = 1 then
    for v_line in
      select
        comparison.line_id,
        comparison.status,
        comparison.header_status,
        comparison.lot_id,
        comparison.plan_option_id,
        comparison.po_unit_price,
        coalesce(phase.is_active, false) as phase_active
      from valtrim.compare_purchase_orders(v_job_id) comparison
      left join valtrim.lots lot on lot.id = comparison.lot_id
      left join valtrim.phases phase on phase.id = lot.phase_id
      where comparison.line_id = any(p_line_ids)
      order by comparison.lot_number, comparison.line_id
    loop
      v_seen := array_append(v_seen, v_line.line_id);
      v_reason_skipped := case
        when v_line.status <> 'PRICE_DIFF' or v_line.plan_option_id is null
          then 'not_price_difference'
        when v_line.header_status <> 'resolved' then 'header_not_confirmed'
        when not v_line.phase_active then 'inactive'
      end;

      if v_reason_skipped is null then
        v_lot_ids := array_append(v_lot_ids, v_line.lot_id);
        v_option_ids := array_append(v_option_ids, v_line.plan_option_id);
        v_prices := array_append(v_prices, v_line.po_unit_price);
      else
        v_skipped := v_skipped || jsonb_build_object(
          'line_id', v_line.line_id,
          'reason', v_reason_skipped
        );
      end if;
    end loop;
  end if;

  -- Lines that never came back from the comparison are no longer current.
  select coalesce(v_skipped, '[]'::jsonb) || coalesce(jsonb_agg(
           jsonb_build_object('line_id', requested, 'reason', 'not_current')
         ), '[]'::jsonb)
    into v_skipped
  from unnest(p_line_ids) requested
  where not (requested = any(v_seen));

  if cardinality(v_lot_ids) = 0 then
    return jsonb_build_object(
      'price_set', false,
      'lots', 0,
      'options', 0,
      'skipped', v_skipped
    );
  end if;

  -- An option has one price per Plan: all the lines must ask for the same one.
  if (select count(distinct option_id) from unnest(v_option_ids) option_id) <> 1
     or (select count(distinct price) from unnest(v_prices) price) <> 1 then
    raise exception 'Choose lines of one option that print the same price'
      using errcode = '22023';
  end if;
  v_option_id := v_option_ids[1];
  v_price := v_prices[1];

  select price.price, price.is_not_applicable
    into v_open
  from valtrim.option_prices price
  where price.option_id = v_option_id and price.effective_to is null;

  if not found or v_open.is_not_applicable or v_open.price <> v_price then
    perform valtrim.set_option_price(v_option_id, v_price, false);
    v_price_set := true;
  end if;

  v_result := valtrim.apply_phase_price_changes(
    v_job_id,
    '{}'::bigint[],
    (
      select jsonb_agg(jsonb_build_object('lot_id', moved.lot_id, 'option_id', v_option_id))
      from unnest(v_lot_ids) as moved(lot_id)
    ),
    v_reason,
    coalesce(p_remove_documents, false)
  );

  return v_result || jsonb_build_object(
    'price_set', v_price_set,
    'option_id', v_option_id,
    'price', v_price,
    'skipped', v_skipped
  );
end;
$$;

revoke execute on function valtrim.use_purchase_order_price(bigint[], text, boolean)
  from public, anon;
grant execute on function valtrim.use_purchase_order_price(bigint[], text, boolean)
  to authenticated;

comment on function valtrim.use_purchase_order_price(bigint[], text, boolean) is
  'Sets the price a Purchase Order prints as the option''s price in its Plan and moves the chosen Lots to it, in one transaction. Admin and Project Management only; a reason is required.';

commit;
