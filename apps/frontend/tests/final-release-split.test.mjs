import assert from 'node:assert/strict'
import test from 'node:test'
import { drawSelectionKey, hardwareChargeKey } from '../src/features/draw-invoice/utils/drawPackages.js'
import {
  describeSavedPackageSplit,
  finalReleaseSplitScope,
  planFinalReleaseSplit,
  splitPackageInput,
} from '../src/features/draw-invoice/utils/finalReleaseSplit.js'

const JOB_ID = 7
const DRAWS = [{}, {}, {}, {}, {}]

// Job 1317: Phase 3 has two Buildings (the first one is all billed), Phase 4 has four.
function job1317() {
  const lots = (from, count) => Array.from({ length: count }, (_, index) => ({ id: from + index }))
  return {
    id: JOB_ID,
    sequenceSheet: {
      phases: [
        { id: 47, name: '3', building: '1', lots: lots(1, 8) },
        { id: 48, name: '3', building: '2', lots: lots(9, 8) },
        { id: 49, name: '4', building: '3', lots: lots(17, 3) },
        { id: 50, name: '4', building: '4', lots: lots(20, 3) },
        { id: 51, name: '4', building: '5', lots: lots(23, 3) },
        { id: 52, name: '4', building: '6', lots: lots(26, 3) },
      ],
    },
  }
}

const setup = (overrides = {}) => ({
  draws: DRAWS,
  finalReleaseScope: 'PHASE',
  retentionEnabled: false,
  retentionPercentage: 0,
  retentionReleaseScope: 'JOB',
  separateHardwarePrice: false,
  ...overrides,
})

function used(job, billedDraws) {
  const map = new Map()
  for (const phase of job.sequenceSheet.phases) {
    for (const lot of phase.lots) {
      for (const drawIndex of billedDraws[phase.id] ?? []) {
        map.set(drawSelectionKey(job.id, phase.id, lot.id, drawIndex), {})
      }
    }
  }
  return map
}

const cells = (job, phaseId, drawIndex) => job.sequenceSheet.phases
  .find((phase) => phase.id === phaseId)
  .lots.map((lot) => ({ phaseId, lotId: lot.id, drawIndex }))

function suggestion1317() {
  const job = job1317()
  return {
    job,
    // Phase 3 / Building 1 is all billed; Building 2 misses Draw 5; Phase 4 has billed up to Draw 2.
    usedSelections: used(job, {
      47: [0, 1, 2, 3, 4],
      48: [0, 1, 2, 3],
      49: [0, 1, 2, 3],
      50: [0, 1],
      51: [0, 1],
      52: [0, 1],
    }),
    selections: [
      ...cells(job, 48, 4),
      ...cells(job, 50, 2),
      ...cells(job, 51, 2),
      ...cells(job, 52, 2),
    ],
  }
}

test('a Package that finishes Phase 3 and bills Phase 4 needs two Packages', () => {
  const { job, usedSelections, selections } = suggestion1317()
  const plan = planFinalReleaseSplit({ job, schedule: setup(), usedSelections, selections })

  assert.equal(plan.needsSplit, true)
  assert.deepEqual(
    plan.scopes.map(({ label, closes }) => [label, closes]),
    [['Phase 3', true], ['Phase 4', false]],
  )
  // Progress first, then the Final of the Phase that finishes.
  assert.deepEqual(
    plan.groups.map(({ type, label, phaseIds }) => [type, label, phaseIds]),
    [['PROGRESS', 'Phase 4', ['49', '50', '51', '52']], ['FINAL', 'Phase 3', ['47', '48']]],
  )
})

test('a Package that only finishes one Phase, or finishes none, needs no division', () => {
  const { job, usedSelections, selections } = suggestion1317()
  const onlyPhaseThree = selections.filter(({ phaseId }) => phaseId === 48)
  const onlyPhaseFour = selections.filter(({ phaseId }) => phaseId !== 48)

  const final = planFinalReleaseSplit({ job, schedule: setup(), usedSelections, selections: onlyPhaseThree })
  assert.equal(final.needsSplit, false)
  assert.deepEqual(final.groups.map(({ type }) => type), ['FINAL'])

  const progress = planFinalReleaseSplit({ job, schedule: setup(), usedSelections, selections: onlyPhaseFour })
  assert.equal(progress.needsSplit, false)
  assert.deepEqual(progress.groups.map(({ type }) => type), ['PROGRESS'])

  // Part of the last cells of Phase 3 does not finish it.
  const partial = planFinalReleaseSplit({
    job,
    schedule: setup(),
    usedSelections,
    selections: [...onlyPhaseThree.slice(0, 5), ...onlyPhaseFour],
  })
  assert.equal(partial.needsSplit, false)
  assert.equal(partial.scopes.find(({ label }) => label === 'Phase 3').closes, false)
  assert.equal(partial.scopes.find(({ label }) => label === 'Phase 3').remainingAfter, 3)
})

test('every Phase a Package finishes gets its own Package, even with nothing else in it', () => {
  const job = job1317()
  // Phase 4 is billed but for Draw 5; Phase 3 is too.
  const usedSelections = used(job, {
    47: [0, 1, 2, 3, 4],
    48: [0, 1, 2, 3],
    49: [0, 1, 2, 3],
    50: [0, 1, 2, 3],
    51: [0, 1, 2, 3],
    52: [0, 1, 2, 3],
  })
  const selections = [48, 49, 50, 51, 52].flatMap((phaseId) => cells(job, phaseId, 4))
  const plan = planFinalReleaseSplit({ job, schedule: setup(), usedSelections, selections })

  assert.equal(plan.needsSplit, true)
  assert.deepEqual(plan.groups.map(({ type, label }) => [type, label]), [
    ['FINAL', 'Phase 3'],
    ['FINAL', 'Phase 4'],
  ])

  // Two finishing and one still open: the open one is a Package of its own as well.
  const withOpen = planFinalReleaseSplit({
    job,
    schedule: setup(),
    usedSelections: used(job, { 47: [0, 1, 2, 3, 4], 48: [0, 1, 2, 3], 49: [0, 1, 2, 3], 50: [0, 1, 2, 3], 51: [0, 1, 2, 3], 52: [0, 1] }),
    selections: [...cells(job, 48, 4), ...cells(job, 49, 4), ...cells(job, 50, 4), ...cells(job, 51, 4), ...cells(job, 52, 2)],
  })
  // Phase 4 is one scope: Building 6 is still open, so Phase 4 does not finish.
  assert.deepEqual(withOpen.groups.map(({ type, label }) => [type, label]), [
    ['PROGRESS', 'Phase 4'],
    ['FINAL', 'Phase 3'],
  ])
})

test('per Building the division goes by Building', () => {
  const { job, usedSelections, selections } = suggestion1317()
  const plan = planFinalReleaseSplit({
    job,
    schedule: setup({ finalReleaseScope: 'BUILDING' }),
    usedSelections,
    selections,
  })

  // Building 2 of Phase 3 finishes; the Buildings of Phase 4 do not.
  assert.deepEqual(
    plan.groups.map(({ type, label }) => [type, label]),
    [['PROGRESS', 'Phase 4 · Building 4, Phase 4 · Building 5, Phase 4 · Building 6'], ['FINAL', 'Phase 3 · Building 2']],
  )
})

test('no division where the Final Release is per Project, missing, or taken by the Retention Release', () => {
  const { job, usedSelections, selections } = suggestion1317()
  const plan = (schedule) => planFinalReleaseSplit({ job, schedule, usedSelections, selections })

  assert.equal(finalReleaseSplitScope(setup({ finalReleaseScope: 'PROJECT' })), null)
  assert.equal(finalReleaseSplitScope(setup({ finalReleaseScope: '' })), null)
  assert.equal(plan(setup({ finalReleaseScope: 'PROJECT' })).needsSplit, false)
  assert.equal(plan(setup({ finalReleaseScope: '' })).needsSplit, false)

  // Retention released per Building with the Final per Building: the Retention Release is the Final.
  const retentionFinal = setup({
    finalReleaseScope: 'BUILDING',
    retentionEnabled: true,
    retentionPercentage: 10,
    retentionReleaseScope: 'BUILDING',
  })
  assert.equal(finalReleaseSplitScope(retentionFinal), null)
  assert.equal(plan(retentionFinal).needsSplit, false)
  // Retention released per Job does not take the Final of a Phase.
  assert.equal(finalReleaseSplitScope(setup({ retentionEnabled: true, retentionPercentage: 10 })), 'PHASE')
})

test('a setup made before the Final Release option follows the Builder\'s current one', () => {
  const { job, usedSelections, selections } = suggestion1317()
  const legacy = setup({ finalReleaseScope: '' })

  assert.equal(finalReleaseSplitScope(legacy), null)
  assert.equal(finalReleaseSplitScope(legacy, setup({ finalReleaseScope: 'PHASE' })), 'PHASE')
  assert.equal(
    planFinalReleaseSplit({
      job,
      schedule: legacy,
      builderSchedule: setup({ finalReleaseScope: 'PHASE' }),
      usedSelections,
      selections,
    }).needsSplit,
    true,
  )
  // Its own level wins over the Builder's.
  assert.equal(finalReleaseSplitScope(setup({ finalReleaseScope: 'PROJECT' }), setup({ finalReleaseScope: 'PHASE' })), null)
})

test('Separate Hardware that is still to bill keeps a Phase from finishing', () => {
  const { job, usedSelections, selections } = suggestion1317()
  const schedule = setup({
    separateHardwarePrice: true,
    hardwareBillingMode: 'BY_EVENT',
    hardwareEventPercentages: { EXT: 50, DM: 30, HW: 20 },
  })
  const everyHardware = (phaseIds) => job.sequenceSheet.phases
    .filter(({ id }) => phaseIds.includes(id))
    .flatMap((phase) => phase.lots.flatMap((lot) => ['EXT', 'DM', 'HW'].map((eventType) => ({ lotId: lot.id, eventType }))))
  const billedHardwareCharges = new Map(
    everyHardware([47]).map(({ lotId, eventType }) => [hardwareChargeKey(lotId, 'BY_EVENT', eventType), {}]),
  )

  // Phase 3 / Building 2 has its Hardware to bill: its cells alone do not finish Phase 3.
  const without = planFinalReleaseSplit({ job, schedule, usedSelections, billedHardwareCharges, selections })
  assert.equal(without.needsSplit, false)
  assert.equal(without.scopes.find(({ label }) => label === 'Phase 3').closes, false)

  // With that Hardware in the Package, Phase 3 finishes and the Package has to be divided.
  const withHardware = planFinalReleaseSplit({
    job,
    schedule,
    usedSelections,
    billedHardwareCharges,
    selections,
    hardwareCharges: everyHardware([48]),
  })
  assert.equal(withHardware.needsSplit, true)
  assert.deepEqual(withHardware.groups.map(({ type }) => type), ['PROGRESS', 'FINAL'])
})

test('a divided Package sends every cell, Hardware charge and Option with its Phase', () => {
  const { job, usedSelections, selections } = suggestion1317()
  const plan = planFinalReleaseSplit({ job, schedule: setup(), usedSelections, selections })
  const input = {
    jobId: JOB_ID,
    selections,
    hardwareSelections: [
      { phaseId: 48, lotId: 9, drawIndex: 4, eventType: 'EXT' },
      { phaseId: 50, lotId: 20, drawIndex: 2, eventType: 'EXT' },
    ],
    // Lot 9 is in Phase 3, lot 20 in Phase 4.
    optionSelections: [{ lotId: 9, optionId: 1 }, { lotId: 20, optionId: 2 }],
    optionsBillingDrawIndex: 2,
  }

  const { packages, unplacedOptions } = splitPackageInput({ plan, job, input })

  assert.equal(unplacedOptions, 0)
  assert.deepEqual(packages.map(({ group }) => group.type), ['PROGRESS', 'FINAL'])
  const [progress, final] = packages.map(({ input: part }) => part)
  assert.equal(progress.selections.length, 9)
  assert.ok(progress.selections.every(({ phaseId }) => [49, 50, 51, 52].includes(phaseId)))
  assert.equal(final.selections.length, 8)
  assert.ok(final.selections.every(({ phaseId }) => phaseId === 48))
  assert.deepEqual(progress.hardwareSelections.map(({ lotId }) => lotId), [20])
  assert.deepEqual(final.hardwareSelections.map(({ lotId }) => lotId), [9])
  assert.deepEqual(progress.optionSelections, [{ lotId: 20, optionId: 2 }])
  assert.deepEqual(final.optionSelections, [{ lotId: 9, optionId: 1 }])
  assert.equal(final.jobId, JOB_ID)
  assert.equal(final.optionsBillingDrawIndex, 2)
})

test('an Option whose Package has no Draw to bill it with goes with one that does, or is left out', () => {
  const { job, usedSelections, selections } = suggestion1317()
  const plan = planFinalReleaseSplit({ job, schedule: setup(), usedSelections, selections })
  const input = (optionsBillingDrawIndex) => ({
    jobId: JOB_ID,
    selections,
    hardwareSelections: [],
    // Lot 9 (Phase 3) is billed at Draw 5; the Phase 4 cells are at Draw 3.
    optionSelections: [{ lotId: 9, optionId: 1 }],
    optionsBillingDrawIndex,
  })

  // The Options Draw is Draw 5: only Phase 3 reaches it, so its Option stays with Phase 3.
  const own = splitPackageInput({ plan, job, input: input(4) })
  assert.deepEqual(own.packages[1].input.optionSelections, [{ lotId: 9, optionId: 1 }])

  // The Options Draw is Draw 3: both reach it and the Option stays with its own Phase.
  const both = splitPackageInput({ plan, job, input: input(2) })
  assert.deepEqual(both.packages[1].input.optionSelections, [{ lotId: 9, optionId: 1 }])

  // No Package reaches the Options Draw: it cannot be billed now.
  const none = splitPackageInput({ plan, job, input: input(9) })
  assert.equal(none.unplacedOptions, 1)
  assert.deepEqual(none.packages.flatMap(({ input: part }) => part.optionSelections), [])
})

test('a saved Package that finishes a Phase and bills others is reported as needing division', () => {
  const finalRelease = (scopes, extra = {}) => ({
    applicable: true,
    scope: 'PHASE',
    retentionFinal: false,
    scopes,
    ...extra,
  })

  assert.deepEqual(
    describeSavedPackageSplit(finalRelease([
      { label: 'Phase 3', closes: true },
      { label: 'Phase 4', closes: false },
    ])),
    { closing: ['Phase 3'], others: ['Phase 4'] },
  )
  assert.deepEqual(
    describeSavedPackageSplit(finalRelease([
      { label: 'Phase 3', closes: true },
      { label: 'Phase 4', closes: true },
    ])),
    { closing: ['Phase 3', 'Phase 4'], others: [] },
  )
  assert.equal(describeSavedPackageSplit(finalRelease([{ label: 'Phase 3', closes: true }])), null)
  assert.equal(describeSavedPackageSplit(finalRelease([
    { label: 'Phase 3', closes: false },
    { label: 'Phase 4', closes: false },
  ])), null)
  assert.equal(describeSavedPackageSplit(finalRelease([], {})), null)
  assert.equal(describeSavedPackageSplit(finalRelease(
    [{ label: 'A', closes: true }, { label: 'B', closes: false }],
    { scope: 'PROJECT' },
  )), null)
  assert.equal(describeSavedPackageSplit(finalRelease(
    [{ label: 'A', closes: true }, { label: 'B', closes: false }],
    { retentionFinal: true },
  )), null)
  assert.equal(describeSavedPackageSplit(null), null)
})
