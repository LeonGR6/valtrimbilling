// The price changes a new Package can collect: pending differences of earlier Packages whose Phases
// changed price after they were invoiced. Each one chosen goes on the invoice of the Package that
// bills its Phase, as a row of its own.

const naturalCompare = (left, right) => String(left).localeCompare(String(right), 'en', {
  numeric: true,
  sensitivity: 'base',
})

const addMoney = (left, right) => Math.round((left + right) * 100) / 100

/**
 * The pending differences of the Phases the Package bills, in reading order. A difference of
 * another Phase is not offered: the Package is the invoice of the Phases it bills.
 *
 * @param differences the pending differences of the Job (`toPriceDifference`)
 * @param phaseIds    the Phases with something selected to bill
 */
export function priceChangeRows(differences = [], phaseIds = new Set()) {
  return differences
    .filter((difference) => difference.phaseId != null && phaseIds.has(String(difference.phaseId)))
    .sort((left, right) => (
      naturalCompare(left.phaseCode, right.phaseCode)
      || naturalCompare(left.building, right.building)
      || naturalCompare(left.lotNumber, right.lotNumber)
      || (left.drawNumber ?? 0) - (right.drawNumber ?? 0)
      || naturalCompare(left.hardwareEventType ?? '', right.hardwareEventType ?? '')
      || left.id - right.id
    ))
}

/** The totals of the rows chosen, in cents so a long list never drifts from the database. */
export function priceChangeTotals(rows = []) {
  return rows.reduce(
    (total, row) => ({
      gross: addMoney(total.gross, row.gross),
      retention: addMoney(total.retention, row.retention),
      wrap: addMoney(total.wrap, row.wrap),
      net: addMoney(total.net, row.net),
      count: total.count + 1,
    }),
    { gross: 0, retention: 0, wrap: 0, net: 0, count: 0 },
  )
}

/**
 * Why the chosen price changes cannot go on the Package, or null when they can. An invoice cannot
 * be empty or negative, and Retention and WRAP are deducted lines that cannot turn into additions:
 * credits can only reduce what the Package bills.
 *
 * @param billed `{ gross, retention, wrap, net }` the Package bills without the price changes
 */
export function priceChangeIssue(billed, totals) {
  if (totals.count === 0) return null

  if (
    addMoney(Number(billed.net) || 0, totals.net) <= 0
    || addMoney(Number(billed.gross) || 0, totals.gross) < 0
    || addMoney(Number(billed.retention) || 0, totals.retention) < 0
    || addMoney(Number(billed.wrap) || 0, totals.wrap) < 0
  ) {
    return 'The price changes chosen are credits larger than what this Package bills, so it would invoice nothing. Choose fewer of them, or bill more in this Package.'
  }
  return null
}

/** Where a price change was billed: "Draw 1" or "Hardware EXT". */
export function priceChangeLabel(row) {
  return row.kind === 'HARDWARE_EVENT'
    ? `Hardware ${row.hardwareEventType ?? ''}`.trim()
    : `Draw ${row.drawNumber}`
}
