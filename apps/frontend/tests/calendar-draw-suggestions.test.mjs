import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAvailableSeparateHardwareSelections,
  buildCalendarDrawSuggestion,
  buildDrawCalendarHeadings,
  calendarSelectionKey,
  findLotEventDate,
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
    {
      eventType: 'EXT',
      eventDates: ['2026-10-01', '2026-10-08'],
      divisions: [
        { date: '2026-10-01', lotIds: [101], lotNumbers: ['101'], variants: [] },
        { date: '2026-10-08', lotIds: [102], lotNumbers: ['102'], variants: [] },
      ],
    },
    { eventType: 'DM', eventDates: [], divisions: [] },
  ])
})

const splitHeadingSchedule = {
  draws: [
    { percentage: 30, eventType: 'DM' },
    { percentage: 70, eventType: 'HW' },
  ],
}

test('a Phase split in parts shows each date with the lots that go on it', () => {
  const job = jobWithLots([1, 2, 3, 4, 5, 6])
  const phase = job.sequenceSheet.phases[0]
  const activities = [activity([
    stage('DM', [
      { ...productionSchedule(1, '2026-09-01', [1, 2, 3, 4, 5, 6]), variant: 'BASE', isActive: false },
      { ...productionSchedule(2, '2026-10-08', [4, 5, 6]), variant: 'DIVISION' },
      { ...productionSchedule(3, '2026-10-01', [1, 2, 3]), variant: 'DIVISION' },
    ]),
  ])]

  const [dm] = buildDrawCalendarHeadings({ activities, job, phase, schedule: splitHeadingSchedule })

  // The old whole-Phase date (inactive after the split) is not one of the dates.
  assert.deepEqual(dm.eventDates, ['2026-10-01', '2026-10-08'])
  assert.deepEqual(dm.divisions, [
    { date: '2026-10-01', lotIds: [1, 2, 3], lotNumbers: ['1', '2', '3'], variants: ['DIVISION'] },
    { date: '2026-10-08', lotIds: [4, 5, 6], lotNumbers: ['4', '5', '6'], variants: ['DIVISION'] },
  ])
})

test('parts of a split that fall on the same day are one date', () => {
  const job = jobWithLots([1, 2, 3, 4])
  const phase = job.sequenceSheet.phases[0]
  const activities = [activity([
    stage('HW', [
      { ...productionSchedule(1, '2026-10-05', [1, 2]), variant: 'DIVISION' },
      { ...productionSchedule(2, '2026-10-05', [3, 4]), variant: 'DIVISION' },
    ]),
  ])]

  const [, hw] = buildDrawCalendarHeadings({ activities, job, phase, schedule: splitHeadingSchedule })

  assert.deepEqual(hw.eventDates, ['2026-10-05'])
  assert.equal(hw.divisions.length, 1)
  assert.deepEqual(hw.divisions[0].lotIds, [1, 2, 3, 4])
})

test('lots of other Phases and unlisted lots do not appear in the divisions', () => {
  const job = jobWithLots([1, 2])
  const phase = job.sequenceSheet.phases[0]
  const activities = [activity([
    stage('DM', [
      { ...productionSchedule(1, '2026-10-01', [1, 99]), variant: 'DIVISION' },
      { ...productionSchedule(2, '2026-10-08', [98]), variant: 'DIVISION' },
    ]),
  ])]

  const [dm] = buildDrawCalendarHeadings({ activities, job, phase, schedule: splitHeadingSchedule })

  assert.deepEqual(dm.eventDates, ['2026-10-01'])
  assert.deepEqual(dm.divisions.map(({ lotIds }) => lotIds), [[1]])
})

test('an install-only or lock-up date is a date of its own for every lot', () => {
  const job = jobWithLots([1, 2])
  const phase = job.sequenceSheet.phases[0]
  const activities = [activity([
    stage('HW', [
      { ...productionSchedule(1, '2026-10-01', [1, 2]), variant: 'BASE' },
      { ...productionSchedule(2, '2026-10-12', [1, 2]), variant: 'LOCK_UP' },
      // A baseboard install is no billing event, so it is not one of the dates.
      { ...productionSchedule(3, '2026-10-20', [1, 2]), variant: 'BASEBOARD_INSTALL' },
    ]),
  ])]

  const [, hw] = buildDrawCalendarHeadings({ activities, job, phase, schedule: splitHeadingSchedule })

  assert.deepEqual(hw.divisions.map(({ date, variants }) => [date, variants]), [
    ['2026-10-01', ['BASE']],
    ['2026-10-12', ['LOCK_UP']],
  ])
})

test('a lagged Draw keeps its divisions beside the dates it becomes available', () => {
  const job = jobWithLots([1, 2])
  const phase = job.sequenceSheet.phases[0]
  const activities = [activity([
    stage('DM', [
      { ...productionSchedule(1, '2026-10-01', [1]), variant: 'DIVISION' },
      { ...productionSchedule(2, '2026-10-08', [2]), variant: 'DIVISION' },
    ]),
  ])]

  const [dm] = buildDrawCalendarHeadings({
    activities,
    job,
    phase,
    schedule: { draws: [{ percentage: 100, eventType: 'DM', lag: { value: 1, unit: 'WEEKS' } }] },
  })

  assert.deepEqual(dm.availableDates, ['2026-10-08', '2026-10-15'])
  assert.deepEqual(dm.divisions.map(({ date }) => date), ['2026-10-01', '2026-10-08'])
})

test('the date of an event for a lot is the earliest one the Calendar gave it', () => {
  const job = jobWithLots([1, 2, 3])
  const phase = job.sequenceSheet.phases[0]
  const activities = [activity([
    stage('HW', [
      { ...productionSchedule(1, '2026-10-01', [1]), variant: 'DIVISION' },
      { ...productionSchedule(2, '2026-10-08', [2, 3]), variant: 'DIVISION' },
      { ...productionSchedule(3, '2026-10-20', [1, 2, 3]), variant: 'LOCK_UP' },
    ]),
  ])]
  const headings = buildDrawCalendarHeadings({ activities, job, phase, schedule: splitHeadingSchedule })

  assert.equal(findLotEventDate(headings, 1, 'HW'), '2026-10-01')
  assert.equal(findLotEventDate(headings, 3, 'HW'), '2026-10-08')
  assert.equal(findLotEventDate(headings, '2', 'HW'), '2026-10-08')
  assert.equal(findLotEventDate(headings, 1, 'DM'), null)
  assert.equal(findLotEventDate(headings, 99, 'HW'), null)
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

// --- The previous cutoff, for work left behind after a cutoff went by ---

test('the previous cutoff is the latest one strictly before the date', async () => {
  const { resolvePreviousBillingCutoffDate } = await import('../src/features/draw-invoice/services/drawInvoicePackageRecord.js')
  const monthly = { frequency: 'MONTHLY', cutoff_any_date: false, cutoff_day: 10 }
  const semimonthly = { frequency: 'SEMIMONTHLY', cutoff_any_date: false, cutoff_days: [8, 22] }
  const weekly = { frequency: 'WEEKLY', cutoff_any_date: false, cutoff_weekday: 1 }

  assert.equal(resolvePreviousBillingCutoffDate('2026-10-23', semimonthly), '2026-10-22')
  assert.equal(resolvePreviousBillingCutoffDate('2026-10-22', semimonthly), '2026-10-08')
  assert.equal(resolvePreviousBillingCutoffDate('2026-10-05', semimonthly), '2026-09-22')
  assert.equal(resolvePreviousBillingCutoffDate('2026-01-05', semimonthly), '2025-12-22')

  assert.equal(resolvePreviousBillingCutoffDate('2026-10-23', monthly), '2026-10-10')
  assert.equal(resolvePreviousBillingCutoffDate('2026-10-10', monthly), '2026-09-10')
  assert.equal(resolvePreviousBillingCutoffDate('2026-10-05', monthly), '2026-09-10')
  // A cutoff on the 31st falls on the last day of a shorter month.
  assert.equal(
    resolvePreviousBillingCutoffDate('2026-03-05', { ...monthly, cutoff_day: 31 }),
    '2026-02-28',
  )

  // October 23, 2026 is a Friday; Monday is weekday 1.
  assert.equal(resolvePreviousBillingCutoffDate('2026-10-23', weekly), '2026-10-19')
  assert.equal(resolvePreviousBillingCutoffDate('2026-10-19', weekly), '2026-10-12')

  assert.equal(resolvePreviousBillingCutoffDate('2026-10-23', { ...monthly, cutoff_any_date: true }), null)
  assert.equal(resolvePreviousBillingCutoffDate('2026-10-23', null), null)
  assert.equal(resolvePreviousBillingCutoffDate('nope', monthly), null)
  assert.equal(resolvePreviousBillingCutoffDate('2026-10-23', { frequency: 'MONTHLY', cutoff_any_date: false }), null)
})
