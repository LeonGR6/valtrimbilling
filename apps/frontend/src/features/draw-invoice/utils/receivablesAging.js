// Accounts receivable aging, worked out from QuickBooks' own reading of each open
// invoice (its balance and its Due Date). The three views of the A/R screen (by Invoice, by Job, by
// Builder) all come from the list built here, so their amounts always agree: a
// bucket is decided for each Invoice, and Jobs and Builders only add up Invoices.
//
// Dates are plain "YYYY-MM-DD" days. Money is added in cents so a total never
// drifts by a cent.

import { daysBetween } from '../../dashboard/utils/dashboardDates.js'

/** From the first day after the Due Date. A bucket never overlaps the next one. */
export const AGING_BUCKETS = [
  { key: 'CURRENT', label: 'Current', short: 'Current' },
  { key: 'DAYS_1_30', label: '1–30 Days', short: '1–30' },
  { key: 'DAYS_31_60', label: '31–60 Days', short: '31–60' },
  { key: 'DAYS_61_90', label: '61–90 Days', short: '61–90' },
  { key: 'DAYS_91_PLUS', label: '91 & over', short: '91 & over' },
]

export const AGING_BUCKET_KEYS = AGING_BUCKETS.map(({ key }) => key)

const BUCKET_BY_KEY = Object.fromEntries(AGING_BUCKETS.map((bucket) => [bucket.key, bucket]))

export function agingBucketLabel(key) {
  return BUCKET_BY_KEY[key]?.label ?? ''
}

// A QuickBooks invoice that is settled (paid, closed by a credit) or gone (voided,
// deleted) is not receivable, whatever balance was last copied.
const SETTLED_PAYMENT_STATES = new Set(['PAID', 'CLOSED', 'VOIDED', 'DELETED'])

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

const californiaDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * Today in the company's calendar (California), the same day the payment check
 * uses for "overdue", so a person elsewhere does not see a different day.
 */
export function californiaDateKey(now = new Date()) {
  return californiaDay.format(now)
}

export function isDateKey(value) {
  if (typeof value !== 'string' || !DATE_KEY.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

/**
 * A report date can be today or later: only the balance of today is known (the
 * date each payment was applied is not kept), so an earlier day would show a
 * balance that did not exist then.
 */
export function isReportDateAllowed(reportDate, todayKey) {
  return isDateKey(reportDate) && reportDate >= todayKey
}

/** Whole days after the Due Date: 0 on the Due Date, negative before it, null without one. */
export function daysPastDue(dueDate, reportDate) {
  if (!isDateKey(dueDate) || !isDateKey(reportDate)) return null
  return daysBetween(dueDate, reportDate)
}

/** Current up to and including the Due Date; 1–30 from the next day; 91 or more is the last. */
export function agingBucketKey(days) {
  if (days == null || days <= 0) return 'CURRENT'
  if (days <= 30) return 'DAYS_1_30'
  if (days <= 60) return 'DAYS_31_60'
  if (days <= 90) return 'DAYS_61_90'
  return 'DAYS_91_PLUS'
}

export function toCents(value) {
  const cents = Math.round(Number(value) * 100)
  return Number.isFinite(cents) ? cents : 0
}

export function isReceivable(record) {
  return toCents(record?.balance) > 0 && !SETTLED_PAYMENT_STATES.has(record?.paymentState)
}

function ownerDetails(record, jobs) {
  const job = jobs.find((candidate) => String(candidate.id) === String(record.jobId))
  return {
    builderName: job?.builder || `Builder ${record.builderId}`,
    jobName: job?.code ? String(job.code) : `Job ${record.jobId}`,
    community: job?.community ?? '',
    // A Package of several Phases (or a Retention Release) has no Phase of its own, but its page
    // is only reached through a Phase: any Phase of the Job opens it, as in the Packages table.
    phaseId: record.phaseId ?? job?.sequenceSheet?.phases?.[0]?.id ?? null,
  }
}

/**
 * The open invoices with their aging on `reportDate`. Each record is what the
 * repository reads (see receivablesRecord.js); `jobs` gives the Job and Builder names.
 * An invoice with no Due Date has no days past due and stays Current.
 */
export function buildReceivableInvoices(records, { reportDate, jobs = [] }) {
  return records.filter(isReceivable).map((record) => {
    const days = daysPastDue(record.dueDate, reportDate)
    return {
      id: String(record.packageId),
      packageId: record.packageId,
      packageNumber: record.packageNumber,
      invoiceNumber: record.invoiceNumber || record.packageNumber,
      builderId: String(record.builderId),
      jobId: String(record.jobId),
      ...ownerDetails(record, jobs),
      invoiceDate: record.invoiceDate ?? null,
      dueDate: record.dueDate ?? null,
      originalCents: toCents(record.originalAmount),
      balanceCents: toCents(record.balance),
      daysPastDue: days,
      bucket: agingBucketKey(days),
      checkedAt: record.checkedAt ?? null,
    }
  })
}

function emptyBuckets() {
  return Object.fromEntries(AGING_BUCKET_KEYS.map((key) => [key, 0]))
}

/** Cents per bucket, the total and the count of a list of Invoices. */
export function totalReceivables(invoices) {
  const buckets = emptyBuckets()
  let totalCents = 0
  for (const invoice of invoices) {
    buckets[invoice.bucket] += invoice.balanceCents
    totalCents += invoice.balanceCents
  }
  return { buckets, totalCents, invoiceCount: invoices.length }
}

/**
 * One row per Builder or per Job, with the cents it owes in each bucket and the
 * Invoices that make them up. There is no days-past-due for a group: each
 * Invoice has its own.
 */
export function groupReceivables(invoices, level) {
  const groups = new Map()
  for (const invoice of invoices) {
    const key = level === 'job' ? invoice.jobId : invoice.builderId
    const group = groups.get(key) ?? {
      key,
      level,
      builderId: invoice.builderId,
      builderName: invoice.builderName,
      jobId: level === 'job' ? invoice.jobId : null,
      jobName: level === 'job' ? invoice.jobName : null,
      invoices: [],
    }
    group.invoices.push(invoice)
    groups.set(key, group)
  }
  return [...groups.values()].map((group) => ({ ...group, ...totalReceivables(group.invoices) }))
}

/** The Invoices that meet every filter. `bucket`, `builderId` and `jobId` are 'ALL' when unused. */
export function filterReceivables(invoices, { builderId = 'ALL', jobId = 'ALL', bucket = 'ALL', search = '' } = {}) {
  const needle = String(search).trim().toLowerCase()
  return invoices.filter((invoice) => {
    if (builderId !== 'ALL' && invoice.builderId !== String(builderId)) return false
    if (jobId !== 'ALL' && invoice.jobId !== String(jobId)) return false
    if (bucket !== 'ALL' && invoice.bucket !== bucket) return false
    if (!needle) return true
    return [invoice.invoiceNumber, invoice.packageNumber, invoice.builderName, invoice.jobName, invoice.community]
      .some((value) => String(value ?? '').toLowerCase().includes(needle))
  })
}

export function receivableBuilderOptions(invoices) {
  const names = new Map()
  for (const invoice of invoices) names.set(invoice.builderId, invoice.builderName)
  return [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}

/** The Jobs with open invoices, only those of `builderId` when one is chosen. */
export function receivableJobOptions(invoices, builderId = 'ALL') {
  const jobs = new Map()
  for (const invoice of invoices) {
    if (builderId !== 'ALL' && invoice.builderId !== String(builderId)) continue
    jobs.set(invoice.jobId, invoice.jobName)
  }
  return [...jobs]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}

/** The oldest time a balance was read from QuickBooks, or null when none says. */
export function oldestPaymentCheck(invoices) {
  let oldest = null
  for (const { checkedAt } of invoices) {
    if (checkedAt && (oldest === null || checkedAt < oldest)) oldest = checkedAt
  }
  return oldest
}

const text = (left, right) => String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true })
const number = (left, right) => (left ?? -Infinity) - (right ?? -Infinity)

const INVOICE_COMPARERS = {
  invoice: (a, b) => text(a.invoiceNumber, b.invoiceNumber),
  builder: (a, b) => text(a.builderName, b.builderName),
  job: (a, b) => text(a.jobName, b.jobName),
  invoiceDate: (a, b) => text(a.invoiceDate, b.invoiceDate),
  dueDate: (a, b) => text(a.dueDate, b.dueDate),
  original: (a, b) => number(a.originalCents, b.originalCents),
  balance: (a, b) => number(a.balanceCents, b.balanceCents),
  daysPastDue: (a, b) => number(a.daysPastDue, b.daysPastDue),
}

export const INVOICE_SORT_KEYS = Object.keys(INVOICE_COMPARERS)

/** Most overdue first by default, the largest balance breaking a tie. */
export const DEFAULT_INVOICE_SORT = { key: 'daysPastDue', direction: 'desc' }

export function sortReceivableInvoices(invoices, sort = DEFAULT_INVOICE_SORT) {
  const compare = INVOICE_COMPARERS[sort.key] ?? INVOICE_COMPARERS.daysPastDue
  const sign = sort.direction === 'asc' ? 1 : -1
  return [...invoices].sort((a, b) => (
    sign * compare(a, b)
    || b.balanceCents - a.balanceCents
    || text(a.invoiceNumber, b.invoiceNumber)
  ))
}

export const DEFAULT_GROUP_SORT = { key: 'total', direction: 'desc' }

/** Groups by name, by one bucket's amount (`key` is the bucket key) or by 'total'. */
export function sortReceivableGroups(groups, sort = DEFAULT_GROUP_SORT) {
  const sign = sort.direction === 'asc' ? 1 : -1
  const value = (group) => {
    if (sort.key === 'name') return null
    if (sort.key === 'total') return group.totalCents
    return group.buckets[sort.key] ?? 0
  }
  const name = (group) => group.jobName ?? group.builderName
  return [...groups].sort((a, b) => (
    sort.key === 'name'
      ? sign * text(name(a), name(b))
      : sign * (value(a) - value(b)) || text(name(a), name(b))
  ))
}
