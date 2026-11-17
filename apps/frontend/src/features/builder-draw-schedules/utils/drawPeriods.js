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

function buildPeriod(setup, periodStart, cutoffDate, index) {
  return {
    key: `${cutoffDate.getTime()}-${index}`,
    label: monthLabel(cutoffDate),
    periodStart,
    cutoffDate,
    invoiceDate: cutoffDate,
    estimatedPaymentDate: addDays(cutoffDate, setup.paymentTermsDays ?? 0),
  }
}

function monthlyPeriods(setup, count, from) {
  const periods = []
  let year = from.getFullYear()
  let month = from.getMonth()

  for (let index = 0; index < count; index += 1) {
    const cutoffDate = dateOnMonthDay(year, month, setup.cutoffDay)
    const periodStart = dateOnMonthDay(year, month - 1, setup.cutoffDay + 1)

    periods.push(buildPeriod(setup, periodStart, cutoffDate, index))
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
    const previousDay = dayIndex === 0 ? days[days.length - 1] : days[dayIndex - 1]
    const periodStart = dateOnMonthDay(
      year,
      dayIndex === 0 ? month - 1 : month,
      previousDay + 1,
    )

    periods.push(buildPeriod(setup, periodStart, cutoffDate, index))

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
    const periodStart = addDays(cutoffDate, -6)

    periods.push(buildPeriod(setup, periodStart, cutoffDate, index))
  }

  return periods
}

export function computeDrawPeriods(setup, count = 3, from = new Date()) {
  if (!setup || setup.anyDate) return []

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
      if (setup.anyDate) {
        return 'Any date · highest-value rolling 14-day Calendar window'
      }
      return `Cutoff date: day ${setup.cutoffDay}`
    case 'SEMIMONTHLY':
      return `Cutoff dates: days ${(setup.cutoffDays ?? []).join(' and ')}`
    case 'WEEKLY': {
      const weekday = new Date(2024, 0, 7 + (setup.cutoffWeekday ?? 0))
        .toLocaleDateString('en-US', { weekday: 'long' })
      return `Cutoff every ${weekday}`
    }
    default:
      return 'Not configured'
  }
}
