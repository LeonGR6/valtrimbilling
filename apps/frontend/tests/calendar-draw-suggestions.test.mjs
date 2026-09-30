import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCalendarDrawSuggestion,
  calendarSelectionKey,
} from '../src/features/draw-invoice/utils/calendarDrawSuggestions.js'

function jobWithLots(lotIds) {
  return {
    id: 11,
    sequenceSheet: {
      plans: [{ id: 1, code: 'A', price: 1000, options: [] }],
      phases: [{
        id: 21,
        name: '1',
        building: 'A',
        lots: lotIds.map((id) => ({
          id,
          lotNumber: String(id),
          planId: 1,
          optionIds: [],
        })),
      }],
    },
  }
}

function activity(stages) {
  return {
    id: 91,
    jobId: 11,
    phaseId: 21,
    status: 'ACTIVE',
    stages,
  }
}

function stage(type, schedules) {
  return { id: `${type}-stage`, type, isEnabled: true, schedules }
}

function productionSchedule(id, date, lotIds) {
  return { id, date, lotIds, isActive: true }
}

test('fixed cutoff suggests old open work and every Draw mapped to the event', () => {
  const job = jobWithLots([101, 102])
  const schedule = {
    frequency: 'MONTHLY',
    anyDate: false,
    cutoffDay: 30,
    cutoffDays: [],
    cutoffWeekday: null,
    draws: [
      { percentage: 20, eventType: 'EXT' },
      { percentage: 30, eventType: 'HW' },
      { percentage: 50, eventType: 'HW' },
    ],
  }
  const activities = [activity([
    stage('EXT', [
      productionSchedule(1, '2026-08-10', [101]),
      productionSchedule(2, '2026-10-02', [102]),
    ]),
    stage('HW', [productionSchedule(3, '2026-09-23', [101, 102])]),
  ])]
  const packages = [{
    id: 1,
    jobId: 11,
    phaseId: 21,
    status: 'DRAFT',
    selections: [{ phaseId: 21, lotId: 101, drawIndex: 1 }],
  }]

  const suggestion = buildCalendarDrawSuggestion({
    activities,
    job,
    schedule,
    packages,
    asOfDate: '2026-09-29',
  })

  assert.equal(suggestion.cutoffDate, '2026-09-30')
  assert.deepEqual(
    suggestion.suggestedSelections.map(({ phaseId, lotId, drawIndex }) =>
      calendarSelectionKey(phaseId, lotId, drawIndex)),
    ['21:101:0', '21:101:2', '21:102:1', '21:102:2'],
  )
  assert.deepEqual(suggestion.eventTypes, ['EXT', 'HW'])
  assert.equal(suggestion.estimatedInvoiceAmount, 1500)
})

test('Any date chooses the highest-value rolling 14-day window through today', () => {
  const job = jobWithLots([101, 102, 103])
  const schedule = {
    frequency: 'MONTHLY',
    anyDate: true,
    cutoffDay: null,
    cutoffDays: [],
    cutoffWeekday: null,
    draws: [
      { percentage: 80, eventType: 'EXT' },
      { percentage: 20, eventType: 'HW' },
    ],
  }
  const activities = [activity([
    stage('EXT', [
      productionSchedule(1, '2026-09-01', [101]),
      productionSchedule(2, '2026-09-12', [102]),
    ]),
    stage('HW', [
      productionSchedule(3, '2026-09-25', [103]),
      productionSchedule(4, '2026-10-01', [101]),
    ]),
  ])]

  const suggestion = buildCalendarDrawSuggestion({
    activities,
    job,
    schedule,
    packages: [],
    asOfDate: '2026-09-30',
  })

  assert.equal(suggestion.mode, 'ANY_DATE')
  assert.equal(suggestion.windowStart, '2026-08-30')
  assert.equal(suggestion.windowEnd, '2026-09-12')
  assert.deepEqual(suggestion.suggestedSelections, [
    { phaseId: 21, lotId: 101, drawIndex: 0 },
    { phaseId: 21, lotId: 102, drawIndex: 0 },
  ])
  assert.equal(suggestion.eligibleSelections.length, 3)
  assert.equal(suggestion.estimatedInvoiceAmount, 1600)
})

test('cancelled Packages do not close Calendar Lot and Draw cells', () => {
  const job = jobWithLots([101])
  const schedule = {
    frequency: 'WEEKLY',
    cutoffWeekday: 3,
    draws: [
      { percentage: 50, eventType: 'EXT' },
      { percentage: 50, eventType: 'DM' },
    ],
  }
  const activities = [activity([
    stage('EXT', [productionSchedule(1, '2026-09-29', [101])]),
  ])]
  const packages = [{
    id: 1,
    jobId: 11,
    phaseId: 21,
    status: 'CANCELLED',
    selections: [{ phaseId: 21, lotId: 101, drawIndex: 0 }],
  }]

  const suggestion = buildCalendarDrawSuggestion({
    activities,
    job,
    schedule,
    packages,
    asOfDate: '2026-09-29',
  })

  assert.deepEqual(suggestion.suggestedSelections, [
    { phaseId: 21, lotId: 101, drawIndex: 0 },
  ])
})
