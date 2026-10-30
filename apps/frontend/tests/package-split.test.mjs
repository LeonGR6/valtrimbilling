import assert from 'node:assert/strict'
import test from 'node:test'
import { drawSelectionKey } from '../src/features/draw-invoice/utils/drawPackages.js'
import { splitPackageInput } from '../src/features/draw-invoice/utils/finalReleaseSplit.js'
import {
  createPackagesInOrder,
  describeCreatedPackages,
  packageCreator,
} from '../src/features/draw-invoice/utils/createPackagesInOrder.js'
import { optionsPackageAmounts } from '../src/features/draw-invoice/utils/optionsPackage.js'
import {
  describeSavedInvoiceSplit,
  packageInvoiceUnits,
  phaseFitsPackageInvoice,
  planCreatedPackages,
  planOptionsPackages,
  planPackageSplit,
  singleInvoiceScope,
} from '../src/features/draw-invoice/utils/packageSplit.js'

const JOB_ID = 7
const DRAWS = [{}, {}, {}, {}, {}]

// Phase 3 has two Buildings, Phase 4 has four and Phase 5 has one.
function job() {
  const lots = (from, count) => Array.from({ length: count }, (_, index) => ({ id: from + index }))
  return {
    id: JOB_ID,
    sequenceSheet: {
      phases: [
        { id: 47, name: '3', building: '1', lots: lots(1, 4) },
        { id: 48, name: '3', building: '2', lots: lots(9, 4) },
        { id: 49, name: '4', building: '3', lots: lots(17, 3) },
        { id: 50, name: '4', building: '4', lots: lots(20, 3) },
        { id: 51, name: '4', building: '5', lots: lots(23, 3) },
        { id: 52, name: '4', building: '6', lots: lots(26, 3) },
        { id: 53, name: '5', building: '7', lots: lots(31, 2) },
      ],
    },
  }
}

const setup = (overrides = {}) => ({
  draws: DRAWS,
  singleInvoiceScope: 'PHASE',
  finalReleaseScope: 'PHASE',
  retentionEnabled: false,
  retentionPercentage: 0,
  retentionReleaseScope: 'JOB',
  separateHardwarePrice: false,
  ...overrides,
})

const cells = (phaseId, drawIndex) => job().sequenceSheet.phases
  .find((phase) => phase.id === phaseId)
  .lots.map((lot) => ({ phaseId, lotId: lot.id, drawIndex }))

function used(billedDraws) {
  const map = new Map()
  for (const phase of job().sequenceSheet.phases) {
    for (const lot of phase.lots) {
      for (const drawIndex of billedDraws[phase.id] ?? []) {
        map.set(drawSelectionKey(JOB_ID, phase.id, lot.id, drawIndex), {})
      }
    }
  }
  return map
}

test('the single invoice level is Phase or Building, and nothing else', () => {
  assert.equal(singleInvoiceScope({ singleInvoiceScope: 'PHASE' }), 'PHASE')
  assert.equal(singleInvoiceScope({ singleInvoiceScope: 'BUILDING' }), 'BUILDING')
  assert.equal(singleInvoiceScope({ singleInvoiceScope: '' }), null)
  assert.equal(singleInvoiceScope({ singleInvoiceScope: 'PROJECT' }), null)
  assert.equal(singleInvoiceScope({}), null)
  assert.equal(singleInvoiceScope(null), null)
})

test('per Phase, a selection of three Phases needs three Packages', () => {
  const plan = planPackageSplit({
    job: job(),
    schedule: setup({ finalReleaseScope: '' }),
    selections: [...cells(47, 0), ...cells(49, 0), ...cells(53, 0)],
  })

  assert.equal(plan.invoiceScope, 'PHASE')
  assert.equal(plan.needsSplit, true)
  assert.deepEqual(
    plan.groups.map(({ label, phaseIds }) => [label, phaseIds]),
    [['Phase 3', ['47', '48']], ['Phase 4', ['49', '50', '51', '52']], ['Phase 5', ['53']]],
  )
})

test('per Phase, the Buildings of one Phase stay in one Package', () => {
  const plan = planPackageSplit({
    job: job(),
    schedule: setup(),
    selections: [...cells(49, 0), ...cells(50, 0), ...cells(51, 0), ...cells(52, 0)],
  })

  assert.equal(plan.needsSplit, false)
  assert.equal(plan.groups.length, 1)
  assert.equal(plan.groups[0].label, 'Phase 4')
})

test('per Building, each Building is a Package of its own', () => {
  const plan = planPackageSplit({
    job: job(),
    schedule: setup({ singleInvoiceScope: 'BUILDING', finalReleaseScope: '' }),
    selections: [...cells(49, 0), ...cells(50, 0), ...cells(53, 0)],
  })

  assert.equal(plan.invoiceScope, 'BUILDING')
  assert.equal(plan.needsSplit, true)
  assert.deepEqual(plan.groups.map(({ phaseIds }) => phaseIds), [['49'], ['50'], ['53']])
  assert.deepEqual(plan.groups.map(({ scopeKeys }) => scopeKeys), [['building:49'], ['building:50'], ['building:53']])
})

test('a Phase with nothing selected is not a Package', () => {
  const plan = planPackageSplit({
    job: job(),
    schedule: setup(),
    selections: cells(49, 0),
    hardwareCharges: [],
  })

  assert.equal(plan.needsSplit, false)
  assert.deepEqual(plan.groups.map(({ phaseIds }) => phaseIds), [['49', '50', '51', '52']])
})

test('with a Final Release per Phase, the Package that finishes a Phase is the Final one', () => {
  // Phase 3 is billed but for Draw 5 of both Buildings; Phase 4 has more to bill.
  const usedSelections = used({ 47: [0, 1, 2, 3], 48: [0, 1, 2, 3], 49: [0, 1], 50: [0, 1], 51: [0, 1], 52: [0, 1] })
  const plan = planPackageSplit({
    job: job(),
    schedule: setup(),
    usedSelections,
    selections: [...cells(47, 4), ...cells(48, 4), ...cells(49, 2), ...cells(50, 2)],
  })

  assert.deepEqual(
    plan.groups.map(({ label, type }) => [label, type]),
    [['Phase 3', 'FINAL'], ['Phase 4', 'PROGRESS']],
  )
})

test('per Building with a Final Release per Phase, the last Building made finishes the Phase', () => {
  const usedSelections = used({ 47: [0, 1, 2, 3], 48: [0, 1, 2, 3] })
  const plan = planPackageSplit({
    job: job(),
    schedule: setup({ singleInvoiceScope: 'BUILDING' }),
    usedSelections,
    selections: [...cells(47, 4), ...cells(48, 4)],
  })

  // The first Building leaves the other one open; the second one finishes the Phase.
  assert.deepEqual(plan.groups.map(({ type }) => type), ['PROGRESS', 'FINAL'])
})

test('without a Final Release the Packages have no Release type', () => {
  const plan = planPackageSplit({
    job: job(),
    schedule: setup({ finalReleaseScope: '' }),
    selections: [...cells(47, 0), ...cells(49, 0)],
  })

  assert.deepEqual(plan.groups.map(({ type }) => type), [null, null])
})

test('without a single invoice the Final Release decides, as before', () => {
  const usedSelections = used({ 47: [0, 1, 2, 3], 48: [0, 1, 2, 3], 49: [0, 1], 50: [0, 1], 51: [0, 1], 52: [0, 1] })
  const plan = planPackageSplit({
    job: job(),
    schedule: setup({ singleInvoiceScope: '' }),
    usedSelections,
    selections: [...cells(47, 4), ...cells(48, 4), ...cells(49, 2)],
  })

  assert.equal(plan.invoiceScope, null)
  assert.equal(plan.finalScope, 'PHASE')
  // Progress first, then the Final of the Phase that finishes.
  assert.deepEqual(plan.groups.map(({ type, label }) => [type, label]), [['PROGRESS', 'Phase 4'], ['FINAL', 'Phase 3']])

  const together = planPackageSplit({
    job: job(),
    schedule: setup({ singleInvoiceScope: '', finalReleaseScope: '' }),
    selections: [...cells(47, 0), ...cells(53, 0)],
  })
  assert.equal(together.needsSplit, false)
})

test('a divided Package sends each cell and Hardware charge with its Phase', () => {
  const selections = [...cells(47, 0), ...cells(49, 0), ...cells(53, 0)]
  const hardwareSelections = [{ phaseId: 49, lotId: 17, drawIndex: 0, eventType: 'HW' }]
  const plan = planPackageSplit({ job: job(), schedule: setup({ finalReleaseScope: '' }), selections, hardwareCharges: hardwareSelections })
  const split = splitPackageInput({
    plan,
    job: job(),
    input: { jobId: JOB_ID, selections, hardwareSelections, optionSelections: [], optionsBillingDrawIndex: null },
  })

  assert.equal(split.packages.length, 3)
  assert.deepEqual(
    split.packages.map(({ input }) => input.selections.map(({ phaseId }) => phaseId)),
    [[47, 47, 47, 47], [49, 49, 49], [53, 53]],
  )
  assert.deepEqual(split.packages.map(({ input }) => input.hardwareSelections.length), [0, 1, 0])
})

test('every Package of a division carries the note that was written', () => {
  const selections = [...cells(47, 0), ...cells(49, 0), ...cells(53, 0)]
  const plan = planPackageSplit({ job: job(), schedule: setup({ finalReleaseScope: '' }), selections })
  const split = splitPackageInput({
    plan,
    job: job(),
    input: {
      jobId: JOB_ID,
      selections,
      hardwareSelections: [],
      optionSelections: [],
      optionsBillingDrawIndex: null,
      notes: 'Builder asked for one invoice per Phase.',
    },
  })

  assert.equal(split.packages.length, 3)
  assert.deepEqual(
    split.packages.map(({ input }) => input.notes),
    Array(3).fill('Builder asked for one invoice per Phase.'),
  )
})

test('a Hardware charge alone makes its Phase part of the selection', () => {
  const plan = planPackageSplit({
    job: job(),
    schedule: setup({ finalReleaseScope: '' }),
    selections: cells(47, 0),
    hardwareCharges: [{ lotId: 31, eventType: 'HW' }],
  })

  assert.deepEqual(plan.groups.map(({ label }) => label), ['Phase 3', 'Phase 5'])
})

test('nothing is planned without a Job', () => {
  const plan = planPackageSplit({ job: null, schedule: setup(), selections: [] })
  assert.deepEqual(plan.groups, [])
  assert.equal(plan.needsSplit, false)
})

test('what a saved Package covers is read by Phase or by Building', () => {
  const phases = job().sequenceSheet.phases
  const phase = (id) => phases.find((candidate) => candidate.id === id)

  assert.equal(packageInvoiceUnits(setup({ singleInvoiceScope: '' }), job(), [47]), null)

  const perPhase = packageInvoiceUnits(setup(), job(), [49, 50])
  assert.equal(perPhase.scope, 'PHASE')
  assert.deepEqual([...perPhase.units.values()], ['Phase 4'])
  // Another Building of the same Phase fits, another Phase does not.
  assert.equal(phaseFitsPackageInvoice(perPhase, phase(51)), true)
  assert.equal(phaseFitsPackageInvoice(perPhase, phase(47)), false)

  const perBuilding = packageInvoiceUnits(setup({ singleInvoiceScope: 'BUILDING' }), job(), [49])
  assert.equal(phaseFitsPackageInvoice(perBuilding, phase(49)), true)
  assert.equal(phaseFitsPackageInvoice(perBuilding, phase(50)), false)

  // Without a single invoice anything fits.
  assert.equal(phaseFitsPackageInvoice(null, phase(47)), true)
})

test('a saved Package that bills several Phases is reported when the Builder takes a single invoice', () => {
  assert.equal(describeSavedInvoiceSplit(setup(), job(), [49, 50, 51]), null)
  assert.equal(describeSavedInvoiceSplit(setup({ singleInvoiceScope: '' }), job(), [47, 49]), null)

  const mixed = describeSavedInvoiceSplit(setup(), job(), [47, 49, 53])
  assert.deepEqual(mixed, { scope: 'PHASE', labels: ['Phase 3', 'Phase 4', 'Phase 5'] })

  // Per Building the Buildings of one Phase are already several invoices.
  assert.equal(describeSavedInvoiceSplit(setup({ singleInvoiceScope: 'BUILDING' }), job(), [49, 50]).labels.length, 2)
})

test('each Package of a division has only the cells that were chosen of its Building', () => {
  const selections = [
    { phaseId: 49, lotId: 17, drawIndex: 0 },
    { phaseId: 49, lotId: 17, drawIndex: 1 },
    { phaseId: 50, lotId: 20, drawIndex: 0 },
  ]
  const schedule = setup({ singleInvoiceScope: 'BUILDING', finalReleaseScope: '' })
  const plan = planPackageSplit({ job: job(), schedule, selections })
  const split = splitPackageInput({
    plan,
    job: job(),
    input: { jobId: JOB_ID, selections, hardwareSelections: [], optionSelections: [], optionsBillingDrawIndex: null },
  })

  assert.equal(plan.needsSplit, true)
  assert.deepEqual(
    split.packages.map(({ group, input }) => [group.phaseIds, input.selections.map(({ lotId, drawIndex }) => [lotId, drawIndex])]),
    [[['49'], [[17, 0], [17, 1]]], [['50'], [[20, 0]]]],
  )
})

test('a selection inside one Building is a single Package, whatever the Builder asks', () => {
  const selections = [{ phaseId: 49, lotId: 17, drawIndex: 2 }]
  const plan = planPackageSplit({
    job: job(),
    schedule: setup({ singleInvoiceScope: 'BUILDING', finalReleaseScope: '' }),
    selections,
  })

  assert.equal(plan.needsSplit, false)
  assert.equal(plan.groups.length, 1)
})

test('an Option goes on the invoice of its own Building and never on another one', () => {
  const selections = [
    { phaseId: 49, lotId: 17, drawIndex: 1 },
    { phaseId: 50, lotId: 20, drawIndex: 0 },
  ]
  const optionSelections = [{ lotId: 17, optionId: 1 }, { lotId: 20, optionId: 2 }]
  const input = { jobId: JOB_ID, selections, hardwareSelections: [], optionSelections, optionsBillingDrawIndex: 1 }

  const single = splitPackageInput({
    plan: planPackageSplit({
      job: job(),
      schedule: setup({ singleInvoiceScope: 'BUILDING', finalReleaseScope: '' }),
      selections,
    }),
    job: job(),
    input,
  })
  assert.deepEqual(single.packages.map(({ input: part }) => part.optionSelections.map(({ optionId }) => optionId)), [[1], []])
  assert.equal(single.unplacedOptions, 1, 'the Option of the Building without a Draw to carry it is left out')
  assert.deepEqual(single.unplaced, [{ lotId: 20, optionId: 2 }], 'and is listed, to be billed on its own')

  // With a Final Release division only, an Option may go with the first Package that can carry it.
  const finalOnly = splitPackageInput({
    plan: { groups: [{ phaseIds: ['49'] }, { phaseIds: ['50'] }] },
    job: job(),
    input,
  })
  assert.deepEqual(finalOnly.packages.map(({ input: part }) => part.optionSelections.map(({ optionId }) => optionId)), [[1, 2], []])
  assert.equal(finalOnly.unplacedOptions, 0)
})

test('the Packages of a division are created in order and told apart when one fails', async () => {
  const made = []
  const create = async (input) => {
    if (input.fail) throw new Error('Draw 2 is already billed.')
    const record = { packageNumber: `PKG-${made.length + 1}`, ...input }
    made.push(record)
    return record
  }

  const all = await createPackagesInOrder(create, [{ id: 'a' }, { id: 'b' }])
  assert.deepEqual(all.created.map(({ id }) => id), ['a', 'b'])
  assert.equal(all.error, null)
  assert.deepEqual(describeCreatedPackages(all), { severity: 'success', message: 'Created PKG-1, PKG-2.' })

  made.length = 0
  const partial = await createPackagesInOrder(create, [{ id: 'a' }, { fail: true }, { id: 'c' }])
  assert.deepEqual(partial.created.map(({ id }) => id), ['a'], 'the ones after the failure are not tried')
  assert.equal(partial.error.message, 'Draw 2 is already billed.')
  assert.match(describeCreatedPackages(partial).message, /^PKG-1 was created, but the next Package could not be: Draw 2 is already billed\./u)
  assert.equal(describeCreatedPackages(partial).severity, 'error')

  await assert.rejects(createPackagesInOrder(create, [{ fail: true }, { id: 'b' }]), /already billed/u)
})

const optionPick = (lotId, optionId) => ({ lotId, optionId })

test('Options with no Draw to ride on are billed on a Package of their own, one for each Building', () => {
  const schedule = setup({ singleInvoiceScope: 'BUILDING', finalReleaseScope: '' })
  const packages = planOptionsPackages({
    job: job(),
    schedule,
    // Lots 20 and 21 are in Building 4, lot 17 in Building 3: given out of order on purpose.
    optionSelections: [optionPick(20, 2), optionPick(17, 1), optionPick(21, 3), optionPick(20, 2)],
    notes: 'late options',
  })

  assert.deepEqual(packages.map(({ kind }) => kind), ['OPTIONS', 'OPTIONS'])
  assert.deepEqual(packages.map(({ group }) => group.phaseIds), [['49'], ['50']], 'in the order of the Job')
  assert.deepEqual(
    packages.map(({ input }) => input.optionSelections.map(({ lotId, optionId }) => `${lotId}:${optionId}`)),
    [['17:1'], ['20:2', '21:3']],
    'an Option picked twice is billed once',
  )
  assert.ok(packages.every(({ input }) => input.kind === 'OPTIONS' && input.jobId === JOB_ID && input.notes === 'late options'))
})

test('a Builder with no single invoice gets one Options Package for all of them', () => {
  const packages = planOptionsPackages({
    job: job(),
    schedule: setup({ singleInvoiceScope: '' }),
    optionSelections: [optionPick(17, 1), optionPick(20, 2)],
  })

  assert.equal(packages.length, 1)
  assert.deepEqual(packages[0].group.phaseIds.sort(), ['49', '50'])
  assert.equal(packages[0].input.optionSelections.length, 2)
  assert.deepEqual(planOptionsPackages({ job: job(), schedule: setup(), optionSelections: [] }), [])
})

test('an Option added after its Phase was billed gets its own Package while the other Phase bills a Draw', () => {
  // Per Phase: Phase 3 (lots 1-8) has everything billed but a new Option; Phase 4 bills Draw 2.
  const schedule = setup({ singleInvoiceScope: 'PHASE', finalReleaseScope: '' })
  const selections = [{ phaseId: 49, lotId: 17, drawIndex: 1 }]
  const input = {
    jobId: JOB_ID,
    selections,
    hardwareSelections: [],
    // The Option of Phase 3 is included in the table, and Draw #2 is the Options Draw.
    optionSelections: [optionPick(1, 9), optionPick(17, 4)],
    optionsBillingDrawIndex: 1,
    notes: '',
  }
  const created = planCreatedPackages({
    job: job(),
    schedule,
    splitPlan: planPackageSplit({ job: job(), schedule, selections }),
    input,
  })

  assert.deepEqual(created.map(({ kind }) => kind), ['DRAW', 'OPTIONS'], 'Draw Packages first')
  assert.deepEqual(created[0].input.optionSelections, [optionPick(17, 4)], 'its own Option rides on its Draw')
  assert.deepEqual(created[1].input.optionSelections, [optionPick(1, 9)], 'the other Phase keeps its Option off this invoice')
  assert.deepEqual(created[1].group.phaseIds, ['47'], 'the Phase the Option is in')
  assert.equal(created[1].group.label, 'Phase 3')
})

test('without a single invoice the Options ride on the Draw Package, as before', () => {
  const schedule = setup({ singleInvoiceScope: '', finalReleaseScope: '' })
  const selections = [{ phaseId: 49, lotId: 17, drawIndex: 1 }]
  const input = {
    jobId: JOB_ID,
    selections,
    hardwareSelections: [],
    optionSelections: [optionPick(1, 9), optionPick(17, 4)],
    optionsBillingDrawIndex: 1,
  }
  const created = planCreatedPackages({
    job: job(),
    schedule,
    splitPlan: planPackageSplit({ job: job(), schedule, selections }),
    input,
  })

  assert.equal(created.length, 1)
  assert.equal(created[0].kind, 'DRAW')
  assert.equal(created[0].input, input, 'the input is not touched')
})

test('Options asked to be billed alone are a Package of their own, with or without a Draw Package', () => {
  const schedule = setup({ singleInvoiceScope: '', finalReleaseScope: '' })
  const empty = { jobId: JOB_ID, selections: [], hardwareSelections: [], optionSelections: [], optionsBillingDrawIndex: 1, notes: 'n' }

  const alone = planCreatedPackages({
    job: job(),
    schedule,
    splitPlan: planPackageSplit({ job: job(), schedule }),
    input: empty,
    ownOptions: [optionPick(1, 9)],
  })
  assert.deepEqual(alone.map(({ kind }) => kind), ['OPTIONS'])
  assert.equal(alone[0].input.notes, 'n')

  const selections = [{ phaseId: 49, lotId: 17, drawIndex: 0 }]
  const both = planCreatedPackages({
    job: job(),
    schedule,
    splitPlan: planPackageSplit({ job: job(), schedule, selections }),
    input: { ...empty, selections },
    ownOptions: [optionPick(1, 9)],
  })
  assert.deepEqual(both.map(({ kind }) => kind), ['DRAW', 'OPTIONS'])

  assert.deepEqual(planCreatedPackages({
    job: job(),
    schedule,
    splitPlan: planPackageSplit({ job: job(), schedule }),
    input: empty,
  }), [], 'nothing chosen, nothing to create')
})

test('each input is created with the function of its kind', async () => {
  const calls = []
  const create = packageCreator({
    createDraw: async (input) => { calls.push(['draw', input.id]); return { packageNumber: 'DP' } },
    createOptions: async (input) => { calls.push(['options', input.id]); return { packageNumber: 'OP' } },
  })

  const result = await createPackagesInOrder(create, [{ id: 1 }, { id: 2, kind: 'OPTIONS' }])
  assert.deepEqual(calls, [['draw', 1], ['options', 2]])
  assert.deepEqual(result.created.map(({ packageNumber }) => packageNumber), ['DP', 'OP'])
})

test('an Options Package takes retention and WRAP Option by Option, like the database', () => {
  const schedule = { retentionEnabled: true, retentionPercentage: 5, ocipWrapEnabled: true, ocipWrapPercentage: 1.5 }

  // 0.30 at 5% is 0.015 -> 0.02 each; two of them are 0.04, not 0.03 of a 0.60 total.
  const rounded = optionsPackageAmounts([{ price: 0.3 }, { price: 0.3 }], schedule)
  assert.deepEqual(rounded, { gross: 0.6, retention: 0.04, wrap: 0, net: 0.56 })

  assert.deepEqual(
    optionsPackageAmounts([{ price: 1000 }, { price: 1250 }, { price: 750 }], schedule),
    { gross: 3000, retention: 150, wrap: 45, net: 2805 },
  )
  assert.deepEqual(optionsPackageAmounts([{ price: 100 }], {}), { gross: 100, retention: 0, wrap: 0, net: 100 })
  // A credit takes back its own share of the retention.
  assert.deepEqual(optionsPackageAmounts([{ price: 1000 }, { price: -200 }], schedule), {
    gross: 800, retention: 40, wrap: 12, net: 748,
  })
})
