import { cleanNamePart } from '../../release-templates/services/packageRelease.js'

// The Package's documents in one PDF, for sending: the Release first and the
// Payment Schedule after it. The two documents are also saved on their own as
// Package documents; this file is only handed to the person.

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
 * invoice, the Release and the Payment Schedule. When a document was generated more than once
 * the newest one is the Package's. The PDF the person downloaded is never saved as a whole, so
 * this is how it is put together again.
 * `releases` and `schedules` are the lists of the Package's saved documents (`completedAt`).
 */
export function pickStoredBundleDocuments({ hasInvoice = false, releases = [], schedules = [] } = {}) {
  const newest = (documents) => [...documents].sort(
    (left, right) => String(right.completedAt ?? '').localeCompare(String(left.completedAt ?? '')),
  )[0] ?? null

  const release = newest(releases)
  const schedule = newest(schedules)
  return [
    hasInvoice && { key: 'invoice', label: 'Invoice' },
    release && { key: 'release', label: 'Release', file: release.file },
    schedule && { key: 'schedule', label: 'Payment Schedule', file: schedule.file },
  ].filter(Boolean)
}

/** "Invoice, Release and Payment Schedule saved on this Package": what the view is joined from. */
export function describeStoredBundle(parts = []) {
  const labels = parts.map(({ label }) => label)
  const list = labels.length > 1
    ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
    : labels.join('')
  return list ? `${list} saved on this Package` : ''
}
