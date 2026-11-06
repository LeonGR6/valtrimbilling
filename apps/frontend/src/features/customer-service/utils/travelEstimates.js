// Planner helpers for travel minutes calculated with Google Routes API by the
// customer-service-travel-estimates Edge Function. Results only fill empty legs:
// a value the coordinator typed is never replaced, and a failure stays blank.
import { travelLegKey } from './customerServiceScheduling.js'

const isRecordId = (id) => /^\d+$/u.test(String(id))

// Legs without minutes that belong to saved requests (the only ones with coordinates).
export function travelLegsToEstimate(travelLegs = []) {
  return travelLegs
    .filter((leg) => leg.minutes === null && isRecordId(leg.fromRequestId) && isRecordId(leg.toRequestId))
    .map((leg) => ({ fromRequestId: Number(leg.fromRequestId), toRequestId: Number(leg.toRequestId) }))
}

export function applyTravelEstimates(values, results = []) {
  const travelMinutes = { ...(values.travelMinutes ?? {}) }
  for (const result of results) {
    const key = travelLegKey(result.fromRequestId, result.toRequestId)
    if (Number.isInteger(result.minutes) && travelMinutes[key] === undefined) travelMinutes[key] = result.minutes
  }
  return { ...values, travelMinutes }
}

// Minutes Google returned, by leg key, so the planner can label them until edited.
export function routesMinutesByLeg(results = []) {
  return Object.fromEntries(results
    .filter((result) => result.source === 'ROUTES_API' && Number.isInteger(result.minutes))
    .map((result) => [travelLegKey(result.fromRequestId, result.toRequestId), result.minutes]))
}

export function travelEstimateMessages(results = []) {
  return results.filter((result) => result.minutes === null && result.message).map((result) => result.message)
}

// 'ROUTES_API' while the field still holds the Google value, 'MANUAL' once typed.
export function travelLegSource(key, travelMinutes = {}, routesMinutes = {}) {
  const minutes = travelMinutes[key]
  if (minutes === undefined || minutes === null) return null
  return routesMinutes[key] === minutes ? 'ROUTES_API' : 'MANUAL'
}
