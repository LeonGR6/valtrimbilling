// Nearby visits for the Proposal Workspace, shared by the browser planner and the
// Edge Functions like the capacity rules. Pure functions only: no Deno, browser or
// database dependency.
//
// Straight-line miles only filter and sort: driving is never shorter than the straight
// line, so a candidate beyond the last band is far without asking Google. The color
// uses real driving miles (decision 7), which the travel Edge Function adds later.

const EARTH_RADIUS_MILES = 3958.8

// Candidates whose driving miles are measured at once (two Route Matrix calls of up
// to this many elements each).
export const maxNearbyDrivingCandidates = 25

const coordinate = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const toRadians = (degrees) => (degrees * Math.PI) / 180

export function hasCoordinates(point) {
  return coordinate(point?.latitude) !== null && coordinate(point?.longitude) !== null
}

// Haversine distance in miles, or null when either point has no coordinates.
export function calculateDistanceMiles(origin, destination) {
  if (!hasCoordinates(origin) || !hasCoordinates(destination)) return null
  const [fromLatitude, fromLongitude, toLatitude, toLongitude] = [
    origin.latitude, origin.longitude, destination.latitude, destination.longitude,
  ].map((value) => toRadians(coordinate(value)))
  const haversine = Math.sin((toLatitude - fromLatitude) / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin((toLongitude - fromLongitude) / 2) ** 2
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

// Distance band from the configured limits (service_scheduling_settings); each limit
// is inclusive. Null when the miles are unknown.
/**
 * @param {number | null} miles
 * @param {{ distanceGreenMaxMiles: number, distanceYellowMaxMiles: number,
 *   distanceOrangeMaxMiles: number }} settings
 */
export function proximityBand(miles, settings) {
  if (!Number.isFinite(miles)) return null
  if (miles <= settings.distanceGreenMaxMiles) return 'GREEN'
  if (miles <= settings.distanceYellowMaxMiles) return 'YELLOW'
  if (miles <= settings.distanceOrangeMaxMiles) return 'ORANGE'
  return 'RED'
}

// Scheduled visits and open requests near the request being planned, nearest first.
// A visit counts only from fromDate through throughDate (YYYY-MM-DD) and never on a
// day the customer marked unavailable. Candidates without coordinates go last with
// miles null. The request itself is never a candidate.
/**
 * @param {{ requestId: string, origin: { latitude: unknown, longitude: unknown },
 *   visits?: Array<{ requestId: string, date: string, start?: string | null }>,
 *   openRequests?: Array<{ requestId: string }>,
 *   fromDate: string, throughDate: string, unavailableDates?: string[] }} input
 */
export function nearbyCandidates({
  requestId, origin, visits = [], openRequests = [], fromDate, throughDate, unavailableDates = [],
}) {
  const blocked = new Set(unavailableDates)
  const other = (entry) => String(entry.requestId) !== String(requestId)
  const withMiles = (kind) => (entry) => ({ ...entry, kind, miles: calculateDistanceMiles(origin, entry) })
  const candidates = [
    ...visits
      .filter((visit) => other(visit) && visit.date >= fromDate && visit.date <= throughDate && !blocked.has(visit.date))
      .map(withMiles('VISIT')),
    ...openRequests.filter(other).map(withMiles('OPEN_REQUEST')),
  ]
  // Nearest first; on equal miles, scheduled visits before open requests, then by day and time.
  const unknown = (entry) => (entry.miles === null ? 1 : 0)
  const open = (entry) => (entry.kind === 'OPEN_REQUEST' ? 1 : 0)
  return candidates.sort((left, right) => unknown(left) - unknown(right)
    || (left.miles ?? 0) - (right.miles ?? 0)
    || open(left) - open(right)
    || String(left.date ?? '').localeCompare(String(right.date ?? ''))
    || String(left.start ?? '').localeCompare(String(right.start ?? '')))
}
