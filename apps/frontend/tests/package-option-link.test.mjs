import test from 'node:test'
import assert from 'node:assert/strict'
import { optionSelectionKey } from '../src/features/draw-invoice/utils/drawPackages.js'
import {
  bulkOptionCheck,
  excludedOptionsAfterBulkChoice,
  excludedOptionsAfterCellChange,
} from '../src/features/draw-invoice/utils/packageOptionLink.js'

// Options are billed from Draw 3 on (index 2).
const schedule = { optionsBillingDrawIndex: 2, draws: [{}, {}, {}, {}] }

const cell = (lotId, drawIndex, phaseId = 1) => ({ phaseId, lotId, drawIndex })
// Lot 7 has Options 10 and 11, Lot 8 has Option 10, in Phase 1; Phase 2 has a Lot 7 too.
const optionsByLot = {
  '1:7': [10, 11],
  '1:8': [10],
  '2:7': [10],
}
const optionKeysOfLot = (phaseId, lotId) => (
  (optionsByLot[`${phaseId}:${lotId}`] ?? []).map((id) => optionSelectionKey(phaseId, lotId, id))
)
const key = (phaseId, lotId, optionId) => optionSelectionKey(phaseId, lotId, optionId)
const change = (previousCells, nextCells, excludedKeys = [], scheduleOverride = schedule) => (
  excludedOptionsAfterCellChange({
    schedule: scheduleOverride,
    excludedKeys,
    previousCells,
    nextCells,
    optionKeysOfLot,
  }).sort()
)

test('a Lot that reaches the Options billing Draw gets its Options back', () => {
  const excluded = [key(1, 7, 10), key(1, 7, 11), key(1, 8, 10)]

  assert.deepEqual(change([], [cell(7, 2)], excluded), [key(1, 8, 10)])
  assert.deepEqual(change([cell(7, 3)], [cell(7, 3), cell(7, 2)], excluded), excluded.sort())
})

test('a Lot that no longer reaches the Options billing Draw has its Options cleared', () => {
  assert.deepEqual(change([cell(7, 2)], []), [key(1, 7, 10), key(1, 7, 11)])
  assert.deepEqual(change([cell(7, 2), cell(8, 3)], [cell(8, 3)]), [key(1, 7, 10), key(1, 7, 11)])
})

test('Options stay while another selected cell of the Lot still reaches the Draw', () => {
  assert.deepEqual(change([cell(7, 2), cell(7, 3)], [cell(7, 3)], [key(1, 7, 11)]), [key(1, 7, 11)])
  assert.deepEqual(change([cell(7, 2), cell(7, 3)], [cell(7, 2)]), [])
})

test('cells before the Options billing Draw change nothing', () => {
  assert.deepEqual(change([], [cell(7, 0), cell(7, 1)], [key(1, 7, 10)]), [key(1, 7, 10)])
  assert.deepEqual(change([cell(7, 0)], [], []), [])
})

test('an Option excluded by hand stays excluded until its Lot starts or stops reaching the Draw', () => {
  const excluded = [key(1, 7, 11)]

  assert.deepEqual(change([cell(7, 2)], [cell(7, 2), cell(8, 2)], excluded), excluded)
  assert.deepEqual(change([cell(7, 2)], [], excluded), [key(1, 7, 10), key(1, 7, 11)])
  assert.deepEqual(change([], [cell(7, 2)], [key(1, 7, 10), key(1, 7, 11)]), [])
})

test('selecting or clearing a whole column moves the Options of every Lot in it', () => {
  const column = [cell(7, 2), cell(8, 2), cell(7, 2, 2)]

  assert.deepEqual(change(column, []), [key(1, 7, 10), key(1, 7, 11), key(1, 8, 10), key(2, 7, 10)].sort())
  assert.deepEqual(change([], column, [key(1, 7, 10), key(1, 8, 10), key(2, 7, 10)]), [])
})

test('Lots of different Phases are told apart', () => {
  assert.deepEqual(change([cell(7, 2, 1)], [cell(7, 2, 1), cell(7, 2, 2)], [key(2, 7, 10)]), [])
  assert.deepEqual(change([cell(7, 2, 1), cell(7, 2, 2)], [cell(7, 2, 1)]), [key(2, 7, 10)])
})

test('nothing changes when the setup bills no Options', () => {
  const excluded = [key(1, 7, 10)]

  assert.deepEqual(change([], [cell(7, 2)], excluded, { optionsBillingDrawIndex: null }), excluded)
  assert.deepEqual(change([cell(7, 2)], [], excluded, {}), excluded)
})

test('the check in the Include column includes or excludes every option of the table at once', () => {
  const all = [key(1, 7, 10), key(1, 7, 11), key(1, 8, 10)]
  const bulk = (excludedKeys, included, optionKeys = all) => (
    excludedOptionsAfterBulkChoice({ excludedKeys, optionKeys, included }).sort()
  )

  // Excluding all leaves them all excluded, whatever was chosen before.
  assert.deepEqual(bulk([], false), [...all].sort())
  assert.deepEqual(bulk([key(1, 7, 10)], false), [...all].sort())
  // Including all clears them all.
  assert.deepEqual(bulk([...all], true), [])
  assert.deepEqual(bulk([key(1, 7, 11)], true), [])
  // Options that are not in the table keep what was chosen.
  assert.deepEqual(bulk([key(2, 7, 10)], true), [key(2, 7, 10)])
  assert.deepEqual(bulk([key(2, 7, 10)], false), [key(2, 7, 10), ...all].sort())
})

test('the check of the Include column is checked, empty or in between, and hidden with nothing to choose', () => {
  const all = [key(1, 7, 10), key(1, 7, 11), key(1, 8, 10)]

  assert.deepEqual(bulkOptionCheck(all, new Set(all)), { visible: true, checked: true, indeterminate: false })
  assert.deepEqual(bulkOptionCheck(all, new Set()), { visible: true, checked: false, indeterminate: false })
  assert.deepEqual(
    bulkOptionCheck(all, new Set([key(1, 7, 10)])),
    { visible: true, checked: false, indeterminate: true },
  )
  assert.deepEqual(bulkOptionCheck([], new Set()), { visible: false, checked: false, indeterminate: false })
  // Included options of other rows do not count.
  assert.equal(bulkOptionCheck(all, new Set([key(9, 9, 9)])).checked, false)
})
