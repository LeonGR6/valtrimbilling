-- A manual DIFFERENCE line on a Package invoice.
--
-- Some Builders require a total that does not match the Package. Before the invoice goes to QuickBooks a
-- person can add ONE extra line (a text, e.g. "DIFFERENCE", and an amount, plus or minus) as long as it is
-- within a limit that grows with the size of the invoice: $5 for every $5,000 started (up to $5,000 -> $5,
-- up to $10,000 -> $10, up to $15,000 -> $15, ...), measured on the Package net before the line.
--
-- The line is NOT part of invoices.net_amount (that column is gross - retention - wrap and is recalculated
-- from the lines of the Package): it belongs to the QuickBooks invoice, so it lives on the sync row, which
-- the reset and detach functions archive and clear with the invoice. The QuickBooks total is net + the line.
-- The Edge Function checks the limit before calling QuickBooks; this migration checks it again when the
-- invoice is recorded, records who added it and when, writes it in the Package's correction history, and
-- lets the Release know about it so the person can choose which total to print.

begin;

-- 1. How large a difference may be ---------------------------------------------------------------------

create function valtrim.invoice_difference_limit(p_net numeric)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (5 * greatest(1, ceil(greatest(coalesce(p_net, 0), 0) / 5000)))::numeric(12, 2);
$$;

revoke execute on function valtrim.invoice_difference_limit(numeric) from public, anon;
grant execute on function valtrim.invoice_difference_limit(numeric) to authenticated, service_role;

comment on function valtrim.invoice_difference_limit(numeric) is
  'The largest manual difference (either sign) a Package invoice of this net amount may carry: $5 for every $5,000 started.';

-- 2. The invoice remembers its difference ---------------------------------------------------------------

alter table valtrim.quickbooks_invoice_syncs
  add column difference_description text,
  add column difference_amount numeric(12, 2),
  add column difference_limit numeric(12, 2),
  add column difference_by uuid references valtrim.app_users(id) on delete set null,
  add column difference_at timestamptz,
  add constraint quickbooks_invoice_syncs_difference_check check (
    (
      difference_description is null and difference_amount is null
      and difference_limit is null and difference_at is null and difference_by is null
    )
    or (
      status = 'CREATED'
      and difference_description is not null and btrim(difference_description) <> ''
      and char_length(difference_description) <= 100
      and difference_amount is not null and difference_amount <> 0
      and difference_limit is not null and difference_limit > 0
      and abs(difference_amount) <= difference_limit
      and difference_at is not null
    )
  );

alter table valtrim.quickbooks_invoice_sync_archive
  add column difference_description text,
  add column difference_amount numeric(12, 2),
  add column difference_limit numeric(12, 2),
  add column difference_by uuid,
  add column difference_at timestamptz;

comment on column valtrim.quickbooks_invoice_syncs.difference_description is
  'Text of the manual extra line of the invoice (e.g. DIFFERENCE), when the person added one.';
comment on column valtrim.quickbooks_invoice_syncs.difference_amount is
  'Amount of that line: positive adds to the invoice, negative takes off. The QuickBooks total is the Package net plus this.';
comment on column valtrim.quickbooks_invoice_syncs.difference_limit is
  'The most a difference could be when it was added (valtrim.invoice_difference_limit of the Package net).';

grant select (
  difference_description, difference_amount, difference_limit, difference_by, difference_at
) on valtrim.quickbooks_invoice_syncs to authenticated;

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
    p_user_id, left(p_reason, 300)
  from valtrim.quickbooks_invoice_syncs sync
  where sync.package_id = p_package_id;
$$;

-- 3. The correction history knows this kind of change ---------------------------------------------------

alter table valtrim.draw_package_corrections
  drop constraint draw_package_corrections_action_check;

alter table valtrim.draw_package_corrections
  add constraint draw_package_corrections_action_check
  check (action = any (array[
    'EDIT', 'TRANSFER', 'CANCEL', 'RECALCULATE', 'EDIT_INVOICED', 'INVOICE_DIFFERENCE'
  ]));

-- 4. Recording the invoice records its difference too ---------------------------------------------------

drop function valtrim.complete_quickbooks_invoice_sync(bigint, text, text, text, numeric, jsonb);

create function valtrim.complete_quickbooks_invoice_sync(
  p_package_id bigint,
  p_qbo_invoice_id text,
  p_qbo_doc_number text,
  p_qbo_sync_token text,
  p_total_amount numeric,
  p_payload jsonb,
  p_difference_description text default null,
  p_difference_amount numeric default null
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
    if abs(p_difference_amount) > v_limit then
      raise exception 'The difference of $% is greater than the $% allowed for an invoice of $%',
        to_char(abs(p_difference_amount), v_money), to_char(v_limit, v_money), to_char(v_net, v_money)
        using errcode = '23514';
    end if;
    if v_net + p_difference_amount <= 0 then
      raise exception 'The difference cannot bring the invoice total to $0.00 or less'
        using errcode = '23514';
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
        'invoice_number', v_invoice_number
      ),
      left(
        format(
          'Line "%s" of %s$%s added to the QuickBooks invoice (limit $%s for a Package of $%s).',
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
  bigint, text, text, text, numeric, jsonb, text, numeric
) from public, anon, authenticated;
grant execute on function valtrim.complete_quickbooks_invoice_sync(
  bigint, text, text, text, numeric, jsonb, text, numeric
) to service_role;

comment on function valtrim.complete_quickbooks_invoice_sync(
  bigint, text, text, text, numeric, jsonb, text, numeric
) is
  'Service-role-only: records the created invoice, with the manual difference line it carries (checked against its limit), and marks the Package as created in QuickBooks.';

-- 5. The Release knows about the difference -------------------------------------------------------------
--
-- Same function as before plus: this Package's difference, and for each earlier unpaid Package its
-- difference and what is still owed with and without it. "balance_amount" keeps meaning "without the
-- difference" (the Package net less what was paid), so a Package without a difference answers as before.

create or replace function private.get_package_release_values(p_package_id bigint)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_package record;
  v_invoice record;
  v_difference record;
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

  select sync.difference_description,
         sync.difference_amount
    into v_difference
  from valtrim.quickbooks_invoice_syncs sync
  where sync.package_id = p_package_id
    and sync.status = 'CREATED'
    and sync.difference_amount is not null;

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
      -- What is still owed without the difference: the balance QuickBooks reports while the invoice is
      -- open, less the difference it carries (a partial payment leaves the Package Awaiting payment), else
      -- the whole net amount.
      'balance_amount', owed.without_difference,
      'balance_source', case
        when qbo.qbo_state in ('OPEN', 'OVERDUE', 'PARTIALLY_PAID')
          and qbo.qbo_balance is not null
        then 'quickbooks'
        else 'invoice'
      end,
      'difference_description', case when diff.amount <> 0 then qbo.difference_description end,
      'difference_amount', case when diff.amount <> 0 then diff.amount end,
      'balance_with_difference', case
        when owed.without_difference is null then null
        else owed.without_difference + diff.amount
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
  cross join lateral (
    select case
      when qbo.status = 'CREATED' then coalesce(qbo.difference_amount, 0)
      else 0
    end as amount
  ) diff
  cross join lateral (
    select case
      when qbo.qbo_state in ('OPEN', 'OVERDUE', 'PARTIALLY_PAID')
        and qbo.qbo_balance is not null
      then least(
        qbo.qbo_balance - diff.amount,
        coalesce(invoice.net_amount, qbo.qbo_balance - diff.amount)
      )
      else invoice.net_amount
    end as without_difference
  ) owed
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
    'difference_description', v_difference.difference_description,
    'difference_amount', v_difference.difference_amount,
    'pending_packages', v_pending,
    'final_release', private.get_final_release_status(p_package_id)
  );
end;
$function$;

notify pgrst, 'reload schema';

commit;
