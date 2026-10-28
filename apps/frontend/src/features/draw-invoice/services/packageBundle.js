import { cleanNamePart } from '../../release-templates/services/packageRelease.js'
import { describePurchaseOrderCount } from '../utils/packagePurchaseOrders.js'

// The Package's documents in one PDF, for sending: the invoice, the Release, the
// Payment Schedule and then the Purchase Orders behind the options it charges. The Release and the
// Payment Schedule are also saved on their own as Package documents; the Purchase Orders stay with
// the Job. This file is only handed to the person.

/** Puts the PDFs one after the other. Returns the bytes and the page count. */
export async function mergePdfs(pdfs) {
  if (pdfs.length === 0) throw new Error('There are no documents to join.')

  // Loaded on demand: the library is only needed when a PDF is built.
  const { PDFDocument } = await import('@cantoo/pdf-lib')
  const output = await PDFDocument.create()
  for (const bytes of pdfs) {
    const document = await PDFDocument.load(bytes, { ignoreEncryption: true })
    const pages = await output.copyPages(document, document.getPageIndices())
    for (const page of pages) output.addPage(page)
  }

  return { bytes: await output.save(), pageCount: output.getPageCount() }
}

/** Name of the joined file, e.g. "Package - Job 1318 - DP-00000046.pdf". */
export function buildPackageBundleFileName({ jobCode, packageNumber }) {
  const parts = [
    'Package',
    jobCode ? `Job ${cleanNamePart(jobCode)}` : '',
    cleanNamePart(packageNumber),
  ].filter(Boolean)

  // 255 is the database limit for a file name, including ".pdf".
  return `${parts.join(' - ').slice(0, 250)}.pdf`
}

/**
 * Whether a Package was generated: its Release or its Payment Schedule is saved on it. The
 * invoice PDF alone does not count, because QuickBooks saves it before anything is generated.
 */
export function hasGeneratedPackage({ releases = [], schedules = [] } = {}) {
  return releases.length > 0 || schedules.length > 0
}

/**
 * The saved documents a generated Package is joined from, in the order it is joined: the
 * invoice, the Release, the Payment Schedule and the Purchase Orders. When a document was
 * generated more than once the newest one is the Package's. The PDF the person downloaded is never
 * saved as a whole, so this is how it is put together again.
 * `releases` and `schedules` are the lists of the Package's saved documents (`completedAt`);
 * `purchaseOrders` are the Job's Purchase Orders behind the options (`file`), already in order.
 */
export function pickStoredBundleDocuments({
  hasInvoice = false,
  releases = [],
  schedules = [],
  purchaseOrders = [],
} = {}) {
  const newest = (documents) => [...documents].sort(
    (left, right) => String(right.completedAt ?? '').localeCompare(String(left.completedAt ?? '')),
  )[0] ?? null

  const release = newest(releases)
  const schedule = newest(schedules)
  return [
    hasInvoice && { key: 'invoice', label: 'Invoice' },
    release && { key: 'release', label: 'Release', file: release.file },
    schedule && { key: 'schedule', label: 'Payment Schedule', file: schedule.file },
    ...purchaseOrders
      .filter((order) => order.file)
      .map((order) => ({ key: 'purchase-order', label: 'Purchase Order', file: order.file })),
  ].filter(Boolean)
}

/**
 * "Invoice, Release and Payment Schedule saved on this Package · 2 Purchase Orders from the Job":
 * what the view is joined from. The Purchase Orders are the Job's, not saved on the Package.
 */
export function describeStoredBundle(parts = []) {
  const labels = parts.filter(({ key }) => key !== 'purchase-order').map(({ label }) => label)
  const orderCount = parts.length - labels.length
  const list = labels.length > 1
    ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
    : labels.join('')
  return [
    list ? `${list} saved on this Package` : '',
    orderCount > 0 ? `${describePurchaseOrderCount(orderCount)} from the Job` : '',
  ].filter(Boolean).join(' · ')
}
