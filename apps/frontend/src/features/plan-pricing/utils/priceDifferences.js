// Pending price differences: what Packages that cannot change (QuickBooks invoice,
// sent or paid) would have billed at the new price of their Phases, next to what
// they billed. The Package keeps its amount; this is only what is left to collect.

const WORKFLOW_LABELS = {
  DRAFT: 'Draft',
  READY_TO_SUBMIT: 'Draft',
  AWAITING_PAYMENT: 'Awaiting payment',
  PAID_CLOSED: 'Paid',
}

export function workflowStatusLabel(status) {
  return WORKFLOW_LABELS[status] ?? 'Package'
}

function money(value) {
  return value == null ? 0 : Number(value)
}

/** Cents, so a long list of differences never drifts from the database totals. */
function addMoney(left, right) {
  return Math.round((left + right) * 100) / 100
}

export function toPriceDifference(row) {
  const isHardware = row.line_kind === 'HARDWARE_EVENT'

  return {
    id: Number(row.id),
    packageId: Number(row.package_id),
    packageNumber: row.package_number,
    recalculationId: Number(row.recalculation_id),
    kind: row.line_kind,
    lotId: Number(row.lot_id),
    phaseId: row.phase_id == null ? null : Number(row.phase_id),
    phaseCode: row.phase_code,
    building: row.building ?? '',
    lotNumber: row.lot_number,
    planCode: row.plan_code,
    drawNumber: row.draw_number == null ? null : Number(row.draw_number),
    hardwareEventType: row.hardware_event_type ?? null,
    label: isHardware
      ? `Lot ${row.lot_number} · Hardware ${row.hardware_event_type}`
      : `Lot ${row.lot_number} · Draw ${row.draw_number}`,
    phaseLabel: row.building ? `${row.phase_code} · ${row.building}` : String(row.phase_code),
    billedGross: money(row.billed_gross),
    newGross: money(row.new_gross),
    billedNet: money(row.billed_net),
    newNet: money(row.new_net),
    base: money(row.delta_base),
    hardware: money(row.delta_hardware),
    utility: money(row.delta_utility),
    options: money(row.delta_options),
    gross: money(row.delta_gross),
    retention: money(row.delta_retention),
    wrap: money(row.delta_wrap),
    net: money(row.delta_net),
    createdAt: row.created_at,
  }
}

function emptyTotals() {
  return { gross: 0, retention: 0, wrap: 0, net: 0, lineCount: 0 }
}

function addToTotals(totals, line) {
  return {
    gross: addMoney(totals.gross, line.gross),
    retention: addMoney(totals.retention, line.retention),
    wrap: addMoney(totals.wrap, line.wrap),
    net: addMoney(totals.net, line.net),
    lineCount: totals.lineCount + 1,
  }
}

/**
 * The pending differences by Package, each with its totals and lines, and the
 * grand total. `statuses` is a Map of package id to workflow status.
 */
export function groupPriceDifferences(rows = [], statuses = new Map()) {
  const lines = rows.map(toPriceDifference)
  const byPackage = new Map()

  lines.forEach((line) => {
    const current = byPackage.get(line.packageId) ?? {
      packageId: line.packageId,
      packageNumber: line.packageNumber,
      status: statuses.get(line.packageId) ?? null,
      totals: emptyTotals(),
      lines: [],
    }
    current.totals = addToTotals(current.totals, line)
    current.lines.push(line)
    byPackage.set(line.packageId, current)
  })

  const packages = [...byPackage.values()].sort(
    (left, right) => left.packageId - right.packageId,
  )

  return {
    packages,
    totals: packages.reduce(
      (total, item) => ({
        gross: addMoney(total.gross, item.totals.gross),
        retention: addMoney(total.retention, item.totals.retention),
        wrap: addMoney(total.wrap, item.totals.wrap),
        net: addMoney(total.net, item.totals.net),
        lineCount: total.lineCount + item.totals.lineCount,
      }),
      emptyTotals(),
    ),
  }
}

const signedFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  signDisplay: 'exceptZero',
})

/** +$100.00 when the Builder owes more, −$100.00 when it is a credit. */
export function formatSignedMoney(value) {
  return signedFormatter.format(value)
}

/** The components of a line's difference that are not zero, in reading order. */
export function differenceComponents(line) {
  return [
    ['Plan price', line.base],
    ['Hardware', line.hardware],
    ['Utility', line.utility],
    ['Options', line.options],
  ].filter(([, amount]) => amount !== 0)
}

/** The totals of the chosen Packages, which is what a Price Adjustment would invoice. */
export function selectedDifferenceTotals(packages = [], selectedPackageIds = []) {
  const selected = new Set(selectedPackageIds)

  return packages
    .filter((item) => selected.has(item.packageId))
    .reduce(
      (total, item) => ({
        gross: addMoney(total.gross, item.totals.gross),
        retention: addMoney(total.retention, item.totals.retention),
        wrap: addMoney(total.wrap, item.totals.wrap),
        net: addMoney(total.net, item.totals.net),
        lineCount: total.lineCount + item.totals.lineCount,
      }),
      emptyTotals(),
    )
}

/**
 * Why the chosen differences cannot be invoiced, or null when they can. An invoice
 * cannot be negative: the total, and the gross, Retention and WRAP on their own,
 * must each be positive once credits and charges are added up.
 */
export function adjustmentIssue(totals) {
  if (totals.lineCount === 0) return 'Choose at least one Package.'
  if (totals.net <= 0) {
    return totals.net === 0
      ? 'The chosen differences add up to nothing, so there is nothing to invoice.'
      : 'The chosen differences add up to a credit, so there is nothing to invoice. Choose Packages with charges too, or leave this credit pending.'
  }
  if (totals.gross < 0 || totals.retention < 0 || totals.wrap < 0) {
    return 'The chosen differences cannot be invoiced as one amount: their gross, Retention or WRAP add up to a negative amount.'
  }
  return null
}
