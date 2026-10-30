import { handlePreflight, json } from '../_shared/cors.ts'
import {
  getQuickbooksInvoice,
  QuickbooksApiError,
  type QuickbooksEnvironment,
} from '../_shared/quickbooksApi.ts'
import { requireInvoiceUser, requirePackageId } from '../_shared/quickbooksAccess.ts'
import { environmentOrNull, openSessionFor } from '../_shared/quickbooksEnvironment.ts'
import {
  failure,
  type PaymentSyncResult,
  syncQuickbooksPayments,
  todayInCalifornia,
} from '../_shared/quickbooksPaymentSync.ts'
import { QuickbooksBusyError, QuickbooksNotConnectedError } from '../_shared/quickbooksSession.ts'
import { loadSyncContext } from '../_shared/quickbooksSyncContext.ts'
import { serviceClient } from '../_shared/supabase.ts'

// Reads what QuickBooks shows for the invoices of Packages (open, overdue,
// partially paid, paid, closed, voided) and records it. A Package that is paid
// there becomes Paid / Closed here; one that stops being paid goes back.
//
//   { packageId }  one Package, for an Admin or Accounting user
//   { all: true }  every Package with a QuickBooks invoice that is not closed
//                  (or was closed by QuickBooks), for a signed-in user or, with
//                  the x-cron-secret header, for a scheduler
//
// Each Package is read in the environment it was sent to (Test or Production),
// whatever mode is active. An environment that is not connected fails only its
// own Packages.

const MAX_PACKAGES_PER_RUN = 200

function isScheduler(req: Request) {
  const secret = Deno.env.get('QUICKBOOKS_SYNC_CRON_SECRET')?.trim()
  const sent = req.headers.get('x-cron-secret')?.trim()
  return Boolean(secret) && secret === sent
}

function errorResponse(error: unknown) {
  if (error instanceof QuickbooksNotConnectedError) return json({ code: 'NOT_CONNECTED', error: error.message }, 409)
  if (error instanceof QuickbooksBusyError) return json({ code: 'BUSY', error: error.message }, 503)
  if (error instanceof QuickbooksApiError) return json({ code: 'QUICKBOOKS_ERROR', error: error.message }, 502)
  console.error('QuickBooks payment sync failed:', error)
  return json({ code: 'INTERNAL', error: (error as Error).message }, 500)
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  try {
    if (!isScheduler(req)) {
      const access = await requireInvoiceUser(req, 'refresh QuickBooks payments')
      if (access.user == null) return access.response
    }

    const body = await req.json().catch(() => null) as { packageId?: unknown; all?: unknown } | null
    const admin = serviceClient()

    const byEnvironment = new Map<QuickbooksEnvironment, number[]>()
    const results: PaymentSyncResult[] = []
    const add = (id: number, value: string | null) => {
      const environment = environmentOrNull(value)
      if (!environment) {
        results.push(failure(id, 'This Package has no QuickBooks invoice.'))
        return
      }
      byEnvironment.set(environment, [...(byEnvironment.get(environment) ?? []), id])
    }

    if (body?.all === true) {
      const { data, error } = await admin
        .from('draw_packages')
        .select('id, quickbooks_environment')
        .eq('quickbooks_status', 'CREATED')
        .neq('status', 'VOIDED')
        .or('workflow_status.in.(DRAFT,READY_TO_SUBMIT,AWAITING_PAYMENT),paid_via_quickbooks.eq.true')
        .order('id', { ascending: true })
        .limit(MAX_PACKAGES_PER_RUN)
      if (error) throw new Error(error.message)
      for (const row of data ?? []) add(Number(row.id), row.quickbooks_environment)
    } else {
      const packageId = requirePackageId(body)
      if (packageId == null) return json({ error: 'Send a packageId, or all: true.' }, 400)
      add(packageId, (await loadSyncContext(admin, packageId)).environment)
    }

    for (const [environment, packageIds] of byEnvironment) {
      try {
        results.push(...await syncQuickbooksPayments({
          loadContext: (id) => loadSyncContext(admin, id),
          openSession: (sessionEnvironment) => openSessionFor(admin, sessionEnvironment),
          getInvoice: (api, invoiceId) => getQuickbooksInvoice(api, invoiceId),
          apply: async (state) => {
            const { data, error } = await admin.rpc('apply_quickbooks_invoice_state', {
              p_package_id: state.packageId,
              p_state: state.state,
              p_total: state.total,
              p_balance: state.balance,
              p_due_date: state.dueDate,
              p_overdue: state.overdue,
              p_linked: state.linkedTransactions,
              p_qbo_last_updated: state.lastUpdatedAt,
            })
            if (error) throw new Error(error.message)
            return (data as string | null) ?? null
          },
          today: () => todayInCalifornia(),
        }, packageIds, environment))
      } catch (error) {
        // This environment cannot be reached (not connected, busy, QuickBooks down):
        // its Packages report it and the other environment is still read.
        if (
          error instanceof QuickbooksNotConnectedError
          || error instanceof QuickbooksBusyError
          || error instanceof QuickbooksApiError
        ) {
          results.push(...packageIds.map((id) => failure(id, error.message.slice(0, 300))))
        } else {
          throw error
        }
      }
    }

    return json({ checkedAt: new Date().toISOString(), results })
  } catch (error) {
    return errorResponse(error)
  }
})
