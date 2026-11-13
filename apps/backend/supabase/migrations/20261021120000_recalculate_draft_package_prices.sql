-- Updating the price of a Phase also recalculates its Draft Packages.
--
-- A Package line is a snapshot of the price it was created with. A Package that is
-- still a Draft (no QuickBooks invoice, not sent, not paid, not released as
-- retention) may be rebuilt: its Lots, Draws, Options and Separate Hardware stay
-- exactly as they were, and are calculated again with the prices the Lots point
-- at now. The Package keeps its number and does not need a new Preliminary
-- Notice, because it is not a new Package.
--
-- A generated Release or Payment Schedule would no longer match, so it is removed
-- in the same transaction (the caller must say so) and has to be generated again.
-- Packages that already have a QuickBooks invoice, were sent or are paid are never
-- touched: their Lots and Options stay out of the update.

begin;

alter table valtrim.draw_package_corrections
  drop constraint draw_package_corrections_action_check,
  add constraint draw_package_corrections_action_check
    check (action in ('EDIT', 'TRANSFER', 'CANCEL', 'RECALCULATE'));

-- One line per Package recalculated by a Phase price update.
create table valtrim.phase_price_recalculation_packages (
  id bigint generated always as identity primary key,
  recalculation_id bigint not null
    references valtrim.phase_price_recalculations(id) on delete cascade,
  package_id bigint not null references valtrim.draw_packages(id) on delete restrict,
  package_number text not null,
  gross_before numeric(14,2) not null,
  gross_after numeric(14,2) not null,
  net_before numeric(14,2) not null,
  net_after numeric(14,2) not null,
  documents_removed integer not null default 0 check (documents_removed >= 0)
);

create index phase_price_recalculation_packages_recalculation_idx
  on valtrim.phase_price_recalculation_packages (recalculation_id);
create index phase_price_recalculation_packages_package_idx
  on valtrim.phase_price_recalculation_packages (package_id);

alter table valtrim.phase_price_recalculation_packages enable row level security;
revoke all on table valtrim.phase_price_recalculation_packages from public, anon, authenticated;
revoke all on sequence valtrim.phase_price_recalculation_packages_id_seq
  from public, anon, authenticated;
grant select (
  id, recalculation_id, package_id, package_number,
  gross_before, gross_after, net_before, net_after, documents_removed
) on valtrim.phase_price_recalculation_packages to authenticated;
create policy phase_price_recalculation_packages_select
on valtrim.phase_price_recalculation_packages for select to authenticated
using ((select private.is_active_user()));

-- Which Packages can be rebuilt ------------------------------------------------

-- A Draft Package that nothing outside the app depends on. A generated Release or
-- Payment Schedule does not stop it (those are removed when it is rebuilt); an
-- invoice PDF or any other document does.
create function private.draw_package_can_be_recalculated(p_package_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from valtrim.draw_packages package
    join valtrim.invoices invoice on invoice.package_id = package.id
    where package.id = p_package_id
      and package.package_type = 'DRAW'
      and package.status = 'DRAFT'
      and package.workflow_status in ('DRAFT', 'READY_TO_SUBMIT')
      and (
        (package.quickbooks_status = 'NOT_CREATED' and package.quickbooks_reference is null)
        or package.quickbooks_status = 'VOIDED'
      )
      and package.submission_status = 'NOT_SUBMITTED'
      and package.submitted_at is null
      and invoice.status = 'DRAFT'
      and invoice.invoice_number is null
      and invoice.invoice_date is null
      and invoice.paid_amount = 0
      and not exists (
        select 1 from valtrim.invoice_payments payment where payment.invoice_id = invoice.id
      )
      and not exists (
        select 1
        from valtrim.retention_release_lines allocated
        join valtrim.draw_packages release_package
          on release_package.id = allocated.package_id and release_package.status <> 'VOIDED'
        where allocated.source_package_id = package.id
      )
      and not exists (
        select 1
        from valtrim.retention_release_hardware_lines allocated
        join valtrim.draw_packages release_package
          on release_package.id = allocated.package_id and release_package.status <> 'VOIDED'
        where allocated.source_package_id = package.id
      )
      and not exists (
        select 1
        from valtrim.package_documents document
        where document.package_id = package.id
          and (document.file_id is not null or document.status in ('COMPLETE', 'WAIVED'))
          and not (
            document.document_type in ('RELEASE', 'PAYMENT_SCHEDULE')
            and document.file_id is not null
          )
      )
  )
$$;

-- The Packages that bill a Lot (Plan price) and a Lot Option, for the preview.
create function private.lot_billing_packages(p_lot_id bigint)
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

create function private.lot_option_billing_packages(p_lot_id bigint, p_option_id bigint)
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

revoke all on function private.draw_package_can_be_recalculated(bigint)
  from public, anon, authenticated;
revoke all on function private.lot_billing_packages(bigint)
  from public, anon, authenticated;
revoke all on function private.lot_option_billing_packages(bigint, bigint)
  from public, anon, authenticated;

-- Rebuilding one Draft Package ---------------------------------------------------

create function private.recalculate_draft_package(
  p_package_id bigint,
  p_reason text,
  p_remove_documents boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_package valtrim.draw_packages%rowtype;
  v_cells jsonb;
  v_hardware jsonb;
  v_cell record;
  v_document record;
  v_removed jsonb;
  v_paths jsonb := '[]'::jsonb;
  v_removed_count integer := 0;
  v_gross_before numeric(14,2);
  v_net_before numeric(14,2);
  v_gross_after numeric(14,2);
  v_net_after numeric(14,2);
  v_inserted integer;
  v_expected integer;
begin
  select package.*
  into v_package
  from valtrim.draw_packages package
  where package.id = p_package_id
  for update;

  if v_package.id is null
     or not private.draw_package_can_be_recalculated(p_package_id) then
    raise exception 'Only an unissued, unsynced draft Package can be recalculated'
      using errcode = '23514';
  end if;

  select invoice.gross_amount, invoice.net_amount
  into v_gross_before, v_net_before
  from valtrim.invoices invoice
  where invoice.package_id = p_package_id;

  -- Everything needed to build the Package again, read before anything is deleted.
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'lot_id', line.lot_id,
      'draw_id', line.draw_id,
      'draw_number', line.draw_number,
      'charge_hardware', (line.hardware_percentage > 0 or line.hardware_amount > 0),
      'options', coalesce((
        select jsonb_agg(
          jsonb_build_object('lot_id', billed.lot_id, 'option_id', billed.option_id)
          order by billed.lot_id, billed.option_id
        )
        from valtrim.package_options billed
        where billed.package_id = line.package_id
          and billed.billing_lot_id = line.lot_id
          and billed.draw_id = line.draw_id
      ), '[]'::jsonb)
    ) order by phase.code, line.draw_number, lot.lot_number
  ), '[]'::jsonb)
  into v_cells
  from valtrim.package_draws line
  join valtrim.lots lot on lot.id = line.lot_id
  join valtrim.phases phase on phase.id = lot.phase_id
  where line.package_id = p_package_id;

  select coalesce(jsonb_agg(
    jsonb_build_object('lot_id', line.lot_id, 'event_type', line.hardware_event_type)
    order by line.id
  ), '[]'::jsonb)
  into v_hardware
  from valtrim.package_hardware_lines line
  where line.package_id = p_package_id;

  v_expected := jsonb_array_length(v_cells);
  if v_expected = 0 and jsonb_array_length(v_hardware) = 0 then
    raise exception 'The Package has nothing to recalculate' using errcode = '23514';
  end if;

  -- Hardware billed by this Package needs a hardware price in the Plan price.
  if exists (
    select 1
    from jsonb_to_recordset(v_cells) as cell(lot_id bigint, charge_hardware boolean)
    join valtrim.lots lot on lot.id = cell.lot_id
    join valtrim.plan_prices price on price.id = lot.plan_price_id
    where coalesce(cell.charge_hardware, false) and price.hardware_price is null
  ) or exists (
    select 1
    from jsonb_to_recordset(v_hardware) as line(lot_id bigint)
    join valtrim.lots lot on lot.id = line.lot_id
    join valtrim.plan_prices price on price.id = lot.plan_price_id
    where price.hardware_price is null
  ) then
    raise exception 'This Package bills Separate Hardware but the new Plan price has no hardware price'
      using errcode = '23514';
  end if;

  -- A generated Release or Payment Schedule would no longer match the amounts.
  if exists (
    select 1 from valtrim.package_documents document
    where document.package_id = p_package_id
      and document.file_id is not null
      and document.document_type in ('RELEASE', 'PAYMENT_SCHEDULE')
  ) then
    if not coalesce(p_remove_documents, false) then
      raise exception 'This Package has a generated Release or Payment Schedule that must be removed to recalculate it'
        using errcode = 'P0003';
    end if;

    for v_document in
      select document.id, document.document_type
      from valtrim.package_documents document
      where document.package_id = p_package_id
        and document.file_id is not null
        and document.document_type in ('RELEASE', 'PAYMENT_SCHEDULE')
      order by document.id
    loop
      if v_document.document_type = 'RELEASE' then
        v_removed := private.delete_package_release(v_document.id);
      else
        v_removed := private.delete_package_payment_schedule(v_document.id);
      end if;
      if v_removed ->> 'removed_storage_path' is not null then
        v_paths := v_paths || to_jsonb(v_removed ->> 'removed_storage_path');
      end if;
      v_removed_count := v_removed_count + 1;
    end loop;
  end if;

  perform set_config('valtrim.draw_package_correction', 'on', true);

  delete from valtrim.package_options where package_id = p_package_id;
  delete from valtrim.package_hardware_lines where package_id = p_package_id;
  delete from valtrim.package_draws where package_id = p_package_id;

  -- Each cell goes back in with its own Option and hardware selection, so the
  -- calculation sees exactly what it saw when the Package was created.
  for v_cell in
    select
      (item.value ->> 'lot_id')::bigint as lot_id,
      (item.value ->> 'draw_id')::bigint as draw_id,
      (item.value ->> 'draw_number')::smallint as draw_number,
      coalesce((item.value ->> 'charge_hardware')::boolean, false) as charge_hardware,
      item.value -> 'options' as options
    from jsonb_array_elements(v_cells) with ordinality as item(value, position)
    order by item.position
  loop
    perform set_config(
      'valtrim.draw_package_option_charge',
      jsonb_build_object(
        'anchor_lot_id', v_cell.lot_id,
        'anchor_draw_number', v_cell.draw_number,
        'package_options', v_cell.options
      )::text,
      true
    );
    perform set_config(
      'valtrim.draw_package_hardware_charge',
      jsonb_build_array(jsonb_build_object(
        'lot_id', v_cell.lot_id,
        'draw_number', v_cell.draw_number,
        'charge_hardware', coalesce(v_cell.charge_hardware, false)
      ))::text,
      true
    );

    insert into valtrim.package_draws (package_id, lot_id, draw_id)
    values (p_package_id, v_cell.lot_id, v_cell.draw_id);
  end loop;

  perform set_config('valtrim.draw_package_option_charge', '', true);
  perform set_config('valtrim.draw_package_hardware_charge', '', true);

  select count(*) into v_inserted
  from valtrim.package_draws line where line.package_id = p_package_id;
  if v_inserted <> v_expected then
    raise exception 'The Package did not generate every Lot / Draw cell again'
      using errcode = '23514';
  end if;

  if jsonb_array_length(v_hardware) > 0 then
    insert into valtrim.package_hardware_lines (
      package_id, lot_id, hardware_event_type, job_id, phase_id, builder_id,
      setup_version_id, plan_id, plan_price_id, lot_number, phase_code,
      plan_code, plan_name, is_reverse, hardware_price, hardware_percentage,
      hardware_amount, gross_amount, net_amount
    )
    select
      p_package_id,
      lot.id,
      (item.value ->> 'event_type')::valtrim.production_stage_type,
      v_package.job_id,
      lot.phase_id,
      v_package.builder_id,
      v_package.setup_version_id,
      lot.plan_id,
      price.id,
      lot.lot_number,
      phase.code,
      plan.code,
      plan.name,
      lot.is_reverse,
      price.hardware_price,
      1,
      0,
      0,
      0
    from jsonb_array_elements(v_hardware) with ordinality as item(value, position)
    join valtrim.lots lot on lot.id = (item.value ->> 'lot_id')::bigint
    join valtrim.phases phase on phase.id = lot.phase_id
    join valtrim.plans plan on plan.id = lot.plan_id
    join valtrim.plan_prices price on price.id = lot.plan_price_id
    order by item.position;

    get diagnostics v_inserted = row_count;
    if v_inserted <> jsonb_array_length(v_hardware) then
      raise exception 'The Package did not generate every Separate Hardware line again'
        using errcode = '23514';
    end if;
  end if;

  select invoice.gross_amount, invoice.net_amount
  into v_gross_after, v_net_after
  from valtrim.invoices invoice
  where invoice.package_id = p_package_id;

  insert into valtrim.draw_package_corrections (
    package_id, action, removed_cells, added_cells,
    previous_details, next_details, reason, changed_by
  ) values (
    p_package_id, 'RECALCULATE', '[]'::jsonb, '[]'::jsonb,
    jsonb_build_object('gross_amount', v_gross_before, 'net_amount', v_net_before),
    jsonb_build_object('gross_amount', v_gross_after, 'net_amount', v_net_after),
    p_reason, v_actor_id
  );

  perform set_config('valtrim.draw_package_correction', 'off', true);

  return jsonb_build_object(
    'package_id', p_package_id,
    'package_number', v_package.package_number,
    'gross_before', v_gross_before,
    'gross_after', v_gross_after,
    'net_before', v_net_before,
    'net_after', v_net_after,
    'documents_removed', v_removed_count,
    'removed_storage_paths', v_paths
  );
end;
$$;

revoke all on function private.recalculate_draft_package(bigint, text, boolean)
  from public, anon, authenticated;

-- What can change, and where it is billed ---------------------------------------
-- Each Plan / Option change now says which Packages bill it and whether every one
-- of them can be recalculated; only a change billed in no Package, or only in
-- Draft Packages that can be rebuilt, may be applied.

create or replace function valtrim.preview_phase_price_changes(
  p_job_id bigint,
  p_plan_id bigint default null,
  p_option_id bigint default null,
  p_components text default 'ALL'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if (select auth.uid()) is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to update Phase prices'
      using errcode = '42501';
  end if;
  if p_components is null or p_components not in ('ALL', 'PLAN', 'OPTIONS') then
    raise exception 'Choose what to compare: the Plan price, the Options or both'
      using errcode = '23514';
  end if;

  perform 1 from valtrim.jobs job where job.id = p_job_id and job.is_active;
  if not found then
    raise exception 'Select an active Job' using errcode = '23503';
  end if;

  with lot_plan as (
    select
      lot.id as lot_id,
      jsonb_build_object(
        'billed', jsonb_array_length(billing.packages) > 0,
        'locked', exists (
          select 1 from jsonb_array_elements(billing.packages) billed_package
          where not (billed_package ->> 'recalculable')::boolean
        ),
        'packages', billing.packages,
        'from_price_id', lot.plan_price_id,
        'to_price_id', open_price.id,
        'from_base', pinned.base_price,
        'from_hardware', pinned.hardware_price,
        'to_base', open_price.base_price,
        'to_hardware', open_price.hardware_price
      ) as change
    from valtrim.lots lot
    join valtrim.phases phase
      on phase.id = lot.phase_id and phase.job_id = p_job_id and phase.is_active
    join valtrim.plan_prices open_price
      on open_price.plan_id = lot.plan_id and open_price.effective_to is null
    left join valtrim.plan_prices pinned on pinned.id = lot.plan_price_id
    cross join lateral (
      select private.lot_billing_packages(lot.id) as packages
    ) billing
    where p_components in ('ALL', 'PLAN')
      and p_option_id is null
      and (p_plan_id is null or lot.plan_id = p_plan_id)
      and (pinned.base_price, pinned.hardware_price)
        is distinct from (open_price.base_price, open_price.hardware_price)
  ),
  lot_option as (
    select
      selected.lot_id,
      jsonb_build_object(
        'option_id', selected.option_id,
        'code', option.code,
        'description', coalesce(option.description, option.name),
        'billed', jsonb_array_length(billing.packages) > 0,
        'locked', exists (
          select 1 from jsonb_array_elements(billing.packages) billed_package
          where not (billed_package ->> 'recalculable')::boolean
        ),
        'packages', billing.packages,
        'from_price_id', selected.option_price_id,
        'to_price_id', open_price.id,
        'from_price', pinned.price,
        'from_na', coalesce(pinned.is_not_applicable, false),
        'to_price', open_price.price,
        'to_na', open_price.is_not_applicable
      ) as change
    from valtrim.lot_options selected
    join valtrim.lots lot on lot.id = selected.lot_id
    join valtrim.phases phase
      on phase.id = lot.phase_id and phase.job_id = p_job_id and phase.is_active
    join valtrim.plan_options option on option.id = selected.option_id
    join valtrim.option_prices open_price
      on open_price.option_id = selected.option_id and open_price.effective_to is null
    left join valtrim.option_prices pinned on pinned.id = selected.option_price_id
    cross join lateral (
      select private.lot_option_billing_packages(selected.lot_id, selected.option_id) as packages
    ) billing
    where p_components in ('ALL', 'OPTIONS')
      and (p_option_id is null or selected.option_id = p_option_id)
      and (p_plan_id is null or lot.plan_id = p_plan_id)
      and (pinned.price, pinned.is_not_applicable)
        is distinct from (open_price.price, open_price.is_not_applicable)
  ),
  changed_lot as (
    select lot_id from lot_plan
    union
    select lot_id from lot_option
  )
  select coalesce(jsonb_agg(phase_row.row_json order by phase_row.phase_id), '[]'::jsonb)
  into v_result
  from (
    select
      phase.id as phase_id,
      jsonb_build_object(
        'phase_id', phase.id,
        'code', phase.code,
        'building', phase.building,
        'lots', (
          select jsonb_agg(
            jsonb_build_object(
              'lot_id', lot.id,
              'lot_number', lot.lot_number,
              'utility_name', lot.utility_name,
              'is_utility_building', lot.is_utility_building,
              'plan_id', lot.plan_id,
              'plan_code', plan.code,
              'plan_change', (select lp.change from lot_plan lp where lp.lot_id = lot.id),
              'option_changes', coalesce((
                select jsonb_agg(
                  lo.change order by (lo.change ->> 'option_id')::bigint
                )
                from lot_option lo
                where lo.lot_id = lot.id
              ), '[]'::jsonb)
            )
            order by lot.display_order, lot.id
          )
          from valtrim.lots lot
          join valtrim.plans plan on plan.id = lot.plan_id
          where lot.phase_id = phase.id
            and lot.id in (select changed.lot_id from changed_lot changed)
        )
      ) as row_json
    from valtrim.phases phase
    where phase.job_id = p_job_id
      and phase.is_active
      and exists (
        select 1
        from valtrim.lots lot
        where lot.phase_id = phase.id
          and lot.id in (select changed.lot_id from changed_lot changed)
      )
  ) phase_row;

  return v_result;
end;
$$;

-- Move chosen Lots / Options to today's price ------------------------------------
-- Now also recalculates the Draft Packages that bill them. The old signature goes
-- away so the new one (with the documents choice) is the only entry point.

drop function valtrim.apply_phase_price_changes(bigint, bigint[], jsonb, text);

create function valtrim.apply_phase_price_changes(
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
  v_package_id bigint;
  v_package jsonb;
  v_packages jsonb := '[]'::jsonb;
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
      and not exists (
        select 1
        from (
          select line.package_id from valtrim.package_draws line where line.lot_id = lot.id
          union
          select line.package_id from valtrim.package_hardware_lines line
          where line.lot_id = lot.id
        ) billed
        where not private.draw_package_can_be_recalculated(billed.package_id)
      )
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
      and not exists (
        select 1
        from valtrim.package_options billed
        where billed.lot_id = selected.lot_id
          and billed.option_id = selected.option_id
          and not private.draw_package_can_be_recalculated(billed.package_id)
      )
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

  -- Anything asked for that could not move means the list on screen is out of
  -- date (a price changed, or a Package was sent meanwhile): change nothing.
  if v_lot_count <> cardinality(v_lot_ids)
     or v_option_count <> jsonb_array_length(v_options) then
    raise exception 'Prices or Packages changed since this list was loaded. Reload it and try again'
      using errcode = '40001';
  end if;

  -- The Draft Packages that bill what just moved are calculated again.
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

  foreach v_package_id in array v_package_ids
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

  update valtrim.phase_price_recalculations
  set lot_count = v_lot_count,
      option_count = v_option_count
  where id = v_recalculation_id;

  return jsonb_build_object(
    'recalculation_id', v_recalculation_id,
    'lots', v_lot_count,
    'options', v_option_count,
    'packages', v_packages,
    'removed_storage_paths', v_paths
  );
end;
$$;

revoke all on function valtrim.apply_phase_price_changes(bigint, bigint[], jsonb, text, boolean)
  from public, anon;
grant execute on function valtrim.apply_phase_price_changes(bigint, bigint[], jsonb, text, boolean)
  to authenticated;

commit;
