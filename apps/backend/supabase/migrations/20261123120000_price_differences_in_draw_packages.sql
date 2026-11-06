-- Price differences carried by a Draw Package.
--
-- A Package that was already invoiced keeps the amount it billed, and a later price change is
-- recorded as a pending price difference (package_price_differences). Until now a pending
-- difference could only be collected by a Price Adjustment Package of its own. When the Job has a
-- new Package to create, the differences of its Phases can ride on that Draw Package instead:
--
--   * Each difference the person picks becomes one line of the Package (price_adjustment_lines,
--     the same lines a Price Adjustment keeps), so the invoice shows a row for every change.
--   * The difference is marked COLLECTED, so it is never invoiced twice, and it is given back
--     (pending again) if the Package is cancelled.
--   * Only differences of a Phase the Package bills can be carried, so a Package that is one
--     invoice per Phase never mixes the price changes of another Phase into it.
--   * The invoice is the sum of the Draw and Hardware lines and of the difference lines, with
--     Retention and WRAP like any Package. Credits are allowed, but the invoice cannot end up
--     negative or empty, and its Retention and WRAP cannot go negative either.
--   * The Retention a difference withheld is released with the rest by the Retention Release.
--   * A Package that carries differences cannot be edited or transferred: the amounts it
--     collected were worked out against the cells it was made of. It can be cancelled.
--
-- Nothing changes for Packages that carry no difference, nor for a Price Adjustment Package.

begin;

-- Lines belong to any Package -----------------------------------------------------------------

alter table valtrim.price_adjustment_lines
  drop constraint price_adjustment_lines_package_id_fkey,
  add constraint price_adjustment_lines_package_id_fkey
    foreign key (package_id) references valtrim.draw_packages(id) on delete restrict;

comment on table valtrim.price_adjustment_lines is
  'Immutable lines of a Package that collected price differences, one per collected difference: every line of a Price Adjustment Package, or the ones a Draw Package carries.';

-- The invoice of a Package adds its difference lines ------------------------------------------

-- Totals are always worked out from the lines, so the value left after the last line is the right
-- one; while a Package is being rebuilt a partial sum can dip below zero, which the amount type
-- does not accept, so each part is kept at zero or above. A cancelled Package invoices nothing.
create function private.recalculate_package_invoice_totals(p_package_id bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update valtrim.invoices invoice
  set gross_amount = greatest(totals.gross_amount, 0)::valtrim.amount,
      retention_amount = greatest(totals.retention_amount, 0)::valtrim.amount,
      wrap_amount = greatest(totals.wrap_amount, 0)::valtrim.amount,
      net_amount = greatest(totals.net_amount, 0)::valtrim.amount,
      updated_at = now()
  from (
    select
      coalesce(sum(line.gross_amount), 0) as gross_amount,
      coalesce(sum(line.retention_amount), 0) as retention_amount,
      coalesce(sum(line.wrap_amount), 0) as wrap_amount,
      coalesce(sum(line.net_amount), 0) as net_amount
    from (
      select gross_amount, retention_amount, wrap_amount, net_amount
      from valtrim.package_draws
      where package_id = p_package_id
      union all
      select gross_amount, retention_amount, wrap_amount, net_amount
      from valtrim.package_hardware_lines
      where package_id = p_package_id
      union all
      select difference.gross, difference.retention, difference.wrap, difference.net
      from valtrim.price_adjustment_lines difference
      join valtrim.draw_packages package
        on package.id = difference.package_id
       and package.package_type = 'DRAW'
       and package.status <> 'VOIDED'
      where difference.package_id = p_package_id
    ) line
  ) totals
  where invoice.package_id = p_package_id;
$$;

revoke execute on function private.recalculate_package_invoice_totals(bigint)
  from public, anon, authenticated;

create or replace function valtrim.recalculate_invoice_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.recalculate_package_invoice_totals(
    case when tg_op = 'DELETE' then old.package_id else new.package_id end
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Cancelling a Package empties its Draw lines; what its difference lines add stops counting too.
create function private.empty_invoice_of_voided_package_with_differences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.package_type = 'DRAW'
     and new.status = 'VOIDED'
     and old.status is distinct from 'VOIDED'
     and exists (
       select 1 from valtrim.price_adjustment_lines line where line.package_id = new.id
     ) then
    perform private.recalculate_package_invoice_totals(new.id);
  end if;
  return new;
end;
$$;

create trigger draw_packages_empty_invoice_with_differences
  after update of status on valtrim.draw_packages
  for each row execute function private.empty_invoice_of_voided_package_with_differences();

revoke execute on function private.empty_invoice_of_voided_package_with_differences()
  from public, anon, authenticated;

-- Giving the differences back when the Package that collected them is cancelled -------------

create or replace function private.release_differences_of_voided_adjustment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sources bigint[];
  v_recalculation_id bigint;
begin
  if new.status = 'VOIDED' and old.status is distinct from 'VOIDED' then
    select array_agg(distinct difference.package_id), max(difference.recalculation_id)
    into v_sources, v_recalculation_id
    from valtrim.package_price_differences difference
    where difference.adjustment_package_id = new.id
      and difference.status = 'COLLECTED';

    update valtrim.package_price_differences
    set status = 'DISMISSED'
    where adjustment_package_id = new.id
      and status = 'COLLECTED';

    -- What those Packages are owed is worked out again, now that it is not collected.
    if v_sources is not null then
      perform private.record_package_price_differences(
        v_recalculation_id, v_sources, new.created_by
      );
    end if;
  end if;
  return new;
end;
$$;

-- Function patching ----------------------------------------------------------------------------
-- Functions are rewritten from their live definition, and the patch aborts when the text it
-- expects is not there.

create function pg_temp.patch_function(
  p_signature regprocedure,
  p_old text,
  p_new text,
  p_expected_count integer default 1
)
returns void
language plpgsql
as $$
declare
  v_definition text := pg_catalog.pg_get_functiondef(p_signature);
  v_count integer;
begin
  v_count := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, p_old, '')))
    / pg_catalog.length(p_old);
  if v_count <> p_expected_count then
    raise exception 'Cannot patch %: expected % occurrence(s) of the old text, found %',
      p_signature, p_expected_count, v_count;
  end if;
  execute pg_catalog.replace(v_definition, p_old, p_new);
end;
$$;

-- A Draw Package cannot go back to Draft while a Retention Release holds what its differences
-- retained.
select pg_temp.patch_function(
  'valtrim.validate_package_workflow_status_change()'::regprocedure,
$old$
  if new.package_type = 'PRICE_ADJUSTMENT'
     and new.workflow_status = 'DRAFT'
$old$,
$new$
  if new.package_type in ('DRAW', 'PRICE_ADJUSTMENT')
     and new.workflow_status = 'DRAFT'
$new$
);

-- The Retention Release takes what the differences of a Draw Package retained, like those of a
-- Price Adjustment.
select pg_temp.patch_function(
  'private.create_retention_release_package(bigint, bigint, text)'::regprocedure,
  $$package.package_type = 'PRICE_ADJUSTMENT'$$,
  $$package.package_type in ('DRAW', 'PRICE_ADJUSTMENT')$$,
  2
);

-- A Package that collected differences is cancelled, not edited or transferred.
select pg_temp.patch_function(
  'private.correct_draw_invoice_package(text, bigint, bigint, jsonb, text, text)'::regprocedure,
$old$
  if p_action = 'TRANSFER' then
    if p_other_package_id is null or p_other_package_id = p_package_id then
$old$,
$new$
  if p_action in ('EDIT', 'TRANSFER')
     and exists (
       select 1
       from valtrim.price_adjustment_lines carried
       where carried.package_id = p_package_id
          or (p_action = 'TRANSFER' and carried.package_id = p_other_package_id)
     ) then
    raise exception 'A Package that collected price differences cannot be edited or transferred. Cancel it and create it again'
      using errcode = '23514';
  end if;

  if p_action = 'TRANSFER' then
    if p_other_package_id is null or p_other_package_id = p_package_id then
$new$
);

-- Creating a Draw Package with price differences ---------------------------------------------

create function private.create_draw_package_with_price_differences(
  p_job_id bigint,
  p_selections jsonb default '[]'::jsonb,
  p_hardware_selections jsonb default '[]'::jsonb,
  p_package_date date default current_date,
  p_notes text default null,
  p_difference_ids bigint[] default '{}'::bigint[]
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids bigint[];
  v_package_id bigint;
  v_found integer;
  v_updated integer;
  v_invoice record;
  v_carried record;
begin
  v_ids := array(
    select distinct selected.difference_id
    from unnest(coalesce(p_difference_ids, '{}'::bigint[])) as selected(difference_id)
    where selected.difference_id is not null
  );
  if cardinality(v_ids) > 500 then
    raise exception 'Select 500 price differences or fewer at a time' using errcode = '23514';
  end if;

  -- Permissions, the Job lock and every other rule of a Draw Package are the creation's own.
  v_package_id := private.create_draw_invoice_package_with_hardware_events(
    p_job_id, p_selections, p_hardware_selections, p_package_date, p_notes
  );

  if cardinality(v_ids) = 0 then
    return v_package_id;
  end if;

  -- Same order as the Price Adjustment: the Job (taken above), its Packages, then the differences.
  perform 1
  from valtrim.draw_packages package
  where package.job_id = p_job_id
  order by package.id
  for update;

  perform 1
  from valtrim.package_price_differences difference
  where difference.id = any (v_ids)
  order by difference.id
  for update;

  select count(*)
  into v_found
  from valtrim.package_price_differences difference
  where difference.id = any (v_ids)
    and difference.job_id = p_job_id
    and difference.status = 'PENDING'
    and difference.phase_id in (
      select line.phase_id from valtrim.package_draws line where line.package_id = v_package_id
      union
      select line.phase_id from valtrim.package_hardware_lines line where line.package_id = v_package_id
    );

  if v_found <> cardinality(v_ids) then
    raise exception 'Every price difference must be pending and belong to a Phase this Package bills. Reload the list and try again'
      using errcode = '23514';
  end if;

  insert into valtrim.price_adjustment_lines (
    package_id, difference_id, source_package_id, source_package_number,
    line_kind, lot_id, draw_id, hardware_event_type, draw_number,
    phase_id, phase_code, building, lot_number, plan_code,
    delta_base, delta_hardware, delta_utility, delta_options,
    gross, retention, wrap, net
  )
  select
    v_package_id, difference.id, difference.package_id, difference.package_number,
    difference.line_kind, difference.lot_id, difference.draw_id,
    difference.hardware_event_type, difference.draw_number,
    difference.phase_id, difference.phase_code, difference.building,
    difference.lot_number, difference.plan_code,
    difference.delta_base, difference.delta_hardware, difference.delta_utility,
    difference.delta_options,
    difference.delta_gross, difference.delta_retention, difference.delta_wrap,
    difference.delta_net
  from valtrim.package_price_differences difference
  where difference.id = any (v_ids)
  order by difference.package_id, difference.id;

  update valtrim.package_price_differences
  set status = 'COLLECTED',
      adjustment_package_id = v_package_id
  where id = any (v_ids)
    and status = 'PENDING';
  get diagnostics v_updated = row_count;

  if v_updated <> cardinality(v_ids) then
    raise exception 'The Package did not collect every selected price difference'
      using errcode = '23514';
  end if;

  select invoice.gross_amount, invoice.retention_amount, invoice.wrap_amount, invoice.net_amount
  into v_invoice
  from valtrim.invoices invoice
  where invoice.package_id = v_package_id;

  select
    coalesce(sum(line.gross), 0) as gross,
    coalesce(sum(line.retention), 0) as retention,
    coalesce(sum(line.wrap), 0) as wrap,
    coalesce(sum(line.net), 0) as net
  into v_carried
  from valtrim.price_adjustment_lines line
  where line.package_id = v_package_id;

  -- The invoice shows Retention and WRAP as negative lines, so each must stay a positive amount,
  -- and credits can only reduce what the Package bills.
  if v_invoice.gross_amount + v_carried.gross < 0
     or v_invoice.retention_amount + v_carried.retention < 0
     or v_invoice.wrap_amount + v_carried.wrap < 0
     or v_invoice.net_amount + v_carried.net <= 0 then
    raise exception 'The selected price differences are credits larger than what the Package bills, so it would invoice nothing'
      using errcode = '23514';
  end if;

  perform private.recalculate_package_invoice_totals(v_package_id);

  return v_package_id;
end;
$$;

create function valtrim.create_draw_package_with_price_differences(
  p_job_id bigint,
  p_selections jsonb default '[]'::jsonb,
  p_hardware_selections jsonb default '[]'::jsonb,
  p_package_date date default current_date,
  p_notes text default null,
  p_difference_ids bigint[] default '{}'::bigint[]
)
returns bigint
language sql
set search_path = ''
as $$
  select private.create_draw_package_with_price_differences(
    p_job_id,
    p_selections,
    p_hardware_selections,
    p_package_date,
    p_notes,
    p_difference_ids
  );
$$;

revoke execute on function private.create_draw_package_with_price_differences(
  bigint, jsonb, jsonb, date, text, bigint[]
) from public, anon, authenticated;
revoke execute on function valtrim.create_draw_package_with_price_differences(
  bigint, jsonb, jsonb, date, text, bigint[]
) from public, anon, authenticated;
grant execute on function private.create_draw_package_with_price_differences(
  bigint, jsonb, jsonb, date, text, bigint[]
) to authenticated, service_role;
grant execute on function valtrim.create_draw_package_with_price_differences(
  bigint, jsonb, jsonb, date, text, bigint[]
) to authenticated, service_role;

comment on function valtrim.create_draw_package_with_price_differences(
  bigint, jsonb, jsonb, date, text, bigint[]
) is
  'Creates a Draw Package like create_draw_invoice_package_with_hardware_events and, when p_difference_ids is not empty, carries those pending price differences on it as one invoice row each.';

notify pgrst, 'reload schema';

commit;
