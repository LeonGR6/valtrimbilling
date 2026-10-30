-- Options Packages: billing Options on their own.
--
-- An Option can be billed on a Lot / Draw cell of a Draw Package. When the Lot has no cell left
-- (every Draw of its Phase is already billed) an Option added later had nowhere to go. An Options
-- Package invoices Options of Lots that already reached the Options billing Draw, with no cell:
--
--   * One Package per Job with its own number (OP-...). It is a Draft until it is sent.
--   * Its lines are the Options themselves (package_options with no billing Draw), so an Option
--     billed here counts as billed everywhere: it cannot be billed twice, and the Plan editor
--     still reports the Package that billed it.
--   * It deducts Retention and WRAP like any Package, with the percentages of the Job's setup.
--     Each Option line keeps its own Retention and WRAP, so the Retention Release can take them
--     per Phase or Building, and the invoice is the sum of its lines.
--   * The invoice must add up to a positive amount: an invoice cannot be negative or empty.
--   * Cancelling a Draft gives its Options back. Prices stay as billed: a later price change does
--     not reprice an Options Package (cancel and create it again to bill the new price).

begin;

alter table valtrim.draw_packages
  drop constraint draw_packages_package_type_check,
  add constraint draw_packages_package_type_check
    check (package_type in ('DRAW', 'RETENTION_RELEASE', 'PRICE_ADJUSTMENT', 'OPTIONS'));

comment on column valtrim.draw_packages.package_type is
  'DRAW contains immutable Lot / Draw lines. RETENTION_RELEASE is a positive release of previously retained line amounts. PRICE_ADJUSTMENT invoices price differences of Packages that could not change. OPTIONS invoices Options of Lots that already reached the Options billing Draw, with no Lot / Draw cell.';

-- The Options of an Options Package are not billed on a Draw line -----------------------------

alter table valtrim.package_options
  alter column billing_lot_id drop not null,
  alter column draw_id drop not null,
  add column retention_amount numeric(14,2) not null default 0,
  add column wrap_amount numeric(14,2) not null default 0,
  add constraint package_options_anchor_pair_check
    check ((billing_lot_id is null) = (draw_id is null));

comment on column valtrim.package_options.draw_id is
  'The Draw line of the Package that charges the Option. Null in an Options Package, which has no Draw lines.';
comment on column valtrim.package_options.retention_amount is
  'Retention deducted on this Option. Only an Options Package keeps it here; in a Draw Package it is part of the Draw line.';
comment on column valtrim.package_options.wrap_amount is
  'WRAP deducted on this Option. Only an Options Package keeps it here; in a Draw Package it is part of the Draw line.';

grant select (retention_amount, wrap_amount) on valtrim.package_options to authenticated;

create function valtrim.check_package_option_anchor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from valtrim.draw_packages package
    where package.id = new.package_id
      and (package.package_type = 'OPTIONS') <> (new.draw_id is null)
  ) then
    raise exception 'Only an Options Package bills Options without a Draw line'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger package_options_check_anchor
before insert on valtrim.package_options
for each row execute function valtrim.check_package_option_anchor();

-- The invoice of an Options Package is the sum of its Options -----------------------------------

create function private.recalculate_options_package_totals(p_package_id bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update valtrim.invoices invoice
  set gross_amount = totals.gross_amount,
      retention_amount = totals.retention_amount,
      wrap_amount = totals.wrap_amount,
      net_amount = totals.net_amount,
      updated_at = now()
  from (
    select
      coalesce(sum(billed.option_price), 0)::valtrim.amount as gross_amount,
      coalesce(sum(billed.retention_amount), 0)::valtrim.amount as retention_amount,
      coalesce(sum(billed.wrap_amount), 0)::valtrim.amount as wrap_amount,
      coalesce(sum(
        billed.option_price - billed.retention_amount - billed.wrap_amount
      ), 0)::valtrim.amount as net_amount
    from valtrim.package_options billed
    where billed.package_id = p_package_id
  ) totals
  where invoice.package_id = p_package_id;
$$;

-- Cancelling the Package deletes its Options: the invoice goes back to zero.
create function private.options_package_totals_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from valtrim.draw_packages package
    where package.id = old.package_id and package.package_type = 'OPTIONS'
  ) then
    perform private.recalculate_options_package_totals(old.package_id);
  end if;
  return old;
end;
$$;

create trigger package_options_recalculate_invoice
after delete on valtrim.package_options
for each row execute function private.options_package_totals_after_delete();

-- What a Retention Release took from the Options Packages ----------------------------------------

create table valtrim.retention_release_option_lines (
  package_id bigint not null
    references valtrim.retention_releases(package_id) on delete restrict,
  source_package_id bigint not null,
  source_lot_id bigint not null,
  source_option_id bigint not null,
  phase_id bigint not null,
  retention_amount numeric(14,2) not null check (retention_amount <> 0),
  created_at timestamptz not null default now(),
  primary key (package_id, source_lot_id, source_option_id),
  foreign key (source_lot_id, source_option_id)
    references valtrim.package_options(lot_id, option_id) on delete restrict
);

create index retention_release_option_lines_source_idx
  on valtrim.retention_release_option_lines (source_lot_id, source_option_id);
create index retention_release_option_lines_source_package_idx
  on valtrim.retention_release_option_lines (source_package_id);
create index retention_release_option_lines_phase_idx
  on valtrim.retention_release_option_lines (phase_id);

comment on table valtrim.retention_release_option_lines is
  'Immutable Option lines of Options Packages whose retained amounts were included in one Retention Release Package.';

alter table valtrim.retention_release_option_lines enable row level security;
revoke all on valtrim.retention_release_option_lines from public, anon, authenticated;
grant select on valtrim.retention_release_option_lines to authenticated;
create policy retention_release_option_lines_select
on valtrim.retention_release_option_lines for select to authenticated
using ((select private.is_active_user()));

create trigger retention_release_option_lines_immutable
before update or delete on valtrim.retention_release_option_lines
for each row execute function valtrim.reject_retention_release_snapshot_change();

-- Creating the Package -------------------------------------------------------------------------------

create function private.create_options_package(
  p_job_id bigint,
  p_options jsonb,
  p_package_date date default current_date,
  p_notes text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_builder_id bigint;
  v_version_id bigint;
  v_line_format valtrim.invoice_line_format;
  v_retention_percentage numeric;
  v_wrap_percentage numeric;
  v_requested integer;
  v_unique integer;
  v_found integer;
  v_reached integer;
  v_billed integer;
  v_priced integer;
  v_phase_count integer;
  v_single_phase_id bigint;
  v_package_id bigint;
  v_inserted integer;
  v_gross numeric;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to create an Options Package'
      using errcode = '42501';
  end if;

  if p_job_id is null or p_job_id <= 0 then
    raise exception 'Select an active Job' using errcode = '23503';
  end if;
  if jsonb_typeof(p_options) is distinct from 'array' then
    raise exception 'Options must be a JSON array' using errcode = '23514';
  end if;
  if jsonb_array_length(p_options) = 0 or jsonb_array_length(p_options) > 5000 then
    raise exception 'Select between 1 and 5000 Options' using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_options) item
    where jsonb_typeof(item) <> 'object'
       or jsonb_typeof(item->'lot_id') is distinct from 'number'
       or jsonb_typeof(item->'option_id') is distinct from 'number'
       or item->>'lot_id' !~ '^[1-9][0-9]*$'
       or item->>'option_id' !~ '^[1-9][0-9]*$'
  ) then
    raise exception 'Every Option must have a valid Lot and Option identity'
      using errcode = '23514';
  end if;
  if p_package_date is null then
    raise exception 'Select a Package date' using errcode = '23514';
  end if;
  if p_notes is not null and char_length(btrim(p_notes)) > 500 then
    raise exception 'Package notes must contain 500 characters or fewer'
      using errcode = '23514';
  end if;

  select count(*), count(distinct row(requested.lot_id, requested.option_id))
  into v_requested, v_unique
  from jsonb_to_recordset(p_options) as requested(lot_id bigint, option_id bigint);
  if v_unique <> v_requested then
    raise exception 'Every Option must be unique' using errcode = '23514';
  end if;

  -- Same order as Package creation and corrections: the Job first.
  select
    job.builder_id,
    job.billing_setup_version_id,
    version.invoice_line_format,
    version.retention_percentage,
    version.wrap_percentage
  into v_builder_id, v_version_id, v_line_format, v_retention_percentage, v_wrap_percentage
  from valtrim.jobs job
  join valtrim.billing_setup_versions version
    on version.id = job.billing_setup_version_id
   and version.builder_id = job.builder_id
  where job.id = p_job_id
    and job.is_active
    and version.status in ('ACTIVE', 'SUPERSEDED')
  for update of job;

  if v_builder_id is null then
    raise exception 'The Job or Billing Setup is no longer available'
      using errcode = '23503';
  end if;

  select
    count(*) filter (where phase.id is not null),
    count(*) filter (
      where phase.id is not null
        and exists (
          select 1
          from valtrim.package_draws prior_line
          join valtrim.draw_packages prior_package
            on prior_package.id = prior_line.package_id
           and prior_package.job_id = p_job_id
          join valtrim.billing_setup_versions prior_version
            on prior_version.id = prior_line.setup_version_id
          where prior_line.lot_id = requested.lot_id
            and prior_line.draw_number >= prior_version.options_billing_draw_number
        )
    ),
    count(billed.option_id),
    count(price.id) filter (where phase.id is not null)
  into v_found, v_reached, v_billed, v_priced
  from jsonb_to_recordset(p_options) as requested(lot_id bigint, option_id bigint)
  left join valtrim.lot_options selected
    on selected.lot_id = requested.lot_id
   and selected.option_id = requested.option_id
  left join valtrim.lots lot on lot.id = selected.lot_id
  left join valtrim.phases phase
    on phase.id = lot.phase_id
   and phase.job_id = p_job_id
   and phase.is_active
  left join valtrim.package_options billed
    on billed.lot_id = requested.lot_id
   and billed.option_id = requested.option_id
  left join lateral (
    select candidate.id
    from valtrim.option_prices candidate
    where candidate.option_id = selected.option_id
      and (
        candidate.id = selected.option_price_id
        or (
          selected.option_price_id is null
          and candidate.effective_from <= p_package_date
          and (
            candidate.effective_to is null
            or candidate.effective_to >= p_package_date
          )
        )
      )
    order by candidate.effective_from desc, candidate.id desc
    limit 1
  ) price on true;

  if v_found <> v_requested then
    raise exception 'Every selected Option must belong to an active Lot in this Job'
      using errcode = '23503';
  end if;
  if v_reached <> v_requested then
    raise exception 'An Option can be billed on its own only after its Lot reached the Options billing Draw'
      using errcode = '23514';
  end if;
  if v_billed <> 0 then
    raise exception 'One or more selected Options were already billed'
      using errcode = '23505';
  end if;
  if v_priced <> v_requested then
    raise exception 'One or more selected Options have no current price'
      using errcode = '23514';
  end if;

  select count(distinct lot.phase_id), min(lot.phase_id)
  into v_phase_count, v_single_phase_id
  from jsonb_to_recordset(p_options) as requested(lot_id bigint, option_id bigint)
  join valtrim.lots lot on lot.id = requested.lot_id;
  if v_phase_count <> 1 then
    v_single_phase_id := null;
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
    'OP-' || lpad(nextval('valtrim.draw_package_number_seq')::text, 8, '0'),
    'OPTIONS',
    v_builder_id,
    p_job_id,
    v_single_phase_id,
    v_version_id,
    p_package_date,
    v_line_format,
    nullif(btrim(p_notes), ''),
    'DRAFT',
    v_actor_id,
    v_actor_id,
    v_actor_id
  ) returning id into v_package_id;

  insert into valtrim.invoices (package_id, created_by, updated_by)
  values (v_package_id, v_actor_id, v_actor_id);

  insert into valtrim.package_options (
    package_id,
    billing_lot_id,
    lot_id,
    option_id,
    draw_id,
    option_price_id,
    option_code,
    option_name,
    option_price,
    option_not_applicable,
    phase_id,
    phase_code,
    building,
    lot_number,
    plan_code,
    retention_amount,
    wrap_amount
  )
  select
    v_package_id,
    null,
    selected.lot_id,
    selected.option_id,
    null,
    price.id,
    option.code,
    option.name,
    price.price,
    price.is_not_applicable,
    phase.id,
    phase.code,
    phase.building,
    lot.lot_number,
    plan.code,
    round(price.price * v_retention_percentage / 100, 2),
    round(price.price * v_wrap_percentage / 100, 2)
  from jsonb_to_recordset(p_options) as requested(lot_id bigint, option_id bigint)
  join valtrim.lot_options selected
    on selected.lot_id = requested.lot_id
   and selected.option_id = requested.option_id
  join valtrim.lots lot on lot.id = selected.lot_id
  join valtrim.phases phase on phase.id = lot.phase_id
  join valtrim.plans plan on plan.id = lot.plan_id
  join valtrim.plan_options option on option.id = selected.option_id
  join lateral (
    select candidate.*
    from valtrim.option_prices candidate
    where candidate.option_id = selected.option_id
      and (
        candidate.id = selected.option_price_id
        or (
          selected.option_price_id is null
          and candidate.effective_from <= p_package_date
          and (
            candidate.effective_to is null
            or candidate.effective_to >= p_package_date
          )
        )
      )
    order by candidate.effective_from desc, candidate.id desc
    limit 1
  ) price on true
  order by phase.code, lot.lot_number, option.code;

  get diagnostics v_inserted = row_count;
  if v_inserted <> v_requested then
    raise exception 'The Package did not generate every selected Option'
      using errcode = '23514';
  end if;

  select coalesce(sum(billed.option_price), 0)
  into v_gross
  from valtrim.package_options billed
  where billed.package_id = v_package_id;
  if v_gross <= 0 then
    raise exception 'The selected Options add up to a credit or to nothing, so there is nothing to invoice'
      using errcode = '23514';
  end if;

  perform private.recalculate_options_package_totals(v_package_id);

  return v_package_id;
end;
$$;

create function valtrim.create_options_package(
  p_job_id bigint,
  p_options jsonb,
  p_package_date date default current_date,
  p_notes text default null
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.create_options_package(p_job_id, p_options, p_package_date, p_notes);
$$;

-- The Retention Release takes the retention of Options Packages too ------------------------------

CREATE OR REPLACE FUNCTION private.create_retention_release_package(p_job_id bigint, p_phase_id bigint DEFAULT NULL::bigint, p_notes text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_builder_id bigint;
  v_setup_version_id bigint;
  v_scope_type text;
  v_retention_enabled boolean;
  v_separate_hardware boolean;
  v_hardware_mode text;
  v_hardware_ext numeric;
  v_hardware_dm numeric;
  v_hardware_hw numeric;
  v_invoice_line_format valtrim.invoice_line_format;
  v_phase_code text;
  v_building text;
  v_expected_lots integer;
  v_completed_lots integer;
  v_source_cutoff_date date;
  v_available_date date;
  v_missing_cutoff boolean;
  v_retained_amount numeric(14,2);
  v_package_id bigint;
  v_inserted integer;
  v_inserted_hardware integer;
  v_inserted_adjustment integer;
  v_inserted_options integer;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to release retention'
      using errcode = '42501';
  end if;

  if p_job_id is null or p_job_id <= 0 then
    raise exception 'Select a valid Job' using errcode = '23503';
  end if;
  if p_notes is not null and char_length(btrim(p_notes)) > 500 then
    raise exception 'Package notes must contain 500 characters or fewer'
      using errcode = '23514';
  end if;

  -- Package creation/correction already locks the Job first. Keeping the same
  -- order prevents deadlocks while making the source status and balance stable.
  perform 1 from valtrim.jobs where id = p_job_id for update;

  select
    job.builder_id,
    job.billing_setup_version_id,
    version.retention_release_scope,
    version.retention_enabled,
    version.separate_hardware_price,
    version.hardware_billing_mode,
    version.hardware_ext_percentage,
    version.hardware_dm_percentage,
    version.hardware_hw_percentage,
    version.invoice_line_format
  into
    v_builder_id,
    v_setup_version_id,
    v_scope_type,
    v_retention_enabled,
    v_separate_hardware,
    v_hardware_mode,
    v_hardware_ext,
    v_hardware_dm,
    v_hardware_hw,
    v_invoice_line_format
  from valtrim.jobs job
  join valtrim.billing_setup_versions version
    on version.id = job.billing_setup_version_id
   and version.builder_id = job.builder_id
  where job.id = p_job_id
    and version.status in ('ACTIVE', 'SUPERSEDED');

  if v_builder_id is null then
    raise exception 'The Job Billing Setup is unavailable'
      using errcode = '23503';
  end if;
  if not v_retention_enabled then
    raise exception 'Retention is not enabled for this Job Billing Setup'
      using errcode = '23514';
  end if;

  if v_scope_type = 'BUILDING' then
    if p_phase_id is null or p_phase_id <= 0 then
      raise exception 'Select the Building to release'
        using errcode = '23514';
    end if;
    select phase.code, phase.building
    into v_phase_code, v_building
    from valtrim.phases phase
    where phase.id = p_phase_id
      and phase.job_id = p_job_id
      and not phase.is_utility_building;
    if v_phase_code is null then
      raise exception 'The selected Building does not belong to this Job'
        using errcode = '23503';
    end if;
  elsif v_scope_type = 'JOB' then
    if p_phase_id is not null then
      raise exception 'This Builder Setup releases retention Per Job'
        using errcode = '23514';
    end if;
  else
    raise exception 'The retention release scope is invalid'
      using errcode = '23514';
  end if;

  perform 1
  from valtrim.draw_packages package
  where package.job_id = p_job_id
  order by package.id
  for update;

  select count(*)
  into v_expected_lots
  from valtrim.lots lot
  join valtrim.phases phase
    on phase.id = lot.phase_id and phase.job_id = p_job_id
  where not lot.is_utility_building
    and (v_scope_type = 'JOB' or phase.id = p_phase_id);

  if v_expected_lots = 0 then
    raise exception 'This retention scope has no billable Lots'
      using errcode = '23514';
  end if;

  with hardware_parts as (
    select
      line.lot_id,
      case
        when not v_separate_hardware and draw.event_type = 'HW' then 'FULL'
        when v_separate_hardware
          and v_hardware_mode = 'FULL'
          and line.hardware_billing_mode = 'FULL'
          and (line.hardware_percentage > 0 or line.hardware_amount > 0)
          then 'FULL'
        when v_separate_hardware
          and v_hardware_mode = 'BY_EVENT'
          and line.hardware_billing_mode = 'BY_EVENT'
          and line.hardware_percentage > 0
          then line.hardware_event_type::text
      end as part
    from valtrim.package_draws line
    join valtrim.draw_packages package
      on package.id = line.package_id
     and package.job_id = p_job_id
     and package.package_type = 'DRAW'
     and package.status <> 'VOIDED'
     and package.workflow_status in (
       'READY_TO_SUBMIT', 'AWAITING_PAYMENT', 'PAID_CLOSED'
     )
    join valtrim.lots lot
      on lot.id = line.lot_id and not lot.is_utility_building
    join valtrim.billing_draws draw on draw.id = line.draw_id
    where (v_scope_type = 'JOB' or line.phase_id = p_phase_id)
    union all
    select line.lot_id, line.hardware_event_type::text
    from valtrim.package_hardware_lines line
    join valtrim.draw_packages package
      on package.id = line.package_id
     and package.job_id = p_job_id
     and package.package_type = 'DRAW'
     and package.status <> 'VOIDED'
     and package.workflow_status in (
       'READY_TO_SUBMIT', 'AWAITING_PAYMENT', 'PAID_CLOSED'
     )
    where v_separate_hardware
      and v_hardware_mode = 'BY_EVENT'
      and (v_scope_type = 'JOB' or line.phase_id = p_phase_id)
  )
  select count(*)
  into v_completed_lots
  from (
    select lot_id
    from hardware_parts
    where part is not null
    group by lot_id
    having count(distinct part) = case
      when v_separate_hardware and v_hardware_mode = 'BY_EVENT' then
        (v_hardware_ext > 0)::integer
        + (v_hardware_dm > 0)::integer
        + (v_hardware_hw > 0)::integer
      else 1
    end
  ) completed;

  if v_completed_lots <> v_expected_lots then
    raise exception 'Hardware must be billed for every Lot in this retention scope (% of % complete)',
      v_completed_lots, v_expected_lots
      using errcode = '23514';
  end if;

  select
    max(source.cutoff_date),
    bool_or(source.cutoff_date is null)
  into v_source_cutoff_date, v_missing_cutoff
  from (
    select distinct
      package.id,
      private.resolve_billing_cutoff_date(
        package.package_date,
        package.setup_version_id
      ) as cutoff_date
    from valtrim.package_draws line
    join valtrim.draw_packages package
      on package.id = line.package_id
     and package.job_id = p_job_id
     and package.package_type = 'DRAW'
     and package.status <> 'VOIDED'
     and package.workflow_status in (
       'READY_TO_SUBMIT', 'AWAITING_PAYMENT', 'PAID_CLOSED'
     )
    join valtrim.lots lot
      on lot.id = line.lot_id and not lot.is_utility_building
    join valtrim.billing_draws draw on draw.id = line.draw_id
    where (v_scope_type = 'JOB' or line.phase_id = p_phase_id)
      and (
        (not v_separate_hardware and draw.event_type = 'HW')
        or (
          v_separate_hardware
          and v_hardware_mode = 'FULL'
          and line.hardware_billing_mode = 'FULL'
          and (line.hardware_percentage > 0 or line.hardware_amount > 0)
        )
        or (
          v_separate_hardware
          and v_hardware_mode = 'BY_EVENT'
          and line.hardware_billing_mode = 'BY_EVENT'
          and line.hardware_percentage > 0
        )
      )
    union
    select distinct
      package.id,
      private.resolve_billing_cutoff_date(
        package.package_date,
        package.setup_version_id
      ) as cutoff_date
    from valtrim.package_hardware_lines line
    join valtrim.draw_packages package
      on package.id = line.package_id
     and package.job_id = p_job_id
     and package.package_type = 'DRAW'
     and package.status <> 'VOIDED'
     and package.workflow_status in (
       'READY_TO_SUBMIT', 'AWAITING_PAYMENT', 'PAID_CLOSED'
     )
    where v_separate_hardware
      and v_hardware_mode = 'BY_EVENT'
      and (v_scope_type = 'JOB' or line.phase_id = p_phase_id)
  ) source;

  if coalesce(v_missing_cutoff, true) or v_source_cutoff_date is null then
    raise exception 'The final Hardware Package needs a configured cutoff date before retention can be released'
      using errcode = '23514';
  end if;

  v_available_date := private.add_one_month_clamped(v_source_cutoff_date);
  if current_date < v_available_date then
    raise exception 'Retention becomes available on %', v_available_date
      using errcode = '23514';
  end if;

  select coalesce(sum(source.retention_amount), 0)
  into v_retained_amount
  from (
    select line.retention_amount
    from valtrim.package_draws line
    join valtrim.draw_packages package
      on package.id = line.package_id
     and package.job_id = p_job_id
     and package.package_type = 'DRAW'
     and package.status <> 'VOIDED'
     and package.workflow_status in (
       'READY_TO_SUBMIT', 'AWAITING_PAYMENT', 'PAID_CLOSED'
     )
    where line.retention_amount > 0
      and (v_scope_type = 'JOB' or line.phase_id = p_phase_id)
      and not exists (
        select 1
        from valtrim.retention_release_lines allocated
        join valtrim.draw_packages release_package
          on release_package.id = allocated.package_id
         and release_package.status <> 'VOIDED'
        where allocated.source_package_id = line.package_id
          and allocated.source_lot_id = line.lot_id
          and allocated.source_draw_id = line.draw_id
      )
    union all
    select line.retention_amount
    from valtrim.package_hardware_lines line
    join valtrim.draw_packages package
      on package.id = line.package_id
     and package.job_id = p_job_id
     and package.package_type = 'DRAW'
     and package.status <> 'VOIDED'
     and package.workflow_status in (
       'READY_TO_SUBMIT', 'AWAITING_PAYMENT', 'PAID_CLOSED'
     )
    where line.retention_amount > 0
      and (v_scope_type = 'JOB' or line.phase_id = p_phase_id)
      and not exists (
        select 1
        from valtrim.retention_release_hardware_lines allocated
        join valtrim.draw_packages release_package
          on release_package.id = allocated.package_id
         and release_package.status <> 'VOIDED'
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
    union all
    select billed.retention_amount
    from valtrim.package_options billed
    join valtrim.draw_packages package
      on package.id = billed.package_id
     and package.job_id = p_job_id
     and package.package_type = 'OPTIONS'
     and package.status <> 'VOIDED'
     and package.workflow_status in (
       'READY_TO_SUBMIT', 'AWAITING_PAYMENT', 'PAID_CLOSED'
     )
    where billed.retention_amount <> 0
      and (v_scope_type = 'JOB' or billed.phase_id = p_phase_id)
      and not exists (
        select 1
        from valtrim.retention_release_option_lines allocated
        join valtrim.draw_packages release_package
          on release_package.id = allocated.package_id
         and release_package.status <> 'VOIDED'
        where allocated.source_lot_id = billed.lot_id
          and allocated.source_option_id = billed.option_id
      )
  ) source;

  if v_retained_amount <= 0 then
    raise exception 'This retention scope has no unreleased amount'
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
    'RP-' || lpad(nextval('valtrim.draw_package_number_seq')::text, 8, '0'),
    'RETENTION_RELEASE',
    v_builder_id,
    p_job_id,
    case when v_scope_type = 'BUILDING' then p_phase_id end,
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
    v_retained_amount,
    0,
    0,
    v_retained_amount,
    v_actor_id,
    v_actor_id
  );

  insert into valtrim.retention_releases (
    package_id,
    job_id,
    scope_type,
    phase_id,
    phase_code,
    building,
    source_cutoff_date,
    available_date,
    retained_amount,
    created_by
  ) values (
    v_package_id,
    p_job_id,
    v_scope_type,
    case when v_scope_type = 'BUILDING' then p_phase_id end,
    case when v_scope_type = 'BUILDING' then v_phase_code end,
    case when v_scope_type = 'BUILDING' then v_building end,
    v_source_cutoff_date,
    v_available_date,
    v_retained_amount,
    v_actor_id
  );

  insert into valtrim.retention_release_lines (
    package_id,
    source_package_id,
    source_lot_id,
    source_draw_id,
    phase_id,
    retention_amount
  )
  select
    v_package_id,
    line.package_id,
    line.lot_id,
    line.draw_id,
    line.phase_id,
    line.retention_amount
  from valtrim.package_draws line
  join valtrim.draw_packages package
    on package.id = line.package_id
   and package.job_id = p_job_id
   and package.package_type = 'DRAW'
   and package.status <> 'VOIDED'
   and package.workflow_status in (
     'READY_TO_SUBMIT', 'AWAITING_PAYMENT', 'PAID_CLOSED'
   )
  where line.retention_amount > 0
    and (v_scope_type = 'JOB' or line.phase_id = p_phase_id)
    and not exists (
      select 1
      from valtrim.retention_release_lines allocated
      join valtrim.draw_packages release_package
        on release_package.id = allocated.package_id
       and release_package.status <> 'VOIDED'
      where allocated.source_package_id = line.package_id
        and allocated.source_lot_id = line.lot_id
        and allocated.source_draw_id = line.draw_id
    )
  order by line.package_id, line.phase_id, line.lot_id, line.draw_id;

  get diagnostics v_inserted = row_count;

  insert into valtrim.retention_release_hardware_lines (
    package_id,
    source_hardware_line_id,
    source_package_id,
    source_lot_id,
    hardware_event_type,
    phase_id,
    retention_amount
  )
  select
    v_package_id,
    line.id,
    line.package_id,
    line.lot_id,
    line.hardware_event_type,
    line.phase_id,
    line.retention_amount
  from valtrim.package_hardware_lines line
  join valtrim.draw_packages package
    on package.id = line.package_id
   and package.job_id = p_job_id
   and package.package_type = 'DRAW'
   and package.status <> 'VOIDED'
   and package.workflow_status in (
     'READY_TO_SUBMIT', 'AWAITING_PAYMENT', 'PAID_CLOSED'
   )
  where line.retention_amount > 0
    and (v_scope_type = 'JOB' or line.phase_id = p_phase_id)
    and not exists (
      select 1
      from valtrim.retention_release_hardware_lines allocated
      join valtrim.draw_packages release_package
        on release_package.id = allocated.package_id
       and release_package.status <> 'VOIDED'
      where allocated.source_hardware_line_id = line.id
    )
  order by line.package_id, line.phase_id, line.lot_id, line.hardware_event_type;

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

  insert into valtrim.retention_release_option_lines (
    package_id,
    source_package_id,
    source_lot_id,
    source_option_id,
    phase_id,
    retention_amount
  )
  select
    v_package_id,
    billed.package_id,
    billed.lot_id,
    billed.option_id,
    billed.phase_id,
    billed.retention_amount
  from valtrim.package_options billed
  join valtrim.draw_packages package
    on package.id = billed.package_id
   and package.job_id = p_job_id
   and package.package_type = 'OPTIONS'
   and package.status <> 'VOIDED'
   and package.workflow_status in (
     'READY_TO_SUBMIT', 'AWAITING_PAYMENT', 'PAID_CLOSED'
   )
  where billed.retention_amount <> 0
    and (v_scope_type = 'JOB' or billed.phase_id = p_phase_id)
    and not exists (
      select 1
      from valtrim.retention_release_option_lines allocated
      join valtrim.draw_packages release_package
        on release_package.id = allocated.package_id
       and release_package.status <> 'VOIDED'
      where allocated.source_lot_id = billed.lot_id
        and allocated.source_option_id = billed.option_id
    )
  order by billed.package_id, billed.phase_id, billed.lot_id, billed.option_id;

  get diagnostics v_inserted_options = row_count;
  if v_inserted + v_inserted_hardware + v_inserted_adjustment + v_inserted_options = 0 then
    raise exception 'The Retention Release did not allocate any source lines'
      using errcode = '23514';
  end if;

  return v_package_id;
end;
$function$;

-- An unpaid Options Package is owed like an unpaid Draw Package ----------------------------------

CREATE OR REPLACE FUNCTION private.get_package_release_values(p_package_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      -- What is still owed: the balance QuickBooks reports while the invoice is open (a partial
      -- payment leaves the Package Awaiting payment), else the whole net amount.
      'balance_amount', case
        when qbo.qbo_state in ('OPEN', 'OVERDUE', 'PARTIALLY_PAID')
          and qbo.qbo_balance is not null
        then least(qbo.qbo_balance, coalesce(invoice.net_amount, qbo.qbo_balance))
        else invoice.net_amount
      end,
      'balance_source', case
        when qbo.qbo_state in ('OPEN', 'OVERDUE', 'PARTIALLY_PAID')
          and qbo.qbo_balance is not null
        then 'quickbooks'
        else 'invoice'
      end,
      'status', other.status,
      'workflow_status', other.workflow_status
    )
    order by other.package_date, other.id
  ), '[]'::jsonb)
    into v_pending
  from valtrim.draw_packages other
  left join valtrim.invoices invoice on invoice.package_id = other.id
  left join valtrim.quickbooks_invoice_syncs qbo on qbo.package_id = other.id
  where other.job_id = v_package.job_id
    and other.id <> v_package.id
    and other.package_type in ('DRAW', 'OPTIONS')
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
$function$;

-- Guards that know the new type --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION valtrim.validate_package_workflow_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.workflow_status is not distinct from old.workflow_status then
    return new;
  end if;

  if new.package_type = 'DRAW'
     and new.workflow_status = 'DRAFT'
     and (
       exists (
         select 1
         from valtrim.retention_release_lines allocated
         join valtrim.draw_packages release_package
           on release_package.id = allocated.package_id
          and release_package.status <> 'VOIDED'
         where allocated.source_package_id = new.id
       )
       or exists (
         select 1
         from valtrim.retention_release_hardware_lines allocated
         join valtrim.draw_packages release_package
           on release_package.id = allocated.package_id
          and release_package.status <> 'VOIDED'
         where allocated.source_package_id = new.id
       )
     ) then
    raise exception 'Cancel the active Retention Release before returning its source Package to Draft'
      using errcode = '23514';
  end if;

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

  if new.package_type = 'OPTIONS'
     and new.workflow_status = 'DRAFT'
     and exists (
       select 1
       from valtrim.retention_release_option_lines allocated
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
       where line.package_id = new.id
     )
     and not exists (
       select 1 from valtrim.package_hardware_lines line
       where line.package_id = new.id
     )
     and not exists (
       select 1 from valtrim.retention_release_lines line
       where line.package_id = new.id
     )
     and not exists (
       select 1 from valtrim.retention_release_hardware_lines line
       where line.package_id = new.id
     )
     and not exists (
       select 1 from valtrim.price_adjustment_lines line
       where line.package_id = new.id
     )
     and not exists (
       select 1 from valtrim.package_options line
       where line.package_id = new.id
     ) then
    raise exception 'A package without calculated lines cannot leave DRAFT'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION valtrim.prevent_allocated_source_package_void()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.package_type in ('DRAW', 'PRICE_ADJUSTMENT', 'OPTIONS')
     and new.status = 'VOIDED'
     and old.status <> 'VOIDED'
     and (
       exists (
         select 1
         from valtrim.retention_release_lines allocated
         join valtrim.draw_packages release_package
           on release_package.id = allocated.package_id
          and release_package.status <> 'VOIDED'
         where allocated.source_package_id = new.id
       )
       or exists (
         select 1
         from valtrim.retention_release_hardware_lines allocated
         join valtrim.draw_packages release_package
           on release_package.id = allocated.package_id
          and release_package.status <> 'VOIDED'
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
       or exists (
         select 1
         from valtrim.retention_release_option_lines allocated
         join valtrim.draw_packages release_package
           on release_package.id = allocated.package_id
          and release_package.status <> 'VOIDED'
         where allocated.source_package_id = new.id
       )
     ) then
    raise exception 'Cancel the active Retention Release before cancelling its source Package'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

-- Permissions ------------------------------------------------------------------------------------------

revoke execute on function private.create_options_package(bigint, jsonb, date, text)
  from public, anon, authenticated;
revoke execute on function valtrim.create_options_package(bigint, jsonb, date, text)
  from public, anon, authenticated;
revoke execute on function private.recalculate_options_package_totals(bigint)
  from public, anon, authenticated;
revoke execute on function private.options_package_totals_after_delete()
  from public, anon, authenticated;
grant execute on function private.create_options_package(bigint, jsonb, date, text)
  to authenticated, service_role;
grant execute on function valtrim.create_options_package(bigint, jsonb, date, text)
  to authenticated, service_role;

comment on function valtrim.create_options_package(bigint, jsonb, date, text) is
  'Creates an Options Package that invoices Options of Lots that already reached the Options billing Draw, with no Lot / Draw cell. p_options is an array of { lot_id, option_id }.';

notify pgrst, 'reload schema';

commit;
