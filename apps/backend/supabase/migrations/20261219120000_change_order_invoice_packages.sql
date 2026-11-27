-- Extra / Change Orders are invoiced in QuickBooks through a Package of their own.
--
-- An approved Change Order is invoiced as a Package of type CHANGE_ORDER ("CP-" numbers): the Package
-- carries the invoice totals (the total of the CO, no Retention, no WRAP) and points at the Change Order,
-- whose lines are the lines of the invoice. Being a Package, it is sent to QuickBooks, shows in A/R, gets
-- its payments, its PDF, its void and its invoice number the same way as every other Package.
--
--   draw_packages.change_order_id        the Change Order a CHANGE_ORDER Package invoices
--   create_change_order_package          Admin, Accounting and Draw & Invoice; an approved CO whose total
--                                        is more than zero, one standing Package per CO (voiding it lets
--                                        the CO be invoiced again)
--   change_order_overview                three more columns at the end: its standing invoice Package
--
-- A Change Order with a standing invoice Package cannot be cancelled. One made from a Package that is
-- invoiced is closed: a Lot leaving its source Package no longer takes it off, and Lots added later go on
-- another Change Order of that Package.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

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
    raise exception 'Cannot patch %: expected % occurrence(s) of "%", found %',
      p_signature, p_expected_count, left(p_old, 60), v_count;
  end if;
  execute pg_catalog.replace(v_definition, p_old, p_new);
end;
$$;

-- The Package type --------------------------------------------------------------------------------------

alter table valtrim.draw_packages
  add column change_order_id bigint references valtrim.change_orders(id) on delete restrict,
  drop constraint draw_packages_package_type_check,
  add constraint draw_packages_package_type_check
    check (package_type in ('DRAW', 'RETENTION_RELEASE', 'PRICE_ADJUSTMENT', 'OPTIONS', 'CHANGE_ORDER')),
  add constraint draw_packages_change_order_check
    check ((package_type = 'CHANGE_ORDER') = (change_order_id is not null));

-- One standing invoice Package for each Change Order.
create unique index draw_packages_one_per_change_order
  on valtrim.draw_packages (change_order_id)
  where change_order_id is not null and status <> 'VOIDED';

grant select (change_order_id) on valtrim.draw_packages to authenticated;

comment on column valtrim.draw_packages.change_order_id is
  'For a CHANGE_ORDER Package: the Extra / Change Order it invoices; its lines are the lines of the invoice.';

-- The Change Order a Package invoices never changes.
select pg_temp.patch_function(
  'valtrim.prepare_draw_package()'::regprocedure,
  E'       or new.package_type is distinct from old.package_type then',
  E'       or new.package_type is distinct from old.package_type\n       or new.change_order_id is distinct from old.change_order_id then'
);

-- A CHANGE_ORDER Package has no calculated lines of its own: its Change Order has them.
select pg_temp.patch_function(
  'valtrim.validate_package_workflow_status_change()'::regprocedure,
  E'     and not exists (\n       select 1 from valtrim.package_options line\n       where line.package_id = new.id\n     ) then',
  E'     and not exists (\n       select 1 from valtrim.package_options line\n       where line.package_id = new.id\n     )\n     and new.package_type is distinct from ''CHANGE_ORDER'' then'
);

-- The standing invoice Package of a Change Order, or null.
create function private.change_order_invoice_package(p_change_order_id bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select package.id
  from valtrim.draw_packages package
  where package.change_order_id = p_change_order_id
    and package.status <> 'VOIDED'
  limit 1;
$$;

-- Creating it ---------------------------------------------------------------------------------------------

create function private.create_change_order_package(
  p_change_order_id bigint,
  p_notes text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_status valtrim.change_order_status;
  v_job_id bigint;
  v_builder_id bigint;
  v_version_id bigint;
  v_line_format valtrim.invoice_line_format;
  v_existing varchar;
  v_lines integer;
  v_total numeric;
  v_phase_count integer;
  v_places integer;
  v_single_phase_id bigint;
  v_package_id bigint;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'ACCOUNTING', 'DRAW_INVOICE')) then
    raise exception 'You do not have permission to invoice a Change Order' using errcode = '42501';
  end if;
  if p_notes is not null and char_length(btrim(p_notes)) > 500 then
    raise exception 'Package notes must contain 500 characters or fewer' using errcode = '23514';
  end if;

  select change_order.status, change_order.job_id
  into v_status, v_job_id
  from valtrim.change_orders change_order
  where change_order.id = p_change_order_id
  for update;
  if not found then
    raise exception 'The Change Order no longer exists' using errcode = 'P0002';
  end if;
  if v_status <> 'APPROVED' then
    raise exception 'Only an approved Change Order can be invoiced' using errcode = '23514';
  end if;

  select package.package_number
  into v_existing
  from valtrim.draw_packages package
  where package.id = private.change_order_invoice_package(p_change_order_id);
  if v_existing is not null then
    raise exception 'This Change Order is already invoiced on Package %', v_existing using errcode = '23505';
  end if;

  select count(*), coalesce(sum(line.amount), 0),
         count(distinct line.phase_id), count(*) filter (where line.lot_id is null), min(line.phase_id)
  into v_lines, v_total, v_phase_count, v_places, v_single_phase_id
  from valtrim.change_order_lines line
  where line.change_order_id = p_change_order_id;
  if v_lines = 0 then
    raise exception 'The Change Order has no lines to invoice' using errcode = '23514';
  end if;
  if v_total <= 0 then
    raise exception 'A Change Order whose total is a credit or zero cannot be invoiced' using errcode = '23514';
  end if;

  -- Same order as the other Packages: the Job first.
  select job.builder_id, job.billing_setup_version_id, version.invoice_line_format
  into v_builder_id, v_version_id, v_line_format
  from valtrim.jobs job
  join valtrim.billing_setup_versions version
    on version.id = job.billing_setup_version_id
   and version.builder_id = job.builder_id
  where job.id = v_job_id
    and job.is_active
    and version.status in ('ACTIVE', 'SUPERSEDED')
  for update of job;
  if v_builder_id is null then
    raise exception 'The Job or its Billing Setup is no longer available' using errcode = '23503';
  end if;

  -- The Package names one Phase only when every line is a Lot of the same active Phase.
  if v_phase_count <> 1 or v_places > 0 or not exists (
    select 1 from valtrim.phases phase where phase.id = v_single_phase_id and phase.is_active
  ) then
    v_single_phase_id := null;
  end if;

  insert into valtrim.draw_packages (
    package_number, package_type, change_order_id, builder_id, job_id, phase_id, setup_version_id,
    package_date, invoice_line_format, notes, workflow_status, status_changed_by, created_by, updated_by
  ) values (
    'CP-' || lpad(nextval('valtrim.draw_package_number_seq')::text, 8, '0'),
    'CHANGE_ORDER',
    p_change_order_id,
    v_builder_id,
    v_job_id,
    v_single_phase_id,
    v_version_id,
    current_date,
    v_line_format,
    nullif(btrim(p_notes), ''),
    'DRAFT',
    v_actor_id,
    v_actor_id,
    v_actor_id
  ) returning id into v_package_id;

  insert into valtrim.invoices (
    package_id, gross_amount, retention_amount, wrap_amount, net_amount, created_by, updated_by
  ) values (
    v_package_id, v_total, 0, 0, v_total, v_actor_id, v_actor_id
  );

  return v_package_id;
end;
$$;

create function valtrim.create_change_order_package(
  p_change_order_id bigint,
  p_notes text default null
)
returns bigint
language sql
set search_path = ''
as $$
  select private.create_change_order_package(p_change_order_id, p_notes);
$$;

-- A Change Order with a standing invoice cannot be cancelled ------------------------------------------------

create or replace function private.guard_change_order_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.change_order_number is distinct from old.change_order_number then
    raise exception 'The number of a Change Order cannot change'
      using errcode = '23514';
  end if;

  if row(new.source_change_order_id, new.source_package_id)
     is distinct from row(old.source_change_order_id, old.source_package_id) then
    raise exception 'Where a Change Order came from cannot change'
      using errcode = '23514';
  end if;

  if new.status is distinct from old.status
     and not private.change_order_transition_allowed(old.status, new.status) then
    raise exception 'A % Change Order cannot become %', old.status, new.status
      using errcode = '23514';
  end if;

  if old.status in ('APPROVED', 'CANCELLED')
     and row(
       new.internal_number, new.title, new.builder_id, new.job_id, new.requested_by,
       new.request_date, new.needed_by_date, new.coverage
     ) is distinct from row(
       old.internal_number, old.title, old.builder_id, old.job_id, old.requested_by,
       old.request_date, old.needed_by_date, old.coverage
     ) then
    raise exception 'An approved or cancelled Change Order cannot be edited'
      using errcode = '23514';
  end if;

  -- A Change Order with an invoice Package that stands is cancelled only after that Package is voided.
  if new.status = 'CANCELLED' and old.status is distinct from 'CANCELLED'
     and private.change_order_invoice_package(new.id) is not null then
    raise exception 'Void the invoice Package % of this Change Order before cancelling it',
      (select package.package_number from valtrim.draw_packages package
       where package.id = private.change_order_invoice_package(new.id))
      using errcode = '23514';
  end if;

  -- A "Specific plan types" Change Order is approved with its Scope and Amount by Plan: they are what the
  -- Lots that come later are charged with.
  if new.status = 'APPROVED' and old.status is distinct from 'APPROVED'
     and new.source_change_order_id is null
     and coalesce(new.coverage->>'mode', 'lots') = 'plans'
     and not exists (
       select 1 from valtrim.change_order_plan_rules rule where rule.change_order_id = new.id
     ) then
    raise exception 'Write the Scope and Amount of each Plan before approving this Change Order'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- An invoiced Change Order made from a Package is closed -------------------------------------------------

-- Lots added later to its source Package go on another Change Order of that Package.
drop index valtrim.change_orders_one_per_source_package;

create or replace function private.sync_package_change_orders(p_package_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_package_number varchar;
  v_job_id bigint;
  v_package_date date;
  v_live boolean;
  v_lots bigint[] := '{}'::bigint[];
  v_voided_package_id bigint;
  v_source_id bigint;
  v_child_id bigint;
  v_number text;
  v_last_line integer;
  v_released_lots bigint[] := '{}'::bigint[];
  v_other_package_id bigint;
begin
  select
    package.package_number,
    package.job_id,
    package.package_date,
    package.status <> 'VOIDED' and package.package_type in ('DRAW', 'OPTIONS')
  into v_package_number, v_job_id, v_package_date, v_live
  from valtrim.draw_packages package
  where package.id = p_package_id;
  if not found then
    return;
  end if;

  if v_live then
    select coalesce(array_agg(distinct billed.lot_id), '{}'::bigint[])
    into v_lots
    from (
      select draw.lot_id from valtrim.package_draws draw where draw.package_id = p_package_id
      union
      select billed_option.lot_id from valtrim.package_options billed_option
      where billed_option.package_id = p_package_id
    ) billed
    join valtrim.lots lot on lot.id = billed.lot_id and not lot.is_utility_building;
  end if;

  perform set_config('valtrim.change_order_package_sync', 'on', true);

  -- 1. A voided Package that still holds one of these Lots gives it back first.
  if cardinality(v_lots) > 0 then
    for v_voided_package_id in
      select distinct charge.package_id
      from valtrim.change_order_plan_charges charge
      join valtrim.draw_packages package on package.id = charge.package_id
      where charge.lot_id = any(v_lots)
        and charge.released_at is null
        and charge.package_id <> p_package_id
        and package.status = 'VOIDED'
    loop
      perform private.sync_package_change_orders(v_voided_package_id);
      perform set_config('valtrim.change_order_package_sync', 'on', true);
    end loop;
  end if;

  -- 2. The Lots this Package no longer bills (or all of them, when it was voided) are given back.
  --    A Change Order of this Package that loses all its Lots is cancelled and keeps its lines, so it still
  --    shows what it charged; one that keeps some Lots loses the lines of the others. A Change Order that
  --    someone cancelled by hand is left as it is, and so is one that was invoiced: what it charged stands.
  update valtrim.change_orders change_order
  set status = 'CANCELLED',
      cancelled_at = now(),
      cancelled_by = v_actor_id,
      cancel_reason = case
        when v_live then format('Package %s no longer bills its Lots', v_package_number)
        else format('Package %s was voided', v_package_number)
      end,
      updated_by = v_actor_id
  where change_order.source_package_id = p_package_id
    and change_order.status = 'APPROVED'
    and private.change_order_invoice_package(change_order.id) is null
    and exists (
      select 1
      from valtrim.change_order_plan_charges charge
      where charge.change_order_id = change_order.id
        and charge.released_at is null
        and not (charge.lot_id = any(v_lots))
    )
    and not exists (
      select 1
      from valtrim.change_order_plan_charges charge
      where charge.change_order_id = change_order.id
        and charge.released_at is null
        and charge.lot_id = any(v_lots)
    );

  delete from valtrim.change_order_lines line
  using valtrim.change_order_plan_charges charge, valtrim.change_orders change_order
  where charge.package_id = p_package_id
    and charge.released_at is null
    and not (charge.lot_id = any(v_lots))
    and line.change_order_id = charge.change_order_id
    and line.lot_id = charge.lot_id
    and change_order.id = charge.change_order_id
    and change_order.status = 'APPROVED'
    and private.change_order_invoice_package(change_order.id) is null;

  with released as (
    update valtrim.change_order_plan_charges charge
    set released_at = now(),
        release_reason = case
          when v_live then format('The Lot left Package %s', v_package_number)
          else format('Package %s was voided', v_package_number)
        end
    where charge.package_id = p_package_id
      and charge.released_at is null
      and not (charge.lot_id = any(v_lots))
      and private.change_order_invoice_package(charge.change_order_id) is null
    returning charge.lot_id
  )
  select coalesce(array_agg(distinct released.lot_id), '{}'::bigint[])
  into v_released_lots
  from released;

  -- A Lot given back is charged by the first other Package that still bills it, if there is one; if not,
  -- the next Package that bills it charges it.
  if cardinality(v_released_lots) > 0 then
    for v_other_package_id in
      select package.id
      from valtrim.draw_packages package
      where package.id <> p_package_id
        and package.job_id = v_job_id
        and package.status <> 'VOIDED'
        and package.package_type in ('DRAW', 'OPTIONS')
        and (
          exists (
            select 1 from valtrim.package_draws draw
            where draw.package_id = package.id and draw.lot_id = any(v_released_lots)
          )
          or exists (
            select 1 from valtrim.package_options billed_option
            where billed_option.package_id = package.id and billed_option.lot_id = any(v_released_lots)
          )
        )
      order by package.id
    loop
      perform private.sync_package_change_orders(v_other_package_id);
      perform set_config('valtrim.change_order_package_sync', 'on', true);
    end loop;
  end if;

  -- 3. The Lots it bills that a rule has not charged yet, one Change Order for each rule.
  if v_live and cardinality(v_lots) > 0 then
    for v_source_id in
      select distinct candidate.source_change_order_id
      from private.plan_change_order_candidates(v_job_id, v_lots, p_package_id) candidate
      where not exists (
        select 1
        from valtrim.change_order_plan_charges charge
        where charge.source_change_order_id = candidate.source_change_order_id
          and charge.lot_id = candidate.lot_id
          and charge.package_id = p_package_id
          and charge.released_at is null
      )
      order by candidate.source_change_order_id
    loop
      v_child_id := null;
      select change_order.id
      into v_child_id
      from valtrim.change_orders change_order
      where change_order.source_change_order_id = v_source_id
        and change_order.source_package_id = p_package_id
        and change_order.status <> 'CANCELLED'
        -- One already invoiced is closed: new Lots go on another Change Order of the same Package.
        and private.change_order_invoice_package(change_order.id) is null
      order by change_order.id desc
      limit 1;

      if v_child_id is null then
        v_number := private.next_change_order_number();

        insert into valtrim.change_orders (
          change_order_number, internal_number, builder_id, job_id, requested_by, request_date,
          status, coverage, approved_at, approved_by, created_by, updated_by,
          source_change_order_id, source_package_id
        )
        select
          v_number,
          v_number,
          parent.builder_id,
          parent.job_id,
          parent.requested_by,
          coalesce(v_package_date, current_date),
          'APPROVED',
          '{}'::jsonb,
          now(),
          parent.approved_by,
          v_actor_id,
          v_actor_id,
          parent.id,
          p_package_id
        from valtrim.change_orders parent
        where parent.id = v_source_id
        returning id into v_child_id;
      end if;

      select coalesce(max(line.line_number), 0)
      into v_last_line
      from valtrim.change_order_lines line
      where line.change_order_id = v_child_id;

      -- The lines first, then the charges: the charges are what tells a Lot is taken.
      insert into valtrim.change_order_lines (
        change_order_id, lot_id, job_id, phase_id, line_number,
        phase_code, building, lot_number, plan_code, plan_name, location,
        scope_of_work, amount, po_number, billing_event, billing_event_date
      )
      select
        v_child_id,
        lot.id,
        lot.job_id,
        lot.phase_id,
        (v_last_line + row_number() over (
          order by phase.code, phase.building nulls first, lot.display_order, lot.lot_number
        ))::integer,
        phase.code,
        phase.building,
        lot.lot_number,
        plan.code,
        plan.name,
        null,
        candidate.scope_of_work,
        candidate.amount,
        null,
        null,
        null
      from private.plan_change_order_candidates(v_job_id, v_lots, p_package_id) candidate
      join valtrim.lots lot on lot.id = candidate.lot_id
      join valtrim.phases phase on phase.id = lot.phase_id
      join valtrim.plans plan on plan.id = candidate.plan_id
      where candidate.source_change_order_id = v_source_id
        and not exists (
          select 1
          from valtrim.change_order_plan_charges charge
          where charge.source_change_order_id = v_source_id
            and charge.lot_id = candidate.lot_id
            and charge.package_id = p_package_id
            and charge.released_at is null
        );

      insert into valtrim.change_order_plan_charges (
        source_change_order_id, change_order_id, package_id, lot_id, plan_id
      )
      select v_source_id, v_child_id, p_package_id, candidate.lot_id, candidate.plan_id
      from private.plan_change_order_candidates(v_job_id, v_lots, p_package_id) candidate
      where candidate.source_change_order_id = v_source_id
        and not exists (
          select 1
          from valtrim.change_order_plan_charges charge
          where charge.source_change_order_id = v_source_id
            and charge.lot_id = candidate.lot_id
            and charge.package_id = p_package_id
            and charge.released_at is null
        );
    end loop;
  end if;

  perform set_config('valtrim.change_order_package_sync', 'off', true);
end;
$$;

-- The list: its standing invoice Package, at the end ---------------------------------------------------

create or replace view valtrim.change_order_overview
with (security_invoker = true)
as
select
  change_order.id,
  change_order.change_order_number,
  change_order.internal_number,
  change_order.title,
  change_order.status,
  change_order.builder_id,
  builder.name as builder_name,
  change_order.job_id,
  job.code as job_code,
  job.community,
  change_order.requested_by,
  change_order.request_date,
  change_order.needed_by_date,
  change_order.created_at,
  change_order.updated_at,
  coalesce(totals.line_count, 0) as line_count,
  coalesce(totals.total_amount, 0) as total_amount,
  change_order.po_co_number,
  change_order.source_change_order_id,
  source.change_order_number as source_change_order_number,
  change_order.source_package_id,
  source_package.package_number as source_package_number,
  invoice_package.id as invoice_package_id,
  invoice_package.package_number as invoice_package_number,
  invoice_package.workflow_status::text as invoice_workflow_status
from valtrim.change_orders change_order
join valtrim.builders builder on builder.id = change_order.builder_id
join valtrim.jobs job on job.id = change_order.job_id
left join valtrim.change_orders source on source.id = change_order.source_change_order_id
left join valtrim.draw_packages source_package on source_package.id = change_order.source_package_id
left join lateral (
  select count(*) as line_count, sum(line.amount) as total_amount
  from valtrim.change_order_lines line
  where line.change_order_id = change_order.id
) totals on true
left join lateral (
  select package.id, package.package_number, package.workflow_status
  from valtrim.draw_packages package
  where package.change_order_id = change_order.id
    and package.status <> 'VOIDED'
  limit 1
) invoice_package on true;

-- Who can call what -------------------------------------------------------------------------------------

revoke execute on function
  private.change_order_invoice_package(bigint),
  private.create_change_order_package(bigint, text),
  valtrim.create_change_order_package(bigint, text)
from public, anon, authenticated;

grant execute on function
  private.create_change_order_package(bigint, text),
  valtrim.create_change_order_package(bigint, text)
to authenticated, service_role;

comment on function valtrim.create_change_order_package(bigint, text) is
  'Creates the Package that invoices an approved Extra / Change Order (total, no Retention or WRAP). ADMIN, ACCOUNTING and DRAW_INVOICE; one standing Package per Change Order.';

notify pgrst, 'reload schema';

commit;
