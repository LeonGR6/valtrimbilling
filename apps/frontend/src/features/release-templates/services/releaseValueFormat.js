import { getReleaseVariable } from './releaseTemplateRecord.js'

// Turns a raw value into the text printed on a Release. Amounts print as
// '1,250.00' ('plain', the form already has the $) or '$1,250.00' ('currency').
// Dates arrive as
// 'YYYY-MM-DD' (the value of a date input) or a Date; amounts as a number or
// a string such as '1,250.5' or '$1250'. An unusable value gives '' so the
// caller leaves the blank empty instead of printing something wrong.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
]

function pad(value) {
  return String(value).padStart(2, '0')
}

/** Today as 'YYYY-MM-DD' in the local time zone (what a date input holds). */
export function todayDateInput(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function parseDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() }
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim())
  if (!match) return null

  const [year, month, day] = match.slice(1).map(Number)
  const check = new Date(year, month - 1, day)
  const real = check.getFullYear() === year
    && check.getMonth() === month - 1
    && check.getDate() === day
  return real ? { year, month, day } : null
}

function formatDate(value, format) {
  const date = parseDate(value)
  if (!date) return ''

  switch (format) {
    case 'MMMM D, YYYY':
      return `${MONTHS[date.month - 1]} ${date.day}, ${date.year}`
    case 'YYYY-MM-DD':
      return `${date.year}-${pad(date.month)}-${pad(date.day)}`
    default:
      return `${pad(date.month)}/${pad(date.day)}/${date.year}`
  }
}

function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null

  const text = String(value ?? '').replace(/[$,\s]/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null
  return Number(text)
}

function formatAmount(value, format) {
  const amount = parseAmount(value)
  if (amount === null) return ''

  const [whole, cents] = Math.abs(amount).toFixed(2).split('.')
  const grouped = `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`
  const sign = amount < 0 ? '-' : ''

  // 'plain' is the number alone, for forms that already print the dollar sign.
  return format === 'plain' ? `${sign}${grouped}` : `${sign}$${grouped}`
}

export function formatReleaseValue(variableKey, format, value) {
  const variable = getReleaseVariable(variableKey)
  if (!variable) return ''
  return variable.kind === 'date'
    ? formatDate(value, format)
    : formatAmount(value, format)
}

/** What a test fill starts with: today's date and a sample amount. */
export function defaultTestValue(variableKey, now = new Date()) {
  return getReleaseVariable(variableKey)?.kind === 'amount'
    ? '1250.00'
    : todayDateInput(now)
}
