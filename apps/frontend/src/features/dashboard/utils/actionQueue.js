// "Needs action": the one list the Dashboard opens with. It joins what is due on
// the billing side (cutoffs to bill, overdue or soon-due invoices) with the
// Phases that still have no Calendar events, and puts the most urgent first.
import { displayInvoiceNumber } from '../../draw-invoice/utils/packageInvoiceLabel.js'
import { formatPhaseBuilding } from '../../calendar/components/calendarSchedulerUtils.js'
import { calendarSchedulePath } from '../../calendar/utils/calendarRoutes.js'
import { jobDrawInvoicePath } from '../../jobs/utils/jobRoutes.js'
import {
  addDaysToKey, daysBetween, formatDayLabel, formatMonthDay, pluralize,
} from './dashboardDates.js'
import { DUE_SOON_DAYS } from './dashboardMetrics.js'

export const PACKAGE_SUGGESTIONS_PATH = '/draw-invoice#package-suggestions'

// Overdue invoices and a cutoff today come first, then what is due soon, then
// the Phases that wait without a deadline.
const TIER_NOW = 1
const TIER_SOON = 2
const TIER_WAITING = 3

function cutoffItem(suggestion) {
  const { job, isCutoffToday, businessDaysRemaining } = suggestion
  return {
    id: `cutoff:${job.id}`,
    kind: 'cutoff',
    group: 'billing',
    tone: 'soon',
    tier: isCutoffToday ? TIER_NOW : TIER_SOON,
    sortKey: suggestion.cutoffDate,
    headline: isCutoffToday ? 'Cutoff today' : pluralize(businessDaysRemaining, 'business day'),
    dateLabel: formatDayLabel(suggestion.cutoffDate),
    title: `Job #${job.code} · ${job.community}`,
    subtitle: [
      job.builder,
      pluralize(suggestion.selectionCount, 'suggested cell'),
      suggestion.isReady ? 'Ready to review' : 'Needs attention',
    ].join(' · '),
    amount: suggestion.estimatedInvoiceAmount,
    amountCaption: 'Estimated',
    actionLabel: 'Review package',
    to: PACKAGE_SUGGESTIONS_PATH,
  }
}

function invoiceItem(record, jobsById, todayKey) {
  const job = jobsById.get(String(record.jobId))
  const daysLate = daysBetween(record.dueDate, todayKey)
  const daysLeft = -daysLate
  const number = displayInvoiceNumber(record)
  const overdue = daysLate > 0

  let headline = 'Due today'
  if (overdue) headline = `${pluralize(daysLate, 'day')} late`
  else if (daysLeft > 0) headline = `Due in ${pluralize(daysLeft, 'day')}`

  return {
    id: `invoice:${record.id}`,
    kind: 'invoice',
    group: 'billing',
    tone: overdue ? 'late' : 'soon',
    tier: daysLeft > 0 ? TIER_SOON : TIER_NOW,
    sortKey: record.dueDate,
    headline,
    dateLabel: `Due ${formatDayLabel(record.dueDate)}`,
    title: number ? `Invoice ${number}` : record.packageNumber,
    subtitle: job ? `Job #${job.code} · ${job.community}` : `Package ${record.packageNumber}`,
    amount: record.balance,
    amountCaption: 'Balance',
    actionLabel: 'Open invoice',
    to: job
      ? jobDrawInvoicePath(record.builderId, record.jobId, record.phaseId, record.id)
      : '/draw-invoice',
  }
}

function phaseItem({ key, job, phase, lotCount }, todayKey) {
  const createdAt = phase.createdAt ? String(phase.createdAt).slice(0, 10) : null
  const daysWaiting = createdAt ? Math.max(0, daysBetween(createdAt, todayKey)) : null

  let headline = 'Not scheduled'
  if (daysWaiting === 0) headline = 'Created today'
  else if (daysWaiting > 0) headline = `${pluralize(daysWaiting, 'day')} waiting`

  return {
    id: `phase:${key}`,
    kind: 'phase',
    group: 'calendar',
    tone: 'wait',
    tier: TIER_WAITING,
    sortKey: createdAt ?? '9999-12-31',
    headline,
    dateLabel: createdAt ? `Created ${formatMonthDay(createdAt)}` : '',
    title: `Job #${job.code} · ${formatPhaseBuilding(phase.name, phase.building)}`,
    subtitle: [job.builder, job.community, pluralize(lotCount, 'lot')].join(' · '),
    amount: null,
    amountCaption: 'No events yet',
    actionLabel: 'Schedule',
    to: calendarSchedulePath(job.id, phase.id),
  }
}

export function buildActionQueue({
  cutoffSuggestions = [],
  openInvoices = [],
  unscheduledPhases = [],
  jobsById = new Map(),
  todayKey,
}) {
  const dueSoonEnd = addDaysToKey(todayKey, DUE_SOON_DAYS - 1)
  const items = [
    ...cutoffSuggestions.map(cutoffItem),
    ...openInvoices
      .filter((record) => record.dueDate <= dueSoonEnd)
      .map((record) => invoiceItem(record, jobsById, todayKey)),
    ...unscheduledPhases.map((entry) => phaseItem(entry, todayKey)),
  ]

  return items.sort((left, right) => (
    left.tier - right.tier
    || left.sortKey.localeCompare(right.sortKey)
    || left.id.localeCompare(right.id)
  ))
}

/** The counts the Dashboard sentence reads out: "2 cutoffs to bill, ...". */
export function summarizeActionQueue(items) {
  return {
    cutoffs: items.filter((item) => item.kind === 'cutoff').length,
    overdueInvoices: items.filter((item) => item.kind === 'invoice' && item.tone === 'late').length,
    phases: items.filter((item) => item.kind === 'phase').length,
  }
}
