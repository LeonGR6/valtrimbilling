// What the void and PDF actions need to know about a Package's QuickBooks invoice.

import type { serviceClient } from './supabase.ts'
import type { InvoiceUpdateContext } from './quickbooksInvoiceUpdate.ts'
import type { QuickbooksInvoicePayload } from './quickbooksInvoice.ts'
import { PackageNotFoundError } from './quickbooksPackageSource.ts'

type Admin = ReturnType<typeof serviceClient>

export interface SyncContext {
  packageNumber: string
  quickbooksStatus: string
  invoiceId: string | null
  docNumber: string | null
  environment: string | null
  realmId: string | null
  totalAmount: number | null
}

export async function loadSyncContext(admin: Admin, packageId: number): Promise<SyncContext> {
  const { data: header, error } = await admin
    .from('draw_packages')
    .select('package_number, quickbooks_status')
    .eq('id', packageId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!header) throw new PackageNotFoundError()

  const { data: sync, error: syncError } = await admin
    .from('quickbooks_invoice_syncs')
    .select('qbo_invoice_id, qbo_doc_number, environment, realm_id, total_amount')
    .eq('package_id', packageId)
    .maybeSingle()
  if (syncError) throw new Error(syncError.message)

  return {
    packageNumber: header.package_number,
    quickbooksStatus: header.quickbooks_status,
    invoiceId: sync?.qbo_invoice_id ?? null,
    docNumber: sync?.qbo_doc_number ?? null,
    environment: sync?.environment ?? null,
    realmId: sync?.realm_id ?? null,
    totalAmount: sync?.total_amount == null ? null : Number(sync.total_amount),
  }
}

/** How many Packages are read in one request, so the `in` filter stays short. */
export const SYNC_CONTEXT_BATCH_SIZE = 100

/**
 * The contexts of many Packages in two requests per hundred, not two per Package: the payments
 * check reads every open invoice, and each request to the API is logged. A Package that does not
 * exist is missing from the answer.
 */
export async function loadSyncContexts(
  admin: Admin,
  packageIds: number[],
): Promise<Map<number, SyncContext>> {
  const contexts = new Map<number, SyncContext>()

  for (let start = 0; start < packageIds.length; start += SYNC_CONTEXT_BATCH_SIZE) {
    const ids = packageIds.slice(start, start + SYNC_CONTEXT_BATCH_SIZE)
    const [headers, syncs] = await Promise.all([
      admin
        .from('draw_packages')
        .select('id, package_number, quickbooks_status')
        .in('id', ids),
      admin
        .from('quickbooks_invoice_syncs')
        .select('package_id, qbo_invoice_id, qbo_doc_number, environment, realm_id, total_amount')
        .in('package_id', ids),
    ])
    if (headers.error) throw new Error(headers.error.message)
    if (syncs.error) throw new Error(syncs.error.message)

    const syncByPackage = new Map<number, NonNullable<typeof syncs.data>[number]>()
    for (const sync of syncs.data ?? []) {
      if (!syncByPackage.has(Number(sync.package_id))) syncByPackage.set(Number(sync.package_id), sync)
    }

    for (const header of headers.data ?? []) {
      const sync = syncByPackage.get(Number(header.id))
      contexts.set(Number(header.id), {
        packageNumber: header.package_number,
        quickbooksStatus: header.quickbooks_status,
        invoiceId: sync?.qbo_invoice_id ?? null,
        docNumber: sync?.qbo_doc_number ?? null,
        environment: sync?.environment ?? null,
        realmId: sync?.realm_id ?? null,
        totalAmount: sync?.total_amount == null ? null : Number(sync.total_amount),
      })
    }
  }

  return contexts
}

/** What editing an invoiced Package needs: the invoice as it was last sent, and whether a change is waiting. */
export async function loadUpdateContext(admin: Admin, packageId: number): Promise<InvoiceUpdateContext> {
  const base = await loadSyncContext(admin, packageId)

  const { data: sync, error } = await admin
    .from('quickbooks_invoice_syncs')
    .select('payload, update_pending, update_request_id, difference_description, difference_amount, difference_reason')
    .eq('package_id', packageId)
    .maybeSingle()
  if (error) throw new Error(error.message)

  return {
    ...base,
    payload: (sync?.payload ?? null) as QuickbooksInvoicePayload | null,
    difference: sync?.difference_amount == null || sync.difference_description == null
      ? null
      : {
        description: sync.difference_description,
        amount: Number(sync.difference_amount),
        reason: sync.difference_reason ?? null,
      },
    updatePending: sync?.update_pending === true,
    updateRequestId: sync?.update_request_id ?? null,
  }
}
