// Turns a builder's cutoff rule into the concrete billing windows it produces.
// This is what makes an abstract rule ("day 20") verifiable in the UI, and it
// is the same calculation the backend will use to decide which draw a piece of
// completed work belongs to.

const MS_PER_DAY = 86400000

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

// Clamps day 31 down to 28/30 so short months never roll into the next one.
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

function buildPeriod(profile, periodStart, cutoffDate, submissionDate, index) {
  const invoiceDate = resolveInvoiceDate(
    profile.invoiceDateRule,
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
    estimatedPaymentDate: addDays(invoiceDate, profile.paymentTermsDays ?? 0),
  }
}

function monthlyPeriods(profile, count, from) {
  const periods = []
  let year = from.getFullYear()
  let month = from.getMonth()

  for (let index = 0; index < count; index += 1) {
    const cutoffDate = dateOnMonthDay(year, month, profile.cutoffDay)
    // A submission day earlier than the cutoff means it lands the next month.
    const submissionMonth =
      profile.submissionDay < profile.cutoffDay ? month + 1 : month
    const submissionDate = dateOnMonthDay(year, submissionMonth, profile.submissionDay)
    const periodStart = dateOnMonthDay(year, month - 1, profile.cutoffDay + 1)

    periods.push(buildPeriod(profile, periodStart, cutoffDate, submissionDate, index))
    month += 1
  }

  return periods
}

function semimonthlyPeriods(profile, count, from) {
  const periods = []
  const days = [...(profile.cutoffDays ?? [])].sort((a, b) => a - b)
  if (days.length === 0) return periods

  let year = from.getFullYear()
  let month = from.getMonth()
  let dayIndex = 0

  for (let index = 0; index < count; index += 1) {
    const cutoffDate = dateOnMonthDay(year, month, days[dayIndex])
    const submissionDate = addDays(cutoffDate, profile.submissionOffsetDays ?? 0)
    const previousDay = dayIndex === 0 ? days[days.length - 1] : days[dayIndex - 1]
    const periodStart = dateOnMonthDay(
      year,
      dayIndex === 0 ? month - 1 : month,
      previousDay + 1,
    )

    periods.push(buildPeriod(profile, periodStart, cutoffDate, submissionDate, index))

    dayIndex += 1
    if (dayIndex >= days.length) {
      dayIndex = 0
      month += 1
    }
  }

  return periods
}

function weeklyPeriods(profile, count, from) {
  const periods = []
  const target = profile.cutoffWeekday ?? 0
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate())

  // Walk forward to the first cutoff weekday on or after `from`.
  while (cursor.getDay() !== target) {
    cursor.setDate(cursor.getDate() + 1)
  }

  for (let index = 0; index < count; index += 1) {
    const cutoffDate = addDays(cursor, index * 7)
    const submissionDate = addDays(cutoffDate, profile.submissionOffsetDays ?? 0)
    const periodStart = addDays(cutoffDate, -6)

    periods.push(buildPeriod(profile, periodStart, cutoffDate, submissionDate, index))
  }

  return periods
}

export function computeDrawPeriods(profile, count = 3, from = new Date()) {
  if (!profile) return []

  switch (profile.frequency) {
    case 'SEMIMONTHLY':
      return semimonthlyPeriods(profile, count, from)
    case 'WEEKLY':
      return weeklyPeriods(profile, count, from)
    case 'MONTHLY':
      return monthlyPeriods(profile, count, from)
    default:
      return []
  }
}

export function formatPeriodDate(date) {
  if (!date) return '—'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// One-line summary of the rule, for the catalog table.
export function describeSchedule(profile) {
  switch (profile.frequency) {
    case 'MONTHLY':
      return `Cutoff day ${profile.cutoffDay}, due day ${profile.submissionDay}`
    case 'SEMIMONTHLY':
      return `Cutoff days ${(profile.cutoffDays ?? []).join(' and ')}, due ${profile.submissionOffsetDays}d later`
    case 'WEEKLY': {
      const weekday = new Date(2024, 0, 7 + (profile.cutoffWeekday ?? 0))
        .toLocaleDateString('en-US', { weekday: 'long' })
      return `Cutoff every ${weekday}, due ${profile.submissionOffsetDays}d later`
    }
    default:
      return 'Not configured'
  }
}
