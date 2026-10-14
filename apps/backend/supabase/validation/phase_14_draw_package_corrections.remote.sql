-- Rollback-only lifecycle check against two eligible existing Packages.
begin;

create temporary table phase14_validation (
  admin_id uuid not null,
  readonly_id uuid not null,
  target_id bigint not null,
  source_id bigint not null
) on commit drop;

insert into phase14_validation
select
  (select id from valtrim.app_users
    where role = 'ADMIN' and is_active order by created_at limit 1),
  (select id from valtrim.app_users
    where role = 'READ_ONLY' and is_active order by created_at limit 1),
  target.id,
  source.id
from valtrim.draw_packages target
join valtrim.invoices target_invoice on target_invoice.package_id = target.id
join valtrim.draw_packages source
  on source.job_id = target.job_id
 and source.phase_id = target.phase_id
 and source.setup_version_id = target.setup_version_id
 and source.id > target.id
join valtrim.invoices source_invoice on source_invoice.package_id = source.id
where target.status = 'DRAFT' and source.status = 'DRAFT'
  and target.workflow_status in ('DRAFT', 'READY_TO_SUBMIT')
  and source.workflow_status in ('DRAFT', 'READY_TO_SUBMIT')
  and target.quickbooks_status = 'NOT_CREATED'
  and source.quickbooks_status = 'NOT_CREATED'
  and target.quickbooks_reference is null
  and source.quickbooks_reference is null
  and target.submission_status = 'NOT_SUBMITTED'
  and source.submission_status = 'NOT_SUBMITTED'
  and target_invoice.status = 'DRAFT'
  and source_invoice.status = 'DRAFT'
  and target_invoice.invoice_number is null
  and source_invoice.invoice_number is null
  and target_invoice.invoice_date is null
  and source_invoice.invoice_date is null
  and target_invoice.paid_amount = 0
  and source_invoice.paid_amount = 0
  and exists (select 1 from valtrim.package_draws
    where package_id = target.id)
  and exists (select 1 from valtrim.package_draws
    where package_id = source.id)
  and not exists (select 1 from valtrim.package_documents document
    where document.package_id in (target.id, source.id)
      and (document.file_id is not null
        or document.status in ('COMPLETE', 'WAIVED')))
order by target.id, source.id
limit 1;

grant select on phase14_validation to authenticated;

select set_config('request.jwt.claim.sub',
  (select readonly_id::text from phase14_validation), true);
set local role authenticated;

do $$
declare
  v_test phase14_validation%rowtype;
  v_cells jsonb;
begin
  select * into strict v_test from phase14_validation;
  select jsonb_agg(jsonb_build_object(
    'lot_id', lot_id, 'draw_number', draw_number
  )) into strict v_cells
  from valtrim.package_draws where package_id = v_test.source_id;

  begin
    perform valtrim.edit_draw_invoice_package(
      v_test.source_id, v_cells, 'READ_ONLY must be denied'
    );
    raise exception 'READ_ONLY unexpectedly edited a Package';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub',
  (select admin_id::text from phase14_validation), true);
set local role authenticated;

do $$
declare
  v_test phase14_validation%rowtype;
  v_first jsonb;
  v_target_cells jsonb;
  v_remaining jsonb;
  v_final jsonb;
  v_target_count integer;
  v_source_count integer;
begin
  select * into strict v_test from phase14_validation;
  select count(*) into v_target_count from valtrim.package_draws
    where package_id = v_test.target_id;
  select count(*) into v_source_count from valtrim.package_draws
    where package_id = v_test.source_id;
  select jsonb_build_array(jsonb_build_object(
    'lot_id', lot_id, 'draw_number', draw_number
  )) into strict v_first
  from valtrim.package_draws
  where package_id = v_test.source_id
  order by lot_id, draw_number limit 1;
  select jsonb_agg(jsonb_build_object(
    'lot_id', lot_id, 'draw_number', draw_number
  )) into strict v_target_cells
  from valtrim.package_draws where package_id = v_test.target_id;

  begin
    perform valtrim.edit_draw_invoice_package(
      v_test.target_id, v_target_cells || v_first,
      'Occupied cell must use transfer'
    );
    raise exception 'An occupied cell was unexpectedly copied by edit';
  exception when unique_violation then null;
  end;

  perform valtrim.transfer_draw_package_cells(
    v_test.target_id, v_test.source_id, v_first,
    'This cell belongs in the earlier Package'
  );
  if (select count(*) from valtrim.package_draws
    where package_id = v_test.target_id) <> v_target_count + 1
    or (select count(*) from valtrim.package_draws
      where package_id = v_test.source_id) <> v_source_count - 1 then
    raise exception 'The first transfer duplicated or lost a cell';
  end if;

  select jsonb_agg(jsonb_build_object(
    'lot_id', lot_id, 'draw_number', draw_number
  ) order by lot_id, draw_number) into strict v_remaining
  from valtrim.package_draws where package_id = v_test.source_id;
  perform valtrim.transfer_draw_package_cells(
    v_test.target_id, v_test.source_id, v_remaining,
    'All remaining cells belong in the earlier Package'
  );
  if (select status from valtrim.draw_packages
    where id = v_test.source_id) <> 'VOIDED'
    or (select net_amount from valtrim.invoices
      where package_id = v_test.source_id) <> 0
    or (select count(*) from valtrim.package_draws
      where package_id = v_test.source_id) <> 0
    or (select count(*) from valtrim.package_options
      where package_id = v_test.source_id) <> 0 then
    raise exception 'An emptied source Package was not cancelled cleanly: status %, net %, draws %, options %',
      (select status from valtrim.draw_packages where id = v_test.source_id),
      (select net_amount from valtrim.invoices where package_id = v_test.source_id),
      (select count(*) from valtrim.package_draws where package_id = v_test.source_id),
      (select count(*) from valtrim.package_options where package_id = v_test.source_id);
  end if;
  if (select count(*) from valtrim.draw_package_corrections
    where package_id = v_test.target_id and action = 'TRANSFER') <> 2 then
    raise exception 'The two transfers were not audited';
  end if;

  begin
    perform valtrim.set_draw_package_workflow_status(
      v_test.source_id, 'READY_TO_SUBMIT'
    );
    raise exception 'A cancelled Package was unexpectedly reactivated';
  exception when no_data_found then null;
  end;

  select jsonb_agg(jsonb_build_object(
    'lot_id', line.lot_id, 'draw_number', line.draw_number
  ) order by line.lot_id, line.draw_number) into strict v_final
  from valtrim.package_draws line
  where line.package_id = v_test.target_id
    and not (line.lot_id = (v_first->0->>'lot_id')::bigint
      and line.draw_number = (v_first->0->>'draw_number')::smallint);
  perform valtrim.edit_draw_invoice_package(
    v_test.target_id, v_final, 'Remove a misplaced cell',
    '2026-09-01', '2026-09-15', 'Corrected draft'
  );
  if exists (select 1 from valtrim.package_draws
    where lot_id = (v_first->0->>'lot_id')::bigint
      and draw_number = (v_first->0->>'draw_number')::smallint)
    or (select workflow_status from valtrim.draw_packages
      where id = v_test.target_id) <> 'DRAFT'
    or (select count(*) from valtrim.package_draws
      where package_id = v_test.target_id)
      <> v_target_count + v_source_count - 1 then
    raise exception 'The edit did not release its removed cell';
  end if;

  if exists (
    select 1 from valtrim.invoices invoice
    cross join lateral (
      select coalesce(sum(gross_amount), 0)::valtrim.amount gross,
        coalesce(sum(retention_amount), 0)::valtrim.amount retention,
        coalesce(sum(wrap_amount), 0)::valtrim.amount wrap,
        coalesce(sum(net_amount), 0)::valtrim.amount net
      from valtrim.package_draws where package_id = invoice.package_id
    ) totals
    where invoice.package_id in (v_test.target_id, v_test.source_id)
      and row(invoice.gross_amount, invoice.retention_amount,
        invoice.wrap_amount, invoice.net_amount)
        is distinct from row(totals.gross, totals.retention,
          totals.wrap, totals.net)
  ) then
    raise exception 'Corrected Invoice totals differ from active snapshots';
  end if;
end;
$$;

reset role;
update valtrim.draw_packages set quickbooks_status = 'CREATED'
where id = (select target_id from phase14_validation);
set local role authenticated;

do $$
declare v_target_id bigint;
begin
  select target_id into strict v_target_id from phase14_validation;
  begin
    perform valtrim.cancel_draw_invoice_package(
      v_target_id, 'A QuickBooks-linked Package must be locked'
    );
    raise exception 'A QuickBooks-linked Package was unexpectedly cancelled';
  exception when check_violation then null;
  end;
end;
$$;

reset role;
update valtrim.draw_packages set quickbooks_status = 'NOT_CREATED'
where id = (select target_id from phase14_validation);
set local role authenticated;

do $$
declare v_test phase14_validation%rowtype;
begin
  select * into strict v_test from phase14_validation;
  perform valtrim.cancel_draw_invoice_package(
    v_test.target_id, 'The draft is no longer needed'
  );
  if (select status from valtrim.draw_packages
    where id = v_test.target_id) <> 'VOIDED'
    or (select net_amount from valtrim.invoices
      where package_id = v_test.target_id) <> 0
    or exists (select 1 from valtrim.package_draws
      where package_id in (v_test.target_id, v_test.source_id))
    or exists (select 1 from valtrim.package_options
      where package_id in (v_test.target_id, v_test.source_id))
    or (select count(*) from valtrim.draw_package_corrections
      where package_id = v_test.target_id) <> 4 then
    raise exception 'Cancellation did not release the Package cleanly';
  end if;
end;
$$;

reset role;
rollback;

select jsonb_build_object(
  'result', 'ok',
  'scenario', 'later-to-earlier transfer, edit, cancellation and guards',
  'rolled_back', true
) as phase14_validation;
