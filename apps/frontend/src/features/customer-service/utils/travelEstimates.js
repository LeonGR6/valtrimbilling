// Planner helpers for travel minutes calculated with Google Routes API by the
// customer-service-travel-estimates Edge Function. A value the coordinator typed is
// never replaced. A Google value is replaced only when the traffic setting changed or,
// with traffic, its departure moved to another 30-minute slot. A failure stays blank.
import { travelLegKey } from './customerServiceScheduling.js'

const isRecordId = (id) => /^\d+$/u.test(String(id))
const DEPARTURE_SLOT_MS = 30 * 60 * 1000

const departureSlot = (instant) => (instant ? Math.floor(Date.parse(instant) / DEPARTURE_SLOT_MS) : null)

const californiaTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  hour: 'numeric',
  minute: '2-digit',
})

export function formatDepartureTime(instant) {
  return californiaTime.format(new Date(instant))
}

// Traffic model the server uses for this leg: none when traffic is OFF or the
// departure is unknown or already past (Google only accepts future departures).
export function expectedTrafficModel(leg, trafficMode = 'OFF', now = new Date()) {
  if (trafficMode === 'OFF' || !leg.departureAt || Date.parse(leg.departureAt) <= now.getTime()) return null
  return trafficMode
}

// Why a Google value must be calculated again, mirroring the server rule:
// 'TRAFFIC_SETTING' when it was calculated with another traffic setting, and
// 'DEPARTURE' when, with traffic, the departure moved to another 30-minute slot.
export function travelLegStaleReason(leg, details, trafficMode = 'OFF', now = new Date()) {
  const expected = expectedTrafficModel(leg, trafficMode, now)
  if ((details?.trafficModel ?? null) !== expected) return 'TRAFFIC_SETTING'
  if (expected === null) return null
  return departureSlot(details.trafficDepartureAt) !== departureSlot(leg.departureAt) ? 'DEPARTURE' : null
}

// Legs the planner sends to Google Maps: empty legs between saved requests, and Google
// values that must be calculated again. Typed values are never sent.
export function travelLegsToEstimate(travelLegs = [], routesMinutes = {}, travelDetails = {}, trafficMode = 'OFF', now = new Date()) {
  return travelLegs
    .filter((leg) => isRecordId(leg.fromRequestId) && isRecordId(leg.toRequestId) && (
      leg.minutes === null
      || (routesMinutes[leg.key] === leg.minutes
        && travelLegStaleReason(leg, travelDetails[leg.key], trafficMode, now) !== null)
    ))
    .map((leg) => ({
      fromRequestId: Number(leg.fromRequestId),
      toRequestId: Number(leg.toRequestId),
      ...(leg.departureAt ? { departureAt: leg.departureAt } : {}),
    }))
}

// Fills blank legs and replaces Google values; a typed value always stays.
export function applyTravelEstimates(values, results = [], routesMinutes = {}) {
  const travelMinutes = { ...(values.travelMinutes ?? {}) }
  for (const result of results) {
    const key = travelLegKey(result.fromRequestId, result.toRequestId)
    if (!Number.isInteger(result.minutes)) continue
    const current = travelMinutes[key]
    if (current === undefined || routesMinutes[key] === current) travelMinutes[key] = result.minutes
  }
  return { ...values, travelMinutes }
}

// Minutes Google returned, by leg key, so the planner can label them until edited.
export function routesMinutesByLeg(results = []) {
  return Object.fromEntries(results
    .filter((result) => result.source === 'ROUTES_API' && Number.isInteger(result.minutes))
    .map((result) => [travelLegKey(result.fromRequestId, result.toRequestId), result.minutes]))
}

// Traffic details returned with Google values, by leg key.
export function travelDetailsByLeg(results = []) {
  return Object.fromEntries(results
    .filter((result) => result.source === 'ROUTES_API' && Number.isInteger(result.minutes))
    .map((result) => [travelLegKey(result.fromRequestId, result.toRequestId), {
      staticMinutes: result.staticMinutes ?? null,
      trafficModel: result.trafficModel ?? null,
      trafficDepartureAt: result.trafficDepartureAt ?? null,
    }]))
}

// Warnings to show: legs Google could not fill, and moved legs Google could not
// refresh (the server keeps their saved minutes and returns them as STORED).
export function travelEstimateMessages(results = []) {
  return results
    .filter((result) => result.message && (result.minutes === null || result.status === 'STORED'))
    .map((result) => result.message)
}

// 'ROUTES_API' while the field still holds the Google value, 'MANUAL' once typed.
export function travelLegSource(key, travelMinutes = {}, routesMinutes = {}) {
  const minutes = travelMinutes[key]
  if (minutes === undefined || minutes === null) return null
  return routesMinutes[key] === minutes ? 'ROUTES_API' : 'MANUAL'
}

// Text under a leg. Shows the traffic time and the minutes without traffic when the
// Google value used traffic.
export function travelLegHelperText({ leg, source, details, trafficMode = 'OFF', now = new Date() }) {
  const names = leg.technicianNames.join(', ')
  if (leg.minutes === null) return `Travel time pending · ${names}`
  if (source !== 'ROUTES_API') return `Manual estimate · ${names}`
  const staleReason = travelLegStaleReason(leg, details, trafficMode, now)
  if (staleReason === 'TRAFFIC_SETTING') return `Traffic setting changed: calculate again · ${names}`
  if (staleReason === 'DEPARTURE') return `Departure moved: calculate again · ${names}`
  if (details?.trafficModel && details.trafficDepartureAt && Number.isInteger(details.staticMinutes)) {
    return `Google Maps with traffic at ${formatDepartureTime(details.trafficDepartureAt)} · ${details.staticMinutes} min without traffic · ${names}`
  }
  return `Google Maps driving estimate · ${names}`
}
