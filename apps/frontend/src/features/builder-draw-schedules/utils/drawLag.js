// A Draw can be billed some time after the event that enables it: a Builder that
// pays a second HW Draw one month after the first one gives that Draw a lag of
// one month. The lag is counted from the event date and is stored on the Draw as
// `{ value, unit }`, or `null` when the Draw is billable on the event date.

export const LAG_UNITS = ['DAYS', 'WEEKS', 'MONTHS']

const UNIT_LIMITS = { DAYS: 365, WEEKS: 52, MONTHS: 24 }

const UNIT_WORDS = {
  DAYS: ['day', 'days'],
  WEEKS: ['week', 'weeks'],
  MONTHS: ['month', 'months'],
}

export const lagUnitOptions = [
  { value: 'DAYS', label: 'Days' },
  { value: 'WEEKS', label: 'Weeks' },
  { value: 'MONTHS', label: 'Months' },
]

// The lags that come up most often, offered as one click.
export const lagPresets = [
  { value: 1, unit: 'WEEKS' },
  { value: 2, unit: 'WEEKS' },
  { value: 3, unit: 'WEEKS' },
  { value: 4, unit: 'WEEKS' },
  { value: 1, unit: 'MONTHS' },
  { value: 2, unit: 'MONTHS' },
  { value: 3, unit: 'MONTHS' },
]

export function lagLimit(unit) {
  return UNIT_LIMITS[unit] ?? 0
}

/** A valid lag as `{ value, unit }`, or null when there is none (or it is not valid). */
export function normalizeLag(lag) {
  if (lag == null) return null
  const unit = String(lag.unit ?? '').toUpperCase()
  const value = Number(lag.value)
  if (!LAG_UNITS.includes(unit)) return null
  if (!Number.isInteger(value) || value < 1 || value > UNIT_LIMITS[unit]) return null
  return { value, unit }
}

export function sameLag(left, right) {
  const a = normalizeLag(left)
  const b = normalizeLag(right)
  return a?.value === b?.value && a?.unit === b?.unit
}

/** "1 month", "3 weeks"; an empty string when there is no lag. */
export function formatLag(lag) {
  const normalized = normalizeLag(lag)
  if (!normalized) return ''
  const [singular, plural] = UNIT_WORDS[normalized.unit]
  return `${normalized.value} ${normalized.value === 1 ? singular : plural}`
}

/** "+1 mo", "+2 wk", "+10 d": the short form for a table heading. */
export function formatLagShort(lag) {
  const normalized = normalizeLag(lag)
  if (!normalized) return ''
  const suffix = { DAYS: 'd', WEEKS: 'wk', MONTHS: 'mo' }[normalized.unit]
  return `+${normalized.value} ${suffix}`
}

function parseDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''))
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.toISOString().slice(0, 10) === value ? date : null
}

/**
 * The date a Draw becomes billable: the event date plus its lag. Months keep the
 * day of the month and stop at the end of a shorter month (January 31 plus one
 * month is February 28). Without a lag, or for a date that is not valid, the
 * event date comes back as it was.
 */
export function addLag(dateKey, lag) {
  const normalized = normalizeLag(lag)
  const date = parseDateKey(dateKey)
  if (!normalized || !date) return dateKey

  if (normalized.unit === 'MONTHS') {
    const month = date.getUTCMonth() + normalized.value
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), month + 1, 0)).getUTCDate()
    return new Date(Date.UTC(
      date.getUTCFullYear(),
      month,
      Math.min(date.getUTCDate(), lastDay),
    )).toISOString().slice(0, 10)
  }

  const days = normalized.unit === 'WEEKS' ? normalized.value * 7 : normalized.value
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** Whether another Draw shares this Draw's event, the only case where a lag applies. */
export function drawSharesEvent(draws, index) {
  const eventType = draws[index]?.eventType
  if (!eventType) return false
  return draws.some((draw, otherIndex) => otherIndex !== index && draw.eventType === eventType)
}
