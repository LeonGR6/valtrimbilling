-- Editing a Draw Package that already has its QuickBooks invoice (Awaiting payment).
--
-- Until now only a Draft without a QuickBooks invoice could be edited. To change an invoiced Package the
-- invoice had to be voided, which keeps its number in QuickBooks and leaves the Package deletable but not
-- editable. This migration lets an unpaid Package in Awaiting payment change what it bills -- Lot / Draw
-- cells, Separate Hardware lines and single Options -- and marks the change as waiting to reach QuickBooks.
-- The Edge Function quickbooks-invoice-update then updates the SAME QuickBooks invoice (same number) and
-- calls complete_quickbooks_invoice_update; if QuickBooks fails, the flag stays and the change is retried.
--
-- What it does:
--   * four columns on the QuickBooks sync row say "this Package changed and QuickBooks has not been told",
--   * the line guards (package_draws / package_options / package_hardware_lines) and the Phase guard accept a
--     change made by edit_invoiced_draw_package, which only a service-role call can make,
--   * edit_invoiced_draw_package does the edit (or, with p_dry_run, shows what it would do and rolls it back),
--   * the Release and the Payment Schedule of the Package are removed in the same step, because both print the
--     Package amount; the invoice PDF is replaced later by the Edge Function.

begin;

-- 1. The sync row remembers a change QuickBooks has not received ------------------------------------

alter table valtrim.quickbooks_invoice_syncs
  add column update_pending boolean not null default false,
  add column update_error text
    check (update_error is null or char_length(update_error) <= 1000),
  add column update_request_id uuid,
  add column updated_in_quickbooks_at timestamptz;

alter table valtrim.quickbooks_invoice_sync_archive
  add column update_pending boolean not null default false,
  add column update_error text,
  add column update_request_id uuid,
  add column updated_in_quickbooks_at timestamptz;

comment on column valtrim.quickbooks_invoice_syncs.update_pending is
  'True after the Package was edited and until QuickBooks received the new lines of the same invoice.';
comment on column valtrim.quickbooks_invoice_syncs.update_error is
  'Why the last attempt to update the QuickBooks invoice failed.';
comment on column valtrim.quickbooks_invoice_syncs.update_request_id is
  'Sent to QuickBooks as requestid when the invoice is updated, so a retry is not applied twice.';
comment on column valtrim.quickbooks_invoice_syncs.updated_in_quickbooks_at is
  'When the lines of this invoice were last changed in QuickBooks from this platform.';

grant select (update_pending, update_error, updated_in_quickbooks_at)
  on valtrim.quickbooks_invoice_syncs to authenticated;

create or replace function valtrim.archive_quickbooks_invoice_sync(
  p_package_id bigint,
  p_user_id uuid,
  p_reason text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into valtrim.quickbooks_invoice_sync_archive (
    package_id, status, environment, realm_id, request_id, request_reusable,
    qbo_invoice_id, qbo_doc_number, qbo_sync_token, total_amount, payload, error,
    created_by, created_at, updated_at, voided_at, voided_by,
    qbo_state, qbo_total, qbo_balance, qbo_due_date, qbo_overdue,
    qbo_linked_transactions, qbo_last_updated_at, qbo_state_changed_at,
    qbo_state_checked_at, invoice_number, qbo_invoice_date,
    update_pending, update_error, update_request_id, updated_in_quickbooks_at,
    archived_by, archive_reason
  )
  select
    sync.package_id, sync.status, sync.environment, sync.realm_id, sync.request_id,
    sync.request_reusable, sync.qbo_invoice_id, sync.qbo_doc_number,
    sync.qbo_sync_token, sync.total_amount, sync.payload, sync.error,
    sync.created_by, sync.created_at, sync.updated_at, sync.voided_at, sync.voided_by,
    sync.qbo_state, sync.qbo_total, sync.qbo_balance, sync.qbo_due_date,
    sync.qbo_overdue, sync.qbo_linked_transactions, sync.qbo_last_updated_at,
    sync.qbo_state_changed_at, sync.qbo_state_checked_at, sync.invoice_number,
    sync.qbo_invoice_date,
    sync.update_pending, sync.update_error, sync.update_request_id,
    sync.updated_in_quickbooks_at,
    p_user_id, left(p_reason, 300)
  from valtrim.quickbooks_invoice_syncs sync
  where sync.package_id = p_package_id;
$$;

-- 2. The correction history knows this kind of change ---------------------------------------------

alter table valtrim.draw_package_corrections
  drop constraint draw_package_corrections_action_check;

alter table valtrim.draw_package_corrections
  add constraint draw_package_corrections_action_check
  check (action = any (array['EDIT', 'TRANSFER', 'CANCEL', 'RECALCULATE', 'EDIT_INVOICED']));

-- 3. The guards let edit_invoiced_draw_package through --------------------------------------------
--
-- Same bodies as before plus one branch each. The branch only opens for a DRAW Package that is waiting for
-- payment with a QuickBooks invoice and nothing paid, and only while valtrim.invoiced_package_edit names that
-- very Package; that setting is made inside edit_invoiced_draw_package, which only the service role can run.

create or replace function valtrim.reject_package_line_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_package_id bigint := old.package_id;
  v_allocated boolean;
begin
  v_allocated := exists (
    select 1
    from valtrim.retention_release_lines allocated
    join valtrim.draw_packages release_package
      on release_package.id = allocated.package_id
     and release_package.status <> 'VOIDED'
    where allocated.source_package_id = v_package_id
      and allocated.source_lot_id = old.lot_id
      and allocated.source_draw_id = old.draw_id
  );

  if tg_op = 'DELETE'
     and current_setting('valtrim.draw_package_correction', true) = 'on'
     and (select private.has_app_role('ADMIN', 'ACCOUNTING', 'DRAW_INVOICE', 'PROJECT_MANAGEMENT'))
     and not v_allocated
     and exists (
       select 1
       from valtrim.draw_packages package
       join valtrim.invoices invoice on invoice.package_id = package.id
       where package.id = v_package_id
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
           select 1 from valtrim.invoice_payments payment
           where payment.invoice_id = invoice.id
         )
         and not exists (
           select 1 from valtrim.package_documents document
           where document.package_id = package.id
             and (
               document.file_id is not null
               or document.status in ('COMPLETE', 'WAIVED')
             )
         )
     ) then
    return old;
  end if;

  -- An unpaid Package waiting for payment, edited by edit_invoiced_draw_package.
  if tg_op = 'DELETE'
     and current_setting('valtrim.invoiced_package_edit', true) = v_package_id::text
     and not v_allocated
     and exists (
       select 1
       from valtrim.draw_packages package
       join valtrim.invoices invoice on invoice.package_id = package.id
       where package.id = v_package_id
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

  raise exception 'Calculated Package lines are immutable or reserved by an active Retention Release'
    using errcode = '42501';
end;
$$;

create or replace function valtrim.reject_package_hardware_line_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and current_setting('valtrim.draw_package_correction', true) = 'on'
     and (select private.has_app_role('ADMIN', 'ACCOUNTING', 'DRAW_INVOICE', 'PROJECT_MANAGEMENT'))
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

  if tg_op = 'DELETE'
     and current_setting('valtrim.invoiced_package_edit', true) = old.package_id::text
     and not exists (
       select 1
       from valtrim.retention_release_hardware_lines allocated
       join valtrim.draw_packages release_package
         on release_package.id = allocated.package_id
        and release_package.status <> 'VOIDED'
       where allocated.source_hardware_line_id = old.id
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

  raise exception 'Calculated Separate Hardware lines are immutable'
    using errcode = '42501';
end;
$$;

create or replace function valtrim.prepare_draw_package()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_line_format valtrim.invoice_line_format;
begin
  if tg_op = 'UPDATE' then
    if new.builder_id is distinct from old.builder_id
       or new.job_id is distinct from old.job_id
       or new.setup_version_id is distinct from old.setup_version_id
       or new.package_date is distinct from old.package_date
       or new.invoice_line_format is distinct from old.invoice_line_format
       or new.package_type is distinct from old.package_type then
      raise exception 'La configuracion, tipo y alcance del Job de un package son inmutables';
    end if;

    if new.phase_id is distinct from old.phase_id
       and not (
         current_setting('valtrim.draw_package_correction', true) = 'on'
         and (select private.has_app_role('ADMIN', 'ACCOUNTING', 'DRAW_INVOICE', 'PROJECT_MANAGEMENT'))
       )
       and current_setting('valtrim.invoiced_package_edit', true) is distinct from new.id::text then
      raise exception 'El alcance de Phase solo cambia mediante una correccion del package';
    end if;

    if new.phase_id is not null and not exists (
      select 1
      from valtrim.phases phase
      where phase.id = new.phase_id and phase.job_id = new.job_id
    ) then
      raise exception 'Phase y Job no forman un package valido';
    end if;
    return new;
  end if;

  select version.invoice_line_format
  into v_line_format
  from valtrim.jobs job
  join valtrim.billing_setup_versions version
    on version.id = job.billing_setup_version_id
   and version.builder_id = job.builder_id
  where job.id = new.job_id
    and job.builder_id = new.builder_id
    and new.setup_version_id = job.billing_setup_version_id
    and (job.is_active or new.package_type = 'RETENTION_RELEASE')
    and version.status in ('ACTIVE', 'SUPERSEDED')
    and (
      new.phase_id is null
      or exists (
        select 1
        from valtrim.phases phase
        where phase.id = new.phase_id
          and phase.job_id = job.id
          and (phase.is_active or new.package_type = 'RETENTION_RELEASE')
      )
    );

  if v_line_format is null then
    raise exception 'Job, Phases y billing setup no forman un package valido';
  end if;

  new.invoice_line_format := v_line_format;
  return new;
end;
$$;

-- 4. The edit ---------------------------------------------------------------------------------------
--
-- p_selections          the Lot / Draw cells the Package keeps, as [{lot_id, draw_number}] (new ones are added)
-- p_hardware_selections the Separate Hardware lines it keeps, as [{lot_id, event_type}]
-- p_released_options    single Options to take off a cell that stays, as [{lot_id, option_id, unit_no}]
--
-- A cell that loses an Option is generated again (its line is immutable), with the Options it keeps; every
-- other kept line is left as it is. What the Package takes from another Package is refused by the same keys
-- as at creation: a cell, an Option unit or a Hardware event belongs to one Package at a time.
-- With p_dry_run the edit runs and is rolled back, so the caller sees the totals before and after.

create function valtrim.edit_invoiced_draw_package(
  p_actor_id uuid,
  p_package_id bigint,
  p_selections jsonb,
  p_hardware_selections jsonb,
  p_released_options jsonb,
  p_reason text,
  p_notes text default null,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(p_reason), '');
  v_notes text := nullif(btrim(p_notes), '');
  v_job_id bigint;
  v_package record;
  v_sync record;
  v_invoice record;
  v_version record;
  v_before record;
  v_after record;
  v_anchor record;
  v_doc record;
  v_requested integer;
  v_unique integer;
  v_invalid integer;
  v_found integer;
  v_changed integer;
  v_hardware_requested integer;
  v_hardware_unique integer;
  v_released_requested integer;
  v_released_unique integer;
  v_cells_before integer;
  v_hardware_before integer;
  v_options_before integer;
  v_cells_after integer;
  v_hardware_after integer;
  v_options_after integer;
  v_removed jsonb := '[]'::jsonb;
  v_added jsonb := '[]'::jsonb;
  v_removed_hardware jsonb := '[]'::jsonb;
  v_added_hardware jsonb := '[]'::jsonb;
  v_released jsonb := '[]'::jsonb;
  v_all_released jsonb := '[]'::jsonb;
  v_snapshot jsonb := '[]'::jsonb;
  v_documents jsonb := '[]'::jsonb;
  v_storage_paths jsonb := '[]'::jsonb;
  v_sent jsonb;
  v_kept jsonb;
  v_draw_flags jsonb;
  v_result jsonb;
begin
  if p_actor_id is null or not exists (
    select 1
    from valtrim.app_users actor
    where actor.id = p_actor_id
      and actor.is_active
      and actor.role::text in ('ADMIN', 'ACCOUNTING', 'DRAW_INVOICE')
  ) then
    raise exception 'You do not have permission to edit Draw & Invoice Packages'
      using errcode = '42501';
  end if;

  if p_package_id is null or p_package_id <= 0 then
    raise exception 'Select a valid Package' using errcode = '23514';
  end if;
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'Enter a correction reason of 500 characters or fewer'
      using errcode = '23514';
  end if;
  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'Package notes must contain 500 characters or fewer'
      using errcode = '23514';
  end if;
  if jsonb_typeof(p_selections) is distinct from 'array'
     or jsonb_typeof(p_hardware_selections) is distinct from 'array'
     or jsonb_typeof(p_released_options) is distinct from 'array' then
    raise exception 'Cells, Hardware lines and released Options must be JSON arrays'
      using errcode = '23514';
  end if;
  if jsonb_array_length(p_selections) + jsonb_array_length(p_hardware_selections) = 0 then
    raise exception 'A Package must keep at least one Lot / Draw cell or Separate Hardware line. To bill nothing, void the invoice instead'
      using errcode = '23514';
  end if;
  if jsonb_array_length(p_selections) > 5000
     or jsonb_array_length(p_hardware_selections) > 5000
     or jsonb_array_length(p_released_options) > 5000 then
    raise exception 'Too many items in one edit' using errcode = '23514';
  end if;

  select package.job_id into v_job_id
  from valtrim.draw_packages package where package.id = p_package_id;
  if v_job_id is null then
    raise exception 'The Draw Package no longer exists' using errcode = 'P0002';
  end if;

  -- Creation and corrections serialize at the Job boundary.
  perform 1 from valtrim.jobs where id = v_job_id for update;

  select package.* into v_package
  from valtrim.draw_packages package
  where package.id = p_package_id
  for update;

  select invoice.* into v_invoice
  from valtrim.invoices invoice where invoice.package_id = p_package_id;

  select sync.* into v_sync
  from valtrim.quickbooks_invoice_syncs sync
  where sync.package_id = p_package_id
  for update;

  if v_package.package_type is distinct from 'DRAW' then
    raise exception 'Only a Draw Package can be edited here' using errcode = '23514';
  end if;
  if v_package.status <> 'DRAFT'
     or v_package.workflow_status <> 'AWAITING_PAYMENT'
     or v_package.quickbooks_status <> 'CREATED'
     or v_sync.package_id is null
     or v_sync.status <> 'CREATED'
     or v_sync.qbo_invoice_id is null then
    raise exception 'Only a Package that is awaiting payment with a QuickBooks invoice can be edited here'
      using errcode = '23514';
  end if;
  if v_sync.update_pending then
    raise exception 'The last change to this Package has not reached QuickBooks yet. Finish it first'
      using errcode = '23514';
  end if;
  if v_invoice.id is null
     or v_invoice.paid_amount <> 0
     or exists (
       select 1 from valtrim.invoice_payments payment
       where payment.invoice_id = v_invoice.id
     )
     or (v_sync.qbo_state is not null and v_sync.qbo_state <> 'OPEN')
     or (
       v_sync.qbo_balance is not null and v_sync.qbo_total is not null
       and v_sync.qbo_balance <> v_sync.qbo_total
     ) then
    raise exception 'This invoice already has a payment or credit applied, so it cannot be edited'
      using errcode = '23514';
  end if;
  if exists (
       select 1 from valtrim.price_adjustment_lines carried
       where carried.package_id = p_package_id
     )
     or exists (
       select 1 from valtrim.package_price_differences difference
       where difference.package_id = p_package_id
     ) then
    raise exception 'A Package that collected price differences, or has some recorded against it, cannot be edited. Void its invoice and create it again'
      using errcode = '23514';
  end if;

  select version.* into v_version
  from valtrim.billing_setup_versions version
  where version.id = v_package.setup_version_id;

  -- Cells -----------------------------------------------------------------------------------
  if exists (
    select 1 from jsonb_array_elements(p_selections) item
    where jsonb_typeof(item) <> 'object'
       or not item ? 'lot_id'
       or not item ? 'draw_number'
  ) then
    raise exception 'Every selection must contain a Lot and Draw' using errcode = '23514';
  end if;

  select count(*),
    count(distinct row(selection.lot_id, selection.draw_number)),
    count(*) filter (
      where selection.lot_id is null or selection.lot_id <= 0
         or selection.draw_number is null or selection.draw_number <= 0
    )
  into v_requested, v_unique, v_invalid
  from jsonb_to_recordset(p_selections) as selection(lot_id bigint, draw_number smallint);

  if v_requested <> jsonb_array_length(p_selections)
     or v_unique <> v_requested or v_invalid <> 0 then
    raise exception 'Every Lot / Draw cell must be unique and valid' using errcode = '23514';
  end if;

  select count(*) into v_found
  from jsonb_to_recordset(p_selections) as selection(lot_id bigint, draw_number smallint)
  join valtrim.lots lot on lot.id = selection.lot_id
  join valtrim.phases phase on phase.id = lot.phase_id and phase.job_id = v_package.job_id
  join valtrim.billing_draws draw
    on draw.draw_number = selection.draw_number
   and draw.setup_version_id = v_package.setup_version_id;
  if v_found <> v_requested then
    raise exception 'Every cell must belong to a Phase in the Package Job and Billing Setup'
      using errcode = '23503';
  end if;

  -- Separate Hardware ----------------------------------------------------------------------
  if exists (
    select 1 from jsonb_array_elements(p_hardware_selections) item
    where jsonb_typeof(item) <> 'object'
       or jsonb_typeof(item -> 'lot_id') is distinct from 'number'
       or jsonb_typeof(item -> 'event_type') is distinct from 'string'
       or item ->> 'lot_id' !~ '^[1-9][0-9]*$'
       or item ->> 'event_type' not in ('EXT', 'DM', 'HW')
  ) then
    raise exception 'Every Separate Hardware line needs a valid Lot and Calendar event'
      using errcode = '23514';
  end if;

  select count(*), count(distinct row(selection.lot_id, selection.event_type))
  into v_hardware_requested, v_hardware_unique
  from jsonb_to_recordset(p_hardware_selections) as selection(lot_id bigint, event_type text);
  if v_hardware_unique <> v_hardware_requested then
    raise exception 'Every Separate Hardware Lot / Calendar event must be unique'
      using errcode = '23514';
  end if;

  select count(*) into v_found
  from jsonb_to_recordset(p_hardware_selections) as selection(lot_id bigint, event_type text)
  join valtrim.lots lot on lot.id = selection.lot_id and not lot.is_utility_building
  join valtrim.phases phase on phase.id = lot.phase_id and phase.job_id = v_package.job_id;
  if v_found <> v_hardware_requested then
    raise exception 'Every Separate Hardware line must belong to a non-Utility Lot in this Job'
      using errcode = '23503';
  end if;

  -- Single Options to release ---------------------------------------------------------------
  if exists (
    select 1 from jsonb_array_elements(p_released_options) item
    where jsonb_typeof(item) <> 'object'
       or jsonb_typeof(item -> 'lot_id') is distinct from 'number'
       or jsonb_typeof(item -> 'option_id') is distinct from 'number'
       or jsonb_typeof(item -> 'unit_no') is distinct from 'number'
       or item ->> 'lot_id' !~ '^[1-9][0-9]*$'
       or item ->> 'option_id' !~ '^[1-9][0-9]*$'
       or item ->> 'unit_no' !~ '^[1-9][0-9]*$'
  ) then
    raise exception 'Every released Option needs a valid Lot, Option and unit'
      using errcode = '23514';
  end if;

  select count(*), count(distinct row(released.lot_id, released.option_id, released.unit_no))
  into v_released_requested, v_released_unique
  from jsonb_to_recordset(p_released_options)
    as released(lot_id bigint, option_id bigint, unit_no integer);
  if v_released_unique <> v_released_requested then
    raise exception 'Every released Option must be unique' using errcode = '23514';
  end if;

  select count(*) into v_found
  from jsonb_to_recordset(p_released_options)
    as released(lot_id bigint, option_id bigint, unit_no integer)
  join valtrim.package_options billed
    on billed.package_id = p_package_id
   and billed.lot_id = released.lot_id
   and billed.option_id = released.option_id
   and billed.unit_no = released.unit_no;
  if v_found <> v_released_requested then
    raise exception 'Every released Option must currently belong to this Package'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_hardware_selections) as selection(lot_id bigint, event_type text)
    where not exists (
      select 1 from valtrim.package_hardware_lines line
      where line.package_id = p_package_id
        and line.lot_id = selection.lot_id
        and line.hardware_event_type::text = selection.event_type
    )
  ) and (not v_version.separate_hardware_price or v_version.hardware_billing_mode <> 'BY_EVENT') then
    raise exception 'This Job Billing Setup does not use Separate Hardware by Calendar event'
      using errcode = '23514';
  end if;

  -- Before ------------------------------------------------------------------------------------
  select invoice.gross_amount, invoice.retention_amount, invoice.wrap_amount, invoice.net_amount
  into v_before
  from valtrim.invoices invoice where invoice.package_id = p_package_id;

  select
    (select count(*) from valtrim.package_draws where package_id = p_package_id),
    (select count(*) from valtrim.package_hardware_lines where package_id = p_package_id),
    (select count(*) from valtrim.package_options where package_id = p_package_id)
  into v_cells_before, v_hardware_before, v_options_before;

  select coalesce(jsonb_agg(jsonb_build_object(
    'sent_at', submission.sent_at,
    'destination', submission.destination
  ) order by submission.sent_at desc), '[]'::jsonb)
  into v_sent
  from valtrim.package_submissions submission
  where submission.package_id = p_package_id;

  -- The edit, in a block of its own: a dry run raises P0009 at the end to roll it all back ------
  begin
    perform set_config('valtrim.invoiced_package_edit', p_package_id::text, true);

    if exists (
      select 1
      from jsonb_to_recordset(p_selections) as selection(lot_id bigint, draw_number smallint)
      join valtrim.billing_draws draw
        on draw.draw_number = selection.draw_number
       and draw.setup_version_id = v_package.setup_version_id
      join valtrim.package_draws occupied
        on occupied.lot_id = selection.lot_id and occupied.draw_id = draw.id
      where occupied.package_id <> p_package_id
    ) then
      raise exception 'A requested cell belongs to another Package'
        using errcode = '23505';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'phase_id', line.phase_id,
      'lot_id', line.lot_id,
      'lot_number', line.lot_number,
      'draw_number', line.draw_number
    ) order by line.phase_id, line.draw_number, line.lot_id), '[]'::jsonb)
    into v_removed
    from valtrim.package_draws line
    where line.package_id = p_package_id
      and not exists (
        select 1 from jsonb_to_recordset(p_selections)
          as selection(lot_id bigint, draw_number smallint)
        where selection.lot_id = line.lot_id
          and selection.draw_number = line.draw_number
      );

    select coalesce(jsonb_agg(jsonb_build_object(
      'phase_id', lot.phase_id,
      'lot_id', selection.lot_id,
      'lot_number', lot.lot_number,
      'draw_number', selection.draw_number
    ) order by lot.phase_id, selection.draw_number, selection.lot_id), '[]'::jsonb)
    into v_added
    from jsonb_to_recordset(p_selections) as selection(lot_id bigint, draw_number smallint)
    join valtrim.lots lot on lot.id = selection.lot_id
    where not exists (
      select 1 from valtrim.package_draws line
      where line.package_id = p_package_id
        and line.lot_id = selection.lot_id
        and line.draw_number = selection.draw_number
    );

    select coalesce(jsonb_agg(jsonb_build_object(
      'lot_id', billed.lot_id,
      'option_id', billed.option_id,
      'unit_no', billed.unit_no,
      'phase_code', billed.phase_code,
      'lot_number', billed.lot_number,
      'option_code', billed.option_code,
      'option_name', billed.option_name,
      'option_price', billed.option_price
    ) order by billed.phase_code, billed.lot_number, billed.option_id, billed.unit_no), '[]'::jsonb)
    into v_released
    from valtrim.package_options billed
    join jsonb_to_recordset(p_released_options)
      as released(lot_id bigint, option_id bigint, unit_no integer)
      on released.lot_id = billed.lot_id
     and released.option_id = billed.option_id
     and released.unit_no = billed.unit_no
    where billed.package_id = p_package_id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'lot_id', line.lot_id,
      'lot_number', line.lot_number,
      'phase_code', line.phase_code,
      'event_type', line.hardware_event_type::text
    ) order by line.phase_code, line.lot_number, line.hardware_event_type), '[]'::jsonb)
    into v_removed_hardware
    from valtrim.package_hardware_lines line
    where line.package_id = p_package_id
      and not exists (
        select 1 from jsonb_to_recordset(p_hardware_selections)
          as selection(lot_id bigint, event_type text)
        where selection.lot_id = line.lot_id
          and selection.event_type = line.hardware_event_type::text
      );

    select coalesce(jsonb_agg(jsonb_build_object(
      'lot_id', selection.lot_id,
      'lot_number', lot.lot_number,
      'phase_code', phase.code,
      'event_type', selection.event_type
    ) order by phase.code, lot.lot_number, selection.event_type), '[]'::jsonb)
    into v_added_hardware
    from jsonb_to_recordset(p_hardware_selections) as selection(lot_id bigint, event_type text)
    join valtrim.lots lot on lot.id = selection.lot_id
    join valtrim.phases phase on phase.id = lot.phase_id
    where not exists (
      select 1 from valtrim.package_hardware_lines line
      where line.package_id = p_package_id
        and line.lot_id = selection.lot_id
        and line.hardware_event_type::text = selection.event_type
    );

    if v_removed = '[]'::jsonb and v_added = '[]'::jsonb
       and v_released = '[]'::jsonb
       and v_removed_hardware = '[]'::jsonb and v_added_hardware = '[]'::jsonb
       and v_notes is not distinct from v_package.notes then
      raise exception 'The Package has no changes to save' using errcode = '23514';
    end if;

    -- Every Option the Package holds now, to tell at the end which ones left.
    select coalesce(jsonb_agg(jsonb_build_object(
      'lot_id', billed.lot_id,
      'option_id', billed.option_id,
      'unit_no', billed.unit_no,
      'phase_code', billed.phase_code,
      'lot_number', billed.lot_number,
      'option_code', billed.option_code,
      'option_name', billed.option_name,
      'option_price', billed.option_price
    ) order by billed.phase_code, billed.lot_number, billed.option_id, billed.unit_no), '[]'::jsonb)
    into v_snapshot
    from valtrim.package_options billed
    where billed.package_id = p_package_id;

    -- The Options released one by one, and those of a Lot none of whose cells stays: they cannot be
    -- billed on a Package that no longer bills the Lot, even when another cell carries them.
    select coalesce(jsonb_agg(jsonb_build_object(
      'lot_id', billed.lot_id,
      'option_id', billed.option_id,
      'unit_no', billed.unit_no
    )), '[]'::jsonb)
    into v_all_released
    from valtrim.package_options billed
    where billed.package_id = p_package_id
      and (
        exists (
          select 1
          from jsonb_to_recordset(p_released_options)
            as released(lot_id bigint, option_id bigint, unit_no integer)
          where released.lot_id = billed.lot_id
            and released.option_id = billed.option_id
            and released.unit_no = billed.unit_no
        )
        or not exists (
          select 1
          from jsonb_to_recordset(p_selections) as selection(lot_id bigint, draw_number smallint)
          where selection.lot_id = billed.lot_id
        )
      );

    -- Cells that leave, with the Options billed on them.
    delete from valtrim.package_options billed
    using valtrim.package_draws line
    where billed.package_id = p_package_id
      and line.package_id = p_package_id
      and line.lot_id = billed.billing_lot_id
      and line.draw_id = billed.draw_id
      and not exists (
        select 1 from jsonb_to_recordset(p_selections)
          as selection(lot_id bigint, draw_number smallint)
        where selection.lot_id = line.lot_id
          and selection.draw_number = line.draw_number
      );

    delete from valtrim.package_draws line
    where line.package_id = p_package_id
      and not exists (
        select 1 from jsonb_to_recordset(p_selections)
          as selection(lot_id bigint, draw_number smallint)
        where selection.lot_id = line.lot_id
          and selection.draw_number = line.draw_number
      );

    -- Cells that stay but lose Options are generated again with the Options they keep.
    for v_anchor in
      select line.lot_id, line.draw_id, line.draw_number,
        line.hardware_amount > 0 as had_hardware
      from valtrim.package_draws line
      where line.package_id = p_package_id
        and exists (
          select 1
          from valtrim.package_options billed
          join jsonb_to_recordset(v_all_released)
            as released(lot_id bigint, option_id bigint, unit_no integer)
            on released.lot_id = billed.lot_id
           and released.option_id = billed.option_id
           and released.unit_no = billed.unit_no
          where billed.package_id = p_package_id
            and billed.billing_lot_id = line.lot_id
            and billed.draw_id = line.draw_id
        )
      order by line.draw_number, line.lot_id
    loop
      select coalesce(jsonb_agg(jsonb_build_object(
        'lot_id', billed.lot_id,
        'option_id', billed.option_id,
        'unit_no', billed.unit_no
      ) order by billed.lot_id, billed.option_id, billed.unit_no), '[]'::jsonb)
      into v_kept
      from valtrim.package_options billed
      where billed.package_id = p_package_id
        and billed.billing_lot_id = v_anchor.lot_id
        and billed.draw_id = v_anchor.draw_id
        and not exists (
          select 1
          from jsonb_to_recordset(v_all_released)
            as released(lot_id bigint, option_id bigint, unit_no integer)
          where released.lot_id = billed.lot_id
            and released.option_id = billed.option_id
            and released.unit_no = billed.unit_no
        );

      delete from valtrim.package_options billed
      where billed.package_id = p_package_id
        and billed.billing_lot_id = v_anchor.lot_id
        and billed.draw_id = v_anchor.draw_id;

      delete from valtrim.package_draws line
      where line.package_id = p_package_id
        and line.lot_id = v_anchor.lot_id
        and line.draw_id = v_anchor.draw_id;

      perform set_config(
        'valtrim.draw_package_option_charge',
        jsonb_build_object(
          'anchor_lot_id', v_anchor.lot_id,
          'anchor_draw_number', v_anchor.draw_number,
          'package_options', v_kept
        )::text,
        true
      );
      perform set_config(
        'valtrim.draw_package_hardware_charge',
        jsonb_build_array(jsonb_build_object(
          'lot_id', v_anchor.lot_id,
          'draw_number', v_anchor.draw_number,
          'charge_hardware', v_anchor.had_hardware
        ))::text,
        true
      );

      insert into valtrim.package_draws (package_id, lot_id, draw_id)
      values (p_package_id, v_anchor.lot_id, v_anchor.draw_id);

      if (
        select coalesce(sum(billed.option_price), 0)
        from valtrim.package_options billed
        where billed.package_id = p_package_id
          and billed.billing_lot_id = v_anchor.lot_id
          and billed.draw_id = v_anchor.draw_id
      ) <> (
        select coalesce(sum(line.options_amount), 0)
        from valtrim.package_draws line
        where line.package_id = p_package_id
          and line.lot_id = v_anchor.lot_id
          and line.draw_id = v_anchor.draw_id
      ) then
        raise exception 'The Options kept on a cell do not add up to what its line bills'
          using errcode = '23514';
      end if;
    end loop;

    perform set_config('valtrim.draw_package_option_charge', '', true);
    perform set_config('valtrim.draw_package_hardware_charge', '', true);

    -- New cells. A BY_EVENT setup keeps Hardware out of the Draw lines.
    v_draw_flags := case
      when v_version.hardware_billing_mode = 'BY_EVENT' then (
        select coalesce(jsonb_agg(item.value - 'charge_hardware' order by item.ordinality), '[]'::jsonb)
        from jsonb_array_elements(p_selections) with ordinality item(value, ordinality)
      )
      else p_selections
    end;
    perform set_config('valtrim.draw_package_option_charge', '', true);
    perform set_config('valtrim.draw_package_hardware_charge', v_draw_flags::text, true);

    insert into valtrim.package_draws (package_id, lot_id, draw_id)
    select p_package_id, lot.id, draw.id
    from jsonb_to_recordset(p_selections) as selection(lot_id bigint, draw_number smallint)
    join valtrim.lots lot on lot.id = selection.lot_id
    join valtrim.phases phase on phase.id = lot.phase_id and phase.job_id = v_package.job_id
    join valtrim.billing_draws draw
      on draw.draw_number = selection.draw_number
     and draw.setup_version_id = v_package.setup_version_id
    where not exists (
      select 1 from valtrim.package_draws line
      where line.package_id = p_package_id
        and line.lot_id = lot.id and line.draw_id = draw.id
    )
    order by phase.code, selection.draw_number, lot.lot_number;
    get diagnostics v_changed = row_count;
    if v_changed <> jsonb_array_length(v_added) then
      raise exception 'The edit did not insert every new cell' using errcode = '23514';
    end if;

    perform set_config('valtrim.draw_package_hardware_charge', '', true);

    -- Separate Hardware lines.
    delete from valtrim.package_hardware_lines line
    where line.package_id = p_package_id
      and not exists (
        select 1 from jsonb_to_recordset(p_hardware_selections)
          as selection(lot_id bigint, event_type text)
        where selection.lot_id = line.lot_id
          and selection.event_type = line.hardware_event_type::text
      );

    insert into valtrim.package_hardware_lines (
      package_id, lot_id, hardware_event_type, job_id, phase_id, builder_id,
      setup_version_id, plan_id, plan_price_id, lot_number, phase_code,
      plan_code, plan_name, is_reverse, hardware_price, hardware_percentage,
      hardware_amount, gross_amount, net_amount
    )
    select
      p_package_id,
      selection.lot_id,
      selection.event_type::valtrim.production_stage_type,
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
    from jsonb_to_recordset(p_hardware_selections) as selection(lot_id bigint, event_type text)
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
            and candidate.effective_from <= v_package.package_date
            and (
              candidate.effective_to is null
              or candidate.effective_to >= v_package.package_date
            )
          )
        )
      order by candidate.effective_from desc, candidate.id desc
      limit 1
    ) price on true
    where not exists (
      select 1 from valtrim.package_hardware_lines line
      where line.package_id = p_package_id
        and line.lot_id = selection.lot_id
        and line.hardware_event_type::text = selection.event_type
    )
    order by phase.code, lot.lot_number, selection.event_type;
    get diagnostics v_changed = row_count;
    if v_changed <> jsonb_array_length(v_added_hardware) then
      raise exception 'Every Separate Hardware line needs a current Plan price'
        using errcode = '23503';
    end if;

    select
      (select count(*) from valtrim.package_draws where package_id = p_package_id),
      (select count(*) from valtrim.package_hardware_lines where package_id = p_package_id),
      (select count(*) from valtrim.package_options where package_id = p_package_id)
    into v_cells_after, v_hardware_after, v_options_after;

    -- Everything that left the Package: released one by one, with its Lot, or on a cell that left.
    select coalesce(jsonb_agg(left_option.value order by left_option.ordinality), '[]'::jsonb)
    into v_released
    from jsonb_array_elements(v_snapshot) with ordinality left_option(value, ordinality)
    where not exists (
      select 1 from valtrim.package_options kept
      where kept.package_id = p_package_id
        and kept.lot_id = (left_option.value ->> 'lot_id')::bigint
        and kept.option_id = (left_option.value ->> 'option_id')::bigint
        and kept.unit_no = (left_option.value ->> 'unit_no')::integer
    );

    if v_cells_after + v_hardware_after = 0 then
      raise exception 'A Package must keep at least one Lot / Draw cell or Separate Hardware line. To bill nothing, void the invoice instead'
        using errcode = '23514';
    end if;

    update valtrim.draw_packages
    set phase_id = (
          select case when count(distinct scope.phase_id) = 1 then min(scope.phase_id) else null end
          from (
            select line.phase_id from valtrim.package_draws line where line.package_id = p_package_id
            union all
            select line.phase_id from valtrim.package_hardware_lines line where line.package_id = p_package_id
          ) scope
        ),
        notes = v_notes,
        updated_by = p_actor_id,
        updated_at = now()
    where id = p_package_id;

    -- The Release and the Payment Schedule print the Package amount, so they no longer fit.
    for v_doc in
      select document.id, document.document_type::text as document_type,
        document.label, document.is_required, document.file_id,
        file.object_path, file.original_filename
      from valtrim.package_documents document
      left join valtrim.stored_files file on file.id = document.file_id
      where document.package_id = p_package_id
        and document.document_type::text in ('RELEASE', 'PAYMENT_SCHEDULE')
        and document.file_id is not null
      order by document.id
    loop
      v_documents := v_documents || jsonb_build_array(jsonb_build_object(
        'id', v_doc.id,
        'document_type', v_doc.document_type,
        'label', v_doc.label,
        'file_name', v_doc.original_filename
      ));
      if v_doc.object_path is not null then
        v_storage_paths := v_storage_paths || to_jsonb(v_doc.object_path);
      end if;

      if v_doc.document_type = 'PAYMENT_SCHEDULE' and v_doc.is_required then
        update valtrim.package_documents document
        set status = 'MISSING', file_id = null, completed_at = null,
            completed_by = null, updated_at = now()
        where document.id = v_doc.id;
      else
        delete from valtrim.package_documents document where document.id = v_doc.id;
      end if;
      delete from valtrim.stored_files file where file.id = v_doc.file_id;
    end loop;

    select invoice.gross_amount, invoice.retention_amount, invoice.wrap_amount, invoice.net_amount
    into v_after
    from valtrim.invoices invoice where invoice.package_id = p_package_id;

    insert into valtrim.draw_package_corrections (
      package_id, other_package_id, action, removed_cells, added_cells,
      previous_details, next_details, reason, changed_by
    ) values (
      p_package_id, null, 'EDIT_INVOICED', v_removed, v_added,
      jsonb_build_object(
        'notes', v_package.notes,
        'net_amount', v_before.net_amount,
        'invoice_number', v_sync.invoice_number
      ),
      jsonb_build_object(
        'notes', v_notes,
        'net_amount', v_after.net_amount,
        'invoice_number', v_sync.invoice_number,
        'released_options', v_released,
        'removed_hardware', v_removed_hardware,
        'added_hardware', v_added_hardware,
        'removed_documents', v_documents
      ),
      v_reason, p_actor_id
    );

    update valtrim.quickbooks_invoice_syncs
    set update_pending = true,
        update_error = null,
        update_request_id = gen_random_uuid()
    where package_id = p_package_id;

    v_result := jsonb_build_object(
      'package_id', p_package_id,
      'package_number', v_package.package_number,
      'invoice_number', v_sync.invoice_number,
      'qbo_invoice_id', v_sync.qbo_invoice_id,
      'dry_run', p_dry_run,
      'previous', jsonb_build_object(
        'gross', v_before.gross_amount, 'retention', v_before.retention_amount,
        'wrap', v_before.wrap_amount, 'net', v_before.net_amount,
        'cells', v_cells_before, 'hardware_lines', v_hardware_before,
        'options', v_options_before
      ),
      'next', jsonb_build_object(
        'gross', v_after.gross_amount, 'retention', v_after.retention_amount,
        'wrap', v_after.wrap_amount, 'net', v_after.net_amount,
        'cells', v_cells_after, 'hardware_lines', v_hardware_after,
        'options', v_options_after
      ),
      'removed_cells', v_removed,
      'added_cells', v_added,
      'released_options', v_released,
      'removed_hardware', v_removed_hardware,
      'added_hardware', v_added_hardware,
      'removed_documents', v_documents,
      'removed_storage_paths', case when p_dry_run then '[]'::jsonb else v_storage_paths end,
      'sent', v_sent
    );

    perform set_config('valtrim.draw_package_option_charge', '', true);
    perform set_config('valtrim.draw_package_hardware_charge', '', true);
    perform set_config('valtrim.invoiced_package_edit', '', true);

    if p_dry_run then
      raise exception 'Dry run' using errcode = 'P0009';
    end if;
  exception
    when sqlstate 'P0009' then
      -- Everything the block did is rolled back; v_result keeps what the edit would have done.
      null;
  end;

  return v_result;
end;
$$;

-- 5. Closing the loop with QuickBooks -----------------------------------------------------------------

-- QuickBooks accepted the new lines of the same invoice.
create function valtrim.complete_quickbooks_invoice_update(
  p_package_id bigint,
  p_qbo_sync_token text,
  p_total_amount numeric,
  p_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update valtrim.quickbooks_invoice_syncs
  set qbo_sync_token = nullif(btrim(p_qbo_sync_token), ''),
      total_amount = p_total_amount,
      qbo_total = p_total_amount,
      qbo_balance = p_total_amount,
      payload = p_payload,
      update_pending = false,
      update_error = null,
      updated_in_quickbooks_at = now()
  where package_id = p_package_id
    and status = 'CREATED'
    and update_pending;

  if not found then
    raise exception 'No QuickBooks update is waiting for this Package'
      using errcode = '55000';
  end if;

  return true;
end;
$$;

-- QuickBooks did not take the change: the Package keeps waiting and says why. After an answer that
-- certainly changed nothing (a refusal), the next try gets a request id of its own; after one that
-- may have reached QuickBooks (network, 5xx) it keeps the same, so QuickBooks does not apply it twice.
create function valtrim.fail_quickbooks_invoice_update(
  p_package_id bigint,
  p_error text,
  p_request_reusable boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update valtrim.quickbooks_invoice_syncs
  set update_error = left(coalesce(nullif(btrim(p_error), ''), 'Unknown error'), 1000),
      update_request_id = case
        when coalesce(p_request_reusable, true) then update_request_id
        else gen_random_uuid()
      end
  where package_id = p_package_id
    and status = 'CREATED'
    and update_pending;

  return found;
end;
$$;

-- 6. Only the Edge Function (service role) can use them ------------------------------------------------

revoke execute on function valtrim.edit_invoiced_draw_package(
  uuid, bigint, jsonb, jsonb, jsonb, text, text, boolean
) from public, anon, authenticated;
revoke execute on function valtrim.complete_quickbooks_invoice_update(bigint, text, numeric, jsonb)
  from public, anon, authenticated;
revoke execute on function valtrim.fail_quickbooks_invoice_update(bigint, text, boolean)
  from public, anon, authenticated;

grant execute on function valtrim.edit_invoiced_draw_package(
  uuid, bigint, jsonb, jsonb, jsonb, text, text, boolean
) to service_role;
grant execute on function valtrim.complete_quickbooks_invoice_update(bigint, text, numeric, jsonb)
  to service_role;
grant execute on function valtrim.fail_quickbooks_invoice_update(bigint, text, boolean)
  to service_role;

comment on function valtrim.edit_invoiced_draw_package(uuid, bigint, jsonb, jsonb, jsonb, text, text, boolean) is
  'Edits the cells, Separate Hardware lines and single Options of an unpaid Draw Package that waits for payment, removes its Release and Payment Schedule, and marks the QuickBooks invoice as waiting for the new lines. With p_dry_run nothing is kept. Service role only.';
comment on function valtrim.complete_quickbooks_invoice_update(bigint, text, numeric, jsonb) is
  'Records that QuickBooks received the new lines of the same invoice. Service role only.';
comment on function valtrim.fail_quickbooks_invoice_update(bigint, text, boolean) is
  'Records why QuickBooks did not receive the new lines yet. Service role only.';

notify pgrst, 'reload schema';

commit;
