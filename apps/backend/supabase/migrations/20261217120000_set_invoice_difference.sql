-- Add, change or remove the manual DIFFERENCE line of a QuickBooks invoice that already exists.
--
-- Until now the line could only be typed while the invoice was being created. This lets a person with the same
-- roles as the Package edit (Admin, Accounting, Draw & Invoice) add it to a Package that is already invoiced and
-- waiting for payment, change it, or take it off, and the SAME QuickBooks invoice is updated (new line, new total).
--
-- The function only keeps the new line on the sync row and marks the invoice as "waiting for QuickBooks"; the Edge
-- function quickbooks-invoice-update then sends the lines (the Package lines plus the difference) to QuickBooks and
-- clears the mark with complete_quickbooks_invoice_update, exactly as it does after an edit of the Package. If
-- QuickBooks does not take it the Package keeps waiting and can be sent again.
--
-- The Release prints the check amount with or without the difference, so the one already generated no longer
-- fits and is removed (the Payment Schedule does not print it and stays). The change is written in the Package's
-- correction history as INVOICE_DIFFERENCE, with what it was and what it is now.

begin;

create function valtrim.set_invoice_difference(
  p_actor_id uuid,
  p_package_id bigint,
  p_description text,
  p_amount numeric,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_money constant text := 'FM999,999,990.00';
  v_description text;
  v_job_id bigint;
  v_package record;
  v_sync record;
  v_invoice record;
  v_limit numeric;
  v_previous jsonb;
  v_next jsonb;
  v_doc record;
  v_documents jsonb := '[]'::jsonb;
  v_storage_paths jsonb := '[]'::jsonb;
  v_sent jsonb;
begin
  if p_actor_id is null or not exists (
    select 1
    from valtrim.app_users actor
    where actor.id = p_actor_id
      and actor.is_active
      and actor.role::text in ('ADMIN', 'ACCOUNTING', 'DRAW_INVOICE')
  ) then
    raise exception 'You do not have permission to change the difference of a Draw & Invoice Package'
      using errcode = '42501';
  end if;

  if p_package_id is null or p_package_id <= 0 then
    raise exception 'Select a valid Package' using errcode = '23514';
  end if;
  if (p_description is null) <> (p_amount is null) then
    raise exception 'A difference needs both a description and an amount'
      using errcode = '23514';
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
    raise exception 'Only a Draw Package can have a difference line here' using errcode = '23514';
  end if;
  if v_package.status <> 'DRAFT'
     or v_package.workflow_status <> 'AWAITING_PAYMENT'
     or v_package.quickbooks_status <> 'CREATED'
     or v_sync.package_id is null
     or v_sync.status <> 'CREATED'
     or v_sync.qbo_invoice_id is null then
    raise exception 'Only a Package that is awaiting payment with a QuickBooks invoice can have its difference changed here'
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
    raise exception 'This invoice already has a payment or credit applied, so it cannot be changed'
      using errcode = '23514';
  end if;

  v_previous := case
    when v_sync.difference_amount is null then null
    else jsonb_build_object(
      'description', v_sync.difference_description,
      'amount', v_sync.difference_amount,
      'limit', v_sync.difference_limit
    )
  end;

  -- The same rules as when the invoice is created, measured on the net of the Package as it is now.
  if p_amount is not null then
    v_description := regexp_replace(btrim(p_description), '\s+', ' ', 'g');
    if v_description = '' or char_length(v_description) > 100 then
      raise exception 'The difference needs a description of up to 100 characters'
        using errcode = '23514';
    end if;
    if p_amount = 0 or p_amount <> round(p_amount, 2) then
      raise exception 'The difference must be an amount other than zero with at most two decimals'
        using errcode = '23514';
    end if;

    v_limit := valtrim.invoice_difference_limit(v_invoice.net_amount);
    if abs(p_amount) > v_limit then
      raise exception 'The difference of $% is greater than the $% allowed for an invoice of $%',
        to_char(abs(p_amount), v_money), to_char(v_limit, v_money), to_char(v_invoice.net_amount, v_money)
        using errcode = '23514';
    end if;
    if v_invoice.net_amount + p_amount <= 0 then
      raise exception 'The difference cannot bring the invoice total to $0.00 or less'
        using errcode = '23514';
    end if;

    v_next := jsonb_build_object('description', v_description, 'amount', p_amount, 'limit', v_limit);
  end if;

  if v_previous is not distinct from v_next
     or (
       v_previous is not null and v_next is not null
       and (v_previous ->> 'description') = (v_next ->> 'description')
       and (v_previous ->> 'amount')::numeric = (v_next ->> 'amount')::numeric
     ) then
    raise exception 'The invoice already has this difference line'
      using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'sent_at', submission.sent_at,
    'destination', submission.destination
  ) order by submission.sent_at desc), '[]'::jsonb)
  into v_sent
  from valtrim.package_submissions submission
  where submission.package_id = p_package_id;

  -- The Release printed the total with or without the line, so it is generated again.
  for v_doc in
    select document.id, document.document_type::text as document_type,
      document.label, document.file_id,
      file.object_path, file.original_filename
    from valtrim.package_documents document
    left join valtrim.stored_files file on file.id = document.file_id
    where document.package_id = p_package_id
      and document.document_type::text = 'RELEASE'
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

    if not p_dry_run then
      delete from valtrim.package_documents document where document.id = v_doc.id;
      delete from valtrim.stored_files file where file.id = v_doc.file_id;
    end if;
  end loop;

  if not p_dry_run then
    update valtrim.quickbooks_invoice_syncs
    set difference_description = v_description,
        difference_amount = p_amount,
        difference_limit = v_limit,
        difference_by = case when p_amount is null then null else p_actor_id end,
        difference_at = case when p_amount is null then null else now() end,
        update_pending = true,
        update_error = null,
        update_request_id = gen_random_uuid()
    where package_id = p_package_id;

    insert into valtrim.draw_package_corrections (
      package_id, action, previous_details, next_details, reason, changed_by
    ) values (
      p_package_id,
      'INVOICE_DIFFERENCE',
      jsonb_build_object(
        'net_amount', v_invoice.net_amount,
        'invoice_number', v_sync.invoice_number,
        'description', v_previous ->> 'description',
        'amount', (v_previous ->> 'amount')::numeric,
        'limit', (v_previous ->> 'limit')::numeric
      ),
      jsonb_build_object(
        'net_amount', v_invoice.net_amount,
        'invoice_number', v_sync.invoice_number,
        'description', v_next ->> 'description',
        'amount', (v_next ->> 'amount')::numeric,
        'limit', (v_next ->> 'limit')::numeric,
        'removed', v_next is null,
        'removed_documents', v_documents
      ),
      left(
        case
          when v_next is null then format(
            'Line "%s" of %s$%s taken off the QuickBooks invoice.',
            v_previous ->> 'description',
            case when (v_previous ->> 'amount')::numeric < 0 then '-' else '+' end,
            to_char(abs((v_previous ->> 'amount')::numeric), v_money)
          )
          when v_previous is null then format(
            'Line "%s" of %s$%s added to the QuickBooks invoice (limit $%s for a Package of $%s).',
            v_description,
            case when p_amount < 0 then '-' else '+' end,
            to_char(abs(p_amount), v_money),
            to_char(v_limit, v_money),
            to_char(v_invoice.net_amount, v_money)
          )
          else format(
            'Line of the QuickBooks invoice changed from "%s" %s$%s to "%s" %s$%s (limit $%s for a Package of $%s).',
            v_previous ->> 'description',
            case when (v_previous ->> 'amount')::numeric < 0 then '-' else '+' end,
            to_char(abs((v_previous ->> 'amount')::numeric), v_money),
            v_description,
            case when p_amount < 0 then '-' else '+' end,
            to_char(abs(p_amount), v_money),
            to_char(v_limit, v_money),
            to_char(v_invoice.net_amount, v_money)
          )
        end,
        500
      ),
      p_actor_id
    );
  end if;

  return jsonb_build_object(
    'package_id', p_package_id,
    'package_number', v_package.package_number,
    'invoice_number', v_sync.invoice_number,
    'qbo_invoice_id', v_sync.qbo_invoice_id,
    'dry_run', p_dry_run,
    'net', v_invoice.net_amount,
    'limit', valtrim.invoice_difference_limit(v_invoice.net_amount),
    'previous', v_previous,
    'next', v_next,
    'previous_total', v_invoice.net_amount + coalesce((v_previous ->> 'amount')::numeric, 0),
    'next_total', v_invoice.net_amount + coalesce(p_amount, 0),
    'removed_documents', v_documents,
    'removed_storage_paths', case when p_dry_run then '[]'::jsonb else v_storage_paths end,
    'sent', v_sent
  );
end;
$$;

revoke all on function valtrim.set_invoice_difference(uuid, bigint, text, numeric, boolean)
  from public, anon, authenticated;
grant execute on function valtrim.set_invoice_difference(uuid, bigint, text, numeric, boolean)
  to service_role;

comment on function valtrim.set_invoice_difference(uuid, bigint, text, numeric, boolean) is
  'Adds, changes or removes (null description and amount) the manual difference line of a QuickBooks invoice that already exists; marks the invoice as waiting for QuickBooks. Only the Edge function runs it.';

commit;
