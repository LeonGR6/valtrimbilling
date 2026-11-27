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

/**
 * "Phase 2 · Building A", or just "Phase 2" for a Phase that has no Building.
 * `separator` joins the two parts (" · " by default, " / " in tables).
 */
export function formatPhaseBuilding(phase, building, { variant = 'long', separator = ' · ' } = {}) {
  return [formatPhase(phase, variant), formatBuilding(building, variant)]
    .filter(Boolean)
    .join(separator)
}
