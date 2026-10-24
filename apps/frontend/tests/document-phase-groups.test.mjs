import assert from 'node:assert/strict'
import test from 'node:test'
import {
  jobPhaseList,
  matchesDocumentFilter,
  paymentScheduleGroups,
  phaseKey,
  phaseLabel,
  purchaseOrderGroups,
  schedulePhaseCoverage,
  summarizeSection,
} from '../src/features/draw-invoice/utils/documentPhaseGroups.js'

const job = (...phases) => ({
  sequenceSheet: { phases: phases.map(([id, name, building = '']) => ({ id, name, building })) },
})
const doc = (id, name = `${id}.pdf`, extra = {}) => ({ id, name, isComplete: true, ...extra })

test('phases compare by code, and read as "Phase 3" or by their name', () => {
  assert.equal(phaseKey('Phase 003'), '3')
  assert.equal(phaseKey('003'), '3')
  assert.equal(phaseKey('models'), 'MODELS')
  assert.equal(phaseLabel('003'), 'Phase 3')
  assert.equal(phaseLabel('MODELS'), 'Models')
  assert.equal(phaseLabel('2B'), 'Phase 2B')
  assert.equal(phaseLabel(''), 'Phase')
})

test('a Job lists each Phase once, even when it has several buildings', () => {
  const phases = jobPhaseList(job([5, 'MODELS'], [1, '1', '2'], [2, '1', '3'], [3, '3']))

  assert.deepEqual(phases.map(({ key, label }) => [key, label]), [
    ['MODELS', 'Models'],
    ['1', 'Phase 1'],
    ['3', 'Phase 3'],
  ])
  assert.deepEqual(phases[1].ids, [1, 2])
  assert.deepEqual(jobPhaseList(undefined), [])
})

const phases = jobPhaseList(job([5, 'MODELS'], [1, '1'], [3, '3']))

test('a Purchase Order goes to the Phase of its lots, and is repeated in each Phase it touches', () => {
  const documents = [doc('a', 'LOT 27.pdf'), doc('b', 'LOT 3-14.pdf')]
  const { groups, unassigned } = purchaseOrderGroups({
    documents,
    phases,
    analyses: {
      a: { id: 'A', status: 'analyzed' },
      b: { id: 'B', status: 'analyzed' },
    },
    lotsByAnalysis: new Map([
      ['A', [{ phaseId: 5, lotRaw: '27' }]],
      // One PDF with lots of two Phases.
      ['B', [{ phaseId: 1, lotRaw: '3' }, { phaseId: 3, lotRaw: '14' }]],
    ]),
    comparison: [
      { documentId: 'a', phaseId: 5, status: 'PRICE_DIFF' },
      { documentId: 'a', phaseId: 5, status: 'MATCH' },
      { documentId: 'b', phaseId: 1, status: 'MATCH' },
      { documentId: 'b', phaseId: 3, status: 'MATCH' },
    ],
  })

  assert.deepEqual(unassigned, [])
  assert.deepEqual(groups.map(({ label }) => label), ['Models', 'Phase 1', 'Phase 3'])
  assert.deepEqual(groups.map(({ placements }) => placements.map(({ document }) => document.id)), [
    ['a'], ['b'], ['b'],
  ])
  assert.deepEqual(groups[1].placements[0].alsoIn, ['Phase 3'])
  assert.deepEqual(groups[2].placements[0].alsoIn, ['Phase 1'])
  assert.equal(groups[0].statusLabel, '1 to review')
  assert.equal(groups[0].status, 'attention')
  assert.equal(groups[1].statusLabel, 'All match')
  assert.match(groups[0].meta, /1 purchase order, lots 27$/)
})

test('a Purchase Order whose Phase cannot be told says why', () => {
  const documents = [
    doc('new'), doc('busy'), doc('bad'), doc('notpo'), doc('lost'),
  ]
  const { groups, unassigned } = purchaseOrderGroups({
    documents,
    phases,
    analyses: {
      busy: { id: 'B', status: 'analyzing' },
      bad: { id: 'C', status: 'failed' },
      notpo: { id: 'D', status: 'not_option_po' },
      lost: { id: 'E', status: 'analyzed' },
    },
    lotsByAnalysis: new Map([['E', [{ phaseId: null, lotRaw: '99' }, { phaseId: 777, lotRaw: '5' }]]]),
  })

  assert.equal(groups.length, 0)
  assert.deepEqual(unassigned.map(({ document, reason }) => [document.id, reason]), [
    ['new', 'Not analyzed yet'],
    ['busy', 'Analyzing…'],
    ['bad', 'The analysis failed'],
    ['notpo', 'Not a Purchase Order of options'],
    ['lost', 'Its lot is not in this Job'],
  ])
})

test('a confirmed Payment Schedule covers the Phases of its cells', () => {
  const template = {
    status: 'confirmed',
    mapping: { cells: [{ phase: 'MODELS', lot: '0001' }, { phase: 'MODELS', lot: '0002' }, { phase: '3', lot: '0014' }] },
  }
  const coverage = schedulePhaseCoverage(template, phases)

  assert.deepEqual([...coverage.lots.keys()], ['MODELS', '3'])
  assert.deepEqual([...coverage.lots.get('MODELS')], ['0001', '0002'])
  assert.equal(coverage.unmatched, 0)
})

test('an unconfirmed Payment Schedule uses the Phase suggested for the one printed', () => {
  const template = {
    status: 'needs_review',
    detectedCells: [{ phase: 'MDL', lot: '0001' }, { phase: '003', lot: '0014' }, { phase: 'ZZZ', lot: '9' }],
  }
  const coverage = schedulePhaseCoverage(template, phases)

  assert.deepEqual([...coverage.lots.keys()], ['MODELS', '3'])
  assert.equal(coverage.unmatched, 1)
  assert.equal(coverage.unknownPhase, 'ZZZ')
})

test('a schedule that prints no Phase belongs to the only Phase of a Job that has one', () => {
  const template = { status: 'needs_review', detectedCells: [{ phase: null, lot: '01' }] }

  assert.deepEqual([...schedulePhaseCoverage(template, jobPhaseList(job([1, '2']))).lots.keys()], ['2'])
  assert.equal(schedulePhaseCoverage(template, phases).lots.size, 0)
  assert.equal(schedulePhaseCoverage(template, phases).unmatched, 1)
})

test('every Phase is listed for Payment Schedules, with the ones that have none', () => {
  const documents = [doc('a'), doc('b')]
  const { groups, unassigned } = paymentScheduleGroups({
    documents,
    phases,
    templates: {
      a: { status: 'confirmed', mapping: { cells: [{ phase: 'MODELS', lot: '0001' }] } },
      b: { status: 'needs_review', detectedCells: [{ phase: '003', lot: '0014' }, { phase: '003', lot: '0015' }] },
    },
  })

  assert.deepEqual(unassigned, [])
  assert.deepEqual(groups.map(({ label, status }) => [label, status]), [
    ['Models', 'ok'],
    ['Phase 1', 'missing'],
    ['Phase 3', 'attention'],
  ])
  assert.equal(groups[1].empty, true)
  assert.equal(groups[1].meta, 'No payment schedule yet')
  assert.equal(groups[2].statusLabel, 'Needs review')
  assert.match(groups[2].meta, /1 schedule, lots 14–15$/)
})

test('a schedule that covers several Phases is listed in each, and says where else it is', () => {
  const { groups } = paymentScheduleGroups({
    documents: [doc('all', 'Everything.pdf')],
    phases,
    templates: {
      all: {
        status: 'confirmed',
        mapping: { cells: [{ phase: 'MODELS', lot: '1' }, { phase: '1', lot: '2' }, { phase: '3', lot: '3' }] },
      },
    },
  })

  assert.deepEqual(groups.map(({ placements }) => placements.length), [1, 1, 1])
  assert.deepEqual(groups[0].placements[0].alsoIn, ['Phase 1', 'Phase 3'])
  assert.equal(groups.every(({ empty }) => !empty), true)
})

test('a schedule that cannot be placed says why, and a Job without Phases lists them plainly', () => {
  const { unassigned } = paymentScheduleGroups({
    documents: [doc('x'), doc('y'), doc('z'), doc('w')],
    phases,
    templates: {
      x: { status: 'needs_review', detectedCells: [{ phase: null, lot: '1' }] },
      y: { status: 'needs_review', detectedCells: [{ phase: 'ZZZ', lot: '1' }] },
      z: { status: 'failed' },
    },
  })

  assert.deepEqual(unassigned.map(({ document, reason }) => [document.id, reason]), [
    ['x', 'It prints no Phase. Choose one when you review it'],
    ['y', 'Its Phase (ZZZ) is not in this Job'],
    ['z', 'The analysis failed'],
    ['w', 'Not analyzed yet'],
  ])

  const flat = paymentScheduleGroups({
    documents: [doc('a'), doc('b')],
    phases: [],
    templates: { a: { status: 'confirmed' }, b: { status: 'needs_review' } },
  })
  assert.equal(flat.flat, true)
  assert.equal(flat.review, 1)
})

test('a section says its state: green, amber, red for a missing required one, gray when optional and empty', () => {
  const empty = { documents: [] }

  assert.equal(summarizeSection({ type: 'backup', required: true, ...empty }).tone, 'missing')
  assert.equal(summarizeSection({ type: 'backup', required: false, ...empty }).tone, 'idle')
  assert.equal(summarizeSection({ type: 'backup', required: false, documents: [doc('a')] }).tone, 'ok')

  assert.equal(summarizeSection({ type: 'preliminary-notice', required: true, documents: [doc('n')] }).badge.label, 'Complete')
  assert.equal(
    summarizeSection({ type: 'preliminary-notice', required: true, documents: [doc('n', 'n', { isComplete: false })] }).badge.label,
    'Incomplete',
  )

  const release = summarizeSection({
    type: 'release',
    required: true,
    documents: [doc('r1'), doc('r2')],
    releaseTemplates: { r1: { status: 'confirmed' }, r2: { status: 'needs_review' } },
  })
  assert.deepEqual([release.tone, release.badge.label], ['attention', '1 to review'])
})

test('the Payment Schedule section reads coverage first, then what needs review', () => {
  const groupsOf = (templates, documents) => paymentScheduleGroups({ documents, phases, templates })
  const ready = { status: 'confirmed', mapping: { cells: [{ phase: 'MODELS', lot: '1' }, { phase: '1', lot: '2' }, { phase: '3', lot: '3' }] } }
  const part = { status: 'confirmed', mapping: { cells: [{ phase: 'MODELS', lot: '1' }] } }

  const all = summarizeSection({
    type: 'payment-schedule', required: false, documents: [doc('a')], scheduleGroups: groupsOf({ a: ready }, [doc('a')]),
  })
  assert.deepEqual([all.tone, all.badge.label, all.summary], ['ok', 'Ready', '3 of 3 phases covered'])

  const some = summarizeSection({
    type: 'payment-schedule', required: false, documents: [doc('a')], scheduleGroups: groupsOf({ a: part }, [doc('a')]),
  })
  assert.deepEqual([some.tone, some.badge.label, some.summary], ['attention', '2 phases without one', '1 of 3 phases covered'])

  const lost = summarizeSection({
    type: 'payment-schedule', required: false, documents: [doc('a')], scheduleGroups: groupsOf({}, [doc('a')]),
  })
  assert.equal(lost.badge.label, '1 not matched')
})

test('the Purchase Order section counts what needs a look, including what is not placed', () => {
  const grouped = purchaseOrderGroups({
    documents: [doc('a'), doc('b')],
    phases,
    analyses: { a: { id: 'A', status: 'analyzed' } },
    lotsByAnalysis: new Map([['A', [{ phaseId: 5, lotRaw: '27' }]]]),
    comparison: [{ documentId: 'a', phaseId: 5, status: 'MATCH' }],
  })
  const section = summarizeSection({
    type: 'purchase-order', required: false, documents: [doc('a'), doc('b')], purchaseOrderGroups: grouped,
  })

  // One matches; the other was never analyzed.
  assert.deepEqual([section.tone, section.badge.label], ['attention', '1 to review'])
  assert.equal(section.summary, '2 purchase orders in 1 phase')

  const clean = summarizeSection({
    type: 'purchase-order',
    required: false,
    documents: [doc('a')],
    purchaseOrderGroups: purchaseOrderGroups({
      documents: [doc('a')], phases, analyses: { a: { id: 'A', status: 'analyzed' } },
      lotsByAnalysis: new Map([['A', [{ phaseId: 5, lotRaw: '27' }]]]),
      comparison: [{ documentId: 'a', phaseId: 5, status: 'MATCH' }],
    }),
  })
  assert.deepEqual([clean.tone, clean.badge.label], ['ok', 'All match'])
})

test('the file filter looks at the name and the lots', () => {
  const file = doc('a', 'LOT 27 REVISED.pdf')

  assert.equal(matchesDocumentFilter(file, ['27'], ''), true)
  assert.equal(matchesDocumentFilter(file, ['27'], 'revised'), true)
  assert.equal(matchesDocumentFilter(file, ['28'], '28'), true)
  assert.equal(matchesDocumentFilter(file, ['28'], 'nothing'), false)
})

// Job 1319: Phase 1 in two buildings (Lots 1-9 and 17-25) and Phase 2 (Lots 10-16).
const lotsOf = (...numbers) => numbers.map((lotNumber) => ({ lotNumber: String(lotNumber) }))
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index)
const jobWithLots = () => ({
  sequenceSheet: {
    phases: [
      { id: 1, name: '1', building: '2', lots: lotsOf(...range(1, 9)) },
      { id: 3, name: '2', building: '1', lots: lotsOf(...range(10, 16)) },
      { id: 2, name: '1', building: '3', lots: lotsOf(...range(17, 25)) },
    ],
  },
})
const printedLots = (numbers, phase = null) => numbers.map((lot) => ({
  phase,
  lot: String(lot).padStart(2, '0'),
  draw: 1,
}))

test('a Job lists the Lot numbers of each Phase, leaving out utility buildings', () => {
  const list = jobPhaseList({
    sequenceSheet: {
      phases: [{
        id: 1,
        name: '1',
        lots: [{ lotNumber: '1' }, { lotNumber: '', isUtilityBuilding: true }, { lotNumber: '2', isUtilityBuilding: false }],
      }],
    },
  })

  assert.deepEqual(list[0].lots, ['1', '2'])
  assert.deepEqual(jobPhaseList(job([1, '3']))[0].lots, [])
})

test('a schedule that prints no Phase is placed by its Lots, which the Sequence Sheet assigns', () => {
  const list = jobPhaseList(jobWithLots())
  const template = { status: 'confirmed', mapping: { cells: printedLots(range(1, 25)) } }
  const coverage = schedulePhaseCoverage(template, list)

  assert.deepEqual([...coverage.lots.keys()], ['1', '2'])
  assert.equal(coverage.lots.get('1').size, 18)
  assert.equal(coverage.lots.get('2').size, 7)
  assert.deepEqual([...coverage.inferred], ['1', '2'])
  assert.equal(coverage.unmatched, 0)
  assert.deepEqual(coverage.unknownLots, [])
  assert.deepEqual(coverage.severalLots, [])
})

test('the Lots a schedule has that the Job does not are reported, and the rest are placed', () => {
  const list = jobPhaseList(jobWithLots())
  const template = { status: 'needs_review', detectedCells: printedLots([...range(10, 12), 40, 41]) }
  const coverage = schedulePhaseCoverage(template, list)

  assert.deepEqual([...coverage.lots.keys()], ['2'])
  assert.deepEqual(coverage.unknownLots, ['40', '41'])
  assert.equal(coverage.unmatched, 2)
})

test('a Lot number that two Phases have cannot tell the Phase', () => {
  const list = jobPhaseList({
    sequenceSheet: {
      phases: [
        { id: 1, name: '1', lots: lotsOf(1, 2) },
        { id: 2, name: '2', lots: lotsOf(1, 2, 3) },
      ],
    },
  })
  const both = schedulePhaseCoverage({ status: 'needs_review', detectedCells: printedLots([1, 2]) }, list)
  const partly = schedulePhaseCoverage({ status: 'needs_review', detectedCells: printedLots([1, 3]) }, list)

  assert.equal(both.lots.size, 0)
  assert.deepEqual(both.severalLots, ['01', '02'])
  assert.deepEqual([...partly.lots.keys()], ['2'])
  assert.deepEqual(partly.severalLots, ['01'])
})

test('a printed Phase is not overridden by the Lots', () => {
  const list = jobPhaseList(jobWithLots())
  const template = { status: 'confirmed', mapping: { cells: printedLots([1, 2], '2') } }
  const coverage = schedulePhaseCoverage(template, list)

  assert.deepEqual([...coverage.lots.keys()], ['2'])
  assert.equal(coverage.inferred.size, 0)
})

test('the Job 1319 schedule fills every Phase, and says its Phase came from the Lots', () => {
  const list = jobPhaseList(jobWithLots())
  const documents = [doc('matrix', 'Finish Carpentry.pdf')]
  const { groups, unassigned } = paymentScheduleGroups({
    documents,
    phases: list,
    templates: { matrix: { status: 'confirmed', mapping: { cells: printedLots(range(1, 25)) } } },
  })

  assert.deepEqual(unassigned, [])
  assert.deepEqual(groups.map(({ label, empty, status }) => [label, empty, status]), [
    ['Phase 1', false, 'ok'],
    ['Phase 2', false, 'ok'],
  ])
  assert.equal(groups[0].placements[0].inferred, true)
  assert.deepEqual(groups[0].placements[0].alsoIn, ['Phase 2'])
  assert.equal(groups[0].meta, '1 schedule, lots 1–9, 17–25')
  assert.equal(groups[1].meta, '1 schedule, lots 10–16')
})

test('a Phase with Lots that no schedule has says which', () => {
  const list = jobPhaseList(jobWithLots())
  const { groups } = paymentScheduleGroups({
    documents: [doc('part')],
    phases: list,
    templates: { part: { status: 'confirmed', mapping: { cells: printedLots(range(1, 5)) } } },
  })

  assert.equal(groups[0].meta, '1 schedule, lots 1–5 · no schedule for lots 6–9, 17–25')
  assert.equal(groups[0].status, 'ok')
  assert.equal(groups[1].empty, true)
})

test('a schedule none of whose Lots is in the Job, or whose Lots are in several Phases, says so', () => {
  const list = jobPhaseList({
    sequenceSheet: {
      phases: [
        { id: 1, name: '1', lots: lotsOf(1, 2) },
        { id: 2, name: '2', lots: lotsOf(1, 2) },
      ],
    },
  })
  const { unassigned } = paymentScheduleGroups({
    documents: [doc('far'), doc('twin')],
    phases: list,
    templates: {
      far: { status: 'needs_review', detectedCells: printedLots([90, 91]) },
      twin: { status: 'needs_review', detectedCells: printedLots([1, 2]) },
    },
  })

  assert.deepEqual(unassigned.map(({ document, reason }) => [document.id, reason]), [
    ['far', 'None of its Lots is in this Job'],
    ['twin', 'Its Lots are in more than one Phase. Choose one when you review it'],
  ])
})
