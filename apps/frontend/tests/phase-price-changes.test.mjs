import assert from 'node:assert/strict'
import test from 'node:test'
import {
  affectedDraftPackages,
  affectedIssuedPackages,
  buildPhasePriceRequest,
  groupOptionChanges,
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
  workflow_status: 'AWAITING_PAYMENT',
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
        // Billed in a Package with a QuickBooks invoice: the Package keeps its amount.
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
      workflowStatus: null,
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
      workflowStatus: 'AWAITING_PAYMENT',
    }],
    fromPrice: 50,
    fromNotApplicable: false,
    toPrice: 0,
    toNotApplicable: true,
  })
})

test('everything that changed is offered: Draft Packages recalculate, issued ones keep their amount', () => {
  const [first] = toPhasePriceChanges(serverRows)

  const everything = phaseEligibleChanges(first)
  assert.deepEqual(everything.lots.map((lot) => lot.lotId), [71, 72])
  assert.deepEqual(everything.options.map(({ option }) => option.optionId), [41, 42])
  assert.equal(everything.count, 4)
  assert.deepEqual(
    everything.packages.map((item) => [item.packageNumber, item.recalculable]),
    [['DP-00000005', true], ['DP-00000006', false]],
  )

  const planOnly = phaseEligibleChanges(first, { includeOptions: false })
  assert.equal(planOnly.options.length, 0)
  assert.equal(planOnly.lots.length, 2)

  const optionsOnly = phaseEligibleChanges(first, { includePlan: false })
  assert.equal(optionsOnly.lots.length, 0)
  assert.equal(optionsOnly.options.length, 2)
  // Only the issued Package bills one of those Options; the other is billed nowhere.
  assert.deepEqual(optionsOnly.packages.map((item) => item.packageNumber), ['DP-00000006'])
})

test('the request carries only the picked Phases and the chosen components', () => {
  const phases = toPhasePriceChanges(serverRows)

  assert.deepEqual(
    buildPhasePriceRequest(phases, [21, 22], { includePlan: true, includeOptions: true }),
    {
      lotIds: [71, 72, 81],
      options: [
        { lot_id: 71, option_id: 41 },
        { lot_id: 73, option_id: 42 },
      ],
    },
  )
  assert.deepEqual(
    buildPhasePriceRequest(phases, [22], { includePlan: true, includeOptions: false }),
    { lotIds: [81], options: [] },
  )
  assert.deepEqual(
    buildPhasePriceRequest(phases, [21], { includePlan: false, includeOptions: true }),
    {
      lotIds: [],
      options: [
        { lot_id: 71, option_id: 41 },
        { lot_id: 73, option_id: 42 },
      ],
    },
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

test('the Packages that keep their amount are told apart from the ones recalculated', () => {
  const phases = toPhasePriceChanges(serverRows)
  const both = { includePlan: true, includeOptions: true }

  assert.deepEqual(
    affectedIssuedPackages(phases, [21, 22], both).map((item) => [item.packageNumber, item.workflowStatus]),
    [['DP-00000006', 'AWAITING_PAYMENT']],
  )
  assert.deepEqual(affectedIssuedPackages(phases, [22], both), [])
})

test('the summary counts Phases, prices, Draft Packages, documents and issued Packages', () => {
  const phases = toPhasePriceChanges(serverRows)

  assert.deepEqual(
    summarizePhasePriceRequest(phases, [21, 22], { includePlan: true, includeOptions: true }),
    {
      phaseCount: 2,
      lotCount: 3,
      optionCount: 2,
      packageCount: 1,
      packagesWithDocuments: 1,
      issuedPackageCount: 1,
    },
  )
  // Phase 22 has nothing to change among Options, so it does not count.
  assert.deepEqual(
    summarizePhasePriceRequest(phases, [21, 22], { includePlan: false, includeOptions: true }),
    {
      phaseCount: 1,
      lotCount: 0,
      optionCount: 2,
      packageCount: 0,
      packagesWithDocuments: 0,
      issuedPackageCount: 1,
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

test('Option price changes of a Phase are grouped by Option, so equal changes read once', () => {
  const change = (optionId, from, to) => ({
    option_id: optionId,
    code: `OPT-${optionId}`,
    description: '',
    billed: false,
    locked: false,
    packages: [],
    from_price: from,
    from_na: false,
    to_price: to,
    to_na: false,
  })
  const lot = (number, options) => ({
    lot_id: number,
    lot_number: String(number),
    is_utility_building: false,
    plan_id: 3,
    plan_code: 'A',
    plan_change: null,
    option_changes: options,
  })
  const phases = toPhasePriceChanges([{
    phase_id: 1,
    code: '2B',
    building: null,
    lots: [
      lot(1, [change(10, 300, 350)]),
      lot(2, [change(10, 300, 350), change(11, 50, 60)]),
      lot(3, [change(10, 320, 350)]),
    ],
  }])

  const groups = groupOptionChanges(phases[0])
  assert.deepEqual(
    groups.map(({ code, fromPrice, toPrice, lotCount }) => [code, fromPrice, toPrice, lotCount]),
    [['OPT-10', 300, 350, 2], ['OPT-11', 50, 60, 1], ['OPT-10', 320, 350, 1]],
  )
})
