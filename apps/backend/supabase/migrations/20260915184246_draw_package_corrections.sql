-- Correct draft Draw Packages without copying an occupied Lot / Draw cell.
-- Issued, submitted, paid, or QuickBooks-linked Packages remain immutable.
begin;

create table valtrim.draw_package_corrections (
  id bigint generated always as identity primary key,
  package_id bigint not null references valtrim.draw_packages(id) on delete restrict,
  other_package_id bigint references valtrim.draw_packages(id) on delete restrict,
  action text not null check (action in ('EDIT', 'TRANSFER', 'CANCEL')),
  removed_cells jsonb not null default '[]'::jsonb
    check (jsonb_typeof(removed_cells) = 'array'),
  added_cells jsonb not null default '[]'::jsonb
    check (jsonb_typeof(added_cells) = 'array'),
  previous_details jsonb,
  next_details jsonb,
  reason varchar(500) not null check (btrim(reason) <> ''),
  changed_by uuid not null references valtrim.app_users(id) on delete restrict,
  changed_at timestamptz not null default now(),
  check (other_package_id is null or other_package_id <> package_id)
);

create index draw_package_corrections_package_date_idx
  on valtrim.draw_package_corrections (package_id, changed_at desc);
create index draw_package_corrections_other_package_idx
  on valtrim.draw_package_corrections (other_package_id)
  where other_package_id is not null;
create index draw_package_corrections_actor_idx
  on valtrim.draw_package_corrections (changed_by);

alter table valtrim.draw_package_corrections enable row level security;
revoke all on table valtrim.draw_package_corrections from public, anon, authenticated;
revoke all on sequence valtrim.draw_package_corrections_id_seq
  from public, anon, authenticated;
grant select (
  id, package_id, other_package_id, action, removed_cells, added_cells,
  previous_details, next_details, reason, changed_by, changed_at
) on valtrim.draw_package_corrections to authenticated;
create policy draw_package_corrections_select
on valtrim.draw_package_corrections for select to authenticated
using ((select private.is_active_user()));

-- Direct browser writes still have no grants. Only the role-checked correction
-- RPC can enable DELETE of calculated snapshots for its own transaction.
create or replace function valtrim.reject_package_line_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_package_id bigint := old.package_id;
begin
  if tg_op = 'DELETE'
     and current_setting('valtrim.draw_package_correction', true) = 'on'
     and (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT'))
     and exists (
       select 1
       from valtrim.draw_packages package
       join valtrim.invoices invoice on invoice.package_id = package.id
       where package.id = v_package_id
         and package.status = 'DRAFT'
         and package.workflow_status in ('DRAFT', 'READY_TO_SUBMIT')
         and package.quickbooks_status = 'NOT_CREATED'
         and package.quickbooks_reference is null
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
             and (document.file_id is not null
               or document.status in ('COMPLETE', 'WAIVED'))
         )
     ) then
    return old;
  end if;

  raise exception 'Calculated Package lines are immutable outside a draft correction'
    using errcode = '42501';
end;
$$;

-- The baseline totals trigger covered INSERT only. Corrections release rows,
-- so each DELETE must also recompute the draft Invoice from active snapshots.
drop trigger package_draws_recalculate_invoice on valtrim.package_draws;
create trigger package_draws_recalculate_invoice
after insert or delete on valtrim.package_draws
for each row execute function valtrim.recalculate_invoice_totals();

create function private.correct_draw_invoice_package(
  p_action text,
  p_package_id bigint,
  p_other_package_id bigint,
  p_selections jsonb,
  p_reason text,
  p_period_start date,
  p_period_end date,
  p_notes text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_phase_id bigint;
  v_target record;
  v_source record;
  v_requested integer;
  v_unique integer;
  v_invalid integer;
  v_found integer;
  v_changed integer;
  v_source_remaining integer;
  v_removed jsonb := '[]'::jsonb;
  v_added jsonb := '[]'::jsonb;
  v_old_details jsonb;
  v_new_details jsonb;
  v_reason text := nullif(btrim(p_reason), '');
  v_notes text := nullif(btrim(p_notes), '');
begin
  if v_actor is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to correct Draw Packages'
      using errcode = '42501';
  end if;

  if p_action is null or p_action not in ('EDIT', 'TRANSFER', 'CANCEL')
     or p_package_id is null or p_package_id <= 0 then
    raise exception 'Select a valid Package correction'
      using errcode = '23514';
  end if;
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'Enter a correction reason of 500 characters or fewer'
      using errcode = '23514';
  end if;

  -- The creator also locks the Phase before allocating cells. All corrections
  -- acquire that lock first, then Package locks in ascending ID order.
  select phase_id into v_phase_id
  from valtrim.draw_packages where id = p_package_id;
  if v_phase_id is null then
    raise exception 'The Draw Package no longer exists' using errcode = 'P0002';
  end if;
  perform 1 from valtrim.phases where id = v_phase_id for update;
  perform 1
  from valtrim.draw_packages
  where id = p_package_id
     or (p_action = 'TRANSFER' and id = p_other_package_id)
  order by id
  for update;

  select package.*, invoice.status as invoice_status,
    invoice.invoice_number, invoice.invoice_date, invoice.paid_amount
  into v_target
  from valtrim.draw_packages package
  join valtrim.invoices invoice on invoice.package_id = package.id
  where package.id = p_package_id;

  if v_target.id is null
     or v_target.status <> 'DRAFT'
     or v_target.workflow_status not in ('DRAFT', 'READY_TO_SUBMIT')
     or v_target.quickbooks_status <> 'NOT_CREATED'
     or v_target.quickbooks_reference is not null
     or v_target.submission_status <> 'NOT_SUBMITTED'
     or v_target.submitted_at is not null
     or v_target.invoice_status <> 'DRAFT'
     or v_target.invoice_number is not null
     or v_target.invoice_date is not null
     or v_target.paid_amount <> 0
     or exists (
       select 1 from valtrim.invoice_payments payment
       join valtrim.invoices invoice on invoice.id = payment.invoice_id
       where invoice.package_id = p_package_id
     )
     or exists (
       select 1 from valtrim.package_documents document
       where document.package_id = p_package_id
         and (document.file_id is not null
           or document.status in ('COMPLETE', 'WAIVED'))
     ) then
    raise exception 'Only an unissued, unsynced draft Package can be corrected'
      using errcode = '23514';
  end if;

  if p_action = 'TRANSFER' then
    if p_other_package_id is null or p_other_package_id = p_package_id then
      raise exception 'Choose a different source Package'
        using errcode = '23514';
    end if;
    select package.*, invoice.status as invoice_status,
      invoice.invoice_number, invoice.invoice_date, invoice.paid_amount
    into v_source
    from valtrim.draw_packages package
    join valtrim.invoices invoice on invoice.package_id = package.id
    where package.id = p_other_package_id;

    if v_source.id is null
       or v_source.phase_id <> v_target.phase_id
       or v_source.setup_version_id <> v_target.setup_version_id
       or v_source.job_id <> v_target.job_id
       or v_source.status <> 'DRAFT'
       or v_source.workflow_status not in ('DRAFT', 'READY_TO_SUBMIT')
       or v_source.quickbooks_status <> 'NOT_CREATED'
       or v_source.quickbooks_reference is not null
       or v_source.submission_status <> 'NOT_SUBMITTED'
       or v_source.submitted_at is not null
       or v_source.invoice_status <> 'DRAFT'
       or v_source.invoice_number is not null
       or v_source.invoice_date is not null
       or v_source.paid_amount <> 0
       or exists (
         select 1 from valtrim.invoice_payments payment
         join valtrim.invoices invoice on invoice.id = payment.invoice_id
         where invoice.package_id = p_other_package_id
       )
       or exists (
         select 1 from valtrim.package_documents document
         where document.package_id = p_other_package_id
           and (document.file_id is not null
             or document.status in ('COMPLETE', 'WAIVED'))
       ) then
      raise exception 'Source and destination must be editable Packages for the same Job, Phase and Billing Setup'
        using errcode = '23514';
    end if;
  elsif p_other_package_id is not null then
    raise exception 'Only a transfer may name another Package'
      using errcode = '23514';
  end if;

  if p_action <> 'CANCEL' then
    if jsonb_typeof(p_selections) is distinct from 'array' then
      raise exception 'Selections must be a JSON array'
        using errcode = '23514';
    end if;
    if jsonb_array_length(p_selections) = 0
       or jsonb_array_length(p_selections) > 5000 then
      raise exception 'Select between 1 and 5000 Lot / Draw cells'
        using errcode = '23514';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_selections) item
      where jsonb_typeof(item) <> 'object'
         or not item ? 'lot_id'
         or not item ? 'draw_number'
    ) then
      raise exception 'Every selection must contain a Lot and Draw'
        using errcode = '23514';
    end if;

    select count(*),
      count(distinct row(selection.lot_id, selection.draw_number)),
      count(*) filter (
        where selection.lot_id is null or selection.lot_id <= 0
           or selection.draw_number is null or selection.draw_number <= 0
      )
    into v_requested, v_unique, v_invalid
    from jsonb_to_recordset(p_selections)
      as selection(lot_id bigint, draw_number smallint);

    if v_requested <> jsonb_array_length(p_selections)
       or v_unique <> v_requested or v_invalid <> 0 then
      raise exception 'Every Lot / Draw cell must be unique and valid'
        using errcode = '23514';
    end if;

    select count(*) into v_found
    from jsonb_to_recordset(p_selections)
      as selection(lot_id bigint, draw_number smallint)
    join valtrim.lots lot
      on lot.id = selection.lot_id and lot.phase_id = v_target.phase_id
    join valtrim.billing_draws draw
      on draw.draw_number = selection.draw_number
     and draw.setup_version_id = v_target.setup_version_id;
    if v_found <> v_requested then
      raise exception 'Every cell must belong to the Package Phase and Billing Setup'
        using errcode = '23503';
    end if;
  end if;

  perform set_config('valtrim.draw_package_correction', 'on', true);

  if p_action = 'EDIT' then
    if v_notes is not null and char_length(v_notes) > 500 then
      raise exception 'Package notes must contain 500 characters or fewer'
        using errcode = '23514';
    end if;
    if p_period_start is not null and p_period_end is not null
       and p_period_end < p_period_start then
      raise exception 'Billing period end cannot precede its start'
        using errcode = '23514';
    end if;
    if exists (
      select 1
      from jsonb_to_recordset(p_selections)
        as selection(lot_id bigint, draw_number smallint)
      join valtrim.billing_draws draw
        on draw.draw_number = selection.draw_number
       and draw.setup_version_id = v_target.setup_version_id
      join valtrim.package_draws occupied
        on occupied.lot_id = selection.lot_id and occupied.draw_id = draw.id
      where occupied.package_id <> p_package_id
    ) then
      raise exception 'A requested cell belongs to another Package; use Transfer instead'
        using errcode = '23505';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'lot_id', line.lot_id, 'draw_number', line.draw_number
    ) order by line.draw_number, line.lot_id), '[]'::jsonb)
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
      'lot_id', selection.lot_id, 'draw_number', selection.draw_number
    ) order by selection.draw_number, selection.lot_id), '[]'::jsonb)
    into v_added
    from jsonb_to_recordset(p_selections)
      as selection(lot_id bigint, draw_number smallint)
    where not exists (
      select 1 from valtrim.package_draws line
      where line.package_id = p_package_id
        and line.lot_id = selection.lot_id
        and line.draw_number = selection.draw_number
    );

    delete from valtrim.package_options option
    using valtrim.package_draws line
    where option.package_id = p_package_id
      and line.package_id = p_package_id
      and line.lot_id = option.lot_id
      and line.draw_id = option.draw_id
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

    insert into valtrim.package_draws (package_id, lot_id, draw_id)
    select p_package_id, lot.id, draw.id
    from jsonb_to_recordset(p_selections)
      as selection(lot_id bigint, draw_number smallint)
    join valtrim.lots lot on lot.id = selection.lot_id
    join valtrim.billing_draws draw
      on draw.draw_number = selection.draw_number
     and draw.setup_version_id = v_target.setup_version_id
    where not exists (
      select 1 from valtrim.package_draws line
      where line.package_id = p_package_id
        and line.lot_id = lot.id and line.draw_id = draw.id
    )
    order by selection.draw_number, lot.lot_number;
    get diagnostics v_changed = row_count;
    if v_changed <> jsonb_array_length(v_added) then
      raise exception 'The edit did not insert every new cell'
        using errcode = '23514';
    end if;

    v_old_details := jsonb_build_object(
      'period_start', v_target.billing_period_start,
      'period_end', v_target.billing_period_end,
      'notes', v_target.notes
    );
    v_new_details := jsonb_build_object(
      'period_start', p_period_start,
      'period_end', p_period_end,
      'notes', v_notes
    );
    if v_removed = '[]'::jsonb and v_added = '[]'::jsonb
       and v_old_details = v_new_details then
      raise exception 'The Package has no changes to save'
        using errcode = '23514';
    end if;

    update valtrim.draw_packages
    set billing_period_start = p_period_start,
        billing_period_end = p_period_end,
        notes = v_notes,
        workflow_status = 'DRAFT',
        status_changed_at = now(),
        status_changed_by = v_actor,
        updated_by = v_actor,
        updated_at = now()
    where id = p_package_id;

  elsif p_action = 'TRANSFER' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'lot_id', selection.lot_id, 'draw_number', selection.draw_number
    ) order by selection.draw_number, selection.lot_id), '[]'::jsonb)
    into v_added
    from jsonb_to_recordset(p_selections)
      as selection(lot_id bigint, draw_number smallint);
    v_removed := v_added;

    select count(*) into v_found
    from jsonb_to_recordset(p_selections)
      as selection(lot_id bigint, draw_number smallint)
    join valtrim.package_draws line
      on line.package_id = p_other_package_id
     and line.lot_id = selection.lot_id
     and line.draw_number = selection.draw_number;
    if v_found <> v_requested then
      raise exception 'Every transferred cell must currently belong to the source Package'
        using errcode = '23514';
    end if;

    delete from valtrim.package_options option
    using valtrim.package_draws line,
      jsonb_to_recordset(p_selections)
        as selection(lot_id bigint, draw_number smallint)
    where option.package_id = p_other_package_id
      and line.package_id = p_other_package_id
      and line.lot_id = option.lot_id
      and line.draw_id = option.draw_id
      and line.lot_id = selection.lot_id
      and line.draw_number = selection.draw_number;

    delete from valtrim.package_draws line
    using jsonb_to_recordset(p_selections)
      as selection(lot_id bigint, draw_number smallint)
    where line.package_id = p_other_package_id
      and line.lot_id = selection.lot_id
      and line.draw_number = selection.draw_number;
    get diagnostics v_changed = row_count;
    if v_changed <> v_requested then
      raise exception 'The transfer did not release every source cell'
        using errcode = '23514';
    end if;

    insert into valtrim.package_draws (package_id, lot_id, draw_id)
    select p_package_id, lot.id, draw.id
    from jsonb_to_recordset(p_selections)
      as selection(lot_id bigint, draw_number smallint)
    join valtrim.lots lot on lot.id = selection.lot_id
    join valtrim.billing_draws draw
      on draw.draw_number = selection.draw_number
     and draw.setup_version_id = v_target.setup_version_id
    order by selection.draw_number, lot.lot_number;
    get diagnostics v_changed = row_count;
    if v_changed <> v_requested then
      raise exception 'The transfer did not add every destination cell'
        using errcode = '23514';
    end if;

    select count(*) into v_source_remaining
    from valtrim.package_draws where package_id = p_other_package_id;
    if v_source_remaining = 0 then
      update valtrim.draw_packages
      set status = 'VOIDED',
          voided_at = now(),
          voided_by = v_actor,
          void_reason = v_reason,
          updated_by = v_actor,
          updated_at = now(),
          status_changed_at = now(),
          status_changed_by = v_actor
      where id = p_other_package_id;
    else
      update valtrim.draw_packages
      set workflow_status = 'DRAFT',
          updated_by = v_actor,
          updated_at = now(),
          status_changed_at = now(),
          status_changed_by = v_actor
      where id = p_other_package_id;
    end if;
    update valtrim.draw_packages
    set workflow_status = 'DRAFT',
        updated_by = v_actor,
        updated_at = now(),
        status_changed_at = now(),
        status_changed_by = v_actor
    where id = p_package_id;

  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'lot_id', line.lot_id, 'draw_number', line.draw_number
    ) order by line.draw_number, line.lot_id), '[]'::jsonb)
    into v_removed
    from valtrim.package_draws line where line.package_id = p_package_id;

    delete from valtrim.package_options where package_id = p_package_id;
    delete from valtrim.package_draws where package_id = p_package_id;
    update valtrim.draw_packages
    set status = 'VOIDED',
        voided_at = now(),
        voided_by = v_actor,
        void_reason = v_reason,
        updated_by = v_actor,
        updated_at = now(),
        status_changed_at = now(),
        status_changed_by = v_actor
    where id = p_package_id;
  end if;

  insert into valtrim.draw_package_corrections (
    package_id, other_package_id, action, removed_cells, added_cells,
    previous_details, next_details, reason, changed_by
  ) values (
    p_package_id, p_other_package_id, p_action, v_removed, v_added,
    v_old_details, v_new_details, v_reason, v_actor
  );

  perform set_config('valtrim.draw_package_correction', 'off', true);
  return p_package_id;
end;
$$;

create function valtrim.edit_draw_invoice_package(
  p_package_id bigint,
  p_selections jsonb,
  p_reason text,
  p_period_start date default null,
  p_period_end date default null,
  p_notes text default null
)
returns bigint language sql security invoker set search_path = ''
as $$
  select private.correct_draw_invoice_package(
    'EDIT', p_package_id, null, p_selections, p_reason,
    p_period_start, p_period_end, p_notes
  );
$$;

create function valtrim.transfer_draw_package_cells(
  p_to_package_id bigint,
  p_from_package_id bigint,
  p_selections jsonb,
  p_reason text
)
returns bigint language sql security invoker set search_path = ''
as $$
  select private.correct_draw_invoice_package(
    'TRANSFER', p_to_package_id, p_from_package_id, p_selections,
    p_reason, null, null, null
  );
$$;

create function valtrim.cancel_draw_invoice_package(
  p_package_id bigint,
  p_reason text
)
returns bigint language sql security invoker set search_path = ''
as $$
  select private.correct_draw_invoice_package(
    'CANCEL', p_package_id, null, null, p_reason, null, null, null
  );
$$;

-- A cancelled legacy Package cannot be revived by changing only the UI status.
create or replace function private.set_draw_package_workflow_status(
  p_package_id bigint,
  p_status valtrim.package_workflow_status
)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_package_id bigint;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to change Draw & Invoice Packages'
      using errcode = '42501';
  end if;
  if p_status is null then
    raise exception 'Select a valid Package status' using errcode = '23514';
  end if;

  update valtrim.draw_packages package
  set workflow_status = p_status,
      status_changed_at = now(),
      status_changed_by = v_actor_id,
      updated_by = v_actor_id
  where package.id = p_package_id and package.status <> 'VOIDED'
  returning package.id into v_package_id;
  if v_package_id is null then
    raise exception 'The Package is cancelled or no longer exists'
      using errcode = 'P0002';
  end if;
  return v_package_id;
end;
$$;

revoke execute on function private.correct_draw_invoice_package(
  text, bigint, bigint, jsonb, text, date, date, text
) from public, anon, authenticated;
revoke execute on function valtrim.edit_draw_invoice_package(
  bigint, jsonb, text, date, date, text
) from public, anon, authenticated;
revoke execute on function valtrim.transfer_draw_package_cells(
  bigint, bigint, jsonb, text
) from public, anon, authenticated;
revoke execute on function valtrim.cancel_draw_invoice_package(
  bigint, text
) from public, anon, authenticated;

grant execute on function private.correct_draw_invoice_package(
  text, bigint, bigint, jsonb, text, date, date, text
) to authenticated, service_role;
grant execute on function valtrim.edit_draw_invoice_package(
  bigint, jsonb, text, date, date, text
) to authenticated, service_role;
grant execute on function valtrim.transfer_draw_package_cells(
  bigint, bigint, jsonb, text
) to authenticated, service_role;
grant execute on function valtrim.cancel_draw_invoice_package(
  bigint, text
) to authenticated, service_role;

grant select (status, voided_at, void_reason)
on valtrim.draw_packages to authenticated;

comment on table valtrim.draw_package_corrections is
  'Audit of draft Package cell corrections; historical keys are not active billing lines.';
comment on function valtrim.edit_draw_invoice_package(bigint,jsonb,text,date,date,text) is
  'Edits draft Package selections and metadata atomically, keeping unchanged snapshots.';
comment on function valtrim.transfer_draw_package_cells(bigint,bigint,jsonb,text) is
  'Moves exact Lot / Draw cells between editable Packages without duplicate ownership.';
comment on function valtrim.cancel_draw_invoice_package(bigint,text) is
  'Cancels a draft Package, releases its cells and preserves an auditable header.';

notify pgrst, 'reload schema';
commit;
