import { requireSupabase } from '../../../services/api.js'
import { listAllRows } from '../../../services/pagedQuery.js'
import { toLotEvent } from '../utils/calendarEvents.js'
import { toPackageChargeRow } from '../utils/packageCharges.js'
import {
  changeOrderErrorMessage,
  toChangeOrderDates,
  toChangeOrderDetail,
  toChangeOrderHistoryEntry,
  toChangeOrderLine,
  toChangeOrderPlanRule,
  toChangeOrderSummary,
} from './changeOrderRecord.js'

const OVERVIEW_COLUMNS = [
  'id',
  'change_order_number',
  'internal_number',
  'status',
  'builder_id',
  'builder_name',
  'job_id',
  'job_code',
  'community',
  'requested_by',
  'request_date',
  'needed_by_date',
  'created_at',
  'updated_at',
  'line_count',
  'total_amount',
  'po_co_number',
  'source_change_order_id',
  'source_change_order_number',
  'source_package_id',
  'source_package_number',
  'invoice_package_id',
  'invoice_package_number',
  'invoice_workflow_status',
].join(', ')

const DATE_COLUMNS = 'created_at, approved_at, cancelled_at, cancel_reason, coverage'

const LINE_COLUMNS = [
  'id',
  'line_number',
  'lot_id',
  'phase_code',
  'building',
  'lot_number',
  'plan_code',
  'plan_name',
  'location',
  'scope_of_work',
  'amount',
  'po_number',
  'billing_event',
  'billing_event_date',
].join(', ')

const HISTORY_COLUMNS = 'id, previous_status, new_status, note, changed_at'

// The Plan is read through the key that ties the rule to a Plan of the same Job.
const PLAN_RULE_COLUMNS = 'plan_id, scope_of_work, amount, plan:plans!change_order_plan_rules_plan_id_job_id_fkey(code, name)'

function fail(error) {
  throw new Error(changeOrderErrorMessage(error, 'The Extras / Change Orders could not be loaded.'), {
    cause: error,
  })
}

/** Every Extra / CO, newest first, with its Builder, Job, number of lines and total. */
export async function listChangeOrders() {
  const client = await requireSupabase()
  const rows = await listAllRows(
    () => client
      .from('change_order_overview')
      .select(OVERVIEW_COLUMNS)
      .order('id', { ascending: false }),
    fail,
  )

  return rows.map(toChangeOrderSummary)
}

/** The newest Extras / COs, for the card next to the form. */
export async function listRecentChangeOrders(limit = 3) {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('change_order_overview')
    .select(OVERVIEW_COLUMNS)
    .order('id', { ascending: false })
    .limit(limit)

  if (error) fail(error)
  return (data ?? []).map(toChangeOrderSummary)
}

/**
 * One Extra / CO with its lines and the history of its status, or null when it does not exist. A
 * "Specific Plan Types" one also comes with its Scope and Amount by Plan and the Extras / COs made from
 * Packages for it.
 */
export async function getChangeOrder(changeOrderId) {
  const client = await requireSupabase()
  const id = Number(changeOrderId)
  if (!Number.isInteger(id) || id < 1) return null

  const [overview, dates, lines, history, planRules, packageOrders] = await Promise.all([
    client.from('change_order_overview').select(OVERVIEW_COLUMNS).eq('id', id).maybeSingle(),
    client.from('change_orders').select(DATE_COLUMNS).eq('id', id).maybeSingle(),
    listAllRows(
      () => client
        .from('change_order_lines')
        .select(LINE_COLUMNS)
        .eq('change_order_id', id)
        .order('line_number', { ascending: true }),
      fail,
    ),
    listAllRows(
      () => client
        .from('change_order_status_history')
        .select(HISTORY_COLUMNS)
        .eq('change_order_id', id)
        .order('id', { ascending: true }),
      fail,
    ),
    listAllRows(
      () => client
        .from('change_order_plan_rules')
        .select(PLAN_RULE_COLUMNS)
        .eq('change_order_id', id)
        .order('plan_id', { ascending: true }),
      fail,
    ),
    listAllRows(
      () => client
        .from('change_order_overview')
        .select(OVERVIEW_COLUMNS)
        .eq('source_change_order_id', id)
        .order('id', { ascending: true }),
      fail,
    ),
  ])

  if (overview.error) fail(overview.error)
  if (dates.error) fail(dates.error)
  if (!overview.data || !dates.data) return null

  return toChangeOrderDetail({
    summary: toChangeOrderSummary(overview.data),
    dates: toChangeOrderDates(dates.data),
    lines: lines.map(toChangeOrderLine),
    history: history.map(toChangeOrderHistoryEntry),
    planRules: planRules.map(toChangeOrderPlanRule),
    packageOrders: packageOrders.map(toChangeOrderSummary),
  })
}

/**
 * The number the next Extra / CO will have (CO-0001 ...), or '' when it cannot be known: the box
 * simply stays empty then, and the database gives the number on save anyway.
 */
export async function getNextChangeOrderNumber() {
  const client = await requireSupabase()
  const { data, error } = await client.rpc('next_change_order_number')

  return error || typeof data !== 'string' ? '' : data
}

/** Creates an Extra / CO with all its lines as the signed-in user and returns its id. */
export async function createChangeOrder(payload) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc('create_change_order', payload)

  if (error) {
    throw new Error(changeOrderErrorMessage(error), { cause: error })
  }

  return Number(data)
}

/** Saves the whole form of a Draft or Pending Extra / CO again (header and lines) as the signed-in user. */
export async function updateChangeOrder(payload) {
  const client = await requireSupabase()
  const { error } = await client.rpc('update_change_order', payload)

  if (error) {
    throw new Error(changeOrderErrorMessage(error), { cause: error })
  }
}

/**
 * Writes, changes or clears only the PO / CO # of an Extra / CO that is not cancelled, also once it is
 * approved (the form no longer opens it then).
 */
export async function setChangeOrderPoCoNumber(payload) {
  const client = await requireSupabase()
  const { error } = await client.rpc('set_change_order_po_co_number', payload)

  if (error) {
    throw new Error(changeOrderErrorMessage(error, 'The PO / CO # could not be saved.'), { cause: error })
  }
}

/** Moves an Extra / CO to another status; cancelling needs the reason as `note` in the payload. */
export async function setChangeOrderStatus(payload) {
  const client = await requireSupabase()
  const { error } = await client.rpc('set_change_order_status', payload)

  if (error) {
    throw new Error(changeOrderErrorMessage(error, 'The status could not be changed.'), { cause: error })
  }
}

/** Deletes a Draft Extra / CO with its lines and history; anything that was sent is cancelled instead. */
export async function deleteChangeOrder(changeOrderId) {
  const client = await requireSupabase()
  const { error } = await client.rpc('delete_change_order', { p_change_order_id: changeOrderId })

  if (error) {
    throw new Error(changeOrderErrorMessage(error, 'The Extra / Change Order could not be deleted.'), { cause: error })
  }
}

/**
 * The EXT, DM and HW events of every Lot of a Job, each with its date and whether it can still be charged
 * along with (more than 5 business days left). The database answers all of them at once (a Job has some
 * dozens of Lots, far from the 1000 rows the Data API returns at most).
 */
export async function listLotCalendarEvents(jobId) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc('change_order_lot_events', { p_job_id: Number(jobId) })

  // The database's own words (a missing function, a closed connection) mean nothing to the person.
  if (error) throw new Error('The Calendar events could not be read.', { cause: error })

  return (data ?? []).map(toLotEvent)
}

/**
 * The Lots among `lotIds` that a Package of the Job would charge to an approved "Specific Plan Types"
 * Extra / CO, with the Scope and Amount of their Plan. Nothing is written.
 */
export async function listPackageCharges(jobId, lotIds) {
  if (!jobId || lotIds.length === 0) return []
  const client = await requireSupabase()
  const { data, error } = await client.rpc('package_change_order_preview', {
    p_job_id: Number(jobId),
    p_lot_ids: lotIds.map(Number),
  })

  if (error) throw new Error('The Extras / Change Orders this Package would make could not be read.', { cause: error })
  return (data ?? []).map(toPackageChargeRow)
}

/**
 * Every approved or cancelled Extra / CO (the ones Draw & Invoice works with), newest first, each with the
 * Phase of the Packages it points at (`sourcePackagePhaseId`, `invoicePackagePhaseId`), to open them.
 */
export async function listBillableChangeOrders() {
  const client = await requireSupabase()
  const rows = await listAllRows(
    () => client
      .from('change_order_overview')
      .select(OVERVIEW_COLUMNS)
      .in('status', ['APPROVED', 'CANCELLED'])
      .order('id', { ascending: false }),
    fail,
  )
  const orders = rows.map(toChangeOrderSummary)

  const packageIds = [...new Set(
    orders.flatMap((order) => [order.sourcePackageId, order.invoicePackageId]).filter((id) => id != null),
  )]
  const phaseOf = new Map()
  for (let start = 0; start < packageIds.length; start += 200) {
    const { data, error } = await client
      .from('draw_packages')
      .select('id, phase_id')
      .in('id', packageIds.slice(start, start + 200))
    if (error) fail(error)
    for (const row of data ?? []) phaseOf.set(row.id, row.phase_id)
  }

  return orders.map((order) => ({
    ...order,
    sourcePackagePhaseId: phaseOf.get(order.sourcePackageId) ?? null,
    invoicePackagePhaseId: phaseOf.get(order.invoicePackageId) ?? null,
  }))
}

/** Creates the Package that invoices an approved Extra / CO and returns its id. */
export async function createChangeOrderPackage(changeOrderId) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc('create_change_order_package', { p_change_order_id: Number(changeOrderId) })

  if (error) {
    throw new Error(changeOrderErrorMessage(error, 'The invoice Package could not be created.'), { cause: error })
  }
  return Number(data)
}

/** The lines of one Extra / CO, in the order saved. */
export async function listChangeOrderLines(changeOrderId) {
  const client = await requireSupabase()
  const rows = await listAllRows(
    () => client
      .from('change_order_lines')
      .select(LINE_COLUMNS)
      .eq('change_order_id', Number(changeOrderId))
      .order('line_number', { ascending: true }),
    fail,
  )
  return rows.map(toChangeOrderLine)
}
