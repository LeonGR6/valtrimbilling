// The real Storage and database side of storing an invoice PDF. Kept apart from
// quickbooksInvoicePdf.ts so that file can be tested without either.

import { getQuickbooksInvoicePdf } from './quickbooksApi.ts'
import type { PdfStoreDeps } from './quickbooksInvoicePdf.ts'
import type { serviceClient } from './supabase.ts'

type Admin = ReturnType<typeof serviceClient>

const BUCKET = 'package-documents'

export function realPdfStoreDeps(admin: Admin, userId: string): PdfStoreDeps {
  return {
    fetchPdf: (api, invoiceId) => getQuickbooksInvoicePdf(api, invoiceId),
    upload: async (path, bytes) => {
      const { error } = await admin.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: 'application/pdf', upsert: false })
      if (error) throw new Error(`Could not upload the PDF: ${error.message}`)
    },
    register: async ({ packageId, storagePath, fileName, sizeBytes, sha256 }) => {
      const { data, error } = await admin.rpc('register_quickbooks_invoice_pdf', {
        p_package_id: packageId,
        p_user_id: userId,
        p_storage_path: storagePath,
        p_original_name: fileName,
        p_size_bytes: sizeBytes,
        p_sha256: sha256,
      })
      if (error) throw new Error(error.message)
      return { replacedStoragePath: (data as { replaced_storage_path?: string | null })?.replaced_storage_path ?? null }
    },
    removeStoredFile: removeStoredFile(admin),
    newId: () => crypto.randomUUID(),
  }
}

export function removeStoredFile(admin: Admin) {
  return async (path: string) => {
    const { error } = await admin.storage.from(BUCKET).remove([path])
    if (error) throw new Error(error.message)
  }
}
