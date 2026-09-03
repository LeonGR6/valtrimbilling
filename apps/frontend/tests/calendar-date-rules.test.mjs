import test from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultBuilderDateConfiguration,
  getBuilderDateConfiguration,
  withDefaultBuilderDateConfiguration,
} from '../src/features/builders/data/builders.js'
import {
  addWeeksExcludingUsFederalHolidays,
  calculateProductionDates,
  calculateShutterDate,
  getProductionDateCascade,
  getUsFederalHolidayDates,
  subtractWeeksExcludingUsFederalHolidays,
} from '../src/features/calendar/utils/calendarDateRules.js'

test('every builder receives the default 4-week and 1-week date spacing', () => {
  const builder = withDefaultBuilderDateConfiguration({ id: 50, name: 'New Builder' })

  assert.deepEqual(
    getBuilderDateConfiguration(builder),
    defaultBuilderDateConfiguration,
  )
})

test('custom builder date spacing is normalized to whole weeks', () => {
  assert.deepEqual(getBuilderDateConfiguration({
    calendarDateConfiguration: { extToDmWeeks: 6, shutterBeforeDmWeeks: 3, dmToHwWeeks: 2 },
  }), {
    extToDmWeeks: 6,
    shutterBeforeDmWeeks: 3,
    dmToHwWeeks: 2,
  })

  assert.deepEqual(getBuilderDateConfiguration({
    calendarDateConfiguration: { extToDmWeeks: -1, shutterBeforeDmWeeks: 0, dmToHwWeeks: 1.5 },
  }), defaultBuilderDateConfiguration)
})

test('the configured U.S. holiday calendar contains only the seven requested holidays', () => {
  const holidays = getUsFederalHolidayDates(2026)

  assert.deepEqual(holidays, [
    '2026-01-01',
    '2026-05-25',
    '2026-06-19',
    '2026-07-03',
    '2026-09-07',
    '2026-11-26',
    '2026-12-25',
  ])
  assert.ok(holidays.includes('2026-07-03'))
  assert.ok(holidays.includes('2026-09-07'))
  assert.ok(holidays.includes('2026-11-26'))
  assert.ok(!holidays.includes('2026-01-19'))
  assert.ok(!holidays.includes('2026-10-12'))
})

test('federal holidays do not count toward configured calendar weeks', () => {
  assert.equal(
    addWeeksExcludingUsFederalHolidays('2026-08-10', 4),
    '2026-09-08',
  )
  assert.equal(
    addWeeksExcludingUsFederalHolidays('2026-06-12', 3),
    '2026-07-05',
  )
  assert.equal(
    addWeeksExcludingUsFederalHolidays('2026-10-05', 1),
    '2026-10-12',
  )
})

test('default production dates cascade from EXT to DM and then HW', () => {
  assert.deepEqual(calculateProductionDates('2026-08-10'), {
    extDate: '2026-08-10',
    dmDate: '2026-09-08',
    hwDate: '2026-09-15',
  })
})

test('Shutter is scheduled before DM and excludes configured holidays in reverse', () => {
  assert.equal(
    subtractWeeksExcludingUsFederalHolidays('2026-09-08', 1),
    '2026-08-31',
  )
  assert.equal(calculateShutterDate('2026-09-08'), '2026-08-31')
  assert.equal(calculateShutterDate('2026-09-08', {
    ...defaultBuilderDateConfiguration,
    shutterBeforeDmWeeks: 2,
  }), '2026-08-24')
})

test('moving EXT cascades DM and HW while moving DM only cascades HW', () => {
  const draft = {
    extDate: '2026-08-10',
    dmDate: '2026-09-08',
    dmSplitParts: [],
    hwDate: '2026-09-15',
    hwSplitParts: [],
  }

  assert.deepEqual(getProductionDateCascade(
    draft,
    'EXT',
    '2026-08-17',
    defaultBuilderDateConfiguration,
  ), {
    extDate: '2026-08-17',
    dmDate: '2026-09-15',
    dmSplitParts: [],
    hwDate: '2026-09-22',
    hwSplitParts: [],
  })

  assert.deepEqual(getProductionDateCascade(
    draft,
    'DM',
    '2026-08-31',
    defaultBuilderDateConfiguration,
  ), {
    dmDate: '2026-08-31',
    dmSplitParts: [],
    hwDate: '2026-09-08',
    hwSplitParts: [],
  })
})

test('moving EXT or DM also recalculates Shutter when the DM option enables it', () => {
  const draft = {
    dmShutters: true,
    shutterDate: '2026-08-31',
    extDate: '2026-08-10',
    dmDate: '2026-09-08',
    dmSplitParts: [],
    hwDate: '2026-09-15',
    hwSplitParts: [],
  }

  assert.equal(getProductionDateCascade(
    draft,
    'EXT',
    '2026-08-17',
    defaultBuilderDateConfiguration,
  ).shutterDate, '2026-09-08')

  assert.equal(getProductionDateCascade(
    draft,
    'DM',
    '2026-08-31',
    defaultBuilderDateConfiguration,
  ).shutterDate, '2026-08-24')
})
