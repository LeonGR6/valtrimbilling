import test from 'node:test'
import assert from 'node:assert/strict'
import {
  hardwareChargeKeyOfCell,
  hardwareChargesAfterCellChange,
} from '../src/features/draw-invoice/utils/packageHardwareLink.js'

// Hardware split by event: 60% with EXT, 40% with DM, none with HW.
const schedule = {
  separateHardwarePrice: true,
  hardwareBillingMode: 'BY_EVENT',
  hardwareEventPercentages: { EXT: 60, DM: 40, HW: 0 },
  draws: [
    { name: 'Draw 1', eventType: 'EXT' },
    { name: 'Draw 2', eventType: 'DM' },
    { name: 'Draw 3', eventType: 'HW' },
    { name: 'Draw 4', eventType: 'EXT' },
  ],
}

const cell = (lotId, drawIndex, phaseId = 1) => ({ phaseId, lotId, drawIndex })
const change = (previousCells, nextCells, chargeKeys = [], billed = []) => (
  hardwareChargesAfterCellChange({
    schedule,
    chargeKeys,
    previousCells,
    nextCells,
    billedChargeKeys: new Set(billed),
  }).sort()
)

test('a cell carries the Hardware of its Draw event, and none when that event has no Hardware', () => {
  assert.equal(hardwareChargeKeyOfCell(schedule, cell(7, 0)), '7:EXT')
  assert.equal(hardwareChargeKeyOfCell(schedule, cell(7, 1)), '7:DM')
  assert.equal(hardwareChargeKeyOfCell(schedule, cell(7, 2)), null)
  assert.equal(hardwareChargeKeyOfCell(schedule, cell(7, 9)), null)
  assert.equal(hardwareChargeKeyOfCell({ ...schedule, hardwareBillingMode: 'FULL' }, cell(7, 0)), null)
  assert.equal(hardwareChargeKeyOfCell({ ...schedule, separateHardwarePrice: false }, cell(7, 0)), null)
})

test('selecting a Draw selects the Hardware of its event for that Lot only', () => {
  assert.deepEqual(change([], [cell(7, 0)]), ['7:EXT'])
  assert.deepEqual(change([cell(7, 0)], [cell(7, 0), cell(7, 1)], ['7:EXT']), ['7:DM', '7:EXT'])
  assert.deepEqual(change([], [cell(7, 2)]), [])
})

test('clearing a Draw clears the Hardware of its event', () => {
  assert.deepEqual(change([cell(7, 0), cell(8, 0)], [cell(8, 0)], ['7:EXT', '8:EXT']), ['8:EXT'])
  assert.deepEqual(change([cell(7, 0)], [], ['7:EXT', '7:DM']), ['7:DM'])
})

test('Hardware stays while another selected Draw of the same event carries it', () => {
  assert.deepEqual(change([cell(7, 0), cell(7, 3)], [cell(7, 3)], ['7:EXT']), ['7:EXT'])
  assert.deepEqual(change([cell(7, 0), cell(7, 3)], [], ['7:EXT']), [])
})

test('a portion changed by hand is only touched when its own Draw changes', () => {
  // The EXT portion was unchecked by hand while its Draw stayed selected.
  assert.deepEqual(change([cell(7, 0)], [cell(7, 0), cell(8, 1)], []), ['8:DM'])
  // Selecting the Draw again selects the portion again.
  assert.deepEqual(change([], [cell(7, 0)], []), ['7:EXT'])
  // A portion checked by hand without its Draw is not cleared by other Draws.
  assert.deepEqual(change([cell(8, 0)], [], ['7:DM', '8:EXT']), ['7:DM'])
})

test('Hardware an earlier Package already billed is not selected again', () => {
  assert.deepEqual(change([], [cell(7, 0)], [], ['7:EXT']), [])
  assert.deepEqual(change([], [cell(7, 0), cell(7, 1)], [], ['7:EXT']), ['7:DM'])
})

test('selecting or clearing a whole column or row moves every Hardware portion with it', () => {
  const column = [cell(7, 0), cell(8, 0), cell(9, 0)]
  assert.deepEqual(change([], column), ['7:EXT', '8:EXT', '9:EXT'])
  assert.deepEqual(change(column, [], ['7:EXT', '8:EXT', '9:EXT']), [])
  assert.deepEqual(change([], [cell(7, 0), cell(7, 1), cell(7, 2)]), ['7:DM', '7:EXT'])
})

test('Cells of different Phases are told apart and the chosen list is not changed', () => {
  const chosen = ['7:EXT']
  assert.deepEqual(change([cell(7, 0, 1)], [cell(7, 0, 1), cell(7, 0, 2)], chosen), ['7:EXT'])
  assert.deepEqual(chosen, ['7:EXT'])
})
