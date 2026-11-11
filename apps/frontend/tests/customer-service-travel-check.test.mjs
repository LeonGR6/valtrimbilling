import test from 'node:test'
import assert from 'node:assert/strict'
import customerServiceMockDatabase from '../src/features/customer-service/data/customerServiceMockDatabase.js'
import { applyAppointmentsToRequests, toPlanningTechnicians } from '../src/features/customer-service/utils/appointmentRecords.js'
import { californiaInstant } from '../src/features/customer-service/utils/customerServiceScheduling.js'
import { scheduledDelayMargins } from '../src/features/customer-service/utils/proposalDraft.js'
import { travelCheckSummary, upcomingTravelCheck } from '../src/features/customer-service/utils/travelCheck.js'

// Thursday 12 Nov 2026 with Jorge (docs/customer-service-proposal-fit-plan.md, section 3):
// CS-2496 8:00–8:30, CS-2022 8:45–9:15 (both 8–10) and CS-2497 10:00–10:45 (10–12).
const roster = [{ id: 4, name: 'Jorge Murillo', isActive: true }, { id: 5, name: 'Helper', isActive: true }]
const technicians = toPlanningTechnicians(roster)
const mockConfirmed = customerServiceMockDatabase.requests.find((request) => request.workflowStage === 'CONFIRMED')
const confirmed = (id, requestNumber) => {
  const request = { ...mockConfirmed, id, requestNumber }
  delete request.technicianIds
  delete request.customerWindow
  delete request.internalSlot
  return request
}
const at = (time) => californiaInstant('2026-11-12', time).toISOString()
const appointment = (requestId, windowStart, windowEnd, workStart, workEnd) => ({
  id: requestId, request_id: requestId, technician_ids: [4],
  window_starts_at: at(windowStart), window_ends_at: at(windowEnd), starts_at: at(workStart), ends_at: at(workEnd),
  pickup_minutes: 10, state: 'SCHEDULED', acceptance: 'CUSTOMER_ACCEPTED_PROPOSAL', updated_at: '2026-11-10T11:00:00Z',
})
const requests = applyAppointmentsToRequests(
  [confirmed(1496, 'CS-2496'), confirmed(1022, 'CS-2022'), confirmed(1497, 'CS-2497')],
  [
    appointment(1496, '08:00', '10:00', '08:00', '08:30'),
    appointment(1022, '08:00', '10:00', '08:45', '09:15'),
    appointment(1497, '10:00', '12:00', '10:00', '10:45'),
  ],
  roster,
)
const check = { targetDate: '2026-11-12', checkedAt: '2026-11-12T00:00:00Z', legs: 2, refreshed: 2, failed: 0 }

test('each scheduled visit of a day has its delay margin from the saved legs', () => {
  const travelMinutes = { '1496>1022': 0, '1022>1497': 23 }
  assert.deepEqual(scheduledDelayMargins({ requests, technicians, date: '2026-11-12', travelMinutes }), {
    1496: 40, 1022: 35, 1497: 65,
  })
  // Another day has no visits.
  assert.deepEqual(scheduledDelayMargins({ requests, technicians, date: '2026-11-13', travelMinutes }), {})
})

test('the traffic check note lists the visits left with less than 15 minutes', () => {
  const quiet = travelCheckSummary({ check, requests, technicians, travelMinutes: { '1496>1022': 0, '1022>1497': 23 } })
  assert.deepEqual([quiet.visits, quiet.tight, quiet.unknown, quiet.failedLegs], [3, [], [], 0])

  // Tomorrow's traffic turns CS-2022 → CS-2497 into 92 minutes: CS-2022 can start only
  // 8 min late, and CS-2496 before it 13.
  const slow = travelCheckSummary({ check, requests, technicians, travelMinutes: { '1496>1022': 0, '1022>1497': 92 } })
  assert.deepEqual(slow.tight.map((visit) => [visit.requestNumber, visit.margin]), [['CS-2022', 8], ['CS-2496', 13]])

  // A leg without minutes leaves the visits before it unknown.
  const pending = travelCheckSummary({ check, requests, technicians, travelMinutes: { '1496>1022': 0 } })
  assert.deepEqual(pending.unknown.map((visit) => visit.requestNumber), ['CS-2022', 'CS-2496'])
})

test('the note shows the next checked date from today on', () => {
  const wednesday = new Date('2026-11-11T17:00:00Z')
  const runs = [
    { targetDate: '2026-11-16', checkedAt: '2026-11-14T00:00:00Z' },
    { targetDate: '2026-11-10', checkedAt: '2026-11-07T00:00:00Z' },
    { targetDate: '2026-11-12', checkedAt: '2026-11-12T00:00:00Z' },
  ]
  assert.equal(upcomingTravelCheck(runs, wednesday).targetDate, '2026-11-12')
  assert.equal(upcomingTravelCheck([], wednesday), null)
})
