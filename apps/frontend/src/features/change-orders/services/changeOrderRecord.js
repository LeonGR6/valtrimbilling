// Extras / Change Orders between the screen and the database: what is sent to create one, what is
// checked before sending it, and how the rows that come back are read. The database checks everything
// again (these limits are its limits); the checks here are so the person is told what to fix, on the
// screen, before anything is sent.

import { PLANNING_ROLES, canWork } from '../../auth/authorization/roleAccess.js'
import { allChangeOrderStatuses, emptyChangeOrder, maxPlaceLength } from '../data/changeOrders.js'
import { restoreCoverage } from '../utils/coverage.js'

export const CHANGE_ORDER_TITLE_MAX = 150
export const CHANGE_ORDER_REQUESTED_BY_MAX = 100
export const CHANGE_ORDER_INTERNAL_NUMBER_MAX = 60
export const CHANGE_ORDER_SCOPE_MAX = 1000
export const CHANGE_ORDER_CANCEL_REASON_MAX = 500
export const CHANGE_ORDER_MAX_LINES = 5000
const MAX_AMOUNT = 999999999999.99

/** Project Management and Admin create Extras / COs; everyone else who may open the page only reads. */
export function canEditChangeOrders(role) {
  return canWork(role, PLANNING_ROLES)
}

/** Only Admin creates an Extra / CO already approved (and later approves one). */
export function canApproveChangeOrders(role) {
  return role === 'ADMIN'
}

/**
 * What the person can do with an Extra / CO in `status`: edit it (only while it is a Draft or Pending)
 * and move it to another status. Each move says where it goes (`to`), what the button says (`label`),
 * whether the person must confirm it (`confirm`) and whether a reason is needed (`needsReason`).
 * The database allows the same: Project Management and Admin move it between Draft, Pending and
 * Cancelled; only Admin approves, or cancels an approved one. Only a Draft can be deleted (`canDelete`):
 * what was sent is cancelled instead.
 */
export function changeOrderActions(status, role) {
  const mayWrite = canEditChangeOrders(role)
  const isAdmin = canApproveChangeOrders(role)
  const open = status === 'DRAFT' || status === 'PENDING'
  const moves = []

  if (mayWrite) {
    if (status === 'DRAFT') moves.push({ to: 'PENDING', label: 'Submit for Approval' })
    if (status === 'PENDING') moves.push({ to: 'DRAFT', label: 'Back to Draft' })
    if (isAdmin && open) moves.push({ to: 'APPROVED', label: 'Approve', confirm: true })
    if (open || (status === 'APPROVED' && isAdmin)) {
      moves.push({ to: 'CANCELLED', label: 'Cancel Extra / CO', confirm: true, needsReason: true })
    }
  }

  return { canEdit: mayWrite && open, canDelete: mayWrite && status === 'DRAFT', moves }
}

/** What is said once a move is done ("CO-0007 approved"); `to` is a status, or 'DELETE'. */
export function changeOrderMoveNotice(number, to) {
  switch (to) {
    case 'PENDING': return `${number} sent for approval`
    case 'DRAFT': return `${number} is a Draft again`
    case 'APPROVED': return `${number} approved`
    case 'CANCELLED': return `${number} cancelled`
    case 'DELETE': return `${number} deleted`
    default: return `${number} updated`
  }
}

/** Why the reason for cancelling cannot be sent, or '' when it can. */
export function cancelReasonProblem(reason) {
  const text = String(reason ?? '').trim()
  if (!text) return 'Write the reason for cancelling.'
  if (text.length > CHANGE_ORDER_CANCEL_REASON_MAX) {
    return `The reason can have up to ${CHANGE_ORDER_CANCEL_REASON_MAX} characters.`
  }
  return ''
}

// What is sent --------------------------------------------------------------------------------------

/** How the Lots were chosen on the screen, so a draft can be opened as it was left. */
export function toCoverage(values) {
  return {
    mode: values.coverageMode,
    lotIds: [...values.lotIds],
    recordIds: [...values.recordIds],
    planIds: [...values.planIds],
  }
}

/**
 * The lines in the order they are shown: the Lot lines, then the lines without a Lot. A Lot line
 * carries the id of its Lot; a line without a Lot says where in words.
 */
export function toLinesPayload({ lines, places }) {
  return [
    ...lines.map((line) => ({
      lot_id: Number(line.lotId),
      scope_of_work: line.scope.trim(),
      amount: line.amount,
    })),
    ...places.map((place) => ({
      location: place.location.trim(),
      scope_of_work: place.scope.trim(),
      amount: place.amount,
    })),
  ]
}

/** The arguments of `create_change_order` for what is filled in. `status` is the one it is saved with. */
export function toCreateChangeOrderRpc(values, { lines, places, status }) {
  return {
    p_job_id: Number(values.jobId),
    p_title: values.title.trim(),
    p_requested_by: values.requestedBy.trim(),
    p_lines: toLinesPayload({ lines, places }),
    p_internal_number: values.internalNumber.trim() || null,
    p_request_date: values.requestDate || null,
    p_needed_by_date: values.neededByDate || null,
    p_coverage: toCoverage(values),
    p_status: status,
  }
}

/** The arguments of `update_change_order`: the whole form again; the status is moved apart. */
export function toUpdateChangeOrderRpc(changeOrderId, values, { lines, places }) {
  return {
    p_change_order_id: Number(changeOrderId),
    p_job_id: Number(values.jobId),
    p_title: values.title.trim(),
    p_requested_by: values.requestedBy.trim(),
    p_lines: toLinesPayload({ lines, places }),
    p_internal_number: values.internalNumber.trim() || null,
    p_request_date: values.requestDate || null,
    p_needed_by_date: values.neededByDate || null,
    p_coverage: toCoverage(values),
  }
}

/** The arguments of `set_change_order_status`; `note` is the reason when cancelling. */
export function toSetStatusRpc(changeOrderId, status, note = '') {
  return {
    p_change_order_id: Number(changeOrderId),
    p_status: status,
    p_note: String(note ?? '').trim() || null,
  }
}

/**
 * The form as the person sees it: until they touch the Internal # box it shows the number the Extra /
 * CO is about to get. What is saved is still `values`, where the untouched box is blank and the
 * database fills it with the real number (the one shown may have been taken by someone else).
 */
export function withSuggestedNumber(values, suggestedNumber, edited) {
  return edited ? values : { ...values, internalNumber: suggestedNumber }
}

// Opening a saved Extra / CO to edit it ---------------------------------------------------------------

/** The value that most lines share (the first one on a tie), or '' when there are none. */
function mostCommon(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)

  let best = ''
  let bestCount = 0
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

// Always cents ("185.50"), as it is shown on the detail page.
const amountText = (amount) => Number(amount).toFixed(2)

/**
 * The form values to edit a saved Extra / CO (`order` from `toChangeOrderDetail`, `job` the Job it is
 * for, from the Jobs of the app). The Scope of Work and Amount most Lots share become the defaults and
 * the Lots that differ keep their own, as if it had been typed that way; the lines without a Lot come
 * back as they are.
 */
export function toChangeOrderFormValues(order, { job = null } = {}) {
  const lotLines = order.lines.filter((line) => !line.isPlace)
  const placeLines = order.lines.filter((line) => line.isPlace)
  const defaultScope = mostCommon(lotLines.map((line) => line.scope))
  const defaultAmount = mostCommon(lotLines.map((line) => amountText(line.amount)))

  const lineOverrides = {}
  for (const line of lotLines) {
    const own = {}
    if (line.scope !== defaultScope) own.scope = line.scope
    if (amountText(line.amount) !== defaultAmount) own.amount = amountText(line.amount)
    if (Object.keys(own).length > 0) lineOverrides[String(line.lotId)] = own
  }

  const coverage = restoreCoverage(job, order.coverage, lotLines.map((line) => line.lotId))

  return {
    ...emptyChangeOrder,
    internalNumber: order.internalNumber,
    title: order.title,
    builderId: order.builderId,
    community: order.community,
    requestedBy: order.requestedBy,
    requestDate: order.requestDate,
    neededByDate: order.neededByDate,
    status: order.status,
    jobId: order.jobId,
    defaultScope,
    defaultAmount,
    lineOverrides,
    placeLines: placeLines.map((line, index) => ({
      id: index + 1,
      location: line.location,
      scope: line.scope,
      amount: amountText(line.amount),
    })),
    coverageMode: coverage.mode,
    lotIds: coverage.lotIds,
    recordIds: coverage.recordIds,
    planIds: coverage.planIds,
  }
}

// What is checked before sending it ----------------------------------------------------------------

/**
 * What stops the Extra / CO from being saved, as `{ field, message }` in the order the person fills it
 * in; empty when it can be saved. `field` says which field of the first cards to mark ('builderId',
 * 'community', 'jobId', 'title', 'requestedBy', 'internalNumber', 'neededByDate'), or is 'lines'.
 * `lines` and `places` are the Lot lines and the lines without a Lot, as the screen builds them.
 */
export function changeOrderProblems(values, { lines = [], places = [] } = {}) {
  const problems = []
  const add = (field, message) => problems.push({ field, message })
  const title = values.title.trim()
  const requestedBy = values.requestedBy.trim()

  if (!values.builderId) add('builderId', 'Select the Builder.')
  if (!values.community) add('community', 'Select the Community.')
  if (!values.jobId) add('jobId', 'Select the Job.')
  if (!title) add('title', 'Write a title.')
  else if (title.length > CHANGE_ORDER_TITLE_MAX) {
    add('title', `The title can have up to ${CHANGE_ORDER_TITLE_MAX} characters.`)
  }
  if (!requestedBy) add('requestedBy', 'Write who requested it.')
  else if (requestedBy.length > CHANGE_ORDER_REQUESTED_BY_MAX) {
    add('requestedBy', `Who requested it can have up to ${CHANGE_ORDER_REQUESTED_BY_MAX} characters.`)
  }
  if (values.internalNumber.trim().length > CHANGE_ORDER_INTERNAL_NUMBER_MAX) {
    add('internalNumber', `The internal number can have up to ${CHANGE_ORDER_INTERNAL_NUMBER_MAX} characters.`)
  }
  if (values.requestDate && values.neededByDate && values.neededByDate < values.requestDate) {
    add('neededByDate', 'The needed-by date cannot be before the request date.')
  }

  const count = lines.length + places.length
  if (count === 0) {
    add('lines', 'Add at least one line: choose the lots it covers or add a line without a lot.')
  } else if (count > CHANGE_ORDER_MAX_LINES) {
    add('lines', `An Extra / CO can have up to ${CHANGE_ORDER_MAX_LINES} lines.`)
  }

  // One message per kind of line, with what each of its lines lacks: "Lots: 2 without an Amount, ...".
  const lineProblems = (label, group, extra = []) => {
    const parts = [
      ...extra,
      [(line) => !line.scope.trim(), 'without a Scope of Work'],
      [(line) => line.scope.trim().length > CHANGE_ORDER_SCOPE_MAX,
        `with a Scope of Work over ${CHANGE_ORDER_SCOPE_MAX} characters`],
      [(line) => line.amount === null, 'without an Amount'],
      [(line) => line.amount === 0, 'with an Amount of zero'],
      [(line) => line.amount !== null && Math.abs(line.amount) > MAX_AMOUNT,
        'with an Amount that is too large'],
    ].map(([test, text]) => [group.filter(test).length, text])
      .filter(([found]) => found > 0)
      .map(([found, text]) => `${found} ${text}`)

    if (parts.length > 0) add('lines', `${label}: ${parts.join(', ')}.`)
  }
  lineProblems('Lots', lines)
  lineProblems('Lines without a lot', places, [
    [(place) => !place.location.trim(), 'without a place'],
    [(place) => place.location.trim().length > maxPlaceLength,
      `with a place over ${maxPlaceLength} characters`],
  ])

  return problems
}

/** The first message of each field, `{ title: 'Write a title.', ... }`, to mark the fields. */
export function problemsByField(problems) {
  const byField = {}
  for (const { field, message } of problems) byField[field] ??= message
  return byField
}

/** What the person is told when the database refuses the Extra / CO or cannot be reached. */
export function changeOrderErrorMessage(error, fallback = 'The Extra / Change Order could not be saved.') {
  if (error?.code === '42501') {
    // The one refusal worth explaining: who approves.
    if (/^Only an Admin/.test(error.message ?? '')) return error.message
    return 'You do not have permission to create or change Extras / Change Orders.'
  }
  // The database words its own refusals for the person ("Select an active Job", "Every line needs ...").
  if (['23514', '23503', '23505'].includes(error?.code) && error.message) return error.message
  return error?.message || fallback
}

// What is read ---------------------------------------------------------------------------------------

const number = (value) => (value === null || value === undefined ? 0 : Number(value))

/** A row of the list (`change_order_overview`). */
export function toChangeOrderSummary(row) {
  return {
    id: row.id,
    number: row.change_order_number,
    internalNumber: row.internal_number ?? '',
    title: row.title,
    status: row.status,
    builderId: row.builder_id,
    builderName: row.builder_name ?? '',
    jobId: row.job_id,
    jobCode: row.job_code ?? '',
    community: row.community ?? '',
    requestedBy: row.requested_by ?? '',
    requestDate: row.request_date ?? '',
    neededByDate: row.needed_by_date ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lineCount: number(row.line_count),
    totalAmount: number(row.total_amount),
  }
}

/** What the header of the overview does not carry: when it was approved or cancelled, and why. */
export function toChangeOrderDates(row) {
  return {
    createdAt: row.created_at,
    approvedAt: row.approved_at ?? null,
    cancelledAt: row.cancelled_at ?? null,
    cancelReason: row.cancel_reason ?? '',
    coverage: row.coverage ?? null,
  }
}

/** A line of the Extra / CO; a line without a Lot has a `location` and no Lot, Phase or Plan. */
export function toChangeOrderLine(row) {
  return {
    id: row.id,
    lineNumber: row.line_number,
    lotId: row.lot_id ?? null,
    isPlace: row.lot_id === null || row.lot_id === undefined,
    phase: row.phase_code ?? '',
    building: row.building ?? '',
    lot: row.lot_number ?? '',
    plan: row.plan_code ?? '',
    planName: row.plan_name ?? '',
    location: row.location ?? '',
    scope: row.scope_of_work,
    amount: number(row.amount),
    poNumber: row.po_number ?? '',
  }
}

/** One step of the history of the status. */
export function toChangeOrderHistoryEntry(row) {
  return {
    id: row.id,
    from: row.previous_status ?? null,
    to: row.new_status,
    note: row.note ?? '',
    changedAt: row.changed_at,
  }
}

/** The header, its dates, its lines and its history as one Extra / CO, lines in the order saved. */
export function toChangeOrderDetail({ summary, dates, lines, history }) {
  return {
    ...summary,
    ...dates,
    lines: [...lines].sort((left, right) => left.lineNumber - right.lineNumber),
    history: [...history].sort((left, right) => left.id - right.id),
  }
}

/** What the lines of an Extra / CO add up to (in cents, so the total is exact). */
export function summarizeDetailLines(lines) {
  const cents = lines.reduce((sum, line) => sum + Math.round(line.amount * 100), 0)
  const places = lines.filter((line) => line.isPlace).length

  return { lots: lines.length - places, places, total: cents / 100 }
}

const isWholeLot = (lot) => /^\d+$/.test(lot)

/**
 * Lot numbers as short text: "1–6, 9, 12.1". Three or more whole numbers in a row become a range; a
 * Lot with a decimal (12.1) always stands alone, in its place by value.
 */
export function formatLotRanges(lots) {
  const sorted = [...new Set(lots.map(String))]
    .sort((left, right) => (Number.parseFloat(left) - Number.parseFloat(right)) || left.localeCompare(right))
  const parts = []

  for (let index = 0; index < sorted.length;) {
    let end = index
    while (
      isWholeLot(sorted[end]) && isWholeLot(sorted[end + 1] ?? '')
      && Number(sorted[end + 1]) === Number(sorted[end]) + 1
    ) end += 1

    if (end - index >= 2) {
      parts.push(`${sorted[index]}–${sorted[end]}`)
      index = end + 1
    } else {
      parts.push(sorted[index])
      index += 1
    }
  }

  return parts.join(', ')
}

/**
 * The lines of an Extra / CO as the work they are: every Lot with the same Scope of Work and Amount
 * is one piece of `works` (with where it is, by Phase and Building, and its Plans), and each line
 * without a Lot stays on its own in `places`. Both keep the order of the lines.
 */
export function groupDetailLines(lines) {
  const byWork = new Map()
  const places = []

  for (const line of lines) {
    if (line.isPlace) {
      places.push({ id: line.id, location: line.location, scope: line.scope, amount: line.amount })
      continue
    }

    const key = JSON.stringify([line.scope.trim(), Math.round(line.amount * 100)])
    if (!byWork.has(key)) byWork.set(key, { key, scope: line.scope, amount: line.amount, lines: [] })
    byWork.get(key).lines.push(line)
  }

  const works = [...byWork.values()].map(({ lines: group, ...work }) => {
    const spots = new Map()
    const plans = new Map()

    for (const line of group) {
      const spot = `${line.phase}\u0000${line.building}`
      if (!spots.has(spot)) spots.set(spot, { phase: line.phase, building: line.building, lots: [] })
      spots.get(spot).lots.push(line.lot)
      if (line.plan) plans.set(line.plan, (plans.get(line.plan) ?? 0) + 1)
    }

    return {
      ...work,
      count: group.length,
      subtotal: Math.round(work.amount * 100 * group.length) / 100,
      locations: [...spots.values()].map((spot) => ({ ...spot, lots: formatLotRanges(spot.lots) })),
      plans: [...plans].map(([plan, count]) => ({ plan, count })),
    }
  })

  return { works, places }
}

// The list ---------------------------------------------------------------------------------------------

/**
 * The day (as "2026-11-02") an Extra / CO is listed under: the day it was requested, or the day it was
 * created when no request date was written. Empty when neither is a date.
 */
export function changeOrderListDate(order) {
  if (order.requestDate) return order.requestDate
  // new Date(null) is 1970, not an invalid date: an empty value is no date at all.
  if (!order.createdAt) return ''

  const created = new Date(order.createdAt)
  return Number.isNaN(created.getTime()) ? '' : created.toLocaleDateString('en-CA')
}

/** The Extras / COs matching the status ('ALL' or one) and the words typed, in the order they came. */
export function filterChangeOrders(orders, { status = 'ALL', search = '' } = {}) {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)

  return orders.filter((order) => {
    if (status !== 'ALL' && order.status !== status) return false
    if (words.length === 0) return true
    const haystack = [
      order.number, order.internalNumber, order.title, order.builderName,
      order.jobCode, order.community, order.requestedBy,
    ].join(' ').toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

/** The tabs of the list: All and each status, with how many Extras / COs are in it. */
export function changeOrderStatusTabs(orders) {
  return [
    { value: 'ALL', label: 'All', count: orders.length },
    ...allChangeOrderStatuses.map((status) => ({
      value: status.value,
      label: status.label,
      count: orders.filter((order) => order.status === status.value).length,
    })),
  ]
}

/** What the whole list adds up to, leaving out the cancelled Extras / COs. */
export function summarizeChangeOrders(orders) {
  const live = orders.filter((order) => order.status !== 'CANCELLED')
  const cents = live.reduce((sum, order) => sum + Math.round(order.totalAmount * 100), 0)

  return { count: live.length, total: cents / 100 }
}
