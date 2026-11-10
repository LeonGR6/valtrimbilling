// The QuickBooks invoice lines of an Extra / Change Order, for the preview on its page.
//
// The same rules as the Edge Function that sends it (backend/supabase/functions/_shared/
// quickbooksChangeOrderLines.ts); tests/change-order-invoice-lines.test.mjs holds the same cases as its
// Deno tests, so a change in one is a change in the other:
//
//   PLAN 1 (WIDER DOOR) $27.00 PER LOT (PHASE 2 LOTS #10-11, 16-17)
//
// Lots with the same Plan, Scope of Work and price go together; the Phase is always named; a line without
// a Lot is its place and its Scope; the Builder's PO / CO # ends every line; everything in capitals.
// The Plan is only named (and only separates Lots) when the Extra / CO is about Plans (`byPlan`): one that
// covers Specific plan types, or one made from a Package for them. Any other names the work alone:
//
//   REPLACE DOOR TRIM $498.29 PER LOT (PHASE 1 LOT #7)

const naturalCompare = (left, right) => left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' })

const WHOLE_LOT = /^\d+$/u
const NUMBERED_LOT = /^\d+(?:\.\d+)?$/u

/**
 * "97, 98, 99, 102, 12A" -> "97-99, 102, 12A". Only whole Lots run together: 12, 12.1 and 13 stay
 * "12, 12.1, 13". The same as the invoice of a Package.
 */
export function formatInvoiceLotRanges(lotNumbers) {
  const unique = [...new Set(lotNumbers.map((lot) => String(lot).trim()))]
  const numeric = unique
    .filter((lot) => NUMBERED_LOT.test(lot))
    .map((lot) => ({ lot, value: Number(lot) }))
    .sort((left, right) => left.value - right.value || naturalCompare(left.lot, right.lot))
  const other = unique.filter((lot) => !NUMBERED_LOT.test(lot)).sort(naturalCompare)
  const written = (entry) => (WHOLE_LOT.test(entry.lot) ? `${entry.value}` : entry.lot)

  const parts = []
  for (let index = 0; index < numeric.length;) {
    let end = index
    while (
      end + 1 < numeric.length
      && WHOLE_LOT.test(numeric[end].lot) && WHOLE_LOT.test(numeric[end + 1].lot)
      && numeric[end + 1].value === numeric[end].value + 1
    ) end += 1
    parts.push(end > index ? `${written(numeric[index])}-${written(numeric[end])}` : written(numeric[index]))
    index = end + 1
  }
  return [...parts, ...other].join(', ')
}

const oneLine = (text) => String(text ?? '').replace(/\s+/gu, ' ').trim()
const phaseCodeOf = (phaseCode) => String(phaseCode ?? '').trim().replace(/^phase\s+/iu, '')

/** $1,250.00, or -$20.00 for a credit. */
export function formatInvoiceMoney(cents) {
  const sign = cents < 0 ? '-' : ''
  const dollars = (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${sign}$${dollars}`
}

/** "PHASE 2 LOTS #10-11, 16-17; PHASE 3 LOT #4". */
export function invoiceLotsText(lots) {
  const byPhase = new Map()
  for (const { phase, lot } of lots) {
    const code = phaseCodeOf(phase)
    if (!byPhase.has(code)) byPhase.set(code, [])
    byPhase.get(code).push(lot)
  }
  return [...byPhase.entries()]
    .sort(([left], [right]) => naturalCompare(left, right))
    .map(([phase, phaseLots]) => {
      const unique = new Set(phaseLots.map((lot) => String(lot).trim()))
      return `PHASE ${phase} ${unique.size > 1 ? 'LOTS' : 'LOT'} #${formatInvoiceLotRanges(phaseLots)}`
    })
    .join('; ')
}

/**
 * The invoice lines of an Extra / CO (`lines` as `toChangeOrderLine` reads them), each with Qty 1 and its
 * total as the Rate: `{ description, amount }`, the Lots first (by Plan, Scope and price), then the lines
 * without a Lot in their order. `poCoNumber` is the Builder's PO / CO #, if written.
 */
export function changeOrderInvoiceLines(lines, { poCoNumber = '', byPlan = true } = {}) {
  const po = oneLine(poCoNumber)
  const finish = (text) => `${text}${po ? ` - ${po} CHANGE ORDER` : ''}`.toUpperCase()
  const groups = new Map()
  const places = []

  for (const line of [...lines].sort((left, right) => left.lineNumber - right.lineNumber)) {
    const cents = Math.round(Number(line.amount) * 100)
    const scope = oneLine(line.scope)
    if (line.isPlace) {
      places.push({ description: finish(`${oneLine(line.location)} (${scope})`), amount: cents / 100 })
      continue
    }
    const plan = byPlan ? oneLine(line.plan) : ''
    const key = JSON.stringify([plan.toUpperCase(), scope.toUpperCase(), cents])
    if (!groups.has(key)) groups.set(key, { plan, scope, unitCents: cents, lots: [] })
    groups.get(key).lots.push({ phase: oneLine(line.phase), lot: oneLine(line.lot) })
  }

  const work = [...groups.values()]
    .sort((left, right) => naturalCompare(left.plan, right.plan)
      || naturalCompare(left.scope, right.scope)
      || left.unitCents - right.unitCents)
    .map((group) => ({
      description: finish(byPlan
        ? `PLAN ${group.plan} (${group.scope}) ${formatInvoiceMoney(group.unitCents)} PER LOT (${invoiceLotsText(group.lots)})`
        : `${group.scope} ${formatInvoiceMoney(group.unitCents)} PER LOT (${invoiceLotsText(group.lots)})`),
      amount: (group.unitCents * group.lots.length) / 100,
    }))

  return [...work, ...places]
}

/** Whether the Plan belongs on the invoice: the Extra / CO covers Specific plan types, or was made from a Package for one. */
export function invoiceIsByPlan(order) {
  return order?.coverage?.mode === 'plans' || Boolean(order?.fromPackage)
}

/** What the lines add up to, in cents so it is exact. */
export function invoiceLinesTotal(invoiceLines) {
  return invoiceLines.reduce((sum, line) => sum + Math.round(line.amount * 100), 0) / 100
}
