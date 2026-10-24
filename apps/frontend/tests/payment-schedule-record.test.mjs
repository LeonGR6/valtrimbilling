import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyPhaseMap,
  describeLotPhases,
  buildMapping,
  describeIssue,
  describePaymentScheduleDocument,
  describeTotals,
  drawLabel,
  initialCells,
  initialPhaseMap,
  lotPhaseIndex,
  PHASE_BY_LOT,
  phaseOfLot,
  initialSummaryRows,
  isPaymentScheduleDocumentType,
  lotRows,
  normalizeCodeKey,
  printedPhases,
  suggestJobPhase,
  summarizeCells,
  toPaymentScheduleTemplate,
  unmatchedPhases,
  visibleIssues,
} from '../src/features/payment-schedules/services/paymentScheduleRecord.js'
import { validatePaymentScheduleMapping } from '../src/features/payment-schedules/schemas/paymentScheduleMappingSchema.js'

const rect = { x: 0.1, y: 0.2, w: 0.05, h: 0.01 }
const cell = (lot, draw, amount, overrides = {}) => ({
  phase: '003', lot, draw, amount, page: 1, rect, ...overrides,
})

const row = (overrides = {}) => ({
  id: 'tpl-1',
  job_document_id: 'doc-1',
  job_id: 7,
  layout: 'matrix',
  detection_method: 'text_layer',
  page_count: 1,
  page_sizes: [{ page: 1, width: 612, height: 1008, rotation: 0 }],
  detected_cells: [cell('0014', 1, 1929.04), cell('0014', 2, 1446.78), cell('0015', 1, 100)],
  analysis: {
    draws: [{ draw: 2, name: 'Trim Complete', costCode: '480052' }],
    issues: [],
    expectedTotal: 3475.82,
    foundTotal: 3475.82,
  },
  mapping: null,
  status: 'needs_review',
  error: null,
  confirmed_at: null,
  analyzed_at: '2026-10-10T10:00:00Z',
  updated_at: '2026-10-10T10:00:00Z',
  ...overrides,
})

test('a database row becomes a template with safe defaults', () => {
  const template = toPaymentScheduleTemplate(row())
  assert.equal(template.documentId, 'doc-1')
  assert.equal(template.layout, 'matrix')
  assert.equal(template.detectedCells.length, 3)
  assert.equal(template.expectedTotal, 3475.82)

  const bare = toPaymentScheduleTemplate(row({
    layout: null, page_sizes: null, detected_cells: null, analysis: null,
  }))
  assert.deepEqual(
    [bare.layout, bare.pageSizes, bare.detectedCells, bare.draws, bare.issues, bare.expectedTotal],
    [null, [], [], [], [], null],
  )
})

test('the reviewer starts from the confirmed cells, else from what was detected', () => {
  const detected = toPaymentScheduleTemplate(row())
  assert.deepEqual(initialCells(detected).map(({ key }) => key), ['003|0014|1', '003|0014|2', '003|0015|1'])

  const confirmed = toPaymentScheduleTemplate(row({
    status: 'confirmed',
    mapping: { version: 1, layout: 'matrix', cells: [cell('0014', 1, 1929.04, { phase: null })] },
  }))
  assert.deepEqual(initialCells(confirmed).map(({ key }) => key), ['|0014|1'])
})

test('Lots and Phases compare without case or leading zeros', () => {
  assert.equal(normalizeCodeKey('0014'), '14')
  assert.equal(normalizeCodeKey(' 01 '), '1')
  assert.equal(normalizeCodeKey('0'), '0')
  assert.equal(normalizeCodeKey('01a'), '1A')
  assert.equal(normalizeCodeKey('0A'), '0A')
  assert.equal(normalizeCodeKey('Models'), 'MODELS')
  assert.equal(normalizeCodeKey(null), '')
})

test('a printed Phase is matched to the Job Phase it most likely stands for', () => {
  // Same code once normalized.
  assert.equal(suggestJobPhase('003', ['3', '4']), '3')
  assert.equal(suggestJobPhase('models', ['MODELS']), 'MODELS')
  // The printed letters appear in order in one Phase, from the same first letter.
  assert.equal(suggestJobPhase('MDL', ['MODELS', 'PHASE 1']), 'MODELS')
  assert.equal(suggestJobPhase('MDLS', ['MODELS', 'PHASE 1']), 'MODELS')
  assert.equal(suggestJobPhase('MOD', ['MODELS', 'OTHER']), 'MODELS')
  // No guess when nothing fits, when it is ambiguous, or when it is too short.
  assert.equal(suggestJobPhase('003', ['5']), '')
  assert.equal(suggestJobPhase('MDL', ['MODELS', 'MODULAR']), '')
  assert.equal(suggestJobPhase('M', ['MODELS']), '')
  assert.equal(suggestJobPhase('', ['MODELS']), '')
  assert.equal(suggestJobPhase('MDL', []), '')
  // The first letter has to agree: DLM is in MODELS, but not starting like it.
  assert.equal(suggestJobPhase('ELS', ['MODELS']), '')
})

test('every printed Phase gets a suggestion and the cells are stored under the chosen one', () => {
  const cells = [
    cell('1', 1, 5, { phase: 'MDL' }),
    cell('2', 1, 6, { phase: 'MDL' }),
    cell('3', 1, 7, { phase: null }),
    cell('4', 1, 8, { phase: '003' }),
  ]
  assert.deepEqual(printedPhases(cells), ['MDL', '', '003'])

  const map = initialPhaseMap(cells, ['MODELS', '3'])
  assert.deepEqual(map, { MDL: 'MODELS', '': '', '003': '3' })
  assert.deepEqual(applyPhaseMap(cells, map).map((c) => c.phase), ['MODELS', 'MODELS', null, '3'])
  // A Phase left as printed (empty choice) keeps its printed code.
  assert.deepEqual(applyPhaseMap(cells, { MDL: '' }).map((c) => c.phase), ['MDL', 'MDL', null, '003'])
})

test('a printed Phase the Job does not have is reported', () => {
  const cells = [cell('1', 1, 5, { phase: 'MDL' }), cell('2', 1, 6, { phase: '004' })]
  assert.deepEqual(unmatchedPhases(cells, { MDL: 'MODELS', '004': '' }, ['MODELS', '3']), ['004'])
  assert.deepEqual(unmatchedPhases(cells, { MDL: 'MODELS', '004': '4' }, ['MODELS', '4']), [])
})

test('the stored mapping carries only what the database accepts', () => {
  const cells = initialCells(toPaymentScheduleTemplate(row()))
  const mapping = buildMapping('matrix', cells)

  assert.equal(mapping.version, 1)
  assert.deepEqual(Object.keys(mapping.cells[0]), ['phase', 'lot', 'draw', 'amount', 'page', 'rect'])
  assert.deepEqual(validatePaymentScheduleMapping(mapping, 1), { success: true, errors: [] })
})

test('Lots keep the order of the document and group their draws', () => {
  const rows = lotRows(initialCells(toPaymentScheduleTemplate(row())))
  assert.deepEqual(rows.map((r) => r.lot), ['0014', '0015'])
  assert.deepEqual(Object.keys(rows[0].byDraw), ['1', '2'])
})

test('the summary adds amounts without floating point noise', () => {
  const summary = summarizeCells([
    cell('1', 1, 0.1), cell('2', 1, 0.2), cell('1', 2, 1446.78),
  ])
  assert.equal(summary.cellCount, 3)
  assert.equal(summary.lotCount, 2)
  assert.equal(summary.total, 1447.08)
  assert.deepEqual(summary.draws, [
    { draw: 1, count: 2, total: 0.3 },
    { draw: 2, count: 1, total: 1446.78 },
  ])
})

test('the printed total is compared in cents', () => {
  const ok = describeTotals({ expectedTotal: 70268.4, foundTotal: 70268.4 })
  assert.equal(ok.color, 'success')
  const off = describeTotals({ expectedTotal: 70268.4, foundTotal: 70268.39 })
  assert.equal(off.color, 'warning')
  assert.match(off.text, /\$70,268\.39.*\$70,268\.40/)
  assert.equal(describeTotals({ expectedTotal: null, foundTotal: 5 }).color, 'warning')
})

test('issues say where they are and long lists are cut', () => {
  assert.equal(
    describeIssue({ code: 'row_total_mismatch', message: 'Does not add up.', lot: '0015' }),
    'Lot 0015: Does not add up.',
  )
  assert.equal(
    describeIssue({ code: 'column_total_mismatch', message: 'Off.', draw: 2 }),
    'draw 2: Off.',
  )
  assert.equal(describeIssue({ code: 'missing_total', message: 'No total.' }), 'No total.')

  const many = Array.from({ length: 11 }, () => ({ code: 'x', message: 'm' }))
  assert.deepEqual(
    [visibleIssues(many).shown.length, visibleIssues(many).hidden],
    [8, 3],
  )
})

test('a draw is named with its description and cost code when the PDF has them', () => {
  const template = toPaymentScheduleTemplate(row())
  assert.equal(drawLabel(2, template), 'Draw 2 · Trim Complete (480052)')
  assert.equal(drawLabel(3, template), 'Draw 3')
})

test('the document card says where the schedule stands', () => {
  assert.equal(describePaymentScheduleDocument(null).status.label, 'No template yet')
  const states = {
    needs_review: 'Needs review',
    confirmed: 'Schedule ready',
    analyzing: 'Analyzing…',
    failed: 'Analysis failed',
  }
  for (const [status, label] of Object.entries(states)) {
    const info = describePaymentScheduleDocument(toPaymentScheduleTemplate(row({ status })))
    assert.equal(info.status.label, label, status)
  }
  assert.equal(
    describePaymentScheduleDocument(toPaymentScheduleTemplate(row())).layoutChip.label,
    'Matrix',
  )
  assert.equal(
    describePaymentScheduleDocument(toPaymentScheduleTemplate(row({ status: 'failed' }))).layoutChip,
    null,
  )
})

test('only Payment Schedule documents can be used as a schedule', () => {
  assert.equal(isPaymentScheduleDocumentType('PAYMENT_SCHEDULE'), true)
  assert.equal(isPaymentScheduleDocumentType('PURCHASE_ORDER'), false)
  assert.equal(isPaymentScheduleDocumentType('RELEASE'), false)
  assert.equal(isPaymentScheduleDocumentType('BACKUP'), false)
})

const summary = {
  previouslyInvoiced: [{ draw: 1, page: 1, rect: { x: 0.3, y: 0.5, w: 0.05, h: 0.01, extra: 1 } }],
  thisRequest: [{ draw: 1, page: 1, rect: { x: 0.3, y: 0.52, w: 0.05, h: 0.01 } }],
}

test('the summary rows come from the analysis, and the confirmed mapping wins', () => {
  const found = toPaymentScheduleTemplate(row({ analysis: { summaryRows: summary } }))
  assert.deepEqual(initialSummaryRows(found), summary)
  assert.equal(initialSummaryRows(toPaymentScheduleTemplate(row())), null)

  const confirmedRows = { thisRequest: [{ draw: 2, page: 1, rect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } }] }
  const confirmed = toPaymentScheduleTemplate(row({
    analysis: { summaryRows: summary },
    mapping: { version: 1, layout: 'matrix', cells: [], summaryRows: confirmedRows },
  }))
  assert.deepEqual(initialSummaryRows(confirmed), confirmedRows)
})

test('the stored mapping keeps the summary rows only when asked and only for a matrix', () => {
  const cells = initialCells(toPaymentScheduleTemplate(row()))
  const mapping = buildMapping('matrix', cells, summary)

  // Only the fields the database accepts, nothing extra from the analysis.
  assert.deepEqual(Object.keys(mapping.summaryRows), ['previouslyInvoiced', 'thisRequest'])
  assert.deepEqual(mapping.summaryRows.previouslyInvoiced[0].rect, { x: 0.3, y: 0.5, w: 0.05, h: 0.01 })
  assert.deepEqual(validatePaymentScheduleMapping(mapping, 1), { success: true, errors: [] })

  assert.equal('summaryRows' in buildMapping('matrix', cells, null), false)
  assert.equal('summaryRows' in buildMapping('matrix', cells), false)
  assert.equal('summaryRows' in buildMapping('line_items', cells, summary), false)
  assert.equal('summaryRows' in buildMapping('matrix', cells, { thisRequest: [] }), false)
})

// Job 1319: Lots 1-9 and 17-25 are in Phase 1 (two buildings), Lots 10-16 in Phase 2.
const jobLots = [
  ...Array.from({ length: 9 }, (_, i) => ({ lot: String(i + 1), phase: '1' })),
  ...Array.from({ length: 7 }, (_, i) => ({ lot: String(i + 10), phase: '2' })),
  ...Array.from({ length: 9 }, (_, i) => ({ lot: String(i + 17), phase: '1' })),
]

test('a Lot finds its Phase through the Job, whatever zeros the PDF prints', () => {
  const index = lotPhaseIndex(jobLots)

  assert.deepEqual(phaseOfLot('01', index), { status: 'found', phase: '1' })
  assert.deepEqual(phaseOfLot('12', index), { status: 'found', phase: '2' })
  assert.deepEqual(phaseOfLot('99', index), { status: 'unknown', phase: '' })
  assert.deepEqual(
    phaseOfLot('1', lotPhaseIndex([{ lot: '1', phase: '1' }, { lot: '1', phase: '2' }])),
    { status: 'several', phase: '' },
  )
  // The same Phase in two buildings is still one Phase for the Lot.
  assert.equal(phaseOfLot('1', lotPhaseIndex([{ lot: '1', phase: '1' }, { lot: '01', phase: '1' }])).status, 'found')
})

test('without a printed Phase, the Lots decide by default and are stored under their Phase', () => {
  const cells = ['01', '10', '17', '30'].map((lot, i) => cell(String(i), 1, 5, { phase: null, lot }))
  const index = lotPhaseIndex(jobLots)

  assert.deepEqual(initialPhaseMap(cells, ['1', '2'], index), { '': PHASE_BY_LOT })
  assert.deepEqual(applyPhaseMap(cells, { '': PHASE_BY_LOT }, index).map((c) => c.phase), ['1', '2', '1', null])
  // Choosing a Phase by hand still wins, and "Any Phase" leaves the cells as they are.
  assert.deepEqual(applyPhaseMap(cells, { '': '2' }, index).map((c) => c.phase), ['2', '2', '2', '2'])
  assert.deepEqual(applyPhaseMap(cells, { '': '' }, index).map((c) => c.phase), [null, null, null, null])
})

test('no suggestion by Lot when the Job cannot place any of them', () => {
  const cells = [cell('1', 1, 5, { phase: null, lot: '99' })]

  assert.deepEqual(initialPhaseMap(cells, ['1'], lotPhaseIndex(jobLots)), { '': '' })
  assert.deepEqual(initialPhaseMap(cells, ['1']), { '': '' })
  assert.deepEqual(applyPhaseMap(cells, { '': PHASE_BY_LOT }).map((c) => c.phase), [null])
})

test('what the Lots say lists each Phase, the Lots in several and the ones the Job lacks', () => {
  const cells = ['01', '02', '10', '55'].map((lot, i) => cell(String(i), 1, 5, { phase: null, lot }))
    .concat(cell('x', 1, 5, { phase: 'MDL', lot: '03' }))
  const index = lotPhaseIndex([...jobLots, { lot: '2', phase: '2' }])
  const found = describeLotPhases(cells, index)

  assert.deepEqual(found.phases, [
    { phase: '1', lots: ['01'] },
    { phase: '2', lots: ['10'] },
  ])
  assert.deepEqual(found.several, ['02'])
  assert.deepEqual(found.unknown, ['55'])
})
