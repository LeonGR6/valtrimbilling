-- Price differences for Packages that cannot change.
--
-- A Package with a QuickBooks invoice, sent or paid keeps the amount it was billed.
-- When an administrator moves its Phases to today's price, the Package is left as it
-- is and the difference is worked out and recorded instead: what the same Draws
-- would have billed at the new price, minus what was billed, with Retention and WRAP.
-- That difference is pending to collect; collecting it comes later, nothing here
-- creates an invoice.
--
--   * Only Lots and Options an administrator moved on purpose count. A Lot that was
--     simply pinned to the price in force when this feature arrived has no
--     difference, even if an older Package billed another price.
--   * A difference is always worked out against what was billed, never added to an
--     earlier one: moving to another price replaces it, and moving back to the
--     billed price leaves nothing pending.
--   * The arithmetic mirrors the Package calculation (Draw remainders, Hardware and
--     Utility events, Retention, WRAP), and is checked against it in the tests.

begin;

create table valtrim.package_price_differences (
  id bigint generated always as identity primary key,
  recalculation_id bigint not null
    references valtrim.phase_price_recalculations(id) on delete restrict,
  job_id bigint not null references valtrim.jobs(id) on delete restrict,
  package_id bigint not null references valtrim.draw_packages(id) on delete restrict,
  package_number text not null,
  line_kind text not null check (line_kind in ('DRAW', 'HARDWARE_EVENT')),
  lot_id bigint not null,
  draw_id bigint,
  hardware_event_type text,
  phase_id bigint not null,
  phase_code text not null,
  building text,
  lot_number text not null,
  plan_code text not null,
  draw_number smallint,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'COLLECTED', 'DISMISSED')),
  billed_gross numeric(14,2) not null,
  billed_retention numeric(14,2) not null,
  billed_wrap numeric(14,2) not null,
  billed_net numeric(14,2) not null,
  new_gross numeric(14,2) not null,
  new_retention numeric(14,2) not null,
  new_wrap numeric(14,2) not null,
  new_net numeric(14,2) not null,
  delta_base numeric(14,2) not null default 0,
  delta_hardware numeric(14,2) not null default 0,
  delta_utility numeric(14,2) not null default 0,
  delta_options numeric(14,2) not null default 0,
  delta_gross numeric(14,2) not null,
  delta_retention numeric(14,2) not null,
  delta_wrap numeric(14,2) not null,
  delta_net numeric(14,2) not null,
  created_by uuid not null references valtrim.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (
    (line_kind = 'DRAW' and draw_id is not null and hardware_event_type is null)
    or (line_kind = 'HARDWARE_EVENT' and draw_id is null and hardware_event_type is not null)
  )
);

-- One pending difference per Package cell: a new calculation replaces it.
create unique index package_price_differences_pending_cell_uq
  on valtrim.package_price_differences (
    package_id, line_kind, lot_id, coalesce(draw_id, 0), coalesce(hardware_event_type, '')
  )
  where status = 'PENDING';
create index package_price_differences_job_idx
  on valtrim.package_price_differences (job_id, status);
create index package_price_differences_package_idx
  on valtrim.package_price_differences (package_id);
create index package_price_differences_recalculation_idx
  on valtrim.package_price_differences (recalculation_id);
create index package_price_differences_actor_idx
  on valtrim.package_price_differences (created_by);

alter table valtrim.package_price_differences enable row level security;
revoke all on table valtrim.package_price_differences from public, anon, authenticated;
revoke all on sequence valtrim.package_price_differences_id_seq
  from public, anon, authenticated;
grant select (
  id, recalculation_id, job_id, package_id, package_number, line_kind, lot_id,
  draw_id, hardware_event_type, phase_id, phase_code, building, lot_number,
  plan_code, draw_number, status,
  billed_gross, billed_retention, billed_wrap, billed_net,
  new_gross, new_retention, new_wrap, new_net,
  delta_base, delta_hardware, delta_utility, delta_options,
  delta_gross, delta_retention, delta_wrap, delta_net,
  created_by, created_at
) on valtrim.package_price_differences to authenticated;
create policy package_price_differences_select
on valtrim.package_price_differences for select to authenticated
using ((select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')));

-- A cancelled Package no longer owes anything.
create function private.dismiss_price_differences_of_voided_package()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'VOIDED' and old.status is distinct from 'VOIDED' then
    update valtrim.package_price_differences
    set status = 'DISMISSED'
    where package_id = new.id and status = 'PENDING';
  end if;
  return new;
end;
$$;

create trigger draw_packages_dismiss_price_differences
  after update of status on valtrim.draw_packages
  for each row execute function private.dismiss_price_differences_of_voided_package();

-- The arithmetic of a Package line ---------------------------------------------

-- A total split by Hardware / Utility events (EXT, DM, HW): each event takes its
-- percentage, and the last one with a share takes what is left, so the parts add up.
create function private.event_allocation(
  p_total numeric,
  p_event text,
  p_ext numeric,
  p_dm numeric,
  p_hw numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when not exists (
      select 1
      from (values (1, p_ext), (2, p_dm), (3, p_hw)) as later(event_order, percentage)
      where later.event_order > ev.event_order and later.percentage > 0
    ) then p_total - coalesce((
      select sum(round(p_total * prior.percentage / 100, 2))
      from (values (1, p_ext), (2, p_dm), (3, p_hw)) as prior(event_order, percentage)
      where prior.event_order < ev.event_order and prior.percentage > 0
    ), 0)
    else round(p_total * ev.percentage / 100, 2)
  end
  from (
    select
      case p_event when 'EXT' then 1 when 'DM' then 2 when 'HW' then 3 else 0 end as event_order,
      case p_event when 'EXT' then p_ext when 'DM' then p_dm when 'HW' then p_hw else 0 end as percentage
  ) ev
$$;

-- A Plan price split by Draw: the last Draw takes what the earlier ones left.
create function private.draw_allocation(
  p_total numeric,
  p_setup_version_id bigint,
  p_draw_number smallint,
  p_percentage numeric
)
returns numeric
language sql
stable
set search_path = ''
as $$
  select case
    when p_draw_number = (
      select max(draw.draw_number)
      from valtrim.billing_draws draw
      where draw.setup_version_id = p_setup_version_id
    ) then p_total - coalesce((
      select sum(round(p_total * draw.percentage / 100, 2))
      from valtrim.billing_draws draw
      where draw.setup_version_id = p_setup_version_id
        and draw.draw_number < p_draw_number
    ), 0)
    else round(p_total * p_percentage / 100, 2)
  end
$$;

-- What a Draw line would bill with the prices its Lot and Options point at now,
-- next to what it billed. Null when neither its Plan price nor its Options were
-- moved by an administrator: nothing is owed for it.
create function private.package_line_new_amounts(p_line valtrim.package_draws)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_version valtrim.billing_setup_versions%rowtype;
  v_pin valtrim.plan_prices%rowtype;
  v_plan_moved boolean;
  v_options_moved boolean := false;
  v_base numeric := p_line.base_price;
  v_hardware_price numeric := p_line.hardware_price;
  v_base_draw numeric := p_line.base_draw_amount;
  v_hardware numeric := p_line.hardware_amount;
  v_utility numeric := p_line.utility_amount;
  v_options numeric := p_line.options_amount;
  v_options_total numeric;
  v_gross numeric;
  v_retention numeric;
  v_wrap numeric;
begin
  select version.*
  into v_version
  from valtrim.billing_setup_versions version
  where version.id = p_line.setup_version_id;

  select price.*
  into v_pin
  from valtrim.lots lot
  join valtrim.plan_prices price on price.id = lot.plan_price_id
  where lot.id = p_line.lot_id;

  v_plan_moved := v_pin.id is not null and exists (
    select 1
    from valtrim.phase_price_recalculation_lines moved
    where moved.lot_id = p_line.lot_id
      and moved.option_id is null
      and moved.new_plan_price_id = v_pin.id
  );

  if v_plan_moved then
    v_base := v_pin.base_price;
    v_hardware_price := case
      when p_line.is_utility_building then 0
      when v_version.separate_hardware_price then v_pin.hardware_price
      else 0
    end;

    if p_line.is_utility_building then
      v_base_draw := 0;
      v_utility := case
        when p_line.utility_billing_mode = 'FULL' then v_base
        else private.event_allocation(
          v_base, p_line.utility_event_type::text,
          v_version.utility_ext_percentage, v_version.utility_dm_percentage,
          v_version.utility_hw_percentage
        )
      end;
    else
      v_base_draw := private.draw_allocation(
        v_base, p_line.setup_version_id, p_line.draw_number, p_line.draw_percentage
      );
    end if;

    if p_line.hardware_percentage > 0 or p_line.hardware_amount > 0 then
      if v_hardware_price is null then
        raise exception 'This Package bills Separate Hardware but the new Plan price has no hardware price'
          using errcode = '23514';
      end if;
      v_hardware := case
        when p_line.hardware_billing_mode = 'FULL' then v_hardware_price
        else private.event_allocation(
          v_hardware_price, p_line.hardware_event_type::text,
          v_version.hardware_ext_percentage, v_version.hardware_dm_percentage,
          v_version.hardware_hw_percentage
        )
      end;
    end if;
  end if;

  select
    coalesce(sum(
      case when moved_option.moved
        then coalesce(current_price.price, billed.option_price)
        else billed.option_price
      end
    ), 0),
    coalesce(bool_or(moved_option.moved), false)
  into v_options_total, v_options_moved
  from valtrim.package_options billed
  left join valtrim.lot_options selected
    on selected.lot_id = billed.lot_id and selected.option_id = billed.option_id
  left join valtrim.option_prices current_price on current_price.id = selected.option_price_id
  cross join lateral (
    select (
      current_price.id is not null
      and exists (
        select 1
        from valtrim.phase_price_recalculation_lines moved
        where moved.lot_id = billed.lot_id
          and moved.option_id = billed.option_id
          and moved.new_option_price_id = current_price.id
      )
    ) as moved
  ) moved_option
  where billed.package_id = p_line.package_id
    and billed.billing_lot_id = p_line.lot_id
    and billed.draw_id = p_line.draw_id;

  if not v_plan_moved and not v_options_moved then
    return null;
  end if;
  if v_options_moved then
    v_options := v_options_total;
  end if;

  v_gross := v_base_draw + v_hardware + v_options + v_utility;
  v_retention := round(v_gross * p_line.retention_percentage / 100, 2);
  v_wrap := round(v_gross * p_line.wrap_percentage / 100, 2);

  return jsonb_build_object(
    'billed', jsonb_build_object(
      'base', p_line.base_draw_amount,
      'hardware', p_line.hardware_amount,
      'utility', p_line.utility_amount,
      'options', p_line.options_amount,
      'gross', p_line.gross_amount,
      'retention', p_line.retention_amount,
      'wrap', p_line.wrap_amount,
      'net', p_line.net_amount
    ),
    'new', jsonb_build_object(
      'base', v_base_draw,
      'hardware', v_hardware,
      'utility', v_utility,
      'options', v_options,
      'gross', v_gross,
      'retention', v_retention,
      'wrap', v_wrap,
      'net', v_gross - v_retention - v_wrap
    )
  );
end;
$$;

-- The same for Separate Hardware billed by Calendar event.
create function private.package_hardware_line_new_amounts(p_line valtrim.package_hardware_lines)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_version valtrim.billing_setup_versions%rowtype;
  v_pin valtrim.plan_prices%rowtype;
  v_amount numeric;
  v_retention numeric;
  v_wrap numeric;
begin
  select version.*
  into v_version
  from valtrim.billing_setup_versions version
  where version.id = p_line.setup_version_id;

  select price.*
  into v_pin
  from valtrim.lots lot
  join valtrim.plan_prices price on price.id = lot.plan_price_id
  where lot.id = p_line.lot_id;

  if v_pin.id is null or not exists (
    select 1
    from valtrim.phase_price_recalculation_lines moved
    where moved.lot_id = p_line.lot_id
      and moved.option_id is null
      and moved.new_plan_price_id = v_pin.id
  ) then
    return null;
  end if;
  if v_pin.hardware_price is null then
    raise exception 'This Package bills Separate Hardware but the new Plan price has no hardware price'
      using errcode = '23514';
  end if;

  v_amount := private.event_allocation(
    v_pin.hardware_price, p_line.hardware_event_type::text,
    v_version.hardware_ext_percentage, v_version.hardware_dm_percentage,
    v_version.hardware_hw_percentage
  );
  v_retention := round(v_amount * p_line.retention_percentage / 100, 2);
  v_wrap := round(v_amount * p_line.wrap_percentage / 100, 2);

  return jsonb_build_object(
    'billed', jsonb_build_object(
      'base', 0,
      'hardware', p_line.hardware_amount,
      'utility', 0,
      'options', 0,
      'gross', p_line.gross_amount,
      'retention', p_line.retention_amount,
      'wrap', p_line.wrap_amount,
      'net', p_line.net_amount
    ),
    'new', jsonb_build_object(
      'base', 0,
      'hardware', v_amount,
      'utility', 0,
      'options', 0,
      'gross', v_amount,
      'retention', v_retention,
      'wrap', v_wrap,
      'net', v_amount - v_retention - v_wrap
    )
  );
end;
$$;

-- Recording what is owed -----------------------------------------------------------
-- Recalculated against what each Package billed, and replacing what was pending for
-- it: running it again with other prices never adds to an earlier difference.

create function private.record_package_price_differences(
  p_recalculation_id bigint,
  p_package_ids bigint[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_package_id bigint;
  v_package record;
  v_line valtrim.package_draws%rowtype;
  v_hardware_line valtrim.package_hardware_lines%rowtype;
  v_amounts jsonb;
  v_summary jsonb := '[]'::jsonb;
  v_lines integer;
  v_delta_gross numeric;
  v_delta_net numeric;
begin
  foreach v_package_id in array coalesce(p_package_ids, '{}'::bigint[])
  loop
    delete from valtrim.package_price_differences
    where package_id = v_package_id and status = 'PENDING';

    select package.package_number, package.job_id, package.workflow_status
    into v_package
    from valtrim.draw_packages package
    where package.id = v_package_id;

    v_lines := 0;
    v_delta_gross := 0;
    v_delta_net := 0;

    for v_line in
      select line.*
      from valtrim.package_draws line
      where line.package_id = v_package_id
      order by line.lot_id, line.draw_number
    loop
      v_amounts := private.package_line_new_amounts(v_line);
      continue when v_amounts is null
        or (v_amounts -> 'new') = (v_amounts -> 'billed');

      insert into valtrim.package_price_differences (
        recalculation_id, job_id, package_id, package_number, line_kind, lot_id,
        draw_id, phase_id, phase_code, building, lot_number, plan_code, draw_number,
        billed_gross, billed_retention, billed_wrap, billed_net,
        new_gross, new_retention, new_wrap, new_net,
        delta_base, delta_hardware, delta_utility, delta_options,
        delta_gross, delta_retention, delta_wrap, delta_net, created_by
      ) values (
        p_recalculation_id, v_package.job_id, v_package_id, v_package.package_number,
        'DRAW', v_line.lot_id, v_line.draw_id, v_line.phase_id, v_line.phase_code,
        v_line.building, v_line.lot_number, v_line.plan_code, v_line.draw_number,
        (v_amounts -> 'billed' ->> 'gross')::numeric,
        (v_amounts -> 'billed' ->> 'retention')::numeric,
        (v_amounts -> 'billed' ->> 'wrap')::numeric,
        (v_amounts -> 'billed' ->> 'net')::numeric,
        (v_amounts -> 'new' ->> 'gross')::numeric,
        (v_amounts -> 'new' ->> 'retention')::numeric,
        (v_amounts -> 'new' ->> 'wrap')::numeric,
        (v_amounts -> 'new' ->> 'net')::numeric,
        (v_amounts -> 'new' ->> 'base')::numeric - (v_amounts -> 'billed' ->> 'base')::numeric,
        (v_amounts -> 'new' ->> 'hardware')::numeric - (v_amounts -> 'billed' ->> 'hardware')::numeric,
        (v_amounts -> 'new' ->> 'utility')::numeric - (v_amounts -> 'billed' ->> 'utility')::numeric,
        (v_amounts -> 'new' ->> 'options')::numeric - (v_amounts -> 'billed' ->> 'options')::numeric,
        (v_amounts -> 'new' ->> 'gross')::numeric - (v_amounts -> 'billed' ->> 'gross')::numeric,
        (v_amounts -> 'new' ->> 'retention')::numeric - (v_amounts -> 'billed' ->> 'retention')::numeric,
        (v_amounts -> 'new' ->> 'wrap')::numeric - (v_amounts -> 'billed' ->> 'wrap')::numeric,
        (v_amounts -> 'new' ->> 'net')::numeric - (v_amounts -> 'billed' ->> 'net')::numeric,
        v_actor_id
      );
      v_lines := v_lines + 1;
      v_delta_gross := v_delta_gross
        + (v_amounts -> 'new' ->> 'gross')::numeric - (v_amounts -> 'billed' ->> 'gross')::numeric;
      v_delta_net := v_delta_net
        + (v_amounts -> 'new' ->> 'net')::numeric - (v_amounts -> 'billed' ->> 'net')::numeric;
    end loop;

    for v_hardware_line in
      select line.*
      from valtrim.package_hardware_lines line
      where line.package_id = v_package_id
      order by line.lot_id, line.hardware_event_type
    loop
      v_amounts := private.package_hardware_line_new_amounts(v_hardware_line);
      continue when v_amounts is null
        or (v_amounts -> 'new') = (v_amounts -> 'billed');

      insert into valtrim.package_price_differences (
        recalculation_id, job_id, package_id, package_number, line_kind, lot_id,
        hardware_event_type, phase_id, phase_code, building, lot_number, plan_code,
        billed_gross, billed_retention, billed_wrap, billed_net,
        new_gross, new_retention, new_wrap, new_net,
        delta_base, delta_hardware, delta_utility, delta_options,
        delta_gross, delta_retention, delta_wrap, delta_net, created_by
      ) values (
        p_recalculation_id, v_package.job_id, v_package_id, v_package.package_number,
        'HARDWARE_EVENT', v_hardware_line.lot_id, v_hardware_line.hardware_event_type::text,
        v_hardware_line.phase_id, v_hardware_line.phase_code, v_hardware_line.building,
        v_hardware_line.lot_number, v_hardware_line.plan_code,
        (v_amounts -> 'billed' ->> 'gross')::numeric,
        (v_amounts -> 'billed' ->> 'retention')::numeric,
        (v_amounts -> 'billed' ->> 'wrap')::numeric,
        (v_amounts -> 'billed' ->> 'net')::numeric,
        (v_amounts -> 'new' ->> 'gross')::numeric,
        (v_amounts -> 'new' ->> 'retention')::numeric,
        (v_amounts -> 'new' ->> 'wrap')::numeric,
        (v_amounts -> 'new' ->> 'net')::numeric,
        0,
        (v_amounts -> 'new' ->> 'hardware')::numeric - (v_amounts -> 'billed' ->> 'hardware')::numeric,
        0,
        0,
        (v_amounts -> 'new' ->> 'gross')::numeric - (v_amounts -> 'billed' ->> 'gross')::numeric,
        (v_amounts -> 'new' ->> 'retention')::numeric - (v_amounts -> 'billed' ->> 'retention')::numeric,
        (v_amounts -> 'new' ->> 'wrap')::numeric - (v_amounts -> 'billed' ->> 'wrap')::numeric,
        (v_amounts -> 'new' ->> 'net')::numeric - (v_amounts -> 'billed' ->> 'net')::numeric,
        v_actor_id
      );
      v_lines := v_lines + 1;
      v_delta_gross := v_delta_gross
        + (v_amounts -> 'new' ->> 'gross')::numeric - (v_amounts -> 'billed' ->> 'gross')::numeric;
      v_delta_net := v_delta_net
        + (v_amounts -> 'new' ->> 'net')::numeric - (v_amounts -> 'billed' ->> 'net')::numeric;
    end loop;

    v_summary := v_summary || jsonb_build_array(jsonb_build_object(
      'package_id', v_package_id,
      'package_number', v_package.package_number,
      'workflow_status', v_package.workflow_status,
      'lines', v_lines,
      'delta_gross', v_delta_gross,
      'delta_net', v_delta_net
    ));
  end loop;

  return v_summary;
end;
$$;

revoke all on function private.event_allocation(numeric, text, numeric, numeric, numeric)
  from public, anon, authenticated;
revoke all on function private.draw_allocation(numeric, bigint, smallint, numeric)
  from public, anon, authenticated;
revoke all on function private.package_line_new_amounts(valtrim.package_draws)
  from public, anon, authenticated;
revoke all on function private.package_hardware_line_new_amounts(valtrim.package_hardware_lines)
  from public, anon, authenticated;
revoke all on function private.record_package_price_differences(bigint, bigint[])
  from public, anon, authenticated;
revoke all on function private.dismiss_price_differences_of_voided_package()
  from public, anon, authenticated;

-- Which Packages bill a price, and in what state -------------------------------------

create or replace function private.lot_billing_packages(p_lot_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'package_id', package.id,
      'package_number', package.package_number,
      'workflow_status', package.workflow_status,
      'recalculable', private.draw_package_can_be_recalculated(package.id),
      'has_documents', exists (
        select 1 from valtrim.package_documents document
        where document.package_id = package.id
          and document.file_id is not null
          and document.document_type in ('RELEASE', 'PAYMENT_SCHEDULE')
      )
    ) order by package.id
  ), '[]'::jsonb)
  from valtrim.draw_packages package
  where package.id in (
    select line.package_id from valtrim.package_draws line where line.lot_id = p_lot_id
    union
    select line.package_id from valtrim.package_hardware_lines line where line.lot_id = p_lot_id
  )
$$;

create or replace function private.lot_option_billing_packages(p_lot_id bigint, p_option_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'package_id', package.id,
      'package_number', package.package_number,
      'workflow_status', package.workflow_status,
      'recalculable', private.draw_package_can_be_recalculated(package.id),
      'has_documents', exists (
        select 1 from valtrim.package_documents document
        where document.package_id = package.id
          and document.file_id is not null
          and document.document_type in ('RELEASE', 'PAYMENT_SCHEDULE')
      )
    ) order by package.id
  ), '[]'::jsonb)
  from valtrim.draw_packages package
  where package.id in (
    select billed.package_id
    from valtrim.package_options billed
    where billed.lot_id = p_lot_id and billed.option_id = p_option_id
  )
$$;

-- Move chosen Lots / Options to today's price ------------------------------------------
-- Anything can be moved now. What is billed in a Draft Package is calculated again
-- with the new price; what is billed in a Package that cannot change keeps its amount
-- and the difference is recorded as pending.

create or replace function valtrim.apply_phase_price_changes(
  p_job_id bigint,
  p_lot_ids bigint[],
  p_options jsonb,
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
  v_lot_ids bigint[];
  v_options jsonb := coalesce(p_options, '[]'::jsonb);
  v_recalculation_id bigint;
  v_lot_count integer := 0;
  v_option_count integer := 0;
  v_moved_lot_ids bigint[] := '{}'::bigint[];
  v_moved_option_lot_ids bigint[] := '{}'::bigint[];
  v_moved_option_ids bigint[] := '{}'::bigint[];
  v_package_ids bigint[];
  v_draft_ids bigint[];
  v_issued_ids bigint[];
  v_package_id bigint;
  v_package jsonb;
  v_packages jsonb := '[]'::jsonb;
  v_differences jsonb := '[]'::jsonb;
  v_paths jsonb := '[]'::jsonb;
  v_row record;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to update Phase prices'
      using errcode = '42501';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'Enter the reason for this price change (3 to 500 characters)'
      using errcode = '23514';
  end if;
  if jsonb_typeof(v_options) <> 'array'
     or exists (
       select 1
       from jsonb_array_elements(v_options) item
       where jsonb_typeof(item) <> 'object'
          or jsonb_typeof(item -> 'lot_id') is distinct from 'number'
          or jsonb_typeof(item -> 'option_id') is distinct from 'number'
     ) then
    raise exception 'Every Option selection needs a Lot and an Option'
      using errcode = '23514';
  end if;

  v_lot_ids := array(
    select distinct selected.lot_id
    from unnest(coalesce(p_lot_ids, '{}'::bigint[])) as selected(lot_id)
    where selected.lot_id is not null
  );
  v_options := coalesce((
    select jsonb_agg(distinct jsonb_build_object(
      'lot_id', (item ->> 'lot_id')::bigint,
      'option_id', (item ->> 'option_id')::bigint
    ))
    from jsonb_array_elements(v_options) item
  ), '[]'::jsonb);

  if cardinality(v_lot_ids) + jsonb_array_length(v_options) = 0 then
    raise exception 'Select at least one Phase price to update'
      using errcode = '23514';
  end if;
  if cardinality(v_lot_ids) + jsonb_array_length(v_options) > 5000 then
    raise exception 'Select 5000 prices or fewer at a time'
      using errcode = '23514';
  end if;

  -- Package creation and corrections lock the Job first; so does this.
  perform 1 from valtrim.jobs job where job.id = p_job_id and job.is_active for update;
  if not found then
    raise exception 'Select an active Job' using errcode = '23503';
  end if;

  insert into valtrim.phase_price_recalculations (job_id, reason, created_by)
  values (p_job_id, v_reason, v_actor_id)
  returning id into v_recalculation_id;

  for v_row in
    select
      lot.id as lot_id,
      phase.id as phase_id,
      phase.code as phase_code,
      phase.building,
      lot.lot_number,
      lot.plan_id,
      plan.code as plan_code,
      lot.plan_price_id as previous_id,
      open_price.id as new_id,
      pinned.base_price as previous_base,
      pinned.hardware_price as previous_hardware,
      open_price.base_price as new_base,
      open_price.hardware_price as new_hardware
    from unnest(v_lot_ids) as requested(lot_id)
    join valtrim.lots lot on lot.id = requested.lot_id
    join valtrim.phases phase
      on phase.id = lot.phase_id and phase.job_id = p_job_id and phase.is_active
    join valtrim.plans plan on plan.id = lot.plan_id
    join valtrim.plan_prices open_price
      on open_price.plan_id = lot.plan_id and open_price.effective_to is null
    left join valtrim.plan_prices pinned on pinned.id = lot.plan_price_id
    where (pinned.base_price, pinned.hardware_price)
        is distinct from (open_price.base_price, open_price.hardware_price)
    order by lot.id
    for update of lot
  loop
    update valtrim.lots
    set plan_price_id = v_row.new_id
    where id = v_row.lot_id;

    insert into valtrim.phase_price_recalculation_lines (
      recalculation_id, lot_id, phase_id, phase_code, building, lot_number,
      plan_id, plan_code, previous_plan_price_id, new_plan_price_id,
      previous_amount, new_amount, previous_hardware_amount, new_hardware_amount
    ) values (
      v_recalculation_id, v_row.lot_id, v_row.phase_id, v_row.phase_code,
      v_row.building, v_row.lot_number, v_row.plan_id, v_row.plan_code,
      v_row.previous_id, v_row.new_id,
      v_row.previous_base, v_row.new_base,
      v_row.previous_hardware, v_row.new_hardware
    );
    v_moved_lot_ids := v_moved_lot_ids || v_row.lot_id;
    v_lot_count := v_lot_count + 1;
  end loop;

  for v_row in
    select
      selected.lot_id,
      selected.option_id,
      selected.option_price_id as previous_id,
      open_price.id as new_id,
      phase.id as phase_id,
      phase.code as phase_code,
      phase.building,
      lot.lot_number,
      lot.plan_id,
      plan.code as plan_code,
      option.code as option_code,
      pinned.price as previous_price,
      open_price.price as new_price
    from jsonb_to_recordset(v_options) as requested(lot_id bigint, option_id bigint)
    join valtrim.lot_options selected
      on selected.lot_id = requested.lot_id and selected.option_id = requested.option_id
    join valtrim.lots lot on lot.id = selected.lot_id
    join valtrim.phases phase
      on phase.id = lot.phase_id and phase.job_id = p_job_id and phase.is_active
    join valtrim.plans plan on plan.id = lot.plan_id
    join valtrim.plan_options option on option.id = selected.option_id
    join valtrim.option_prices open_price
      on open_price.option_id = selected.option_id and open_price.effective_to is null
    left join valtrim.option_prices pinned on pinned.id = selected.option_price_id
    where (pinned.price, pinned.is_not_applicable)
        is distinct from (open_price.price, open_price.is_not_applicable)
    order by selected.lot_id, selected.option_id
    for update of selected
  loop
    update valtrim.lot_options
    set option_price_id = v_row.new_id
    where lot_id = v_row.lot_id and option_id = v_row.option_id;

    insert into valtrim.phase_price_recalculation_lines (
      recalculation_id, lot_id, phase_id, phase_code, building, lot_number,
      plan_id, plan_code, option_id, option_code,
      previous_option_price_id, new_option_price_id, previous_amount, new_amount
    ) values (
      v_recalculation_id, v_row.lot_id, v_row.phase_id, v_row.phase_code,
      v_row.building, v_row.lot_number, v_row.plan_id, v_row.plan_code,
      v_row.option_id, v_row.option_code,
      v_row.previous_id, v_row.new_id, v_row.previous_price, v_row.new_price
    );
    v_moved_option_lot_ids := v_moved_option_lot_ids || v_row.lot_id;
    v_moved_option_ids := v_moved_option_ids || v_row.option_id;
    v_option_count := v_option_count + 1;
  end loop;

  -- Anything asked for that could not move means the list on screen is out of date
  -- (a price changed meanwhile): change nothing.
  if v_lot_count <> cardinality(v_lot_ids)
     or v_option_count <> jsonb_array_length(v_options) then
    raise exception 'Prices or Packages changed since this list was loaded. Reload it and try again'
      using errcode = '40001';
  end if;

  v_package_ids := array(
    select distinct affected.package_id
    from (
      select line.package_id
      from valtrim.package_draws line
      where line.lot_id = any (v_moved_lot_ids)
      union
      select line.package_id
      from valtrim.package_hardware_lines line
      where line.lot_id = any (v_moved_lot_ids)
      union
      select billed.package_id
      from valtrim.package_options billed
      join unnest(v_moved_option_lot_ids, v_moved_option_ids)
        as moved(lot_id, option_id)
        on moved.lot_id = billed.lot_id and moved.option_id = billed.option_id
    ) affected
    order by affected.package_id
  );
  v_draft_ids := array(
    select affected.package_id
    from unnest(v_package_ids) as affected(package_id)
    where private.draw_package_can_be_recalculated(affected.package_id)
    order by affected.package_id
  );
  v_issued_ids := array(
    select affected.package_id
    from unnest(v_package_ids) as affected(package_id)
    where not private.draw_package_can_be_recalculated(affected.package_id)
    order by affected.package_id
  );

  -- Draft Packages are calculated again with the new prices.
  foreach v_package_id in array v_draft_ids
  loop
    v_package := private.recalculate_draft_package(
      v_package_id, v_reason, coalesce(p_remove_documents, false)
    );

    insert into valtrim.phase_price_recalculation_packages (
      recalculation_id, package_id, package_number,
      gross_before, gross_after, net_before, net_after, documents_removed
    ) values (
      v_recalculation_id, v_package_id, v_package ->> 'package_number',
      (v_package ->> 'gross_before')::numeric, (v_package ->> 'gross_after')::numeric,
      (v_package ->> 'net_before')::numeric, (v_package ->> 'net_after')::numeric,
      (v_package ->> 'documents_removed')::integer
    );

    v_packages := v_packages || jsonb_build_array(
      v_package - 'removed_storage_paths'
    );
    v_paths := v_paths || (v_package -> 'removed_storage_paths');
  end loop;

  -- A Draft Package now bills the new price: nothing is owed on it any more.
  delete from valtrim.package_price_differences
  where package_id = any (v_draft_ids) and status = 'PENDING';

  -- Packages that cannot change keep their amount; the difference is recorded.
  v_differences := private.record_package_price_differences(
    v_recalculation_id, v_issued_ids
  );

  update valtrim.phase_price_recalculations
  set lot_count = v_lot_count,
      option_count = v_option_count
  where id = v_recalculation_id;

  return jsonb_build_object(
    'recalculation_id', v_recalculation_id,
    'lots', v_lot_count,
    'options', v_option_count,
    'packages', v_packages,
    'differences', v_differences,
    'removed_storage_paths', v_paths
  );
end;
$$;

commit;
