-- A Builder Setup may have a single Draw, and the Utility Building is billed like Separate
-- Hardware: 100% (or a split) across the EXT / DM / HW Calendar events, whether or not those
-- events are Draws. Each charged portion is an immutable line of its own
-- (package_utility_lines), so a Package can bill a Utility row without any Lot Draw cell.
--
-- Utility charges billed before this change stay on their Draw rows (package_draws) as history:
-- every check of "already billed" reads both places, so they are never offered again. Setup
-- versions saved with the old FULL Utility mode keep working on Draw rows until the Builder
-- Setup is edited; a new save must allocate Utility by Calendar event.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Swaps one piece of a live function definition, refusing when it is not there exactly
-- p_count times, so a definition that changed meanwhile stops the migration.
create function pg_temp.swap(
  p_definition text,
  p_old text,
  p_new text,
  p_label text,
  p_count integer default 1
)
returns text
language plpgsql
as $$
declare
  v_found integer;
begin
  v_found := (char_length(p_definition) - char_length(replace(p_definition, p_old, '')))
    / greatest(char_length(p_old), 1);
  if v_found <> p_count then
    raise exception 'Utility by Calendar event: % matched % time(s), expected %',
      p_label, v_found, p_count;
  end if;
  return replace(p_definition, p_old, p_new);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Builder Setup rules: 1 to 5 Draws; Utility allocated by Calendar event.
-- ---------------------------------------------------------------------------

-- A single Draw bills 100%.
alter table valtrim.billing_draws
  drop constraint billing_draws_percentage_check;
alter table valtrim.billing_draws
  add constraint billing_draws_percentage_check
    check (percentage > 0 and percentage <= 100);

create or replace function valtrim.validate_setup_version(p_version_id bigint)
returns void
language plpgsql
set search_path to 'valtrim', 'pg_catalog'
as $function$
declare
  v_count integer;
  v_min smallint;
  v_max smallint;
  v_total numeric;
  v_options_draw smallint;
  v_hardware_draw smallint;
  v_separate_hardware boolean;
  v_hardware_mode text;
  v_hardware_ext numeric;
  v_hardware_dm numeric;
  v_hardware_hw numeric;
  v_utility_building boolean;
  v_utility_mode text;
  v_utility_ext numeric;
  v_utility_dm numeric;
  v_utility_hw numeric;
begin
  select count(*), min(draw_number), max(draw_number), sum(percentage)
  into v_count, v_min, v_max, v_total
  from billing_draws
  where setup_version_id = p_version_id;

  if v_count < 1 or v_count > 5 then
    raise exception 'La configuracion debe tener entre 1 y 5 draws';
  end if;
  if v_min <> 1 or v_max <> v_count then
    raise exception 'Los draws deben ser consecutivos y comenzar en 1';
  end if;
  if v_total <> 100 then
    raise exception 'Los porcentajes de los draws deben sumar 100';
  end if;

  select
    options_billing_draw_number,
    hardware_billing_draw_number,
    separate_hardware_price,
    hardware_billing_mode,
    hardware_ext_percentage,
    hardware_dm_percentage,
    hardware_hw_percentage,
    utility_building,
    utility_billing_mode,
    utility_ext_percentage,
    utility_dm_percentage,
    utility_hw_percentage
  into
    v_options_draw,
    v_hardware_draw,
    v_separate_hardware,
    v_hardware_mode,
    v_hardware_ext,
    v_hardware_dm,
    v_hardware_hw,
    v_utility_building,
    v_utility_mode,
    v_utility_ext,
    v_utility_dm,
    v_utility_hw
  from billing_setup_versions
  where id = p_version_id;

  if v_options_draw is not null and not exists (
    select 1 from billing_draws
    where setup_version_id = p_version_id and draw_number = v_options_draw
  ) then
    raise exception 'El draw configurado para options no existe';
  end if;
  if v_hardware_draw is not null and not exists (
    select 1 from billing_draws
    where setup_version_id = p_version_id and draw_number = v_hardware_draw
  ) then
    raise exception 'El draw configurado para hardware no existe';
  end if;

  if v_separate_hardware and v_hardware_mode <> 'BY_EVENT' then
    raise exception 'New Separate Hardware setups must allocate 100 percent by Draw event'
      using errcode = '23514';
  end if;

  if v_separate_hardware and v_hardware_mode = 'BY_EVENT' then
    if v_hardware_ext + v_hardware_dm + v_hardware_hw <> 100 then
      raise exception 'Hardware event percentages must total 100'
        using errcode = '23514';
    end if;
  end if;

  -- Like Separate Hardware, the Utility Building follows the Calendar events, which do not
  -- need to be Draws.
  if v_utility_building and v_utility_mode <> 'BY_EVENT' then
    raise exception 'New Utility Building setups must allocate 100 percent by Calendar event'
      using errcode = '23514';
  end if;

  if v_utility_building and v_utility_mode = 'BY_EVENT' then
    if v_utility_ext + v_utility_dm + v_utility_hw <> 100 then
      raise exception 'Utility event percentages must total 100'
        using errcode = '23514';
    end if;
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. The Utility lines of a Package, one per Utility row and Calendar event.
-- ---------------------------------------------------------------------------

create table valtrim.package_utility_lines (
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
  utility_name varchar(80),
  phase_code varchar(40) not null,
  building varchar(80),
  plan_code varchar(40) not null,
  plan_name varchar(100) not null,
  is_reverse boolean not null,
  base_price valtrim.amount not null,
  utility_billing_mode text not null default 'BY_EVENT'
    check (utility_billing_mode = 'BY_EVENT'),
  utility_event_type valtrim.production_stage_type not null,
  utility_percentage valtrim.percentage not null
    check (utility_percentage > 0),
  utility_amount valtrim.amount not null,
  gross_amount valtrim.amount not null,
  retention_percentage valtrim.percentage not null default 0,
  retention_amount valtrim.amount not null default 0,
  wrap_percentage numeric(5,3) not null default 0
    check (wrap_percentage >= 0 and wrap_percentage <= 100),
  wrap_amount valtrim.amount not null default 0,
  net_amount valtrim.amount not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (package_id, lot_id, utility_event_type),
  foreign key (package_id, builder_id)
    references valtrim.draw_packages(id, builder_id) on delete restrict,
  foreign key (lot_id, phase_id)
    references valtrim.lots(id, phase_id) on delete restrict,
  foreign key (lot_id, plan_id)
    references valtrim.lots(id, plan_id) on delete restrict,
  foreign key (plan_price_id, plan_id)
    references valtrim.plan_prices(id, plan_id) on delete restrict,
  check (gross_amount = utility_amount),
  check (utility_amount <= base_price),
  check (net_amount = gross_amount - retention_amount - wrap_amount)
);

comment on table valtrim.package_utility_lines is
  'Immutable Utility Building charges of a Draw Package, one per Utility row and Calendar event (EXT, DM, HW), independent from the Draws.';
comment on column valtrim.package_utility_lines.utility_event_type is
  'The Calendar event whose share of the Utility Plan Price this line bills.';
comment on column valtrim.package_utility_lines.base_price is
  'The Utility row Plan Price the share was calculated from.';

create index package_utility_lines_package_idx
  on valtrim.package_utility_lines (package_id);
create index package_utility_lines_job_lot_event_idx
  on valtrim.package_utility_lines (job_id, lot_id, utility_event_type);
create index package_utility_lines_phase_idx
  on valtrim.package_utility_lines (phase_id);
create index package_utility_lines_package_builder_idx
  on valtrim.package_utility_lines (package_id, builder_id);
create index package_utility_lines_lot_phase_idx
  on valtrim.package_utility_lines (lot_id, phase_id);
create index package_utility_lines_lot_plan_idx
  on valtrim.package_utility_lines (lot_id, plan_id);
create index package_utility_lines_plan_price_idx
  on valtrim.package_utility_lines (plan_price_id, plan_id);

alter table valtrim.package_utility_lines enable row level security;
revoke all on valtrim.package_utility_lines from public, anon, authenticated;
grant select on valtrim.package_utility_lines to authenticated;
grant all on valtrim.package_utility_lines to service_role;

create policy package_utility_lines_select
on valtrim.package_utility_lines for select to authenticated
using ((select private.is_active_user()));

create function valtrim.prepare_package_utility_line()
returns trigger
language plpgsql
set search_path to ''
as $function$
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
    lot.utility_name,
    lot.is_reverse,
    plan.code as plan_code,
    plan.name as plan_name,
    price.id as plan_price_id,
    price.base_price,
    version.utility_building,
    version.utility_billing_mode,
    version.utility_ext_percentage,
    version.utility_dm_percentage,
    version.utility_hw_percentage,
    version.retention_percentage,
    version.wrap_percentage
  into v_record
  from valtrim.draw_packages package
  join valtrim.lots lot on lot.id = new.lot_id and lot.is_utility_building
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
      and (
        candidate.id = lot.plan_price_id
        or (
          lot.plan_price_id is null
          and candidate.effective_from <= package.package_date
          and (
            candidate.effective_to is null
            or candidate.effective_to >= package.package_date
          )
        )
      )
    order by candidate.effective_from desc, candidate.id desc
    limit 1
  ) price on true
  where package.id = new.package_id
    and package.package_type = 'DRAW'
    and package.status = 'DRAFT';

  if v_record.plan_id is null then
    raise exception 'The Utility Building charge could not be calculated: review Package, Utility row and current Plan price'
      using errcode = '23503';
  end if;
  if not v_record.utility_building
     or v_record.utility_billing_mode <> 'BY_EVENT' then
    raise exception 'This Job Billing Setup does not bill the Utility Building by Calendar event'
      using errcode = '23514';
  end if;

  new.utility_percentage := case new.utility_event_type
    when 'EXT' then v_record.utility_ext_percentage
    when 'DM' then v_record.utility_dm_percentage
    when 'HW' then v_record.utility_hw_percentage
    else 0
  end;
  v_event_order := case new.utility_event_type
    when 'EXT' then 1 when 'DM' then 2 when 'HW' then 3 else 0
  end;

  if new.utility_percentage <= 0 then
    raise exception 'This Calendar event has no Utility Building allocation in the Builder Setup'
      using errcode = '23514';
  end if;

  -- Billed before: a Utility line of the same event, or a Utility charge on a Draw row (the
  -- way it was billed before Utility followed the Calendar), FULL or of the same event.
  if exists (
    select 1
    from valtrim.package_utility_lines prior_line
    join valtrim.draw_packages prior_package
      on prior_package.id = prior_line.package_id
     and prior_package.status <> 'VOIDED'
    where prior_package.job_id = v_record.job_id
      and prior_line.lot_id = new.lot_id
      and prior_line.utility_event_type = new.utility_event_type
  ) or exists (
    select 1
    from valtrim.package_draws prior_line
    join valtrim.draw_packages prior_package
      on prior_package.id = prior_line.package_id
     and prior_package.status <> 'VOIDED'
    where prior_package.job_id = v_record.job_id
      and prior_line.lot_id = new.lot_id
      and prior_line.is_utility_building
      and (
        prior_line.utility_billing_mode = 'FULL'
        or prior_line.utility_event_type = new.utility_event_type
      )
  ) then
    raise exception 'This Utility Building event portion was already billed in another Package'
      using errcode = '23505';
  end if;

  new.job_id := v_record.job_id;
  new.phase_id := v_record.phase_id;
  new.builder_id := v_record.builder_id;
  new.setup_version_id := v_record.setup_version_id;
  new.plan_id := v_record.plan_id;
  new.plan_price_id := v_record.plan_price_id;
  new.lot_number := v_record.lot_number;
  new.utility_name := v_record.utility_name;
  new.phase_code := v_record.phase_code;
  new.building := v_record.building;
  new.plan_code := v_record.plan_code;
  new.plan_name := v_record.plan_name;
  new.is_reverse := v_record.is_reverse;
  new.base_price := v_record.base_price;
  new.utility_billing_mode := 'BY_EVENT';

  -- The last configured event takes what the earlier ones left, so the shares add up to the
  -- Plan Price to the cent.
  if not exists (
    select 1
    from (values
      (1, v_record.utility_ext_percentage),
      (2, v_record.utility_dm_percentage),
      (3, v_record.utility_hw_percentage)
    ) as later_event(event_order, percentage)
    where later_event.event_order > v_event_order
      and later_event.percentage > 0
  ) then
    select coalesce(sum(round(
      new.base_price * prior_event.percentage / 100, 2
    )), 0)
    into v_prior_amount
    from (values
      (1, v_record.utility_ext_percentage),
      (2, v_record.utility_dm_percentage),
      (3, v_record.utility_hw_percentage)
    ) as prior_event(event_order, percentage)
    where prior_event.event_order < v_event_order
      and prior_event.percentage > 0;
    new.utility_amount := new.base_price - v_prior_amount;
  else
    new.utility_amount := round(
      new.base_price * new.utility_percentage / 100, 2
    );
  end if;

  new.gross_amount := new.utility_amount;
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
$function$;

create trigger package_utility_lines_prepare
before insert on valtrim.package_utility_lines
for each row execute function valtrim.prepare_package_utility_line();

create function valtrim.reject_package_utility_line_change()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if tg_op = 'DELETE'
     and current_setting('valtrim.draw_package_correction', true) = 'on'
     and (select private.has_app_role('ADMIN', 'ACCOUNTING', 'DRAW_INVOICE', 'PROJECT_MANAGEMENT'))
     and not exists (
       select 1
       from valtrim.retention_release_utility_lines allocated
       join valtrim.draw_packages release_package
         on release_package.id = allocated.package_id
        and release_package.status <> 'VOIDED'
       where allocated.source_utility_line_id = old.id
     ) then
    return old;
  end if;

  if tg_op = 'DELETE'
     and current_setting('valtrim.invoiced_package_edit', true) = old.package_id::text
     and not exists (
       select 1
       from valtrim.retention_release_utility_lines allocated
       join valtrim.draw_packages release_package
         on release_package.id = allocated.package_id
        and release_package.status <> 'VOIDED'
       where allocated.source_utility_line_id = old.id
     )
     and exists (
       select 1
       from valtrim.draw_packages package
       join valtrim.invoices invoice on invoice.package_id = package.id
       where package.id = old.package_id
         and package.package_type = 'DRAW'
         and package.status = 'DRAFT'
         and package.workflow_status = 'AWAITING_PAYMENT'
         and package.quickbooks_status = 'CREATED'
         and invoice.paid_amount = 0
         and not exists (
           select 1 from valtrim.invoice_payments payment
           where payment.invoice_id = invoice.id
         )
     ) then
    return old;
  end if;

  raise exception 'Calculated Utility Building lines are immutable'
    using errcode = '42501';
end;
$function$;

create function valtrim.reject_retention_release_utility_line()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if exists (
    select 1
    from valtrim.draw_packages package
    where package.id = new.package_id
      and package.package_type <> 'DRAW'
  ) then
    raise exception 'Only a Draw Package can contain Utility Building lines'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

create trigger package_utility_lines_reject_retention_release
before insert on valtrim.package_utility_lines
for each row execute function valtrim.reject_retention_release_utility_line();

create trigger package_utility_lines_recalculate_invoice
after insert or delete or update on valtrim.package_utility_lines
for each row execute function valtrim.recalculate_invoice_totals();

-- What a Retention Release gives back of each Utility line.
create table valtrim.retention_release_utility_lines (
  package_id bigint not null
    references valtrim.retention_releases(package_id) on delete restrict,
  source_utility_line_id bigint not null,
  source_package_id bigint not null
    references valtrim.draw_packages(id) on delete restrict,
  source_lot_id bigint not null,
  utility_event_type valtrim.production_stage_type not null,
  phase_id bigint not null,
  retention_amount valtrim.amount not null check (retention_amount > 0),
  created_at timestamptz not null default now(),
  primary key (package_id, source_utility_line_id)
);

comment on table valtrim.retention_release_utility_lines is
  'The retention of each Utility Building line that a Retention Release gives back.';

create index retention_release_utility_source_idx
  on valtrim.retention_release_utility_lines (source_utility_line_id);
create index retention_release_utility_package_idx
  on valtrim.retention_release_utility_lines (source_package_id);

alter table valtrim.retention_release_utility_lines enable row level security;
revoke all on valtrim.retention_release_utility_lines from public, anon, authenticated;
grant select on valtrim.retention_release_utility_lines to authenticated;
grant all on valtrim.retention_release_utility_lines to service_role;

create policy retention_release_utility_lines_select
on valtrim.retention_release_utility_lines for select to authenticated
using ((select private.is_active_user()));

create trigger retention_release_utility_lines_immutable
before delete or update on valtrim.retention_release_utility_lines
for each row execute function valtrim.reject_retention_release_snapshot_change();

-- The immutable-line trigger reads the retention table, so it is attached once that exists.
create trigger package_utility_lines_immutable
before delete or update on valtrim.package_utility_lines
for each row execute function valtrim.reject_package_utility_line_change();

-- ---------------------------------------------------------------------------
-- 3. Draw rows no longer take new Utility charges by event.
-- ---------------------------------------------------------------------------

do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef('valtrim.prepare_package_draw()'::regprocedure)
  into v_definition;

  v_definition := pg_temp.swap(
    v_definition,
    $source$    elsif v_record.utility_billing_mode = 'BY_EVENT' then
      v_utility_percentage := case v_record.event_type$source$,
    $source$    elsif v_record.utility_billing_mode = 'BY_EVENT' then
      -- Utility by Calendar event lives on package_utility_lines since 2026-11. A Package made
      -- before keeps its Utility on its Draw rows: recalculating it (a correction) builds them
      -- again as they were, and nothing else can add a new one.
      if current_setting('valtrim.draw_package_correction', true) is distinct from 'on' then
        raise exception 'The Utility Building is billed by Calendar event on its own lines, not on a Draw'
          using errcode = '23514';
      end if;
      if exists (
        select 1
        from valtrim.package_utility_lines prior_line
        join valtrim.draw_packages prior_package
          on prior_package.id = prior_line.package_id
         and prior_package.status <> 'VOIDED'
        where prior_package.job_id = v_record.job_id
          and prior_line.lot_id = new.lot_id
          and prior_line.utility_event_type = v_record.event_type
      ) then
        raise exception 'This Utility Building event portion was already billed in another Package'
          using errcode = '23505';
      end if;
      v_utility_percentage := case v_record.event_type$source$,
    'prepare_package_draw BY_EVENT Utility'
  );

  v_definition := pg_temp.swap(
    v_definition,
    $source$        where prior_package.job_id = v_record.job_id
          and prior_line.lot_id = new.lot_id
          and prior_line.is_utility_building
      ) then
        raise exception 'This Utility Building row was already billed in another Draw Package'$source$,
    $source$        where prior_package.job_id = v_record.job_id
          and prior_line.lot_id = new.lot_id
          and prior_line.is_utility_building
      ) or exists (
        select 1
        from valtrim.package_utility_lines prior_line
        join valtrim.draw_packages prior_package
          on prior_package.id = prior_line.package_id
         and prior_package.status <> 'VOIDED'
        where prior_package.job_id = v_record.job_id
          and prior_line.lot_id = new.lot_id
      ) then
        raise exception 'This Utility Building row was already billed in another Draw Package'$source$,
    'prepare_package_draw FULL Utility already billed'
  );

  execute v_definition;
end;
$migration$;

-- ---------------------------------------------------------------------------
-- 4. Creating a Package takes the Utility portions chosen by Calendar event.
-- ---------------------------------------------------------------------------

drop function valtrim.create_draw_package_with_price_differences(bigint, jsonb, jsonb, date, text, bigint[]);
drop function private.create_draw_package_with_price_differences(bigint, jsonb, jsonb, date, text, bigint[]);
drop function valtrim.create_draw_invoice_package_with_hardware_events(bigint, jsonb, jsonb, date, text);
drop function private.create_draw_invoice_package_with_hardware_events(bigint, jsonb, jsonb, date, text);

create function private.create_draw_invoice_package_with_hardware_events(
  p_job_id bigint,
  p_selections jsonb default '[]'::jsonb,
  p_hardware_selections jsonb default '[]'::jsonb,
  p_package_date date default current_date,
  p_notes text default null::text,
  p_utility_selections jsonb default '[]'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_package_id bigint;
  v_builder_id bigint;
  v_version_id bigint;
  v_invoice_line_format valtrim.invoice_line_format;
  v_hardware_mode text;
  v_separate_hardware boolean;
  v_utility_building boolean;
  v_utility_mode text;
  v_utility_selections jsonb := coalesce(p_utility_selections, '[]'::jsonb);
  v_draw_selections jsonb;
  v_draw_count integer;
  v_hardware_count integer;
  v_utility_count integer;
  v_unique integer;
  v_invalid integer;
  v_found integer;
  v_inserted integer;
  v_phase_count integer;
  v_single_phase_id bigint;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'ACCOUNTING', 'DRAW_INVOICE')) then
    raise exception 'You do not have permission to change Draw & Invoice Packages'
      using errcode = '42501';
  end if;

  if p_job_id is null or p_job_id <= 0 then
    raise exception 'Select an active Job' using errcode = '23503';
  end if;
  if jsonb_typeof(p_selections) is distinct from 'array'
     or jsonb_typeof(p_hardware_selections) is distinct from 'array'
     or jsonb_typeof(v_utility_selections) is distinct from 'array' then
    raise exception 'Draw, Separate Hardware and Utility selections must be JSON arrays'
      using errcode = '23514';
  end if;

  v_draw_count := jsonb_array_length(p_selections);
  v_hardware_count := jsonb_array_length(p_hardware_selections);
  v_utility_count := jsonb_array_length(v_utility_selections);
  if v_draw_count + v_hardware_count + v_utility_count = 0
     or v_draw_count + v_hardware_count + v_utility_count > 5000 then
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

  if exists (
    select 1
    from jsonb_array_elements(v_utility_selections) item
    where jsonb_typeof(item) <> 'object'
       or jsonb_typeof(item->'lot_id') is distinct from 'number'
       or jsonb_typeof(item->'event_type') is distinct from 'string'
       or item->>'lot_id' !~ '^[1-9][0-9]*$'
       or item->>'event_type' not in ('EXT', 'DM', 'HW')
  ) then
    raise exception 'Every Utility Building selection needs a valid Utility row and Calendar event'
      using errcode = '23514';
  end if;

  select count(distinct row(selection.lot_id, selection.event_type))
  into v_unique
  from jsonb_to_recordset(v_utility_selections)
    as selection(lot_id bigint, event_type text);

  if v_unique <> v_utility_count then
    raise exception 'Every Utility row / Calendar event selection must be unique'
      using errcode = '23514';
  end if;

  perform 1 from valtrim.jobs where id = p_job_id for update;

  select
    job.builder_id,
    job.billing_setup_version_id,
    version.invoice_line_format,
    version.separate_hardware_price,
    version.hardware_billing_mode,
    version.utility_building,
    version.utility_billing_mode
  into
    v_builder_id,
    v_version_id,
    v_invoice_line_format,
    v_separate_hardware,
    v_hardware_mode,
    v_utility_building,
    v_utility_mode
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
  if v_utility_count > 0 and (
    not v_utility_building or v_utility_mode <> 'BY_EVENT'
  ) then
    raise exception 'This Job Billing Setup does not bill the Utility Building by Calendar event'
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

  select count(*)
  into v_found
  from jsonb_to_recordset(v_utility_selections)
    as selection(lot_id bigint, event_type text)
  join valtrim.lots lot
    on lot.id = selection.lot_id
   and lot.is_utility_building
  join valtrim.phases phase
    on phase.id = lot.phase_id
   and phase.job_id = p_job_id
   and phase.is_active;

  if v_found <> v_utility_count then
    raise exception 'Every Utility Building selection must be a Utility row of an active Phase in this Job'
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
      and (
        candidate.id = lot.plan_price_id
        or (
          lot.plan_price_id is null
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
  order by phase.code, lot.lot_number, selection.event_type;

  get diagnostics v_inserted = row_count;
  if v_inserted <> v_hardware_count then
    raise exception 'Every Separate Hardware selection needs a current Plan price'
      using errcode = '23503';
  end if;

  -- The trigger calculates and snapshots everything else of each Utility line.
  insert into valtrim.package_utility_lines (package_id, lot_id, utility_event_type)
  select
    v_package_id,
    selection.lot_id,
    selection.event_type::valtrim.production_stage_type
  from jsonb_to_recordset(v_utility_selections)
    as selection(lot_id bigint, event_type text)
  join valtrim.lots lot on lot.id = selection.lot_id
  join valtrim.phases phase on phase.id = lot.phase_id
  order by phase.code, lot.lot_number,
    case selection.event_type when 'EXT' then 1 when 'DM' then 2 else 3 end;

  get diagnostics v_inserted = row_count;
  if v_inserted <> v_utility_count then
    raise exception 'Every Utility Building selection needs a current Plan price'
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
    union all
    select line.phase_id
    from valtrim.package_utility_lines line
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
$function$;

create function valtrim.create_draw_invoice_package_with_hardware_events(
  p_job_id bigint,
  p_selections jsonb default '[]'::jsonb,
  p_hardware_selections jsonb default '[]'::jsonb,
  p_package_date date default current_date,
  p_notes text default null::text,
  p_utility_selections jsonb default '[]'::jsonb
)
returns bigint
language sql
set search_path to ''
as $function$
  select private.create_draw_invoice_package_with_hardware_events(
    p_job_id,
    p_selections,
    p_hardware_selections,
    p_package_date,
    p_notes,
    p_utility_selections
  );
$function$;

create function private.create_draw_package_with_price_differences(
  p_job_id bigint,
  p_selections jsonb default '[]'::jsonb,
  p_hardware_selections jsonb default '[]'::jsonb,
  p_package_date date default current_date,
  p_notes text default null::text,
  p_difference_ids bigint[] default '{}'::bigint[],
  p_utility_selections jsonb default '[]'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path to ''
as $function$
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
    p_job_id, p_selections, p_hardware_selections, p_package_date, p_notes,
    p_utility_selections
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
      union
      select line.phase_id from valtrim.package_utility_lines line where line.package_id = v_package_id
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
$function$;

create function valtrim.create_draw_package_with_price_differences(
  p_job_id bigint,
  p_selections jsonb default '[]'::jsonb,
  p_hardware_selections jsonb default '[]'::jsonb,
  p_package_date date default current_date,
  p_notes text default null::text,
  p_difference_ids bigint[] default '{}'::bigint[],
  p_utility_selections jsonb default '[]'::jsonb
)
returns bigint
language sql
set search_path to ''
as $function$
  select private.create_draw_package_with_price_differences(
    p_job_id,
    p_selections,
    p_hardware_selections,
    p_package_date,
    p_notes,
    p_difference_ids,
    p_utility_selections
  );
$function$;

revoke all on function private.create_draw_invoice_package_with_hardware_events(bigint, jsonb, jsonb, date, text, jsonb) from public;
revoke all on function valtrim.create_draw_invoice_package_with_hardware_events(bigint, jsonb, jsonb, date, text, jsonb) from public;
revoke all on function private.create_draw_package_with_price_differences(bigint, jsonb, jsonb, date, text, bigint[], jsonb) from public;
revoke all on function valtrim.create_draw_package_with_price_differences(bigint, jsonb, jsonb, date, text, bigint[], jsonb) from public;
grant execute on function private.create_draw_invoice_package_with_hardware_events(bigint, jsonb, jsonb, date, text, jsonb) to authenticated, service_role;
grant execute on function valtrim.create_draw_invoice_package_with_hardware_events(bigint, jsonb, jsonb, date, text, jsonb) to authenticated, service_role;
grant execute on function private.create_draw_package_with_price_differences(bigint, jsonb, jsonb, date, text, bigint[], jsonb) to authenticated, service_role;
grant execute on function valtrim.create_draw_package_with_price_differences(bigint, jsonb, jsonb, date, text, bigint[], jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Totals, Lot history and workflow read the Utility lines too.
-- ---------------------------------------------------------------------------

create or replace function private.recalculate_package_invoice_totals(p_package_id bigint)
returns void
language sql
security definer
set search_path to ''
as $function$
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
      select gross_amount, retention_amount, wrap_amount, net_amount
      from valtrim.package_utility_lines
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
$function$;

create or replace function private.lot_billing_packages(p_lot_id bigint)
returns jsonb
language sql
stable security definer
set search_path to ''
as $function$
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
    union
    select line.package_id from valtrim.package_utility_lines line where line.lot_id = p_lot_id
  )
$function$;

do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef('valtrim.validate_package_workflow_status_change()'::regprocedure)
  into v_definition;

  v_definition := pg_temp.swap(
    v_definition,
    $source$       or exists (
         select 1
         from valtrim.retention_release_hardware_lines allocated
         join valtrim.draw_packages release_package
           on release_package.id = allocated.package_id
          and release_package.status <> 'VOIDED'
         where allocated.source_package_id = new.id
       )
     ) then$source$,
    $source$       or exists (
         select 1
         from valtrim.retention_release_hardware_lines allocated
         join valtrim.draw_packages release_package
           on release_package.id = allocated.package_id
          and release_package.status <> 'VOIDED'
         where allocated.source_package_id = new.id
       )
       or exists (
         select 1
         from valtrim.retention_release_utility_lines allocated
         join valtrim.draw_packages release_package
           on release_package.id = allocated.package_id
          and release_package.status <> 'VOIDED'
         where allocated.source_package_id = new.id
       )
     ) then$source$,
    'workflow status Retention Release of Utility'
  );

  v_definition := pg_temp.swap(
    v_definition,
    $source$     and not exists (
       select 1 from valtrim.package_hardware_lines line
       where line.package_id = new.id
     )$source$,
    $source$     and not exists (
       select 1 from valtrim.package_hardware_lines line
       where line.package_id = new.id
     )
     and not exists (
       select 1 from valtrim.package_utility_lines line
       where line.package_id = new.id
     )
     and not exists (
       select 1 from valtrim.retention_release_utility_lines line
       where line.package_id = new.id
     )$source$,
    'workflow status lines of a Package'
  );

  execute v_definition;
end;
$migration$;

-- ---------------------------------------------------------------------------
-- 6. Final Release: a Utility row is complete when every event share it has is billed.
-- ---------------------------------------------------------------------------

create or replace function private.get_final_release_status(p_package_id bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_package record;
  v_scope text;
  v_separate_hardware boolean;
  v_hardware_mode text;
  v_hardware_ext numeric;
  v_hardware_dm numeric;
  v_hardware_hw numeric;
  v_utility_building boolean;
  v_utility_mode text;
  v_utility_ext numeric;
  v_utility_dm numeric;
  v_utility_hw numeric;
  v_retention_on boolean;
  v_retention_scope text;
  v_retention_final boolean;
  v_release record;
  v_scopes jsonb;
  v_touched integer;
  v_closing integer;
begin
  select package.id,
         package.job_id,
         package.builder_id,
         package.package_date,
         package.package_type,
         package.setup_version_id
    into v_package
  from valtrim.draw_packages package
  where package.id = p_package_id;

  if not found then
    return null;
  end if;

  -- The setup the Job is pinned to; when it predates this option, the
  -- Builder's current setup decides.
  select coalesce(pinned.final_release_scope, current_setup.final_release_scope),
         pinned.separate_hardware_price,
         pinned.hardware_billing_mode,
         pinned.hardware_ext_percentage,
         pinned.hardware_dm_percentage,
         pinned.hardware_hw_percentage,
         pinned.utility_building,
         pinned.utility_billing_mode,
         pinned.utility_ext_percentage,
         pinned.utility_dm_percentage,
         pinned.utility_hw_percentage,
         pinned.retention_enabled and pinned.retention_percentage > 0,
         pinned.retention_release_scope
    into v_scope,
         v_separate_hardware,
         v_hardware_mode,
         v_hardware_ext,
         v_hardware_dm,
         v_hardware_hw,
         v_utility_building,
         v_utility_mode,
         v_utility_ext,
         v_utility_dm,
         v_utility_hw,
         v_retention_on,
         v_retention_scope
  from valtrim.billing_setup_versions pinned
  left join lateral (
    select version.final_release_scope
    from valtrim.billing_setup_versions version
    where version.builder_id = v_package.builder_id
      and version.status = 'ACTIVE'
    order by version.version_number desc
    limit 1
  ) current_setup on true
  where pinned.id = v_package.setup_version_id;

  -- Retention is released at the level the Final Release is set to: the Retention Release is the
  -- last Package, not the last Draw Package.
  v_retention_final := coalesce(v_retention_on, false) and (
    (v_retention_scope = 'JOB' and v_scope = 'PROJECT')
    or (v_retention_scope = 'BUILDING' and v_scope = 'BUILDING')
  );

  if v_package.package_type <> 'DRAW' then
    if v_package.package_type = 'RETENTION_RELEASE' and v_retention_final then
      select release.scope_type,
             release.phase_id,
             release.phase_code,
             release.building
        into v_release
      from valtrim.retention_releases release
      where release.package_id = p_package_id;

      if found then
        return jsonb_build_object(
          'applicable', true,
          'reason', null,
          'scope', v_scope,
          'is_final', true,
          'retention_final', true,
          'scopes', jsonb_build_array(jsonb_build_object(
            'key', case when v_release.scope_type = 'JOB' then 'job' else v_release.phase_id::text end,
            'label', case
              when v_release.scope_type = 'JOB' then 'the Job'
              else 'Phase ' || v_release.phase_code || coalesce(' - Building ' || v_release.building, '')
            end,
            'total', 0,
            'covered_before', 0,
            'covered_after', 0,
            'remaining_after', 0,
            'closes', true
          ))
        );
      end if;
    end if;

    -- The other Packages that are not Draw Packages have no Release to fill here.
    return jsonb_build_object(
      'applicable', false,
      'reason', v_package.package_type,
      'scope', null,
      'is_final', false,
      'scopes', '[]'::jsonb
    );
  end if;

  if v_scope is null then
    return jsonb_build_object(
      'applicable', false,
      'reason', 'NOT_CONFIGURED',
      'scope', null,
      'is_final', false,
      'scopes', '[]'::jsonb
    );
  end if;

  with scope_phase as (
    select phase.id as phase_id,
           case v_scope
             when 'PROJECT' then 'job'
             when 'PHASE' then phase.code::text
             else phase.id::text
           end as scope_key,
           case v_scope
             when 'PROJECT' then 'the Job'
             when 'PHASE' then 'Phase ' || phase.code
             else 'Phase ' || phase.code || coalesce(' - Building ' || phase.building, '')
           end as scope_label
    from valtrim.phases phase
    where phase.job_id = v_package.job_id
      and phase.is_active
  ),
  touched as (
    select distinct scope.scope_key
    from (
      select line.phase_id
      from valtrim.package_draws line
      where line.package_id = p_package_id
      union
      select line.phase_id
      from valtrim.package_hardware_lines line
      where line.package_id = p_package_id
      union
      select line.phase_id
      from valtrim.package_utility_lines line
      where line.package_id = p_package_id
    ) lines
    join scope_phase scope on scope.phase_id = lines.phase_id
  ),
  -- Everything that can be billed in a scope: every Lot in every Draw, the Separate
  -- Hardware parts when the setup has them, and each Utility row's share by Calendar event
  -- (or its single full charge on a setup made before Utility followed the Calendar).
  expected as (
    select scope.scope_key, 'D'::text as kind, lot.id as lot_id,
           draw.draw_number::text as part
    from scope_phase scope
    join valtrim.lots lot
      on lot.phase_id = scope.phase_id and not lot.is_utility_building
    join valtrim.billing_draws draw
      on draw.setup_version_id = v_package.setup_version_id
    union all
    select scope.scope_key, 'H', lot.id, hardware.part
    from scope_phase scope
    join valtrim.lots lot
      on lot.phase_id = scope.phase_id and not lot.is_utility_building
    cross join lateral unnest(
      case
        when not coalesce(v_separate_hardware, false) then array[]::text[]
        when v_hardware_mode = 'BY_EVENT' then array_remove(array[
          case when v_hardware_ext > 0 then 'EXT' end,
          case when v_hardware_dm > 0 then 'DM' end,
          case when v_hardware_hw > 0 then 'HW' end
        ], null)
        else array['FULL']
      end
    ) as hardware(part)
    union all
    select scope.scope_key, 'U', lot.id, utility.part
    from scope_phase scope
    join valtrim.lots lot
      on lot.phase_id = scope.phase_id and lot.is_utility_building
    cross join lateral unnest(
      case
        when not coalesce(v_utility_building, false) then array[]::text[]
        when v_utility_mode = 'BY_EVENT' then array_remove(array[
          case when v_utility_ext > 0 then 'EXT' end,
          case when v_utility_dm > 0 then 'DM' end,
          case when v_utility_hw > 0 then 'HW' end
        ], null)
        else array['FULL']
      end
    ) as utility(part)
  ),
  -- What the Job's Draw Packages (not voided) already bill, and when.
  covered as (
    select scope.scope_key, 'D'::text as kind, line.lot_id,
           line.draw_number::text as part,
           package.package_date, package.id as package_id
    from valtrim.package_draws line
    join valtrim.draw_packages package
      on package.id = line.package_id
     and package.job_id = v_package.job_id
     and package.package_type = 'DRAW'
     and package.status <> 'VOIDED'
    join scope_phase scope on scope.phase_id = line.phase_id
    where not line.is_utility_building
    union all
    select scope.scope_key, 'H', line.lot_id,
           case
             when line.hardware_billing_mode = 'FULL' then 'FULL'
             else line.hardware_event_type::text
           end,
           package.package_date, package.id
    from valtrim.package_draws line
    join valtrim.draw_packages package
      on package.id = line.package_id
     and package.job_id = v_package.job_id
     and package.package_type = 'DRAW'
     and package.status <> 'VOIDED'
    join scope_phase scope on scope.phase_id = line.phase_id
    where coalesce(v_separate_hardware, false)
      and (
        (line.hardware_billing_mode = 'FULL'
          and (line.hardware_percentage > 0 or line.hardware_amount > 0))
        or (line.hardware_billing_mode = 'BY_EVENT'
          and line.hardware_percentage > 0)
      )
    union all
    select scope.scope_key, 'H', line.lot_id, line.hardware_event_type::text,
           package.package_date, package.id
    from valtrim.package_hardware_lines line
    join valtrim.draw_packages package
      on package.id = line.package_id
     and package.job_id = v_package.job_id
     and package.package_type = 'DRAW'
     and package.status <> 'VOIDED'
    join scope_phase scope on scope.phase_id = line.phase_id
    where coalesce(v_separate_hardware, false)
      and v_hardware_mode = 'BY_EVENT'
    union all
    select scope.scope_key, 'U', line.lot_id,
           case
             when line.utility_billing_mode = 'BY_EVENT' then line.utility_event_type::text
             else 'FULL'
           end,
           package.package_date, package.id
    from valtrim.package_draws line
    join valtrim.draw_packages package
      on package.id = line.package_id
     and package.job_id = v_package.job_id
     and package.package_type = 'DRAW'
     and package.status <> 'VOIDED'
    join scope_phase scope on scope.phase_id = line.phase_id
    where line.is_utility_building
    union all
    select scope.scope_key, 'U', line.lot_id, line.utility_event_type::text,
           package.package_date, package.id
    from valtrim.package_utility_lines line
    join valtrim.draw_packages package
      on package.id = line.package_id
     and package.job_id = v_package.job_id
     and package.package_type = 'DRAW'
     and package.status <> 'VOIDED'
    join scope_phase scope on scope.phase_id = line.phase_id
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'key', touched.scope_key,
        'label', (
          select min(scope.scope_label)
          from scope_phase scope
          where scope.scope_key = touched.scope_key
        ),
        'total', stats.total,
        'covered_before', stats.covered_before,
        'covered_after', stats.covered_after,
        'remaining_after', stats.total - stats.covered_after,
        'closes', stats.covered_after = stats.total
          and stats.covered_before < stats.total
      )
      order by touched.scope_key
    ), '[]'::jsonb),
    count(*),
    count(*) filter (
      where stats.covered_after = stats.total
        and stats.covered_before < stats.total
    )
  into v_scopes, v_touched, v_closing
  from touched
  cross join lateral (
    select
      count(*) as total,
      count(*) filter (where exists (
        select 1
        from covered done
        where done.scope_key = expected.scope_key
          and done.kind = expected.kind
          and done.lot_id = expected.lot_id
          and done.part = expected.part
          and (done.package_date, done.package_id)
            < (v_package.package_date, v_package.id)
      )) as covered_before,
      count(*) filter (where exists (
        select 1
        from covered done
        where done.scope_key = expected.scope_key
          and done.kind = expected.kind
          and done.lot_id = expected.lot_id
          and done.part = expected.part
          and (done.package_date, done.package_id)
            <= (v_package.package_date, v_package.id)
      )) as covered_after
    from expected
    where expected.scope_key = touched.scope_key
  ) stats;

  return jsonb_build_object(
    'applicable', true,
    'reason', null,
    'scope', v_scope,
    -- Final only when this Package is the one that finishes every scope it
    -- touches; a Package that finishes one scope and leaves another open is
    -- still a progress payment. With retention released at the same level, the
    -- Retention Release is the Final, so a Draw Package never is.
    'is_final', v_touched > 0 and v_closing = v_touched and not v_retention_final,
    -- Whether the Retention Release of this Job is the Final, so the screen can say why a last
    -- Draw Package still uses the Progress form.
    'retention_final', v_retention_final,
    'scopes', v_scopes
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Retention Release gives back the retention of the Utility lines.
-- ---------------------------------------------------------------------------

do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'private.create_retention_release_package(bigint,bigint,text)'::regprocedure
  ) into v_definition;

  v_definition := pg_temp.swap(
    v_definition,
    $source$  v_inserted_hardware integer;
$source$,
    $source$  v_inserted_hardware integer;
  v_inserted_utility integer;
$source$,
    'retention release declarations'
  );

  v_definition := pg_temp.swap(
    v_definition,
    $source$        where allocated.source_hardware_line_id = line.id
      )
    union all
    select line.retention as retention_amount$source$,
    $source$        where allocated.source_hardware_line_id = line.id
      )
    union all
    select line.retention_amount
    from valtrim.package_utility_lines line
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
        from valtrim.retention_release_utility_lines allocated
        join valtrim.draw_packages release_package
          on release_package.id = allocated.package_id
         and release_package.status <> 'VOIDED'
        where allocated.source_utility_line_id = line.id
      )
    union all
    select line.retention as retention_amount$source$,
    'retention release retained amount'
  );

  v_definition := pg_temp.swap(
    v_definition,
    $source$  get diagnostics v_inserted_hardware = row_count;
$source$,
    $source$  get diagnostics v_inserted_hardware = row_count;

  insert into valtrim.retention_release_utility_lines (
    package_id,
    source_utility_line_id,
    source_package_id,
    source_lot_id,
    utility_event_type,
    phase_id,
    retention_amount
  )
  select
    v_package_id,
    line.id,
    line.package_id,
    line.lot_id,
    line.utility_event_type,
    line.phase_id,
    line.retention_amount
  from valtrim.package_utility_lines line
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
      from valtrim.retention_release_utility_lines allocated
      join valtrim.draw_packages release_package
        on release_package.id = allocated.package_id
       and release_package.status <> 'VOIDED'
      where allocated.source_utility_line_id = line.id
    )
  order by line.package_id, line.phase_id, line.lot_id, line.utility_event_type;

  get diagnostics v_inserted_utility = row_count;
$source$,
    'retention release Utility allocation'
  );

  v_definition := pg_temp.swap(
    v_definition,
    $source$  if v_inserted + v_inserted_hardware + v_inserted_adjustment + v_inserted_options = 0 then$source$,
    $source$  if v_inserted + v_inserted_hardware + v_inserted_utility + v_inserted_adjustment + v_inserted_options = 0 then$source$,
    'retention release nothing allocated'
  );

  execute v_definition;
end;
$migration$;

-- ---------------------------------------------------------------------------
-- 8. Correcting, cancelling and recalculating a Draft Package.
-- ---------------------------------------------------------------------------

do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,text)'::regprocedure
  ) into v_definition;

  v_definition := pg_temp.swap(
    v_definition,
    $source$    raise exception 'Packages with Calendar-triggered Separate Hardware must be cancelled and recreated'
      using errcode = '23514';
  end if;
$source$,
    $source$    raise exception 'Packages with Calendar-triggered Separate Hardware must be cancelled and recreated'
      using errcode = '23514';
  end if;

  if p_action <> 'CANCEL' and exists (
    select 1
    from valtrim.package_utility_lines line
    where line.package_id = p_package_id
       or (p_action = 'TRANSFER' and line.package_id = p_other_package_id)
  ) then
    raise exception 'Packages with Utility Building charges by Calendar event must be cancelled and recreated'
      using errcode = '23514';
  end if;
$source$,
    'correction Utility lines block'
  );

  v_definition := pg_temp.swap(
    v_definition,
    $source$    delete from valtrim.package_hardware_lines where package_id = p_package_id;
$source$,
    $source$    delete from valtrim.package_hardware_lines where package_id = p_package_id;
    delete from valtrim.package_utility_lines where package_id = p_package_id;
$source$,
    'correction cancel deletes Utility lines'
  );

  execute v_definition;

  select pg_get_functiondef(
    'private.recalculate_draft_package(bigint,text,boolean)'::regprocedure
  ) into v_definition;

  v_definition := pg_temp.swap(
    v_definition,
    $source$  v_hardware jsonb;
$source$,
    $source$  v_hardware jsonb;
  v_utility jsonb;
$source$,
    'draft recalculation declarations'
  );

  v_definition := pg_temp.swap(
    v_definition,
    $source$  v_expected := jsonb_array_length(v_cells);
  if v_expected = 0 and jsonb_array_length(v_hardware) = 0 then$source$,
    $source$  select coalesce(jsonb_agg(
    jsonb_build_object('lot_id', line.lot_id, 'event_type', line.utility_event_type)
    order by line.id
  ), '[]'::jsonb)
  into v_utility
  from valtrim.package_utility_lines line
  where line.package_id = p_package_id;

  v_expected := jsonb_array_length(v_cells);
  if v_expected = 0 and jsonb_array_length(v_hardware) = 0
     and jsonb_array_length(v_utility) = 0 then$source$,
    'draft recalculation reads Utility lines'
  );

  v_definition := pg_temp.swap(
    v_definition,
    $source$  delete from valtrim.package_hardware_lines where package_id = p_package_id;
$source$,
    $source$  delete from valtrim.package_hardware_lines where package_id = p_package_id;
  delete from valtrim.package_utility_lines where package_id = p_package_id;
$source$,
    'draft recalculation deletes Utility lines'
  );

  v_definition := pg_temp.swap(
    v_definition,
    $source$  select invoice.gross_amount, invoice.net_amount
  into v_gross_after, v_net_after$source$,
    $source$  if jsonb_array_length(v_utility) > 0 then
    insert into valtrim.package_utility_lines (package_id, lot_id, utility_event_type)
    select
      p_package_id,
      (item.value ->> 'lot_id')::bigint,
      (item.value ->> 'event_type')::valtrim.production_stage_type
    from jsonb_array_elements(v_utility) with ordinality as item(value, position)
    order by item.position;

    get diagnostics v_inserted = row_count;
    if v_inserted <> jsonb_array_length(v_utility) then
      raise exception 'The Package did not generate every Utility Building line again'
        using errcode = '23514';
    end if;
  end if;

  select invoice.gross_amount, invoice.net_amount
  into v_gross_after, v_net_after$source$,
    'draft recalculation rebuilds Utility lines'
  );

  execute v_definition;
end;
$migration$;

-- ---------------------------------------------------------------------------
-- 9. Price changes of a Utility Plan reach the Packages that billed it.
-- ---------------------------------------------------------------------------

alter table valtrim.package_price_differences
  drop constraint package_price_differences_line_kind_check,
  drop constraint package_price_differences_check;
alter table valtrim.package_price_differences
  add constraint package_price_differences_line_kind_check
    check (line_kind = any (array['DRAW'::text, 'HARDWARE_EVENT'::text, 'UTILITY_EVENT'::text])),
  add constraint package_price_differences_check
    check (
      (line_kind = 'DRAW' and draw_id is not null and hardware_event_type is null)
      or (line_kind in ('HARDWARE_EVENT', 'UTILITY_EVENT')
        and draw_id is null and hardware_event_type is not null)
    );

alter table valtrim.price_adjustment_lines
  drop constraint price_adjustment_lines_line_kind_check;
alter table valtrim.price_adjustment_lines
  add constraint price_adjustment_lines_line_kind_check
    check (line_kind = any (array['DRAW'::text, 'HARDWARE_EVENT'::text, 'UTILITY_EVENT'::text]));

comment on column valtrim.package_price_differences.hardware_event_type is
  'The Calendar event of a HARDWARE_EVENT or UTILITY_EVENT difference.';

create function private.package_utility_line_new_amounts(p_line valtrim.package_utility_lines)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
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

  v_amount := private.event_allocation(
    v_pin.base_price, p_line.utility_event_type::text,
    v_version.utility_ext_percentage, v_version.utility_dm_percentage,
    v_version.utility_hw_percentage
  );
  v_retention := round(v_amount * p_line.retention_percentage / 100, 2);
  v_wrap := round(v_amount * p_line.wrap_percentage / 100, 2);

  return jsonb_build_object(
    'billed', jsonb_build_object(
      'base', 0,
      'hardware', 0,
      'utility', p_line.utility_amount,
      'options', 0,
      'gross', p_line.gross_amount,
      'retention', p_line.retention_amount,
      'wrap', p_line.wrap_amount,
      'net', p_line.net_amount
    ),
    'new', jsonb_build_object(
      'base', 0,
      'hardware', 0,
      'utility', v_amount,
      'options', 0,
      'gross', v_amount,
      'retention', v_retention,
      'wrap', v_wrap,
      'net', v_amount - v_retention - v_wrap
    )
  );
end;
$function$;

revoke all on function private.package_utility_line_new_amounts(valtrim.package_utility_lines) from public;

do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'private.record_package_price_differences(bigint,bigint[],uuid)'::regprocedure
  ) into v_definition;

  v_definition := pg_temp.swap(
    v_definition,
    $source$  v_hardware_line valtrim.package_hardware_lines%rowtype;
$source$,
    $source$  v_hardware_line valtrim.package_hardware_lines%rowtype;
  v_utility_line valtrim.package_utility_lines%rowtype;
$source$,
    'price differences declarations'
  );

  v_definition := pg_temp.swap(
    v_definition,
    $source$    end loop;

    v_summary := v_summary || jsonb_build_array(jsonb_build_object($source$,
    $source$    end loop;

    for v_utility_line in
      select line.*
      from valtrim.package_utility_lines line
      where line.package_id = v_package_id
      order by line.lot_id, line.utility_event_type
    loop
      v_amounts := private.package_utility_line_new_amounts(v_utility_line);
      continue when v_amounts is null;

      select
        coalesce(sum(collected.delta_utility), 0) as utility,
        coalesce(sum(collected.delta_gross), 0) as gross,
        coalesce(sum(collected.delta_retention), 0) as retention,
        coalesce(sum(collected.delta_wrap), 0) as wrap,
        coalesce(sum(collected.delta_net), 0) as net
      into v_collected
      from valtrim.package_price_differences collected
      where collected.package_id = v_package_id
        and collected.status = 'COLLECTED'
        and collected.line_kind = 'UTILITY_EVENT'
        and collected.lot_id = v_utility_line.lot_id
        and collected.hardware_event_type = v_utility_line.utility_event_type::text;

      v_utility := (v_amounts -> 'new' ->> 'utility')::numeric - (v_amounts -> 'billed' ->> 'utility')::numeric - v_collected.utility;
      v_gross := (v_amounts -> 'new' ->> 'gross')::numeric - (v_amounts -> 'billed' ->> 'gross')::numeric - v_collected.gross;
      v_retention := (v_amounts -> 'new' ->> 'retention')::numeric - (v_amounts -> 'billed' ->> 'retention')::numeric - v_collected.retention;
      v_wrap := (v_amounts -> 'new' ->> 'wrap')::numeric - (v_amounts -> 'billed' ->> 'wrap')::numeric - v_collected.wrap;
      v_net := (v_amounts -> 'new' ->> 'net')::numeric - (v_amounts -> 'billed' ->> 'net')::numeric - v_collected.net;

      continue when v_utility = 0 and v_gross = 0 and v_retention = 0
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
        'UTILITY_EVENT', v_utility_line.lot_id, v_utility_line.utility_event_type::text,
        v_utility_line.phase_id, v_utility_line.phase_code, v_utility_line.building,
        v_utility_line.lot_number, v_utility_line.plan_code,
        (v_amounts -> 'billed' ->> 'gross')::numeric,
        (v_amounts -> 'billed' ->> 'retention')::numeric,
        (v_amounts -> 'billed' ->> 'wrap')::numeric,
        (v_amounts -> 'billed' ->> 'net')::numeric,
        (v_amounts -> 'new' ->> 'gross')::numeric,
        (v_amounts -> 'new' ->> 'retention')::numeric,
        (v_amounts -> 'new' ->> 'wrap')::numeric,
        (v_amounts -> 'new' ->> 'net')::numeric,
        0, 0, v_utility, 0,
        v_gross, v_retention, v_wrap, v_net,
        v_actor_id
      );
      v_lines := v_lines + 1;
      v_delta_gross := v_delta_gross + v_gross;
      v_delta_net := v_delta_net + v_net;
    end loop;

    v_summary := v_summary || jsonb_build_array(jsonb_build_object($source$,
    'price differences Utility lines'
  );

  execute v_definition;

  select pg_get_functiondef(
    'valtrim.apply_phase_price_changes(bigint,bigint[],jsonb,text,boolean)'::regprocedure
  ) into v_definition;

  v_definition := pg_temp.swap(
    v_definition,
    $source$      select line.package_id
      from valtrim.package_hardware_lines line
      where line.lot_id = any (v_moved_lot_ids)
$source$,
    $source$      select line.package_id
      from valtrim.package_hardware_lines line
      where line.lot_id = any (v_moved_lot_ids)
      union
      select line.package_id
      from valtrim.package_utility_lines line
      where line.lot_id = any (v_moved_lot_ids)
$source$,
    'price change affected Packages'
  );

  execute v_definition;

  select pg_get_functiondef(
    'valtrim.set_plan_price(bigint,numeric,numeric)'::regprocedure
  ) into v_definition;

  v_definition := pg_temp.swap(
    v_definition,
    $source$    select 1 from valtrim.package_hardware_lines where plan_price_id = v_current_id
$source$,
    $source$    select 1 from valtrim.package_hardware_lines where plan_price_id = v_current_id
    union all
    select 1 from valtrim.package_utility_lines where plan_price_id = v_current_id
$source$,
    'plan price in use'
  );

  execute v_definition;
end;
$migration$;

-- ---------------------------------------------------------------------------
-- 10. Invoiced edit, Purchase Order import and Phase delete see the Utility lines.
-- ---------------------------------------------------------------------------

do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'valtrim.edit_invoiced_draw_package(uuid,bigint,jsonb,jsonb,jsonb,text,text,boolean,jsonb)'::regprocedure
  ) into v_definition;

  -- The Utility lines stay as they are when an invoiced Package is edited.
  v_definition := pg_temp.swap(
    v_definition,
    $source$    if v_cells_after + v_hardware_after = 0 then$source$,
    $source$    if v_cells_after + v_hardware_after + (
      select count(*) from valtrim.package_utility_lines where package_id = p_package_id
    ) = 0 then$source$,
    'invoiced edit keeps a line'
  );

  v_definition := pg_temp.swap(
    v_definition,
    $source$            select line.phase_id from valtrim.package_hardware_lines line where line.package_id = p_package_id
          ) scope$source$,
    $source$            select line.phase_id from valtrim.package_hardware_lines line where line.package_id = p_package_id
            union all
            select line.phase_id from valtrim.package_utility_lines line where line.package_id = p_package_id
          ) scope$source$,
    'invoiced edit Package Phase'
  );

  execute v_definition;

  select pg_get_functiondef(
    'valtrim.import_purchase_order_options(bigint[])'::regprocedure
  ) into v_definition;

  v_definition := pg_temp.swap(
    v_definition,
    $source$          from valtrim.package_hardware_lines billed_line
          join valtrim.lots billed_lot on billed_lot.id = billed_line.lot_id
          where billed_lot.phase_id = lot.phase_id
        )
$source$,
    $source$          from valtrim.package_hardware_lines billed_line
          join valtrim.lots billed_lot on billed_lot.id = billed_line.lot_id
          where billed_lot.phase_id = lot.phase_id
        )
        or exists (
          select 1
          from valtrim.package_utility_lines billed_line
          where billed_line.phase_id = lot.phase_id
        )
$source$,
    'Purchase Order import billed Phase'
  );

  execute v_definition;

  select pg_get_functiondef(
    'valtrim.deactivate_sequence_sheet_phase(bigint)'::regprocedure
  ) into v_definition;

  v_definition := pg_temp.swap(
    v_definition,
    $source$    from valtrim.package_draws line
    where line.phase_id = p_phase_id
  ) then$source$,
    $source$    from valtrim.package_draws line
    where line.phase_id = p_phase_id
  ) or exists (
    select 1
    from valtrim.package_hardware_lines line
    where line.phase_id = p_phase_id
  ) or exists (
    select 1
    from valtrim.package_utility_lines line
    where line.phase_id = p_phase_id
  ) then$source$,
    'Phase delete billed lines'
  );

  execute v_definition;
end;
$migration$;

notify pgrst, 'reload schema';

commit;
