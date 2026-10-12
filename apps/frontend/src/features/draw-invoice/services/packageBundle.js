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
