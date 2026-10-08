import { RELEASE_TYPES, getReleaseVariable } from './releaseTemplateRecord.js'

// Generating a Release for a Package: which values go where, and the names of
// the files and paths involved. Pure; the network lives in the repository.

export const PACKAGE_DOCUMENT_BUCKET = 'package-documents'

// Variables a Package fills by itself: its own cut-off date and net amount, and
// the dates and amounts of the earlier Packages of its Job that are not paid.
export const PACKAGE_RELEASE_VARIABLES = [
  'through_date',
  'check_amount',
  'signature_date',
  'waiver_release_dates',
  'unpaid_progress_amount',
]

const WORKFLOW_LABELS = {
  DRAFT: 'Draft',
  READY_TO_SUBMIT: 'Ready to submit',
  AWAITING_PAYMENT: 'Awaiting payment',
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function toPendingPackage(row) {
  return {
    id: row.package_id,
    number: row.package_number,
    packageDate: row.package_date,
    cutoffDate: row.cutoff_date,
    cutoffSource: row.cutoff_source,
    netAmount: toNumberOrNull(row.net_amount),
    status: row.status,
    workflowStatus: row.workflow_status,
  }
}

/** The row the values RPC returns, in the shape the screen uses. */
export function toPackageReleaseValues(row) {
  return {
    packageId: row.package_id,
    jobId: row.job_id,
    packageNumber: row.package_number,
    packageDate: row.package_date,
    cutoffDate: row.cutoff_date,
    // 'builder_setup': the cut-off of the Builder's setup. 'package_date': the
    // setup bills on any date, so the Package date stands in for it.
    cutoffSource: row.cutoff_source,
    invoiceNumber: row.invoice_number ?? null,
    grossAmount: toNumberOrNull(row.gross_amount),
    retentionAmount: toNumberOrNull(row.retention_amount),
    wrapAmount: toNumberOrNull(row.wrap_amount),
    netAmount: toNumberOrNull(row.net_amount),
    // Earlier Packages of the Job that are not paid yet, oldest first.
    pendingPackages: (row.pending_packages ?? []).map(toPendingPackage),
  }
}

/** Short description of an unpaid earlier Package for the list. */
export function describePendingPackage(pending) {
  return {
    workflowLabel: WORKFLOW_LABELS[pending.workflowStatus] ?? pending.workflowStatus,
  }
}

/**
 * The values to print, as raw inputs for the filler.
 *  - Through Date: the cut-off date of the Package.
 *  - Amount of Check: the invoice net amount (after retention and wrap).
 *  - Date of Signature: the same date as Through Date.
 *  - Date(s) of waiver and release: the cut-off date of each unpaid earlier
 *    Package of the Job.
 *  - Amount(s) of unpaid progress payment(s): the net amount of each of them.
 *
 * `pending` is the part of `values.pendingPackages` to include, in order. Dates
 * and amounts are lists; a Package without an invoice amount adds only its date.
 */
export function buildPackageFillValues(values, pending = values.pendingPackages ?? []) {
  return {
    through_date: values.cutoffDate ?? '',
    check_amount: values.netAmount ?? '',
    signature_date: values.cutoffDate ?? '',
    waiver_release_dates: pending.map((item) => item.cutoffDate).filter(Boolean),
    unpaid_progress_amount: pending
      .map((item) => item.netAmount)
      .filter((amount) => amount !== null),
  }
}

/**
 * What a template will do for this Package: the variables it maps that a
 * Package fills, and those it maps that stay blank for now.
 */
export function describeFillPlan(mapping) {
  const mapped = [...new Set((mapping?.fields ?? []).map((field) => field.variable))]
  const labelOf = (key) => getReleaseVariable(key)?.label ?? key

  // The two Exceptions lines only exist on some forms; a form without them is
  // normal, so only the three always-expected values are reported as missing.
  const expected = ['through_date', 'check_amount', 'signature_date']

  return {
    filled: mapped
      .filter((key) => PACKAGE_RELEASE_VARIABLES.includes(key))
      .map((key) => ({ key, label: labelOf(key) })),
    blank: mapped
      .filter((key) => !PACKAGE_RELEASE_VARIABLES.includes(key))
      .map((key) => ({ key, label: labelOf(key) })),
    missingFromForm: expected
      .filter((key) => !mapped.includes(key))
      .map((key) => ({ key, label: labelOf(key) })),
  }
}

/** Confirmed templates of a Job in the order of the four Release types. */
export function sortTemplatesByType(templates) {
  const order = RELEASE_TYPES.map(({ value }) => value)
  return [...templates].sort(
    (left, right) => order.indexOf(left.releaseType) - order.indexOf(right.releaseType),
  )
}

/** The template to start on: the only one, otherwise the first by type order. */
export function pickDefaultTemplate(templates) {
  return sortTemplatesByType(templates)[0] ?? null
}

export function buildPackageDocumentStoragePath(packageId, uniqueId) {
  return `${Number(packageId)}/release/${uniqueId}.pdf`
}

function cleanNamePart(value) {
  return Array.from(String(value ?? ''))
    // Control characters and the ones a file name cannot hold.
    .map((character) => (character.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(character) ? ' ' : character))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Name of the generated file, e.g. "Release - Job 1307 - DP-00000046 - Conditional Progress.pdf". */
export function buildPackageReleaseFileName({ jobCode, packageNumber, releaseType }) {
  const type = RELEASE_TYPES.find(({ value }) => value === releaseType)
    ?.shortLabel.replace(' · ', ' ')
  const parts = [
    'Release',
    jobCode ? `Job ${cleanNamePart(jobCode)}` : '',
    cleanNamePart(packageNumber),
    cleanNamePart(type),
  ].filter(Boolean)

  // 255 is the database limit for a file name, including ".pdf".
  return `${parts.join(' - ').slice(0, 250)}.pdf`
}

/** Hex SHA-256 of some bytes, stored with the file to detect a changed copy. */
export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
