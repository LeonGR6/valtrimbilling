// What the void and PDF actions need to know about a Package's QuickBooks invoice.

import type { serviceClient } from './supabase.ts'
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
