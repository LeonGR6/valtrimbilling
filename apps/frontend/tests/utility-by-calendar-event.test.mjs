import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildBilledUtilityCharges,
  summarizeDrawPackage,
  utilityChargeKey,
} from '../src/features/draw-invoice/utils/drawPackages.js'
import {
  buildDrawWorksheet,
  getUtilityEvents,
} from '../src/features/draw-invoice/utils/drawWorksheet.js'
import {
  buildCalendarDrawSuggestion,
  buildPhaseEventFirstDates,
  buildUtilityEventSuggestions,
} from '../src/features/draw-invoice/utils/calendarDrawSuggestions.js'
import {
  toCreateDrawPackageRpc,
  toDrawInvoicePackage,
} from '../src/features/draw-invoice/services/drawInvoicePackageRecord.js'
import { planFinalReleaseSplit } from '../src/features/draw-invoice/utils/finalReleaseSplit.js'

// The Builder of the request: 1 Draw of 100% on DM, Hardware 100% on HW and the Utility 100% on
// EXT, an event that is not a Draw.
const singleDrawSetup = {
  anyDate: true,
  utilityBuilding: true,
  utilityBillingMode: 'BY_EVENT',
  utilityEventPercentages: { EXT: 100, DM: 0, HW: 0 },
  separateHardwarePrice: true,
  hardwareBillingMode: 'BY_EVENT',
  hardwareEventPercentages: { EXT: 0, DM: 0, HW: 100 },
  draws: [{ percentage: 100, eventType: 'DM' }],
}

// MONTE VISTA: the Utility split 20 / 60 / 20 with two DM Draws.
const splitSetup = {
  anyDate: true,
  utilityBuilding: true,
  utilityBillingMode: 'BY_EVENT',
  utilityEventPercentages: { EXT: 20, DM: 60, HW: 20 },
  draws: [
    { percentage: 20, eventType: 'EXT' },
    { percentage: 55, eventType: 'DM' },
    { percentage: 20, eventType: 'DM' },
    { percentage: 5, eventType: 'HW' },
  ],
}

const phase = {
  id: 3,
  name: '3',
  building: '3',
  lots: [
    { id: 1, lotNumber: '10', planId: 1, optionIds: [] },
    { id: 2, lotNumber: '11', planId: 1, optionIds: [] },
    { id: 101, lotNumber: 'UTILITY-1', utilityName: 'B3', planId: 2, optionIds: [], isUtilityBuilding: true },
  ],
}

const job = {
  id: 43,
  sequenceSheet: {
    plans: [
      { id: 1, code: 'A', price: 10000, hardwarePrice: 400, options: [] },
      { id: 2, code: 'UTIL', price: 3150, options: [] },
    ],
    phases: [phase],
  },
}

const activity = (eventType, date, lotIds = [1]) => ({
  id: `${eventType}-${date}`,
  status: 'ACTIVE',
  jobId: 43,
  phaseId: 3,
  stages: [{ type: eventType, schedules: [{ id: `${eventType}-s`, date, lotIds }] }],
})

test('the Utility events are the ones with a share, whether or not they are Draws', () => {
  assert.deepEqual(getUtilityEvents(singleDrawSetup), ['EXT'])
  assert.deepEqual(getUtilityEvents(splitSetup), ['EXT', 'DM', 'HW'])
  assert.deepEqual(getUtilityEvents({ ...splitSetup, utilityBillingMode: 'FULL' }), [])
})

test('the worksheet splits the Utility Plan Price by event, the last event taking the cents left', () => {
  const sheet = buildDrawWorksheet({ ...job, sequenceSheet: { ...job.sequenceSheet, plans: [
    job.sequenceSheet.plans[0],
    { id: 2, code: 'UTIL', price: 1000.01, options: [] },
  ] } }, phase, splitSetup)
  const utility = sheet.rows.find((row) => row.isUtilityBuilding)

  assert.deepEqual(utility.utilityEventAmounts, { EXT: 200, DM: 600.01, HW: 200 })
  assert.deepEqual(utility.utilityEventPercentages, { EXT: 20, DM: 60, HW: 20 })
})

test('a Package of only a Utility share bills its percentage, with no Draw cell', () => {
  const summary = summarizeDrawPackage({
    selections: [],
    utilityEventSelections: [{ phaseId: 3, lotId: 101, eventType: 'EXT' }],
  }, job, phase, splitSetup)

  assert.equal(summary.utilityCount, 1)
  assert.equal(summary.utilityTotal, 630)
  assert.equal(summary.currentDraw, 630)
  assert.equal(summary.grossAmount, 630)
  assert.equal(summary.utilityRows[0].utilityEventType, 'EXT')
  assert.equal(summary.utilityRows[0].drawIndex, null)
  assert.equal(summary.scopeCount, 1)
})

test('the Utility share of an event that is not a Draw bills 100% next to the Draw and Hardware', () => {
  const summary = summarizeDrawPackage({
    selections: [{ phaseId: 3, lotId: 1, drawIndex: 0 }],
    utilityEventSelections: [{ phaseId: 3, lotId: 101, eventType: 'EXT' }],
  }, job, phase, singleDrawSetup)

  assert.equal(summary.utilityTotal, 3150)
  assert.equal(summary.currentDraw, 10000 + 3150)
})

test('Utility shares billed on their own lines and on Draw rows both count as billed', () => {
  const billed = buildBilledUtilityCharges([
    {
      id: 1,
      jobId: 43,
      packageNumber: 'DP-1',
      status: 'PAID_CLOSED',
      persistedDrawLines: [{
        lotId: 101, isUtilityBuilding: true, utilityBillingMode: 'BY_EVENT', utilityEventType: 'EXT', utilityAmount: 630, drawIndex: 0,
      }],
    },
    {
      id: 2,
      jobId: 43,
      packageNumber: 'DP-2',
      status: 'DRAFT',
      persistedUtilityLines: [{
        lotId: 101, isUtilityBuilding: true, utilityBillingMode: 'BY_EVENT', utilityEventType: 'DM', utilityAmount: 1890, drawIndex: null,
      }],
    },
    {
      id: 3,
      jobId: 43,
      packageNumber: 'DP-3',
      status: 'CANCELLED',
      persistedUtilityLines: [{
        lotId: 101, isUtilityBuilding: true, utilityBillingMode: 'BY_EVENT', utilityEventType: 'HW', utilityAmount: 630,
      }],
    },
  ], 43)

  assert.equal(billed.get(utilityChargeKey(101, 'BY_EVENT', 'EXT')).packageNumber, 'DP-1')
  assert.equal(billed.get(utilityChargeKey(101, 'BY_EVENT', 'DM')).packageNumber, 'DP-2')
  assert.equal(billed.has(utilityChargeKey(101, 'BY_EVENT', 'HW')), false)
})

test('the Calendar suggests a Utility share once a Lot of its Phase has the event', () => {
  const activities = [activity('EXT', '2026-11-02', [2]), activity('EXT', '2026-11-05', [1]), activity('HW', '2026-12-20')]
  const firstDates = buildPhaseEventFirstDates({ activities, job })

  assert.equal(firstDates.get('3:EXT'), '2026-11-02')
  assert.deepEqual(
    buildUtilityEventSuggestions({ activities, job, schedule: splitSetup, latestDate: '2026-11-11' }),
    [{ phaseId: 3, lotId: 101, eventType: 'EXT', eventDate: '2026-11-02' }],
  )
  assert.deepEqual(
    buildUtilityEventSuggestions({
      activities,
      job,
      schedule: splitSetup,
      latestDate: '2026-11-11',
      packages: [{ id: 9, jobId: 43, status: 'DRAFT', persistedUtilityLines: [{ lotId: 101, isUtilityBuilding: true, utilityBillingMode: 'BY_EVENT', utilityEventType: 'EXT' }] }],
    }),
    [],
  )
})

test('a Builder billed on any date gets the Utility EXT share suggested even with no Draw on EXT', () => {
  const suggestion = buildCalendarDrawSuggestion({
    activities: [activity('EXT', '2026-11-02')],
    job,
    schedule: singleDrawSetup,
    asOfDate: '2026-11-11',
  })

  assert.deepEqual(
    suggestion.suggestedUtilitySelections.map(({ lotId, eventType }) => [lotId, eventType]),
    [[101, 'EXT']],
  )
})

test('the create payload sends the Utility shares by Calendar event apart from the cells', () => {
  const payload = toCreateDrawPackageRpc({
    jobId: 43,
    selections: [{ phaseId: 3, lotId: 1, drawIndex: 0 }],
    utilityEventSelections: [
      { phaseId: 3, lotId: 101, eventType: 'HW' },
      { phaseId: 3, lotId: 101, eventType: 'EXT' },
      { phaseId: 3, lotId: 101, eventType: 'EXT' },
    ],
  })

  assert.deepEqual(payload.p_selections, [{ lot_id: 1, draw_number: 1 }])
  assert.deepEqual(payload.p_utility_selections, [
    { lot_id: 101, event_type: 'EXT' },
    { lot_id: 101, event_type: 'HW' },
  ])
  assert.equal('p_utility_selections' in toCreateDrawPackageRpc({ jobId: 43, selections: [] }), false)
})

test('a saved Package reads its Utility lines, in event order, and counts their Lot', () => {
  const record = toDrawInvoicePackage(
    { id: 7, package_number: 'DP-7', job_id: 43, status: 'DRAFT', workflow_status: 'DRAFT', package_type: 'DRAW' },
    null,
    [],
    [],
    null,
    [],
    null,
    [],
    [],
    [],
    null,
    [],
    [],
    [],
    [
      { id: 2, package_id: 7, phase_id: 3, phase_code: '3', building: '3', lot_id: 101, lot_number: 'UTILITY-1', utility_name: 'B3', plan_code: 'UTIL', base_price: '3150.00', utility_event_type: 'HW', utility_percentage: '20.00', utility_amount: '630.00', gross_amount: '630.00', retention_amount: '0', wrap_amount: '0', net_amount: '630.00' },
      { id: 1, package_id: 7, phase_id: 3, phase_code: '3', building: '3', lot_id: 101, lot_number: 'UTILITY-1', utility_name: 'B3', plan_code: 'UTIL', base_price: '3150.00', utility_event_type: 'EXT', utility_percentage: '20.00', utility_amount: '630.00', gross_amount: '630.00', retention_amount: '0', wrap_amount: '0', net_amount: '630.00' },
    ],
  )

  assert.deepEqual(record.persistedUtilityLines.map((line) => line.utilityEventType), ['EXT', 'HW'])
  assert.equal(record.persistedUtilityLines[0].utilityLabel, 'B3')
  assert.equal(record.persistedUtilityLines[0].utilityAmount, 630)
  assert.equal(record.persistedUtilityLines[0].isUtilityBuilding, true)
  assert.deepEqual(record.lotIds, [101])
})

test('a Phase is finished for the Final Release only when every Utility share is billed', () => {
  const schedule = { ...splitSetup, finalReleaseScope: 'BUILDING' }
  const cells = phase.lots
    .filter((lot) => !lot.isUtilityBuilding)
    .flatMap((lot) => schedule.draws.map((_, drawIndex) => ({ phaseId: 3, lotId: lot.id, drawIndex })))
  const withoutUtility = planFinalReleaseSplit({ job, schedule, selections: cells })
  const withTwo = planFinalReleaseSplit({
    job,
    schedule,
    selections: cells,
    utilityCharges: [{ lotId: 101, eventType: 'EXT' }, { lotId: 101, eventType: 'DM' }],
  })
  const withAll = planFinalReleaseSplit({
    job,
    schedule,
    selections: cells,
    utilityCharges: ['EXT', 'DM', 'HW'].map((eventType) => ({ lotId: 101, eventType })),
  })

  assert.equal(withoutUtility.scopes[0].closes, false)
  assert.equal(withTwo.scopes[0].remainingAfter, 1)
  assert.equal(withAll.scopes[0].closes, true)
})
