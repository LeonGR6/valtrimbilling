// Lots that had an Extra / CO before they existed. A line without a Lot of an Extra / CO can name Lots the
// Job does not have yet ("Lot 91"); when a Sequence Sheet adds them later, the people there are told that
// those Lots already had one. Nothing is stored apart from the line itself (its Job and place text): what
// Lot a place names is read from the text each time, so changing the text changes it too.

import { lotNumbersInPlace } from './coverage.js'

/** "014" and "14" are the same Lot; "12a" and "12A" too. */
export const lotKey = (lotNumber) => {
  const text = String(lotNumber ?? '').trim().toUpperCase()
  return /^\d+$/.test(text) ? String(Number(text)) : text
}

/**
 * From the lines without a Lot of a Job (`{ changeOrderId, location }`) and its Extras / COs
 * (`{ id, number, status }`), what each Lot number had: `Map<lotKey, [{ changeOrderId, number, status,
 * location }]>`. A cancelled Extra / CO does not count, and the same Extra / CO is listed once per Lot.
 */
export function priorChangeOrdersByLot(placeLines, changeOrders) {
  const byId = new Map(changeOrders.map((order) => [String(order.id), order]))
  const byLot = new Map()

  for (const line of placeLines) {
    const order = byId.get(String(line.changeOrderId))
    if (!order || order.status === 'CANCELLED') continue
    for (const number of lotNumbersInPlace(line.location)) {
      const key = lotKey(number)
      const list = byLot.get(key) ?? []
      if (!list.some((item) => item.changeOrderId === order.id)) {
        list.push({ changeOrderId: order.id, number: order.number, status: order.status, location: line.location })
      }
      byLot.set(key, list)
    }
  }
  return byLot
}

/**
 * The Lots among `lotNumbers` that had an Extra / CO, in the order given and once each:
 * `[{ lot: '91', orders: [{ changeOrderId, number, status, location }] }]`.
 */
export function lotsWithPriorChangeOrders(lotNumbers, byLot) {
  const seen = new Set()
  const found = []
  for (const lot of lotNumbers) {
    const key = lotKey(lot)
    if (!key || seen.has(key) || !byLot.has(key)) continue
    seen.add(key)
    found.push({ lot: String(lot).trim(), orders: byLot.get(key) })
  }
  return found
}
