export const customerServiceTimeZone = 'America/Los_Angeles'

const operationalClock = new Intl.DateTimeFormat('en-US', {
  timeZone: customerServiceTimeZone,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

export function getCustomerServiceClock(now = new Date()) {
  const parts = Object.fromEntries(operationalClock.formatToParts(now).map(({ type, value }) => [type, value]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutesSinceMidnight: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

// Calendar-only arithmetic keeps a YYYY-MM-DD day without converting it to UTC.
// Use getCustomerServiceClock for the operational current day/time instead.
export function toIsoDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

// The same trap in reverse: new Date(iso) reads the string as UTC, so the date
// has to be rebuilt from its parts to stay on the local day.
function parseDate(value) {
  const [year, month, day] = value.split('-').map(Number)

  return new Date(year, month - 1, day)
}

export function formatShortDate(value) {
  return value ? parseDate(value).toLocaleDateString('en-US') : ''
}

export function formatUsDateInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value ?? '') || toIsoDate(parseDate(value)) !== value) {
    return value ?? ''
  }

  const [year, month, day] = value.split('-')
  return `${month}/${day}/${year}`
}

export function parseUsDateInput(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(value ?? '')
  if (!match) return ''

  const [, month, day, year] = match
  const isoDate = `${year}-${month}-${day}`
  const parsed = parseDate(isoDate)

  return toIsoDate(parsed) === isoDate ? isoDate : ''
}

export function formatLongDate(value) {
  if (!value) return ''

  return parseDate(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// '2026-11-12' reads as 'Thu, Nov 12' in any browser time zone.
export function formatWeekdayDate(value) {
  if (!value) return ''

  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

// '09:00' reads as '9:00 AM'. The date only exists to carry the clock.
export function formatTime(value) {
  if (!value) return ''

  const [hours, minutes] = value.split(':').map(Number)

  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}
