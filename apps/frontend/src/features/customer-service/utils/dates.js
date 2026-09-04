// Dates travel as 'YYYY-MM-DD' strings everywhere in this feature, which is
// what Postgres will hand back and what compares correctly as plain text.
// Building the string by hand keeps it on the local day: toISOString() would
// shift to UTC and land on the previous date west of Greenwich.
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

export function formatLongDate(value) {
  if (!value) return ''

  return parseDate(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
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
