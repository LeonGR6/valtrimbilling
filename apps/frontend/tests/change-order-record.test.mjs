import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyChangeOrder } from '../src/features/change-orders/data/changeOrders.js'
import {
  cancelReasonProblem,
  canApproveChangeOrders,
  canEditChangeOrders,
  canSetPoCoNumber,
  changeOrderActions,
  changeOrderErrorMessage,
  changeOrderMoveNotice,
  changeOrderListDate,
  changeOrderProblems,
  changeOrderStatusTabs,
  cleanPoCoNumber,
  filterChangeOrders,
  formatLotRanges,
  groupDetailEvents,
  groupDetailLines,
  poCoNumberNotice,
  poCoNumberProblem,
  problemsByField,
  summarizeChangeOrders,
  summarizeDetailLines,
  toChangeOrderDates,
  toChangeOrderDetail,
  toChangeOrderHistoryEntry,
  toChangeOrderLine,
  toChangeOrderSummary,
  toChangeOrderFormValues,
  toCoverage,
  toCreateChangeOrderRpc,
  toLinesPayload,
  toChangeOrderPlanRule,
  toPlanRulesPayload,
  toSetPoCoNumberRpc,
  toSetStatusRpc,
  toUpdateChangeOrderRpc,
  withSuggestedNumber,
} from '../src/features/change-orders/services/changeOrderRecord.js'
import {
  buildChangeOrderLines,
  buildPlaceLines,
  dropAmountsEqualToDefault,
  setLineOverride,
} from '../src/features/change-orders/utils/pricing.js'

const filled = (overrides = {}) => ({
  ...emptyChangeOrder,
  builderId: '3',
  community: 'Rancho Madrina',
  jobId: 10,
  requestedBy: ' Carlos Ramirez ',
  internalNumber: ' E-2026-0047 ',
  requestDate: '2026-11-01',
  neededByDate: '2026-11-20',
  defaultScope: 'Add attic ladder',
  defaultAmount: '10',
  coverageMode: 'lots',
  lotIds: new Set(['101', '102']),
  ...overrides,
})

const lotLines = (values = filled()) => buildChangeOrderLines(
  [{ lotId: '101', lot: '1' }, { lotId: '102', lot: '2' }],
  values,
)

const placeLines = (places) => buildPlaceLines(places)

const office = { id: 1, location: ' Sales Office ', scope: ' Electronic locks ', amount: '250.50' }

test('only Project Management and Admin create Extras / COs, and only Admin approves', () => {
  for (const role of ['ADMIN', 'PROJECT_MANAGEMENT']) assert.equal(canEditChangeOrders(role), true, role)
  for (const role of ['ACCOUNTING', 'SCHEDULING', 'CUSTOMER_SERVICE', 'FIELD', 'READ_ONLY']) {
    assert.equal(canEditChangeOrders(role), false, role)
  }
  assert.equal(canApproveChangeOrders('ADMIN'), true)
  assert.equal(canApproveChangeOrders('PROJECT_MANAGEMENT'), false)
})

test('the coverage keeps how the lots were chosen, as lists', () => {
  assert.deepEqual(toCoverage(filled({ recordIds: new Set(['5']), planIds: new Set(['1', '2']) })), {
    mode: 'lots',
    lotIds: ['101', '102'],
    recordIds: ['5'],
    planIds: ['1', '2'],
  })
})

test('the lines are the lots first, then the lines without a lot, trimmed, in the order shown', () => {
  const lines = lotLines(filled({ lineOverrides: { 102: { amount: '-30.25' } } }))
  const payload = toLinesPayload({ lines, places: placeLines([office]) })

  assert.deepEqual(payload, [
    { lot_id: 101, scope_of_work: 'Add attic ladder', amount: 10, billing_event: null },
    { lot_id: 102, scope_of_work: 'Add attic ladder', amount: -30.25, billing_event: null },
    { location: 'Sales Office', scope_of_work: 'Electronic locks', amount: 250.5 },
  ])
  // A line without a lot never carries a Lot, and a Lot line never carries a place.
  assert.equal('lot_id' in payload[2], false)
  assert.equal('location' in payload[0], false)
})

test('creating sends the Job, the trimmed header, the lines, the coverage and the status', () => {
  const values = filled()
  const rpc = toCreateChangeOrderRpc(values, {
    lines: lotLines(values),
    places: placeLines([office]),
    status: 'PENDING',
  })

  assert.deepEqual(Object.keys(rpc), [
    'p_job_id', 'p_title', 'p_requested_by', 'p_lines', 'p_internal_number',
    'p_request_date', 'p_needed_by_date', 'p_coverage', 'p_status', 'p_po_co_number', 'p_plan_rules',
  ])
  assert.equal(rpc.p_job_id, 10)
  // The title is not asked any more: the function still has it, and it goes empty.
  assert.equal(rpc.p_title, null)
  assert.equal(rpc.p_requested_by, 'Carlos Ramirez')
  assert.equal(rpc.p_internal_number, 'E-2026-0047')
  assert.equal(rpc.p_request_date, '2026-11-01')
  assert.equal(rpc.p_needed_by_date, '2026-11-20')
  assert.equal(rpc.p_status, 'PENDING')
  assert.equal(rpc.p_lines.length, 3)
  assert.equal(rpc.p_coverage.mode, 'lots')
  // Only Specific Plan Types has a Scope and Amount by Plan.
  assert.equal(rpc.p_plan_rules, null)
})

test('an empty internal number and empty dates are sent as nothing, not as empty text', () => {
  const values = filled({ internalNumber: '  ', requestDate: '', neededByDate: '' })
  const rpc = toCreateChangeOrderRpc(values, { lines: lotLines(values), places: [], status: 'DRAFT' })

  assert.equal(rpc.p_internal_number, null)
  assert.equal(rpc.p_request_date, null)
  assert.equal(rpc.p_needed_by_date, null)
  // The job id comes from a select that may hold it as text.
  assert.equal(toCreateChangeOrderRpc(filled({ jobId: '10' }), { lines: [], places: [], status: 'DRAFT' }).p_job_id, 10)
})

test('the Internal # box shows the next number until the person touches it, and then it is theirs', () => {
  const untouched = { ...emptyChangeOrder, internalNumber: '' }
  assert.equal(withSuggestedNumber(untouched, 'CO-0001', false).internalNumber, 'CO-0001')

  // Touched, even emptied: what they wrote (or left empty) stays.
  assert.equal(withSuggestedNumber({ ...untouched, internalNumber: 'E-2026-0047' }, 'CO-0001', true).internalNumber, 'E-2026-0047')
  assert.equal(withSuggestedNumber(untouched, 'CO-0001', true).internalNumber, '')

  // With no number known the box is simply empty; the rest of the form is not touched.
  const shown = withSuggestedNumber({ ...untouched, requestedBy: 'Carlos' }, '', false)
  assert.equal(shown.internalNumber, '')
  assert.equal(shown.requestedBy, 'Carlos')

  // Showing it does not change what is saved: the untouched box is sent as nothing, for the database to fill in.
  assert.equal(untouched.internalNumber, '')
  const values = filled({ internalNumber: '' })
  assert.equal(
    toCreateChangeOrderRpc(values, { lines: lotLines(values), places: [], status: 'DRAFT' }).p_internal_number,
    null,
  )
})

test('a complete Extra / CO has nothing to fix', () => {
  const values = filled()
  assert.deepEqual(changeOrderProblems(values, { lines: lotLines(values), places: [] }), [])
  assert.deepEqual(
    changeOrderProblems(values, { lines: [], places: placeLines([office]) }),
    [],
  )
})

test('an empty form says what is missing, field by field, in the order it is filled in', () => {
  const problems = changeOrderProblems(emptyChangeOrder, { lines: [], places: [] })

  assert.deepEqual(problems.map((problem) => problem.field), [
    'builderId', 'jobId', 'requestedBy', 'lines',
  ])
  assert.equal(problemsByField(problems).jobId, 'Select the Job / Community.')
  assert.match(problemsByField(problems).lines, /Add at least one line/)
})

test('the limits are the ones of the database', () => {
  const problems = changeOrderProblems(filled({
    requestedBy: 'y'.repeat(101),
    internalNumber: 'z'.repeat(61),
    requestDate: '2026-11-10',
    neededByDate: '2026-11-01',
  }), { lines: lotLines(), places: [] })

  assert.deepEqual(problemsByField(problems), {
    requestedBy: 'Who requested it can have up to 100 characters.',
    internalNumber: 'The internal number can have up to 60 characters.',
    neededByDate: 'The needed-by date cannot be before the request date.',
  })
})

test('there is no title to fill in: a form without one has nothing to fix', () => {
  assert.equal('title' in emptyChangeOrder, false)
  const values = filled()
  assert.equal('title' in values, false)
  assert.deepEqual(changeOrderProblems(values, { lines: lotLines(values), places: [] }), [])
})

test('the lots that miss a scope or an amount are counted in one message', () => {
  const values = filled({ defaultScope: '', defaultAmount: '', lineOverrides: { 102: { amount: '0' } } })
  const problems = changeOrderProblems(values, { lines: lotLines(values), places: [] })

  assert.deepEqual(problems.map((problem) => problem.message), [
    'Lots: 2 without a Scope of Work, 1 without an Amount, 1 with an Amount of zero.',
  ])
  assert.equal(problems[0].field, 'lines')
})

test('the lines without a lot need a place, a scope and an amount other than zero', () => {
  const places = placeLines([
    { id: 1, location: '  ', scope: 'Paint', amount: '5' },
    { id: 2, location: 'Restroom', scope: '', amount: '' },
    { id: 3, location: 'Design Center', scope: 'Credit', amount: '0' },
  ])
  const values = filled()
  const problems = changeOrderProblems(values, { lines: lotLines(values), places })

  assert.deepEqual(problems.map((problem) => problem.message), [
    'Lines without a lot: 1 without a place, 1 without a Scope of Work, 1 without an Amount, 1 with an Amount of zero.',
  ])
})

test('a credit is a valid amount and an amount that is too large is not', () => {
  const credit = placeLines([{ id: 1, location: 'Restroom', scope: 'Credit', amount: '-20' }])
  assert.deepEqual(changeOrderProblems(filled(), { lines: [], places: credit }), [])

  const huge = placeLines([{ id: 1, location: 'Restroom', scope: 'x', amount: '9999999999999' }])
  assert.deepEqual(
    changeOrderProblems(filled(), { lines: [], places: huge }).map((problem) => problem.message),
    ['Lines without a lot: 1 with an Amount that is too large.'],
  )
})

test('the person is told what the database refused, in its own words', () => {
  assert.equal(
    changeOrderErrorMessage({ code: '23503', message: 'Select an active Job' }),
    'Select an active Job',
  )
  assert.equal(
    changeOrderErrorMessage({ code: '23505', message: 'A Lot can be in a Change Order only once' }),
    'A Lot can be in a Change Order only once',
  )
  assert.match(changeOrderErrorMessage({ code: '42501', message: 'permission denied' }), /permission/)
  assert.equal(changeOrderErrorMessage({ message: 'Failed to fetch' }), 'Failed to fetch')
  assert.equal(changeOrderErrorMessage(null), 'The Extra / Change Order could not be saved.')
  assert.equal(changeOrderErrorMessage(undefined, 'Could not load.'), 'Could not load.')
})

const overviewRow = (overrides = {}) => ({
  id: 7,
  change_order_number: 'CO-0007',
  internal_number: null,
  status: 'PENDING',
  builder_id: 3,
  builder_name: 'KB Home',
  job_id: 10,
  job_code: '1295',
  community: 'Rancho Madrina',
  requested_by: 'Carlos Ramirez',
  request_date: '2026-11-01',
  needed_by_date: null,
  created_at: '2026-11-02T18:00:00.000Z',
  updated_at: '2026-11-02T18:00:00.000Z',
  line_count: 3,
  total_amount: '330.50',
  ...overrides,
})

test('a row of the list keeps its number, status, Job and total, with empty text instead of null', () => {
  assert.deepEqual(toChangeOrderSummary(overviewRow()), {
    id: 7,
    number: 'CO-0007',
    internalNumber: '',
    poCoNumber: '',
    status: 'PENDING',
    builderId: 3,
    builderName: 'KB Home',
    jobId: 10,
    jobCode: '1295',
    community: 'Rancho Madrina',
    requestedBy: 'Carlos Ramirez',
    requestDate: '2026-11-01',
    neededByDate: '',
    createdAt: '2026-11-02T18:00:00.000Z',
    updatedAt: '2026-11-02T18:00:00.000Z',
    lineCount: 3,
    totalAmount: 330.5,
    sourceChangeOrderId: null,
    sourceNumber: '',
    sourcePackageId: null,
    sourcePackageNumber: '',
    fromPackage: false,
    invoicePackageId: null,
    invoicePackageNumber: '',
    invoiceWorkflowStatus: '',
  })
  assert.equal(toChangeOrderSummary(overviewRow({ line_count: null, total_amount: null })).totalAmount, 0)
  const invoiced = toChangeOrderSummary(overviewRow({ invoice_package_id: 300, invoice_package_number: 'CP-00000300', invoice_workflow_status: 'AWAITING_PAYMENT' }))
  assert.equal(invoiced.invoicePackageId, 300)
  assert.equal(invoiced.invoicePackageNumber, 'CP-00000300')
  assert.equal(invoiced.invoiceWorkflowStatus, 'AWAITING_PAYMENT')
})

test('a Lot line and a line without a lot are read apart', () => {
  const lot = toChangeOrderLine({
    id: 1, line_number: 1, lot_id: 101, phase_code: '1', building: 'A', lot_number: '12.1',
    plan_code: '1A', plan_name: 'Plan 1A', location: null, scope_of_work: 'Add attic ladder',
    amount: '1689.60', po_number: null,
  })
  assert.equal(lot.isPlace, false)
  assert.equal(lot.lot, '12.1')
  assert.equal(lot.amount, 1689.6)
  assert.equal(lot.poNumber, '')

  const place = toChangeOrderLine({
    id: 2, line_number: 2, lot_id: null, phase_code: null, building: null, lot_number: null,
    plan_code: null, plan_name: null, location: 'Sales Office', scope_of_work: 'Electronic locks',
    amount: '-20', po_number: 'PO-9',
  })
  assert.equal(place.isPlace, true)
  assert.equal(place.location, 'Sales Office')
  assert.equal(place.phase, '')
  assert.equal(place.amount, -20)
  assert.equal(place.poNumber, 'PO-9')
})

test('the dates of an approved or cancelled Extra / CO and the steps of its history are read', () => {
  assert.deepEqual(toChangeOrderDates({
    created_at: '2026-11-02T18:00:00.000Z', approved_at: null, cancelled_at: '2026-11-05T10:00:00.000Z',
    cancel_reason: 'Builder dropped the extra',
  }), {
    createdAt: '2026-11-02T18:00:00.000Z',
    approvedAt: null,
    cancelledAt: '2026-11-05T10:00:00.000Z',
    cancelReason: 'Builder dropped the extra',
    coverage: null,
  })

  assert.deepEqual(toChangeOrderHistoryEntry({
    id: 3, previous_status: null, new_status: 'DRAFT', note: null, changed_at: '2026-11-02T18:00:00.000Z',
  }), { id: 3, from: null, to: 'DRAFT', note: '', changedAt: '2026-11-02T18:00:00.000Z' })
})

test('the detail puts the header, dates, lines and history together, in the order they were saved', () => {
  const detail = toChangeOrderDetail({
    summary: toChangeOrderSummary(overviewRow()),
    dates: toChangeOrderDates({ created_at: '2026-11-02T18:00:00.000Z' }),
    lines: [{ lineNumber: 2, amount: 1 }, { lineNumber: 1, amount: 2 }],
    history: [{ id: 5 }, { id: 4 }],
  })

  assert.equal(detail.number, 'CO-0007')
  assert.equal(detail.createdAt, '2026-11-02T18:00:00.000Z')
  assert.deepEqual(detail.lines.map((line) => line.lineNumber), [1, 2])
  assert.deepEqual(detail.history.map((entry) => entry.id), [4, 5])
})

test('the lines of an Extra / CO add up in exact cents, counting lots and places apart', () => {
  const summary = summarizeDetailLines([
    { isPlace: false, amount: 0.1 },
    { isPlace: false, amount: 0.2 },
    { isPlace: true, amount: -0.05 },
  ])

  assert.deepEqual(summary, { lots: 2, places: 1, total: 0.25 })
  assert.deepEqual(summarizeDetailLines([]), { lots: 0, places: 0, total: 0 })
})

const orders = [
  toChangeOrderSummary(overviewRow({ id: 3, change_order_number: 'CO-0003', status: 'APPROVED', total_amount: 100 })),
  toChangeOrderSummary(overviewRow({
    id: 2, change_order_number: 'CO-0002', status: 'DRAFT', builder_name: 'Tri Pointe',
    job_code: '1301', community: 'Corona', internal_number: 'E-77', total_amount: 50.5,
  })),
  toChangeOrderSummary(overviewRow({ id: 1, change_order_number: 'CO-0001', status: 'CANCELLED', total_amount: 900 })),
]

test('the list is filtered by status and by every word typed, in any field', () => {
  assert.deepEqual(filterChangeOrders(orders).map((order) => order.id), [3, 2, 1])
  assert.deepEqual(filterChangeOrders(orders, { status: 'DRAFT' }).map((order) => order.id), [2])
  assert.deepEqual(filterChangeOrders(orders, { search: 'tri pointe' }).map((order) => order.id), [2])
  assert.deepEqual(filterChangeOrders(orders, { search: 'e-77 corona' }).map((order) => order.id), [2])
  assert.deepEqual(filterChangeOrders(orders, { search: 'co-0001' }).map((order) => order.id), [1])
  assert.deepEqual(filterChangeOrders(orders, { status: 'DRAFT', search: 'co-0001' }), [])
  assert.deepEqual(filterChangeOrders(orders, { search: '   ' }).map((order) => order.id), [3, 2, 1])
})

test('the tabs count each status, and Cancelled is one of them', () => {
  assert.deepEqual(changeOrderStatusTabs(orders), [
    { value: 'ALL', label: 'All', count: 3 },
    { value: 'DRAFT', label: 'Draft', count: 1 },
    { value: 'PENDING', label: 'Pending', count: 0 },
    { value: 'APPROVED', label: 'Approved', count: 1 },
    { value: 'CANCELLED', label: 'Cancelled', count: 1 },
  ])
})

test('what the list adds up to leaves out the cancelled ones', () => {
  assert.deepEqual(summarizeChangeOrders(orders), { count: 2, total: 150.5 })
  assert.deepEqual(summarizeChangeOrders([]), { count: 0, total: 0 })
})

test('an Extra / CO is listed under the day it was requested, else the day it was created', () => {
  assert.equal(changeOrderListDate({ requestDate: '2026-11-01', createdAt: '2026-11-02T18:00:00.000Z' }), '2026-11-01')
  assert.match(changeOrderListDate({ requestDate: '', createdAt: '2026-11-02T18:00:00.000Z' }), /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(changeOrderListDate({ requestDate: '', createdAt: null }), '')
  assert.equal(changeOrderListDate({ requestDate: '', createdAt: 'not a date' }), '')
})

// Editing and moving between statuses ----------------------------------------------------------------------

const moveTargets = (status, role) => changeOrderActions(status, role).moves.map((move) => move.to)

test('who can edit and where each role can move an Extra / CO, as the database allows', () => {
  // Draft and Pending are edited; approved and cancelled are frozen.
  for (const role of ['PROJECT_MANAGEMENT', 'ADMIN']) {
    assert.equal(changeOrderActions('DRAFT', role).canEdit, true, role)
    assert.equal(changeOrderActions('PENDING', role).canEdit, true, role)
    assert.equal(changeOrderActions('APPROVED', role).canEdit, false, role)
    assert.equal(changeOrderActions('CANCELLED', role).canEdit, false, role)
  }
  for (const role of ['ACCOUNTING', 'SCHEDULING', 'CUSTOMER_SERVICE', 'FIELD', 'READ_ONLY', undefined]) {
    assert.deepEqual(changeOrderActions('DRAFT', role), { canEdit: false, canDelete: false, moves: [] }, String(role))
    assert.deepEqual(changeOrderActions('APPROVED', role), { canEdit: false, canDelete: false, moves: [] }, String(role))
  }

  assert.deepEqual(moveTargets('DRAFT', 'PROJECT_MANAGEMENT'), ['PENDING', 'CANCELLED'])
  assert.deepEqual(moveTargets('PENDING', 'PROJECT_MANAGEMENT'), ['DRAFT', 'CANCELLED'])
  assert.deepEqual(moveTargets('DRAFT', 'ADMIN'), ['PENDING', 'APPROVED', 'CANCELLED'])
  assert.deepEqual(moveTargets('PENDING', 'ADMIN'), ['DRAFT', 'APPROVED', 'CANCELLED'])
  // Only an Admin cancels an approved one, and nobody moves a cancelled one.
  assert.deepEqual(moveTargets('APPROVED', 'ADMIN'), ['CANCELLED'])
  assert.deepEqual(moveTargets('APPROVED', 'PROJECT_MANAGEMENT'), [])
  assert.deepEqual(moveTargets('CANCELLED', 'ADMIN'), [])
})

test('approving and cancelling ask first, and cancelling asks why', () => {
  const moves = Object.fromEntries(changeOrderActions('PENDING', 'ADMIN').moves.map((move) => [move.to, move]))

  assert.equal(moves.DRAFT.confirm, undefined)
  assert.equal(moves.APPROVED.confirm, true)
  assert.equal(moves.APPROVED.needsReason, undefined)
  assert.equal(moves.CANCELLED.confirm, true)
  assert.equal(moves.CANCELLED.needsReason, true)
  assert.equal(changeOrderActions('DRAFT', 'PROJECT_MANAGEMENT').moves[0].label, 'Submit for Approval')
})

test('the reason for cancelling is needed and has a limit', () => {
  assert.equal(cancelReasonProblem(''), 'Write the reason for cancelling.')
  assert.equal(cancelReasonProblem('   '), 'Write the reason for cancelling.')
  assert.equal(cancelReasonProblem(undefined), 'Write the reason for cancelling.')
  assert.equal(cancelReasonProblem('Builder dropped the extra'), '')
  assert.equal(cancelReasonProblem('x'.repeat(500)), '')
  assert.equal(cancelReasonProblem('x'.repeat(501)), 'The reason can have up to 500 characters.')
})

test('a move sends the Extra / CO, the status and the trimmed reason, or nothing', () => {
  assert.deepEqual(toSetStatusRpc('12', 'PENDING'), { p_change_order_id: 12, p_status: 'PENDING', p_note: null })
  assert.deepEqual(
    toSetStatusRpc(12, 'CANCELLED', '  Builder dropped the extra '),
    { p_change_order_id: 12, p_status: 'CANCELLED', p_note: 'Builder dropped the extra' },
  )
  assert.equal(toSetStatusRpc(12, 'DRAFT', '   ').p_note, null)
})

test('saving a change sends the whole form for that Extra / CO and no status', () => {
  const values = filled({ internalNumber: '' })
  const rpc = toUpdateChangeOrderRpc('12', values, { lines: lotLines(values), places: placeLines([office]) })

  assert.equal(rpc.p_change_order_id, 12)
  assert.equal(rpc.p_job_id, 10)
  assert.equal(rpc.p_title, null)
  assert.equal(rpc.p_requested_by, 'Carlos Ramirez')
  assert.equal(rpc.p_internal_number, null)
  assert.equal(rpc.p_lines.length, 3)
  assert.deepEqual(rpc.p_lines[2], { location: 'Sales Office', scope_of_work: 'Electronic locks', amount: 250.5 })
  assert.equal(rpc.p_coverage.mode, 'lots')
  assert.equal('p_status' in rpc, false)
})

test('a refusal to approve is told as it is, and other permission refusals in general words', () => {
  assert.equal(
    changeOrderErrorMessage({ code: '42501', message: 'Only an Admin approves a Change Order or cancels an approved one' }),
    'Only an Admin approves a Change Order or cancels an approved one',
  )
  assert.equal(
    changeOrderErrorMessage({ code: '42501', message: 'permission denied for table change_orders' }),
    'You do not have permission to create or change Extras / Change Orders.',
  )
})

const savedOrder = (overrides = {}) => ({
  id: 12,
  number: 'CO-0012',
  internalNumber: 'E-2026-0047',
  status: 'PENDING',
  builderId: 3,
  community: 'Rancho Madrina',
  jobId: 10,
  requestedBy: 'Carlos Ramirez',
  requestDate: '2026-11-01',
  neededByDate: '',
  coverage: { mode: 'lots', lotIds: ['101', '102', '103'], recordIds: [], planIds: [] },
  lines: [
    { isPlace: false, lotId: 101, scope: 'Add attic ladder', amount: 10 },
    { isPlace: false, lotId: 102, scope: 'Add attic ladder', amount: -30.25 },
    { isPlace: false, lotId: 103, scope: 'Add attic ladder', amount: 10 },
    { isPlace: true, lotId: null, location: 'Sales Office', scope: 'Electronic locks', amount: 250.5 },
  ],
  ...overrides,
})

test('a saved Extra / CO opens with what most lots share as the default and the rest as their own', () => {
  const values = toChangeOrderFormValues(savedOrder())

  assert.equal(values.defaultScope, 'Add attic ladder')
  assert.equal(values.defaultAmount, '10.00')
  assert.deepEqual(values.lineOverrides, { 102: { amount: '-30.25' } })
  assert.deepEqual(values.placeLines, [
    { id: 1, location: 'Sales Office', scope: 'Electronic locks', amount: '250.50' },
  ])
  assert.equal(values.internalNumber, 'E-2026-0047')
  assert.equal(values.builderId, 3)
  assert.equal(values.jobId, 10)
  assert.equal(values.status, 'PENDING')
  assert.deepEqual([...values.lotIds].sort(), ['101', '102', '103'])
})

test('opening and saving again gives back the same lines', () => {
  const order = savedOrder({
    lines: [
      { isPlace: false, lotId: 101, scope: 'Add attic ladder', amount: 10 },
      { isPlace: false, lotId: 102, scope: 'Replace the door', amount: -30.25 },
      { isPlace: false, lotId: 103, scope: 'Add attic ladder', amount: 1689.6 },
      { isPlace: true, lotId: null, location: 'Sales Office', scope: 'Electronic locks', amount: 250.5 },
      { isPlace: true, lotId: null, location: 'Restroom', scope: 'Credit', amount: -20 },
    ],
  })
  const values = toChangeOrderFormValues(order)
  const rows = [101, 102, 103].map((id) => ({ lotId: String(id), lot: String(id) }))
  const payload = toLinesPayload({
    lines: buildChangeOrderLines(rows, values),
    places: buildPlaceLines(values.placeLines),
  })

  assert.deepEqual(payload, [
    { lot_id: 101, scope_of_work: 'Add attic ladder', amount: 10, billing_event: null },
    { lot_id: 102, scope_of_work: 'Replace the door', amount: -30.25, billing_event: null },
    { lot_id: 103, scope_of_work: 'Add attic ladder', amount: 1689.6, billing_event: null },
    { location: 'Sales Office', scope_of_work: 'Electronic locks', amount: 250.5 },
    { location: 'Restroom', scope_of_work: 'Credit', amount: -20 },
  ])
})

test('an Extra / CO of only places opens with no lots and its places as they were', () => {
  const values = toChangeOrderFormValues(savedOrder({
    coverage: { mode: 'lots', lotIds: [], recordIds: [], planIds: [] },
    lines: [{ isPlace: true, lotId: null, location: 'Restroom', scope: 'Credit', amount: -20 }],
  }))

  assert.equal(values.defaultScope, '')
  assert.equal(values.defaultAmount, '')
  assert.deepEqual(values.lineOverrides, {})
  assert.equal(values.lotIds.size, 0)
  assert.equal(values.placeLines.length, 1)
})

test('amounts open in cents, so 185.5 is read as 185.50', () => {
  const values = toChangeOrderFormValues(savedOrder({
    lines: [
      { isPlace: false, lotId: 101, scope: 'Add attic ladder', amount: 185.5 },
      { isPlace: false, lotId: 102, scope: 'Add attic ladder', amount: 185.5 },
      { isPlace: false, lotId: 103, scope: 'Add attic ladder', amount: 1689.6 },
    ],
  }))

  assert.equal(values.defaultAmount, '185.50')
  assert.deepEqual(values.lineOverrides, { 103: { amount: '1689.60' } })
})

test('lot numbers are written as short text: ranges of three or more, the rest one by one', () => {
  assert.equal(formatLotRanges(['3', '1', '2', '4', '5', '6']), '1–6')
  assert.equal(formatLotRanges(['1', '2']), '1, 2')
  assert.equal(formatLotRanges(['1', '2', '3', '7', '9', '10', '11']), '1–3, 7, 9–11')
  assert.equal(formatLotRanges(['12', '12.1', '13']), '12, 12.1, 13')
  assert.equal(formatLotRanges(['10', '9', '9', '8']), '8–10')
  assert.equal(formatLotRanges([]), '')
})

const detailLine = (id, phase, building, lot, plan, scope, amount, extra = {}) => ({
  id, lineNumber: id, isPlace: false, phase, building, lot: String(lot), plan, location: '', scope, amount, ...extra,
})
const place = (id, location, scope, amount) => ({
  id, lineNumber: id, isPlace: true, phase: '', building: '', lot: '', plan: '', location, scope, amount,
})

test('lots with the same Scope of Work and Amount are one piece of work, places stay apart', () => {
  const door = 'Change laundry door'
  const { works, places } = groupDetailLines([
    detailLine(1, '1', 'A', 1, '3', door, 185.5),
    detailLine(2, '1', 'A', 2, '4.1', door, 185.5),
    detailLine(3, '1', 'A', 3, '3', door, 185.5),
    detailLine(4, '2', 'B', 7, '3', `${door} `, 185.5),
    detailLine(5, '2', 'B', 8, '4.1', door, 240),
    place(6, 'Sales Office', 'Electronic locks', 250.5),
    place(7, 'Restroom', 'Credit', -20),
  ])

  assert.equal(works.length, 2)
  assert.equal(works[0].amount, 185.5)
  assert.equal(works[0].count, 4)
  assert.equal(works[0].subtotal, 742)
  assert.deepEqual(works[0].locations, [
    { phase: '1', building: 'A', lots: '1–3' },
    { phase: '2', building: 'B', lots: '7' },
  ])
  assert.deepEqual(works[0].plans, [{ plan: '3', count: 3 }, { plan: '4.1', count: 1 }])
  assert.equal(works[1].amount, 240)
  assert.equal(works[1].count, 1)
  assert.deepEqual(places, [
    { id: 6, location: 'Sales Office', scope: 'Electronic locks', amount: 250.5 },
    { id: 7, location: 'Restroom', scope: 'Credit', amount: -20 },
  ])
})

test('the pieces of work add up to what the lines add up to, to the cent', () => {
  const lines = [
    detailLine(1, '1', '', 1, '', 'Paint', 0.1),
    detailLine(2, '1', '', 2, '', 'Paint', 0.1),
    detailLine(3, '1', '', 3, '', 'Paint', 0.1),
    place(4, 'Office', 'Credit', -0.05),
  ]
  const { works, places } = groupDetailLines(lines)
  const grouped = works.reduce((sum, work) => sum + Math.round(work.subtotal * 100), 0)
    + places.reduce((sum, item) => sum + Math.round(item.amount * 100), 0)

  assert.equal(grouped / 100, summarizeDetailLines(lines).total)
  assert.deepEqual(groupDetailLines([]), { works: [], places: [] })
})

test('a Draft or a cancelled Extra / CO can be deleted, by Project Management and Admin', () => {
  for (const role of ['PROJECT_MANAGEMENT', 'ADMIN']) {
    assert.equal(changeOrderActions('DRAFT', role).canDelete, true, role)
    assert.equal(changeOrderActions('CANCELLED', role).canDelete, true, role)
    for (const status of ['PENDING', 'APPROVED']) {
      assert.equal(changeOrderActions(status, role).canDelete, false, `${role} ${status}`)
    }
  }
  for (const role of ['ACCOUNTING', 'SCHEDULING', 'CUSTOMER_SERVICE', 'FIELD', 'READ_ONLY', 'DRAW_INVOICE', undefined]) {
    assert.equal(changeOrderActions('DRAFT', role).canDelete, false, String(role))
    assert.equal(changeOrderActions('CANCELLED', role).canDelete, false, String(role))
  }
})

test('every move says what happened, with the number of the Extra / CO', () => {
  assert.equal(changeOrderMoveNotice('CO-0007', 'PENDING'), 'CO-0007 sent for approval')
  assert.equal(changeOrderMoveNotice('CO-0007', 'DRAFT'), 'CO-0007 is a Draft again')
  assert.equal(changeOrderMoveNotice('CO-0007', 'APPROVED'), 'CO-0007 approved')
  assert.equal(changeOrderMoveNotice('CO-0007', 'CANCELLED'), 'CO-0007 cancelled')
  assert.equal(changeOrderMoveNotice('CO-0007', 'DELETE'), 'CO-0007 deleted')
  assert.equal(changeOrderMoveNotice('CO-0007', 'SOMETHING'), 'CO-0007 updated')
})

// The Calendar event a line is charged with ------------------------------------------------------------

test('a line says which Calendar event it is charged with, and none when it needs its own', () => {
  const tied = toChangeOrderLine({
    id: 1, line_number: 1, lot_id: 101, phase_code: '2', building: '1', lot_number: '3',
    plan_code: '1A', plan_name: 'Plan 1A', location: null, scope_of_work: 'Add',
    amount: '10', po_number: null, billing_event: 'DM', billing_event_date: '2026-09-22',
  })
  assert.equal(tied.billingEvent, 'DM')
  assert.equal(tied.billingEventDate, '2026-09-22')

  const own = toChangeOrderLine({
    id: 2, line_number: 2, lot_id: 102, phase_code: '2', building: '1', lot_number: '4',
    plan_code: '1A', plan_name: 'Plan 1A', location: null, scope_of_work: 'Add',
    amount: '10', po_number: null,
  })
  assert.equal(own.billingEvent, null)
  assert.equal(own.billingEventDate, '')
})

test('the lines are sent with the event each Lot is charged with, and no event for the rest', () => {
  const rows = [101, 102, 103].map((id) => ({ lotId: String(id), lot: String(id) }))
  const lines = buildChangeOrderLines(rows, { defaultScope: 'Add', defaultAmount: '10', lineOverrides: {} })
  const places = buildPlaceLines([{ id: 1, location: 'Sales Office', scope: 'Locks', amount: '5' }])

  assert.deepEqual(toLinesPayload({ lines, places, links: { 101: 'DM', 103: 'DM' } }), [
    { lot_id: 101, scope_of_work: 'Add', amount: 10, billing_event: 'DM' },
    { lot_id: 102, scope_of_work: 'Add', amount: 10, billing_event: null },
    { lot_id: 103, scope_of_work: 'Add', amount: 10, billing_event: 'DM' },
    { location: 'Sales Office', scope_of_work: 'Locks', amount: 5 },
  ])
  assert.equal(toLinesPayload({ lines, places }).every((line) => line.billing_event == null), true)
})

test('creating and editing send the same ties', () => {
  const values = filled()
  const rows = [{ lotId: '101', lot: '101' }]
  const lines = buildChangeOrderLines(rows, { defaultScope: 'Add', defaultAmount: '10', lineOverrides: {} })
  const links = { 101: 'HW' }

  assert.equal(toCreateChangeOrderRpc(values, { lines, places: [], links, status: 'DRAFT' }).p_lines[0].billing_event, 'HW')
  assert.equal(toUpdateChangeOrderRpc(12, values, { lines, places: [], links }).p_lines[0].billing_event, 'HW')
})

test('a saved Extra / CO opens with the event most Lots were charged with and the ties it had', () => {
  const values = toChangeOrderFormValues(savedOrder({
    lines: [
      { isPlace: false, lotId: 101, scope: 'Add', amount: 10, billingEvent: 'DM', billingEventDate: '2026-09-22' },
      { isPlace: false, lotId: 102, scope: 'Add', amount: 10, billingEvent: 'DM', billingEventDate: '2026-09-22' },
      { isPlace: false, lotId: 103, scope: 'Add', amount: 10, billingEvent: null, billingEventDate: '' },
      { isPlace: true, lotId: null, location: 'Sales Office', scope: 'Locks', amount: 5 },
    ],
  }))

  assert.equal(values.chargeEvent, 'DM')
  assert.deepEqual(values.savedLinks, {
    101: { event: 'DM', date: '2026-09-22' },
    102: { event: 'DM', date: '2026-09-22' },
  })
})

test('an Extra / CO with no ties opens as "Own CO event"', () => {
  const values = toChangeOrderFormValues(savedOrder())

  assert.equal(values.chargeEvent, 'NONE')
  assert.deepEqual(values.savedLinks, {})
  assert.equal(emptyChangeOrder.chargeEvent, 'NONE')
})

test('the detail says which lots are charged with which event, and which need an event of their own', () => {
  const lot = (id, lotNumber, building, billingEvent, billingEventDate = '') => ({
    id, isPlace: false, lotId: id, phase: '2', building, lot: lotNumber, billingEvent, billingEventDate,
  })
  const events = groupDetailEvents([
    lot(1, '1', '1', 'DM', '2026-12-01'), lot(2, '2', '1', 'DM', '2026-12-01'), lot(3, '3', '1', 'DM', '2026-12-01'),
    lot(4, '4', '1', 'DM', '2026-12-08'),
    lot(7, '7', '2', 'EXT', '2026-12-15'),
    lot(14, '14', '3', null), lot(15, '15', '3', null),
    { id: 99, isPlace: true, lotId: null, location: 'Sales Office', billingEvent: null },
  ])

  assert.deepEqual(events.ties.map(({ event }) => event), ['EXT', 'DM'])
  assert.deepEqual(events.ties[1].spots, [
    { phase: '2', building: '1', date: '2026-12-01', lots: '1–3' },
    { phase: '2', building: '1', date: '2026-12-08', lots: '4' },
  ])
  assert.deepEqual(events.own, {
    spots: [{ phase: '2', building: '3', lots: '14, 15' }],
    places: 1,
  })
})

test('an Extra / CO with no ties has only lots that need an event of their own', () => {
  const events = groupDetailEvents([
    { id: 1, isPlace: false, lotId: 1, phase: '1', building: 'A', lot: '1', billingEvent: null },
  ])

  assert.deepEqual(events.ties, [])
  assert.deepEqual(events.own, { spots: [{ phase: '1', building: 'A', lots: '1' }], places: 0 })
})

// The PO / CO # ------------------------------------------------------------------------------------------

test('the PO / CO # is kept as written, with every kind of space made a plain one and the ends trimmed', () => {
  assert.equal(cleanPoCoNumber('\u00a0CO#\u00a0\u00a04400102/247\t\n '), 'CO# 4400102/247')
  assert.equal(cleanPoCoNumber('  1277447-000  '), '1277447-000')
  // Nothing else is touched: zeros, letters, dashes and slashes belong to the number.
  assert.equal(cleanPoCoNumber('0001277447-000'), '0001277447-000')
  assert.equal(cleanPoCoNumber('M2068526708'), 'M2068526708')
  assert.equal(cleanPoCoNumber('4010-C-003232'), '4010-C-003232')
  assert.equal(cleanPoCoNumber('\u00a0 \u2007\u202f'), '')
  assert.equal(cleanPoCoNumber(null), '')
  assert.equal(cleanPoCoNumber(undefined), '')
})

test('a new form has the internal number and the PO / CO # apart, and suggesting the first leaves the second alone', () => {
  assert.equal(emptyChangeOrder.poCoNumber, '')
  const typed = { ...emptyChangeOrder, poCoNumber: '1277447-000' }
  const shown = withSuggestedNumber(typed, 'CO-0008', false)
  assert.equal(shown.internalNumber, 'CO-0008')
  assert.equal(shown.poCoNumber, '1277447-000')
})

test('creating and editing send the cleaned PO / CO #, or nothing when there is none', () => {
  const values = filled({ poCoNumber: '\u00a0CO #37 ' })
  const create = toCreateChangeOrderRpc(values, { lines: lotLines(values), places: [], status: 'DRAFT' })
  const update = toUpdateChangeOrderRpc('12', values, { lines: lotLines(values), places: [] })
  assert.equal(create.p_po_co_number, 'CO #37')
  assert.equal(update.p_po_co_number, 'CO #37')

  const none = filled({ poCoNumber: ' \u00a0 ' })
  assert.equal(
    toCreateChangeOrderRpc(none, { lines: lotLines(none), places: [], status: 'DRAFT' }).p_po_co_number,
    null,
  )
  assert.equal(toUpdateChangeOrderRpc('12', none, { lines: lotLines(none), places: [] }).p_po_co_number, null)
})

test('the PO / CO # has the limit of the database, counted once it is cleaned', () => {
  const check = (poCoNumber) => changeOrderProblems(filled({ poCoNumber }), { lines: lotLines(), places: [] })

  assert.deepEqual(problemsByField(check('9'.repeat(61))), {
    poCoNumber: 'The PO / CO # can have up to 60 characters.',
  })
  assert.deepEqual(check('9'.repeat(60)), [])
  // The spaces that the cleaning takes away do not count.
  assert.deepEqual(check(`  ${'9'.repeat(60)}\u00a0`), [])
  assert.deepEqual(check(''), [])
})

test('a row of the list, the detail and a saved Extra / CO carry the PO / CO #, with empty text instead of null', () => {
  assert.equal(toChangeOrderSummary(overviewRow({ po_co_number: '1277447-000' })).poCoNumber, '1277447-000')
  assert.equal(toChangeOrderSummary(overviewRow({ po_co_number: null })).poCoNumber, '')

  const detail = toChangeOrderDetail({
    summary: toChangeOrderSummary(overviewRow({ po_co_number: 'CO #37' })),
    dates: toChangeOrderDates({ created_at: '2026-11-02T18:00:00.000Z' }),
    lines: [],
    history: [],
  })
  assert.equal(detail.poCoNumber, 'CO #37')

  assert.equal(toChangeOrderFormValues(savedOrder({ poCoNumber: '1277447-000' })).poCoNumber, '1277447-000')
  assert.equal(toChangeOrderFormValues(savedOrder()).poCoNumber, '')
})

test('the list is searched by the PO / CO # too', () => {
  const withNumbers = [
    toChangeOrderSummary(overviewRow({ id: 5, po_co_number: 'CO# 4400102/247' })),
    toChangeOrderSummary(overviewRow({ id: 6, po_co_number: '1277447-000' })),
    toChangeOrderSummary(overviewRow({ id: 8 })),
  ]

  assert.deepEqual(filterChangeOrders(withNumbers, { search: '4400102/247' }).map((order) => order.id), [5])
  assert.deepEqual(filterChangeOrders(withNumbers, { search: '1277447' }).map((order) => order.id), [6])
  assert.deepEqual(filterChangeOrders(withNumbers, { search: 'zzz' }), [])
})

test('a title that an older Extra / CO still has in the database is not read or searched', () => {
  const old = toChangeOrderSummary(overviewRow({ id: 9, title: 'Old title', po_co_number: '123' }))

  assert.equal('title' in old, false)
  assert.deepEqual(filterChangeOrders([old], { search: 'old title' }), [])
  assert.deepEqual(filterChangeOrders([old], { search: '123' }).map((order) => order.id), [9])
  assert.equal('title' in toChangeOrderFormValues(savedOrder({ title: 'Old title' })), false)
})

// Writing the PO / CO # after the Extra / CO was approved ---------------------------------------------------

test('the PO / CO # can be written on anything that is not cancelled, by the roles that edit Extras / COs', () => {
  for (const status of ['DRAFT', 'PENDING', 'APPROVED']) {
    assert.equal(canSetPoCoNumber(status, 'ADMIN'), true, `Admin on ${status}`)
    assert.equal(canSetPoCoNumber(status, 'PROJECT_MANAGEMENT'), true, `Project Management on ${status}`)
    assert.equal(canSetPoCoNumber(status, 'READ_ONLY'), false, `a reader on ${status}`)
    assert.equal(canSetPoCoNumber(status, 'ACCOUNTING'), false, `Accounting on ${status}`)
  }

  // A cancelled Extra / CO is closed for everybody, an Admin too.
  assert.equal(canSetPoCoNumber('CANCELLED', 'ADMIN'), false)
  assert.equal(canSetPoCoNumber('CANCELLED', 'PROJECT_MANAGEMENT'), false)
  assert.equal(canSetPoCoNumber('APPROVED', undefined), false)
})

test('the form still does not open an approved Extra / CO, only the PO / CO # is written there', () => {
  assert.equal(changeOrderActions('APPROVED', 'ADMIN').canEdit, false)
  assert.equal(canSetPoCoNumber('APPROVED', 'ADMIN'), true)
})

test('writing the PO / CO # sends the id and the cleaned number, or nothing to clear it', () => {
  assert.deepEqual(toSetPoCoNumberRpc('12', ' CO #37 '), { p_change_order_id: 12, p_po_co_number: 'CO #37' })
  assert.deepEqual(toSetPoCoNumberRpc(12, '   \t'), { p_change_order_id: 12, p_po_co_number: null })
  assert.deepEqual(toSetPoCoNumberRpc(12, null), { p_change_order_id: 12, p_po_co_number: null })
  // Leading zeros, letters and dashes stay as they were written.
  assert.equal(toSetPoCoNumberRpc(12, '0001277447-000').p_po_co_number, '0001277447-000')
})

test('the PO / CO # written on its own has the same limit as in the form', () => {
  assert.equal(poCoNumberProblem('9'.repeat(60)), '')
  assert.equal(poCoNumberProblem(`  ${'9'.repeat(60)} `), '')
  assert.equal(poCoNumberProblem(''), '')
  assert.equal(poCoNumberProblem('9'.repeat(61)), 'The PO / CO # can have up to 60 characters.')
})

test('once the PO / CO # is saved the person is told what it is, or that it was removed', () => {
  assert.equal(poCoNumberNotice(' 1277447-000 '), 'PO / CO # saved: 1277447-000')
  assert.equal(poCoNumberNotice('  '), 'PO / CO # removed')
  assert.equal(poCoNumberNotice(''), 'PO / CO # removed')
})

test('the database refusals about the PO / CO # reach the person in the database words', () => {
  assert.equal(
    changeOrderErrorMessage(
      { code: '23514', message: 'The PO / CO # of a cancelled Change Order cannot be changed' },
      'The PO / CO # could not be saved.',
    ),
    'The PO / CO # of a cancelled Change Order cannot be changed',
  )
  assert.equal(
    changeOrderErrorMessage({ message: '' }, 'The PO / CO # could not be saved.'),
    'The PO / CO # could not be saved.',
  )
})

// Specific Plan Types: a Scope and Amount for each Plan ---------------------------------------------------

const planJob = {
  sequenceSheet: {
    plans: [{ id: 1, code: 'A' }, { id: 2, code: 'B' }, { id: 3, code: 'C' }],
    phases: [
      {
        id: 10,
        name: '1',
        building: '',
        lots: [
          { id: 101, lotNumber: '1', planId: 1 },
          { id: 102, lotNumber: '2', planId: 2 },
          { id: 103, lotNumber: '3', planId: 1 },
          { id: 104, lotNumber: '4', planId: 3 },
        ],
      },
    ],
  },
}

const byPlan = (overrides = {}) => filled({
  coverageMode: 'plans',
  lotIds: new Set(),
  planIds: new Set(['1', '2']),
  defaultScope: '',
  defaultAmount: '',
  planRules: {
    1: { scope: 'Attic ladder', amount: '120.00' },
    2: { scope: 'Wider door', amount: '300.00' },
  },
  ...overrides,
})

const planRows = [
  { lotId: '101', lot: '1', planId: '1' },
  { lotId: '102', lot: '2', planId: '2' },
  { lotId: '103', lot: '3', planId: '1' },
]

test('with Specific Plan Types each Lot follows the Scope and Amount of its Plan, unless it has its own', () => {
  const values = byPlan({ lineOverrides: { 103: { amount: '99.00' } } })
  const lines = buildChangeOrderLines(planRows, { ...values, rulesByPlan: values.planRules })

  assert.deepEqual(
    lines.map(({ lotId, scope, amount, ownAmount }) => ({ lotId, scope, amount, ownAmount })),
    [
      { lotId: '101', scope: 'Attic ladder', amount: 120, ownAmount: false },
      { lotId: '102', scope: 'Wider door', amount: 300, ownAmount: false },
      { lotId: '103', scope: 'Attic ladder', amount: 99, ownAmount: true },
    ],
  )
  // A Plan without a rule yet leaves its Lots empty.
  const empty = buildChangeOrderLines([{ lotId: '104', planId: '3' }], { rulesByPlan: values.planRules })
  assert.equal(empty[0].scope, '')
  assert.equal(empty[0].amount, null)
})

test('the form values alone never price by Plan: only the rules passed apart do', () => {
  const values = byPlan()
  const lines = buildChangeOrderLines(planRows, values)
  assert.equal(lines[0].scope, '')
})

test('a value typed equal to its Plan is not a value of its own, Lot by Lot', () => {
  const rules = byPlan().planRules
  const planOf = { 101: '1', 102: '2' }
  const defaults = (lotId) => rules[planOf[lotId]]

  const next = setLineOverride({}, ['101', '102'], 'amount', '300.00', defaults)
  assert.deepEqual(next, { 101: { amount: '300.00' } })
  assert.deepEqual(dropAmountsEqualToDefault({ 101: { amount: '120' }, 102: { amount: '1' } }, (id) => defaults(id).amount), {
    102: { amount: '1' },
  })
})

test('the Scope and Amount by Plan are sent for each Plan chosen, trimmed; any other coverage sends none', () => {
  const values = byPlan({ planRules: { 1: { scope: ' Attic ladder ', amount: '120.5' }, 2: { scope: 'Door', amount: '-3' } } })
  assert.deepEqual(toPlanRulesPayload(values), [
    { plan_id: 1, scope_of_work: 'Attic ladder', amount: 120.5, billing_event: null },
    { plan_id: 2, scope_of_work: 'Door', amount: -3, billing_event: null },
  ])
  // A Plan that was chosen but not written yet goes empty, for the database to refuse it in words.
  assert.deepEqual(toPlanRulesPayload(byPlan({ planIds: new Set(['3']) })), [
    { plan_id: 3, scope_of_work: '', amount: null, billing_event: null },
  ])
  assert.equal(toPlanRulesPayload(filled()), null)
  assert.equal(toUpdateChangeOrderRpc('12', values, { lines: [], places: [] }).p_plan_rules.length, 2)
})

test('every Plan chosen needs its Scope and Amount', () => {
  const lines = buildChangeOrderLines(planRows, { rulesByPlan: byPlan().planRules })
  assert.deepEqual(changeOrderProblems(byPlan(), { lines }), [])

  const missing = byPlan({
    planIds: new Set(['1', '2', '3']),
    planRules: { 1: { scope: 'Attic ladder', amount: '0' }, 2: { scope: ' ', amount: '300' } },
  })
  const messages = changeOrderProblems(missing, { lines }).map((problem) => problem.message)
  assert.ok(
    messages.includes('Scope and Amount by Plan: 2 without a Scope of Work, 1 without an Amount, 1 with an Amount of zero.'),
    messages.join(' | '),
  )
})

test('a saved Specific Plan Types Extra / CO opens with its Scope and Amount by Plan, and only what differs stays on the Lot', () => {
  const values = toChangeOrderFormValues(savedOrder({
    coverage: { mode: 'plans', lotIds: [], recordIds: [], planIds: ['1', '2'] },
    planRules: [
      { planId: 1, plan: 'A', scope: 'Attic ladder', amount: 120, event: 'DM' },
      { planId: 2, plan: 'B', scope: 'Wider door', amount: 300, event: null },
    ],
    lines: [
      { isPlace: false, lotId: 101, scope: 'Attic ladder', amount: 120, billingEvent: 'DM', billingEventDate: '2026-12-01' },
      { isPlace: false, lotId: 102, scope: 'Wider door', amount: 300, billingEvent: 'HW', billingEventDate: '2026-12-09' },
      { isPlace: false, lotId: 103, scope: 'Attic ladder', amount: 99 },
    ],
  }), { job: planJob })

  assert.equal(values.coverageMode, 'plans')
  // Each Plan keeps its event; a Plan saved without one is an event of its own.
  assert.deepEqual(values.planRules, {
    1: { scope: 'Attic ladder', amount: '120.00', event: 'DM' },
    2: { scope: 'Wider door', amount: '300.00', event: 'NONE' },
  })
  assert.deepEqual(values.lineOverrides, { 103: { amount: '99.00' } })
  // Lot 102 was tied to HW while its Plan is "own": that is its own choice. Lot 101 follows its Plan, and
  // Lot 103 (saved without a tie) follows it too: its DM may just have been too close.
  assert.deepEqual(values.eventByLot, { 102: 'HW' })
})

test('one saved before the Scope and Amount by Plan existed takes, for each Plan, what most of its Lots share', () => {
  const values = toChangeOrderFormValues(savedOrder({
    coverage: { mode: 'plans', lotIds: [], recordIds: [], planIds: ['1', '2'] },
    lines: [
      { isPlace: false, lotId: 101, scope: 'Attic ladder', amount: 120 },
      { isPlace: false, lotId: 103, scope: 'Attic ladder', amount: 120 },
      { isPlace: false, lotId: 102, scope: 'Wider door', amount: 300 },
    ],
  }), { job: planJob })

  assert.deepEqual(values.planRules, {
    1: { scope: 'Attic ladder', amount: '120.00' },
    2: { scope: 'Wider door', amount: '300.00' },
  })
  assert.deepEqual(values.lineOverrides, {})
  assert.deepEqual(values.eventByLot, {})
})

test('a rule and a row made from a Package are read', () => {
  assert.deepEqual(
    toChangeOrderPlanRule({ plan_id: 2, scope_of_work: 'Wider door', amount: '300.00', plan: { code: 'B', name: 'Bay' } }),
    { planId: 2, plan: 'B', planName: 'Bay', scope: 'Wider door', amount: 300, event: null },
  )
  assert.equal(toChangeOrderPlanRule({ plan_id: 2, scope_of_work: 'x', amount: 1, billing_event: 'EXT' }).event, 'EXT')
  const row = toChangeOrderSummary(overviewRow({
    source_change_order_id: 2,
    source_change_order_number: 'CO-0002',
    source_package_id: 81,
    source_package_number: 'DP-00000081',
  }))
  assert.equal(row.fromPackage, true)
  assert.equal(row.sourceNumber, 'CO-0002')
  assert.equal(row.sourcePackageNumber, 'DP-00000081')

  const detail = toChangeOrderDetail({
    summary: row,
    dates: {},
    lines: [],
    history: [],
    planRules: [{ plan: 'B10' }, { plan: 'B2' }],
  })
  assert.deepEqual(detail.planRules.map((rule) => rule.plan), ['B2', 'B10'])
  assert.deepEqual(detail.packageOrders, [])
})

test('each Plan sends its own event, or the one for every Lot; "Own CO event" goes empty', () => {
  const values = byPlan({
    chargeEvent: 'DM',
    planRules: { 1: { scope: 'a', amount: '1', event: 'EXT' }, 2: { scope: 'b', amount: '2' } },
  })
  assert.deepEqual(toPlanRulesPayload(values).map((rule) => rule.billing_event), ['EXT', 'DM'])
  const own = byPlan({ chargeEvent: 'DM', planRules: { 1: { scope: 'a', amount: '1', event: 'NONE' }, 2: { scope: 'b', amount: '2' } } })
  assert.deepEqual(toPlanRulesPayload(own).map((rule) => rule.billing_event), [null, 'DM'])
})

import { addPlaceLines, addPlaceLinesForLots } from '../src/features/change-orders/utils/pricing.js'

test('several empty lines can be added at once, each with its own id', () => {
  const next = addPlaceLines([{ id: 4, location: 'Sales Office', scope: '', amount: '' }], 3)
  assert.deepEqual(next.map((place) => place.id), [4, 5, 6, 7])
  assert.equal(addPlaceLines([], 500).length, 100)
  assert.equal(addPlaceLines([], 0).length, 0)
})

test('a range of lots makes a line "Lot N" for each, skipping the ones that already have one', () => {
  const start = [{ id: 1, location: 'Lot 13', scope: 'x', amount: '5' }]
  const result = addPlaceLinesForLots(start, ['12', '13', '14'])
  assert.deepEqual(result.places.map((place) => place.location), ['Lot 13', 'Lot 12', 'Lot 14'])
  assert.deepEqual(result.skipped, ['13'])
  assert.equal(result.added, 2)
})
