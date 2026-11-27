import { assertEquals, assertRejects } from '@std/assert'
import type { QuickbooksInvoiceDetail } from './quickbooksApi.ts'
import {
  APPLY_BATCH_SIZE,
  type AppliedOutcome,
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

type Harness = Partial<PaymentSyncDeps> & {
  /** The context of each Package; the harness reads them together, as the real loader does. */
  loadContext?: (packageId: number) => Promise<SyncContext>
}

function harness(overrides: Harness = {}) {
  const { loadContext = () => Promise.resolve(created), ...rest } = overrides
  const applied: AppliedPaymentState[] = []
  const loads: number[][] = []
  const saves: number[] = []
  const deps: PaymentSyncDeps = {
    loadContexts: async (packageIds) => {
      loads.push(packageIds)
      const contexts = new Map<number, SyncContext>()
      for (const packageId of packageIds) contexts.set(packageId, await loadContext(packageId))
      return contexts
    },
    openSession: () => Promise.resolve({
      environment: 'sandbox',
      realmId: '9341',
      itemId: '19',
      accessToken: 'token',
    }),
    getInvoice: () => Promise.resolve(paidInvoice),
    applyAll: (inputs) => {
      saves.push(inputs.length)
      const outcomes = new Map<number, AppliedOutcome>()
      for (const input of inputs) {
        applied.push(input)
        outcomes.set(input.packageId, {
          workflowStatus: input.state === 'PAID' ? 'PAID_CLOSED' : 'AWAITING_PAYMENT',
          error: null,
        })
      }
      return Promise.resolve(outcomes)
    },
    today: () => '2026-10-14',
    ...rest,
  }
  return { deps, applied, loads, saves }
}

Deno.test('a paid invoice is recorded and closes the Package', async () => {
  const { deps, applied } = harness()
  const [result] = await syncQuickbooksPayments(deps, [4], 'sandbox')

  assertEquals(result.state, 'PAID')
  assertEquals(result.workflowStatus, 'PAID_CLOSED')
  assertEquals(applied[0].balance, 0)
  assertEquals(applied[0].linkedTransactions, ['Payment'])
})

Deno.test('an open invoice keeps the Package waiting for payment', async () => {
  const { deps } = harness({
    getInvoice: () => Promise.resolve({ ...paidInvoice, balance: 1000, linkedTransactions: [] }),
  })
  const [result] = await syncQuickbooksPayments(deps, [4], 'sandbox')

  assertEquals([result.state, result.workflowStatus], ['OPEN', 'AWAITING_PAYMENT'])
})

Deno.test('one Package failing does not stop the others', async () => {
  const { deps } = harness({
    loadContext: (packageId) => Promise.resolve(
      packageId === 5 ? { ...created, quickbooksStatus: 'NOT_CREATED', invoiceId: null } : created,
    ),
  })
  const results = await syncQuickbooksPayments(deps, [5, 4], 'sandbox')

  assertEquals(results.map((item) => [item.packageId, item.state, item.error === null]), [
    [5, null, false],
    [4, 'PAID', true],
  ])
})

Deno.test('an invoice from another company is not read', async () => {
  const { deps, applied } = harness({
    loadContext: () => Promise.resolve({ ...created, realmId: '1111' }),
  })
  const [result] = await syncQuickbooksPayments(deps, [4], 'sandbox')

  assertEquals(applied.length, 0)
  assertEquals(result.error?.includes('different company'), true)
})

Deno.test('a QuickBooks session that cannot open fails the whole run, and nothing to do opens none', async () => {
  const { deps } = harness({ openSession: () => Promise.reject(new Error('not connected')) })
  await assertRejects(() => syncQuickbooksPayments(deps, [4], 'sandbox'), Error, 'not connected')
  assertEquals(await syncQuickbooksPayments(deps, [], 'sandbox'), [])
})

Deno.test('today is read on the California calendar', () => {
  // 2026-10-14 02:00 UTC is still the evening of the 13th in California.
  assertEquals(todayInCalifornia(new Date('2026-10-14T02:00:00Z')), '2026-10-13')
  assertEquals(todayInCalifornia(new Date('2026-10-14T20:00:00Z')), '2026-10-14')
})

Deno.test('many Packages are read together and saved in batches, in the order they were given', async () => {
  const ids = Array.from({ length: APPLY_BATCH_SIZE * 2 + 10 }, (_, index) => index + 1)
  const { deps, loads, saves } = harness()
  const results = await syncQuickbooksPayments(deps, ids, 'sandbox')

  assertEquals(loads.length, 1)
  assertEquals(saves, [APPLY_BATCH_SIZE, APPLY_BATCH_SIZE, 10])
  assertEquals(results.map((item) => item.packageId), ids)
  assertEquals(results.every((item) => item.error === null), true)
})

Deno.test('a Package that does not exist is reported on its own', async () => {
  const { deps, applied } = harness({
    loadContexts: (ids) => Promise.resolve(new Map(ids.filter((id) => id !== 9).map((id) => [id, created]))),
  })
  const results = await syncQuickbooksPayments(deps, [4, 9], 'sandbox')

  assertEquals(applied.map((item) => item.packageId), [4])
  assertEquals(results.map((item) => [item.packageId, item.error]), [
    [4, null],
    [9, 'The Package does not exist.'],
  ])
})

Deno.test('a Package the database refuses is reported on its own and the others are saved', async () => {
  const { deps } = harness({
    applyAll: (inputs) => Promise.resolve(new Map(inputs.map((input) => [
      input.packageId,
      input.packageId === 5
        ? { workflowStatus: null, error: 'Unknown QuickBooks payment state' }
        : { workflowStatus: 'AWAITING_PAYMENT', error: null },
    ]))),
  })
  const results = await syncQuickbooksPayments(deps, [4, 5, 6], 'sandbox')

  assertEquals(results.map((item) => [item.packageId, item.error]), [
    [4, null],
    [5, 'Unknown QuickBooks payment state'],
    [6, null],
  ])
})

Deno.test('a batch that cannot be saved fails its Packages only, and the next batch is still saved', async () => {
  let call = 0
  const { deps } = harness({
    applyAll: (inputs) => {
      call += 1
      if (call === 1) return Promise.reject(new Error('database busy'))
      return Promise.resolve(new Map(inputs.map((input) => [
        input.packageId,
        { workflowStatus: 'AWAITING_PAYMENT', error: null },
      ])))
    },
  })
  const ids = Array.from({ length: APPLY_BATCH_SIZE + 2 }, (_, index) => index + 1)
  const results = await syncQuickbooksPayments(deps, ids, 'sandbox')

  assertEquals(results.slice(0, APPLY_BATCH_SIZE).every((item) => item.error === 'database busy'), true)
  assertEquals(results.slice(APPLY_BATCH_SIZE).every((item) => item.error === null), true)
})
