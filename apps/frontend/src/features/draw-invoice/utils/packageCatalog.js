import { displayInvoiceNumber } from './packageInvoiceLabel.js'
import {
  DRAW_PACKAGE_STATUSES,
  DRAW_PACKAGE_STATUS_LABELS,
  canDeleteVoidedQuickbooksPackage,
  canManageDraftDrawPackage,
} from '../services/drawInvoicePackageRecord.js'

export const PACKAGE_CATALOG_TABS = [
  { value: 'ALL', label: 'All' },
  ...DRAW_PACKAGE_STATUSES.map((value) => ({
    value,
    label: DRAW_PACKAGE_STATUS_LABELS[value],
  })),
]

const PACKAGE_TYPE_SEARCH_TERMS = {
  RETENTION_RELEASE: 'retention release',
  PRICE_ADJUSTMENT: 'price adjustment',
  OPTIONS: 'options',
  DRAW: 'draw',
}

export function canDeleteDraftPackage(record) {
  if (record?.status !== 'DRAFT') return false
  if (record.packageType === 'DRAW') {
    return canManageDraftDrawPackage(record) || canDeleteVoidedQuickbooksPackage(record)
  }
  // An adjustment whose QuickBooks invoice was voided can be cancelled like a Draw.
  if (canDeleteVoidedQuickbooksPackage(record)) return true
  return record.persistedInvoice?.status === 'DRAFT'
    && !record.invoiceNumber
    && !record.invoiceDate
    && record.persistedInvoice.paidAmount === 0
    && record.quickbooksStatus === 'NOT_CREATED'
    && !record.quickbooksReference
    && record.submissionStatus === 'NOT_SUBMITTED'
    && !record.submittedAt
}

export function filterPackageCatalogContexts(contexts, {
  search = '',
  builderId = 'ALL',
  community = 'ALL',
  status = 'ALL',
} = {}) {
  const normalizedSearch = String(search).trim().toLowerCase()
  return contexts.filter(({ record, job, phase, phases = [phase] }) => {
    if (record.status === 'CANCELLED') return false
    if (status !== 'ALL' && record.status !== status) return false
    if (builderId !== 'ALL' && String(record.builderId) !== String(builderId)) {
      return false
    }
    if (community !== 'ALL' && job.community !== community) return false
    if (!normalizedSearch) return true

    return [
      record.packageNumber,
      record.invoiceNumber,
      displayInvoiceNumber(record),
      PACKAGE_TYPE_SEARCH_TERMS[record.packageType] ?? 'draw',
      record.retentionRelease?.scopeType,
      record.retentionRelease?.phaseCode,
      record.retentionRelease?.building,
      job.code,
      job.builder,
      job.community,
      ...phases.flatMap((candidate) => [candidate?.name, candidate?.building]),
    ].some((value) => String(value ?? '').toLowerCase().includes(normalizedSearch))
  })
}

const OPEN_PAYMENT_STATES = new Set(['OPEN', 'OVERDUE', 'PARTIALLY_PAID'])

/**
 * What is still owed of a Package's invoice, in cents: the balance QuickBooks reports while the
 * invoice is open (a partial payment leaves the Package Awaiting payment), never more than the
 * invoice, and the whole invoice when QuickBooks was not asked or has no open balance.
 */
export function packageOwedCents(record, invoiceCents) {
  if (!OPEN_PAYMENT_STATES.has(record?.paymentState) || record.paymentBalance == null) {
    return invoiceCents
  }
  return Math.min(invoiceCents, Math.max(0, Math.round(Number(record.paymentBalance) * 100)))
}

/**
 * Count, invoice total and what is still owed of the Packages of each status. `owed` is less than
 * `total` when an open invoice was partly paid.
 */
export function summarizePackageCatalogStatuses(contexts) {
  const summary = Object.fromEntries(
    DRAW_PACKAGE_STATUSES.map((status) => [status, { count: 0, total: 0, owed: 0 }]),
  )
  for (const { record, summary: financials } of contexts) {
    const bucket = summary[record.status]
    if (!bucket) continue
    const invoiceCents = Math.round((Number(financials?.invoiceAmount) || 0) * 100)
    bucket.count += 1
    bucket.total += invoiceCents
    bucket.owed += packageOwedCents(record, invoiceCents)
  }
  for (const bucket of Object.values(summary)) {
    bucket.total /= 100
    bucket.owed /= 100
  }
  return summary
}

export function packageCatalogBuilderOptions(contexts) {
  return [...new Map(contexts.map(({ record, job }) => [
    String(record.builderId),
    { id: String(record.builderId), name: job.builder },
  ])).values()].sort((left, right) => left.name.localeCompare(right.name))
}

export function packageCatalogCommunityOptions(contexts, builderId = 'ALL') {
  return [...new Set(contexts
    .filter(({ record }) => builderId === 'ALL'
      || String(record.builderId) === String(builderId))
    .map(({ job }) => job.community)
    .filter(Boolean))].sort((left, right) => left.localeCompare(right))
}

// Sortable columns of the Packages table. The first click uses the direction
// each column is read in most often: newest first, A to Z, smallest first.
export const PACKAGE_SORT_COLUMNS = {
  created: { label: 'Created date', firstDirection: 'desc' },
  period: { label: 'Billing Period', firstDirection: 'desc' },
  builder: { label: 'Builder', firstDirection: 'asc' },
  invoice: { label: 'Invoice Amount', firstDirection: 'asc' },
}

export function isValidPackageSort(value) {
  return value === null || (
    typeof value === 'object'
    && value !== null
    && value.key in PACKAGE_SORT_COLUMNS
    && (value.direction === 'asc' || value.direction === 'desc')
  )
}

/** Click on a column header: first direction, then the opposite, then no sort. */
export function nextPackageSort(current, key) {
  const column = PACKAGE_SORT_COLUMNS[key]
  if (!column) return current
  if (current?.key !== key) return { key, direction: column.firstDirection }
  if (current.direction === column.firstDirection) {
    return { key, direction: column.firstDirection === 'asc' ? 'desc' : 'asc' }
  }
  return null
}

const text = (left, right) => String(left ?? '').localeCompare(String(right ?? ''), 'en', {
  numeric: true,
  sensitivity: 'base',
})

/**
 * The date shown in the Billing Period column: the cutoff of a Draw Package, or
 * the date a Retention Release becomes available. "Any date" and "Not set" have none.
 */
export function packageBillingPeriodDate(record) {
  if (record?.packageType === 'RETENTION_RELEASE') {
    return record.retentionRelease?.availableDate ?? null
  }
  // An adjustment, and Options billed on their own, have no cutoff: they are dated when created.
  if (record?.packageType === 'PRICE_ADJUSTMENT' || record?.packageType === 'OPTIONS') {
    return record.packageDate ?? null
  }
  if (record?.billingCutoffAnyDate) return null
  return record?.billingCutoffDate ?? null
}

const sortValues = {
  created: (left, right) => String(left.record.createdAt ?? '')
    .localeCompare(String(right.record.createdAt ?? '')),
  builder: (left, right) => text(left.job.builder, right.job.builder)
    || text(left.job.community, right.job.community),
  period: (left, right) => String(packageBillingPeriodDate(left.record) ?? '')
    .localeCompare(String(packageBillingPeriodDate(right.record) ?? '')),
  invoice: (left, right) => (Number(left.summary?.invoiceAmount) || 0)
    - (Number(right.summary?.invoiceAmount) || 0),
}

/** Returns a sorted copy; without a sort the order is left as it came. */
export function sortPackageCatalogContexts(contexts, sort) {
  const compare = sortValues[sort?.key]
  if (!compare) return contexts

  const direction = sort.direction === 'desc' ? -1 : 1
  return [...contexts].sort((left, right) => {
    // Packages without a Billing Period date go last in either direction.
    if (sort.key === 'period') {
      const leftDate = packageBillingPeriodDate(left.record)
      const rightDate = packageBillingPeriodDate(right.record)
      if (!leftDate !== !rightDate) return leftDate ? -1 : 1
    }

    return direction * compare(left, right)
      // Equal values keep a stable, predictable order: newest Package number first.
      || Number(right.record.id) - Number(left.record.id)
  })
}
