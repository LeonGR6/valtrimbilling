export const phoneCountryOptions = [
  { value: 'US', label: 'United States', dialCode: '+1' },
  { value: 'MX', label: 'México', dialCode: '+52' },
]

const countryDialCodes = Object.fromEntries(
  phoneCountryOptions.map((option) => [option.value, option.dialCode]),
)

export function detectPhoneCountry(value) {
  const compact = String(value ?? '').trim().replace(/[\s().-]/g, '')
  if (compact.startsWith('+52')) return 'MX'
  if (compact.startsWith('+1')) return 'US'

  const digits = compact.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('52')) return 'MX'
  if (digits.length === 11 && digits.startsWith('1')) return 'US'
  return null
}

export function normalizePhoneNumber(value, fallbackCountry = 'US') {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (!/^[\d\s()+.-]+$/.test(raw)) return null

  const digits = raw.replace(/\D/g, '')
  const detectedCountry = detectPhoneCountry(raw)
  const country = detectedCountry ?? fallbackCountry
  let nationalNumber = digits

  if (detectedCountry === 'US') nationalNumber = digits.slice(1)
  if (detectedCountry === 'MX') nationalNumber = digits.slice(2)

  if (!countryDialCodes[country] || nationalNumber.length !== 10) return null
  return `${countryDialCodes[country]}${nationalNumber}`
}

export function getPhoneCountry(value, fallbackCountry = 'US') {
  return detectPhoneCountry(value) ?? fallbackCountry
}

export function getNationalPhoneNumber(value, fallbackCountry = 'US') {
  const normalized = normalizePhoneNumber(value, fallbackCountry)
  if (!normalized) return String(value ?? '').trim()

  return normalized.startsWith('+52') ? normalized.slice(3) : normalized.slice(2)
}

export function formatPhoneNumber(value) {
  const normalized = normalizePhoneNumber(value)
  if (!normalized) return String(value ?? '').trim()

  if (normalized.startsWith('+1')) {
    const national = normalized.slice(2)
    return `+1 (${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`
  }

  const national = normalized.slice(3)
  return `+52 ${national.slice(0, 2)} ${national.slice(2, 6)} ${national.slice(6)}`
}
