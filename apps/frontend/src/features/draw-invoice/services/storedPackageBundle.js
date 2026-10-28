import { downloadStoredPdf, listPackageReleases } from '../../release-templates/services/packageReleaseRepository.js'
import { listPackagePaymentSchedules } from '../../payment-schedules/services/packageScheduleRepository.js'
import { downloadQuickbooksInvoicePdf } from './quickbooksRepository.js'
import { mergePdfs, pickStoredBundleDocuments } from './packageBundle.js'

// A generated Package is downloaded as one PDF, but only its documents are saved on the Package:
// the QuickBooks invoice, the Release and the Payment Schedule. This puts them together again, in
// the order they are joined, so the Package can be seen without generating it a second time.

/** The Release and the Payment Schedule saved on a Package (empty lists when it has none). */
export async function listStoredPackageDocuments(packageId) {
  const [releases, schedules] = await Promise.all([
    listPackageReleases(packageId),
    listPackagePaymentSchedules(packageId),
  ])
  return { releases, schedules }
}

/**
 * The generated Package as one PDF, joined from its saved documents and the Purchase Orders behind
 * its options (`purchaseOrders`, from loadPackagePurchaseOrders).
 * @returns {Promise<{ bytes: Uint8Array, pageCount: number, parts: Array<{ key: string, label: string }> }>}
 */
export async function buildStoredPackageBundle(packageId, { releases, schedules }, { purchaseOrders = [] } = {}) {
  const invoice = await downloadQuickbooksInvoicePdf(packageId)
  const parts = pickStoredBundleDocuments({
    hasInvoice: Boolean(invoice),
    releases,
    schedules,
    purchaseOrders,
  })

  const pdfs = await Promise.all(parts.map(async (part) => {
    if (part.key === 'invoice') return invoice.bytes
    const file = await downloadStoredPdf(part.file)
    return new Uint8Array(await file.arrayBuffer())
  }))
  const { bytes, pageCount } = await mergePdfs(pdfs)

  return { bytes, pageCount, parts: parts.map(({ key, label }) => ({ key, label })) }
}
