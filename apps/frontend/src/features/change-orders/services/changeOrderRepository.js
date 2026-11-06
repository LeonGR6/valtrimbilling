import { requireSupabase } from '../../../services/api.js'
import { listAllRows } from '../../../services/pagedQuery.js'
import {
  changeOrderErrorMessage,
  toChangeOrderDates,
  toChangeOrderDetail,
  toChangeOrderHistoryEntry,
  toChangeOrderLine,
  toChangeOrderSummary,
} from './changeOrderRecord.js'

const OVERVIEW_COLUMNS = [
  'id',
  'change_order_number',
  'internal_number',
  'title',
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
].join(', ')

const HISTORY_COLUMNS = 'id, previous_status, new_status, note, changed_at'

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

/** One Extra / CO with its lines and the history of its status, or null when it does not exist. */
export async function getChangeOrder(changeOrderId) {
  const client = await requireSupabase()
  const id = Number(changeOrderId)
  if (!Number.isInteger(id) || id < 1) return null

  const [overview, dates, lines, history] = await Promise.all([
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
  ])

  if (overview.error) fail(overview.error)
  if (dates.error) fail(dates.error)
  if (!overview.data || !dates.data) return null

  return toChangeOrderDetail({
    summary: toChangeOrderSummary(overview.data),
    dates: toChangeOrderDates(dates.data),
    lines: lines.map(toChangeOrderLine),
    history: history.map(toChangeOrderHistoryEntry),
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
