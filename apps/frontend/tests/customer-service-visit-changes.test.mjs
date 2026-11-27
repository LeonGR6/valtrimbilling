import test from 'node:test'
import assert from 'node:assert/strict'
import customerServiceMockDatabase from '../src/features/customer-service/data/customerServiceMockDatabase.js'
import { applyAppointmentsToRequests, toPlanningTechnicians } from '../src/features/customer-service/utils/appointmentRecords.js'
import { validatePrototypeProposalDraft } from '../src/features/customer-service/utils/proposalDraft.js'
import {
  buildRequestClose, buildVisitCancel, buildVisitMove, canChangeVisit, canCloseRequest, currentVisit, moveReasons,
  requestClosedNotice, requestPlanningForMove, requestsPlanningForMove, visitCancelledNotice, visitChangeProblem,
  visitChangeReasonOptions, visitMovedNotice,
} from '../src/features/customer-service/utils/customerServiceVisitChanges.js'
import {
  canEditRequestInView, effectiveRequestWorkflowStage, requestsForView,
} from '../src/features/customer-service/utils/requestInbox.js'
import { completedRequestHistory } from '../src/features/customer-service/utils/requestHistory.js'

// Reschedule block, part R4 (27 Nov 2026).
const roster = [{ id: 4, name: 'Jorge Murillo', isActive: true }, { id: 5, name: 'Helper', isActive: true }]
const technicians = toPlanningTechnicians(roster)
const ready = {
  ...customerServiceMockDatabase.requests.find((request) => request.workflowStage === 'READY_TO_PROPOSE'),
  id: 20, requestNumber: 'SR-20', customerUnavailableDates: [], dueOn: '2026-11-13', updatedAt: '2026-11-05T10:00:00Z',
  crewSize: 1,
}
// Monday 2026-11-09, 08:00–10:00 window (PST), work from 08:00, Jorge.
const visitRow = (id, requestId) => ({
  id, request_id: requestId, technician_ids: [4],
  window_starts_at: '2026-11-09T16:00:00Z', window_ends_at: '2026-11-09T18:00:00Z',
  starts_at: '2026-11-09T16:00:00Z', ends_at: '2026-11-09T16:30:00Z', pickup_minutes: 10,
  state: 'SCHEDULED', acceptance: 'CUSTOMER_ACCEPTED_PROPOSAL', updated_at: '2026-11-05T11:00:00Z',
})
const [confirmed] = applyAppointmentsToRequests([{ ...ready, workflowStage: 'CONFIRMED' }], [visitRow(9, 20)], roster)
const sameSlot = { technicianIds: ['4'], date: '2026-11-09', windowStart: '08:00', internalStart: '08:00', travelMinutes: {} }
const friday = new Date('2026-11-06T17:00:00Z')

test('a moving visit does not occupy its own slot, while other visits still do', () => {
  const asIs = validatePrototypeProposalDraft({ requestId: 20, values: sameSlot, requests: [confirmed], technicians, now: friday })
  assert.equal(asIs.isValid, false, 'a confirmed request is not planned as it is')

  const planning = requestsPlanningForMove([confirmed], confirmed)
  assert.equal(planning[0].workflowStage, 'READY_TO_PROPOSE')
  for (const field of ['appointment', 'customerWindow', 'internalSlot', 'technicianIds', 'assignedTechnicians']) {
    assert.equal(field in planning[0], false, `${field} is dropped`)
  }
  assert.equal(confirmed.appointment.id, 9, 'the original keeps its visit')
  const moved = validatePrototypeProposalDraft({ requestId: 20, values: sameSlot, requests: planning, technicians, now: friday })
  assert.equal(moved.isValid, true, JSON.stringify(moved.errors))

  const [other] = applyAppointmentsToRequests(
    [{ ...ready, id: 30, requestNumber: 'SR-30', workflowStage: 'CONFIRMED' }], [visitRow(10, 30)], roster,
  )
  const taken = validatePrototypeProposalDraft({
    requestId: 20, values: sameSlot, requests: requestsPlanningForMove([confirmed, other], confirmed), technicians, now: friday,
  })
  assert.equal(taken.isValid, false)
})

test('a visit can move or be cancelled until its window ends, also under way', () => {
  assert.equal(canChangeVisit(confirmed, friday), true)
  assert.equal(canChangeVisit({ ...confirmed, workflowStage: 'WORKING' }, new Date('2026-11-09T17:00:00Z')), true, '9:00 AM, under way')
  assert.equal(canChangeVisit(confirmed, new Date('2026-11-09T18:00:00Z')), false, '10:00 AM, the window ended')
  assert.equal(canChangeVisit({ ...confirmed, appointment: { ...confirmed.appointment, state: 'COMPLETED' } }, friday), false)
  assert.equal(canChangeVisit(ready, friday), false, 'no visit')
  assert.equal(canChangeVisit({ ...confirmed, closedAt: '2026-11-06T17:00:00Z' }, friday), false)
})

test('move, cancel and close send what the server checks', () => {
  const validation = { travelLegs: [{ key: '10>20', minutes: 15 }, { key: '20>30', minutes: null }] }
  assert.deepEqual(buildVisitMove({
    request: confirmed, values: { ...sameSlot, internalStart: '08:30' }, validation, reason: 'CUSTOMER_ASKED', note: '  ',
    email: { greeting: 'Hi,', message: 'See you then.' },
  }), {
    appointmentId: 9, expectedAppointmentUpdatedAt: '2026-11-05T11:00:00Z', requestId: 20,
    expectedRequestUpdatedAt: '2026-11-05T10:00:00Z', technicianIds: [4], date: '2026-11-09', windowStart: '08:00',
    workStart: '08:30', travelMinutes: { '10>20': 15 }, reason: 'CUSTOMER_ASKED', note: null,
    email: { greeting: 'Hi,', message: 'See you then.' },
  })
  assert.deepEqual(buildVisitCancel({ request: confirmed, reason: 'BUILDER_CANCELLED', note: ' PO void ' }), {
    appointmentId: 9, expectedAppointmentUpdatedAt: '2026-11-05T11:00:00Z', reason: 'BUILDER_CANCELLED',
    note: 'PO void', closeRequest: false, duplicateOfRequestId: null,
  })
  assert.equal(buildVisitCancel({ request: confirmed, reason: 'DUPLICATE', closeRequest: true, duplicateOfRequestId: '30' })
    .duplicateOfRequestId, 30)
  assert.deepEqual(buildRequestClose({ request: ready, reason: 'NOT_VALTRIM_WORK' }), {
    requestId: 20, expectedRequestUpdatedAt: '2026-11-05T10:00:00Z', reason: 'NOT_VALTRIM_WORK', note: null,
    duplicateOfRequestId: null,
  })
  assert.deepEqual(visitChangeReasonOptions(moveReasons).map((option) => option.label),
    ['Customer asked', 'Builder asked', 'Technician unavailable', 'Weather', 'Other'])
  assert.equal(visitChangeProblem({ action: 'move', reason: 'OTHER', note: '' }), 'Describe the reason in 500 characters or fewer')
  assert.equal(visitChangeProblem({ action: 'close', reason: 'DUPLICATE' }),
    'A duplicate needs the original request, and only a duplicate has one')
})

test('the current visit reads like the planner: day, window, work and crew', () => {
  assert.deepEqual(currentVisit(confirmed), {
    date: '2026-11-09', windowStart: '08:00',
    summary: { date: 'Mon, Nov 9', detail: '8:00 AM–10:00 AM window · work 8:00 AM–8:30 AM · Jorge Murillo' },
  })
})

test('a closed request shows as Closed, leaves the work lists and stays in History', () => {
  const closed = { ...ready, id: 21, requestNumber: 'SR-21', closedAt: '2026-11-06T17:00:00Z', closeReasonCode: 'NOT_VALTRIM_WORK' }
  assert.equal(effectiveRequestWorkflowStage(closed), 'CLOSED')
  assert.deepEqual(requestsForView([ready, closed], 'REQUESTS').map((request) => request.id), [20])
  assert.deepEqual(requestsForView([ready, closed], 'PROPOSALS').map((request) => request.id), [20])
  assert.deepEqual(completedRequestHistory([ready, closed]).map((request) => request.id), [21])
  assert.equal(canEditRequestInView(closed, 'HISTORY'), false, 'the server refuses edits to a closed request')
  assert.equal(canCloseRequest(ready), true)
  assert.equal(canCloseRequest(confirmed), false, 'a confirmed visit is cancelled with Close the request')
  assert.equal(canCloseRequest(closed), false)
})

test('the notices say what changed and what happened to the email', () => {
  assert.deepEqual(visitMovedNotice('CS-2023', '2026-12-03', { email: { status: 'SENT', to: 'leon@valtriminc.com', testMode: true } }), {
    severity: 'success', message: 'CS-2023 moved to Thu, Dec 3. The customer was emailed at leon@valtriminc.com (test inbox).',
  })
  assert.deepEqual(visitMovedNotice('CS-2023', '2026-12-03', { warnings: [{ message: 'late' }], email: null }), {
    severity: 'success', message: 'CS-2023 moved to Thu, Dec 3. It is after the due date.',
  })
  assert.deepEqual(visitCancelledNotice('CS-3404', { closed: true, email: { status: 'FAILED', message: 'Microsoft 365 rejected the email.' } }), {
    severity: 'warning',
    message: 'The CS-3404 visit was cancelled; the request was closed and is in History. The customer email failed: Microsoft 365 rejected the email.',
  })
  assert.deepEqual(requestClosedNotice('CS-3402', 'DUPLICATE'), {
    severity: 'success', message: 'CS-3402 was closed (Duplicate request). It is in History.',
  })
})
