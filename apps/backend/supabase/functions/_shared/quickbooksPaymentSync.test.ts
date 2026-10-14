import { assertEquals, assertRejects } from '@std/assert'
import type { QuickbooksInvoiceDetail } from './quickbooksApi.ts'
import {
  type AppliedPaymentState,
  type PaymentSyncDeps,
  syncQuickbooksPayments,
  todayInCalifornia,
} from './quickbooksPaymentSync.ts'
import type { SyncContext } from './quickbooksSyncContext.ts'

const created: SyncContext = {
  packageNumber: 'DP-00000004',
  quickbooksStatus: 'CREATED',
  invoiceId: '150',
  docNumber: 'DP-00000004',
  environment: 'sandbox',
  realmId: '9341',
  totalAmount: 1000,
}

const paidInvoice: QuickbooksInvoiceDetail = {
  id: '150',
  syncToken: '1',
  docNumber: 'DP-00000004',
  totalAmount: 1000,
  balance: 0,
  linkedTransactions: ['Payment'],
  dueDate: '2026-11-12',
  lastUpdatedAt: '2026-10-14T20:00:00Z',
}

function harness(overrides: Partial<PaymentSyncDeps> = {}) {
  const applied: AppliedPaymentState[] = []
  const deps: PaymentSyncDeps = {
    loadContext: () => Promise.resolve(created),
    openSession: () => Promise.resolve({
      environment: 'sandbox',
      realmId: '9341',
      itemId: '19',
      accessToken: 'token',
    }),
    getInvoice: () => Promise.resolve(paidInvoice),
    apply: (input) => {
      applied.push(input)
      return Promise.resolve(input.state === 'PAID' ? 'PAID_CLOSED' : 'AWAITING_PAYMENT')
    },
    today: () => '2026-10-14',
    ...overrides,
  }
  return { deps, applied }
}

Deno.test('a paid invoice is recorded and closes the Package', async () => {
  const { deps, applied } = harness()
  const [result] = await syncQuickbooksPayments(deps, [4])

  assertEquals(result.state, 'PAID')
  assertEquals(result.workflowStatus, 'PAID_CLOSED')
  assertEquals(applied[0].balance, 0)
  assertEquals(applied[0].linkedTransactions, ['Payment'])
})

Deno.test('an open invoice keeps the Package waiting for payment', async () => {
  const { deps } = harness({
    getInvoice: () => Promise.resolve({ ...paidInvoice, balance: 1000, linkedTransactions: [] }),
  })
  const [result] = await syncQuickbooksPayments(deps, [4])

  assertEquals([result.state, result.workflowStatus], ['OPEN', 'AWAITING_PAYMENT'])
})

Deno.test('one Package failing does not stop the others', async () => {
  const { deps } = harness({
    loadContext: (packageId) => Promise.resolve(
      packageId === 5 ? { ...created, quickbooksStatus: 'NOT_CREATED', invoiceId: null } : created,
    ),
  })
  const results = await syncQuickbooksPayments(deps, [5, 4])

  assertEquals(results.map((item) => [item.packageId, item.state, item.error === null]), [
    [5, null, false],
    [4, 'PAID', true],
  ])
})

Deno.test('an invoice from another company is not read', async () => {
  const { deps, applied } = harness({
    loadContext: () => Promise.resolve({ ...created, realmId: '1111' }),
  })
  const [result] = await syncQuickbooksPayments(deps, [4])

  assertEquals(applied.length, 0)
  assertEquals(result.error?.includes('different company'), true)
})

Deno.test('a QuickBooks session that cannot open fails the whole run, and nothing to do opens none', async () => {
  const { deps } = harness({ openSession: () => Promise.reject(new Error('not connected')) })
  await assertRejects(() => syncQuickbooksPayments(deps, [4]), Error, 'not connected')
  assertEquals(await syncQuickbooksPayments(deps, []), [])
})

Deno.test('today is read on the California calendar', () => {
  // 2026-10-14 02:00 UTC is still the evening of the 13th in California.
  assertEquals(todayInCalifornia(new Date('2026-10-14T02:00:00Z')), '2026-10-13')
  assertEquals(todayInCalifornia(new Date('2026-10-14T20:00:00Z')), '2026-10-14')
})
