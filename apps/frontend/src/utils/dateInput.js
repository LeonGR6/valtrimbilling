// Dates typed by hand as MM/DD/YYYY, and their ISO "YYYY-MM-DD" form.

const SEPARATORS = /[/.-]/

function isRealDate(year, month, day) {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

/** "2026-05-12" -> "05/12/2026"; anything that is not an ISO date -> "". */
export function isoToDateText(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  return match ? `${match[2]}/${match[3]}/${match[1]}` : ''
}

/**
 * What was typed -> an ISO date, or "" while it is empty, incomplete or not a
 * real date. Accepts 05/12/2026, 5/12/2026, 5-12-2026, 5.12.2026 and 05122026.
 */
export function dateTextToIso(text) {
  const value = String(text ?? '').trim()
  let parts = null

  if (/^\d{8}$/.test(value)) {
    parts = [value.slice(0, 2), value.slice(2, 4), value.slice(4)]
  } else {
    const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value)
    if (match) parts = match.slice(1)
  }
  if (!parts) return ''

  const [month, day, year] = parts.map(Number)
  if (!isRealDate(year, month, day)) return ''

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Keeps what is typed tidy while it is typed. Month, day and year fill in
 * turn (2, 2 and 4 digits) and get their slashes on their own, whether the
 * person types the slashes or not: 0512 -> 05/12, 12/052024 -> 12/05/2024.
 * A slash the person typed after a short part stays (5/), but none is added
 * at the end otherwise, so Backspace always works.
 */
export function maskDateInput(raw) {
  const limits = [2, 2, 4]
  const segments = ['']
  let endsWithSeparator = false

  for (const char of String(raw ?? '')) {
    if (/\d/.test(char)) {
      endsWithSeparator = false
      let index = segments.length - 1
      if (segments[index].length >= limits[index]) {
        if (index === limits.length - 1) continue
        segments.push('')
        index += 1
      }
      segments[index] += char
    } else if (SEPARATORS.test(char)) {
      const lastIndex = segments.length - 1
      if (segments[lastIndex] !== '' && lastIndex < limits.length - 1) {
        segments.push('')
        endsWithSeparator = true
      }
    }
  }

  const parts = segments.filter(Boolean)
  const text = parts.join('/')
  return endsWithSeparator && segments.at(-1) === '' ? `${text}/` : text
}

/**
 * Tidies a finished entry when the field loses focus: pads "5/2/2026" to
 * "05/02/2026" and turns a two-digit year into 20YY. Anything else is returned
 * unchanged so the error can show what was typed.
 */
export function completeDateText(text) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(String(text ?? '').trim())
  if (!match) return text
  const [, month, day, year] = match
  return `${month.padStart(2, '0')}/${day.padStart(2, '0')}/${year.length === 2 ? `20${year}` : year}`
}

// --- The month a calendar shows ----------------------------------------------------

/** Today as "YYYY-MM-DD" by the local calendar. */
export function todayIso(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${String(now.getFullYear()).padStart(4, '0')}-${month}-${day}`
}

/** The month of an ISO date (or of today's when it is not one): `{ year, month }`, month 0-11. */
export function monthOf(iso, now = new Date()) {
  const match = /^(\d{4})-(\d{2})-\d{2}/.exec(String(iso ?? ''))
  return match
    ? { year: Number(match[1]), month: Number(match[2]) - 1 }
    : { year: now.getFullYear(), month: now.getMonth() }
}

/** The month `delta` months away, rolling over the year. */
export function shiftMonth({ year, month }, delta) {
  const index = year * 12 + month + delta
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 }
}

/** "October 2026". */
export function monthTitle({ year, month }) {
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * The weeks a calendar draws for a month, Sunday first, always six so it does not change
 * height. Each day is `{ iso, day, inMonth }`; the days around the month belong to the
 * neighbouring ones.
 */
export function monthGrid({ year, month }) {
  const first = new Date(Date.UTC(year, month, 1))
  const start = Date.UTC(year, month, 1 - first.getUTCDay())
  return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, weekday) => {
    const date = new Date(start + (week * 7 + weekday) * 86_400_000)
    return {
      iso: date.toISOString().slice(0, 10),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month,
    }
  }))
}
