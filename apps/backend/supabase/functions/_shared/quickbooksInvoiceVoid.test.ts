import { assertEquals, assertRejects } from '@std/assert'
import type { QuickbooksInvoiceDetail } from './quickbooksApi.ts'
import {
  type InvoiceVoidContext,
  type InvoiceVoidDeps,
  QuickbooksInvoiceVoidError,
  voidPackageInvoice,
} from './quickbooksInvoiceVoid.ts'

const created: InvoiceVoidContext = {
  quickbooksStatus: 'CREATED',
  invoiceId: '146',
  environment: 'sandbox',
  realmId: '9341',
  totalAmount: 13320,
}

const open: QuickbooksInvoiceDetail = {
  id: '146',
  syncToken: '3',
  docNumber: 'DP-00000029',
  totalAmount: 13320,
  balance: 13320,
  linkedTransactions: [],
}

function harness(overrides: Partial<InvoiceVoidDeps> = {}, context: InvoiceVoidContext = created) {
  const calls: string[] = []
  const deps: InvoiceVoidDeps = {
    loadContext: () => Promise.resolve(context),
    openSession: () => {
      calls.push('openSession')
      return Promise.resolve({ environment: 'sandbox', realmId: '9341', itemId: '19', accessToken: 'tok' })
    },
    getInvoice: () => {
      calls.push('getInvoice')
      return Promise.resolve(open)
    },
    voidInvoice: (_api, invoice) => {
      calls.push(`voidInvoice:${invoice.id}:${invoice.syncToken}`)
      return Promise.resolve()
    },
    markVoided: () => {
      calls.push('markVoided')
      return Promise.resolve({ already: false, removedStoragePath: '29/invoice/abc.pdf' })
    },
    removeStoredFile: (path) => {
      calls.push(`remove:${path}`)
      return Promise.resolve()
    },
    ...overrides,
  }
  return { deps, calls }
}

Deno.test('voids in QuickBooks with the current SyncToken, then records it and drops the saved PDF', async () => {
  const { deps, calls } = harness()

  const result = await voidPackageInvoice(deps, 29)

  assertEquals(result, { voided: true, quickbooks: 'voided' })
  assertEquals(calls, ['openSession', 'getInvoice', 'voidInvoice:146:3', 'markVoided', 'remove:29/invoice/abc.pdf'])
})

Deno.test('an invoice with a payment or credit is never voided', async () => {
  for (const invoice of [
    { ...open, linkedTransactions: ['Payment'] },
    { ...open, balance: 10000 },
  ]) {
    const { deps, calls } = harness({ getInvoice: () => Promise.resolve(invoice) })
    const error = await assertRejects(() => voidPackageInvoice(deps, 29), QuickbooksInvoiceVoidError)
    assertEquals(error.code, 'HAS_PAYMENTS')
    assertEquals(calls.some((call) => call.startsWith('voidInvoice') || call === 'markVoided'), false)
  }
})

Deno.test('an invoice already voided in QuickBooks only repeats the database step', async () => {
  const { deps, calls } = harness({
    getInvoice: () => Promise.resolve({ ...open, totalAmount: 0, balance: 0 }),
  })

  const result = await voidPackageInvoice(deps, 29)

  assertEquals(result, { voided: true, quickbooks: 'already_voided' })
  assertEquals(calls.some((call) => call.startsWith('voidInvoice')), false)
  assertEquals(calls.includes('markVoided'), true)
})

Deno.test('an invoice deleted by hand in QuickBooks still lets the Package be released', async () => {
  const { deps, calls } = harness({ getInvoice: () => Promise.resolve(null) })

  assertEquals(await voidPackageInvoice(deps, 29), { voided: true, quickbooks: 'missing' })
  assertEquals(calls.includes('markVoided'), true)
})

Deno.test('a failed database step after voiding can simply be repeated', async () => {
  const { deps } = harness({ markVoided: () => Promise.reject(new Error('database down')) })
  await assertRejects(() => voidPackageInvoice(deps, 29), Error, 'database down')

  // The next attempt finds QuickBooks already voided.
  const retry = harness({ getInvoice: () => Promise.resolve({ ...open, totalAmount: 0, balance: 0 }) })
  assertEquals((await voidPackageInvoice(retry.deps, 29)).quickbooks, 'already_voided')
})

Deno.test('a Package without a created invoice, or already voided, is not voided again', async () => {
  const none = harness({}, { ...created, quickbooksStatus: 'NOT_CREATED', invoiceId: null })
  const error = await assertRejects(() => voidPackageInvoice(none.deps, 29), QuickbooksInvoiceVoidError)
  assertEquals(error.code, 'NOT_CREATED')
  assertEquals(none.calls, [])

  const voided = harness({}, { ...created, quickbooksStatus: 'VOIDED' })
  assertEquals(await voidPackageInvoice(voided.deps, 29), { voided: true, quickbooks: 'already_voided' })
  assertEquals(voided.calls, [])
})

Deno.test('refuses when QuickBooks is connected to another company', async () => {
  const { deps, calls } = harness({
    openSession: () =>
      Promise.resolve({ environment: 'production', realmId: '1111', itemId: '19', accessToken: 'tok' }),
  })

  const error = await assertRejects(() => voidPackageInvoice(deps, 29), QuickbooksInvoiceVoidError)

  assertEquals(error.code, 'WRONG_COMPANY')
  assertEquals(calls, [])
})

Deno.test('failing to delete the saved PDF never fails the void', async () => {
  const { deps } = harness({ removeStoredFile: () => Promise.reject(new Error('Storage is down')) })

  assertEquals((await voidPackageInvoice(deps, 29)).voided, true)
})
