import { addDaysToKey, daysBetween, isWeekendKey } from './dashboardDates.js'

const OPEN_INVOICE_STATUSES = new Set(['ISSUED', 'SUBMITTED', 'PARTIALLY_PAID'])

/** An invoice due within this many days (today included) counts as due soon. */
export const DUE_SOON_DAYS = 7
export const PRODUCTION_TYPES = ['EXT', 'SHUTTER', 'DM', 'HW']

function dateKey(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)
    ? value.slice(0, 10)
    : null
}

export function localDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function windowEndKey(now, days) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  end.setDate(end.getDate() + days - 1)
  return localDateKey(end)
}

function balanceCents(invoice) {
  const net = Math.round(Number(invoice.netAmount) * 100)
  const paid = Math.round(Number(invoice.paidAmount) * 100)
  if (!Number.isFinite(net) || !Number.isFinite(paid)) return 0
  return Math.max(0, net - paid)
}

function buildCollectionAging(openInvoices, startKey) {
  const dueSoonEnd = addDaysToKey(startKey, DUE_SOON_DAYS - 1)
  const cents = { overdue: 0, dueSoon: 0, notDue: 0 }
  const counts = { overdue: 0, dueSoon: 0, notDue: 0 }

  for (const record of openInvoices) {
    const bucket = record.dueDate < startKey
      ? 'overdue'
      : record.dueDate <= dueSoonEnd ? 'dueSoon' : 'notDue'
    cents[bucket] += record.balanceCents
    counts[bucket] += 1
  }

  return Object.fromEntries(Object.keys(cents).map((bucket) => [
    bucket,
    { count: counts[bucket], balance: cents[bucket] / 100 },
  ]))
}

/**
 * The upcoming Production events laid out for a chart: one bucket per day for a
 * week, one per week (counted by type) for longer periods.
 */
export function buildProductionTimeline(upcomingEvents, startKey, endKey, days) {
  const typeCounts = Object.fromEntries(PRODUCTION_TYPES.map((type) => [type, 0]))
  for (const event of upcomingEvents) {
    const type = event.extendedProps?.activityType
    if (type in typeCounts) typeCounts[type] += 1
  }

  if (days <= 7) {
    const buckets = Array.from({ length: days }, (_, index) => {
      const key = addDaysToKey(startKey, index)
      return {
        key,
        isToday: index === 0,
        isWeekend: isWeekendKey(key),
        events: upcomingEvents.filter((event) => dateKey(event.start) === key),
      }
    })
    return { mode: 'days', buckets, typeCounts }
  }

  const weekCount = Math.ceil((daysBetween(startKey, endKey) + 1) / 7)
  const buckets = Array.from({ length: weekCount }, (_, index) => {
    const weekStart = addDaysToKey(startKey, index * 7)
    const weekEnd = addDaysToKey(weekStart, 6)
    const counts = Object.fromEntries(PRODUCTION_TYPES.map((type) => [type, 0]))
    let total = 0
    for (const event of upcomingEvents) {
      const key = dateKey(event.start)
      const type = event.extendedProps?.activityType
      if (key >= weekStart && key <= weekEnd && type in counts) {
        counts[type] += 1
        total += 1
      }
    }
    return { key: weekStart, isToday: index === 0, counts, total }
  })
  return { mode: 'weeks', buckets, typeCounts }
}

export function buildDashboardMetrics(events, packages, now = new Date(), days = 7) {
  const startKey = localDateKey(now)
  const endKey = windowEndKey(now, days)
  const upcomingEvents = events
    .filter((event) => {
      const scheduledDate = dateKey(event.start)
      return scheduledDate && scheduledDate >= startKey && scheduledDate <= endKey
    })
    .sort((left, right) => (
      String(left.start).localeCompare(String(right.start))
      || String(left.title).localeCompare(String(right.title))
    ))

  const eventTypeCounts = upcomingEvents.reduce((counts, event) => {
    const type = event.extendedProps?.activityType
    if (type) counts[type] = (counts[type] ?? 0) + 1
    return counts
  }, {})
  const tentativeCount = upcomingEvents.filter((event) => (
    event.extendedProps?.dateOwner === 'TENTATIVE'
  )).length

  const packageStatusCounts = packages.reduce((counts, record) => {
    if (record.status) counts[record.status] = (counts[record.status] ?? 0) + 1
    return counts
  }, {})

  const openInvoices = packages.flatMap((record) => {
    const invoice = record.persistedInvoice
    const dueDate = dateKey(record.dueDate)
    const balance = invoice ? balanceCents(invoice) : 0
    if (!OPEN_INVOICE_STATUSES.has(invoice?.status) || !dueDate || balance === 0) {
      return []
    }
    return [{
      ...record,
      dueDate,
      balance: balance / 100,
      balanceCents: balance,
      overdue: dueDate < startKey,
    }]
  }).sort((left, right) => (
    left.dueDate.localeCompare(right.dueDate)
    || String(left.invoiceNumber ?? left.packageNumber)
      .localeCompare(String(right.invoiceNumber ?? right.packageNumber))
  ))
  const pendingBalanceCents = openInvoices.reduce((total, record) => (
    total + record.balanceCents
  ), 0)

  return {
    startKey,
    endKey,
    upcomingEvents,
    eventTypeCounts,
    tentativeCount,
    packageStatusCounts,
    awaitingPaymentCount: packageStatusCounts.AWAITING_PAYMENT ?? 0,
    pendingBalance: pendingBalanceCents / 100,
    openInvoices,
    collectionAging: buildCollectionAging(openInvoices, startKey),
    timeline: buildProductionTimeline(upcomingEvents, startKey, endKey, days),
  }
}
