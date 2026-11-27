import test from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultBuilderDateConfiguration,
  getBuilderDateConfiguration,
  toBuilderDateConfigurationRpc,
  withDefaultBuilderDateConfiguration,
} from '../src/features/builders/data/builders.js'
import {
  addWeeksExcludingUsFederalHolidays,
  calculateProductionDates,
  calculateShutterDate,
  getProductionDateCascade,
  addBusinessDays,
  businessDaysBetween,
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

test('Builder date configuration maps to the focused persistence RPC', () => {
  assert.deepEqual(toBuilderDateConfigurationRpc('50', {
    extToDmWeeks: 6,
    shutterBeforeDmWeeks: 2,
    dmToHwWeeks: 3,
  }), {
    p_builder_id: 50,
    p_ext_to_dm_weeks: 6,
    p_shutter_before_dm_weeks: 2,
    p_dm_to_hw_weeks: 3,
  })
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

test('Weatherstripping is suggested 2 business days after HW, skipping the weekend', () => {
  // 2026-09-15 is a Tuesday, 2026-09-17 a Thursday, 2026-09-18 a Friday.
  assert.equal(addBusinessDays('2026-09-15', 2), '2026-09-17')
  assert.equal(addBusinessDays('2026-09-17', 2), '2026-09-21')
  assert.equal(addBusinessDays('2026-09-18', 2), '2026-09-22')
  assert.equal(addBusinessDays('2026-09-19', 2), '2026-09-22')
  assert.equal(addBusinessDays('2026-09-22', -2), '2026-09-18')
  assert.equal(addBusinessDays('', 2), '')
  assert.equal(businessDaysBetween('2026-09-18', '2026-09-22'), 2)
  assert.equal(businessDaysBetween('2026-09-22', '2026-09-18'), -2)
  assert.equal(businessDaysBetween('2026-09-18', '2026-09-18'), 0)
})

test('moving HW moves Weatherstripping, and moving DM moves Baseboard install, by the same days', () => {
  const draft = {
    extDate: '2026-08-10',
    dmDate: '2026-09-08',
    dmSplitParts: [],
    dmBaseboardInstall: true,
    dmBaseboardInstallDate: '2026-09-10',
    hwDate: '2026-09-15',
    hwSplitParts: [],
    hwWeatherstripping: true,
    // Moved by hand to 3 business days after HW (Tuesday -> Friday): it keeps that gap.
    hwWeatherstrippingDate: '2026-09-18',
  }

  assert.deepEqual(getProductionDateCascade(draft, 'HW', '2026-09-22', defaultBuilderDateConfiguration), {
    hwDate: '2026-09-22',
    hwSplitParts: [],
    hwWeatherstrippingDate: '2026-09-25',
  })

  // DM carries HW, so it carries both.
  assert.deepEqual(getProductionDateCascade(draft, 'DM', '2026-08-31', defaultBuilderDateConfiguration), {
    dmDate: '2026-08-31',
    dmSplitParts: [],
    hwDate: '2026-09-08',
    hwSplitParts: [],
    dmBaseboardInstallDate: '2026-09-02',
    hwWeatherstrippingDate: '2026-09-11',
  })

  const ext = getProductionDateCascade(draft, 'EXT', '2026-08-17', defaultBuilderDateConfiguration)
  assert.equal(ext.dmBaseboardInstallDate, '2026-09-17')
  assert.equal(ext.hwWeatherstrippingDate, '2026-09-25')
})

test('a Weatherstripping carried by HW never lands on a weekend', () => {
  const draft = {
    hwDate: '2026-09-15', // Tuesday
    hwSplitParts: [],
    hwWeatherstripping: true,
    hwWeatherstrippingDate: '2026-09-17', // Thursday, 2 business days later
  }

  // HW to Thursday 17: Weatherstripping goes to Monday 21, not Saturday 19.
  assert.equal(
    getProductionDateCascade(draft, 'HW', '2026-09-17', defaultBuilderDateConfiguration).hwWeatherstrippingDate,
    '2026-09-21',
  )
})

test('an event that is not checked is not moved', () => {
  const draft = {
    dmDate: '2026-09-08',
    dmSplitParts: [],
    dmBaseboardInstall: false,
    dmBaseboardInstallDate: '',
    hwDate: '2026-09-15',
    hwSplitParts: [],
    hwWeatherstripping: false,
    hwWeatherstrippingDate: '',
  }

  const next = getProductionDateCascade(draft, 'DM', '2026-08-31', defaultBuilderDateConfiguration)
  assert.equal('dmBaseboardInstallDate' in next, false)
  assert.equal('hwWeatherstrippingDate' in next, false)
})

test('a Baseboard install carried by DM keeps its business days and never lands on a weekend', () => {
  const draft = {
    dmDate: '2026-09-08', // Tuesday
    dmSplitParts: [],
    dmBaseboardInstall: true,
    dmBaseboardInstallDate: '2026-09-10', // Thursday, 2 business days later
    hwDate: '2026-09-15',
    hwSplitParts: [],
  }

  // DM to Thursday 10: Baseboard goes to Monday 14, not Saturday 12.
  assert.equal(
    getProductionDateCascade(draft, 'DM', '2026-09-10', defaultBuilderDateConfiguration).dmBaseboardInstallDate,
    '2026-09-14',
  )
})
