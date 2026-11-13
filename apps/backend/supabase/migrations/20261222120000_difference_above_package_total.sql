-- The DIFFERENCE line may be MORE than the Package total, with a reason.
--
-- Until now the line was limited either way ($5 for every $5,000 of invoice). That limit exists so a Builder is
-- not charged less than what the work is worth by mistake. When the total the Builder requires is HIGHER than the
-- Package total the Builder pays more, which is fine: it is allowed with no limit, but the person has to write why.
--   * A line that adds (amount > 0): any size, a reason of up to 500 characters is required and kept on the invoice
--     record with who wrote it and when (the reason is internal; it is not sent to QuickBooks).
--   * A line that takes off (amount < 0): the limit applies as before, no reason.
--   * The invoice total can still never be $0.00 or less.
-- A line recorded before this change that adds money has no reason; it stays as it is.

begin;

-- 1. The reason ---------------------------------------------------------------------------------------------------

alter table valtrim.quickbooks_invoice_syncs
  drop constraint quickbooks_invoice_syncs_difference_check;

alter table valtrim.quickbooks_invoice_syncs
  add column difference_reason text;

alter table valtrim.quickbooks_invoice_syncs
  add constraint quickbooks_invoice_syncs_difference_check check (
    (
      difference_description is null and difference_amount is null
      and difference_limit is null and difference_at is null and difference_by is null
      and difference_reason is null
    )
    or (
      status = 'CREATED'
      and difference_description is not null and btrim(difference_description) <> ''
      and char_length(difference_description) <= 100
      and difference_amount is not null and difference_amount <> 0
      and difference_limit is not null and difference_limit > 0
      -- Only a line that takes off is limited.
      and (difference_amount > 0 or abs(difference_amount) <= difference_limit)
      and difference_at is not null
      and (
        difference_reason is null
        or (btrim(difference_reason) <> '' and char_length(difference_reason) <= 500)
      )
    )
  );

alter table valtrim.quickbooks_invoice_sync_archive
  add column difference_reason text;

comment on column valtrim.quickbooks_invoice_syncs.difference_reason is
  'Why the Builder pays more than the Package, when the difference line adds money (internal; never sent to QuickBooks).';

grant select (difference_reason) on valtrim.quickbooks_invoice_syncs to authenticated;

-- 2. The archive keeps the reason too ----------------------------------------------------------------------------

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
    difference_description, difference_amount, difference_limit, difference_by, difference_at,
    difference_reason,
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
    sync.difference_description, sync.difference_amount, sync.difference_limit,
    sync.difference_by, sync.difference_at,
    sync.difference_reason,
    p_user_id, left(p_reason, 300)
  from valtrim.quickbooks_invoice_syncs sync
  where sync.package_id = p_package_id;
$$;

-- 3. Recording the invoice with its difference --------------------------------------------------------------------

drop function valtrim.complete_quickbooks_invoice_sync(bigint, text, text, text, numeric, jsonb, text, numeric);

create function valtrim.complete_quickbooks_invoice_sync(
  p_package_id bigint,
  p_qbo_invoice_id text,
  p_qbo_doc_number text,
  p_qbo_sync_token text,
  p_total_amount numeric,
  p_payload jsonb,
  p_difference_description text default null,
  p_difference_amount numeric default null,
  p_difference_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_invoice_number text;
  v_description text;
  v_reason text;
  v_net numeric;
  v_limit numeric;
  v_money constant text := 'FM999,999,990.00';
begin
  if (p_difference_description is null) <> (p_difference_amount is null) then
    raise exception 'A difference needs both a description and an amount'
      using errcode = '23514';
  end if;

  -- The Edge Function checked this before calling QuickBooks; it is checked again here so no path can
  -- record a difference the limit does not allow.
  if p_difference_amount is not null then
    v_description := regexp_replace(btrim(p_difference_description), '\s+', ' ', 'g');
    if v_description = '' or char_length(v_description) > 100 then
      raise exception 'The difference needs a description of up to 100 characters'
        using errcode = '23514';
    end if;
    if p_difference_amount = 0 or p_difference_amount <> round(p_difference_amount, 2) then
      raise exception 'The difference must be an amount other than zero with at most two decimals'
        using errcode = '23514';
    end if;

    select invoice.net_amount into v_net
    from valtrim.invoices invoice
    where invoice.package_id = p_package_id;
    if v_net is null then
      raise exception 'The Package has no invoice amount'
        using errcode = 'P0002';
    end if;

    v_limit := valtrim.invoice_difference_limit(v_net);
    -- The limit only protects the Builder paying LESS than the Package. Paying more is allowed, with a reason.
    if p_difference_amount < 0 and abs(p_difference_amount) > v_limit then
      raise exception 'The difference of $% is greater than the $% allowed for an invoice of $%',
        to_char(abs(p_difference_amount), v_money), to_char(v_limit, v_money), to_char(v_net, v_money)
        using errcode = '23514';
    end if;
    if v_net + p_difference_amount <= 0 then
      raise exception 'The difference cannot bring the invoice total to $0.00 or less'
        using errcode = '23514';
    end if;

    if p_difference_amount > 0 then
      v_reason := nullif(btrim(p_difference_reason), '');
      if v_reason is null or char_length(v_reason) > 500 then
        raise exception 'When the Builder pays more than the Package, write the reason in up to 500 characters'
          using errcode = '23514';
      end if;
    end if;
  end if;

  update valtrim.quickbooks_invoice_syncs
  set status = 'CREATED',
      qbo_invoice_id = nullif(btrim(p_qbo_invoice_id), ''),
      qbo_doc_number = nullif(btrim(p_qbo_doc_number), ''),
      qbo_sync_token = nullif(btrim(p_qbo_sync_token), ''),
      total_amount = p_total_amount,
      payload = p_payload,
      request_reusable = false,
      error = null,
      difference_description = v_description,
      difference_amount = p_difference_amount,
      difference_reason = v_reason,
      difference_limit = case when p_difference_amount is null then null else v_limit end,
      difference_by = case when p_difference_amount is null then null else created_by end,
      difference_at = case when p_difference_amount is null then null else now() end
  where package_id = p_package_id
    and status = 'CREATING'
  returning created_by, invoice_number into v_user_id, v_invoice_number;

  if not found then
    raise exception 'No QuickBooks invoice attempt is in progress for this Package'
      using errcode = '55000';
  end if;

  update valtrim.draw_packages
  set quickbooks_status = 'CREATED',
      quickbooks_reference = left(
        coalesce(nullif(btrim(p_qbo_doc_number), ''), btrim(p_qbo_invoice_id)),
        120
      ),
      updated_by = v_user_id
  where id = p_package_id;

  -- The Package keeps a record of it, in its history, next to every other change made to it.
  if p_difference_amount is not null and v_user_id is not null then
    insert into valtrim.draw_package_corrections (
      package_id, action, previous_details, next_details, reason, changed_by
    ) values (
      p_package_id,
      'INVOICE_DIFFERENCE',
      jsonb_build_object('net_amount', v_net, 'invoice_number', v_invoice_number),
      jsonb_build_object(
        'description', v_description,
        'amount', p_difference_amount,
        'limit', v_limit,
        'net_amount', v_net,
        'invoice_number', v_invoice_number,
        'reason', v_reason
      ),
      left(
        format(
          case
            when p_difference_amount > 0
              then 'Line "%1$s" of %2$s$%3$s added to the QuickBooks invoice: the Builder pays more than the Package of $%5$s.'
            else 'Line "%1$s" of %2$s$%3$s added to the QuickBooks invoice (limit $%4$s for a Package of $%5$s).'
          end,
          v_description,
          case when p_difference_amount < 0 then '-' else '+' end,
          to_char(abs(p_difference_amount), v_money),
          to_char(v_limit, v_money),
          to_char(v_net, v_money)
        ),
        500
      ),
      v_user_id
    );
  end if;

  return true;
end;
$$;

revoke all on function valtrim.complete_quickbooks_invoice_sync(
  bigint, text, text, text, numeric, jsonb, text, numeric, text
) from public, anon, authenticated;
grant execute on function valtrim.complete_quickbooks_invoice_sync(
  bigint, text, text, text, numeric, jsonb, text, numeric, text
) to service_role;

comment on function valtrim.complete_quickbooks_invoice_sync(
  bigint, text, text, text, numeric, jsonb, text, numeric, text
) is 'Records the QuickBooks invoice that was created, with its manual difference line (and, when it adds money, the reason) if it has one.';

-- 4. Changing the line of an invoice that exists ----------------------------------------------------------------------

drop function valtrim.set_invoice_difference(uuid, bigint, text, numeric, boolean);

create function valtrim.set_invoice_difference(
  p_actor_id uuid,
  p_package_id bigint,
  p_description text,
  p_amount numeric,
  p_reason text,
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
  v_reason text;
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
      'limit', v_sync.difference_limit,
      'reason', v_sync.difference_reason
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
    -- The limit only protects the Builder paying LESS than the Package. Paying more is allowed, with a reason.
    if p_amount < 0 and abs(p_amount) > v_limit then
      raise exception 'The difference of $% is greater than the $% allowed for an invoice of $%',
        to_char(abs(p_amount), v_money), to_char(v_limit, v_money), to_char(v_invoice.net_amount, v_money)
        using errcode = '23514';
    end if;
    if v_invoice.net_amount + p_amount <= 0 then
      raise exception 'The difference cannot bring the invoice total to $0.00 or less'
        using errcode = '23514';
    end if;

    if p_amount > 0 then
      v_reason := nullif(btrim(p_reason), '');
      if v_reason is null or char_length(v_reason) > 500 then
        raise exception 'When the Builder pays more than the Package, write the reason in up to 500 characters'
          using errcode = '23514';
      end if;
    end if;

    v_next := jsonb_build_object(
      'description', v_description, 'amount', p_amount, 'limit', v_limit, 'reason', v_reason
    );
  end if;

  if v_previous is not distinct from v_next
     or (
       v_previous is not null and v_next is not null
       and (v_previous ->> 'description') = (v_next ->> 'description')
       and (v_previous ->> 'amount')::numeric = (v_next ->> 'amount')::numeric
       and (v_previous ->> 'reason') is not distinct from (v_next ->> 'reason')
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
        difference_reason = v_reason,
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
        'limit', (v_previous ->> 'limit')::numeric,
        'reason', v_previous ->> 'reason'
      ),
      jsonb_build_object(
        'net_amount', v_invoice.net_amount,
        'invoice_number', v_sync.invoice_number,
        'description', v_next ->> 'description',
        'amount', (v_next ->> 'amount')::numeric,
        'limit', (v_next ->> 'limit')::numeric,
        'reason', v_next ->> 'reason',
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
            case
              when p_amount > 0
                then 'Line "%1$s" of %2$s$%3$s added to the QuickBooks invoice: the Builder pays more than the Package of $%5$s.'
              else 'Line "%1$s" of %2$s$%3$s added to the QuickBooks invoice (limit $%4$s for a Package of $%5$s).'
            end,
            v_description,
            case when p_amount < 0 then '-' else '+' end,
            to_char(abs(p_amount), v_money),
            to_char(v_limit, v_money),
            to_char(v_invoice.net_amount, v_money)
          )
          else format(
            'Line of the QuickBooks invoice changed from "%s" %s$%s to "%s" %s$%s (Package of $%s).',
            v_previous ->> 'description',
            case when (v_previous ->> 'amount')::numeric < 0 then '-' else '+' end,
            to_char(abs((v_previous ->> 'amount')::numeric), v_money),
            v_description,
            case when p_amount < 0 then '-' else '+' end,
            to_char(abs(p_amount), v_money),
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

revoke all on function valtrim.set_invoice_difference(uuid, bigint, text, numeric, text, boolean)
  from public, anon, authenticated;
grant execute on function valtrim.set_invoice_difference(uuid, bigint, text, numeric, text, boolean)
  to service_role;

comment on function valtrim.set_invoice_difference(uuid, bigint, text, numeric, text, boolean) is
  'Adds, changes or removes (null description and amount) the manual difference line of a QuickBooks invoice that already exists; a line that adds money needs a reason, one that takes off is limited. Marks the invoice as waiting for QuickBooks. Only the Edge function runs it.';

commit;
