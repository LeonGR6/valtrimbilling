import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildOptionOrderIndex,
  countOptionsWithOrder,
  describeHeaderMatch,
  describeOptionOrder,
  describeVerdict,
  linesWithStatus,
  lineStatusLabel,
  statusBreakdown,
  workOrderNeedsLook,
  describePurchaseOrderDocument,
  groupWorkOrders,
  priceDifference,
  summarizeByDocument,
  summarizeComparison,
  toComparisonLine,
  toPurchaseOrderAnalysis,
  uncoveredByLot,
} from '../src/features/purchase-orders/services/purchaseOrderRecord.js'

function row(overrides = {}) {
  return {
    line_id: 1,
    job_document_id: 'doc-27',
    work_order_no: 'WO-1',
    reference_no: '0004617537',
    po_date: '2026-08-13',
    revised_on: '2026-09-02',
    lot_raw: '27',
    phase_raw: 'MDL',
    plan_raw: '4',
    elevation_raw: 'B',
    option_code_raw: '2FIN5006',
    description_lines: ['Add Half Size Shelf', 'Bedroom 3'],
    quantity: '1.000',
    po_unit_price: '81.00',
    header_status: 'suggested',
    lot_id: 27,
    lot_number: '27',
    phase_id: '5',
    phase_code: 'MODELS',
    building: '.',
    plan_code: '4B',
    plan_option_id: 100,
    option_name: 'Add Half Size Lower Second Shelf',
    system_price: '81.00',
    system_not_applicable: false,
    conflicting_po_prices: false,
    status: 'MATCH',
    ...overrides,
  }
}

test('maps a comparison line with numbers as numbers', () => {
  const line = toComparisonLine(row({ system_price: '-14.00', po_unit_price: '-14.00' }))
  assert.equal(line.poUnitPrice, -14)
  assert.equal(line.systemPrice, -14)
  assert.equal(line.quantity, 1)
  assert.equal(line.lotId, 27)
  assert.equal(line.phaseId, 5)
  assert.equal(line.documentId, 'doc-27')

  const unmatched = toComparisonLine(row({
    lot_id: null,
    lot_number: null,
    phase_id: null,
    system_price: null,
    plan_option_id: null,
    status: 'HEADER_UNRESOLVED',
  }))
  assert.equal(unmatched.lotId, null)
  assert.equal(unmatched.phaseId, null)
  assert.equal(unmatched.systemPrice, null)
  assert.equal(unmatched.planOptionId, null)
})

test('the price difference is PO minus system, in cents', () => {
  assert.equal(priceDifference(toComparisonLine(row({ po_unit_price: '1126.00', system_price: '1100.00' }))), 26)
  assert.equal(priceDifference(toComparisonLine(row({ po_unit_price: '0.30', system_price: '0.10' }))), 0.2)
  assert.equal(priceDifference(toComparisonLine(row({ system_price: null }))), null)
})

test('summarizes statuses and how many lines need attention', () => {
  const lines = [
    row({ status: 'MATCH' }),
    row({ line_id: 2, status: 'PRICE_DIFF' }),
    row({ line_id: 3, status: 'MISSING_OPTION' }),
    row({ line_id: 4, status: 'MATCH' }),
  ].map(toComparisonLine)

  const summary = summarizeComparison(lines)
  assert.equal(summary.total, 4)
  assert.equal(summary.matches, 2)
  assert.equal(summary.attention, 2)
  assert.equal(summary.byStatus.PRICE_DIFF, 1)
  assert.equal(summary.byStatus.HEADER_UNRESOLVED, 0)
})

test('summarizes each document of a Job apart', () => {
  const lines = [
    row({ job_document_id: 'a', status: 'MATCH' }),
    row({ line_id: 2, job_document_id: 'b', status: 'PRICE_DIFF' }),
    row({ line_id: 3, job_document_id: 'b', status: 'MATCH' }),
  ].map(toComparisonLine)

  const byDocument = summarizeByDocument(lines)
  assert.equal(byDocument.a.attention, 0)
  assert.equal(byDocument.b.total, 2)
  assert.equal(byDocument.b.attention, 1)
})

test('the card of a PDF says what happened to it', () => {
  const analysis = (status, extra = {}) => toPurchaseOrderAnalysis({
    id: 'x',
    job_document_id: 'doc',
    job_id: 4,
    status,
    issues: [],
    updated_at: '2026-10-21T12:00:00Z',
    ...extra,
  })

  assert.equal(describePurchaseOrderDocument(null).status.label, 'Not analyzed')
  assert.equal(describePurchaseOrderDocument(null, null, true).status.label, 'Analyzing…')
  assert.equal(describePurchaseOrderDocument(analysis('failed')).status.color, 'error')

  const notPo = describePurchaseOrderDocument(analysis('not_option_po', { error: 'Layout not supported.' }))
  assert.equal(notPo.status.label, 'Not a PO of options')
  assert.equal(notPo.title, 'Layout not supported.')

  assert.equal(describePurchaseOrderDocument(analysis('analyzed')).status.label, 'Analyzed')
  assert.deepEqual(
    describePurchaseOrderDocument(analysis('analyzed'), { total: 5, attention: 2 }),
    { status: { color: 'warning', label: '2 to review' }, linesChip: { label: '5 options' } },
  )
  assert.deepEqual(
    describePurchaseOrderDocument(analysis('analyzed'), { total: 1, attention: 0 }),
    { status: { color: 'success', label: 'All match' }, linesChip: { label: '1 option' } },
  )
})

test('groups lines by work order and explains a suggested match', () => {
  const lines = [
    row({ line_id: 1, work_order_no: 'WO-2', lot_raw: '28', lot_number: '28', plan_code: '2A', plan_raw: '2', elevation_raw: 'A' }),
    row({ line_id: 2, work_order_no: 'WO-1' }),
    row({ line_id: 3, work_order_no: 'WO-1', option_code_raw: '1STR0024' }),
  ].map(toComparisonLine)

  const groups = groupWorkOrders(lines)
  assert.deepEqual(groups.map((group) => group.workOrderNo), ['WO-1', 'WO-2'])
  assert.equal(groups[0].lines.length, 2)
  assert.equal(groups[0].printed.plan, '4B')
  assert.equal(groups[0].system.planCode, '4B')

  const message = describeHeaderMatch(groups[0])
  assert.match(message, /Lot 27 · Phase MDL · Plan 4B/)
  assert.match(message, /Phase MODELS/)
})

test('explains a header that did not match', () => {
  const group = (overrides) => groupWorkOrders([toComparisonLine(row(overrides))])[0]

  assert.equal(describeHeaderMatch(group({ header_status: 'resolved' })), null)
  assert.match(
    describeHeaderMatch(group({ header_status: 'plan_mismatch', plan_code: '2A' })),
    /Plan 4B, but Lot 27 is Plan 2A/,
  )
  assert.match(
    describeHeaderMatch(group({ header_status: 'lot_not_found', lot_id: null, lot_number: null, status: 'HEADER_UNRESOLVED' })),
    /No Lot of this Job fits Lot 27/,
  )
})

test('lists uncovered options only for the Lots of the document', () => {
  const uncovered = [
    { lot_id: 27, lot_number: '27', phase_code: 'MODELS', building: '.', option_id: 103, option_code: '9XXX0001', option_name: 'Extra', system_price: '10.00', system_not_applicable: false },
    { lot_id: 30, lot_number: '30', phase_code: 'MODELS', building: '.', option_id: 104, option_code: '9XXX0002', option_name: 'Other', system_price: null, system_not_applicable: true },
  ].map((item) => ({
    lotId: item.lot_id,
    lotNumber: item.lot_number,
    optionCode: item.option_code,
  }))

  const result = uncoveredByLot(uncovered, [27])
  assert.equal(result.length, 1)
  assert.equal(result[0].lotNumber, '27')
  assert.equal(result[0].options[0].optionCode, '9XXX0001')
})

test('a line can be imported only when its Lot is confirmed and it is missing', async () => {
  const { importAction, describeImportAction, summarizeImport } = await import(
    '../src/features/purchase-orders/services/purchaseOrderRecord.js'
  )
  const line = (overrides) => toComparisonLine(row(overrides))

  assert.equal(importAction(line({ status: 'MISSING_OPTION', header_status: 'resolved' })), 'create')
  assert.equal(importAction(line({ status: 'NOT_IN_LOT', header_status: 'resolved' })), 'add')
  // A Lot that was only suggested is confirmed before anything is created.
  assert.equal(importAction(line({ status: 'MISSING_OPTION', header_status: 'suggested' })), null)
  assert.equal(importAction(line({ status: 'PRICE_DIFF', header_status: 'resolved' })), null)
  assert.equal(importAction(line({ status: 'MATCH', header_status: 'resolved' })), null)

  assert.match(
    describeImportAction(line({ status: 'MISSING_OPTION', header_status: 'resolved' })),
    /Create the option in Plan 4B and add it to Lot 27/,
  )
  assert.equal(
    describeImportAction(line({ status: 'NOT_IN_LOT', header_status: 'resolved' })),
    'Add it to Lot 27',
  )

  // The same option missing in two Lots of one Plan is created once.
  const summary = summarizeImport([
    line({ line_id: 1, status: 'MISSING_OPTION', header_status: 'resolved', option_code_raw: '1STR0024', lot_number: '27' }),
    line({ line_id: 2, status: 'MISSING_OPTION', header_status: 'resolved', option_code_raw: '1STR-0024', lot_number: '31' }),
    line({ line_id: 3, status: 'NOT_IN_LOT', header_status: 'resolved' }),
    line({ line_id: 4, status: 'MATCH', header_status: 'resolved' }),
  ])
  assert.deepEqual(summary, { newOptions: 1, additions: 3 })
})

test('describes what an import did and why lines were skipped', async () => {
  const { toImportResult, describeImportResult } = await import(
    '../src/features/purchase-orders/services/purchaseOrderRecord.js'
  )

  const result = toImportResult({
    created_options: 1,
    added_to_lots: 2,
    skipped: [{ line_id: 4, reason: 'header_not_confirmed' }, { line_id: 5, reason: 'something_new' }],
  })
  assert.equal(result.createdOptions, 1)
  assert.equal(result.skipped[0].message, 'Confirm the Lot match first.')
  assert.equal(result.skipped[1].message, 'It could not be imported.')
  assert.deepEqual(describeImportResult(result), {
    severity: 'warning',
    message: 'Created 1 option and added 2 options to Lots. 2 lines were skipped.',
  })

  assert.deepEqual(describeImportResult(toImportResult({ created_options: 0, added_to_lots: 1, skipped: [] })), {
    severity: 'success',
    message: 'Added 1 option to Lots.',
  })
  assert.equal(
    describeImportResult(toImportResult({ created_options: 0, added_to_lots: 0, skipped: [{ line_id: 1, reason: 'not_importable' }] })).severity,
    'warning',
  )
})

test('the PDF price is offered together with the Lots that print the same price', async () => {
  const { canUsePdfPrice, priceCandidates } = await import(
    '../src/features/purchase-orders/services/purchaseOrderRecord.js'
  )
  const line = (overrides) => toComparisonLine(row({
    status: 'PRICE_DIFF',
    header_status: 'resolved',
    plan_option_id: 100,
    po_unit_price: '90.00',
    system_price: '81.00',
    ...overrides,
  }))

  assert.equal(canUsePdfPrice(line({})), true)
  assert.equal(canUsePdfPrice(line({ status: 'MATCH' })), false)
  assert.equal(canUsePdfPrice(line({ header_status: 'suggested' })), false)
  assert.equal(canUsePdfPrice(line({ plan_option_id: null })), false)

  const clicked = line({ line_id: 1, lot_number: '27' })
  const candidates = priceCandidates(clicked, [
    clicked,
    line({ line_id: 2, lot_number: '31' }),
    // Another price, another option, or not a difference: not offered.
    line({ line_id: 3, lot_number: '32', po_unit_price: '95.00' }),
    line({ line_id: 4, lot_number: '33', plan_option_id: 101 }),
    line({ line_id: 5, lot_number: '34', status: 'MATCH' }),
  ])
  assert.deepEqual(candidates.map((candidate) => candidate.lotNumber), ['27', '31'])
})

test('describes what adopting a price did', async () => {
  const { toPriceResult, describePriceResult } = await import(
    '../src/features/purchase-orders/services/purchaseOrderRecord.js'
  )
  const formatMoney = (value) => `$${value.toFixed(2)}`
  const context = { optionCode: '2FIN5006', planCode: '4B', formatMoney }

  const result = toPriceResult({
    price_set: true,
    option_id: 100,
    price: 90,
    options: 2,
    packages: [{ package_number: 'DP-1', documents_removed: 1 }],
    differences: [{ package_number: 'DP-2' }],
    skipped: [{ line_id: 9, reason: 'not_price_difference' }],
  })
  assert.equal(result.skipped[0].message, 'It already matches.')

  const summary = describePriceResult(result, context)
  assert.equal(summary.severity, 'warning')
  assert.match(summary.message, /2FIN5006 now costs \$90.00 in Plan 4B\./)
  assert.match(summary.message, /2 Lots bill that price\./)
  assert.match(summary.message, /Recalculated DP-1\./)
  assert.match(summary.message, /Generate the Release and Payment Schedule again for DP-1\./)
  assert.match(summary.message, /DP-2 keep their amount/)

  assert.match(
    describePriceResult(toPriceResult({ price_set: false, price: 90, options: 1 }), context).message,
    /already cost \$90.00/,
  )
  assert.equal(
    describePriceResult(toPriceResult({ price_set: false, options: 0, skipped: [] }), context).message,
    'No Lot changed price.',
  )
})

test('says whether a Purchase Order backs the option a Package bills', async () => {
  const { buildPurchaseOrderBacking, countUnbacked, describeBacking } = await import(
    '../src/features/purchase-orders/services/purchaseOrderRecord.js'
  )
  const line = (overrides) => toComparisonLine(row({
    lot_id: 27,
    plan_option_id: 100,
    option_code_raw: '2FIN5006',
    po_unit_price: '81.00',
    ...overrides,
  }))
  const backing = buildPurchaseOrderBacking([
    line({}),
    line({ line_id: 2, option_code_raw: '1STR0024', plan_option_id: null, po_unit_price: '1126.00' }),
    line({ line_id: 3, lot_id: null, option_code_raw: '9XXX0001' }),
  ])
  assert.equal(backing.hasPurchaseOrders, true)

  const option = (overrides) => ({
    lotId: 27, optionId: 100, optionCode: '2FIN5006', price: 81, priceNotApplicable: false, ...overrides,
  })

  assert.deepEqual(backing.lookup(option({})), { state: 'backed', poPrice: 81 })
  // The price the Package shows is what is compared, not today's.
  assert.deepEqual(backing.lookup(option({ price: 90 })), { state: 'price_differs', poPrice: 81 })
  // A line without a chosen option is still found by its code.
  assert.equal(backing.lookup(option({ optionId: 555, optionCode: '1STR-0024', price: 1126 })).state, 'backed')
  // The Lot has a Purchase Order that does not print the option.
  assert.equal(backing.lookup(option({ optionId: 7, optionCode: '5ZZZ0001' })).state, 'not_in_po')
  // The Lot has no Purchase Order at all.
  assert.equal(backing.lookup(option({ lotId: 99 })).state, 'no_po')
  // NA bills nothing: it agrees with a PDF that prints $0.
  const zero = buildPurchaseOrderBacking([line({ po_unit_price: '0.00' })])
  assert.equal(zero.lookup(option({ price: 0, priceNotApplicable: true })).state, 'backed')

  assert.equal(
    countUnbacked(backing, [option({}), option({ price: 90 }), option({ optionId: 7, optionCode: '5ZZZ0001' }), option({ lotId: 99 })]),
    2,
  )
  // A Job without Purchase Orders is left alone.
  const none = buildPurchaseOrderBacking([])
  assert.equal(none.hasPurchaseOrders, false)
  assert.equal(countUnbacked(none, [option({})]), 0)
  assert.equal(describeBacking({ state: 'no_po' }).color, 'default')
})

test('the import reports each option it selected for a Lot', async () => {
  const { toImportResult } = await import('../src/features/purchase-orders/services/purchaseOrderRecord.js')
  const { additionsFromImport } = await import('../src/features/purchase-orders/services/purchaseOrderEmailRecord.js')

  const result = toImportResult({
    created_options: 1,
    added_to_lots: 2,
    added: [
      { line_id: 2, lot_id: 27, option_id: 3, created_option: true },
      { line_id: 1, lot_id: 27, option_id: 1, created_option: false },
    ],
    skipped: [],
  })
  assert.deepEqual(result.added, [
    { lineId: 2, lotId: 27, optionId: 3, createdOption: true },
    { lineId: 1, lotId: 27, optionId: 1, createdOption: false },
  ])
  assert.deepEqual(additionsFromImport(result), [
    { lotId: 27, optionId: 3, createdOption: true },
    { lotId: 27, optionId: 1, createdOption: false },
  ])
  // An import that selected nothing (or an older response) has nothing to tell.
  assert.deepEqual(toImportResult({ created_options: 0, added_to_lots: 0 }).added, [])
  assert.deepEqual(additionsFromImport(undefined), [])
})

test('the email starts with Purchasing and the Job Coordinator, and the user can change it', async () => {
  const {
    addRecipients, describeMissingRoles, describeOptionsEmailSent,
    emailDraftFromPreview, removeRecipient, validateRecipients,
  } = await import('../src/features/purchase-orders/services/purchaseOrderEmailRecord.js')

  const draft = emailDraftFromPreview({
    rendered: { subject: 'Rendered subject' },
    draft: {
      subject: 'Options added to the Sequence Sheet · Job #1326 · Lot 27',
      recipients: [
        { role: 'Purchasing', name: 'Pat', email: 'Pat@Valtriminc.com' },
        { role: 'Job Coordinator', name: 'Jo', email: 'jo@valtriminc.com' },
        { role: 'Job Coordinator', name: 'Jo', email: 'jo@valtriminc.com' },
        { role: 'Supervisor', name: 'x', email: 'not-an-email' },
      ],
    },
    snapshot: { missingRoles: ['Job Coordinator'] },
  })
  assert.equal(draft.subject, 'Options added to the Sequence Sheet · Job #1326 · Lot 27')
  assert.deepEqual(draft.recipients.map(({ email, role }) => [email, role]), [
    ['pat@valtriminc.com', 'Purchasing'],
    ['jo@valtriminc.com', 'Job Coordinator'],
  ])
  assert.deepEqual(draft.missingRoles, ['Job Coordinator'])

  // Removing a suggested recipient.
  const withoutPat = removeRecipient(draft.recipients, 'pat@valtriminc.com')
  assert.deepEqual(withoutPat.map(({ email }) => email), ['jo@valtriminc.com'])

  // Adding more: several at once, repeats ignored, case folded.
  const added = addRecipients(withoutPat, 'Ana@example.com, jo@valtriminc.com; luis@example.com')
  assert.deepEqual(added.recipients.map(({ email }) => email), [
    'jo@valtriminc.com', 'ana@example.com', 'luis@example.com',
  ])
  assert.equal(added.error, '')
  assert.equal(added.recipients[1].role, null)

  // A bad address is reported, the good ones still go in.
  const mixed = addRecipients([], ['nope', 'ok@example.com'])
  assert.deepEqual(mixed.recipients.map(({ email }) => email), ['ok@example.com'])
  assert.equal(mixed.error, 'nope is not a valid email address.')

  // The limit.
  const full = addRecipients(
    Array.from({ length: 10 }, (_, index) => ({ email: `p${index}@example.com`, role: null, name: '' })),
    'one-more@example.com',
  )
  assert.equal(full.recipients.length, 10)
  assert.match(full.error, /up to 10 recipients/)

  assert.deepEqual(validateRecipients([]), { success: false, error: 'Add at least one recipient.' })
  assert.deepEqual(validateRecipients(withoutPat), { success: true, emails: ['jo@valtriminc.com'] })

  assert.equal(describeMissingRoles([]), null)
  assert.match(describeMissingRoles(['Purchasing']), /Purchasing has no email on file/)
  assert.match(describeMissingRoles(['Purchasing', 'Job Coordinator']), /Purchasing and Job Coordinator have no email/)
  assert.equal(describeOptionsEmailSent({ recipients: ['a@b.com', 'c@d.com'] }), 'Email sent to a@b.com, c@d.com.')
})

// --- The Purchase Orders behind one option of a Lot ---

const orderLine = (lineId, overrides = {}) => ({
  lineId,
  documentId: 'doc-1',
  workOrderNo: '4419',
  referenceNo: '88213',
  poDate: '2026-09-01',
  revisedOn: null,
  optionCode: 'C-101',
  quantity: 1,
  poUnitPrice: 250,
  systemPrice: 250,
  lotId: 27,
  planOptionId: 9,
  status: 'MATCH',
  ...overrides,
})

test('an option finds its Purchase Order by the option it was matched with, else by code', () => {
  const index = buildOptionOrderIndex([
    orderLine(1),
    orderLine(2, { lotId: 28, planOptionId: null, optionCode: 'c 102' }),
    orderLine(3, { lotId: null }),
  ])

  assert.equal(index.isEmpty, false)
  assert.deepEqual(index.linesFor({ lotId: 27, optionId: 9, optionCode: 'ZZ' }).map((l) => l.lineId), [1])
  assert.deepEqual(index.linesFor({ lotId: 27, optionId: 4, optionCode: 'C-101' }).map((l) => l.lineId), [1])
  assert.deepEqual(index.linesFor({ lotId: 28, optionId: 5, optionCode: 'C-102' }).map((l) => l.lineId), [2])
  // Another Lot with the same option, an option no Purchase Order prints, and a line of no Lot.
  assert.deepEqual(index.linesFor({ lotId: 29, optionId: 9, optionCode: 'C-101' }), [])
  assert.deepEqual(index.linesFor({ lotId: 27, optionId: 8, optionCode: 'X-1' }), [])
  assert.equal(buildOptionOrderIndex([orderLine(3, { lotId: null })]).isEmpty, true)
})

test('an option with several Purchase Orders lists the newest revision first', () => {
  const index = buildOptionOrderIndex([
    orderLine(1, { revisedOn: null, poDate: '2026-08-01' }),
    orderLine(2, { documentId: 'doc-2', revisedOn: '2026-09-15' }),
  ])

  assert.deepEqual(index.linesFor({ lotId: 27, optionId: 9, optionCode: 'C-101' }).map((l) => l.lineId), [2, 1])
})

test('the options with an order are counted over the selected ones of the Lots', () => {
  const index = buildOptionOrderIndex([orderLine(1), orderLine(2, { lotId: 28, planOptionId: 10, optionCode: 'D-1' })])
  const lots = [{ id: 27 }, { id: 28 }, { id: 29 }]
  const optionsOf = () => [{ id: 9, code: 'C-101' }, { id: 10, code: 'D-1' }]

  assert.equal(countOptionsWithOrder(index, lots, optionsOf), 2)
  assert.equal(countOptionsWithOrder(index, [], optionsOf), 0)
})

test('an order card says its numbers, its status and, when the price differs, both prices', () => {
  const money = (value) => `$${value.toFixed(2)}`
  const match = describeOptionOrder(orderLine(1), money)
  const differs = describeOptionOrder(orderLine(2, { status: 'PRICE_DIFF', poUnitPrice: 300 }), money)
  const unnumbered = describeOptionOrder(orderLine(3, { workOrderNo: '', referenceNo: null }), money)

  assert.equal(match.workOrderNo, '4419')
  assert.deepEqual(match.status, { label: 'Matches', color: 'success' })
  assert.doesNotMatch(match.hint, /\$/)
  assert.deepEqual(differs.status, { label: 'Price differs', color: 'warning' })
  assert.match(differs.hint, /The PDF prints \$300\.00; this Lot bills \$250\.00\./)
  assert.equal(unnumbered.workOrderNo, null)
  assert.equal(unnumbered.referenceNo, null)
})

// --- The summary at the top of the review ---

const summaryOf = (...statuses) => summarizeComparison(statuses.map((status) => ({ status })))

test('the breakdown lists the results that occur, most urgent first and the matches last', () => {
  const breakdown = statusBreakdown(summaryOf('MATCH', 'MATCH', 'MATCH', 'NOT_IN_LOT', 'PRICE_DIFF', 'MISSING_OPTION', 'MATCH'))

  assert.deepEqual(breakdown.map(({ key }) => key), ['MISSING_OPTION', 'NOT_IN_LOT', 'PRICE_DIFF', 'MATCH'])
  assert.deepEqual(breakdown.map(({ count }) => count), [1, 1, 1, 4])
  assert.equal(breakdown[0].color, 'error')
  assert.equal(breakdown.at(-1).color, 'success')
  assert.equal(breakdown.reduce((total, { share }) => total + share, 0), 1)
  assert.equal(breakdown.at(-1).advice, null)
  assert.match(breakdown[1].advice, /^Add to the sequence sheet selects it/)
  assert.deepEqual(statusBreakdown(summaryOf()), [])
})

test('the headline says how many options match and how serious the rest is', () => {
  assert.deepEqual(describeVerdict(summaryOf()), {
    tone: 'neutral',
    headline: 'No options from this PDF are current',
    detail: 'Newer Purchase Orders replace them.',
  })

  const clean = describeVerdict(summaryOf('MATCH', 'MATCH', 'MATCH'))
  assert.equal(clean.tone, 'success')
  assert.equal(clean.headline, 'All 3 options in this PDF match the system')
  assert.equal(describeVerdict(summaryOf('MATCH')).headline, 'The option in this PDF matches the system')

  const warning = describeVerdict(summaryOf('MATCH', 'MATCH', 'PRICE_DIFF', 'NOT_IN_LOT'))
  assert.equal(warning.tone, 'warning')
  assert.equal(warning.headline, '2 of 4 options match the system')
  assert.match(warning.detail, /^2 need a look\. This only informs/)

  const error = describeVerdict(summaryOf('MATCH', 'MISSING_OPTION'))
  assert.equal(error.tone, 'error')
  assert.match(error.detail, /^1 needs a look/)
})

test('a filter on one result keeps only those lines', () => {
  const lines = [{ status: 'MATCH' }, { status: 'NOT_IN_LOT' }, { status: 'NOT_IN_LOT' }]

  assert.equal(linesWithStatus(lines, 'NOT_IN_LOT').length, 2)
  assert.equal(linesWithStatus(lines, null).length, 3)
  assert.equal(linesWithStatus(lines, 'PRICE_DIFF').length, 0)
})

test('a work order needs a look when its Lot is not settled or an option differs', () => {
  const group = (headerStatus, ...statuses) => ({ headerStatus, lines: statuses.map((status) => ({ status })) })

  assert.equal(workOrderNeedsLook(group('resolved', 'MATCH', 'MATCH')), false)
  assert.equal(workOrderNeedsLook(group('resolved', 'MATCH', 'PRICE_DIFF')), true)
  assert.equal(workOrderNeedsLook(group('suggested', 'MATCH')), true)
  assert.equal(workOrderNeedsLook(group('lot_not_found')), true)
})

test('an option missing from the sequence sheet says for which Lot', () => {
  assert.equal(
    lineStatusLabel({ status: 'NOT_IN_LOT', lotNumber: '27' }),
    'Not in the sequence sheet (For Lot 27)',
  )
  assert.equal(lineStatusLabel({ status: 'NOT_IN_LOT', lotNumber: null }), 'Not in the sequence sheet')
  assert.equal(lineStatusLabel({ status: 'MATCH', lotNumber: '27' }), 'Matches')
  assert.equal(lineStatusLabel({ status: 'MISSING_OPTION', lotNumber: '27' }), 'Not in the system')
  assert.equal(lineStatusLabel({ status: 'nope' }), '')
})
