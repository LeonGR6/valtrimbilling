import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAvailableSeparateHardwareSelections,
  buildCalendarDrawSuggestion,
  buildDrawCalendarHeadings,
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

test('Any date also suggests overdue work from before the window, not work after it', () => {
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
      // Ready since July and still unbilled: overdue.
      productionSchedule(1, '2026-07-01', [101]),
      productionSchedule(2, '2026-09-01', [102]),
      productionSchedule(3, '2026-09-02', [103]),
    ]),
    // The newest work, after the best window.
    stage('HW', [productionSchedule(4, '2026-09-29', [102])]),
  ])]

  const suggestion = buildCalendarDrawSuggestion({
    activities,
    job,
    schedule,
    packages: [],
    asOfDate: '2026-09-30',
  })

  assert.equal(suggestion.windowStart, '2026-08-20')
  assert.equal(suggestion.windowEnd, '2026-09-02')
  assert.deepEqual(suggestion.suggestedSelections, [
    { phaseId: 21, lotId: 101, drawIndex: 0 },
    { phaseId: 21, lotId: 102, drawIndex: 0 },
    { phaseId: 21, lotId: 103, drawIndex: 0 },
  ])
  assert.equal(suggestion.overdueCount, 1)
  // The HW cell stays available to pick by hand, outside the suggestion.
  assert.equal(suggestion.eligibleSelections.length, 4)
  // The estimate covers what is suggested: three EXT cells.
  assert.equal(suggestion.estimatedInvoiceAmount, 2400)
})

test('Any date has nothing overdue when everything fits in the window', () => {
  const job = jobWithLots([101, 102])
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
      productionSchedule(2, '2026-09-05', [102]),
    ]),
  ])]

  const suggestion = buildCalendarDrawSuggestion({
    activities,
    job,
    schedule,
    packages: [],
    asOfDate: '2026-09-30',
  })

  assert.equal(suggestion.overdueCount, 0)
  assert.equal(suggestion.suggestedSelections.length, 2)
})

test('a cut-off builder already suggests everything up to its cut-off, however old', () => {
  const job = jobWithLots([101, 102])
  const schedule = {
    frequency: 'WEEKLY',
    anyDate: false,
    cutoffWeekday: 3,
    draws: [
      { percentage: 50, eventType: 'EXT' },
      { percentage: 50, eventType: 'DM' },
    ],
  }
  const activities = [activity([
    stage('EXT', [
      productionSchedule(1, '2026-06-02', [101]),
      productionSchedule(2, '2026-09-28', [102]),
    ]),
  ])]

  const suggestion = buildCalendarDrawSuggestion({
    activities,
    job,
    schedule,
    packages: [],
    asOfDate: '2026-09-29',
  })

  assert.equal(suggestion.mode, 'CUTOFF')
  assert.deepEqual(suggestion.suggestedSelections, suggestion.eligibleSelections)
  assert.equal(suggestion.suggestedSelections.length, 2)
  assert.equal(suggestion.overdueCount, 0)
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

test('Draw headings expose their event type and matching Calendar dates', () => {
  const job = jobWithLots([101, 102])
  const phase = job.sequenceSheet.phases[0]
  const schedule = {
    draws: [
      { percentage: 50, eventType: 'EXT' },
      { percentage: 50, eventType: 'DM' },
    ],
  }
  const activities = [
    activity([
      stage('EXT', [
        productionSchedule(1, '2026-10-08', [102]),
        productionSchedule(2, '2026-10-01', [101]),
      ]),
    ]),
    {
      ...activity([
        stage('EXT', [productionSchedule(3, '2026-09-30', [101])]),
      ]),
      id: 92,
      status: 'CANCELLED',
    },
  ]

  assert.deepEqual(buildDrawCalendarHeadings({
    activities,
    job,
    phase,
    schedule,
  }), [
    { eventType: 'EXT', eventDates: ['2026-10-01', '2026-10-08'] },
    { eventType: 'DM', eventDates: [] },
  ])
})

test('Calendar suggestions ignore Utility Building rows inside a normal Phase', () => {
  const job = jobWithLots([101])
  job.sequenceSheet.phases[0].lots[0].isUtilityBuilding = true
  const suggestion = buildCalendarDrawSuggestion({
    activities: [activity([
      stage('EXT', [productionSchedule(1, '2026-09-29', [101])]),
    ])],
    job,
    schedule: {
      frequency: 'WEEKLY',
      cutoffWeekday: 3,
      draws: [{ percentage: 100, eventType: 'EXT' }],
    },
    packages: [],
    asOfDate: '2026-09-29',
  })

  assert.deepEqual(suggestion.suggestedSelections, [])
  assert.equal(suggestion.estimatedInvoiceAmount, 0)
})

test('an HW Calendar event suggests Separate Hardware without an HW Draw', () => {
  const job = jobWithLots([101])
  job.sequenceSheet.plans[0].hardwarePrice = 600
  const suggestion = buildCalendarDrawSuggestion({
    activities: [activity([
      stage('HW', [productionSchedule(1, '2026-09-29', [101])]),
    ])],
    job,
    schedule: {
      frequency: 'MONTHLY',
      anyDate: false,
      cutoffDay: 30,
      draws: [
        { percentage: 50, eventType: 'EXT' },
        { percentage: 50, eventType: 'DM' },
      ],
      separateHardwarePrice: true,
      hardwareBillingMode: 'BY_EVENT',
      hardwareEventPercentages: { EXT: 0, DM: 0, HW: 100 },
    },
    packages: [],
    asOfDate: '2026-09-29',
  })

  assert.deepEqual(suggestion.suggestedSelections, [])
  assert.deepEqual(suggestion.suggestedHardwareSelections, [{
    phaseId: 21,
    lotId: 101,
    eventType: 'HW',
  }])
  assert.deepEqual(suggestion.eventTypes, ['HW'])
  assert.equal(suggestion.estimatedInvoiceAmount, 600)
})

test('Separate Hardware keeps every configured Lot available without Calendar work', () => {
  const job = jobWithLots([101, 102])
  job.sequenceSheet.phases[0].lots.push({
    id: 103,
    lotNumber: 'Utility A',
    planId: 1,
    optionIds: [],
    isUtilityBuilding: true,
  })

  assert.deepEqual(buildAvailableSeparateHardwareSelections({
    job,
    schedule: {
      separateHardwarePrice: true,
      hardwareBillingMode: 'BY_EVENT',
      hardwareEventPercentages: { EXT: 20, DM: 0, HW: 80 },
    },
  }), [
    { phaseId: 21, lotId: 101, eventType: 'EXT' },
    { phaseId: 21, lotId: 101, eventType: 'HW' },
    { phaseId: 21, lotId: 102, eventType: 'EXT' },
    { phaseId: 21, lotId: 102, eventType: 'HW' },
  ])
})

test('a baseboard install never makes anything billable, even if it is dated before DM', () => {
  const job = jobWithLots([101])
  const schedule = {
    frequency: 'MONTHLY',
    anyDate: true,
    cutoffDay: null,
    cutoffDays: [],
    cutoffWeekday: null,
    draws: [
      { percentage: 50, eventType: 'EXT' },
      { percentage: 50, eventType: 'DM' },
    ],
  }
  const withBaseboard = (baseboardDate) => [activity([
    stage('EXT', [productionSchedule(1, '2026-09-01', [101])]),
    stage('DM', [
      productionSchedule(2, '2026-09-20', [101]),
      { ...productionSchedule(3, baseboardDate, [101]), variant: 'BASEBOARD_INSTALL' },
    ]),
  ])]

  // DM is not ready on 09-10; a baseboard dated 09-05 must not make it so.
  const early = buildCalendarDrawSuggestion({
    activities: withBaseboard('2026-09-05'),
    job,
    schedule,
    packages: [],
    asOfDate: '2026-09-10',
  })
  assert.deepEqual(early.eligibleSelections, [
    { phaseId: 21, lotId: 101, drawIndex: 0 },
  ])

  // On the DM date both draws are ready, with or without the baseboard event.
  const later = buildCalendarDrawSuggestion({
    activities: withBaseboard('2026-09-25'),
    job,
    schedule,
    packages: [],
    asOfDate: '2026-09-30',
  })
  assert.equal(later.eligibleSelections.length, 2)
})
