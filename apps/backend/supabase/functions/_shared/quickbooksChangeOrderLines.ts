// The QuickBooks invoice lines of an Extra / Change Order, read as the work it is.
//
// Pure: it receives the lines of the Change Order and returns one invoice line for each piece of work,
// already described, with Qty 1 and its total as the Rate:
//
//   PLAN 1 (WIDER DOOR) $27.00 PER LOT (PHASE 2 LOTS #10-11, 16-17)
//
// The Lots with the same Plan, Scope of Work and price go together; a Lot with another price, another
// Scope or another Plan goes on a line of its own. The Plan is only named (and only separates Lots) when
// the Change Order is about Plans: one that covers Specific plan types, or one made from a Package for
// them. Any other names the work alone: "REPLACE DOOR TRIM $498.29 PER LOT (PHASE 1 LOT #7)". The Phase is always named, because Lot numbers repeat
// between Phases ("PHASE 2 LOTS #10-11; PHASE 3 LOT #4"). A line without a Lot is its place and its
// Scope: "SALES OFFICE (ELECTRONIC LOCKS)". When the Change Order has the Builder's PO / CO #, every line
// ends with " - 9167 CHANGE ORDER". Everything is in capitals, like the lines of a Package.

import { formatLotRanges } from './quickbooksInvoice.ts'

type Numeric = number | string

export interface ChangeOrderLineRow {
  line_number: number
  lot_id: number | null
  phase_code: string | null
  building: string | null
  lot_number: string | null
  plan_code: string | null
  location: string | null
  scope_of_work: string
  amount: Numeric
}

export interface ChangeOrderInvoiceLine {
  description: string
  /** Dollars; the total of the line (its price per Lot times its Lots). */
  amount: number
}

const naturalCompare = (left: string, right: string) =>
  left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' })

function cents(value: Numeric, field: string) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) throw new Error(`${field} is not a number.`)
  return Math.round(amount * 100)
}

/** One line of text: line breaks and runs of spaces become one space. */
function oneLine(text: string | null | undefined) {
  return String(text ?? '').replace(/\s+/gu, ' ').trim()
}

/** $1,250.00, or -$20.00 for a credit. */
export function formatMoney(centsValue: number) {
  const sign = centsValue < 0 ? '-' : ''
  const dollars = (Math.abs(centsValue) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${sign}$${dollars}`
}

// "Phase 3" and "3" are the same Phase.
const phaseCodeOf = (phaseCode: string) => phaseCode.trim().replace(/^phase\s+/iu, '')

function phaseText(phaseCode: string) {
  return `PHASE ${phaseCodeOf(phaseCode)}`
}

/** "PHASE 2 LOTS #10-11, 16-17; PHASE 3 LOT #4": the Lots of each Phase, the Phases in order. */
export function lotsText(lots: { phase: string; lot: string }[]) {
  const byPhase = new Map<string, string[]>()
  for (const { phase, lot } of lots) {
    const code = phaseCodeOf(phase)
    if (!byPhase.has(code)) byPhase.set(code, [])
    byPhase.get(code)?.push(lot)
  }
  return [...byPhase.entries()]
    .sort(([left], [right]) => naturalCompare(left, right))
    .map(([phase, phaseLots]) => {
      const unique = new Set(phaseLots.map((lot) => lot.trim()))
      return `${phaseText(phase)} ${unique.size > 1 ? 'LOTS' : 'LOT'} #${formatLotRanges(phaseLots)}`
    })
    .join('; ')
}

interface WorkGroup {
  plan: string
  scope: string
  unitCents: number
  lots: { phase: string; lot: string }[]
}

/**
 * The invoice lines of a Change Order: its Lots by Plan, Scope of Work and price (in that order), then its
 * lines without a Lot in the order they were saved. `poCoNumber` is the Builder's PO / CO #, if written;
 * `byPlan` says whether the Change Order is about Plans (the Plan is named and separates the Lots).
 */
export function changeOrderInvoiceLines(
  rows: ChangeOrderLineRow[],
  { poCoNumber = null, byPlan = true }: { poCoNumber?: string | null; byPlan?: boolean } = {},
): ChangeOrderInvoiceLine[] {
  const po = oneLine(poCoNumber)
  const suffix = po ? ` - ${po} CHANGE ORDER` : ''
  const finish = (text: string) => `${text}${suffix}`.toUpperCase()

  const groups = new Map<string, WorkGroup>()
  const places: ChangeOrderInvoiceLine[] = []
  const ordered = [...rows].sort((left, right) => left.line_number - right.line_number)

  for (const row of ordered) {
    const amountCents = cents(row.amount, `Line ${row.line_number} amount`)
    const scope = oneLine(row.scope_of_work)

    if (row.lot_id === null || row.lot_id === undefined) {
      places.push({ description: finish(`${oneLine(row.location)} (${scope})`), amount: amountCents / 100 })
      continue
    }

    const plan = byPlan ? oneLine(row.plan_code) : ''
    const key = JSON.stringify([plan.toUpperCase(), scope.toUpperCase(), amountCents])
    if (!groups.has(key)) groups.set(key, { plan, scope, unitCents: amountCents, lots: [] })
    groups.get(key)?.lots.push({ phase: oneLine(row.phase_code), lot: oneLine(row.lot_number) })
  }

  const work = [...groups.values()]
    .sort((left, right) =>
      naturalCompare(left.plan, right.plan)
      || naturalCompare(left.scope, right.scope)
      || left.unitCents - right.unitCents
    )
    .map((group) => ({
      description: finish(
        byPlan
          ? `PLAN ${group.plan} (${group.scope}) ${formatMoney(group.unitCents)} PER LOT (${lotsText(group.lots)})`
          : `${group.scope} ${formatMoney(group.unitCents)} PER LOT (${lotsText(group.lots)})`,
      ),
      amount: (group.unitCents * group.lots.length) / 100,
    }))

  return [...work, ...places]
}
