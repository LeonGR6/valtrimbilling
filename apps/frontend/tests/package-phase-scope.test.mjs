import test from 'node:test'
import assert from 'node:assert/strict'
import {
  initialShownPhaseIds,
  isMultiPhasePackage,
  packagePhaseLabels,
} from '../src/features/draw-invoice/utils/packagePhaseScope.js'

const schedule = {
  id: 1,
  frequency: 'MONTHLY',
  anyDate: true,
  draws: [{ name: 'Draw 1', percentage: 100, eventType: 'EXT' }],
  separateHardwarePrice: false,
  utilityBillingMode: 'FULL',
  utilityEventPercentages: { EXT: 0, DM: 0, HW: 0 },
  optionsBillingDrawIndex: null,
}

const job = {
  id: 7,
  code: '1501',
  sequenceSheet: {
    plans: [{ id: 1, code: 'A', price: 1000, options: [] }],
    phases: [
      { id: 21, name: '1', building: 'A', lots: [{ id: 101, lotNumber: '1', planId: 1, optionIds: [] }] },
      { id: 22, name: '2', building: 'B', lots: [{ id: 102, lotNumber: '2', planId: 1, optionIds: [] }] },
      { id: 23, name: '3', building: 'C', lots: [{ id: 103, lotNumber: '3', planId: 1, optionIds: [] }] },
    ],
  },
}

const activity = (id, phaseId, lotId, date) => ({
  id,
  jobId: 7,
  phaseId,
  status: 'ACTIVE',
  stages: [{
    id,
    type: 'EXT',
    isEnabled: true,
    schedules: [{ id, date, lotIds: [lotId], isActive: true }],
  }],
})

const base = { schedule, packages: [], asOfDate: '2026-10-09' }

test('a Package started by hand shows no Phase yet', () => {
  assert.deepEqual(initialShownPhaseIds({ ...base, job: null }), [])
  assert.deepEqual(
    initialShownPhaseIds({ ...base, job, productionActivities: [] }),
    [],
  )
})

test('a Package Suggestion opens with every Phase that has suggested work, in Job order', () => {
  const productionActivities = [
    activity(1, 23, 103, '2026-10-05'),
    activity(2, 21, 101, '2026-10-06'),
  ]

  assert.deepEqual(
    initialShownPhaseIds({ ...base, job, initialPhaseId: 22, productionActivities }),
    ['21', '22', '23'],
  )
  assert.deepEqual(
    initialShownPhaseIds({ ...base, job, productionActivities }),
    ['21', '23'],
  )
})

test('an unknown initial Phase is ignored', () => {
  assert.deepEqual(
    initialShownPhaseIds({ ...base, job, initialPhaseId: 999, productionActivities: [] }),
    [],
  )
})

test('multi-phase Packages are labelled by Phase and Building', () => {
  assert.deepEqual(
    packagePhaseLabels([
      { phaseCode: '1', building: 'A' },
      { phaseCode: 'Phase 2', building: 'Building B' },
    ]),
    ['Phase 1 / Building A', 'Phase 2 / Building B'],
  )
  assert.equal(isMultiPhasePackage(1), false)
  assert.equal(isMultiPhasePackage(2), true)
  assert.equal(isMultiPhasePackage(undefined), false)
})
