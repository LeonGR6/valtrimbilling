// The Purchase Orders behind the options a Package charges: which ones go into the Package PDF, and
// which options no Purchase Order backs well (another price, not printed, or no PO for the Lot).
// Nothing here blocks a Package: it only says what is there. Pure: no network, no React.

import {
  buildOptionOrderIndex,
  buildPurchaseOrderBacking,
} from '../../purchase-orders/services/purchaseOrderRecord.js'

// Why an option is not well backed, in the words the screens use. All but `no_po` need a look;
// `no_po` only says the Lot has no Purchase Order uploaded.
export const UNBACKED_STATES = {
  price_differs: { label: 'PO price differs', severity: 3 },
  plan_differs: { label: 'PO plan differs', severity: 2 },
  not_in_po: { label: 'Not in the PO', severity: 1 },
  no_po: { label: 'No PO for this Lot', severity: 0 },
}

/** The options this Package charges now: the ones charged by earlier Packages are not its. */
export function currentPackageOptions(chargedOptionRows = []) {
  return chargedOptionRows.filter((option) => option.chargedInCurrentPackage)
}

/**
 * The options a Purchase Order does not back, with why, most urgent first. Quiet (empty) when the Job
 * has no Purchase Orders at all, so a Job that does not use them is never nagged.
 */
export function findUnbackedOptions(backing, rows) {
  if (!backing?.hasPurchaseOrders) return []

  return rows
    .map((row) => ({ row, ...backing.lookup(row) }))
    .filter(({ state }) => state in UNBACKED_STATES)
    .sort((left, right) => (
      UNBACKED_STATES[right.state].severity - UNBACKED_STATES[left.state].severity
    ))
}

/** One sentence for an option that is not well backed. `formatMoney` writes an amount. */
export function describeUnbackedOption({ row, state, poPrice }, formatMoney) {
  const who = `Lot ${row.lotNumber} · ${row.optionCode}`
  if (state === 'price_differs') {
    const billed = row.priceNotApplicable === true ? 'NA' : formatMoney(Number(row.price))
    return `${who}: the PO prints ${formatMoney(poPrice)} and this Package bills ${billed}.`
  }
  if (state === 'plan_differs') return `${who}: the PO was printed for another Plan than this Lot's.`
  if (state === 'not_in_po') return `${who}: the Lot has a PO, and it does not print this option.`
  return `${who}: no PO has been uploaded for this Lot.`
}

/**
 * The Purchase Orders to join into the Package PDF, and the options they back. An option's order is
 * the newest line that prints it for its Lot; an order that backs several options goes in once,
 * and the orders keep the order of the options (Phase, Lot, option).
 *
 * @param rows the options this Package charges now (see currentPackageOptions)
 * @param lines the comparison lines of the Job's Purchase Orders
 * @param files the PDF of each Purchase Order document, by document id
 */
export function planPackagePurchaseOrders({ rows = [], lines = [], files = {} }) {
  const backing = buildPurchaseOrderBacking(lines)
  const index = buildOptionOrderIndex(lines)
  const orders = new Map()

  for (const row of rows) {
    const [line] = index.linesFor({ lotId: row.lotId, optionId: row.optionId, optionCode: row.optionCode })
    if (!line) continue

    const order = orders.get(line.documentId) ?? {
      documentId: line.documentId,
      file: files[line.documentId] ?? null,
      options: [],
    }
    order.options.push({
      lotNumber: row.lotNumber,
      optionCode: row.optionCode,
      phaseCode: row.phaseCode ?? null,
      building: row.building ?? null,
    })
    orders.set(line.documentId, order)
  }

  const unbacked = findUnbackedOptions(backing, rows)
  return {
    // False when the Job has no Purchase Orders: nothing to add and nothing to warn about.
    usesPurchaseOrders: backing.hasPurchaseOrders,
    optionCount: rows.length,
    orders: [...orders.values()],
    unbacked,
    backedCount: backing.hasPurchaseOrders ? rows.length - unbacked.length : 0,
  }
}

/** The orders whose PDF is available, which are the ones that can be joined. */
export function joinableOrders(plan) {
  return (plan?.orders ?? []).filter((order) => order.file !== null)
}

/** "Lot 22 · 6000, Lot 23 · 6000 and 2 more": the options an order backs, shortened. */
export function describeOrderOptions(order, limit = 4) {
  const names = order.options.map((option) => `Lot ${option.lotNumber} · ${option.optionCode}`)
  if (names.length <= limit) return names.join(', ')
  return `${names.slice(0, limit).join(', ')} and ${names.length - limit} more`
}

/** "2 Purchase Orders": how many go into the PDF. */
export function describePurchaseOrderCount(count) {
  return `${count} Purchase Order${count === 1 ? '' : 's'}`
}
