import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyChangeOrder } from '../src/features/change-orders/data/changeOrders.js'
import {
  cancelReasonProblem,
  canApproveChangeOrders,
  canEditChangeOrders,
  changeOrderActions,
  changeOrderErrorMessage,
  changeOrderListDate,
  changeOrderProblems,
  changeOrderStatusTabs,
  filterChangeOrders,
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
  toSetStatusRpc,
  toUpdateChangeOrderRpc,
  withSuggestedNumber,
} from '../src/features/change-orders/services/changeOrderRecord.js'
import { buildChangeOrderLines, buildPlaceLines } from '../src/features/change-orders/utils/pricing.js'

const filled = (overrides = {}) => ({
  ...emptyChangeOrder,
  builderId: '3',
  community: 'Rancho Madrina',
  jobId: 10,
  title: '  Electronic locks  ',
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
    { lot_id: 101, scope_of_work: 'Add attic ladder', amount: 10 },
    { lot_id: 102, scope_of_work: 'Add attic ladder', amount: -30.25 },
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
    'p_request_date', 'p_needed_by_date', 'p_coverage', 'p_status',
  ])
  assert.equal(rpc.p_job_id, 10)
  assert.equal(rpc.p_title, 'Electronic locks')
  assert.equal(rpc.p_requested_by, 'Carlos Ramirez')
  assert.equal(rpc.p_internal_number, 'E-2026-0047')
  assert.equal(rpc.p_request_date, '2026-11-01')
  assert.equal(rpc.p_needed_by_date, '2026-11-20')
  assert.equal(rpc.p_status, 'PENDING')
  assert.equal(rpc.p_lines.length, 3)
  assert.equal(rpc.p_coverage.mode, 'lots')
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
  const shown = withSuggestedNumber({ ...untouched, title: 'Locks' }, '', false)
  assert.equal(shown.internalNumber, '')
  assert.equal(shown.title, 'Locks')

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
    'builderId', 'community', 'jobId', 'title', 'requestedBy', 'lines',
  ])
  assert.equal(problemsByField(problems).title, 'Write a title.')
  assert.match(problemsByField(problems).lines, /Add at least one line/)
})

test('the limits are the ones of the database', () => {
  const problems = changeOrderProblems(filled({
    title: 'x'.repeat(151),
    requestedBy: 'y'.repeat(101),
    internalNumber: 'z'.repeat(61),
    requestDate: '2026-11-10',
    neededByDate: '2026-11-01',
  }), { lines: lotLines(), places: [] })

  assert.deepEqual(problemsByField(problems), {
    title: 'The title can have up to 150 characters.',
    requestedBy: 'Who requested it can have up to 100 characters.',
    internalNumber: 'The internal number can have up to 60 characters.',
    neededByDate: 'The needed-by date cannot be before the request date.',
  })
})

test('a title of only spaces is not a title', () => {
  const values = filled({ title: '   ' })
  assert.equal(problemsByField(changeOrderProblems(values, { lines: lotLines(values) })).title, 'Write a title.')
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
  title: 'Electronic locks',
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
    title: 'Electronic locks',
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
  })
  assert.equal(toChangeOrderSummary(overviewRow({ line_count: null, total_amount: null })).totalAmount, 0)
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
    id: 2, change_order_number: 'CO-0002', status: 'DRAFT', title: 'Paint', builder_name: 'Tri Pointe',
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
    assert.deepEqual(changeOrderActions('DRAFT', role), { canEdit: false, moves: [] }, String(role))
    assert.deepEqual(changeOrderActions('APPROVED', role), { canEdit: false, moves: [] }, String(role))
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
  assert.equal(rpc.p_title, 'Electronic locks')
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
  title: 'Attic ladder',
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
  assert.equal(values.defaultAmount, '10')
  assert.deepEqual(values.lineOverrides, { 102: { amount: '-30.25' } })
  assert.deepEqual(values.placeLines, [
    { id: 1, location: 'Sales Office', scope: 'Electronic locks', amount: '250.5' },
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
    { lot_id: 101, scope_of_work: 'Add attic ladder', amount: 10 },
    { lot_id: 102, scope_of_work: 'Replace the door', amount: -30.25 },
    { lot_id: 103, scope_of_work: 'Add attic ladder', amount: 1689.6 },
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
