import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateDistanceMiles, hasCoordinates, nearbyCandidates, proximityBand,
} from '../src/features/customer-service/utils/customerServiceProximity.js'
import {
  getProposalNearbyVisits, nearbyIdsToMeasure, nearbyVisitDistance, nearbyVisitsThrough,
} from '../src/features/customer-service/utils/proposalNearbyVisits.js'
import { maxNearbyDrivingCandidates } from '../src/features/customer-service/utils/customerServiceProximity.js'
import { toDistanceBands } from '../src/features/customer-service/utils/appointmentRecords.js'

// Saved property coordinates (numeric strings, as PostgREST returns them).
const echoHighlands = { latitude: '33.660230000000000', longitude: '-117.388310000000000' }
const harmony = { latitude: '33.655301100000000', longitude: '-117.243801500000000' }
const linwood = { latitude: '33.944690000000000', longitude: '-116.934520000000000' }
const bands = { distanceGreenMaxMiles: 5, distanceYellowMaxMiles: 10, distanceOrangeMaxMiles: 20 }

// Tuesday 10 Nov 2026, 7:00 AM in California.
const NOW = new Date('2026-11-10T15:00:00Z')

test('straight-line miles between saved properties', () => {
  // Google drives Echo Highlands → Harmony in 11.5 mi; the straight line is shorter.
  assert.ok(Math.abs(calculateDistanceMiles(echoHighlands, harmony) - 8.32) < 0.01)
  assert.ok(Math.abs(calculateDistanceMiles(echoHighlands, linwood) - 32.64) < 0.01)
  assert.equal(calculateDistanceMiles(echoHighlands, echoHighlands), 0)
  assert.equal(calculateDistanceMiles(echoHighlands, { latitude: null, longitude: '-117.2' }), null)
  assert.equal(calculateDistanceMiles(echoHighlands, { latitude: '', longitude: '' }), null)
  assert.equal(hasCoordinates({ latitude: 0, longitude: 0 }), true)
  assert.equal(hasCoordinates({ latitude: 'north', longitude: -117 }), false)
})

test('distance bands use the configured limits, each one inclusive', () => {
  assert.equal(proximityBand(0, bands), 'GREEN')
  assert.equal(proximityBand(5, bands), 'GREEN')
  assert.equal(proximityBand(5.01, bands), 'YELLOW')
  assert.equal(proximityBand(10, bands), 'YELLOW')
  assert.equal(proximityBand(10.01, bands), 'ORANGE')
  assert.equal(proximityBand(20, bands), 'ORANGE')
  assert.equal(proximityBand(20.01, bands), 'RED')
  assert.equal(proximityBand(null, bands), null)
  // Other limits from Settings change the band without a deploy.
  assert.equal(proximityBand(8.32, { distanceGreenMaxMiles: 3, distanceYellowMaxMiles: 6, distanceOrangeMaxMiles: 9 }), 'ORANGE')
})

test('candidates are nearest first, within the period and outside unavailable days', () => {
  const visit = (requestId, place, date, start) => ({ requestId, requestNumber: `CS-${requestId}`, ...place, date, start })
  const candidates = nearbyCandidates({
    requestId: '1022',
    origin: echoHighlands,
    visits: [
      visit('1497', harmony, '2026-11-12', '10:00'),
      visit('1496', echoHighlands, '2026-11-12', '08:00'),
      visit('1500', echoHighlands, '2026-11-11', '08:00'), // customer unavailable that day
      visit('1501', echoHighlands, '2026-11-09', '08:00'), // already past
      visit('1502', echoHighlands, '2026-11-24', '08:00'), // after the period
      visit('1022', echoHighlands, '2026-11-12', '12:00'), // the request itself
      visit('1503', { latitude: null, longitude: null }, '2026-11-13', '08:00'),
    ],
    openRequests: [
      { requestId: '1023', requestNumber: 'CS-1023', ...linwood },
      { requestId: '1504', requestNumber: 'CS-1504', ...echoHighlands },
    ],
    fromDate: '2026-11-10',
    throughDate: '2026-11-23',
    unavailableDates: ['2026-11-11'],
  })
  assert.deepEqual(candidates.map((candidate) => [candidate.requestId, candidate.kind]), [
    ['1496', 'VISIT'], ['1504', 'OPEN_REQUEST'], ['1497', 'VISIT'], ['1023', 'OPEN_REQUEST'], ['1503', 'VISIT'],
  ])
  assert.equal(candidates[0].miles, 0)
  assert.equal(candidates.at(-1).miles, null)
})

test('an overdue request looks as far as the time suggestions; otherwise up to its due date', () => {
  assert.deepEqual(nearbyVisitsThrough('2026-11-13', '2026-11-10'), { date: '2026-11-13', byDueDate: true })
  assert.deepEqual(nearbyVisitsThrough('2026-11-10', '2026-11-10'), { date: '2026-11-10', byDueDate: true })
  // Ten business days from Tuesday 10 Nov, counting today and skipping the weekends.
  assert.deepEqual(nearbyVisitsThrough('2026-11-05', '2026-11-10'), { date: '2026-11-23', byDueDate: false })
  assert.deepEqual(nearbyVisitsThrough(null, '2026-11-10'), { date: '2026-11-23', byDueDate: false })
})

// Requests in the shape the planner receives (appointments already applied).
const request = (id, place, extra = {}) => ({
  id, requestNumber: `CS-${id}`, community: '', workflowStage: 'READY_TO_PROPOSE', dueOn: '2026-11-13',
  customerUnavailableDates: [], ...place, ...extra,
})
const scheduled = (date, start, end, state = 'SCHEDULED') => ({
  workflowStage: 'CONFIRMED',
  customerWindow: { date, start: '08:00', end: '10:00' },
  internalSlot: { start, end },
  technicianIds: ['82'],
  assignedTechnicians: [{ id: '82', name: 'Jorge Murillo' }],
  appointment: { id: 1, state },
})

test('the planner lists scheduled visits and open requests near the request', () => {
  const planned = request(2022, echoHighlands, { community: 'Echo Highlands', dueOn: '2026-11-05' })
  const requests = [
    planned,
    request(2496, echoHighlands, { community: 'Echo Highlands', ...scheduled('2026-11-12', '08:00', '08:30') }),
    request(2497, harmony, scheduled('2026-11-12', '10:00', '10:45')),
    request(2400, echoHighlands, scheduled('2026-11-09', '08:00', '08:30', 'COMPLETED')),
    request(2401, echoHighlands, { ...scheduled('2026-11-13', '08:00', '08:30', 'CANCELLED'), workflowStage: 'READY_TO_PROPOSE' }),
    request(2023, linwood, { workflowStage: 'NEEDS_REVIEW', dueOn: '2026-11-03' }),
    request(2402, echoHighlands, { workflowStage: 'CLOSED' }),
  ]
  const nearby = getProposalNearbyVisits({ request: planned, requests, now: NOW })
  assert.equal(nearby.hasCoordinates, true)
  assert.deepEqual(nearby.through, { date: '2026-11-23', byDueDate: false })
  assert.deepEqual(nearby.candidates.map((candidate) => candidate.requestNumber), ['CS-2496', 'CS-2401', 'CS-2497', 'CS-2023'])
  assert.deepEqual(nearby.candidates[0], {
    requestId: '2496', requestNumber: 'CS-2496', community: 'Echo Highlands',
    latitude: echoHighlands.latitude, longitude: echoHighlands.longitude,
    date: '2026-11-12', start: '08:00', end: '08:30', technicianIds: ['82'], technicianNames: ['Jorge Murillo'],
    kind: 'VISIT', miles: 0,
  })
  // A cancelled appointment leaves an open request; it is not a scheduled visit.
  assert.equal(nearby.candidates[1].kind, 'OPEN_REQUEST')
  assert.equal(nearby.candidates[3].stage, 'NEEDS_REVIEW')
})

test('a customer-unavailable day and a due date ahead limit the visits', () => {
  const planned = request(2022, echoHighlands, { dueOn: '2026-11-13', customerUnavailableDates: ['2026-11-12'] })
  const requests = [
    planned,
    request(2496, echoHighlands, scheduled('2026-11-12', '08:00', '08:30')),
    request(2498, echoHighlands, scheduled('2026-11-13', '08:00', '08:30')),
    request(2499, echoHighlands, scheduled('2026-11-16', '08:00', '08:30')),
  ]
  const nearby = getProposalNearbyVisits({ request: planned, requests, now: NOW })
  assert.deepEqual(nearby.through, { date: '2026-11-13', byDueDate: true })
  assert.deepEqual(nearby.candidates.map((candidate) => candidate.requestNumber), ['CS-2498'])
})

test('a request without coordinates cannot be compared', () => {
  const planned = request(2022, { latitude: null, longitude: null })
  const nearby = getProposalNearbyVisits({
    request: planned, requests: [planned, request(2496, echoHighlands, scheduled('2026-11-12', '08:00', '08:30'))], now: NOW,
  })
  assert.equal(nearby.hasCoordinates, false)
  assert.deepEqual(nearby.candidates, [])
})

test('only candidates within the last band in a straight line are measured, nearest first', () => {
  const candidate = (requestId, miles) => ({ requestId: String(requestId), miles })
  assert.deepEqual(nearbyIdsToMeasure([
    candidate(2496, 0), candidate(2497, 8.3), candidate(2499, 20), candidate(2023, 32.6), candidate(2030, null),
  ], bands), [2496, 2497, 2499])
  const many = Array.from({ length: maxNearbyDrivingCandidates + 5 }, (_, index) => candidate(3000 + index, index / 10))
  assert.equal(nearbyIdsToMeasure(many, bands).length, maxNearbyDrivingCandidates)
  assert.equal(nearbyIdsToMeasure(many, bands)[0], 3000)
})

test('the chip shows driving miles with their band, or straight-line miles without one', () => {
  const harmony = { requestId: '2497', miles: 8.32 }
  // While Google is checking, or when it could not measure: straight line, no band.
  assert.deepEqual(nearbyVisitDistance(harmony, undefined, bands), { text: '≈ 8.3 mi', band: null })
  assert.deepEqual(nearbyVisitDistance(harmony, { drivingMiles: null, band: null, status: 'FAILED' }, bands),
    { text: '≈ 8.3 mi', band: null })
  // Driving 11.5 mi: farther than the straight line suggested, so Far (orange).
  assert.deepEqual(nearbyVisitDistance(harmony, { drivingMiles: 11.5, band: 'ORANGE', status: 'CALCULATED' }, bands),
    { text: 'Far · 11.5 mi', band: 'ORANGE' })
  assert.deepEqual(nearbyVisitDistance({ requestId: '2496', miles: 0 }, { drivingMiles: 0, band: 'GREEN' }, bands),
    { text: 'Near · 0.0 mi', band: 'GREEN' })
  // Beyond 20 mi in a straight line the drive is longer still: Very far, without Google.
  assert.deepEqual(nearbyVisitDistance({ requestId: '2023', miles: 32.64 }, undefined, bands),
    { text: 'Very far · ≈ 32.6 mi', band: 'RED' })
  assert.deepEqual(nearbyVisitDistance({ requestId: '2030', miles: null }, undefined, bands), { text: 'No coordinates', band: null })
})

test('distance bands come from the settings row', () => {
  assert.deepEqual(toDistanceBands({
    distance_green_max_miles: '5.00', distance_yellow_max_miles: '10.00', distance_orange_max_miles: '20.00',
  }), bands)
  assert.equal(toDistanceBands(null), null)
})
