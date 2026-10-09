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
  paymentTermsDays: 30,
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
    openSession: () => {
      calls.push('openSession')
      return Promise.resolve({
        environment: 'sandbox',
        realmId: '9341',
        itemId: '19',
        accessToken: 'tok',
      })
    },
    getCustomerMapping: () => Promise.resolve(null),
    saveCustomerMapping: () => {
      calls.push('saveCustomerMapping')
      return Promise.resolve()
    },
    searchCustomers: () => {
      calls.push('searchCustomers')
      return Promise.resolve([{ id: '58', displayName: 'Trumark' }])
    },
    claim: (): Promise<ClaimResult> => {
      calls.push('claim')
      return Promise.resolve({ claimed: true, requestId: 'req-1' })
    },
    createInvoice: (_api, payload, requestId) => {
      calls.push('createInvoice')
      sent.push({ requestId, payload })
      return Promise.resolve({ id: '147', docNumber: 'DP-00000068', syncToken: '0', totalAmount: 760 })
    },
    complete: () => {
      calls.push('complete')
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

const run = (deps: InvoiceSyncDeps, dryRun = false) =>
  createPackageInvoice(deps, { packageId: 68, txnDate: '2026-10-09', dryRun })

Deno.test('dry run previews the invoice and changes nothing', async () => {
  const { deps, calls } = harness()

  const result = await run(deps, true)

  assertEquals(calls, ['openSession', 'searchCustomers'])
  assertEquals(result.dryRun, true)
  if (!result.dryRun) return
  assertEquals(result.customer, { customerId: '58', displayName: 'Trumark', source: 'quickbooks' })
  assertEquals(result.invoice.DocNumber, 'DP-00000068')
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

  assertEquals(calls, ['openSession', 'searchCustomers', 'saveCustomerMapping', 'claim', 'createInvoice', 'complete'])
  assertEquals(sent[0].requestId, 'req-1')
  assertEquals(result.dryRun, false)
  if (result.dryRun) return
  assertEquals(result.invoiceId, '147')
  assertEquals(result.docNumber, 'DP-00000068')
})

Deno.test('a saved customer mapping is used without searching or saving again', async () => {
  const { deps, calls } = harness({
    getCustomerMapping: () => Promise.resolve({ customerId: '99', displayName: 'Trumark Homes' }),
  })

  await run(deps)

  assertEquals(calls, ['openSession', 'claim', 'createInvoice', 'complete'])
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
