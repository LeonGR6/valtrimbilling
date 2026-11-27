// The Builder Setups list as a table: one row per Builder with its current setup, searched,
// filtered, sorted and paged. Pure: nothing here touches the network or React.

export const SETUP_SORTS = [
  { value: 'name', label: 'Name' },
  { value: 'wrap', label: 'OCIP / WRAP, highest first' },
  { value: 'retention', label: 'Retention, highest first' },
]

export const emptySetupFilters = Object.freeze({
  // 'any' (bills any date), 'fixed' (has cutoff dates) or null for both.
  cutoff: null,
  retention: false,
  wrap: false,
  utility: false,
  hardware: false,
})

export const SETUP_PAGE_SIZE = 25

/** One row per Builder that has a setup; a setup whose Builder is not loaded is left out. */
export function buildSetupRows(schedules, builders) {
  const buildersById = new Map(builders.map((builder) => [builder.id, builder]))
  return schedules.flatMap((schedule) => {
    const builder = buildersById.get(schedule.builderId)
    return builder ? [{ key: schedule.id, builder, schedule }] : []
  })
}

function matchesFilters(schedule, filters) {
  if (filters.cutoff === 'any' && !schedule.anyDate) return false
  if (filters.cutoff === 'fixed' && schedule.anyDate) return false
  if (filters.retention && !schedule.retentionEnabled) return false
  if (filters.wrap && !schedule.ocipWrapEnabled) return false
  if (filters.utility && !schedule.utilityBuilding) return false
  if (filters.hardware && !schedule.separateHardwarePrice) return false
  return true
}

/** The rows whose Builder name or code has the text, and that have every filter that is on. */
export function filterSetupRows(rows, { query = '', filters = emptySetupFilters } = {}) {
  const text = String(query).trim().toLowerCase()
  return rows.filter(({ builder, schedule }) => (
    matchesFilters(schedule, filters)
    && (text === ''
      || `${builder.name} ${builder.code ?? ''}`.toLowerCase().includes(text))
  ))
}

const byName = (left, right) => left.builder.name.localeCompare(
  right.builder.name,
  'en',
  { numeric: true, sensitivity: 'base' },
)

/** The rows in the order asked for; ties and the rest are in name order. */
export function sortSetupRows(rows, sort = 'name') {
  const figure = {
    wrap: ({ schedule }) => (schedule.ocipWrapEnabled ? Number(schedule.ocipWrapPercentage) || 0 : -1),
    retention: ({ schedule }) => (schedule.retentionEnabled ? Number(schedule.retentionPercentage) || 0 : -1),
  }[sort]

  return [...rows].sort((left, right) => (
    figure ? figure(right) - figure(left) || byName(left, right) : byName(left, right)
  ))
}

/** The active Builders that have no setup yet: they cannot have Jobs until they do. */
export function buildersWithoutSetup(builders, schedules) {
  const configured = new Set(schedules.map(({ builderId }) => builderId))
  return builders
    .filter((builder) => builder.isActive !== false && !configured.has(builder.id))
    .sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }))
}

/**
 * The Draws as segments of a bar: each as wide as its percentage. The bar is as wide as 100%, or
 * as the Draws add up to when it is more (`over`), and has a gap when they add up to less
 * (`complete` false), so a setup that does not add up is visible at a glance.
 */
export function drawBarSegments(schedule) {
  const draws = (schedule.draws ?? []).map((draw, index) => ({
    index,
    eventType: draw.eventType ?? '',
    percentage: Number(draw.percentage) || 0,
  }))
  const total = Math.round(draws.reduce((sum, draw) => sum + draw.percentage, 0) * 1000) / 1000
  const width = Math.max(total, 100)

  return {
    total,
    complete: Math.abs(total - 100) < 0.0005,
    segments: draws.map((draw) => ({ ...draw, share: draw.percentage / width })),
  }
}

/** The page of rows (1-based), and how many pages there are. */
export function pageOfRows(rows, page, pageSize = SETUP_PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(Math.max(1, page), pages)
  return { rows: rows.slice((current - 1) * pageSize, current * pageSize), page: current, pages }
}

/** Whether any filter is on (the table says so, and offers to clear them). */
export function hasActiveFilters({ query = '', filters = emptySetupFilters } = {}) {
  return String(query).trim() !== '' || Object.values(filters).some(Boolean)
}
