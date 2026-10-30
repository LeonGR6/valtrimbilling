import test from 'node:test'
import assert from 'node:assert/strict'
import { phaseBillingProgress } from '../src/features/draw-invoice/utils/packagePhaseScope.js'
import {
  drawSelectionKey,
  hardwareChargeKey,
  optionBillingIdentity,
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

// A Phase with plans and Options: Lot 1 has P65100C selected, Lot 2 has none.
const optionJob = {
  id: 7,
  sequenceSheet: {
    plans: [{ id: 5, options: [{ id: 50, code: 'C9100' }, { id: 51, code: 'P65100C' }] }],
    phases: [
      {
        id: 70,
        lots: [
          { id: 1, lotNumber: '1', planId: 5, optionIds: [50, 51] },
          { id: 2, lotNumber: '2', planId: 5, optionIds: [50] },
          { id: 3, isUtilityBuilding: true, planId: 5, optionIds: [50] },
        ],
      },
    ],
  },
}
const optionSchedule = { ...schedule, optionsBillingDrawIndex: 1 }
const optionProgress = (overrides = {}) => phaseBillingProgress({
  job: optionJob,
  phase: optionJob.sequenceSheet.phases[0],
  schedule: optionSchedule,
  usedSelections: allCells(),
  billedUtilityCharges: new Map([[utilityChargeKey(3, 'FULL'), {}]]),
  billedHardwareCharges: new Map(),
  ...overrides,
})

test('an Option added after its Lot was billed keeps the Phase open, so it can be billed', () => {
  // Every cell and Utility charge is billed, and so was C9100 of both Lots; P65100C was just added.
  const open = optionProgress({
    billedOptionIdentities: new Set([optionBillingIdentity(1, 50), optionBillingIdentity(2, 50)]),
  })

  assert.equal(open.isComplete, false)
  assert.equal(open.pendingOptions, 1)
  assert.equal(open.totalOptions, 3)
  assert.equal(open.billedOptions, 2)
  assert.equal(open.remaining, 1)
  // The cells themselves are all billed: only the Option is left.
  assert.equal(open.billedCells, open.totalCells)
})

test('once its Options are billed the Phase is complete again', () => {
  const done = optionProgress({
    billedOptionIdentities: new Set([
      optionBillingIdentity(1, 50),
      optionBillingIdentity(1, 51),
      optionBillingIdentity(2, 50),
    ]),
  })

  assert.equal(done.isComplete, true)
  assert.equal(done.pendingOptions, 0)
  assert.equal(done.remaining, 0)
})

test('an Option billed on a Lot is not mistaken for the same Option on another Lot', () => {
  const open = optionProgress({
    billedOptionIdentities: new Set([
      optionBillingIdentity(1, 50),
      optionBillingIdentity(2, 51),
      optionBillingIdentity(9, 51),
    ]),
  })

  assert.equal(open.isComplete, false)
  assert.equal(open.pendingOptions, 2)
})

test('a Builder that does not bill Options never keeps a Phase open for them', () => {
  const done = optionProgress({ schedule })

  assert.equal(done.totalOptions, 0)
  assert.equal(done.pendingOptions, 0)
  assert.equal(done.isComplete, true)
})

test('only Options that exist in the Lot\'s Plan count, and Utility rows have none', () => {
  const stale = {
    ...optionJob,
    sequenceSheet: {
      ...optionJob.sequenceSheet,
      phases: [{
        id: 70,
        lots: [
          // 99 is not an Option of Plan 5 any more; Lot 3 is a Utility row.
          { id: 1, lotNumber: '1', planId: 5, optionIds: [99] },
          { id: 2, lotNumber: '2', planId: 8, optionIds: [50] },
          { id: 3, isUtilityBuilding: true, planId: 5, optionIds: [50] },
        ],
      }],
    },
  }
  const done = optionProgress({ job: stale, phase: stale.sequenceSheet.phases[0] })

  assert.equal(done.totalOptions, 0)
  assert.equal(done.isComplete, true)
})
