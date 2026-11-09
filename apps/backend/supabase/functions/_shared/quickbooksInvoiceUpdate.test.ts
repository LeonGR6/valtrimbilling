import { assertEquals, assertRejects } from '@std/assert'
import { QuickbooksApiError, type QuickbooksInvoiceSnapshot } from './quickbooksApi.ts'
import type { QuickbooksInvoicePayload } from './quickbooksInvoice.ts'
import {
  type InvoiceUpdateContext,
  type InvoiceUpdateDeps,
  type PackageEditRequest,
  type PackageEditResult,
  parseEditRequest,
  QuickbooksInvoiceUpdateError,
  updatePackageInvoice,
} from './quickbooksInvoiceUpdate.ts'
import type { LoadedPackage } from './quickbooksPackageSource.ts'

// The Package after the edit: Lot 1 only, 800 gross, 40 retention, 760 net.
const loaded = (): LoadedPackage => ({
  packageId: 68,
  packageNumber: 'DP-00000068',
  quickbooksStatus: 'CREATED',
  builder: { id: 1, name: 'Trumark' },
  job: { code: '1307', community: 'Sunset Ridge' },
  paymentTermsDays: 30,
  quickbooksEnvironment: 'sandbox',
  syncInvoiceNumber: '14899',
  syncEnvironment: 'sandbox',
  source: {
    package: { package_type: 'DRAW', status: 'DRAFT', invoice_line_format: 'LOT_SCOPE' },
    draws: [
      {
        lot_number: '1',
        phase_code: '1',
        building: '1',
        draw_number: 1,
        is_utility_building: false,
        utility_name: null,
        utility_event_type: null,
        utility_amount: 0,
        base_draw_amount: 800,
        hardware_amount: 0,
        hardware_event_type: null,
        options_amount: 0,
        retention_amount: 40,
        wrap_amount: 0,
      },
    ],
    hardwareLines: [],
    invoice: { net_amount: 760 },
  },
})

// The invoice as it was sent: Lots 1 and 2, 1,600 gross, 80 retention, 1,520 net.
const OLD_LINES = [
  { description: 'PHASE 1 LOTS #1-2\nDRAW 1', amount: 1600 },
  { description: 'RETENTION', amount: -80 },
]
const NEW_LINES = [
  { description: 'PHASE 1 LOT #1\nDRAW 1', amount: 800 },
  { description: 'RETENTION', amount: -40 },
]

const storedPayload = (lines = OLD_LINES): QuickbooksInvoicePayload => ({
  CustomerRef: { value: '58' },
  TxnDate: '2026-10-01',
  DueDate: '2026-10-31',
  DocNumber: '14899',
  PrivateNote: 'ValtrimBilling DP-00000068',
  Line: lines.map((line) => ({
    Amount: line.amount,
    DetailType: 'SalesItemLineDetail' as const,
    Description: line.description,
    SalesItemLineDetail: { ItemRef: { value: '19' }, Qty: 1 as const, UnitPrice: line.amount },
  })),
})

function snapshot(
  lines = OLD_LINES,
  patch: Partial<QuickbooksInvoiceSnapshot['detail']> = {},
  syncToken = '3',
): QuickbooksInvoiceSnapshot {
  const total = lines.reduce((sum, line) => sum + line.amount, 0)
  const detail = {
    id: '146',
    syncToken,
    docNumber: '14899',
    totalAmount: total,
    balance: total,
    linkedTransactions: [],
    ...patch,
  }
  return {
    detail,
    lines: lines.map((line) => ({ ...line, itemId: '19' })),
    raw: {
      Id: '146',
      SyncToken: syncToken,
      DocNumber: '14899',
      TxnDate: '2026-10-01',
      DueDate: '2026-10-31',
      CustomerRef: { value: '58' },
      PrivateNote: 'ValtrimBilling DP-00000068',
      CustomField: [{ DefinitionId: '1', Name: 'Job Name', Type: 'StringType', StringValue: 'Sunset Ridge' }],
      TotalAmt: total,
      Balance: total,
      Line: [
        ...lines.map((line, index) => ({
          Id: String(index + 1),
          Amount: line.amount,
          DetailType: 'SalesItemLineDetail',
          Description: line.description,
          SalesItemLineDetail: { ItemRef: { value: '19' }, Qty: 1, UnitPrice: line.amount },
        })),
        { Amount: total, DetailType: 'SubTotalLineDetail', SubTotalLineDetail: {} },
      ],
    },
  }
}

const figures = (net: number, cells: number) => ({
  gross: net, retention: 0, wrap: 0, net, cells, hardware_lines: 0, options: 0,
})

const editResult = (dryRun: boolean): PackageEditResult => ({
  package_id: 68,
  package_number: 'DP-00000068',
  invoice_number: '14899',
  qbo_invoice_id: '146',
  dry_run: dryRun,
  previous: figures(1520, 2),
  next: figures(760, 1),
  removed_cells: [{ lot_id: 2 }],
  added_cells: [],
  released_options: [],
  removed_hardware: [],
  added_hardware: [],
  removed_documents: [],
  removed_storage_paths: dryRun ? [] : ['68/release/a.pdf'],
  sent: [],
})

const request: PackageEditRequest = {
  selections: [{ lot_id: 1, draw_number: 1 }],
  hardwareSelections: [],
  releasedOptions: [],
  reason: 'Lot 2 was billed by mistake',
  notes: null,
}

interface Harness {
  deps: InvoiceUpdateDeps
  calls: string[]
  updates: { invoice: Record<string, unknown>; requestId: string }[]
  completed: { updated: { syncToken: string | null; totalAmount: number }; payload: QuickbooksInvoicePayload }[]
  state: InvoiceUpdateContext
}

function harness(
  overrides: Partial<InvoiceUpdateDeps> = {},
  options: {
    context?: Partial<InvoiceUpdateContext>
    live?: QuickbooksInvoiceSnapshot | null
    pkg?: LoadedPackage
  } = {},
): Harness {
  const calls: string[] = []
  const updates: Harness['updates'] = []
  const completed: Harness['completed'] = []
  const state: InvoiceUpdateContext = {
    packageNumber: 'DP-00000068',
    quickbooksStatus: 'CREATED',
    invoiceId: '146',
    docNumber: '14899',
    environment: 'sandbox',
    realmId: '9341',
    totalAmount: 1520,
    payload: storedPayload(),
    difference: null,
    updatePending: false,
    updateRequestId: null,
    ...options.context,
  }
  const live = options.live === undefined ? snapshot() : options.live

  const deps: InvoiceUpdateDeps = {
    loadContext: () => Promise.resolve({ ...state }),
    openSession: (environment) => {
      calls.push('openSession')
      return Promise.resolve({ environment, realmId: '9341', itemId: '19', accessToken: 'tok' })
    },
    readInvoice: () => {
      calls.push('readInvoice')
      return Promise.resolve(live)
    },
    applyEdit: (_id, _request, dryRun) => {
      calls.push(`applyEdit(dryRun=${dryRun})`)
      if (!dryRun) {
        state.updatePending = true
        state.updateRequestId = 'req-new'
      }
      return Promise.resolve(editResult(dryRun))
    },
    removeStoredFile: (path) => {
      calls.push(`remove:${path}`)
      return Promise.resolve()
    },
    loadPackage: () => {
      calls.push('loadPackage')
      return Promise.resolve(options.pkg ?? loaded())
    },
    updateInvoice: (_api, invoice, requestId) => {
      calls.push('updateInvoice')
      updates.push({ invoice, requestId })
      return Promise.resolve({ id: '146', docNumber: '14899', syncToken: '4', totalAmount: 760 })
    },
    complete: (_id, updated, payload) => {
      calls.push('complete')
      completed.push({ updated, payload })
      return Promise.resolve()
    },
    fail: (_id, _message, reusable) => {
      calls.push(`fail(reusable=${reusable})`)
      return Promise.resolve()
    },
    saveInvoicePdf: () => {
      calls.push('saveInvoicePdf')
      return Promise.resolve()
    },
    ...overrides,
  }
  return { deps, calls, updates, completed, state }
}

const apply = (deps: InvoiceUpdateDeps) =>
  updatePackageInvoice(deps, { packageId: 68, action: 'apply', edit: request })

async function refused(deps: InvoiceUpdateDeps, action: 'preview' | 'apply' | 'retry') {
  return await assertRejects(
    () => updatePackageInvoice(deps, { packageId: 68, action, edit: action === 'retry' ? undefined : request }),
    QuickbooksInvoiceUpdateError,
  )
}

Deno.test('apply edits the Package, then replaces the lines of the same invoice and clears the mark', async () => {
  const { deps, calls, updates, completed } = harness()

  const result = await apply(deps)

  assertEquals(calls, [
    'openSession',
    'readInvoice',
    'applyEdit(dryRun=false)',
    'remove:68/release/a.pdf',
    'loadPackage',
    'updateInvoice',
    'complete',
    'saveInvoicePdf',
  ])
  assertEquals(result.action, 'apply')
  if (result.action === 'preview') throw new Error('unreachable')
  assertEquals(result.invoiceId, '146')
  assertEquals(result.docNumber, '14899')
  assertEquals(result.totalAmount, 760)
  assertEquals(result.alreadyInQuickbooks, false)

  // The same invoice: Id, SyncToken, number, date, customer and custom fields come back as QuickBooks had them.
  const sent = updates[0].invoice
  assertEquals(updates[0].requestId, 'req-new')
  assertEquals(sent.Id, '146')
  assertEquals(sent.SyncToken, '3')
  assertEquals(sent.DocNumber, '14899')
  assertEquals(sent.TxnDate, '2026-10-01')
  assertEquals(sent.DueDate, '2026-10-31')
  assertEquals(sent.CustomerRef, { value: '58' })
  assertEquals((sent.CustomField as unknown[]).length, 1)
  // Only the lines changed, and they add up to the Package net.
  const lines = sent.Line as { Amount: number; Description: string; DetailType: string }[]
  assertEquals(lines.map((line) => [line.Description, line.Amount]), [
    ['PHASE 1 LOT #1\nDRAW 1', 800],
    ['RETENTION', -40],
  ])
  assertEquals(lines.every((line) => line.DetailType === 'SalesItemLineDetail'), true)
  assertEquals(lines.reduce((sum, line) => sum + line.Amount, 0), 760)

  assertEquals(completed[0].updated, { syncToken: '4', totalAmount: 760 })
  assertEquals(completed[0].payload.DocNumber, '14899')
  assertEquals(completed[0].payload.Line.map((line) => line.Amount), [800, -40])
})

Deno.test('a preview reads QuickBooks and asks the database for a dry run, and changes nothing', async () => {
  const { deps, calls } = harness()

  const result = await updatePackageInvoice(deps, { packageId: 68, action: 'preview', edit: request })

  assertEquals(calls, ['openSession', 'readInvoice', 'applyEdit(dryRun=true)'])
  assertEquals(result.action, 'preview')
  if (result.action !== 'preview') throw new Error('unreachable')
  assertEquals(result.edit.next.net, 760)
})

// An invoice that was sent with a manual DIFFERENCE line of $4 (limit $5 for the new total of $760).
const WITH_DIFFERENCE = [...OLD_LINES, { description: 'DIFFERENCE', amount: 4 }]

Deno.test('an edit keeps the DIFFERENCE line of the invoice and the total follows it', async () => {
  const answerWithDifference: Partial<InvoiceUpdateDeps> = {
    updateInvoice: (_api, invoice, requestId) => {
      h.updates.push({ invoice, requestId })
      return Promise.resolve({ id: '146', docNumber: '14899', syncToken: '4', totalAmount: 764 })
    },
  }
  const h: Harness = harness(answerWithDifference, {
    context: {
      difference: { description: 'DIFFERENCE', amount: 4 },
      totalAmount: 1524,
      payload: storedPayload(WITH_DIFFERENCE),
    },
    live: snapshot(WITH_DIFFERENCE),
  })

  const result = await apply(h.deps)

  // Looked at first (nothing kept), then edited, then sent.
  assertEquals(h.calls.filter((call) => call.startsWith('applyEdit')), [
    'applyEdit(dryRun=true)',
    'applyEdit(dryRun=false)',
  ])
  const sent = h.updates[0].invoice.Line as { Amount: number; Description: string }[]
  assertEquals(sent.map((line) => [line.Description, line.Amount]), [
    ['PHASE 1 LOT #1\nDRAW 1', 800],
    ['RETENTION', -40],
    ['DIFFERENCE', 4],
  ])
  assertEquals(h.completed[0].payload.Line.map((line) => line.Amount), [800, -40, 4])
  if (result.action === 'preview') throw new Error('unreachable')
  assertEquals(result.totalAmount, 764)
})

Deno.test('QuickBooks answering the Package net without the DIFFERENCE is a failure, not done', async () => {
  const { deps, calls } = harness({}, {
    context: {
      difference: { description: 'DIFFERENCE', amount: 4 },
      totalAmount: 1524,
      payload: storedPayload(WITH_DIFFERENCE),
    },
    live: snapshot(WITH_DIFFERENCE),
  })

  // The default answer of the harness is 760, the net without the difference.
  const error = await assertRejects(() => apply(deps), QuickbooksInvoiceUpdateError)

  assertEquals(error.code, 'TOTAL_MISMATCH')
  assertEquals(calls.includes('complete'), false)
})

Deno.test('an edit that would leave the DIFFERENCE above the limit of the new total is refused before it is saved', async () => {
  const context = {
    difference: { description: 'DIFFERENCE', amount: 8 },
    totalAmount: 1528,
    payload: storedPayload([...OLD_LINES, { description: 'DIFFERENCE', amount: 8 }]),
  }
  const live = snapshot([...OLD_LINES, { description: 'DIFFERENCE', amount: 8 }])

  for (const action of ['preview', 'apply'] as const) {
    const { deps, calls } = harness({}, { context, live })
    const error = await refused(deps, action)

    assertEquals(error.code, 'DIFFERENCE_TOO_LARGE')
    assertEquals(
      error.message.startsWith('The difference of $8.00 is greater than the $5.00 allowed for an invoice of $760.00.'),
      true,
    )
    // Only the look (a dry run) happened: the Package was not edited and QuickBooks was not touched.
    assertEquals(calls.includes('applyEdit(dryRun=false)'), false)
    assertEquals(calls.includes('updateInvoice'), false)
  }
})

Deno.test('a retry rebuilds the invoice with its DIFFERENCE line too', async () => {
  const h: Harness = harness({
    updateInvoice: (_api, invoice, requestId) => {
      h.updates.push({ invoice, requestId })
      return Promise.resolve({ id: '146', docNumber: '14899', syncToken: '4', totalAmount: 764 })
    },
  }, {
    context: {
      difference: { description: 'DIFFERENCE', amount: 4 },
      totalAmount: 1524,
      payload: storedPayload(WITH_DIFFERENCE),
      updatePending: true,
      updateRequestId: 'req-kept',
    },
    live: snapshot(WITH_DIFFERENCE),
  })

  await updatePackageInvoice(h.deps, { packageId: 68, action: 'retry' })

  const amounts = (h.updates[0].invoice.Line as { Amount: number }[]).map((row) => row.Amount)
  assertEquals(amounts, [800, -40, 4])
  assertEquals(h.updates[0].requestId, 'req-kept')
})

Deno.test('nothing is edited when QuickBooks shows a payment, a credit or a different balance', async () => {
  for (const patch of [{ linkedTransactions: ['Payment'] }, { balance: 1000 }]) {
    for (const action of ['preview', 'apply'] as const) {
      const { deps, calls } = harness({}, { live: snapshot(OLD_LINES, patch) })
      const error = await refused(deps, action)
      assertEquals(error.code, 'HAS_PAYMENTS')
      assertEquals(calls.some((call) => call.startsWith('applyEdit') || call === 'updateInvoice'), false)
    }
  }
})

Deno.test('nothing is edited when the invoice was voided or deleted in QuickBooks', async () => {
  const voided = harness({}, { live: snapshot([{ description: 'VOID', amount: 0 }], { totalAmount: 0, balance: 0 }) })
  assertEquals((await refused(voided.deps, 'apply')).code, 'VOIDED_IN_QUICKBOOKS')
  assertEquals(voided.calls.includes('applyEdit(dryRun=false)'), false)

  const missing = harness({}, { live: null })
  assertEquals((await refused(missing.deps, 'apply')).code, 'MISSING_IN_QUICKBOOKS')
  assertEquals(missing.calls.includes('applyEdit(dryRun=false)'), false)
})

Deno.test('nothing is edited when somebody changed the invoice in QuickBooks after it was sent', async () => {
  const otherLines = [{ description: 'PHASE 1 LOTS #1-2\nDRAW 1', amount: 1500 }, { description: 'RETENTION', amount: -80 }]
  const otherTotal = harness({}, { live: snapshot(otherLines) })
  assertEquals((await refused(otherTotal.deps, 'apply')).code, 'EDITED_IN_QUICKBOOKS')

  // Same total, different lines.
  const swapped = [{ description: 'SOMETHING ELSE', amount: 1600 }, { description: 'RETENTION', amount: -80 }]
  const otherBody = harness({}, { live: snapshot(swapped) })
  assertEquals((await refused(otherBody.deps, 'apply')).code, 'EDITED_IN_QUICKBOOKS')
  assertEquals(otherBody.calls.includes('applyEdit(dryRun=false)'), false)
})

Deno.test('line breaks and spacing do not make an untouched invoice look edited', async () => {
  const spaced = OLD_LINES.map((line) => ({ ...line, description: line.description.replace('\n', '\r\n  ') }))
  const { deps, calls } = harness({}, { live: snapshot(spaced) })

  await apply(deps)

  assertEquals(calls.includes('updateInvoice'), true)
})

Deno.test('the invoice is only updated in the company it was created in', async () => {
  const { deps, calls } = harness({
    openSession: (environment) =>
      Promise.resolve({ environment, realmId: 'other', itemId: '19', accessToken: 'tok' }),
  })
  assertEquals((await refused(deps, 'apply')).code, 'WRONG_COMPANY')
  assertEquals(calls.includes('applyEdit(dryRun=false)'), false)
})

Deno.test('only an invoice that exists can be updated, and one change at a time', async () => {
  const none = harness({}, { context: { quickbooksStatus: 'NOT_CREATED', invoiceId: null } })
  assertEquals((await refused(none.deps, 'apply')).code, 'NOT_CREATED')

  const pending = harness({}, { context: { updatePending: true, updateRequestId: 'r' } })
  assertEquals((await refused(pending.deps, 'apply')).code, 'UPDATE_PENDING')
  assertEquals((await refused(pending.deps, 'preview')).code, 'UPDATE_PENDING')

  const nothing = harness()
  assertEquals((await refused(nothing.deps, 'retry')).code, 'NOTHING_PENDING')
})

Deno.test('a refusal from QuickBooks keeps the change waiting and gets a request id of its own', async () => {
  const { deps, calls } = harness({
    updateInvoice: () => Promise.reject(new QuickbooksApiError('Updating the QuickBooks invoice failed: stale object', 400, true)),
  })

  await assertRejects(() => apply(deps), QuickbooksApiError)

  assertEquals(calls.filter((call) => call.startsWith('fail')), ['fail(reusable=false)'])
  assertEquals(calls.includes('complete'), false)
})

Deno.test('a network failure keeps the request id, because QuickBooks may have applied the change', async () => {
  const { deps, calls } = harness({
    updateInvoice: () => Promise.reject(new QuickbooksApiError('Updating the QuickBooks invoice failed: timeout', null, false)),
  })

  await assertRejects(() => apply(deps), QuickbooksApiError)

  assertEquals(calls.filter((call) => call.startsWith('fail')), ['fail(reusable=true)'])
  assertEquals(calls.includes('complete'), false)
})

Deno.test('an answer with another total than the Package is recorded as a failure, not as done', async () => {
  const { deps, calls } = harness({
    updateInvoice: () => Promise.resolve({ id: '146', docNumber: '14899', syncToken: '4', totalAmount: 999 }),
  })

  const error = await assertRejects(() => apply(deps), QuickbooksInvoiceUpdateError)

  assertEquals(error.code, 'TOTAL_MISMATCH')
  assertEquals(calls.filter((call) => call.startsWith('fail')), ['fail(reusable=true)'])
  assertEquals(calls.includes('complete'), false)
})

Deno.test('lines that cannot be built are recorded as a failure after the edit, so the change can be sent again', async () => {
  const broken = loaded()
  broken.source.invoice = { net_amount: 700 }
  const { deps, calls } = harness({}, { pkg: broken })

  await assertRejects(() => apply(deps))

  assertEquals(calls.filter((call) => call.startsWith('fail')), ['fail(reusable=true)'])
  assertEquals(calls.includes('updateInvoice'), false)
})

Deno.test('a PDF that cannot be saved is a warning, never a failure of the update', async () => {
  const { deps } = harness({ saveInvoicePdf: () => Promise.reject(new Error('storage is down')) })

  const result = await apply(deps)

  if (result.action === 'preview') throw new Error('unreachable')
  assertEquals(result.warnings.length, 1)
  assertEquals(result.warnings[0].includes('storage is down'), true)
})

Deno.test('a retry sends the saved change to the same invoice with the request id that was kept', async () => {
  const { deps, calls, updates } = harness({}, { context: { updatePending: true, updateRequestId: 'req-kept' } })

  const result = await updatePackageInvoice(deps, { packageId: 68, action: 'retry' })

  assertEquals(calls, ['openSession', 'readInvoice', 'loadPackage', 'updateInvoice', 'complete', 'saveInvoicePdf'])
  assertEquals(updates[0].requestId, 'req-kept')
  if (result.action === 'preview') throw new Error('unreachable')
  assertEquals(result.edit, null)
  assertEquals(result.alreadyInQuickbooks, false)
})

Deno.test('a retry whose lines already reached QuickBooks only clears the mark', async () => {
  const { deps, calls, completed } = harness({}, {
    context: { updatePending: true, updateRequestId: 'req-kept' },
    live: snapshot(NEW_LINES, {}, '4'),
  })

  const result = await updatePackageInvoice(deps, { packageId: 68, action: 'retry' })

  assertEquals(calls.includes('updateInvoice'), false)
  assertEquals(calls.includes('complete'), true)
  if (result.action === 'preview') throw new Error('unreachable')
  assertEquals(result.alreadyInQuickbooks, true)
  assertEquals(completed[0].updated, { syncToken: '4', totalAmount: 760 })
})

Deno.test('a retry is refused when QuickBooks has neither the old lines nor the new ones', async () => {
  const strangers = [{ description: 'SOMETHING ELSE', amount: 1520 }]
  const { deps, calls } = harness({}, {
    context: { updatePending: true, updateRequestId: 'req-kept' },
    live: snapshot(strangers),
  })

  const error = await refused(deps, 'retry')

  assertEquals(error.code, 'EDITED_IN_QUICKBOOKS')
  assertEquals(calls.includes('updateInvoice'), false)
})

Deno.test('a retry is refused when a payment arrived in QuickBooks meanwhile', async () => {
  const { deps } = harness({}, {
    context: { updatePending: true, updateRequestId: 'req-kept' },
    live: snapshot(OLD_LINES, { linkedTransactions: ['Payment'], balance: 100 }),
  })

  assertEquals((await refused(deps, 'retry')).code, 'HAS_PAYMENTS')
})

Deno.test('the request body is checked before anything is touched', () => {
  const ok = parseEditRequest({
    selections: [{ lot_id: 1, draw_number: 2 }],
    hardwareSelections: [{ lot_id: 3, event_type: 'EXT' }],
    releasedOptions: [{ lot_id: 1, option_id: 5, unit_no: 1 }],
    reason: '  Billed twice  ',
    notes: '  hello ',
  })
  assertEquals(ok.reason, 'Billed twice')
  assertEquals(ok.notes, 'hello')
  assertEquals(ok.hardwareSelections, [{ lot_id: 3, event_type: 'EXT' }])

  const invalid: unknown[] = [
    { selections: [], hardwareSelections: [], reason: 'x' },
    { selections: [{ lot_id: 1, draw_number: 1 }], reason: '' },
    { selections: [{ lot_id: 1, draw_number: 1 }], reason: 'x'.repeat(501) },
    { selections: [{ lot_id: 0, draw_number: 1 }], reason: 'x' },
    { selections: [{ lot_id: 1, draw_number: 1.5 }], reason: 'x' },
    { selections: 'nope', reason: 'x' },
    { selections: [{ lot_id: 1, draw_number: 1 }], hardwareSelections: [{ lot_id: 1, event_type: 'HVAC' }], reason: 'x' },
    { selections: [{ lot_id: 1, draw_number: 1 }], releasedOptions: [{ lot_id: 1, option_id: 1 }], reason: 'x' },
    { selections: [{ lot_id: 1, draw_number: 1 }], reason: 'x', notes: 'n'.repeat(501) },
    null,
  ]
  for (const body of invalid) {
    let code = ''
    try {
      parseEditRequest(body)
    } catch (error) {
      code = (error as QuickbooksInvoiceUpdateError).code
    }
    assertEquals(code, 'INVALID_REQUEST', JSON.stringify(body))
  }
})
