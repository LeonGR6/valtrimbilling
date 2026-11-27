import assert from 'node:assert/strict'
import test from 'node:test'
import {
  copyableOptions,
  emptyCopySelection,
  optionsToCopy,
  plansToCopyFrom,
  selectedCopyOptions,
} from '../src/features/jobs/services/planOptionCopy.js'

const option = (id, code, description) => ({ id, planId: 1, code, description })
const plan2A = {
  id: 1,
  code: '2A',
  options: [
    option(11, 'OPT1', 'Upgraded counters'),
    option(12, 'OPT2', 'Extra outlet'),
    option(13, 'OPT3', 'Pantry shelves'),
  ],
}
const plan2B = { id: 2, code: '2B', options: [option(21, 'opt2', ' extra OUTLET ')] }
const emptyPlan = { id: 3, code: '2C', options: [] }

test('only other Plans that have Options can be copied from', () => {
  assert.deepEqual(
    plansToCopyFrom([plan2A, plan2B, emptyPlan], 2).map(({ code }) => code),
    ['2A'],
  )
  assert.deepEqual(plansToCopyFrom([emptyPlan], 3), [])
  // While the Plan is still being created there is nobody to leave out.
  assert.equal(plansToCopyFrom([plan2A, plan2B, emptyPlan]).length, 2)
})

test('Options the target already has are flagged, ignoring case and spacing', () => {
  const rows = copyableOptions(plan2A, plan2B)
  assert.deepEqual(rows.map(({ alreadyInTarget }) => alreadyInTarget), [false, true, false])
  assert.deepEqual(copyableOptions(plan2A).map(({ alreadyInTarget }) => alreadyInTarget), [false, false, false])
})

test('only the picked Options are copied, in order and without the ones already there', () => {
  assert.deepEqual(optionsToCopy(plan2A, new Set([13, 11]), null), [
    { code: 'OPT1', description: 'Upgraded counters' },
    { code: 'OPT3', description: 'Pantry shelves' },
  ])
  assert.deepEqual(optionsToCopy(plan2A, new Set([11, 12, 13]), plan2B).map(({ code }) => code), ['OPT1', 'OPT3'])
  assert.deepEqual(optionsToCopy(plan2A, new Set(), null), [])
})

test('nothing is copied until a Plan is chosen', () => {
  assert.deepEqual(selectedCopyOptions([plan2A], emptyCopySelection), [])
  assert.equal(
    selectedCopyOptions([plan2A], { sourceId: 1, selectedIds: new Set([11, 12]) }).length,
    2,
  )
  assert.deepEqual(selectedCopyOptions([plan2A], { sourceId: 99, selectedIds: new Set([11]) }), [])
})
