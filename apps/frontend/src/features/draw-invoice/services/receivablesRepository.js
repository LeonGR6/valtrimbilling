import { requireSupabase } from '../../../services/api.js'
import { listAllRows } from '../../../services/pagedQuery.js'
import { toReceivableRecord } from './receivablesRecord.js'

const COLUMNS = [
  'id',
  'package_number',
  'package_type',
  'builder_id',
  'job_id',
  'phase_id',
  'workflow_status',
  'quickbooks_reference',
  'quickbooks_invoice_syncs!inner('
    + 'qbo_doc_number, qbo_invoice_date, qbo_due_date, qbo_total, total_amount, '
    + 'qbo_balance, qbo_state, qbo_state_checked_at)',
].join(', ')

function throwReadError(error) {
  throw new Error(
    error.code === '42501'
      ? 'You do not have permission to view accounts receivable.'
      : error.message || 'Accounts receivable could not be loaded.',
    { cause: error },
  )
}

/**
 * The Packages whose Production QuickBooks invoice still has a balance. A voided
 * Package, an invoice QuickBooks no longer shows, and everything made against the
 * Test company are left out here: they are not money owed.
 */
export async function listOpenReceivables() {
  const client = await requireSupabase()
  const rows = await listAllRows(
    () => client
      .from('draw_packages')
      .select(COLUMNS)
      .eq('quickbooks_status', 'CREATED')
      .eq('quickbooks_environment', 'production')
      .neq('status', 'VOIDED')
      .eq('quickbooks_invoice_syncs.status', 'CREATED')
      .gt('quickbooks_invoice_syncs.qbo_balance', 0)
      .order('id'),
    throwReadError,
  )

  return rows.map(toReceivableRecord)
}
