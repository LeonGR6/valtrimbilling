const OPEN_INVOICE_STATUSES = new Set(['ISSUED', 'SUBMITTED', 'PARTIALLY_PAID'])

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
    return [{ ...record, dueDate, balance: balance / 100, balanceCents: balance }]
  })
  const pendingBalanceCents = openInvoices.reduce((total, record) => (
    total + record.balanceCents
  ), 0)
  const dueInvoices = openInvoices
    .filter((record) => record.dueDate <= endKey)
    .sort((left, right) => (
      left.dueDate.localeCompare(right.dueDate)
      || String(left.invoiceNumber ?? left.packageNumber)
        .localeCompare(String(right.invoiceNumber ?? right.packageNumber))
    ))
    .map((record) => ({
      ...record,
      overdue: record.dueDate < startKey,
    }))

  return {
    startKey,
    endKey,
    upcomingEvents,
    eventTypeCounts,
    tentativeCount,
    packageStatusCounts,
    readyPackageCount: packageStatusCounts.READY_TO_SUBMIT ?? 0,
    pendingBalance: pendingBalanceCents / 100,
    dueInvoices,
  }
}
