import assert from 'node:assert/strict'
import test from 'node:test'
import { eventBreakdown, formSteps } from '../src/features/change-orders/utils/changeOrderSummary.js'

test('the summary counts the Lots of each Calendar choice, leaving out the ones nobody uses', () => {
  const result = eventBreakdown([
    { event: 'DM', status: 'AVAILABLE' },
    { event: 'DM', status: 'TOO_CLOSE' },
    { event: 'NONE', status: 'OWN' },
  ])
  assert.deepEqual(result.parts.map((part) => [part.key, part.count]), [['DM', 2], ['NONE', 1]])
  assert.equal(result.needOwn, 1)
  assert.equal(result.total, 3)
})

test('the checklist marks what needs attention only after a save was tried', () => {
  const base = { requestDone: true, whereDone: false, eventDone: false, chargedDone: false }
  assert.equal(formSteps({ ...base, attempted: false }).some((step) => step.attention), false)
  const tried = formSteps({ ...base, attempted: true })
  assert.deepEqual(tried.filter((step) => step.attention).map((step) => step.label), [
    'Where the work is', 'Calendar event', 'What is charged',
  ])
})
