-- Phase 9: allow Draw & Invoice Packages to contain an arbitrary set of
-- Lot / Draw cells instead of forcing the Cartesian product of two lists.
-- Existing Package snapshots and the Phase 8 read/RLS boundary are unchanged.

begin;

-- PostgREST does not support overloaded functions reliably. Replace the
-- Phase 8 creator with the same API name and one JSONB selection parameter.
revoke execute on function valtrim.create_draw_invoice_package(
  bigint, smallint[], bigint[], date, date, date, text
) from public, anon, authenticated, service_role;
revoke execute on function private.create_draw_invoice_package(
  bigint, smallint[], bigint[], date, date, date, text
) from public, anon, authenticated, service_role;

drop function valtrim.create_draw_invoice_package(
  bigint, smallint[], bigint[], date, date, date, text
);
drop function private.create_draw_invoice_package(
  bigint, smallint[], bigint[], date, date, date, text
);

create function private.create_draw_invoice_package(
  p_phase_id bigint,
  p_selections jsonb,
  p_package_date date default current_date,
  p_period_start date default null,
  p_period_end date default null,
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
  v_job_id bigint;
  v_version_id bigint;
  v_requested integer;
  v_unique integer;
  v_invalid integer;
  v_found integer;
  v_inserted integer;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to change Draw & Invoice Packages'
      using errcode = '42501';
  end if;

  if p_phase_id is null or p_phase_id <= 0 then
    raise exception 'Select an active Phase'
      using errcode = '23503';
  end if;

  if jsonb_typeof(p_selections) is distinct from 'array' then
    raise exception 'Selections must be a JSON array'
      using errcode = '23514';
  end if;

  if jsonb_array_length(p_selections) = 0 then
    raise exception 'Select at least one Lot / Draw cell'
      using errcode = '23514';
  end if;

  if jsonb_array_length(p_selections) > 5000 then
    raise exception 'A Package cannot contain more than 5000 Lot / Draw cells'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_selections) item
    where jsonb_typeof(item) <> 'object'
       or not item ? 'lot_id'
       or not item ? 'draw_number'
  ) then
    raise exception 'Every selection must contain a Lot and Draw'
      using errcode = '23514';
  end if;

  select
    count(*),
    count(distinct row(selection.lot_id, selection.draw_number)),
    count(*) filter (
      where selection.lot_id is null
         or selection.lot_id <= 0
         or selection.draw_number is null
         or selection.draw_number <= 0
    )
  into v_requested, v_unique, v_invalid
  from jsonb_to_recordset(p_selections)
    as selection(lot_id bigint, draw_number smallint);

  if v_requested <> jsonb_array_length(p_selections)
     or v_unique <> v_requested
     or v_invalid <> 0 then
    raise exception 'Every Lot / Draw selection must be unique and valid'
      using errcode = '23514';
  end if;

  if p_package_date is null then
    raise exception 'Select a Package date'
      using errcode = '23514';
  end if;

  if p_period_start is not null
     and p_period_end is not null
     and p_period_end < p_period_start then
    raise exception 'Billing period end cannot precede its start'
      using errcode = '23514';
  end if;

  if p_notes is not null and char_length(btrim(p_notes)) > 500 then
    raise exception 'Package notes must contain 500 characters or fewer'
      using errcode = '23514';
  end if;

  select job.builder_id, job.id, job.billing_setup_version_id
  into v_builder_id, v_job_id, v_version_id
  from valtrim.phases phase
  join valtrim.jobs job on job.id = phase.job_id
  join valtrim.billing_setup_versions version
    on version.id = job.billing_setup_version_id
   and version.builder_id = job.builder_id
  where phase.id = p_phase_id
    and phase.is_active
    and job.is_active
    and version.status in ('ACTIVE', 'SUPERSEDED')
  for update of phase;

  if v_job_id is null then
    raise exception 'The Phase, Job or Billing Setup is no longer available'
      using errcode = '23503';
  end if;

  select count(*)
  into v_found
  from jsonb_to_recordset(p_selections)
    as selection(lot_id bigint, draw_number smallint)
  join valtrim.lots lot
    on lot.id = selection.lot_id
   and lot.phase_id = p_phase_id
  join valtrim.billing_draws draw
    on draw.draw_number = selection.draw_number
   and draw.setup_version_id = v_version_id;

  if v_found <> v_requested then
    raise exception 'Every selected cell must belong to the Phase and Billing Setup'
      using errcode = '23503';
  end if;

  insert into valtrim.draw_packages (
    builder_id,
    job_id,
    phase_id,
    setup_version_id,
    package_date,
    billing_period_start,
    billing_period_end,
    payment_terms_days,
    invoice_line_format,
    notes,
    workflow_status,
    status_changed_by,
    created_by,
    updated_by
  )
  select
    v_builder_id,
    v_job_id,
    p_phase_id,
    v_version_id,
    p_package_date,
    p_period_start,
    p_period_end,
    version.payment_terms_days,
    version.invoice_line_format,
    nullif(btrim(p_notes), ''),
    'DRAFT'::valtrim.package_workflow_status,
    v_actor_id,
    v_actor_id,
    v_actor_id
  from valtrim.billing_setup_versions version
  where version.id = v_version_id
  returning id into v_package_id;

  insert into valtrim.invoices (package_id, created_by, updated_by)
  values (v_package_id, v_actor_id, v_actor_id);

  insert into valtrim.package_draws (package_id, lot_id, draw_id)
  select v_package_id, lot.id, draw.id
  from jsonb_to_recordset(p_selections)
    as selection(lot_id bigint, draw_number smallint)
  join valtrim.lots lot
    on lot.id = selection.lot_id
   and lot.phase_id = p_phase_id
  join valtrim.billing_draws draw
    on draw.draw_number = selection.draw_number
   and draw.setup_version_id = v_version_id
  order by selection.draw_number, lot.lot_number;

  get diagnostics v_inserted = row_count;

  if v_inserted <> v_requested then
    raise exception 'The Package did not generate every selected Lot / Draw cell'
      using errcode = '23514';
  end if;

  return v_package_id;
end;
$$;

create function valtrim.create_draw_invoice_package(
  p_phase_id bigint,
  p_selections jsonb,
  p_package_date date default current_date,
  p_period_start date default null,
  p_period_end date default null,
  p_notes text default null
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.create_draw_invoice_package(
    p_phase_id,
    p_selections,
    p_package_date,
    p_period_start,
    p_period_end,
    p_notes
  );
$$;

revoke execute on function private.create_draw_invoice_package(
  bigint, jsonb, date, date, date, text
) from public, anon, authenticated;
revoke execute on function valtrim.create_draw_invoice_package(
  bigint, jsonb, date, date, date, text
) from public, anon, authenticated;

grant execute on function private.create_draw_invoice_package(
  bigint, jsonb, date, date, date, text
) to authenticated, service_role;
grant execute on function valtrim.create_draw_invoice_package(
  bigint, jsonb, date, date, date, text
) to authenticated, service_role;

comment on function valtrim.create_draw_invoice_package(
  bigint, jsonb, date, date, date, text
) is
  'Creates one Draw Package from exact Lot / Draw cells, immutable calculated snapshots and one Invoice total atomically. ADMIN and PROJECT_MANAGEMENT only.';

notify pgrst, 'reload schema';

commit;
