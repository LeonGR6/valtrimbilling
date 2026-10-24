-- Phase 48: Unpaid earlier Packages for a Release.
--
-- The "Exceptions" part of a Conditional Progress Release lists the progress
-- payments that were already waived but not paid yet. For a Package those are
-- the earlier Draw Packages of the same Job that are not paid (workflow status
-- other than PAID_CLOSED) and not voided:
--   Date(s) of waiver and release          -> their cut-off dates
--   Amount(s) of unpaid progress payment(s) -> their invoice net amounts
--
-- get_package_release_values now also returns them, each with its cut-off date
-- resolved by the same rule as the Package's own.

begin;

create or replace function private.get_package_release_values(p_package_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
         package.setup_version_id
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
      'status', other.status,
      'workflow_status', other.workflow_status
    )
    order by other.package_date, other.id
  ), '[]'::jsonb)
    into v_pending
  from valtrim.draw_packages other
  left join valtrim.invoices invoice on invoice.package_id = other.id
  where other.job_id = v_package.job_id
    and other.id <> v_package.id
    and other.package_type = 'DRAW'
    and other.status not in ('VOIDED', 'PAID')
    and other.workflow_status <> 'PAID_CLOSED'
    and (other.package_date, other.id) < (v_package.package_date, v_package.id);

  return jsonb_build_object(
    'package_id', v_package.id,
    'job_id', v_package.job_id,
    'package_number', v_package.package_number,
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
    'pending_packages', v_pending
  );
end;
$$;

notify pgrst, 'reload schema';

commit;
