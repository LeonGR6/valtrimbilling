// The elevation of a Lot (A, B, C, ...) is its own attribute, apart from the Plan: "Lot 1, Plan 1, elevation A".
// It only tells Lots apart; nothing that is billed reads it. A Lot with none shows nothing.

export const MAX_ELEVATION_LENGTH = 20

// Offered while typing; any other text is accepted too.
export const ELEVATION_SUGGESTIONS = ['A', 'B', 'C', 'D']

/** The elevation as it is saved: trimmed, upper case, at most 20 characters; '' when there is none. */
export function cleanElevation(value) {
  return String(value ?? '').trim().toUpperCase().slice(0, MAX_ELEVATION_LENGTH)
}

/** "10 · Elev. A": a Plan code with the elevation of the Lot, or the code alone when the Lot has none. */
export function planWithElevation(planCode, elevation) {
  const code = String(planCode ?? '').trim()
  const place = cleanElevation(elevation)
  if (!place) return code
  return code ? `${code} · Elev. ${place}` : `Elev. ${place}`
}
