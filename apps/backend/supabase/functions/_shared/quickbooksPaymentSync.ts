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

export interface PaymentSyncDeps {
  loadContext(packageId: number): Promise<SyncContext>
  openSession(environment: QuickbooksEnvironment): Promise<QuickbooksSession>
  getInvoice(api: QuickbooksApiOptions, invoiceId: string): Promise<QuickbooksInvoiceDetail | null>
  /** Saves the state and returns the Package's workflow status afterwards. */
  apply(input: AppliedPaymentState): Promise<string | null>
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
 * Syncs the given Packages one by one. One Package failing (no invoice yet, a
 * QuickBooks error) is reported in its own result and does not stop the rest.
 * A session that cannot be opened (not connected, busy) fails the whole run of
 * that environment; each environment is synced on its own.
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
  const results: PaymentSyncResult[] = []

  for (const packageId of packageIds) {
    try {
      const context = await deps.loadContext(packageId)
      if (context.quickbooksStatus !== 'CREATED' || !context.invoiceId) {
        results.push(failure(packageId, 'This Package has no QuickBooks invoice.'))
        continue
      }
      if (session.environment !== context.environment || session.realmId !== context.realmId) {
        results.push(failure(packageId, 'QuickBooks is connected to a different company than this invoice.'))
        continue
      }

      const invoice = await deps.getInvoice(api, context.invoiceId)
      const { state, overdue } = deriveQuickbooksPaymentState(invoice, deps.today())
      const applied: AppliedPaymentState = {
        packageId,
        state,
        total: invoice?.totalAmount ?? context.totalAmount ?? 0,
        balance: invoice?.balance ?? 0,
        dueDate: invoice?.dueDate ?? null,
        overdue,
        linkedTransactions: invoice?.linkedTransactions ?? [],
        lastUpdatedAt: invoice?.lastUpdatedAt ?? null,
      }
      const workflowStatus = await deps.apply(applied)
      results.push({
        packageId,
        state,
        overdue,
        balance: applied.balance,
        total: applied.total,
        workflowStatus,
        error: null,
      })
    } catch (error) {
      results.push(failure(packageId, error instanceof Error ? error.message.slice(0, 300) : 'Unknown error.'))
    }
  }

  return results
}
