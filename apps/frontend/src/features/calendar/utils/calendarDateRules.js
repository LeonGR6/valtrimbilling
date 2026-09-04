import { normalizeBuilderDateConfiguration } from '../../builders/data/builders.js'

const millisecondsPerDay = 24 * 60 * 60 * 1000

function parseDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return null

  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? date
    : null
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date, days) {
  return new Date(date.getTime() + (days * millisecondsPerDay))
}

function nthWeekdayOfMonth(year, month, weekday, occurrence) {
  const firstDay = new Date(Date.UTC(year, month, 1))
  const offset = (weekday - firstDay.getUTCDay() + 7) % 7
  return new Date(Date.UTC(year, month, 1 + offset + ((occurrence - 1) * 7)))
}

function lastWeekdayOfMonth(year, month, weekday) {
  const lastDay = new Date(Date.UTC(year, month + 1, 0))
  const offset = (lastDay.getUTCDay() - weekday + 7) % 7
  return addDays(lastDay, -offset)
}

function observedWeekday(date) {
  if (date.getUTCDay() === 6) return addDays(date, -1)
  if (date.getUTCDay() === 0) return addDays(date, 1)
  return date
}

function fixedFederalHolidaysForYear(year) {
  return [
    new Date(Date.UTC(year, 0, 1)),
    new Date(Date.UTC(year, 5, 19)),
    new Date(Date.UTC(year, 6, 4)),
    new Date(Date.UTC(year, 11, 25)),
  ]
}

export function getUsFederalHolidayDates(year) {
  const holidays = new Set([
    formatDateOnly(lastWeekdayOfMonth(year, 4, 1)),
    formatDateOnly(nthWeekdayOfMonth(year, 8, 1, 1)),
    formatDateOnly(nthWeekdayOfMonth(year, 10, 4, 4)),
  ])

  for (let holidayYear = year - 1; holidayYear <= year + 1; holidayYear += 1) {
    fixedFederalHolidaysForYear(holidayYear).forEach((holiday) => {
      const observed = observedWeekday(holiday)
      if (observed.getUTCFullYear() === year) holidays.add(formatDateOnly(observed))
    })
  }

  return [...holidays].sort()
}

export function isUsFederalHoliday(value) {
  const date = parseDateOnly(value)
  if (!date) return false
  return getUsFederalHolidayDates(date.getUTCFullYear()).includes(value)
}

export function addWeeksExcludingUsFederalHolidays(value, weeks) {
  const startDate = parseDateOnly(value)
  const totalDays = Number(weeks) * 7
  if (!startDate || !Number.isInteger(totalDays) || totalDays < 0) return ''

  let date = startDate
  let countedDays = 0

  while (countedDays < totalDays) {
    date = addDays(date, 1)
    const dateValue = formatDateOnly(date)
    if (!isUsFederalHoliday(dateValue)) countedDays += 1
  }

  return formatDateOnly(date)
}

export function subtractWeeksExcludingUsFederalHolidays(value, weeks) {
  const startDate = parseDateOnly(value)
  const totalDays = Number(weeks) * 7
  if (!startDate || !Number.isInteger(totalDays) || totalDays < 0) return ''

  let date = startDate
  let countedDays = 0

  while (countedDays < totalDays) {
    date = addDays(date, -1)
    const dateValue = formatDateOnly(date)
    if (!isUsFederalHoliday(dateValue)) countedDays += 1
  }

  return formatDateOnly(date)
}

export function calculateShutterDate(dmDate, configuration) {
  const normalized = normalizeBuilderDateConfiguration(configuration)
  return subtractWeeksExcludingUsFederalHolidays(
    dmDate,
    normalized.shutterBeforeDmWeeks,
  )
}

export function calculateProductionDates(extDate, configuration) {
  const normalized = normalizeBuilderDateConfiguration(configuration)
  const dmDate = addWeeksExcludingUsFederalHolidays(extDate, normalized.extToDmWeeks)
  const hwDate = addWeeksExcludingUsFederalHolidays(dmDate, normalized.dmToHwWeeks)

  return { extDate, dmDate, hwDate }
}

function shiftDateByBaseDifference(value, previousBaseDate, nextBaseDate) {
  const date = parseDateOnly(value)
  const previousBase = parseDateOnly(previousBaseDate)
  const nextBase = parseDateOnly(nextBaseDate)
  if (!date || !previousBase || !nextBase) return value

  const difference = Math.round((nextBase.getTime() - previousBase.getTime()) / millisecondsPerDay)
  return formatDateOnly(addDays(date, difference))
}

function shiftSplitParts(parts, previousBaseDate, nextBaseDate) {
  return (parts ?? []).map((part) => ({
    ...part,
    date: shiftDateByBaseDifference(part.date, previousBaseDate, nextBaseDate),
  }))
}

export function getProductionDateCascade(draft, activityType, nextDate, configuration) {
  if (!parseDateOnly(nextDate)) {
    return { [`${activityType.toLowerCase()}Date`]: nextDate }
  }

  const normalized = normalizeBuilderDateConfiguration(configuration)

  if (activityType === 'EXT') {
    const dates = calculateProductionDates(nextDate, normalized)
    return {
      extDate: dates.extDate,
      dmDate: dates.dmDate,
      dmSplitParts: shiftSplitParts(draft.dmSplitParts, draft.dmDate, dates.dmDate),
      ...(draft.dmShutters && {
        shutterDate: calculateShutterDate(dates.dmDate, normalized),
      }),
      hwDate: dates.hwDate,
      hwSplitParts: shiftSplitParts(draft.hwSplitParts, draft.hwDate, dates.hwDate),
    }
  }

  if (activityType === 'DM') {
    const hwDate = addWeeksExcludingUsFederalHolidays(nextDate, normalized.dmToHwWeeks)
    return {
      dmDate: nextDate,
      dmSplitParts: shiftSplitParts(draft.dmSplitParts, draft.dmDate, nextDate),
      ...(draft.dmShutters && {
        shutterDate: calculateShutterDate(nextDate, normalized),
      }),
      hwDate,
      hwSplitParts: shiftSplitParts(draft.hwSplitParts, draft.hwDate, hwDate),
    }
  }

  if (activityType === 'SHUTTER') {
    return { shutterDate: nextDate }
  }

  return {
    hwDate: nextDate,
    hwSplitParts: shiftSplitParts(draft.hwSplitParts, draft.hwDate, nextDate),
  }
}
