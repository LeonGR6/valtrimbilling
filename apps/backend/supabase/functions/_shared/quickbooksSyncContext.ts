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

/** What editing an invoiced Package needs: the invoice as it was last sent, and whether a change is waiting. */
export async function loadUpdateContext(admin: Admin, packageId: number): Promise<InvoiceUpdateContext> {
  const base = await loadSyncContext(admin, packageId)

  const { data: sync, error } = await admin
    .from('quickbooks_invoice_syncs')
    .select('payload, update_pending, update_request_id, difference_description, difference_amount')
    .eq('package_id', packageId)
    .maybeSingle()
  if (error) throw new Error(error.message)

  return {
    ...base,
    payload: (sync?.payload ?? null) as QuickbooksInvoicePayload | null,
    difference: sync?.difference_amount == null || sync.difference_description == null
      ? null
      : { description: sync.difference_description, amount: Number(sync.difference_amount) },
    updatePending: sync?.update_pending === true,
    updateRequestId: sync?.update_request_id ?? null,
  }
}
