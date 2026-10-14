import test from 'node:test'
import assert from 'node:assert/strict'
import { phaseBillingProgress } from '../src/features/draw-invoice/utils/packagePhaseScope.js'
import {
  drawSelectionKey,
  hardwareChargeKey,
  utilityChargeKey,
} from '../src/features/draw-invoice/utils/drawPackages.js'

const job = {
  id: 7,
  sequenceSheet: {
    phases: [
      {
        id: 70,
        lots: [
          { id: 1, lotNumber: '1' },
          { id: 2, lotNumber: '2' },
          { id: 3, isUtilityBuilding: true },
        ],
      },
    ],
  },
}
const phase = job.sequenceSheet.phases[0]
const schedule = {
  draws: [{ eventType: 'EXT' }, { eventType: 'DM' }],
  utilityBillingMode: 'FULL',
}

const allCells = () => new Map(
  [1, 2].flatMap((lotId) => [0, 1].map((drawIndex) => [
    drawSelectionKey(7, 70, lotId, drawIndex),
    {},
  ])),
)

const progress = (overrides = {}) => phaseBillingProgress({
  job,
  phase,
  schedule,
  usedSelections: new Map(),
  billedUtilityCharges: new Map(),
  billedHardwareCharges: new Map(),
  ...overrides,
})

test('a phase with unbilled cells is still open', () => {
  const open = progress({ usedSelections: new Map([[drawSelectionKey(7, 70, 1, 0), {}]]) })
  assert.equal(open.isComplete, false)
  assert.equal(open.totalCells, 4)
  assert.equal(open.billedCells, 1)
  assert.equal(open.remaining, 4) // 3 cells + 1 utility charge
})

test('a phase is complete once every cell and Utility charge is billed', () => {
  const cellsOnly = progress({ usedSelections: allCells() })
  assert.equal(cellsOnly.isComplete, false)
  assert.equal(cellsOnly.remaining, 1)

  const done = progress({
    usedSelections: allCells(),
    billedUtilityCharges: new Map([[utilityChargeKey(3, 'FULL'), {}]]),
  })
  assert.equal(done.isComplete, true)
  assert.equal(done.remaining, 0)
  assert.deepEqual([done.lotCount, done.utilityCount, done.drawCount], [2, 1, 2])
})

test('Separate Hardware charged by event keeps a phase open until it is billed', () => {
  const split = {
    ...schedule,
    separateHardwarePrice: true,
    hardwareBillingMode: 'BY_EVENT',
    hardwareEventPercentages: { EXT: 0, DM: 0, HW: 100 },
  }
  const base = {
    schedule: split,
    usedSelections: allCells(),
    billedUtilityCharges: new Map([[utilityChargeKey(3, 'FULL'), {}]]),
  }

  const open = progress(base)
  assert.equal(open.totalHardware, 2)
  assert.equal(open.isComplete, false)

  const done = progress({
    ...base,
    billedHardwareCharges: new Map([
      [hardwareChargeKey(1, 'BY_EVENT', 'HW'), {}],
      [hardwareChargeKey(2, 'BY_EVENT', 'HW'), {}],
    ]),
  })
  assert.equal(done.isComplete, true)
})

test('a phase with nothing to bill or no schedule is never reported complete', () => {
  assert.equal(progress({ schedule: { draws: [] } }).isComplete, false)
  const empty = phaseBillingProgress({
    job: { id: 7, sequenceSheet: { phases: [{ id: 71, lots: [] }] } },
    phase: { id: 71, lots: [] },
    schedule,
    usedSelections: new Map(),
    billedUtilityCharges: new Map(),
    billedHardwareCharges: new Map(),
  })
  assert.equal(empty.isComplete, false)
})
