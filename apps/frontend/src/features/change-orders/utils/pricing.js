// An Extra / Change Order is its own order, like a Package: every Lot its
// coverage reaches is a line with its own Scope of Work and Amount. The
// default Scope and Amount fill the lines that were given nothing of their
// own, so the same work is typed once. It never changes the prices the Job
// already has.

/**
 * What is typed in an amount field: digits, one dot and at most 2 decimals, with
 * a minus sign first when the amount is a credit.
 */
export function sanitizePriceInput(text) {
  const raw = String(text)
  const sign = raw.trim().startsWith('-') ? '-' : ''
  const cleaned = raw.replace(/[^\d.]/g, '')
  const [whole, ...rest] = cleaned.split('.')
  if (rest.length === 0) return `${sign}${whole}`
  return `${sign}${whole}.${rest.join('').slice(0, 2)}`
}

/** An amount as a number, or null while it is empty or not a number. */
export function parseAmount(text) {
  const value = Number.parseFloat(text)
  return Number.isFinite(value) ? value : null
}

/**
 * One line per Lot: its Scope of Work and Amount are its own when it has an
 * entry in `lineOverrides` (keyed by Lot id), the defaults otherwise.
 */
export function buildChangeOrderLines(rows, { defaultScope = '', defaultAmount = '', lineOverrides = {} } = {}) {
  return rows.map((row) => {
    const own = lineOverrides[row.lotId] ?? {}
    const ownScope = own.scope !== undefined
    const ownAmount = own.amount !== undefined
    const amountText = ownAmount ? own.amount : defaultAmount

    return {
      ...row,
      scope: ownScope ? own.scope : defaultScope,
      ownScope,
      amountText,
      ownAmount,
      amount: parseAmount(amountText),
    }
  })
}

function withoutField(entry, field) {
  const rest = { ...entry }
  delete rest[field]
  return rest
}

/**
 * The overrides with `field` ('scope' or 'amount') set on every Lot in `lotIds`.
 * A value equal to the default (`defaults[field]`) is not a value of its own: the
 * field goes back to following the default, and a Lot left with nothing is dropped.
 */
export function setLineOverride(overrides, lotIds, field, value, defaults = {}) {
  const next = { ...overrides }
  for (const id of lotIds) {
    const entry = value === defaults[field]
      ? withoutField(next[id], field)
      : { ...next[id], [field]: value }
    if (Object.keys(entry).length === 0) delete next[id]
    else next[id] = entry
  }
  return next
}

/**
 * The overrides without the amounts that mean the same number as the default
 * ("1689.6" and "1689.60"); meant for when the person leaves the field.
 */
export function dropAmountsEqualToDefault(overrides, defaultAmount) {
  const base = parseAmount(defaultAmount)
  const next = {}
  for (const [id, entry] of Object.entries(overrides)) {
    const keep = entry.amount !== undefined && base !== null && parseAmount(entry.amount) === base
      ? withoutField(entry, 'amount')
      : entry
    if (Object.keys(keep).length > 0) next[id] = keep
  }
  return next
}

/** The overrides without the Lots in `lotIds`: they go back to the defaults. */
export function clearLineOverrides(overrides, lotIds) {
  const next = { ...overrides }
  for (const id of lotIds) delete next[id]
  return next
}

// Lines without a Lot -------------------------------------------------------
//
// Some extras are not on a Lot: the Sales Office, a restroom, the Design Center.
// Such a line says where in words and always has a Scope of Work and Amount of
// its own: the defaults are only for Lots. The Lots stay once per order.

/** The lines without a Lot plus a new empty one; its id is above all the others. */
export function addPlaceLine(places) {
  const id = places.reduce((highest, place) => Math.max(highest, place.id), 0) + 1
  return [...places, { id, location: '', scope: '', amount: '' }]
}

/** The lines without a Lot with `changes` ({ location, scope, amount }) on the one with `id`. */
export function updatePlaceLine(places, id, changes) {
  return places.map((place) => (place.id === id ? { ...place, ...changes } : place))
}

/** The lines without a Lot except the one with `id`. */
export function removePlaceLine(places, id) {
  return places.filter((place) => place.id !== id)
}

/** The lines without a Lot with their Amount as a number, or null while it is empty. */
export function buildPlaceLines(places = []) {
  return places.map((place) => ({ ...place, amount: parseAmount(place.amount), amountText: place.amount }))
}

/**
 * What the order adds up to. Amounts are summed in cents so the total is exact.
 * The Lot figures (`lots`, `priced`, `own`, `min`, `max` ...) are about the Lot
 * lines only; `total` also adds the lines without a Lot, which are counted
 * apart in `places`.
 */
export function summarizeChangeOrderLines(lines, places = []) {
  const amounts = lines.map((line) => line.amount).filter((amount) => amount !== null)
  const placeAmounts = places.map((place) => place.amount).filter((amount) => amount !== null)
  const cents = [...amounts, ...placeAmounts]
    .reduce((sum, amount) => sum + Math.round(amount * 100), 0)

  return {
    lots: lines.length,
    priced: amounts.length,
    unpriced: lines.length - amounts.length,
    withoutScope: lines.filter((line) => !line.scope.trim()).length,
    own: lines.filter((line) => line.ownScope || line.ownAmount).length,
    total: amounts.length + placeAmounts.length > 0 ? cents / 100 : null,
    min: amounts.length > 0 ? Math.min(...amounts) : null,
    max: amounts.length > 0 ? Math.max(...amounts) : null,
    places: {
      count: places.length,
      unnamed: places.filter((place) => !place.location.trim()).length,
      unpriced: places.length - placeAmounts.length,
      withoutScope: places.filter((place) => !place.scope.trim()).length,
    },
  }
}
