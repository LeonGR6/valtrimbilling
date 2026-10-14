import { handlePreflight, json } from '../_shared/cors.ts'
import { getQuickbooksInvoice, QuickbooksApiError } from '../_shared/quickbooksApi.ts'
import { requireInvoiceUser, requirePackageId } from '../_shared/quickbooksAccess.ts'
import { syncQuickbooksPayments, todayInCalifornia } from '../_shared/quickbooksPaymentSync.ts'
import {
  openQuickbooksSession,
  QuickbooksBusyError,
  QuickbooksNotConnectedError,
} from '../_shared/quickbooksSession.ts'
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

const MAX_PACKAGES_PER_RUN = 200

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing Edge Function secret: ${name}.`)
  return value
}

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

    let packageIds: number[]
    if (body?.all === true) {
      const { data, error } = await admin
        .from('draw_packages')
        .select('id')
        .eq('quickbooks_status', 'CREATED')
        .neq('status', 'VOIDED')
        .or('workflow_status.in.(DRAFT,READY_TO_SUBMIT,AWAITING_PAYMENT),paid_via_quickbooks.eq.true')
        .order('id', { ascending: true })
        .limit(MAX_PACKAGES_PER_RUN)
      if (error) throw new Error(error.message)
      packageIds = (data ?? []).map((row) => Number(row.id))
    } else {
      const packageId = requirePackageId(body)
      if (packageId == null) return json({ error: 'Send a packageId, or all: true.' }, 400)
      packageIds = [packageId]
    }

    const results = await syncQuickbooksPayments({
      loadContext: (id) => loadSyncContext(admin, id),
      openSession: () =>
        openQuickbooksSession(admin, {
          clientId: requiredEnv('QBO_CLIENT_ID'),
          clientSecret: requiredEnv('QBO_CLIENT_SECRET'),
        }),
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
    }, packageIds)

    return json({ checkedAt: new Date().toISOString(), results })
  } catch (error) {
    return errorResponse(error)
  }
})
