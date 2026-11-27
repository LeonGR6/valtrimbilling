import test from 'node:test'
import assert from 'node:assert/strict'
import { completedRequestHistory, historyTechnicianOptions } from '../src/features/customer-service/utils/requestHistory.js'
import {
  canEditRequestInView, customerServiceViewFromPath, requestsForView,
} from '../src/features/customer-service/utils/requestInbox.js'

// The History tab (25 Nov 2026): completed requests, the most recent visit first.
const jorge = { id: '4', name: 'Jorge Murillo' }
const victor = { id: '7', name: 'Victor Ruiz' }
const completed = (id, requestNumber, date, people, extra = {}) => ({
  id, requestNumber, workflowStage: 'COMPLETED', builderName: 'BR Homes', community: 'Magnolia Townhomes',
  address: `${id} Oak St`, contactName: `Customer ${id}`, customerWindow: { date, start: '08:00', end: '10:00' },
  technicianIds: people.map((person) => person.id), assignedTechnicians: people, ...extra,
})
const requests = [
  completed(1, 'CS-1001', '2026-11-10', [jorge]),
  completed(2, 'CS-1002', '2026-11-20', [victor], { community: 'Palmdale 1B', contactName: 'Ana Lopez' }),
  completed(3, 'CS-1003', '2026-11-15', [jorge, victor]),
  { id: 4, requestNumber: 'CS-1004', workflowStage: 'CONFIRMED', customerWindow: { date: '2026-11-30' }, technicianIds: ['4'] },
  { id: 5, requestNumber: 'CS-1005', workflowStage: 'READY_TO_PROPOSE' },
]
const folios = (rows) => rows.map((request) => request.requestNumber)

test('only completed requests, the most recent visit first', () => {
  assert.deepEqual(folios(completedRequestHistory(requests)), ['CS-1002', 'CS-1003', 'CS-1001'])
  assert.deepEqual(folios(requestsForView(requests, 'HISTORY')), ['CS-1001', 'CS-1002', 'CS-1003'])
})

test('search, technician and visit dates narrow the history', () => {
  assert.deepEqual(folios(completedRequestHistory(requests, { search: 'ana lopez' })), ['CS-1002'])
  assert.deepEqual(folios(completedRequestHistory(requests, { search: 'cs-1001' })), ['CS-1001'])
  assert.deepEqual(folios(completedRequestHistory(requests, { technicianId: '4' })), ['CS-1003', 'CS-1001'])
  assert.deepEqual(folios(completedRequestHistory(requests, { from: '2026-11-12', to: '2026-11-18' })), ['CS-1003'])
  assert.deepEqual(folios(completedRequestHistory(requests, { from: '2026-11-21' })), [])
})

test('the technician filter lists who did completed visits, by name', () => {
  assert.deepEqual(historyTechnicianOptions(requests), [
    { value: '4', label: 'Jorge Murillo' },
    { value: '7', label: 'Victor Ruiz' },
  ])
})

test('History has its own address and edits only completed requests (internal notes)', () => {
  assert.equal(customerServiceViewFromPath('/customer-service/history'), 'HISTORY')
  assert.equal(canEditRequestInView(requests[0], 'HISTORY'), true)
  assert.equal(canEditRequestInView(requests[3], 'HISTORY'), false)
})

// Reschedule block, part R5 (27 Nov 2026): closed requests in History, with their reason.
test('a closed request is dated by the California day it closed and shows its reason', async () => {
  const { closedDate, historyOutcome } = await import('../src/features/customer-service/utils/requestHistory.js')
  const original = { id: 2402, requestNumber: 'CS-3402' }
  // 11:30 PM on Nov 26 in California is already Nov 27 in UTC.
  const duplicate = {
    id: 2403, requestNumber: 'CS-3403', workflowStage: 'NEEDS_REVIEW', closedAt: '2026-11-27T07:30:00Z',
    closeReasonCode: 'DUPLICATE', closeReason: 'Duplicate request', duplicateOfRequestId: 2402,
  }
  assert.equal(closedDate(duplicate), '2026-11-26')
  assert.deepEqual(historyOutcome(duplicate, [original, duplicate]), { closed: true, label: 'Closed', detail: 'Duplicate of CS-3402' })
  assert.deepEqual(historyOutcome({ ...duplicate, closeReasonCode: 'BUILDER_CANCELLED', closeReason: 'PO 1234 void', duplicateOfRequestId: null }), {
    closed: true, label: 'Closed', detail: 'Cancelled by Builder · PO 1234 void',
  })
  assert.deepEqual(historyOutcome({ id: 1, workflowStage: 'COMPLETED' }), { closed: false, label: 'Completed', detail: '' })
})
