const MS_PER_DAY = 86400000

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

function dateOnMonthDay(year, month, day) {
  return new Date(year, month, Math.min(day, daysInMonth(year, month)))
}

function addDays(date, days) {
  return new Date(date.getTime() + days * MS_PER_DAY)
}

function monthLabel(date) {
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function resolveInvoiceDate(rule, cutoffDate, submissionDate) {
  if (rule === 'CUTOFF') return cutoffDate
  if (rule === 'MONTH_END') {
    return dateOnMonthDay(cutoffDate.getFullYear(), cutoffDate.getMonth(), 31)
  }
  return submissionDate
}

function buildPeriod(setup, periodStart, cutoffDate, submissionDate, index) {
  const invoiceDate = resolveInvoiceDate(
    setup.invoiceDateRule,
    cutoffDate,
    submissionDate,
  )

  return {
    key: `${cutoffDate.getTime()}-${index}`,
    label: monthLabel(cutoffDate),
    periodStart,
    cutoffDate,
    submissionDate,
    invoiceDate,
    estimatedPaymentDate: addDays(invoiceDate, setup.paymentTermsDays ?? 0),
  }
}

function monthlyPeriods(setup, count, from) {
  const periods = []
  let year = from.getFullYear()
  let month = from.getMonth()

  for (let index = 0; index < count; index += 1) {
    const cutoffDate = dateOnMonthDay(year, month, setup.cutoffDay)
    const submissionMonth = setup.submissionDay < setup.cutoffDay ? month + 1 : month
    const submissionDate = dateOnMonthDay(year, submissionMonth, setup.submissionDay)
    const periodStart = dateOnMonthDay(year, month - 1, setup.cutoffDay + 1)

    periods.push(buildPeriod(setup, periodStart, cutoffDate, submissionDate, index))
    month += 1
  }

  return periods
}

function semimonthlyPeriods(setup, count, from) {
  const periods = []
  const days = [...(setup.cutoffDays ?? [])].sort((a, b) => a - b)
  if (days.length === 0) return periods

  let year = from.getFullYear()
  let month = from.getMonth()
  let dayIndex = 0

  for (let index = 0; index < count; index += 1) {
    const cutoffDate = dateOnMonthDay(year, month, days[dayIndex])
    const submissionDate = addDays(cutoffDate, setup.submissionOffsetDays ?? 0)
    const previousDay = dayIndex === 0 ? days[days.length - 1] : days[dayIndex - 1]
    const periodStart = dateOnMonthDay(
      year,
      dayIndex === 0 ? month - 1 : month,
      previousDay + 1,
    )

    periods.push(buildPeriod(setup, periodStart, cutoffDate, submissionDate, index))

    dayIndex += 1
    if (dayIndex >= days.length) {
      dayIndex = 0
      month += 1
    }
  }

  return periods
}

function weeklyPeriods(setup, count, from) {
  const periods = []
  const target = setup.cutoffWeekday ?? 0
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate())

  while (cursor.getDay() !== target) {
    cursor.setDate(cursor.getDate() + 1)
  }

  for (let index = 0; index < count; index += 1) {
    const cutoffDate = addDays(cursor, index * 7)
    const submissionDate = addDays(cutoffDate, setup.submissionOffsetDays ?? 0)
    const periodStart = addDays(cutoffDate, -6)

    periods.push(buildPeriod(setup, periodStart, cutoffDate, submissionDate, index))
  }

  return periods
}

export function computeDrawPeriods(setup, count = 3, from = new Date()) {
  if (!setup) return []

  switch (setup.frequency) {
    case 'SEMIMONTHLY':
      return semimonthlyPeriods(setup, count, from)
    case 'WEEKLY':
      return weeklyPeriods(setup, count, from)
    case 'MONTHLY':
      return monthlyPeriods(setup, count, from)
    default:
      return []
  }
}

export function formatPeriodDate(date) {
  if (!date) return '—'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function describeSchedule(setup) {
  switch (setup.frequency) {
    case 'MONTHLY':
      return `Cutoff day ${setup.cutoffDay}, due day ${setup.submissionDay}`
    case 'SEMIMONTHLY':
      return `Cutoff days ${(setup.cutoffDays ?? []).join(' and ')}, due ${setup.submissionOffsetDays}d later`
    case 'WEEKLY': {
      const weekday = new Date(2024, 0, 7 + (setup.cutoffWeekday ?? 0))
        .toLocaleDateString('en-US', { weekday: 'long' })
      return `Cutoff every ${weekday}, due ${setup.submissionOffsetDays}d later`
    }
    default:
      return 'Not configured'
  }
}
