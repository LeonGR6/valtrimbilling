import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyTravelEstimates, mergeTravelEstimateResults, outdatedTravelLegs, routesMinutesByLeg, travelEstimateMessages,
  travelLegHelperText, travelLegSource, travelLegsToEstimate,
} from '../src/features/customer-service/utils/travelEstimates.js'

const leg = (fromRequestId, toRequestId, minutes) => ({
  key: `${fromRequestId}>${toRequestId}`, fromRequestId, toRequestId, minutes,
})

// Planning moment: 7:00 AM in California, before every departure used below.
const NOW = new Date('2026-11-09T15:00:00Z')

test('only empty legs between saved requests are sent to Google Maps', () => {
  assert.deepEqual(
    travelLegsToEstimate([leg('10', '20', null), leg('20', '30', 15), leg('prototype-1', '20', null)]),
    [{ fromRequestId: 10, toRequestId: 20 }],
  )
  assert.deepEqual(travelLegsToEstimate(), [])
})

test('Google results fill empty legs, never replace typed values and never turn a failure into zero', () => {
  const values = { technicianIds: ['4'], travelMinutes: { '20>30': 12 } }
  const results = [
    { fromRequestId: 10, toRequestId: 20, minutes: 18, source: 'ROUTES_API', status: 'CALCULATED' },
    { fromRequestId: 20, toRequestId: 30, minutes: 25, source: 'ROUTES_API', status: 'CALCULATED' },
    { fromRequestId: 30, toRequestId: 40, minutes: null, source: null, status: 'FAILED', message: 'Google Maps could not calculate CS-0030 → CS-0040. Enter the minutes manually.' },
    { fromRequestId: 40, toRequestId: 50, minutes: 0, source: 'MANUAL', status: 'STORED' },
  ]
  const next = applyTravelEstimates(values, results)
  assert.deepEqual(next.travelMinutes, { '10>20': 18, '20>30': 12, '40>50': 0 })
  assert.equal(next.technicianIds, values.technicianIds)
  assert.deepEqual(values.travelMinutes, { '20>30': 12 })
  assert.deepEqual(travelEstimateMessages(results), ['Google Maps could not calculate CS-0030 → CS-0040. Enter the minutes manually.'])
})

test('a leg is labeled Google Maps until the coordinator changes its minutes', () => {
  const routes = routesMinutesByLeg([
    { fromRequestId: 10, toRequestId: 20, minutes: 18, source: 'ROUTES_API' },
    { fromRequestId: 20, toRequestId: 30, minutes: 9, source: 'MANUAL' },
  ])
  assert.deepEqual(routes, { '10>20': 18 })
  assert.equal(travelLegSource('10>20', { '10>20': 18 }, routes), 'ROUTES_API')
  assert.equal(travelLegSource('10>20', { '10>20': 20 }, routes), 'MANUAL')
  assert.equal(travelLegSource('20>30', { '20>30': 9 }, routes), 'MANUAL')
  assert.equal(travelLegSource('30>40', {}, routes), null)
})

test('a Google leg is sent again only when its departure moved to another half hour', () => {
  const routes = { '10>20': 23, '20>30': 30 }
  const details = {
    '10>20': { staticMinutes: 20, trafficModel: 'BEST_GUESS', trafficDepartureAt: '2026-11-09T16:40:00.000Z' },
    '20>30': { staticMinutes: 20, trafficModel: 'BEST_GUESS', trafficDepartureAt: '2026-11-09T16:40:00.000Z' },
  }
  const legs = [
    { ...leg('10', '20', 23), departureAt: '2026-11-09T16:50:00.000Z' },
    { ...leg('20', '30', 30), departureAt: '2026-11-09T20:40:00.000Z' },
    { ...leg('30', '40', null), departureAt: '2026-11-09T20:40:00.000Z' },
  ]
  assert.deepEqual(travelLegsToEstimate(legs, routes, details, 'BEST_GUESS', NOW), [
    { fromRequestId: 20, toRequestId: 30, departureAt: '2026-11-09T20:40:00.000Z' },
    { fromRequestId: 30, toRequestId: 40, departureAt: '2026-11-09T20:40:00.000Z' },
  ])
})

test('turning traffic on marks saved Google legs without traffic to calculate again', () => {
  const saved = { ...leg('1496', '1497', 23), departureAt: '2026-11-16T16:40:00.000Z', technicianNames: ['Jorge Murillo'] }
  const routes = { '1496>1497': 23 }
  const details = { '1496>1497': { staticMinutes: null, trafficModel: null, trafficDepartureAt: null } }
  assert.deepEqual(travelLegsToEstimate([saved], routes, details, 'BEST_GUESS', NOW), [
    { fromRequestId: 1496, toRequestId: 1497, departureAt: '2026-11-16T16:40:00.000Z' },
  ])
  assert.equal(
    travelLegHelperText({ leg: saved, source: 'ROUTES_API', details: details['1496>1497'], trafficMode: 'BEST_GUESS', now: NOW }),
    'Traffic setting changed: calculate again · Jorge Murillo',
  )
  // With traffic off the same leg is current and is not sent.
  assert.deepEqual(travelLegsToEstimate([saved], routes, details, 'OFF', NOW), [])
})

test('turning traffic off marks Google legs calculated with traffic to calculate again', () => {
  const withTraffic = { ...leg('10', '20', 30), departureAt: '2026-11-09T16:40:00.000Z' }
  const details = {
    '10>20': { staticMinutes: 23, trafficModel: 'BEST_GUESS', trafficDepartureAt: '2026-11-09T16:40:00.000Z' },
  }
  assert.deepEqual(travelLegsToEstimate([withTraffic], { '10>20': 30 }, details, 'OFF', NOW), [
    { fromRequestId: 10, toRequestId: 20, departureAt: '2026-11-09T16:40:00.000Z' },
  ])
})

test('a departure that already passed never asks for traffic', () => {
  const past = { ...leg('10', '20', 23), departureAt: '2026-11-09T14:00:00.000Z' }
  const details = { '10>20': { staticMinutes: null, trafficModel: null, trafficDepartureAt: null } }
  assert.deepEqual(travelLegsToEstimate([past], { '10>20': 23 }, details, 'BEST_GUESS', NOW), [])
})

test('a typed value is never sent or replaced, even when its departure moved', () => {
  const legs = [{ ...leg('20', '30', 12), departureAt: '2026-11-09T20:40:00.000Z' }]
  const details = {
    '20>30': { staticMinutes: 20, trafficModel: 'BEST_GUESS', trafficDepartureAt: '2026-11-09T16:40:00.000Z' },
  }
  assert.deepEqual(travelLegsToEstimate(legs, { '20>30': 30 }, details), [])
  const next = applyTravelEstimates(
    { travelMinutes: { '20>30': 12 } },
    [{ fromRequestId: 20, toRequestId: 30, minutes: 35, source: 'ROUTES_API', status: 'CALCULATED' }],
    { '20>30': 30 },
  )
  assert.deepEqual(next.travelMinutes, { '20>30': 12 })
})

test('a moved leg that Google could not refresh shows its warning', () => {
  const results = [
    {
      fromRequestId: 20, toRequestId: 30, minutes: 30, source: 'ROUTES_API', status: 'STORED',
      message: 'Google Maps could not refresh the traffic estimate. The saved value is kept.',
    },
    { fromRequestId: 30, toRequestId: 40, minutes: 25, source: 'ROUTES_API', status: 'CALCULATED' },
  ]
  assert.deepEqual(travelEstimateMessages(results), [
    'Google Maps could not refresh the traffic estimate. The saved value is kept.',
  ])
})

test('a Google leg marked to calculate again blocks registering until it is recalculated or typed', () => {
  // Thursday 12 Nov: CS-2022 → CS-2497 leaves at 9:25 AM and was saved with BEST_GUESS.
  const saved = { ...leg('1022', '1497', 23), departureAt: '2026-11-12T17:25:00.000Z' }
  const travelDetails = {
    '1022>1497': { staticMinutes: 23, trafficModel: 'BEST_GUESS', trafficDepartureAt: '2026-11-12T17:25:00.000Z' },
  }
  const input = {
    travelLegs: [saved], travelMinutes: { '1022>1497': 23 }, routesMinutes: { '1022>1497': 23 }, travelDetails, now: NOW,
  }
  assert.deepEqual(outdatedTravelLegs({ ...input, trafficMode: 'BEST_GUESS' }), [])
  // After switching to PESSIMISTIC the saved BEST_GUESS value is out of date.
  assert.deepEqual(outdatedTravelLegs({ ...input, trafficMode: 'PESSIMISTIC' }).map((entry) => entry.key), ['1022>1497'])
  // A departure moved to another half hour is out of date too.
  const moved = { ...saved, departureAt: '2026-11-12T18:10:00.000Z' }
  assert.deepEqual(outdatedTravelLegs({ ...input, travelLegs: [moved], trafficMode: 'BEST_GUESS' }).length, 1)
  // A typed value, an empty leg, and a leg Google could not refresh never block.
  assert.deepEqual(outdatedTravelLegs({ ...input, travelMinutes: { '1022>1497': 30 }, travelLegs: [{ ...saved, minutes: 30 }], trafficMode: 'PESSIMISTIC' }), [])
  assert.deepEqual(outdatedTravelLegs({ ...input, travelLegs: [{ ...saved, minutes: null }], travelMinutes: {}, trafficMode: 'PESSIMISTIC' }), [])
  assert.deepEqual(outdatedTravelLegs({ ...input, trafficMode: 'PESSIMISTIC', refreshFailedKeys: ['1022>1497'] }), [])
  // Once recalculated with PESSIMISTIC at the same departure it is current again.
  const recalculated = mergeTravelEstimateResults({ routes: input.routesMinutes, details: travelDetails }, [
    { fromRequestId: 1022, toRequestId: 1497, minutes: 27, source: 'ROUTES_API', status: 'CALCULATED',
      staticMinutes: 23, trafficModel: 'PESSIMISTIC', trafficDepartureAt: '2026-11-12T17:25:00.000Z' },
  ])
  assert.deepEqual(outdatedTravelLegs({
    travelLegs: [{ ...saved, minutes: 27 }], travelMinutes: { '1022>1497': 27 }, routesMinutes: recalculated.routes,
    travelDetails: recalculated.details, trafficMode: 'PESSIMISTIC', now: NOW,
  }), [])
})

test('a Google value is replaced by the recalculated minutes', () => {
  const next = applyTravelEstimates(
    { travelMinutes: { '20>30': 30 } },
    [{ fromRequestId: 20, toRequestId: 30, minutes: 35, source: 'ROUTES_API', status: 'CALCULATED' }],
    { '20>30': 30 },
  )
  assert.deepEqual(next.travelMinutes, { '20>30': 35 })
})

test('recalculating one leg keeps the traffic details of the legs already calculated', () => {
  // Thursday 12 Nov: CS-2496 → CS-2022 leaves at 8:40 AM, CS-2022 → CS-2497 at 9:30 AM.
  const first = mergeTravelEstimateResults({}, [
    { fromRequestId: 1496, toRequestId: 1022, minutes: 0, source: 'ROUTES_API', status: 'CALCULATED',
      staticMinutes: 0, trafficModel: 'BEST_GUESS', trafficDepartureAt: '2026-11-12T16:40:00.000Z' },
    { fromRequestId: 1022, toRequestId: 1497, minutes: 23, source: 'ROUTES_API', status: 'CALCULATED',
      staticMinutes: 23, trafficModel: 'BEST_GUESS', trafficDepartureAt: '2026-11-12T17:30:00.000Z' },
  ])
  // Work starts 5 minutes earlier: only the second leg moved to another half hour and is sent.
  const second = mergeTravelEstimateResults(first, [
    { fromRequestId: 1022, toRequestId: 1497, minutes: 23, source: 'ROUTES_API', status: 'CALCULATED',
      staticMinutes: 23, trafficModel: 'BEST_GUESS', trafficDepartureAt: '2026-11-12T17:25:00.000Z' },
  ])
  assert.deepEqual(second.routes, { '1496>1022': 0, '1022>1497': 23 })
  assert.equal(second.details['1022>1497'].trafficDepartureAt, '2026-11-12T17:25:00.000Z')

  const firstLeg = {
    ...leg('1496', '1022', 0), departureAt: '2026-11-12T16:40:00.000Z', technicianNames: ['Jorge Murillo'],
  }
  assert.deepEqual(travelLegsToEstimate([firstLeg], second.routes, second.details, 'BEST_GUESS', NOW), [])
  assert.equal(
    travelLegHelperText({ leg: firstLeg, source: 'ROUTES_API', details: second.details['1496>1022'], trafficMode: 'BEST_GUESS', now: NOW }),
    'Google Maps with traffic at 8:40 AM · 0 min without traffic · Jorge Murillo',
  )
})

test('the leg label shows the traffic time and the minutes without traffic', () => {
  const details = { staticMinutes: 18, trafficModel: 'BEST_GUESS', trafficDepartureAt: '2026-11-09T16:40:00.000Z' }
  const base = { ...leg('10', '20', 23), technicianNames: ['Jorge Murillo'] }
  assert.equal(
    travelLegHelperText({ leg: { ...base, departureAt: '2026-11-09T16:40:00.000Z' }, source: 'ROUTES_API', details, trafficMode: 'BEST_GUESS', now: NOW }),
    'Google Maps with traffic at 8:40 AM · 18 min without traffic · Jorge Murillo',
  )
  assert.equal(
    travelLegHelperText({
      leg: base, source: 'ROUTES_API', details: { staticMinutes: null, trafficModel: null, trafficDepartureAt: null },
    }),
    'Google Maps driving estimate · Jorge Murillo',
  )
  assert.equal(
    travelLegHelperText({ leg: { ...base, departureAt: '2026-11-09T20:40:00.000Z' }, source: 'ROUTES_API', details, trafficMode: 'BEST_GUESS', now: NOW }),
    'Departure moved: calculate again · Jorge Murillo',
  )
  assert.equal(travelLegHelperText({ leg: { ...base, minutes: null }, source: null }), 'Travel time pending · Jorge Murillo')
  assert.equal(travelLegHelperText({ leg: base, source: 'MANUAL', details }), 'Manual estimate · Jorge Murillo')
})
