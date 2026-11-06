import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyTravelEstimates, routesMinutesByLeg, travelEstimateMessages, travelLegSource, travelLegsToEstimate,
} from '../src/features/customer-service/utils/travelEstimates.js'

const leg = (fromRequestId, toRequestId, minutes) => ({
  key: `${fromRequestId}>${toRequestId}`, fromRequestId, toRequestId, minutes,
})

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
