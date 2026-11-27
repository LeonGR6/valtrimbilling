import test from 'node:test'
import assert from 'node:assert/strict'
import { checkVisitCapacity } from '../src/features/customer-service/utils/customerServiceScheduling.js'

// Agenda entries carry the occupied times, pickup included, as the planner builds them.
const entry = (requestId, requestNumber, start, end) => ({
  requestId, requestNumber, technicianId: '4', technicianName: 'Jorge Murillo', stage: 'CONFIRMED',
  date: '2026-11-09', start, end, blocksAvailability: true, windowUncertain: false, timingUncertain: false,
})

const technicians = [{ id: '4', name: 'Jorge Murillo' }]

test('each travel leg records when the technician leaves the earlier visit, in California time', () => {
  const capacity = checkVisitCapacity({
    visit: { requestId: 20, label: 'CS-0020', windowStart: '10:00', workStart: '10:00', durationMinutes: 45, date: '2026-11-09' },
    technicians,
    agenda: [entry(10, 'CS-0010', '08:00', '08:40'), entry(30, 'CS-0030', '13:00', '13:45')],
    travelMinutes: {},
  })
  const legs = Object.fromEntries(capacity.travelLegs.map((leg) => [leg.key, leg.departureAt]))
  // 8:40 AM PST, and 10:55 AM PST (work ends 10:45 plus 10 minutes of pickup).
  assert.deepEqual(legs, {
    '10>20': '2026-11-09T16:40:00.000Z',
    '20>30': '2026-11-09T18:55:00.000Z',
  })
})

test('a leg has no departure time until the visit date is chosen', () => {
  const capacity = checkVisitCapacity({
    visit: { requestId: 20, label: 'CS-0020', windowStart: '10:00', workStart: '10:00', durationMinutes: 45 },
    technicians,
    agenda: [entry(10, 'CS-0010', '08:00', '08:40')],
    travelMinutes: {},
  })
  assert.equal(capacity.travelLegs[0].departureAt, null)
})
