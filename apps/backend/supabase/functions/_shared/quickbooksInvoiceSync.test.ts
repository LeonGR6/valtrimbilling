import { assertEquals, assertRejects } from '@std/assert'
import { QuickbooksApiError } from './quickbooksApi.ts'
import { QuickbooksCustomerError } from './quickbooksCustomer.ts'
import { QuickbooksInvoiceError } from './quickbooksInvoice.ts'
import {
  type ClaimResult,
  createPackageInvoice,
  type InvoiceSyncDeps,
  QuickbooksSyncConflictError,
} from './quickbooksInvoiceSync.ts'
import type { LoadedPackage } from './quickbooksPackageSource.ts'

const loaded = (patch: Partial<LoadedPackage['source']['package']> = {}, quickbooksStatus = 'NOT_CREATED'): LoadedPackage => ({
  packageId: 68,
  packageNumber: 'DP-00000068',
  quickbooksStatus,
  builder: { id: 1, name: 'Trumark' },
  job: { code: '1307', community: 'Sunset Ridge' },
  paymentTermsDays: 30,
  quickbooksEnvironment: null,
  syncInvoiceNumber: null,
  syncEnvironment: null,
  source: {
    package: { package_type: 'DRAW', status: 'DRAFT', invoice_line_format: 'LOT_SCOPE', ...patch },
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

interface Harness {
  deps: InvoiceSyncDeps
  calls: string[]
  sent: { requestId: string; payload: unknown }[]
}

function harness(overrides: Partial<InvoiceSyncDeps> = {}, pkg: LoadedPackage = loaded()): Harness {
  const calls: string[] = []
  const sent: { requestId: string; payload: unknown }[] = []
  const deps: InvoiceSyncDeps = {
    loadPackage: () => Promise.resolve(pkg),
    openSession: (environment) => {
      calls.push('openSession')
      return Promise.resolve({
        environment,
        realmId: '9341',
        itemId: '19',
        accessToken: 'tok',
      })
    },
    isNumberTaken: () => Promise.resolve(false),
    numberCandidates: () => Promise.resolve([{ number: '15026', voided: false }]),
    releaseVoidedNumber: () => Promise.resolve(false),
    findInvoiceByNumber: () => Promise.resolve(null),
    getCustomerMapping: () => Promise.resolve(null),
    saveCustomerMapping: () => {
      calls.push('saveCustomerMapping')
      return Promise.resolve()
    },
    clearCustomerMapping: () => {
      calls.push('clearCustomerMapping')
      return Promise.resolve()
    },
    verifyCustomer: () => {
      calls.push('verifyCustomer')
      return Promise.resolve({ id: '99', displayName: 'Trumark Homes', active: true })
    },
    getCustomFieldDefinitions: () =>
      Promise.resolve([
        { definitionId: '1', label: 'Job Name', enabled: true },
        { definitionId: '2', label: 'Job #', enabled: true },
      ]),
    searchCustomers: () => {
      calls.push('searchCustomers')
      return Promise.resolve([{ id: '58', displayName: 'Trumark' }])
    },
    claim: (_id, _environment, _realm, invoiceNumber): Promise<ClaimResult> => {
      calls.push('claim')
      return Promise.resolve({ claimed: true, requestId: 'req-1', invoiceNumber })
    },
    createInvoice: (_api, payload, requestId) => {
      calls.push('createInvoice')
      sent.push({ requestId, payload })
      return Promise.resolve({ id: '147', docNumber: payload.DocNumber ?? null, syncToken: '0', totalAmount: 760 })
    },
    complete: () => {
      calls.push('complete')
      return Promise.resolve()
    },
    saveInvoicePdf: () => {
      calls.push('saveInvoicePdf')
      return Promise.resolve()
    },
    fail: (_id, _message, reusable) => {
      calls.push(`fail(reusable=${reusable})`)
      return Promise.resolve()
    },
    ...overrides,
  }
  return { deps, calls, sent }
}

const run = (
  deps: InvoiceSyncDeps,
  dryRun = false,
  extra: { environment?: 'sandbox' | 'production'; invoiceNumber?: string | null } = {},
) =>
  createPackageInvoice(deps, {
    packageId: 68,
    txnDate: '2026-10-09',
    dryRun,
    environment: 'sandbox',
    invoiceNumber: '15001',
    ...extra,
  })

Deno.test('dry run previews the invoice and changes nothing', async () => {
  const { deps, calls } = harness()

  const result = await run(deps, true)

  assertEquals(calls, ['openSession', 'searchCustomers'])
  assertEquals(result.dryRun, true)
  if (!result.dryRun) return
  assertEquals(result.customer, {
    customerId: '58',
    displayName: 'Trumark',
    source: 'quickbooks',
    replacedStale: false,
  })
  assertEquals(result.invoice.DocNumber, '15001')
  assertEquals(result.invoice.TxnDate, '2026-10-09')
  assertEquals(result.invoice.DueDate, '2026-11-08')
  assertEquals(result.invoice.Line.map((line) => [line.Description, line.Amount]), [
    ['PHASE 1 LOT #1\nDRAW 1', 800],
    ['RETENTION', -40],
  ])
})

Deno.test('creates the invoice: claim, create with the claimed request id, then record it', async () => {
  const { deps, calls, sent } = harness()

  const result = await run(deps)

  assertEquals(calls, [
    'openSession',
    'searchCustomers',
    'saveCustomerMapping',
    'claim',
    'createInvoice',
    'complete',
    'saveInvoicePdf',
  ])
  assertEquals(sent[0].requestId, 'req-1')
  assertEquals(result.dryRun, false)
  if (result.dryRun) return
  assertEquals(result.invoiceId, '147')
  assertEquals(result.docNumber, '15001')
})

Deno.test('a saved customer mapping is used without searching or saving again', async () => {
  const { deps, calls } = harness({
    getCustomerMapping: () => Promise.resolve({ customerId: '99', displayName: 'Trumark Homes' }),
  })

  await run(deps)

  assertEquals(calls, ['openSession', 'verifyCustomer', 'claim', 'createInvoice', 'complete', 'saveInvoicePdf'])
})

Deno.test('fills Job Name with the community and Job # with the job code', async () => {
  const { deps, sent } = harness()

  await run(deps)

  assertEquals((sent[0].payload as { CustomField: unknown }).CustomField, [
    { DefinitionId: '1', Name: 'Job Name', Type: 'StringType', StringValue: 'Sunset Ridge' },
    { DefinitionId: '2', Name: 'Job #', Type: 'StringType', StringValue: '1307' },
  ])
})

Deno.test('says so in the preview when QuickBooks has no Job Name or Job # field', async () => {
  const { deps } = harness({ getCustomFieldDefinitions: () => Promise.resolve([]) })

  const result = await run(deps, true)

  assertEquals(result.warnings.length, 2)
  assertEquals(result.warnings[0].includes('no "Job Name" custom field'), true)
  assertEquals('CustomField' in (result.dryRun ? result.invoice : {}), false)
})

Deno.test('failing to read the custom fields never blocks the invoice', async () => {
  const { deps, calls } = harness({
    getCustomFieldDefinitions: () => Promise.reject(new Error('HTTP 403')),
  })

  const result = await run(deps)

  assertEquals(calls.at(-1), 'saveInvoicePdf')
  assertEquals(result.warnings, ['The QuickBooks custom fields could not be read: HTTP 403'])
})

Deno.test('a stale saved Customer is dropped on a real send but left alone in a preview', async () => {
  const stale = {
    getCustomerMapping: () => Promise.resolve({ customerId: '99', displayName: 'Trumark Homes' }),
    verifyCustomer: () => Promise.resolve(null),
  }

  const real = harness(stale)
  const sent = await run(real.deps)
  assertEquals(real.calls.slice(0, 5), [
    'openSession',
    'clearCustomerMapping',
    'searchCustomers',
    'saveCustomerMapping',
    'claim',
  ])
  assertEquals(sent.warnings[0].includes('no longer existed'), true)

  const preview = harness(stale)
  const result = await run(preview.deps, true)
  assertEquals(preview.calls.includes('clearCustomerMapping'), false)
  assertEquals(result.dryRun && result.customer.replacedStale, true)
})

Deno.test('saves the QuickBooks PDF of the invoice once it is recorded', async () => {
  const saved: unknown[] = []
  const { deps, calls } = harness({
    saveInvoicePdf: (_api, input) => {
      saved.push(input)
      return Promise.resolve()
    },
  })

  await run(deps)

  assertEquals(saved, [{ packageId: 68, invoiceId: '147', documentNumber: '15001' }])
  assertEquals(calls.includes('complete'), true)
})

Deno.test('a PDF that cannot be saved is reported but never undoes the invoice', async () => {
  const { deps, calls } = harness({
    saveInvoicePdf: () => Promise.reject(new Error('Storage is down.')),
  })

  const result = await run(deps)

  assertEquals(calls.at(-1), 'complete')
  assertEquals(calls.some((call) => call.startsWith('fail')), false)
  assertEquals(result.dryRun, false)
  assertEquals(result.warnings.length, 1)
  assertEquals(result.warnings[0].includes('its PDF could not be saved: Storage is down.'), true)
  assertEquals(result.warnings[0].includes('Save PDF'), true)
})

Deno.test('a preview never saves a PDF', async () => {
  const { deps, calls } = harness()

  await run(deps, true)

  assertEquals(calls.includes('saveInvoicePdf'), false)
})

Deno.test('a Builder missing from QuickBooks creates and claims nothing', async () => {
  const { deps, calls } = harness({ searchCustomers: () => Promise.resolve([]) })

  const error = await assertRejects(() => run(deps), QuickbooksCustomerError)

  assertEquals(error.code, 'CUSTOMER_NOT_FOUND')
  assertEquals(calls, ['openSession'])
})

Deno.test('a refused claim stops before QuickBooks is called', async () => {
  const { deps, calls } = harness({
    claim: () => Promise.resolve({ claimed: false, reason: 'IN_PROGRESS' }),
  })

  const error = await assertRejects(() => run(deps), QuickbooksSyncConflictError)

  assertEquals(error.reason, 'IN_PROGRESS')
  assertEquals(calls.includes('createInvoice'), false)
})

Deno.test('a Package already created in QuickBooks is rejected before contacting it', async () => {
  const { deps, calls } = harness({}, loaded({}, 'CREATED'))

  const error = await assertRejects(() => run(deps), QuickbooksSyncConflictError)

  assertEquals(error.reason, 'ALREADY_CREATED')
  assertEquals(calls, [])
})

Deno.test('voided and retention release packages never reach QuickBooks', async () => {
  for (const patch of [{ status: 'VOIDED' }, { package_type: 'RETENTION_RELEASE' }]) {
    const { deps, calls } = harness({}, loaded(patch))
    const error = await assertRejects(() => run(deps), QuickbooksInvoiceError)
    assertEquals(error.code, 'UNSUPPORTED_PACKAGE')
    assertEquals(calls, [])
  }
})

Deno.test('a missing Product is reported before any customer lookup', async () => {
  const { deps, calls } = harness({
    openSession: () => {
      calls.push('openSession')
      return Promise.resolve({ environment: 'sandbox', realmId: '9341', itemId: null, accessToken: 'tok' })
    },
  })

  const error = await assertRejects(() => run(deps), QuickbooksInvoiceError)

  assertEquals(error.code, 'PRODUCT_MISSING')
  assertEquals(calls, ['openSession'])
})

Deno.test('a definite QuickBooks rejection releases the claim with a fresh request id next time', async () => {
  const { deps, calls } = harness({
    createInvoice: () => Promise.reject(new QuickbooksApiError('Customer not found', 400, true)),
  })

  await assertRejects(() => run(deps), QuickbooksApiError, 'Customer not found')

  assertEquals(calls.slice(-2), ['claim', 'fail(reusable=false)'])
})

Deno.test('an ambiguous failure keeps the request id so a retry cannot duplicate the invoice', async () => {
  const network = harness({
    createInvoice: () => Promise.reject(new QuickbooksApiError('socket closed', null, false)),
  })
  await assertRejects(() => run(network.deps), QuickbooksApiError)
  assertEquals(network.calls.at(-1), 'fail(reusable=true)')

  const unknown = harness({ createInvoice: () => Promise.reject(new Error('boom')) })
  await assertRejects(() => run(unknown.deps), Error, 'boom')
  assertEquals(unknown.calls.at(-1), 'fail(reusable=true)')
})

Deno.test('if the created invoice cannot be recorded the claim stays reusable', async () => {
  const { deps, calls } = harness({
    complete: () => Promise.reject(new Error('database down')),
  })

  await assertRejects(() => run(deps), Error, 'database down')

  assertEquals(calls.slice(-2), ['createInvoice', 'fail(reusable=true)'])
})

Deno.test('a real send uses the typed invoice number as the QuickBooks DocNumber', async () => {
  const sent: (string | undefined)[] = []
  const claimed: unknown[][] = []
  const { deps } = harness({
    claim: (...args) => {
      claimed.push(args)
      return Promise.resolve({ claimed: true, requestId: 'req-1', invoiceNumber: '15027' })
    },
    createInvoice: (_api, payload) => {
      sent.push(payload.DocNumber)
      return Promise.resolve({ id: '147', docNumber: '15027', syncToken: '0', totalAmount: 760 })
    },
  })

  const result = await run(deps, false, { environment: 'production', invoiceNumber: ' 15027 ' })

  assertEquals(claimed, [[68, 'production', '9341', '15027']])
  assertEquals(sent, ['15027'])
  assertEquals(result.dryRun === false && result.docNumber, '15027')
  assertEquals(result.dryRun === false && result.environment, 'production')
})

Deno.test('the environment given is the one the session is opened for and the invoice goes to', async () => {
  const opened: string[] = []
  const { deps } = harness({
    openSession: (environment) => {
      opened.push(environment)
      return Promise.resolve({ environment, realmId: '1111', itemId: '77', accessToken: 'tok' })
    },
  })

  const result = await run(deps, true, { environment: 'production' })

  assertEquals(opened, ['production'])
  assertEquals(result.environment, 'production')
})

Deno.test('a real send without a valid invoice number never reaches QuickBooks', async () => {
  for (const invoiceNumber of [null, '', '   ', 'bad number!', 'X'.repeat(22)]) {
    const { deps, calls } = harness()
    const error = await assertRejects(() => run(deps, false, { invoiceNumber }), QuickbooksInvoiceError)
    assertEquals(error.code, 'INVALID_INPUT')
    assertEquals(calls, [])
  }
})

Deno.test('a number another Package already uses in this environment is refused before sending', async () => {
  const { deps, calls } = harness({ isNumberTaken: () => Promise.resolve(true) })

  const error = await assertRejects(() => run(deps), QuickbooksSyncConflictError)

  assertEquals(error.reason, 'NUMBER_IN_USE')
  assertEquals(calls.includes('claim'), false)
})

Deno.test('a number that already exists in QuickBooks is refused before sending', async () => {
  const { deps, calls } = harness({ findInvoiceByNumber: () => Promise.resolve({ id: '88' }) })

  const error = await assertRejects(() => run(deps, false, { environment: 'production' }), QuickbooksInvoiceError)

  assertEquals(error.code, 'NUMBER_IN_USE')
  assertEquals(error.message.includes('QuickBooks Production'), true)
  assertEquals(calls.includes('claim'), false)
})

Deno.test('a preview reports whether the typed number is free, and the last one used', async () => {
  const taken = harness({
    isNumberTaken: () => Promise.resolve(true),
    findInvoiceByNumber: () => Promise.resolve({ id: '88' }),
  })
  const used = await run(taken.deps, true)
  assertEquals(used.dryRun && used.numberCheck, {
    number: '15001',
    inDatabase: true,
    inQuickbooks: true,
    last: '15026',
    current: null,
  })

  const free = await run(harness().deps, true, { invoiceNumber: '15027' })
  assertEquals(free.dryRun && free.numberCheck.inDatabase, false)
  assertEquals(free.dryRun && free.numberCheck.inQuickbooks, false)

  const blank = await run(harness().deps, true, { invoiceNumber: null })
  assertEquals(blank.dryRun && blank.numberCheck.number, null)
  assertEquals(blank.dryRun && blank.invoice.DocNumber, undefined)
})

Deno.test('a voided invoice deleted in QuickBooks no longer counts as the last number used, and its number is freed', async () => {
  const released: string[] = []
  const { deps } = harness({
    numberCandidates: () => Promise.resolve([
      { number: '16002', voided: true },
      { number: '14879', voided: false },
      { number: '14878', voided: false },
    ]),
    findInvoiceByNumber: () => Promise.resolve(null),
    releaseVoidedNumber: (_environment, number) => {
      released.push(number)
      return Promise.resolve(true)
    },
  })

  const result = await run(deps, true, { environment: 'production', invoiceNumber: '14880' })

  assertEquals(result.dryRun && result.numberCheck.last, '14879')
  assertEquals(released, ['16002'])
})

Deno.test('a voided invoice that QuickBooks still has keeps its number as the last one used', async () => {
  const { deps } = harness({
    numberCandidates: () => Promise.resolve([
      { number: '16002', voided: true },
      { number: '14879', voided: false },
    ]),
    findInvoiceByNumber: (_api, number) => Promise.resolve(number === '16002' ? { id: '12' } : null),
    releaseVoidedNumber: () => Promise.reject(new Error('should not release a voided invoice QuickBooks still has')),
  })

  const result = await run(deps, true, { environment: 'production', invoiceNumber: '14880' })

  assertEquals(result.dryRun && result.numberCheck.last, '16002')
})

Deno.test('QuickBooks is only asked about voided numbers, from the highest down to the first that is real', async () => {
  const asked: string[] = []
  const { deps } = harness({
    numberCandidates: () => Promise.resolve([
      { number: '16004', voided: true },
      { number: '16003', voided: true },
      { number: '14879', voided: false },
      { number: '14700', voided: true },
    ]),
    findInvoiceByNumber: (_api, number) => {
      asked.push(number)
      return Promise.resolve(null)
    },
    releaseVoidedNumber: () => Promise.resolve(true),
  })

  const result = await run(deps, true, { environment: 'production', invoiceNumber: null })

  assertEquals(result.dryRun && result.numberCheck.last, '14879')
  assertEquals(asked, ['16004', '16003'])
})

Deno.test('with every number voided and deleted there is no last number', async () => {
  const { deps } = harness({
    numberCandidates: () => Promise.resolve([{ number: '16002', voided: true }]),
    findInvoiceByNumber: () => Promise.resolve(null),
    releaseVoidedNumber: () => Promise.resolve(true),
  })

  const result = await run(deps, true, { invoiceNumber: null })

  assertEquals(result.dryRun && result.numberCheck.last, null)
})

Deno.test('a number held by a voided invoice that was deleted in QuickBooks can be used again', async () => {
  const released: string[] = []
  const { deps, calls } = harness({
    isNumberTaken: () => Promise.resolve(true),
    findInvoiceByNumber: () => Promise.resolve(null),
    releaseVoidedNumber: (_environment, number) => {
      released.push(number)
      return Promise.resolve(true)
    },
  })

  const preview = await run(deps, true, { environment: 'production', invoiceNumber: '16002' })
  assertEquals(preview.dryRun && preview.numberCheck.inDatabase, false)
  assertEquals(preview.dryRun && preview.numberCheck.inQuickbooks, false)

  const sent = await run(deps, false, { environment: 'production', invoiceNumber: '16002' })
  assertEquals(sent.dryRun, false)
  assertEquals(calls.includes('createInvoice'), true)
  assertEquals(released.includes('16002'), true)
})

Deno.test('a number held by an invoice that is not voided stays taken', async () => {
  const { deps, calls } = harness({
    isNumberTaken: () => Promise.resolve(true),
    findInvoiceByNumber: () => Promise.resolve(null),
    releaseVoidedNumber: () => Promise.resolve(false),
  })

  const error = await assertRejects(() => run(deps), QuickbooksSyncConflictError)

  assertEquals(error.reason, 'NUMBER_IN_USE')
  assertEquals(calls.includes('claim'), false)
})

Deno.test('a number QuickBooks still has is never released, voided or not', async () => {
  const { deps } = harness({
    isNumberTaken: () => Promise.resolve(true),
    findInvoiceByNumber: () => Promise.resolve({ id: '88' }),
    releaseVoidedNumber: () => Promise.reject(new Error('should not release a number QuickBooks has')),
  })

  const preview = await run(deps, true)

  assertEquals(preview.dryRun && preview.numberCheck.inDatabase, true)
  assertEquals(preview.dryRun && preview.numberCheck.inQuickbooks, true)
})

Deno.test('the Package own number from an earlier attempt is not a clash when it is retried', async () => {
  const retry: LoadedPackage = {
    ...loaded({}, 'SYNC_ERROR'),
    syncEnvironment: 'sandbox',
    syncInvoiceNumber: '15001',
    quickbooksEnvironment: 'sandbox',
  }
  const { deps, calls } = harness({
    isNumberTaken: () => Promise.reject(new Error('should not ask')),
    findInvoiceByNumber: () => Promise.reject(new Error('should not ask')),
  }, retry)

  const result = await run(deps)

  assertEquals(calls.includes('createInvoice'), true)
  assertEquals(result.dryRun, false)

  const preview = await run(harness({}, retry).deps, true)
  assertEquals(preview.dryRun && preview.numberCheck.current, '15001')
})

Deno.test('an attempt in the other environment is warned about and refused when it may have reached QuickBooks', async () => {
  const earlier: LoadedPackage = {
    ...loaded({}, 'SYNC_ERROR'),
    syncEnvironment: 'production',
    syncInvoiceNumber: '15030',
    quickbooksEnvironment: 'production',
  }

  const preview = await run(harness({}, earlier).deps, true)
  assertEquals(preview.warnings.some((warning) => warning.includes('last attempted in QuickBooks Production')), true)
  assertEquals(preview.dryRun && preview.numberCheck.current, null)

  const { deps } = harness({
    claim: () => Promise.resolve({ claimed: false, reason: 'OTHER_ENVIRONMENT', environment: 'production' }),
  }, earlier)
  const error = await assertRejects(() => run(deps), QuickbooksSyncConflictError)
  assertEquals(error.reason, 'OTHER_ENVIRONMENT')
  assertEquals(error.message.includes('Switch to Production'), true)
})

Deno.test('a preview takes no number and does not claim', async () => {
  const { deps, calls } = harness()

  await run(deps, true)

  assertEquals(calls.includes('claim'), false)
})

Deno.test('a Price Adjustment is previewed and sent like any other Package', async () => {
  const adjustment: LoadedPackage = {
    ...loaded({ package_type: 'PRICE_ADJUSTMENT' }),
    packageId: 301,
    packageNumber: 'PA-00000301',
    source: {
      package: { package_type: 'PRICE_ADJUSTMENT', status: 'DRAFT', invoice_line_format: 'LOT_SCOPE' },
      draws: [],
      hardwareLines: [],
      adjustmentLines: [
        {
          source_package_number: 'DP-00000035',
          line_kind: 'DRAW',
          lot_number: '12',
          phase_code: '1',
          building: '1',
          draw_number: 2,
          hardware_event_type: null,
          gross: '400.00',
          retention: '20.00',
          wrap: '8.00',
        },
      ],
      invoice: { net_amount: '372.00' },
    },
  }

  const preview = await run(harness({}, adjustment).deps, true)
  assertEquals(preview.dryRun, true)
  if (!preview.dryRun) return
  assertEquals(preview.invoice.PrivateNote, 'ValtrimBilling PA-00000301')
  assertEquals(preview.invoice.Line.map((row) => [row.Description, row.Amount]), [
    ['PHASE 1 LOT #12\nPRICE ADJUSTMENT DP-00000035 · DRAW 2', 400],
    ['RETENTION', -20],
    ['WRAP', -8],
  ])

  const { deps, calls, sent } = harness({}, adjustment)
  const result = await run(deps)

  assertEquals(calls.includes('claim'), true)
  assertEquals(calls.includes('createInvoice'), true)
  assertEquals(calls.at(-1), 'saveInvoicePdf')
  assertEquals(sent.length, 1)
  assertEquals(result.dryRun, false)
})

Deno.test('an adjustment whose lines do not match its invoice never reaches QuickBooks', async () => {
  const broken: LoadedPackage = {
    ...loaded({ package_type: 'PRICE_ADJUSTMENT' }),
    source: {
      package: { package_type: 'PRICE_ADJUSTMENT', status: 'DRAFT', invoice_line_format: 'LOT_SCOPE' },
      draws: [],
      hardwareLines: [],
      adjustmentLines: [],
      invoice: { net_amount: '372.00' },
    },
  }
  const { deps, calls } = harness({}, broken)

  const error = await assertRejects(() => run(deps), QuickbooksInvoiceError)

  assertEquals(error.code, 'INVALID_INPUT')
  assertEquals(calls, [])
})
