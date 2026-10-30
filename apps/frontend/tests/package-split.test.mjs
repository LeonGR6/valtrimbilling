import assert from 'node:assert/strict'
import test from 'node:test'
import { drawSelectionKey } from '../src/features/draw-invoice/utils/drawPackages.js'
import { splitPackageInput } from '../src/features/draw-invoice/utils/finalReleaseSplit.js'
import {
  describeSavedInvoiceSplit,
  packageInvoiceUnits,
  phaseFitsPackageInvoice,
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
