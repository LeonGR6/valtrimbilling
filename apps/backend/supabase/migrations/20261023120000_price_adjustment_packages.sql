-- Price Adjustment Packages: collecting the pending price differences.
--
-- A Package that already has a QuickBooks invoice, was sent or is paid keeps the
-- amount it billed. The difference with the new price of its Phases is recorded as
-- pending (package_price_differences). A Price Adjustment Package invoices a chosen
-- set of those differences: one Package per Job, with its own number (PA-...).
--
--   * Credits and charges of the same Job add up. Nothing is invoiced when the total
--     is a credit or zero, and gross, Retention and WRAP must each add up to a
--     positive amount: an invoice cannot be negative.
--   * It deducts Retention and WRAP like any Package, and the Retention Release
--     includes what an adjustment retained (credits reduce it), so that money is
--     released with the rest.
--   * Collecting a difference marks it COLLECTED. A later price change is worked out
--     against what was billed minus what was already collected, so nothing is
--     invoiced twice. Cancelling the adjustment gives its differences back.
--   * It is not sent to QuickBooks yet: that is a separate step.

begin;

alter table valtrim.draw_packages
  drop constraint draw_packages_package_type_check,
  add constraint draw_packages_package_type_check
    check (package_type in ('DRAW', 'RETENTION_RELEASE', 'PRICE_ADJUSTMENT'));

comment on column valtrim.draw_packages.package_type is
  'DRAW contains immutable Lot / Draw lines. RETENTION_RELEASE is a positive release of previously retained line amounts. PRICE_ADJUSTMENT invoices price differences of Packages that could not change.';

-- The Package and what it collected ------------------------------------------------

create table valtrim.price_adjustments (
  package_id bigint primary key
    references valtrim.draw_packages(id) on delete restrict,
  job_id bigint not null references valtrim.jobs(id) on delete restrict,
  source_package_count integer not null check (source_package_count > 0),
  line_count integer not null check (line_count > 0),
  gross_amount valtrim.amount not null,
  retention_amount valtrim.amount not null,
  wrap_amount valtrim.amount not null,
  net_amount valtrim.amount not null check (net_amount > 0),
  created_by uuid not null references valtrim.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (net_amount = gross_amount - retention_amount - wrap_amount)
);

-- One line per difference collected. Amounts may be negative: a credit inside an
-- adjustment that adds up to a positive total.
create table valtrim.price_adjustment_lines (
  id bigint generated always as identity primary key,
  package_id bigint not null
    references valtrim.price_adjustments(package_id) on delete restrict,
  difference_id bigint not null unique
    references valtrim.package_price_differences(id) on delete restrict,
  source_package_id bigint not null,
  source_package_number text not null,
  line_kind text not null check (line_kind in ('DRAW', 'HARDWARE_EVENT')),
  lot_id bigint not null,
  draw_id bigint,
  hardware_event_type text,
  draw_number smallint,
  phase_id bigint not null,
  phase_code text not null,
  building text,
  lot_number text not null,
  plan_code text not null,
  delta_base numeric(14,2) not null,
  delta_hardware numeric(14,2) not null,
  delta_utility numeric(14,2) not null,
  delta_options numeric(14,2) not null,
  gross numeric(14,2) not null,
  retention numeric(14,2) not null,
  wrap numeric(14,2) not null,
  net numeric(14,2) not null,
  created_at timestamptz not null default now(),
  check (net = gross - retention - wrap)
);

create index price_adjustments_job_idx on valtrim.price_adjustments (job_id);
create index price_adjustments_created_by_idx on valtrim.price_adjustments (created_by);
create index price_adjustment_lines_package_idx
  on valtrim.price_adjustment_lines (package_id);
create index price_adjustment_lines_source_idx
  on valtrim.price_adjustment_lines (source_package_id);
create index price_adjustment_lines_phase_idx
  on valtrim.price_adjustment_lines (phase_id);

comment on table valtrim.price_adjustments is
  'One Price Adjustment Package: the price differences of issued Packages it invoices.';
comment on table valtrim.price_adjustment_lines is
  'Immutable lines of a Price Adjustment Package, one per collected price difference.';

alter table valtrim.price_adjustments enable row level security;
alter table valtrim.price_adjustment_lines enable row level security;

revoke all on valtrim.price_adjustments from public, anon, authenticated;
revoke all on valtrim.price_adjustment_lines from public, anon, authenticated;
revoke all on sequence valtrim.price_adjustment_lines_id_seq from public, anon, authenticated;
grant select on valtrim.price_adjustments to authenticated;
grant select on valtrim.price_adjustment_lines to authenticated;

create policy price_adjustments_select
on valtrim.price_adjustments for select to authenticated
using ((select private.is_active_user()));

create policy price_adjustment_lines_select
on valtrim.price_adjustment_lines for select to authenticated
using ((select private.is_active_user()));

create trigger price_adjustments_immutable
before update or delete on valtrim.price_adjustments
for each row execute function valtrim.reject_retention_release_snapshot_change();

create trigger price_adjustment_lines_immutable
before update or delete on valtrim.price_adjustment_lines
for each row execute function valtrim.reject_retention_release_snapshot_change();

-- What an adjustment retained, and which Retention Release took it. Amounts are
-- signed: a credit reduces what the release gives back.
create table valtrim.retention_release_adjustment_lines (
  package_id bigint not null
    references valtrim.retention_releases(package_id) on delete restrict,
  source_adjustment_line_id bigint not null
    references valtrim.price_adjustment_lines(id) on delete restrict,
  source_package_id bigint not null,
  phase_id bigint not null,
  retention_amount numeric(14,2) not null check (retention_amount <> 0),
  created_at timestamptz not null default now(),
  primary key (package_id, source_adjustment_line_id)
);

create index retention_release_adjustment_lines_source_idx
  on valtrim.retention_release_adjustment_lines (source_adjustment_line_id);
create index retention_release_adjustment_lines_source_package_idx
  on valtrim.retention_release_adjustment_lines (source_package_id);
create index retention_release_adjustment_lines_phase_idx
  on valtrim.retention_release_adjustment_lines (phase_id);

comment on table valtrim.retention_release_adjustment_lines is
  'Immutable adjustment lines whose retained amounts were included in one Retention Release Package.';

alter table valtrim.retention_release_adjustment_lines enable row level security;
revoke all on valtrim.retention_release_adjustment_lines from public, anon, authenticated;
grant select on valtrim.retention_release_adjustment_lines to authenticated;
create policy retention_release_adjustment_lines_select
on valtrim.retention_release_adjustment_lines for select to authenticated
using ((select private.is_active_user()));

create trigger retention_release_adjustment_lines_immutable
before update or delete on valtrim.retention_release_adjustment_lines
for each row execute function valtrim.reject_retention_release_snapshot_change();

-- Which adjustment collected a difference; accounting reads them too.
alter table valtrim.package_price_differences
  add column adjustment_package_id bigint
    references valtrim.draw_packages(id) on delete restrict;

create index package_price_differences_adjustment_idx
  on valtrim.package_price_differences (adjustment_package_id)
  where adjustment_package_id is not null;

grant select (adjustment_package_id) on valtrim.package_price_differences to authenticated;

drop policy package_price_differences_select on valtrim.package_price_differences;
create policy package_price_differences_select
on valtrim.package_price_differences for select to authenticated
using ((select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT', 'ACCOUNTING')));

-- Function patching ----------------------------------------------------------------
-- Functions are rewritten from their live definition, and the patch aborts when the
-- text it expects is not there.

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

-- An adjustment can leave DRAFT because it has lines, and cannot go back to DRAFT
-- while a Retention Release holds what it retained.
select pg_temp.patch_function(
  'valtrim.validate_package_workflow_status_change()'::regprocedure,
$old$
  if new.workflow_status <> 'DRAFT'
     and not exists (
       select 1 from valtrim.package_draws line
$old$,
$new$
  if new.package_type = 'PRICE_ADJUSTMENT'
     and new.workflow_status = 'DRAFT'
     and exists (
       select 1
       from valtrim.retention_release_adjustment_lines allocated
       join valtrim.draw_packages release_package
         on release_package.id = allocated.package_id
        and release_package.status <> 'VOIDED'
       where allocated.source_package_id = new.id
     ) then
    raise exception 'Cancel the active Retention Release before returning its source Package to Draft'
      using errcode = '23514';
  end if;

  if new.workflow_status <> 'DRAFT'
     and not exists (
       select 1 from valtrim.package_draws line
$new$
);

select pg_temp.patch_function(
  'valtrim.validate_package_workflow_status_change()'::regprocedure,
$old$
     and not exists (
       select 1 from valtrim.retention_release_hardware_lines line
       where line.package_id = new.id
     ) then
$old$,
$new$
     and not exists (
       select 1 from valtrim.retention_release_hardware_lines line
       where line.package_id = new.id
     )
     and not exists (
       select 1 from valtrim.price_adjustment_lines line
       where line.package_id = new.id
     ) then
$new$
);

-- Only a Draw Package can hold Draw and Separate Hardware lines.
select pg_temp.patch_function(
  'valtrim.reject_retention_release_draw_line()'::regprocedure,
$old$
      and package.package_type = 'RETENTION_RELEASE'
  ) then
    raise exception 'A Retention Release Package cannot contain Draw lines'
$old$,
$new$
      and package.package_type <> 'DRAW'
  ) then
    raise exception 'Only a Draw Package can contain Draw lines'
$new$
);

select pg_temp.patch_function(
  'valtrim.reject_retention_release_hardware_line()'::regprocedure,
$old$
      and package.package_type = 'RETENTION_RELEASE'
  ) then
    raise exception 'A Retention Release Package cannot contain Separate Hardware lines'
$old$,
$new$
      and package.package_type <> 'DRAW'
  ) then
    raise exception 'Only a Draw Package can contain Separate Hardware lines'
$new$
);

-- An adjustment whose retention a release holds cannot be cancelled either.
select pg_temp.patch_function(
  'valtrim.prevent_allocated_source_package_void()'::regprocedure,
$old$
  if new.package_type = 'DRAW'
     and new.status = 'VOIDED'
$old$,
$new$
  if new.package_type in ('DRAW', 'PRICE_ADJUSTMENT')
     and new.status = 'VOIDED'
$new$
);

select pg_temp.patch_function(
  'valtrim.prevent_allocated_source_package_void()'::regprocedure,
$old$
         where allocated.source_package_id = new.id
       )
     ) then
    raise exception 'Cancel the active Retention Release before cancelling its source Package'
$old$,
$new$
         where allocated.source_package_id = new.id
       )
       or exists (
         select 1
         from valtrim.retention_release_adjustment_lines allocated
         join valtrim.draw_packages release_package
           on release_package.id = allocated.package_id
          and release_package.status <> 'VOIDED'
         where allocated.source_package_id = new.id
       )
     ) then
    raise exception 'Cancel the active Retention Release before cancelling its source Package'
$new$
);

-- A Price Adjustment Package has no Release to generate: say so as what it is.
select pg_temp.patch_function(
  'private.get_final_release_status(bigint)'::regprocedure,
$old$
      'reason', 'RETENTION_RELEASE',
$old$,
$new$
      'reason', v_package.package_type,
$new$
);

-- The Retention Release takes what adjustments retained --------------------------------
-- Credits reduce what is released. An adjustment counts like a Draw Package: once it
-- is sent or paid, never while it is a Draft or cancelled.

select pg_temp.patch_function(
  'private.create_retention_release_package(bigint,bigint,text)'::regprocedure,
$old$
  v_inserted integer;
  v_inserted_hardware integer;
begin
$old$,
$new$
  v_inserted integer;
  v_inserted_hardware integer;
  v_inserted_adjustment integer;
begin
$new$
);

select pg_temp.patch_function(
  'private.create_retention_release_package(bigint,bigint,text)'::regprocedure,
$old$
        where allocated.source_hardware_line_id = line.id
      )
  ) source;

  if v_retained_amount <= 0 then
$old$,
$new$
        where allocated.source_hardware_line_id = line.id
      )
    union all
    select line.retention as retention_amount
    from valtrim.price_adjustment_lines line
    join valtrim.draw_packages package
      on package.id = line.package_id
     and package.job_id = p_job_id
     and package.package_type = 'PRICE_ADJUSTMENT'
     and package.status <> 'VOIDED'
     and package.workflow_status in (
       'READY_TO_SUBMIT', 'AWAITING_PAYMENT', 'PAID_CLOSED'
     )
    where line.retention <> 0
      and (v_scope_type = 'JOB' or line.phase_id = p_phase_id)
      and not exists (
        select 1
        from valtrim.retention_release_adjustment_lines allocated
        join valtrim.draw_packages release_package
          on release_package.id = allocated.package_id
         and release_package.status <> 'VOIDED'
        where allocated.source_adjustment_line_id = line.id
      )
  ) source;

  if v_retained_amount <= 0 then
$new$
);

select pg_temp.patch_function(
  'private.create_retention_release_package(bigint,bigint,text)'::regprocedure,
$old$
  get diagnostics v_inserted_hardware = row_count;
  if v_inserted + v_inserted_hardware = 0 then
$old$,
$new$
  get diagnostics v_inserted_hardware = row_count;

  insert into valtrim.retention_release_adjustment_lines (
    package_id,
    source_adjustment_line_id,
    source_package_id,
    phase_id,
    retention_amount
  )
  select
    v_package_id,
    line.id,
    line.package_id,
    line.phase_id,
    line.retention
  from valtrim.price_adjustment_lines line
  join valtrim.draw_packages package
    on package.id = line.package_id
   and package.job_id = p_job_id
   and package.package_type = 'PRICE_ADJUSTMENT'
   and package.status <> 'VOIDED'
   and package.workflow_status in (
     'READY_TO_SUBMIT', 'AWAITING_PAYMENT', 'PAID_CLOSED'
   )
  where line.retention <> 0
    and (v_scope_type = 'JOB' or line.phase_id = p_phase_id)
    and not exists (
      select 1
      from valtrim.retention_release_adjustment_lines allocated
      join valtrim.draw_packages release_package
        on release_package.id = allocated.package_id
       and release_package.status <> 'VOIDED'
      where allocated.source_adjustment_line_id = line.id
    )
  order by line.package_id, line.id;

  get diagnostics v_inserted_adjustment = row_count;
  if v_inserted + v_inserted_hardware + v_inserted_adjustment = 0 then
$new$
);

-- Differences already collected are not collected again ----------------------------------
-- Worked out against what was billed minus what was already collected, so a later
-- price change only adds what is still missing (or a credit, when the price went back).

drop function private.record_package_price_differences(bigint, bigint[]);

create function private.record_package_price_differences(
  p_recalculation_id bigint,
  p_package_ids bigint[],
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := coalesce((select auth.uid()), p_actor_id);
  v_package_id bigint;
  v_package record;
  v_line valtrim.package_draws%rowtype;
  v_hardware_line valtrim.package_hardware_lines%rowtype;
  v_amounts jsonb;
  v_collected record;
  v_summary jsonb := '[]'::jsonb;
  v_lines integer;
  v_delta_gross numeric;
  v_delta_net numeric;
  v_base numeric;
  v_hardware numeric;
  v_utility numeric;
  v_options numeric;
  v_gross numeric;
  v_retention numeric;
  v_wrap numeric;
  v_net numeric;
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
      continue when v_amounts is null;

      select
        coalesce(sum(collected.delta_base), 0) as base,
        coalesce(sum(collected.delta_hardware), 0) as hardware,
        coalesce(sum(collected.delta_utility), 0) as utility,
        coalesce(sum(collected.delta_options), 0) as options,
        coalesce(sum(collected.delta_gross), 0) as gross,
        coalesce(sum(collected.delta_retention), 0) as retention,
        coalesce(sum(collected.delta_wrap), 0) as wrap,
        coalesce(sum(collected.delta_net), 0) as net
      into v_collected
      from valtrim.package_price_differences collected
      where collected.package_id = v_package_id
        and collected.status = 'COLLECTED'
        and collected.line_kind = 'DRAW'
        and collected.lot_id = v_line.lot_id
        and collected.draw_id = v_line.draw_id;

      v_base := (v_amounts -> 'new' ->> 'base')::numeric - (v_amounts -> 'billed' ->> 'base')::numeric - v_collected.base;
      v_hardware := (v_amounts -> 'new' ->> 'hardware')::numeric - (v_amounts -> 'billed' ->> 'hardware')::numeric - v_collected.hardware;
      v_utility := (v_amounts -> 'new' ->> 'utility')::numeric - (v_amounts -> 'billed' ->> 'utility')::numeric - v_collected.utility;
      v_options := (v_amounts -> 'new' ->> 'options')::numeric - (v_amounts -> 'billed' ->> 'options')::numeric - v_collected.options;
      v_gross := (v_amounts -> 'new' ->> 'gross')::numeric - (v_amounts -> 'billed' ->> 'gross')::numeric - v_collected.gross;
      v_retention := (v_amounts -> 'new' ->> 'retention')::numeric - (v_amounts -> 'billed' ->> 'retention')::numeric - v_collected.retention;
      v_wrap := (v_amounts -> 'new' ->> 'wrap')::numeric - (v_amounts -> 'billed' ->> 'wrap')::numeric - v_collected.wrap;
      v_net := (v_amounts -> 'new' ->> 'net')::numeric - (v_amounts -> 'billed' ->> 'net')::numeric - v_collected.net;

      continue when v_base = 0 and v_hardware = 0 and v_utility = 0 and v_options = 0
        and v_gross = 0 and v_retention = 0 and v_wrap = 0 and v_net = 0;

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
        v_base, v_hardware, v_utility, v_options,
        v_gross, v_retention, v_wrap, v_net,
        v_actor_id
      );
      v_lines := v_lines + 1;
      v_delta_gross := v_delta_gross + v_gross;
      v_delta_net := v_delta_net + v_net;
    end loop;

    for v_hardware_line in
      select line.*
      from valtrim.package_hardware_lines line
      where line.package_id = v_package_id
      order by line.lot_id, line.hardware_event_type
    loop
      v_amounts := private.package_hardware_line_new_amounts(v_hardware_line);
      continue when v_amounts is null;

      select
        coalesce(sum(collected.delta_hardware), 0) as hardware,
        coalesce(sum(collected.delta_gross), 0) as gross,
        coalesce(sum(collected.delta_retention), 0) as retention,
        coalesce(sum(collected.delta_wrap), 0) as wrap,
        coalesce(sum(collected.delta_net), 0) as net
      into v_collected
      from valtrim.package_price_differences collected
      where collected.package_id = v_package_id
        and collected.status = 'COLLECTED'
        and collected.line_kind = 'HARDWARE_EVENT'
        and collected.lot_id = v_hardware_line.lot_id
        and collected.hardware_event_type = v_hardware_line.hardware_event_type::text;

      v_hardware := (v_amounts -> 'new' ->> 'hardware')::numeric - (v_amounts -> 'billed' ->> 'hardware')::numeric - v_collected.hardware;
      v_gross := (v_amounts -> 'new' ->> 'gross')::numeric - (v_amounts -> 'billed' ->> 'gross')::numeric - v_collected.gross;
      v_retention := (v_amounts -> 'new' ->> 'retention')::numeric - (v_amounts -> 'billed' ->> 'retention')::numeric - v_collected.retention;
      v_wrap := (v_amounts -> 'new' ->> 'wrap')::numeric - (v_amounts -> 'billed' ->> 'wrap')::numeric - v_collected.wrap;
      v_net := (v_amounts -> 'new' ->> 'net')::numeric - (v_amounts -> 'billed' ->> 'net')::numeric - v_collected.net;

      continue when v_hardware = 0 and v_gross = 0 and v_retention = 0
        and v_wrap = 0 and v_net = 0;

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
        0, v_hardware, 0, 0,
        v_gross, v_retention, v_wrap, v_net,
        v_actor_id
      );
      v_lines := v_lines + 1;
      v_delta_gross := v_delta_gross + v_gross;
      v_delta_net := v_delta_net + v_net;
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

revoke all on function private.record_package_price_differences(bigint, bigint[], uuid)
  from public, anon, authenticated;

-- Cancelling an adjustment gives its differences back --------------------------------------

create function private.release_differences_of_voided_adjustment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sources bigint[];
  v_recalculation_id bigint;
begin
  if new.package_type = 'PRICE_ADJUSTMENT'
     and new.status = 'VOIDED'
     and old.status is distinct from 'VOIDED' then
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

create trigger draw_packages_release_adjustment_differences
  after update of status on valtrim.draw_packages
  for each row execute function private.release_differences_of_voided_adjustment();

revoke all on function private.release_differences_of_voided_adjustment()
  from public, anon, authenticated;

-- Creating the adjustment ---------------------------------------------------------------------

create function private.create_price_adjustment_package(
  p_job_id bigint,
  p_source_package_ids bigint[],
  p_notes text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_ids bigint[];
  v_builder_id bigint;
  v_setup_version_id bigint;
  v_invoice_line_format valtrim.invoice_line_format;
  v_source_count integer;
  v_line_count integer;
  v_gross numeric(14,2);
  v_retention numeric(14,2);
  v_wrap numeric(14,2);
  v_net numeric(14,2);
  v_package_id bigint;
  v_updated integer;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to create a Price Adjustment Package'
      using errcode = '42501';
  end if;

  if p_job_id is null or p_job_id <= 0 then
    raise exception 'Select a valid Job' using errcode = '23503';
  end if;
  v_ids := array(
    select distinct selected.package_id
    from unnest(coalesce(p_source_package_ids, '{}'::bigint[])) as selected(package_id)
    where selected.package_id is not null
  );
  if cardinality(v_ids) = 0 then
    raise exception 'Select at least one Package with a pending price difference'
      using errcode = '23514';
  end if;
  if cardinality(v_ids) > 500 then
    raise exception 'Select 500 Packages or fewer at a time' using errcode = '23514';
  end if;
  if p_notes is not null and char_length(btrim(p_notes)) > 500 then
    raise exception 'Package notes must contain 500 characters or fewer'
      using errcode = '23514';
  end if;

  -- Same order as Package creation, corrections and price updates: the Job first.
  perform 1 from valtrim.jobs job where job.id = p_job_id for update;

  select job.builder_id, job.billing_setup_version_id, version.invoice_line_format
  into v_builder_id, v_setup_version_id, v_invoice_line_format
  from valtrim.jobs job
  join valtrim.billing_setup_versions version
    on version.id = job.billing_setup_version_id
   and version.builder_id = job.builder_id
  where job.id = p_job_id
    and job.is_active
    and version.status in ('ACTIVE', 'SUPERSEDED');

  if v_builder_id is null then
    raise exception 'The Job or its Billing Setup is unavailable'
      using errcode = '23503';
  end if;

  perform 1
  from valtrim.draw_packages package
  where package.job_id = p_job_id
  order by package.id
  for update;

  perform 1
  from valtrim.package_price_differences difference
  where difference.job_id = p_job_id
    and difference.status = 'PENDING'
    and difference.package_id = any (v_ids)
  order by difference.id
  for update;

  select
    count(distinct difference.package_id),
    count(*),
    coalesce(sum(difference.delta_gross), 0),
    coalesce(sum(difference.delta_retention), 0),
    coalesce(sum(difference.delta_wrap), 0),
    coalesce(sum(difference.delta_net), 0)
  into v_source_count, v_line_count, v_gross, v_retention, v_wrap, v_net
  from valtrim.package_price_differences difference
  where difference.job_id = p_job_id
    and difference.status = 'PENDING'
    and difference.package_id = any (v_ids);

  if v_source_count <> cardinality(v_ids) then
    raise exception 'Every selected Package needs a pending price difference. Reload the list and try again'
      using errcode = '23514';
  end if;
  if v_gross < 0 or v_retention < 0 or v_wrap < 0 or v_net <= 0 then
    raise exception 'The selected differences add up to a credit or to nothing, so there is nothing to invoice'
      using errcode = '23514';
  end if;

  insert into valtrim.draw_packages (
    package_number,
    package_type,
    builder_id,
    job_id,
    phase_id,
    setup_version_id,
    package_date,
    invoice_line_format,
    notes,
    workflow_status,
    status_changed_by,
    created_by,
    updated_by
  ) values (
    'PA-' || lpad(nextval('valtrim.draw_package_number_seq')::text, 8, '0'),
    'PRICE_ADJUSTMENT',
    v_builder_id,
    p_job_id,
    null,
    v_setup_version_id,
    current_date,
    v_invoice_line_format,
    nullif(btrim(p_notes), ''),
    'DRAFT',
    v_actor_id,
    v_actor_id,
    v_actor_id
  ) returning id into v_package_id;

  insert into valtrim.invoices (
    package_id,
    gross_amount,
    retention_amount,
    wrap_amount,
    net_amount,
    created_by,
    updated_by
  ) values (
    v_package_id,
    v_gross,
    v_retention,
    v_wrap,
    v_net,
    v_actor_id,
    v_actor_id
  );

  insert into valtrim.price_adjustments (
    package_id, job_id, source_package_count, line_count,
    gross_amount, retention_amount, wrap_amount, net_amount, created_by
  ) values (
    v_package_id, p_job_id, v_source_count, v_line_count,
    v_gross, v_retention, v_wrap, v_net, v_actor_id
  );

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
  where difference.job_id = p_job_id
    and difference.status = 'PENDING'
    and difference.package_id = any (v_ids)
  order by difference.package_id, difference.id;

  update valtrim.package_price_differences
  set status = 'COLLECTED',
      adjustment_package_id = v_package_id
  where job_id = p_job_id
    and status = 'PENDING'
    and package_id = any (v_ids);
  get diagnostics v_updated = row_count;

  if v_updated <> v_line_count then
    raise exception 'The adjustment did not collect every selected difference'
      using errcode = '23514';
  end if;

  return v_package_id;
end;
$$;

create function valtrim.create_price_adjustment_package(
  p_job_id bigint,
  p_source_package_ids bigint[],
  p_notes text default null
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.create_price_adjustment_package(
    p_job_id, p_source_package_ids, p_notes
  );
$$;

revoke execute on function private.create_price_adjustment_package(bigint, bigint[], text)
  from public, anon, authenticated;
revoke execute on function valtrim.create_price_adjustment_package(bigint, bigint[], text)
  from public, anon, authenticated;
grant execute on function private.create_price_adjustment_package(bigint, bigint[], text)
  to authenticated, service_role;
grant execute on function valtrim.create_price_adjustment_package(bigint, bigint[], text)
  to authenticated, service_role;

comment on function valtrim.create_price_adjustment_package(bigint, bigint[], text) is
  'Creates a Price Adjustment Package that invoices the pending price differences of the chosen Packages. Credits and charges add up; nothing is created unless the total is positive.';

notify pgrst, 'reload schema';

commit;
