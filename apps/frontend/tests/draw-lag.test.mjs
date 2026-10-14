import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultBillingSettings } from '../src/features/builder-draw-schedules/data/builderDrawSchedules.js'
import { createBuilderDrawScheduleSchema } from '../src/features/builder-draw-schedules/schemas/builderDrawScheduleSchema.js'
import {
  addLag,
  drawSharesEvent,
  formatLag,
  formatLagShort,
  normalizeLag,
} from '../src/features/builder-draw-schedules/utils/drawLag.js'
import {
  buildCalendarDrawSuggestion,
  buildDrawCalendarHeadings,
  calendarSelectionKey,
} from '../src/features/draw-invoice/utils/calendarDrawSuggestions.js'

test('a lag is added to the event date in days, weeks or months', () => {
  assert.equal(addLag('2026-10-14', { value: 10, unit: 'DAYS' }), '2026-10-24')
  assert.equal(addLag('2026-10-14', { value: 2, unit: 'WEEKS' }), '2026-10-28')
  assert.equal(addLag('2026-10-14', { value: 1, unit: 'MONTHS' }), '2026-11-14')
  assert.equal(addLag('2026-11-20', { value: 3, unit: 'MONTHS' }), '2027-02-20')
})

test('months stop at the end of a shorter month', () => {
  assert.equal(addLag('2026-01-31', { value: 1, unit: 'MONTHS' }), '2026-02-28')
  assert.equal(addLag('2028-01-31', { value: 1, unit: 'MONTHS' }), '2028-02-29')
  assert.equal(addLag('2026-08-31', { value: 2, unit: 'MONTHS' }), '2026-10-31')
})

test('without a valid lag the event date is the billable date', () => {
  assert.equal(addLag('2026-10-14', null), '2026-10-14')
  assert.equal(addLag('2026-10-14', { value: 0, unit: 'WEEKS' }), '2026-10-14')
  assert.equal(addLag('2026-10-14', { value: 1, unit: 'YEARS' }), '2026-10-14')
  assert.equal(addLag('not a date', { value: 1, unit: 'WEEKS' }), 'not a date')
})

test('a lag is only valid inside its unit limits', () => {
  assert.deepEqual(normalizeLag({ value: '2', unit: 'weeks' }), { value: 2, unit: 'WEEKS' })
  assert.equal(normalizeLag({ value: 53, unit: 'WEEKS' }), null)
  assert.equal(normalizeLag({ value: 25, unit: 'MONTHS' }), null)
  assert.equal(normalizeLag({ value: 1.5, unit: 'DAYS' }), null)
  assert.equal(normalizeLag({ value: null, unit: null }), null)
})

test('a lag reads as words and as a short heading', () => {
  assert.equal(formatLag({ value: 1, unit: 'MONTHS' }), '1 month')
  assert.equal(formatLag({ value: 3, unit: 'WEEKS' }), '3 weeks')
  assert.equal(formatLag(null), '')
  assert.equal(formatLagShort({ value: 1, unit: 'MONTHS' }), '+1 mo')
  assert.equal(formatLagShort({ value: 2, unit: 'WEEKS' }), '+2 wk')
})

test('a Draw shares its event only when another Draw has the same one', () => {
  const draws = [{ eventType: 'EXT' }, { eventType: 'HW' }, { eventType: 'HW' }]
  assert.equal(drawSharesEvent(draws, 0), false)
  assert.equal(drawSharesEvent(draws, 1), true)
  assert.equal(drawSharesEvent(draws, 2), true)
  assert.equal(drawSharesEvent([{ eventType: '' }, { eventType: '' }], 0), false)
})

function setup(draws) {
  return {
    ...defaultBillingSettings,
    cutoffDays: [...defaultBillingSettings.cutoffDays],
    builderId: 2,
    draws,
  }
}

const threeDraws = (lag) => [
  { percentage: 15, eventType: 'EXT' },
  { percentage: 65, eventType: 'HW' },
  { percentage: 20, eventType: 'HW', lag },
]

test('Builder Setup accepts a lag on a Draw that shares its event', () => {
  const result = createBuilderDrawScheduleSchema([], null).parse(
    setup(threeDraws({ value: '1', unit: 'MONTHS' })),
  )
  assert.deepEqual(result.draws[2].lag, { value: 1, unit: 'MONTHS' })
  assert.equal(result.draws[0].lag, null)
})

test('an empty lag means no lag', () => {
  const schema = createBuilderDrawScheduleSchema([], null)
  assert.equal(schema.parse(setup(threeDraws({ value: '', unit: 'WEEKS' }))).draws[2].lag, null)
  assert.equal(schema.parse(setup(threeDraws(null))).draws[2].lag, null)
})

test('a lag is rejected on a Draw whose event nobody else shares', () => {
  const result = createBuilderDrawScheduleSchema([], null).safeParse(setup([
    { percentage: 15, eventType: 'EXT', lag: { value: 1, unit: 'WEEKS' } },
    { percentage: 85, eventType: 'HW' },
  ]))
  assert.equal(result.success, false)
  assert.deepEqual(result.error.issues[0].path, ['draws', 0, 'lag'])
})

test('a lag over its unit limit is rejected', () => {
  const result = createBuilderDrawScheduleSchema([], null).safeParse(
    setup(threeDraws({ value: 30, unit: 'MONTHS' })),
  )
  assert.equal(result.success, false)
  assert.deepEqual(result.error.issues[0].path, ['draws', 2, 'lag'])
})

function jobWithLots(lotIds) {
  return {
    id: 11,
    sequenceSheet: {
      plans: [{ id: 1, code: 'A', price: 1000, options: [] }],
      phases: [{
        id: 21,
        name: '1',
        building: 'A',
        lots: lotIds.map((id) => ({ id, lotNumber: String(id), planId: 1, optionIds: [] })),
      }],
    },
  }
}

const hardwareActivity = {
  id: 91,
  jobId: 11,
  phaseId: 21,
  status: 'ACTIVE',
  stages: [{
    id: 'HW-stage',
    type: 'HW',
    isEnabled: true,
    schedules: [{ id: 3, date: '2026-09-10', lotIds: [101], isActive: true }],
  }],
}

const lagSchedule = {
  frequency: 'MONTHLY',
  anyDate: false,
  cutoffDay: 30,
  cutoffDays: [],
  cutoffWeekday: null,
  draws: [
    { percentage: 40, eventType: 'HW' },
    { percentage: 60, eventType: 'HW', lag: { value: 1, unit: 'MONTHS' } },
  ],
}

const suggestionKeys = (asOfDate) => buildCalendarDrawSuggestion({
  activities: [hardwareActivity],
  job: jobWithLots([101]),
  schedule: lagSchedule,
  packages: [],
  asOfDate,
}).suggestedSelections.map(({ phaseId, lotId, drawIndex }) =>
  calendarSelectionKey(phaseId, lotId, drawIndex))

test('a Draw with a lag is suggested only once its billable date reaches the cutoff', () => {
  // HW was on Sep 10. Before the Sep 30 cutoff only the first Draw is due; the
  // second one (a month later, Oct 10) joins at the next cutoff, Oct 30.
  assert.deepEqual(suggestionKeys('2026-09-29'), ['21:101:0'])
  assert.deepEqual(suggestionKeys('2026-09-30'), ['21:101:0'])
  assert.deepEqual(suggestionKeys('2026-10-01'), ['21:101:0', '21:101:1'])
})

test('without a lag both Draws of the same event are suggested together', () => {
  const suggestion = buildCalendarDrawSuggestion({
    activities: [hardwareActivity],
    job: jobWithLots([101]),
    schedule: { ...lagSchedule, draws: lagSchedule.draws.map(({ lag, ...draw }) => draw) },
    packages: [],
    asOfDate: '2026-09-29',
  })
  assert.equal(suggestion.suggestedSelections.length, 2)
})

test('the Calendar headings say when a lagged Draw becomes available', () => {
  const headings = buildDrawCalendarHeadings({
    activities: [hardwareActivity],
    job: jobWithLots([101]),
    phase: jobWithLots([101]).sequenceSheet.phases[0],
    schedule: lagSchedule,
  })
  assert.deepEqual(headings[0], { eventType: 'HW', eventDates: ['2026-09-10'] })
  assert.deepEqual(headings[1], {
    eventType: 'HW',
    eventDates: ['2026-09-10'],
    lag: { value: 1, unit: 'MONTHS' },
    availableDates: ['2026-10-10'],
  })
})
