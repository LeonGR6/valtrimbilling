import test from 'node:test'
import assert from 'node:assert/strict'
import {
  customerServiceMinimumMarginMinutes, visitDelayMargins,
} from '../src/features/customer-service/utils/customerServiceScheduling.js'

// Thursday 12 Nov 2026, Jorge Murillo (docs/customer-service-proposal-fit-plan.md, section 3).
// end = work end + 10 minutes of pickup, as in the planner agenda.
const thursday = [
  { requestId: '1497', start: '10:00', end: '10:55', windowEnd: '12:00' }, // CS-2497 10:00–10:45
  { requestId: '1496', start: '08:00', end: '08:40', windowEnd: '10:00' }, // CS-2496 8:00–8:30
  { requestId: '1022', start: '08:45', end: '09:25', windowEnd: '10:00' }, // CS-2022 8:45–9:15
]
const travel = { '1496>1022': 0, '1022>1497': 23 }

test('the minimum delay margin is 15 minutes (decision D4)', () => {
  assert.equal(customerServiceMinimumMarginMinutes, 15)
})

test('each visit carries the delay the visits after it can still absorb', () => {
  const margins = visitDelayMargins({ visits: thursday, travelMinutes: travel })
  assert.deepEqual(margins.map((visit) => [visit.requestId, visit.ownSlack, visit.margin]), [
    ['1496', 80, 40], // min(80, 5 + 35)
    ['1022', 35, 35], // min(35, 12 + 65)
    ['1497', 65, 65], // the last visit only has its own window
  ])
  // CS-2022 → CS-2497 leaves at 9:25, arrives 9:48 and waits 12 minutes: it absorbs 12 + 65.
  assert.deepEqual(margins[1].nextLeg, { toRequestId: '1497', waitMinutes: 12, absorbsMinutes: 77 })
  assert.deepEqual(margins[0].nextLeg, { toRequestId: '1022', waitMinutes: 5, absorbsMinutes: 40 })
  assert.equal(margins[2].nextLeg, null)
})

test('an unknown leg makes the margins before it unknown, never zero', () => {
  const margins = visitDelayMargins({ visits: thursday, travelMinutes: { '1496>1022': 0 } })
  assert.deepEqual(margins.map((visit) => [visit.ownSlack, visit.margin]), [[80, null], [35, null], [65, 65]])
  assert.deepEqual(margins[1].nextLeg, { toRequestId: '1497', waitMinutes: null, absorbsMinutes: null })
})

test('a visit without a known window has an unknown margin', () => {
  const [visit] = visitDelayMargins({ visits: [{ requestId: '1', start: '08:00', end: '08:40', windowEnd: null }] })
  assert.deepEqual([visit.ownSlack, visit.margin], [null, null])
})

test('a late visit after a long drive keeps a negative margin instead of hiding it', () => {
  // 101 minutes from CS-2022: CS-2497 could not start before 11:06, one minute past its limit.
  const margins = visitDelayMargins({ visits: thursday, travelMinutes: { ...travel, '1022>1497': 101 } })
  assert.equal(margins[1].nextLeg.absorbsMinutes, -1)
  assert.equal(margins[1].margin, -1)
})
