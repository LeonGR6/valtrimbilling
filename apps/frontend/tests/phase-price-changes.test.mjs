import assert from 'node:assert/strict'
import test from 'node:test'
import {
  affectedDraftPackages,
  buildPhasePriceRequest,
  groupPlanChanges,
  phaseEligibleChanges,
  summarizePhasePriceRequest,
  toPhasePriceChanges,
} from '../src/features/plan-pricing/utils/phasePriceChanges.js'

const draftPackage = {
  package_id: 5,
  package_number: 'DP-00000005',
  recalculable: true,
  has_documents: true,
}
const issuedPackage = {
  package_id: 6,
  package_number: 'DP-00000006',
  recalculable: false,
  has_documents: false,
}

const serverRows = [
  {
    phase_id: 21,
    code: '1',
    building: 'C5',
    lots: [
      {
        lot_id: 71,
        lot_number: '1',
        utility_name: null,
        is_utility_building: false,
        plan_id: 3,
        plan_code: 'A',
        // Billed only in a Draft Package: it can be recalculated.
        plan_change: {
          billed: true,
          locked: false,
          packages: [draftPackage],
          from_base: '2000.00',
          to_base: '2500.00',
          from_hardware: null,
          to_hardware: null,
        },
        option_changes: [{
          option_id: 41,
          code: 'OPT1',
          description: 'Door',
          billed: false,
          locked: false,
          packages: [],
          from_price: '100.00',
          from_na: false,
          to_price: '150.00',
          to_na: false,
        }],
      },
      {
        lot_id: 72,
        lot_number: '2',
        utility_name: null,
        is_utility_building: false,
        plan_id: 3,
        plan_code: 'A',
        // Billed in a Package with a QuickBooks invoice: it cannot change here.
        plan_change: {
          billed: true,
          locked: true,
          packages: [issuedPackage],
          from_base: 2000,
          to_base: 2500,
          from_hardware: null,
          to_hardware: null,
        },
        option_changes: [],
      },
      {
        lot_id: 73,
        lot_number: 'UTILITY-1',
        utility_name: 'Clubhouse',
        is_utility_building: true,
        plan_id: 3,
        plan_code: 'A',
        plan_change: null,
        option_changes: [{
          option_id: 42,
          code: 'OPT2',
          description: null,
          billed: true,
          locked: true,
          packages: [issuedPackage],
          from_price: 50,
          from_na: false,
          to_price: 0,
          to_na: true,
        }],
      },
    ],
  },
  {
    phase_id: 22,
    code: '2',
    building: null,
    lots: [{
      lot_id: 81,
      lot_number: '1',
      utility_name: null,
      is_utility_building: false,
      plan_id: 4,
      plan_code: 'B',
      plan_change: {
        billed: true,
        locked: false,
        // The same Draft Package also bills this Lot.
        packages: [draftPackage],
        from_base: 3000,
        to_base: 3000,
        from_hardware: 200,
        to_hardware: 300,
      },
      option_changes: [],
    }],
  },
]

test('the server list becomes Phases with money as numbers and readable labels', () => {
  const phases = toPhasePriceChanges(serverRows)

  assert.equal(phases.length, 2)
  assert.equal(phases[0].label, '1 · C5')
  assert.equal(phases[1].label, '2')
  assert.equal(phases[0].lots[0].label, 'Lot 1')
  assert.equal(phases[0].lots[2].label, 'Clubhouse')
  assert.deepEqual(phases[0].lots[0].plan, {
    billed: true,
    locked: false,
    packages: [{
      packageId: 5,
      packageNumber: 'DP-00000005',
      recalculable: true,
      hasDocuments: true,
    }],
    fromBase: 2000,
    toBase: 2500,
    fromHardware: null,
    toHardware: null,
    baseChanged: true,
    hardwareChanged: false,
  })
  assert.equal(phases[1].lots[0].plan.baseChanged, false)
  assert.equal(phases[1].lots[0].plan.hardwareChanged, true)
  assert.equal(phases[0].lots[2].plan, null)
  assert.deepEqual(phases[0].lots[2].options[0], {
    optionId: 42,
    code: 'OPT2',
    description: '',
    billed: true,
    locked: true,
    packages: [{
      packageId: 6,
      packageNumber: 'DP-00000006',
      recalculable: false,
      hasDocuments: false,
    }],
    fromPrice: 50,
    fromNotApplicable: false,
    toPrice: 0,
    toNotApplicable: true,
  })
})

test('what a Draft Package bills is offered; what an issued Package bills is blocked', () => {
  const [first] = toPhasePriceChanges(serverRows)

  const everything = phaseEligibleChanges(first)
  assert.deepEqual(everything.lots.map((lot) => lot.lotId), [71])
  assert.deepEqual(everything.options.map(({ option }) => option.optionId), [41])
  assert.equal(everything.blocked, 2)
  assert.equal(everything.count, 2)
  assert.deepEqual(everything.packages.map((item) => item.packageNumber), ['DP-00000005'])

  const planOnly = phaseEligibleChanges(first, { includeOptions: false })
  assert.equal(planOnly.options.length, 0)
  assert.equal(planOnly.blocked, 1)

  const optionsOnly = phaseEligibleChanges(first, { includePlan: false })
  assert.equal(optionsOnly.lots.length, 0)
  assert.equal(optionsOnly.options.length, 1)
  // That Option is billed nowhere, so no Package is recalculated for it.
  assert.equal(optionsOnly.packages.length, 0)
  assert.equal(optionsOnly.blocked, 1)
})

test('the request carries only the picked Phases and the chosen components', () => {
  const phases = toPhasePriceChanges(serverRows)

  assert.deepEqual(
    buildPhasePriceRequest(phases, [21, 22], { includePlan: true, includeOptions: true }),
    {
      lotIds: [71, 81],
      options: [{ lot_id: 71, option_id: 41 }],
    },
  )
  assert.deepEqual(
    buildPhasePriceRequest(phases, [22], { includePlan: true, includeOptions: false }),
    { lotIds: [81], options: [] },
  )
  assert.deepEqual(
    buildPhasePriceRequest(phases, [21], { includePlan: false, includeOptions: true }),
    { lotIds: [], options: [{ lot_id: 71, option_id: 41 }] },
  )
  assert.deepEqual(
    buildPhasePriceRequest(phases, [], { includePlan: true, includeOptions: true }),
    { lotIds: [], options: [] },
  )
})

test('a Draft Package billing several picked Lots is recalculated once', () => {
  const phases = toPhasePriceChanges(serverRows)
  const both = { includePlan: true, includeOptions: true }

  assert.deepEqual(
    affectedDraftPackages(phases, [21, 22], both).map((item) => item.packageNumber),
    ['DP-00000005'],
  )
  assert.deepEqual(affectedDraftPackages(phases, [], both), [])
  assert.deepEqual(
    affectedDraftPackages(phases, [21], { includePlan: false, includeOptions: true }),
    [],
  )
})

test('the summary counts Phases, prices, Draft Packages and the ones with documents', () => {
  const phases = toPhasePriceChanges(serverRows)

  assert.deepEqual(
    summarizePhasePriceRequest(phases, [21, 22], { includePlan: true, includeOptions: true }),
    {
      phaseCount: 2,
      lotCount: 2,
      optionCount: 1,
      packageCount: 1,
      packagesWithDocuments: 1,
    },
  )
  // Phase 22 has nothing to change among Options, so it does not count.
  assert.deepEqual(
    summarizePhasePriceRequest(phases, [21, 22], { includePlan: false, includeOptions: true }),
    {
      phaseCount: 1,
      lotCount: 0,
      optionCount: 1,
      packageCount: 0,
      packagesWithDocuments: 0,
    },
  )
})

test('equal Plan price changes of a Phase read once with how many Lots they cover', () => {
  const phases = toPhasePriceChanges([{
    phase_id: 30,
    code: '3',
    building: null,
    lots: [1, 2, 3].map((number) => ({
      lot_id: number,
      lot_number: String(number),
      is_utility_building: false,
      plan_id: 3,
      plan_code: 'A',
      plan_change: {
        billed: number === 3,
        locked: number === 3,
        packages: number === 3 ? [issuedPackage] : [],
        from_base: 2000,
        to_base: 2500,
        from_hardware: null,
        to_hardware: null,
      },
      option_changes: [],
    })),
  }])

  const groups = groupPlanChanges(phases[0])
  assert.equal(groups.length, 2)
  assert.deepEqual(
    groups.map(({ lotCount, locked }) => [lotCount, locked]),
    [[2, false], [1, true]],
  )
})
