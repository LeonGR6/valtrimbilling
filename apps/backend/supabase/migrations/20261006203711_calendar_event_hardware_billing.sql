-- Separate Hardware is triggered by Calendar EXT / DM / HW events, not by
-- Billing Draw rows. The immutable Package snapshot therefore lives in its own
-- table and can be created even when the Package contains no Draw cells.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Hardware event allocation is independent from the Draw schedule. Utility
-- keeps its existing rule because Utility is still billed on Draw rows.
do $migration$
declare
  v_definition text;
  v_expected text := $source$    if (v_hardware_ext > 0 and not exists (
      select 1 from billing_draws
      where setup_version_id = p_version_id and event_type = 'EXT'
    )) or (v_hardware_dm > 0 and not exists (
      select 1 from billing_draws
      where setup_version_id = p_version_id and event_type = 'DM'
    )) or (v_hardware_hw > 0 and not exists (
      select 1 from billing_draws
      where setup_version_id = p_version_id and event_type = 'HW'
    )) then
      raise exception 'Every Hardware allocation needs a matching Draw event'
        using errcode = '23514';
    end if;
$source$;
begin
  select pg_get_functiondef(
    'valtrim.validate_setup_version(bigint)'::regprocedure
  ) into v_definition;

  if position(v_expected in v_definition) = 0 then
    raise exception 'Hardware Draw-event validation did not match the expected definition';
  end if;

  execute replace(v_definition, v_expected, '');
end;
$migration$;

create table valtrim.package_hardware_lines (
  id bigint generated always as identity primary key,
  package_id bigint not null,
  job_id bigint not null,
  lot_id bigint not null,
  phase_id bigint not null,
  builder_id bigint not null,
  setup_version_id bigint not null,
  plan_id bigint not null,
  plan_price_id bigint not null,
  lot_number varchar(40) not null,
  phase_code varchar(40) not null,
  building varchar(80),
  plan_code varchar(40) not null,
  plan_name varchar(100) not null,
  is_reverse boolean not null,
  hardware_price valtrim.amount not null,
  hardware_billing_mode text not null default 'BY_EVENT'
    check (hardware_billing_mode = 'BY_EVENT'),
  hardware_event_type valtrim.production_stage_type not null,
  hardware_percentage valtrim.percentage not null
    check (hardware_percentage > 0),
  hardware_amount valtrim.amount not null,
  gross_amount valtrim.amount not null,
  retention_percentage valtrim.percentage not null default 0,
  retention_amount valtrim.amount not null default 0,
  wrap_percentage valtrim.percentage not null default 0,
  wrap_amount valtrim.amount not null default 0,
  net_amount valtrim.amount not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (package_id, lot_id, hardware_event_type),
  foreign key (package_id, builder_id)
    references valtrim.draw_packages(id, builder_id) on delete restrict,
  foreign key (lot_id, phase_id)
    references valtrim.lots(id, phase_id) on delete restrict,
  foreign key (lot_id, plan_id)
    references valtrim.lots(id, plan_id) on delete restrict,
  foreign key (plan_price_id, plan_id)
    references valtrim.plan_prices(id, plan_id) on delete restrict,
  check (gross_amount = hardware_amount),
  check (hardware_amount <= hardware_price),
  check (net_amount = gross_amount - retention_amount - wrap_amount)
);

comment on table valtrim.package_hardware_lines is
  'Immutable Separate Hardware portions triggered by Calendar EXT, DM or HW events independently from Billing Draws.';
comment on column valtrim.package_hardware_lines.hardware_event_type is
  'Calendar event that made this configured Separate Hardware portion billable.';

create index package_hardware_lines_package_idx
  on valtrim.package_hardware_lines (package_id);
create index package_hardware_lines_job_lot_event_idx
  on valtrim.package_hardware_lines (job_id, lot_id, hardware_event_type);
create index package_hardware_lines_phase_idx
  on valtrim.package_hardware_lines (phase_id);

alter table valtrim.package_hardware_lines enable row level security;
revoke all on valtrim.package_hardware_lines from public, anon, authenticated;
grant select on valtrim.package_hardware_lines to authenticated;
grant all on valtrim.package_hardware_lines to service_role;

create policy package_hardware_lines_select
on valtrim.package_hardware_lines for select to authenticated
using ((select private.is_active_user()));

create function valtrim.prepare_package_hardware_line()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_record record;
  v_event_order integer;
  v_prior_amount numeric(14,2);
begin
  perform pg_catalog.pg_advisory_xact_lock(new.lot_id);

  select
    package.job_id,
    package.builder_id,
    package.setup_version_id,
    package.package_date,
    phase.id as phase_id,
    phase.code as phase_code,
    phase.building,
    lot.plan_id,
    lot.lot_number,
    lot.is_reverse,
    plan.code as plan_code,
    plan.name as plan_name,
    price.id as plan_price_id,
    price.hardware_price,
    version.separate_hardware_price,
    version.hardware_billing_mode,
    version.hardware_ext_percentage,
    version.hardware_dm_percentage,
    version.hardware_hw_percentage,
    version.retention_percentage,
    version.wrap_percentage
  into v_record
  from valtrim.draw_packages package
  join valtrim.lots lot on lot.id = new.lot_id and not lot.is_utility_building
  join valtrim.phases phase
    on phase.id = lot.phase_id
   and phase.job_id = package.job_id
   and phase.is_active
  join valtrim.plans plan
    on plan.id = lot.plan_id and plan.job_id = package.job_id
  join valtrim.billing_setup_versions version
    on version.id = package.setup_version_id
   and version.builder_id = package.builder_id
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
  ) price on true
  where package.id = new.package_id
    and package.package_type = 'DRAW'
    and package.status = 'DRAFT';

  if v_record.plan_id is null then
    raise exception 'Separate Hardware could not be calculated: review Package, Lot and current Plan price'
      using errcode = '23503';
  end if;
  if not v_record.separate_hardware_price
     or v_record.hardware_billing_mode <> 'BY_EVENT' then
    raise exception 'This Job Billing Setup does not use Separate Hardware by Calendar event'
      using errcode = '23514';
  end if;

  new.hardware_percentage := case new.hardware_event_type
    when 'EXT' then v_record.hardware_ext_percentage
    when 'DM' then v_record.hardware_dm_percentage
    when 'HW' then v_record.hardware_hw_percentage
    else 0
  end;
  v_event_order := case new.hardware_event_type
    when 'EXT' then 1 when 'DM' then 2 when 'HW' then 3 else 0
  end;

  if new.hardware_percentage <= 0 then
    raise exception 'This Calendar event has no Separate Hardware allocation in the Builder Setup'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from valtrim.package_hardware_lines prior_line
    join valtrim.draw_packages prior_package
      on prior_package.id = prior_line.package_id
     and prior_package.status <> 'VOIDED'
    where prior_package.job_id = v_record.job_id
      and prior_line.lot_id = new.lot_id
      and prior_line.hardware_event_type = new.hardware_event_type
  ) or exists (
    select 1
    from valtrim.package_draws prior_line
    join valtrim.draw_packages prior_package
      on prior_package.id = prior_line.package_id
     and prior_package.status <> 'VOIDED'
    where prior_package.job_id = v_record.job_id
      and prior_line.lot_id = new.lot_id
      and (
        prior_line.hardware_billing_mode = 'FULL'
        or prior_line.hardware_event_type = new.hardware_event_type
      )
      and (
        prior_line.hardware_percentage > 0
        or prior_line.hardware_amount > 0
      )
  ) then
    raise exception 'This Separate Hardware event portion was already billed in another Package'
      using errcode = '23505';
  end if;

  new.job_id := v_record.job_id;
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
  new.is_reverse := v_record.is_reverse;
  new.hardware_price := v_record.hardware_price;
  new.hardware_billing_mode := 'BY_EVENT';

  if not exists (
    select 1
    from (values
      (1, v_record.hardware_ext_percentage),
      (2, v_record.hardware_dm_percentage),
      (3, v_record.hardware_hw_percentage)
    ) as later_event(event_order, percentage)
    where later_event.event_order > v_event_order
      and later_event.percentage > 0
  ) then
    select coalesce(sum(round(
      new.hardware_price * prior_event.percentage / 100, 2
    )), 0)
    into v_prior_amount
    from (values
      (1, v_record.hardware_ext_percentage),
      (2, v_record.hardware_dm_percentage),
      (3, v_record.hardware_hw_percentage)
    ) as prior_event(event_order, percentage)
    where prior_event.event_order < v_event_order
      and prior_event.percentage > 0;
    new.hardware_amount := new.hardware_price - v_prior_amount;
  else
    new.hardware_amount := round(
      new.hardware_price * new.hardware_percentage / 100, 2
    );
  end if;

  new.gross_amount := new.hardware_amount;
  new.retention_percentage := v_record.retention_percentage;
  new.retention_amount := round(
    new.gross_amount * new.retention_percentage / 100, 2
  );
  new.wrap_percentage := v_record.wrap_percentage;
  new.wrap_amount := round(new.gross_amount * new.wrap_percentage / 100, 2);
  new.net_amount := new.gross_amount - new.retention_amount - new.wrap_amount;
  new.created_by := (select auth.uid());
  return new;
end;
$$;

create trigger package_hardware_lines_prepare
before insert on valtrim.package_hardware_lines
for each row execute function valtrim.prepare_package_hardware_line();

create function valtrim.reject_package_hardware_line_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and current_setting('valtrim.draw_package_correction', true) = 'on'
     and (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT'))
     and not exists (
       select 1
       from valtrim.retention_release_hardware_lines allocated
       join valtrim.draw_packages release_package
         on release_package.id = allocated.package_id
        and release_package.status <> 'VOIDED'
       where allocated.source_hardware_line_id = old.id
     ) then
    return old;
  end if;

  raise exception 'Calculated Separate Hardware lines are immutable'
    using errcode = '42501';
end;
$$;

create trigger package_hardware_lines_immutable
before update or delete on valtrim.package_hardware_lines
for each row execute function valtrim.reject_package_hardware_line_change();

create function valtrim.reject_retention_release_hardware_line()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from valtrim.draw_packages package
    where package.id = new.package_id
      and package.package_type = 'RETENTION_RELEASE'
  ) then
    raise exception 'A Retention Release Package cannot contain Separate Hardware lines'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger package_hardware_lines_reject_retention_release
before insert on valtrim.package_hardware_lines
for each row execute function valtrim.reject_retention_release_hardware_line();

create table valtrim.retention_release_hardware_lines (
  package_id bigint not null
    references valtrim.retention_releases(package_id) on delete restrict,
  source_hardware_line_id bigint not null,
  source_package_id bigint not null
    references valtrim.draw_packages(id) on delete restrict,
  source_lot_id bigint not null,
  hardware_event_type valtrim.production_stage_type not null,
  phase_id bigint not null,
  retention_amount valtrim.amount not null check (retention_amount > 0),
  created_at timestamptz not null default now(),
  primary key (package_id, source_hardware_line_id)
);

comment on table valtrim.retention_release_hardware_lines is
  'Immutable allocation of retention from independent Separate Hardware Package lines.';

create index retention_release_hardware_source_idx
  on valtrim.retention_release_hardware_lines (source_hardware_line_id);
create index retention_release_hardware_package_idx
  on valtrim.retention_release_hardware_lines (source_package_id);

alter table valtrim.retention_release_hardware_lines enable row level security;
revoke all on valtrim.retention_release_hardware_lines
  from public, anon, authenticated;
grant select on valtrim.retention_release_hardware_lines to authenticated;
grant all on valtrim.retention_release_hardware_lines to service_role;

create policy retention_release_hardware_lines_select
on valtrim.retention_release_hardware_lines for select to authenticated
using ((select private.is_active_user()));

create trigger retention_release_hardware_lines_immutable
before update or delete on valtrim.retention_release_hardware_lines
for each row execute function valtrim.reject_retention_release_snapshot_change();

create or replace function valtrim.recalculate_invoice_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_package_id bigint;
begin
  v_package_id := case when tg_op = 'DELETE'
    then old.package_id else new.package_id end;

  update valtrim.invoices invoice
  set gross_amount = totals.gross_amount,
      retention_amount = totals.retention_amount,
      wrap_amount = totals.wrap_amount,
      net_amount = totals.net_amount,
      updated_at = now()
  from (
    select
      coalesce(sum(line.gross_amount), 0)::valtrim.amount as gross_amount,
      coalesce(sum(line.retention_amount), 0)::valtrim.amount as retention_amount,
      coalesce(sum(line.wrap_amount), 0)::valtrim.amount as wrap_amount,
      coalesce(sum(line.net_amount), 0)::valtrim.amount as net_amount
    from (
      select gross_amount, retention_amount, wrap_amount, net_amount
      from valtrim.package_draws
      where package_id = v_package_id
      union all
      select gross_amount, retention_amount, wrap_amount, net_amount
      from valtrim.package_hardware_lines
      where package_id = v_package_id
    ) line
  ) totals
  where invoice.package_id = v_package_id;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger package_hardware_lines_recalculate_invoice
after insert or update or delete on valtrim.package_hardware_lines
for each row execute function valtrim.recalculate_invoice_totals();

create function private.create_draw_invoice_package_with_hardware_events(
  p_job_id bigint,
  p_selections jsonb default '[]'::jsonb,
  p_hardware_selections jsonb default '[]'::jsonb,
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
  v_package_id bigint;
  v_builder_id bigint;
  v_version_id bigint;
  v_invoice_line_format valtrim.invoice_line_format;
  v_hardware_mode text;
  v_separate_hardware boolean;
  v_draw_selections jsonb;
  v_draw_count integer;
  v_hardware_count integer;
  v_unique integer;
  v_invalid integer;
  v_found integer;
  v_inserted integer;
  v_phase_count integer;
  v_single_phase_id bigint;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to change Draw & Invoice Packages'
      using errcode = '42501';
  end if;

  if p_job_id is null or p_job_id <= 0 then
    raise exception 'Select an active Job' using errcode = '23503';
  end if;
  if jsonb_typeof(p_selections) is distinct from 'array'
     or jsonb_typeof(p_hardware_selections) is distinct from 'array' then
    raise exception 'Draw and Separate Hardware selections must be JSON arrays'
      using errcode = '23514';
  end if;

  v_draw_count := jsonb_array_length(p_selections);
  v_hardware_count := jsonb_array_length(p_hardware_selections);
  if v_draw_count + v_hardware_count = 0
     or v_draw_count + v_hardware_count > 5000 then
    raise exception 'Select between 1 and 5000 billing items'
      using errcode = '23514';
  end if;
  if p_package_date is null then
    raise exception 'Select a Package date' using errcode = '23514';
  end if;
  if p_notes is not null and char_length(btrim(p_notes)) > 500 then
    raise exception 'Package notes must contain 500 characters or fewer'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_hardware_selections) item
    where jsonb_typeof(item) <> 'object'
       or jsonb_typeof(item->'lot_id') is distinct from 'number'
       or jsonb_typeof(item->'event_type') is distinct from 'string'
       or item->>'lot_id' !~ '^[1-9][0-9]*$'
       or item->>'event_type' not in ('EXT', 'DM', 'HW')
  ) then
    raise exception 'Every Separate Hardware selection needs a valid Lot and Calendar event'
      using errcode = '23514';
  end if;

  select
    count(distinct row(selection.lot_id, selection.event_type)),
    count(*) filter (where selection.lot_id <= 0)
  into v_unique, v_invalid
  from jsonb_to_recordset(p_hardware_selections)
    as selection(lot_id bigint, event_type text);

  if v_unique <> v_hardware_count or v_invalid <> 0 then
    raise exception 'Every Separate Hardware Lot / Calendar event selection must be unique'
      using errcode = '23514';
  end if;

  perform 1 from valtrim.jobs where id = p_job_id for update;

  select
    job.builder_id,
    job.billing_setup_version_id,
    version.invoice_line_format,
    version.separate_hardware_price,
    version.hardware_billing_mode
  into
    v_builder_id,
    v_version_id,
    v_invoice_line_format,
    v_separate_hardware,
    v_hardware_mode
  from valtrim.jobs job
  join valtrim.billing_setup_versions version
    on version.id = job.billing_setup_version_id
   and version.builder_id = job.builder_id
  where job.id = p_job_id
    and job.is_active
    and version.status in ('ACTIVE', 'SUPERSEDED');

  if v_builder_id is null then
    raise exception 'The Job or Billing Setup is no longer available'
      using errcode = '23503';
  end if;
  if v_hardware_count > 0 and (
    not v_separate_hardware or v_hardware_mode <> 'BY_EVENT'
  ) then
    raise exception 'This Job Billing Setup does not use Separate Hardware by Calendar event'
      using errcode = '23514';
  end if;

  select count(*)
  into v_found
  from jsonb_to_recordset(p_hardware_selections)
    as selection(lot_id bigint, event_type text)
  join valtrim.lots lot
    on lot.id = selection.lot_id
   and not lot.is_utility_building
  join valtrim.phases phase
    on phase.id = lot.phase_id
   and phase.job_id = p_job_id
   and phase.is_active;

  if v_found <> v_hardware_count then
    raise exception 'Every Separate Hardware selection must belong to an active non-Utility Lot in this Job'
      using errcode = '23503';
  end if;

  -- New BY_EVENT setups persist Hardware outside Draw rows. Removing this flag
  -- also prevents older clients from recreating the legacy Draw attachment.
  if v_hardware_mode = 'BY_EVENT' and v_draw_count > 0 then
    select jsonb_agg(item.value - 'charge_hardware' order by item.ordinality)
    into v_draw_selections
    from jsonb_array_elements(p_selections) with ordinality item(value, ordinality);
  else
    v_draw_selections := p_selections;
  end if;

  if v_draw_count > 0 then
    v_package_id := private.create_draw_invoice_package(
      p_job_id,
      v_draw_selections,
      p_package_date,
      p_notes
    );
  else
    insert into valtrim.draw_packages (
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
      v_builder_id,
      p_job_id,
      null,
      v_version_id,
      p_package_date,
      v_invoice_line_format,
      nullif(btrim(p_notes), ''),
      'DRAFT',
      v_actor_id,
      v_actor_id,
      v_actor_id
    ) returning id into v_package_id;

    insert into valtrim.invoices (package_id, created_by, updated_by)
    values (v_package_id, v_actor_id, v_actor_id);
  end if;

  insert into valtrim.package_hardware_lines (
    package_id,
    lot_id,
    hardware_event_type,
    job_id,
    phase_id,
    builder_id,
    setup_version_id,
    plan_id,
    plan_price_id,
    lot_number,
    phase_code,
    plan_code,
    plan_name,
    is_reverse,
    hardware_price,
    hardware_percentage,
    hardware_amount,
    gross_amount,
    net_amount
  )
  select
    v_package_id,
    selection.lot_id,
    selection.event_type::valtrim.production_stage_type,
    p_job_id,
    lot.phase_id,
    v_builder_id,
    v_version_id,
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
  from jsonb_to_recordset(p_hardware_selections)
    as selection(lot_id bigint, event_type text)
  join valtrim.lots lot on lot.id = selection.lot_id
  join valtrim.phases phase on phase.id = lot.phase_id
  join valtrim.plans plan on plan.id = lot.plan_id
  join lateral (
    select candidate.*
    from valtrim.plan_prices candidate
    where candidate.plan_id = lot.plan_id
      and candidate.effective_from <= p_package_date
      and (
        candidate.effective_to is null
        or candidate.effective_to >= p_package_date
      )
    order by candidate.effective_from desc
    limit 1
  ) price on true
  order by phase.code, lot.lot_number, selection.event_type;

  get diagnostics v_inserted = row_count;
  if v_inserted <> v_hardware_count then
    raise exception 'Every Separate Hardware selection needs a current Plan price'
      using errcode = '23503';
  end if;

  select count(distinct source.phase_id), min(source.phase_id)
  into v_phase_count, v_single_phase_id
  from (
    select line.phase_id
    from valtrim.package_draws line
    where line.package_id = v_package_id
    union all
    select line.phase_id
    from valtrim.package_hardware_lines line
    where line.package_id = v_package_id
  ) source;

  if v_phase_count <> 1 then
    v_single_phase_id := null;
  end if;

  perform set_config('valtrim.draw_package_correction', 'on', true);
  update valtrim.draw_packages
  set phase_id = v_single_phase_id,
      updated_by = v_actor_id,
      updated_at = now()
  where id = v_package_id
    and phase_id is distinct from v_single_phase_id;
  perform set_config('valtrim.draw_package_correction', '', true);

  return v_package_id;
end;
$$;

create function valtrim.create_draw_invoice_package_with_hardware_events(
  p_job_id bigint,
  p_selections jsonb default '[]'::jsonb,
  p_hardware_selections jsonb default '[]'::jsonb,
  p_package_date date default current_date,
  p_notes text default null
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.create_draw_invoice_package_with_hardware_events(
    p_job_id,
    p_selections,
    p_hardware_selections,
    p_package_date,
    p_notes
  );
$$;

revoke execute on function private.create_draw_invoice_package_with_hardware_events(
  bigint, jsonb, jsonb, date, text
) from public, anon;
revoke execute on function valtrim.create_draw_invoice_package_with_hardware_events(
  bigint, jsonb, jsonb, date, text
) from public, anon;
grant execute on function private.create_draw_invoice_package_with_hardware_events(
  bigint, jsonb, jsonb, date, text
) to authenticated, service_role;
grant execute on function valtrim.create_draw_invoice_package_with_hardware_events(
  bigint, jsonb, jsonb, date, text
) to authenticated, service_role;

comment on function valtrim.create_draw_invoice_package_with_hardware_events(
  bigint, jsonb, jsonb, date, text
) is
  'Creates one auditable Package from Draw cells and/or Calendar-triggered Separate Hardware portions.';

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,text)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    $source$  elsif p_other_package_id is not null then
    raise exception 'Only a transfer may name another Package'
      using errcode = '23514';
  end if;

  if p_action <> 'CANCEL' then$source$,
    $source$  elsif p_other_package_id is not null then
    raise exception 'Only a transfer may name another Package'
      using errcode = '23514';
  end if;

  if p_action <> 'CANCEL' and exists (
    select 1
    from valtrim.package_hardware_lines line
    where line.package_id = p_package_id
       or (p_action = 'TRANSFER' and line.package_id = p_other_package_id)
  ) then
    raise exception 'Packages with Calendar-triggered Separate Hardware must be cancelled and recreated'
      using errcode = '23514';
  end if;

  if p_action <> 'CANCEL' then$source$
  );
  if v_updated = v_definition then
    raise exception 'Package correction Hardware guard did not match';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $source$    delete from valtrim.package_options where package_id = p_package_id;
    delete from valtrim.package_draws where package_id = p_package_id;$source$,
    $source$    delete from valtrim.package_options where package_id = p_package_id;
    delete from valtrim.package_hardware_lines where package_id = p_package_id;
    delete from valtrim.package_draws where package_id = p_package_id;$source$
  );
  if v_updated = v_definition then
    raise exception 'Package cancellation Hardware cleanup did not match';
  end if;

  execute v_updated;
end;
$migration$;

create or replace function valtrim.validate_package_workflow_status_change()
returns trigger
language plpgsql
set search_path = ''
as $$
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
     ) then
    raise exception 'A package without calculated lines cannot leave DRAFT'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function valtrim.prevent_allocated_source_package_void()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.package_type = 'DRAW'
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
     ) then
    raise exception 'Cancel the active Retention Release before cancelling its source Package'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Extend the established Retention Release RPC without duplicating its role,
-- scope, cutoff and audit rules. Every replacement is asserted so schema drift
-- fails the migration atomically instead of silently weakening retention.
do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'private.create_retention_release_package(bigint,bigint,text)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    $source$  v_inserted integer;
begin$source$,
    $source$  v_inserted integer;
  v_inserted_hardware integer;
begin$source$
  );
  if v_updated = v_definition then
    raise exception 'Retention Hardware insert declaration did not match';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $source$  select count(*)
  into v_completed_lots
  from (
    select line.lot_id
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
    join valtrim.billing_draws draw
      on draw.id = line.draw_id
    where (v_scope_type = 'JOB' or line.phase_id = p_phase_id)
    group by line.lot_id
    having (
      not v_separate_hardware
      and bool_or(draw.event_type = 'HW')
    ) or (
      v_separate_hardware
      and v_hardware_mode = 'FULL'
      and bool_or(
        line.hardware_billing_mode = 'FULL'
        and (line.hardware_percentage > 0 or line.hardware_amount > 0)
      )
    ) or (
      v_separate_hardware
      and v_hardware_mode = 'BY_EVENT'
      and count(distinct line.hardware_event_type) filter (
        where line.hardware_billing_mode = 'BY_EVENT'
          and line.hardware_percentage > 0
      ) = (
        (v_hardware_ext > 0)::integer
        + (v_hardware_dm > 0)::integer
        + (v_hardware_hw > 0)::integer
      )
    )
  ) completed;$source$,
    $source$  with hardware_parts as (
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
  ) completed;$source$
  );
  if v_updated = v_definition then
    raise exception 'Retention Hardware completion query did not match';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $source$  select
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
    join valtrim.billing_draws draw
      on draw.id = line.draw_id
    where (v_scope_type = 'JOB' or line.phase_id = p_phase_id)
      and (
        (
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
        or (not v_separate_hardware and draw.event_type = 'HW')
      )
  ) source;$source$,
    $source$  select
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
  ) source;$source$
  );
  if v_updated = v_definition then
    raise exception 'Retention Hardware cutoff query did not match';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $source$  select coalesce(sum(line.retention_amount), 0)
  into v_retained_amount
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
    );$source$,
    $source$  select coalesce(sum(source.retention_amount), 0)
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
  ) source;$source$
  );
  if v_updated = v_definition then
    raise exception 'Retention Hardware amount query did not match';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $source$  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    raise exception 'The Retention Release did not allocate any source lines'
      using errcode = '23514';
  end if;$source$,
    $source$  get diagnostics v_inserted = row_count;

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
  if v_inserted + v_inserted_hardware = 0 then
    raise exception 'The Retention Release did not allocate any source lines'
      using errcode = '23514';
  end if;$source$
  );
  if v_updated = v_definition then
    raise exception 'Retention Hardware source allocation did not match';
  end if;

  execute v_updated;
end;
$migration$;

notify pgrst, 'reload schema';

commit;
