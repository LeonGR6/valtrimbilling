import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSetupRows,
  buildersWithoutSetup,
  drawBarSegments,
  emptySetupFilters,
  filterSetupRows,
  hasActiveFilters,
  pageOfRows,
  sortSetupRows,
} from '../src/features/builder-draw-schedules/utils/builderSetupList.js'

const builder = (id, name, extra = {}) => ({ id, name, code: name.slice(0, 3).toUpperCase(), isActive: true, ...extra })
const schedule = (id, builderId, extra = {}) => ({
  id,
  builderId,
  versionNumber: 1,
  anyDate: false,
  retentionEnabled: false,
  retentionPercentage: 0,
  ocipWrapEnabled: false,
  ocipWrapPercentage: 0,
  utilityBuilding: false,
  separateHardwarePrice: false,
  draws: [{ eventType: 'EXT', percentage: 25 }, { eventType: 'DM', percentage: 65 }, { eventType: 'HW', percentage: 10 }],
  ...extra,
})

const builders = [
  builder(1, 'Olson Urban'),
  builder(2, 'Tri Pointe'),
  builder(3, 'G3 Urban Homes'),
  builder(4, 'Hillview Homes'),
  builder(5, 'Old Builder', { isActive: false }),
  builder(6, 'Bright Homes'),
]
const schedules = [
  schedule(10, 1, { anyDate: true, ocipWrapEnabled: true, ocipWrapPercentage: 2 }),
  schedule(11, 2, { retentionEnabled: true, retentionPercentage: 5, ocipWrapEnabled: true, ocipWrapPercentage: 1, utilityBuilding: true }),
  schedule(12, 3, { anyDate: true, retentionEnabled: true, retentionPercentage: 10, separateHardwarePrice: true }),
  schedule(13, 99),
]

test('each Builder with a setup is a row, and a setup whose Builder is not loaded is left out', () => {
  const rows = buildSetupRows(schedules, builders)

  assert.deepEqual(rows.map(({ builder: row }) => row.id), [1, 2, 3])
  assert.equal(rows[1].schedule.id, 11)
})

test('rows are found by name or code and narrowed by every filter that is on', () => {
  const rows = buildSetupRows(schedules, builders)
  const names = (list) => list.map(({ builder: row }) => row.name)

  assert.deepEqual(names(filterSetupRows(rows, { query: 'urban' })), ['Olson Urban', 'G3 Urban Homes'])
  assert.deepEqual(names(filterSetupRows(rows, { query: ' TRI ' })), ['Tri Pointe'])
  assert.deepEqual(names(filterSetupRows(rows, { query: 'nobody' })), [])
  assert.equal(filterSetupRows(rows).length, 3)

  const only = (overrides) => names(filterSetupRows(rows, { filters: { ...emptySetupFilters, ...overrides } }))
  assert.deepEqual(only({ cutoff: 'any' }), ['Olson Urban', 'G3 Urban Homes'])
  assert.deepEqual(only({ cutoff: 'fixed' }), ['Tri Pointe'])
  assert.deepEqual(only({ retention: true }), ['Tri Pointe', 'G3 Urban Homes'])
  assert.deepEqual(only({ wrap: true }), ['Olson Urban', 'Tri Pointe'])
  assert.deepEqual(only({ utility: true }), ['Tri Pointe'])
  assert.deepEqual(only({ hardware: true }), ['G3 Urban Homes'])
  // Filters add up, and so does the search.
  assert.deepEqual(only({ retention: true, wrap: true }), ['Tri Pointe'])
  assert.deepEqual(
    names(filterSetupRows(rows, { query: 'urban', filters: { ...emptySetupFilters, retention: true } })),
    ['G3 Urban Homes'],
  )
})

test('rows sort by name, or by the highest wrap or retention first with the Builders that have none last', () => {
  const rows = buildSetupRows(schedules, builders)
  const names = (list) => list.map(({ builder: row }) => row.name)

  assert.deepEqual(names(sortSetupRows(rows, 'name')), ['G3 Urban Homes', 'Olson Urban', 'Tri Pointe'])
  assert.deepEqual(names(sortSetupRows(rows, 'wrap')), ['Olson Urban', 'Tri Pointe', 'G3 Urban Homes'])
  assert.deepEqual(names(sortSetupRows(rows, 'retention')), ['G3 Urban Homes', 'Tri Pointe', 'Olson Urban'])
  // The list that came in is left as it was.
  assert.deepEqual(names(rows), ['Olson Urban', 'Tri Pointe', 'G3 Urban Homes'])
})

test('the active Builders without a setup are listed by name', () => {
  assert.deepEqual(
    buildersWithoutSetup(builders, schedules).map(({ name }) => name),
    ['Bright Homes', 'Hillview Homes'],
  )
  assert.deepEqual(buildersWithoutSetup(builders, []).map(({ id }) => id).length, 5)
})

test('the Draws are drawn as shares of a bar that shows when they do not add up to 100', () => {
  const full = drawBarSegments(schedule(1, 1))
  assert.equal(full.total, 100)
  assert.equal(full.complete, true)
  assert.deepEqual(full.segments.map(({ share }) => share), [0.25, 0.65, 0.1])

  const short = drawBarSegments(schedule(1, 1, { draws: [{ eventType: 'EXT', percentage: 40 }, { eventType: 'DM', percentage: 40 }] }))
  assert.equal(short.complete, false)
  assert.equal(short.total, 80)
  // The bar stays as wide as 100%, so the missing 20% is a gap.
  assert.deepEqual(short.segments.map(({ share }) => share), [0.4, 0.4])

  const over = drawBarSegments(schedule(1, 1, { draws: [{ eventType: 'EXT', percentage: 60 }, { eventType: 'DM', percentage: 60 }] }))
  assert.equal(over.complete, false)
  assert.deepEqual(over.segments.map(({ share }) => share), [0.5, 0.5])
  assert.equal(drawBarSegments(schedule(1, 1, { draws: [] })).segments.length, 0)
})

test('rows come in pages, and a page out of range is the nearest one', () => {
  const rows = Array.from({ length: 60 }, (_, index) => ({ key: index }))

  assert.deepEqual(pageOfRows(rows, 1).rows.length, 25)
  assert.equal(pageOfRows(rows, 3).rows.length, 10)
  assert.equal(pageOfRows(rows, 3).pages, 3)
  assert.equal(pageOfRows(rows, 9).page, 3)
  assert.equal(pageOfRows(rows, 0).page, 1)
  assert.deepEqual(pageOfRows([], 1), { rows: [], page: 1, pages: 1 })
})

test('the table knows when a search or a filter is on', () => {
  assert.equal(hasActiveFilters(), false)
  assert.equal(hasActiveFilters({ query: '  ' }), false)
  assert.equal(hasActiveFilters({ query: 'tri' }), true)
  assert.equal(hasActiveFilters({ filters: { ...emptySetupFilters, wrap: true } }), true)
  assert.equal(hasActiveFilters({ filters: { ...emptySetupFilters, cutoff: 'any' } }), true)
})
