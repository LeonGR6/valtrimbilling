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
