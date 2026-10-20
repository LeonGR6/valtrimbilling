import { RELEASE_TYPES, getReleaseVariable } from './releaseTemplateRecord.js'

// Generating a Release for a Package: which values go where, and the names of
// the files and paths involved. Pure; the network lives in the repository.

export const PACKAGE_DOCUMENT_BUCKET = 'package-documents'

// The two Release types a Package uses for now. The Unconditional ones and the
// Retention Release are not generated yet.
export const CONDITIONAL_PROGRESS_TYPE = 'ConditionalWaiverAndReleaseOnProgressPayment'
export const CONDITIONAL_FINAL_TYPE = 'ConditionalWaiverAndReleaseOnFinalPayment'

// Variables a Package fills by itself: its own cut-off date and net amount, and
// the dates and amounts of the earlier Packages of its Job that are not paid.
export const PACKAGE_RELEASE_VARIABLES = [
  'through_date',
  'check_amount',
  'signature_date',
  'waiver_release_dates',
  'unpaid_progress_amount',
  // Conditional Final form: the unpaid earlier invoices added up.
  'disputed_claims_amount',
]

const WORKFLOW_LABELS = {
  DRAFT: 'Draft',
  AWAITING_PAYMENT: 'Awaiting payment',
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/**
 * Adds up amounts that may be numbers or typed text ("1,250.50", "$300"). Items
 * that are not numbers are ignored. Returns '' when none could be added, so the
 * blank on the form stays empty instead of printing 0.
 */
export function sumAmounts(amounts) {
  let total = 0
  let found = false
  for (const amount of amounts) {
    const number = typeof amount === 'number'
      ? amount
      : Number(String(amount ?? '').replace(/[$,\s]/g, '') || Number.NaN)
    if (Number.isFinite(number)) {
      total += number
      found = true
    }
  }
  return found ? Math.round(total * 100) / 100 : ''
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

function toFinalRelease(row) {
  const finalRelease = row ?? {}
  return {
    // false: nothing says where a Final applies (no scope in the Builder setup)
    // or the Package is a Retention Release; `reason` tells which.
    applicable: finalRelease.applicable === true,
    reason: finalRelease.reason ?? null,
    scope: finalRelease.scope ?? null,
    // True when this Package, counted as billed, leaves nothing to bill in
    // every scope it touches.
    isFinal: finalRelease.is_final === true,
    scopes: (finalRelease.scopes ?? []).map((scope) => ({
      key: scope.key,
      label: scope.label,
      total: Number(scope.total),
      remainingAfter: Number(scope.remaining_after),
      closes: scope.closes === true,
    })),
  }
}

/**
 * Whether an unpaid earlier Package belongs to a cut-off that has already passed
 * for this one. Packages in the same cut-off are billed together, so they are not
 * "earlier" payments to list: only a strictly earlier cut-off date counts. Dates
 * are ISO (YYYY-MM-DD), which compare as text. A date that is missing cannot be
 * told apart, so that Package is kept rather than hidden.
 */
export function isFromPastCutoff(pendingCutoffDate, ownCutoffDate) {
  if (!pendingCutoffDate || !ownCutoffDate) return true
  return pendingCutoffDate < ownCutoffDate
}

/** The row the values RPC returns, in the shape the screen uses. */
export function toPackageReleaseValues(row) {
  const unpaidEarlier = (row.pending_packages ?? []).map(toPendingPackage)
  return {
    packageId: row.package_id,
    jobId: row.job_id,
    packageNumber: row.package_number,
    packageType: row.package_type ?? 'DRAW',
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
    // Earlier Packages of the Job that are not paid yet and whose cut-off date has
    // already passed, oldest first. These fill the Exceptions lines.
    pendingPackages: unpaidEarlier.filter(
      (pending) => isFromPastCutoff(pending.cutoffDate, row.cutoff_date),
    ),
    // Unpaid earlier Packages left out because they share this Package's cut-off
    // date: they are part of the same billing, not an earlier payment.
    sameCutoffPackages: unpaidEarlier.filter(
      (pending) => !isFromPastCutoff(pending.cutoffDate, row.cutoff_date),
    ),
    finalRelease: toFinalRelease(row.final_release),
  }
}

/**
 * Which Release a Package needs and whether it can be generated.
 *  - `retention`: a Retention Release Package; its Release is not defined yet.
 *  - `missing_template`: the Job has no confirmed template of the type needed.
 *    A last Package is never filled with the Progress form instead.
 *  - `ready`: `template` is the one to fill.
 * `isFinal` is true for the Conditional Final Release; `closing` names the
 * scopes this Package finishes (e.g. "Phase 5").
 */
export function chooseRelease(values, templates) {
  const { finalRelease } = values
  if (finalRelease.reason === 'RETENTION_RELEASE' || values.packageType === 'RETENTION_RELEASE') {
    return { state: 'retention', releaseType: null, template: null, isFinal: false, closing: [] }
  }

  const isFinal = finalRelease.applicable && finalRelease.isFinal
  const releaseType = isFinal ? CONDITIONAL_FINAL_TYPE : CONDITIONAL_PROGRESS_TYPE
  const template = templates.find((candidate) => candidate.releaseType === releaseType) ?? null

  return {
    state: template ? 'ready' : 'missing_template',
    releaseType,
    template,
    isFinal,
    // Setups made before the Final option have no scope: every Package keeps
    // using the Progress form until the Builder setup is edited.
    scopeConfigured: finalRelease.applicable,
    closing: finalRelease.scopes.filter((scope) => scope.closes).map((scope) => scope.label),
  }
}

/**
 * The line printed under the signature of a Conditional Final Release, saying
 * what the Release is final for, from the Builder setup: per Phase, per
 * Building or per Project. `closing` names the Phases / Buildings this Package
 * finishes. Null when the setup does not say (or for anything but a Final).
 */
export function buildFinalReleaseNote({ scope, closing = [], jobCode = '' }) {
  const names = closing.filter(Boolean).join(', ')

  if (scope === 'PHASE') return names ? `Final release per Phase: ${names}` : 'Final release per Phase'
  if (scope === 'BUILDING') return names ? `Final release per Building: ${names}` : 'Final release per Building'
  if (scope === 'PROJECT') {
    return jobCode ? `Final release per Project (Job #${jobCode})` : 'Final release per Project'
  }
  return null
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
 *  - Disputed claims for extras (Conditional Final form): their net amounts
 *    added up.
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
    disputed_claims_amount: sumAmounts(pending.map((item) => item.netAmount)),
  }
}

/**
 * The editable Exceptions lines a Package starts with: one per unpaid earlier
 * Package (included, with its cut-off date and net amount as input text). A
 * person can edit them, leave one out or add lines by hand before generating.
 */
export function buildExceptionRows(values) {
  return (values.pendingPackages ?? []).map((item) => ({
    key: `package-${item.id}`,
    packageId: item.id,
    include: true,
    date: item.cutoffDate ?? '',
    amount: item.netAmount === null ? '' : String(item.netAmount),
  }))
}

/** An empty line the person fills in by hand. `key` must be unique among the rows. */
export function newManualExceptionRow(key) {
  return { key, packageId: null, include: true, date: '', amount: '' }
}

/**
 * What the Exceptions blanks print, from the rows: a date and an amount per
 * included row for the Progress form, and the amounts added up for the Final
 * form. A blank date or amount adds nothing.
 */
export function buildExceptionFillValues(rows) {
  const included = rows.filter((row) => row.include)
  return {
    waiver_release_dates: included.map((row) => row.date).filter(Boolean),
    unpaid_progress_amount: included
      .map((row) => String(row.amount ?? '').trim())
      .filter((amount) => amount !== ''),
    disputed_claims_amount: sumAmounts(included.map((row) => row.amount)),
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

export function buildPackageDocumentStoragePath(packageId, uniqueId) {
  return `${Number(packageId)}/release/${uniqueId}.pdf`
}

export function cleanNamePart(value) {
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
