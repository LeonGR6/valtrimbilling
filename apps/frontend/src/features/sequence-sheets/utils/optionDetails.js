// The same Option can be on a Lot more than once: one unit for each place it goes (1st floor, 2nd floor, ...). It
// stays one row per Lot and Option, at one price, with a quantity and the places. A Lot keeps this as
// `optionDetails`, by Option id, and only for the Options that are not just "one unit, no place": an Option
// without an entry is one unit with no location. Pure; the screen is in LotOptionPicker.

export const MAX_OPTION_QUANTITY = 99
export const MAX_LOCATION_LENGTH = 100

function cleanQuantity(value) {
  const number = Math.trunc(Number(value))
  if (!Number.isFinite(number) || number < 1) return 1
  return Math.min(number, MAX_OPTION_QUANTITY)
}

function cleanLocations(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value ?? '').trim().slice(0, MAX_LOCATION_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_OPTION_QUANTITY)
}

/** The quantity and locations of one Option on a Lot; one unit and no place when nothing was set. */
export function detailOf(details, optionId) {
  const raw = details?.[optionId] ?? details?.[String(optionId)]
  const locations = cleanLocations(raw?.locations)
  // The quantity is never below the places that were named.
  const quantity = Math.max(cleanQuantity(raw?.quantity), locations.length)
  return { quantity: Math.min(quantity, MAX_OPTION_QUANTITY), locations }
}

export function isDefaultDetail(detail) {
  return detail.quantity === 1 && detail.locations.length === 0
}

function withDetail(details, optionId, detail) {
  const next = { ...(details ?? {}) }
  delete next[optionId]
  delete next[String(optionId)]
  if (!isDefaultDetail(detail)) next[String(optionId)] = detail
  return next
}

/** The details after setting how many units of an Option; places beyond the new quantity are dropped. */
export function setOptionQuantity(details, optionId, quantity) {
  const wanted = cleanQuantity(quantity)
  const current = detailOf(details, optionId)
  return withDetail(details, optionId, {
    quantity: wanted,
    locations: current.locations.slice(0, wanted),
  })
}

/**
 * The details after naming the places of an Option. The quantity follows the places: one unit for
 * each place named, so adding a place raises it and taking one out lowers it. With no place left
 * it goes back to one unit (the quantity can still be raised afterwards with the stepper).
 */
export function setOptionLocations(details, optionId, locations) {
  const places = cleanLocations(locations)
  return withDetail(details, optionId, {
    quantity: Math.max(1, places.length),
    locations: places,
  })
}

/** The details of the Options still selected; an Option taken out of the Lot loses its quantity and places. */
export function pruneOptionDetails(details, selectedIds) {
  const selected = new Set((selectedIds ?? []).map(String))
  return Object.fromEntries(
    Object.entries(details ?? {}).filter(([optionId]) => selected.has(String(optionId))),
  )
}

/** The units a Lot has of its selected Options: an Option counts as many times as its quantity. */
export function countOptionUnits(lot) {
  return (lot?.optionIds ?? []).reduce(
    (total, optionId) => total + detailOf(lot?.optionDetails, optionId).quantity,
    0,
  )
}

/** What the database receives: only the selected Options that have a quantity above 1 or a place. */
export function optionDetailsPayload(lot) {
  return (lot?.optionIds ?? []).flatMap((optionId) => {
    const detail = detailOf(lot?.optionDetails, optionId)
    return isDefaultDetail(detail)
      ? []
      : [{ option_id: Number(optionId), quantity: detail.quantity, locations: detail.locations }]
  })
}

/** The details of a Lot from its saved rows ({ option_id, quantity, locations }); defaults are left out. */
export function optionDetailsFromRows(rows) {
  return (rows ?? []).reduce((details, row) => {
    const detail = detailOf({ [row.option_id]: row }, row.option_id)
    return isDefaultDetail(detail) ? details : { ...details, [String(row.option_id)]: detail }
  }, {})
}

/** "x3 · 1st floor, 2nd floor" for an Option that has more than one unit or a place; null otherwise. */
export function describeOptionDetail(detail) {
  if (isDefaultDetail(detail)) return null
  const parts = []
  if (detail.quantity > 1) parts.push(`×${detail.quantity}`)
  if (detail.locations.length > 0) parts.push(detail.locations.join(', '))
  return parts.join(' · ')
}
