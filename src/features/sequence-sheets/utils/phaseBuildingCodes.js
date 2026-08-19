function normalizedCode(value) {
  return String(value ?? '').trim().toUpperCase()
}

export function normalizePhaseCode(value) {
  return normalizedCode(value)
    .replace(/^PHASE(?:\s+|(?=[#:\-.]))[#:\-.\s]*/i, '')
    .replace(/^P(?=[A-Z0-9])/, '')
    .trim()
}

export function normalizeBuildingCode(value) {
  return normalizedCode(value)
    .replace(/^BUILDING(?:\s+|(?=[#:\-.]))[#:\-.\s]*/i, '')
    .replace(/^B(?=[A-Z0-9])/, '')
    .trim()
}

export function formatPhase(value, variant = 'long') {
  const code = normalizePhaseCode(value)
  if (!code) return ''
  return variant === 'short' ? `P${code}` : `Phase ${code}`
}

export function formatBuilding(value, variant = 'long') {
  const code = normalizeBuildingCode(value)
  if (!code) return ''
  return variant === 'short' ? `B${code}` : `Building ${code}`
}
