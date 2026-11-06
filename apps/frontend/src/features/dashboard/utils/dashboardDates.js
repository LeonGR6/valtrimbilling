// Date keys ("2026-10-21") are local calendar days. Differences are computed in
// UTC so a daylight-saving change never makes a day 23 or 25 hours long.

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function parseDateKey(key) {
  const [year, month, day] = String(key).slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day)
}

function utcDay(key) {
  const [year, month, day] = String(key).slice(0, 10).split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

/** Whole days from `fromKey` to `toKey` (negative when `toKey` is earlier). */
export function daysBetween(fromKey, toKey) {
  return Math.round((utcDay(toKey) - utcDay(fromKey)) / MS_PER_DAY)
}

export function addDaysToKey(key, days) {
  const date = new Date(utcDay(key) + days * MS_PER_DAY)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isWeekendKey(key) {
  const weekday = parseDateKey(key).getDay()
  return weekday === 0 || weekday === 6
}

/** "Fri, Oct 23" */
export function formatDayLabel(key) {
  return parseDateKey(key).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

/** "Oct 23" */
export function formatMonthDay(key) {
  return parseDateKey(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** "Wednesday, October 21" */
export function formatFullDay(date) {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}
