// Reads what QuickBooks shows for Package invoices and records it, so the
// platform can tell open, overdue, paid, closed and voided invoices apart.

import type {
  QuickbooksApiOptions,
  QuickbooksEnvironment,
  QuickbooksInvoiceDetail,
} from './quickbooksApi.ts'
import {
  deriveQuickbooksPaymentState,
  type QuickbooksPaymentState,
} from './quickbooksPaymentState.ts'
import type { QuickbooksSession } from './quickbooksSession.ts'
import type { SyncContext } from './quickbooksSyncContext.ts'

export interface AppliedPaymentState {
  packageId: number
  state: QuickbooksPaymentState
  total: number
  balance: number
  dueDate: string | null
  overdue: boolean
  linkedTransactions: string[]
  lastUpdatedAt: string | null
}

/** What saving one Package's state gave: its workflow status afterwards, or why it was not saved. */
export interface AppliedOutcome {
  workflowStatus: string | null
  error: string | null
}

/** How many states are saved in one call; a run that stops halfway keeps what was already saved. */
export const APPLY_BATCH_SIZE = 25

export interface PaymentSyncDeps {
  /** The contexts of the Packages, in few requests. A Package that does not exist is left out. */
  loadContexts(packageIds: number[]): Promise<Map<number, SyncContext>>
  openSession(environment: QuickbooksEnvironment): Promise<QuickbooksSession>
  getInvoice(api: QuickbooksApiOptions, invoiceId: string): Promise<QuickbooksInvoiceDetail | null>
  /** Saves the states in one call; the answer has an entry for each Package it was given. */
  applyAll(inputs: AppliedPaymentState[]): Promise<Map<number, AppliedOutcome>>
  today(): string
}

export interface PaymentSyncResult {
  packageId: number
  state: QuickbooksPaymentState | null
  overdue: boolean
  balance: number | null
  total: number | null
  workflowStatus: string | null
  error: string | null
}

/** Today's date, YYYY-MM-DD, on the calendar of the Builders' office (California). */
export function todayInCalifornia(now: Date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function failure(packageId: number, error: string): PaymentSyncResult {
  return {
    packageId,
    state: null,
    overdue: false,
    balance: null,
    total: null,
    workflowStatus: null,
    error,
  }
}

/**
 * Syncs the given Packages. One Package failing (no invoice yet, a QuickBooks error) is reported in
 * its own result and does not stop the rest. A session that cannot be opened (not connected, busy)
 * fails the whole run of that environment; each environment is synced on its own.
 *
 * Every request to the database is logged, and this runs for every open invoice every 30 minutes
 * and each time the Packages screen is opened, so it reads the Packages together and saves their
 * states APPLY_BATCH_SIZE at a time rather than one request per Package.
 */
export async function syncQuickbooksPayments(
  deps: PaymentSyncDeps,
  packageIds: number[],
  environment: QuickbooksEnvironment,
): Promise<PaymentSyncResult[]> {
  if (packageIds.length === 0) return []

  const session = await deps.openSession(environment)
  const api: QuickbooksApiOptions = {
    environment: session.environment,
    realmId: session.realmId,
    accessToken: session.accessToken,
  }
  const contexts = await deps.loadContexts(packageIds)
  const results: PaymentSyncResult[] = new Array(packageIds.length)
  let waiting: { index: number; applied: AppliedPaymentState; overdue: boolean }[] = []

  const saveWaiting = async () => {
    if (waiting.length === 0) return
    const batch = waiting
    waiting = []

    let outcomes: Map<number, AppliedOutcome>
    try {
      outcomes = await deps.applyAll(batch.map((item) => item.applied))
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : 'Unknown error.'
      for (const item of batch) results[item.index] = failure(item.applied.packageId, message)
      return
    }

    for (const { index, applied, overdue } of batch) {
      const outcome = outcomes.get(applied.packageId)
      results[index] = outcome && outcome.error == null
        ? {
          packageId: applied.packageId,
          state: applied.state,
          overdue,
          balance: applied.balance,
          total: applied.total,
          workflowStatus: outcome.workflowStatus,
          error: null,
        }
        : failure(applied.packageId, outcome?.error ?? 'The payment state was not saved.')
    }
  }

  for (const [index, packageId] of packageIds.entries()) {
    try {
      const context = contexts.get(packageId)
      if (!context) {
        results[index] = failure(packageId, 'The Package does not exist.')
        continue
      }
      if (context.quickbooksStatus !== 'CREATED' || !context.invoiceId) {
        results[index] = failure(packageId, 'This Package has no QuickBooks invoice.')
        continue
      }
      if (session.environment !== context.environment || session.realmId !== context.realmId) {
        results[index] = failure(packageId, 'QuickBooks is connected to a different company than this invoice.')
        continue
      }

      const invoice = await deps.getInvoice(api, context.invoiceId)
      const { state, overdue } = deriveQuickbooksPaymentState(invoice, deps.today())
      waiting.push({
        index,
        overdue,
        applied: {
          packageId,
          state,
          total: invoice?.totalAmount ?? context.totalAmount ?? 0,
          balance: invoice?.balance ?? 0,
          dueDate: invoice?.dueDate ?? null,
          overdue,
          linkedTransactions: invoice?.linkedTransactions ?? [],
          lastUpdatedAt: invoice?.lastUpdatedAt ?? null,
        },
      })
      if (waiting.length >= APPLY_BATCH_SIZE) await saveWaiting()
    } catch (error) {
      results[index] = failure(packageId, error instanceof Error ? error.message.slice(0, 300) : 'Unknown error.')
    }
  }
  await saveWaiting()

  return results
}
