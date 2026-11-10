// What a Package about to be created would charge to the "Specific Plan Types" Extras / COs: the Lots it
// bills that a rule has not charged yet. The charge is not part of the Package: each Package makes an
// Extra / CO of its own for them.

/**
 * The Lots the Packages about to be created bill, as ids in text, once each and sorted: the Lots of the
 * Draw cells and of the Options (`packages` as `planCreatedPackages` gives them, `{ input }`).
 */
export function packageLotIds(packages = []) {
  const ids = new Set()
  for (const { input = {} } of packages) {
    for (const selection of input.selections ?? []) {
      if (selection.lotId !== null && selection.lotId !== undefined) ids.add(String(selection.lotId))
    }
    for (const option of input.optionSelections ?? []) {
      if (option.lotId !== null && option.lotId !== undefined) ids.add(String(option.lotId))
    }
  }
  return [...ids].sort((left, right) => Number(left) - Number(right))
}

/** A row of `package_change_order_preview`. */
export function toPackageChargeRow(row) {
  return {
    sourceId: row.source_change_order_id,
    sourceNumber: row.source_change_order_number ?? '',
    sourceInternalNumber: row.source_internal_number ?? '',
    sourcePoCoNumber: row.source_po_co_number ?? '',
    lotId: String(row.lot_id),
    phase: row.phase_code ?? '',
    building: row.building ?? '',
    lot: row.lot_number ?? '',
    plan: row.plan_code ?? '',
    planName: row.plan_name ?? '',
    scope: row.scope_of_work ?? '',
    amount: Number(row.amount ?? 0),
  }
}

/**
 * The rows by the Extra / CO they charge for, in the order they came, each with its total; and the total of
 * all of them (summed in cents, so it is exact).
 */
export function groupPackageCharges(rows = []) {
  const bySource = new Map()
  for (const row of rows) {
    if (!bySource.has(row.sourceId)) {
      bySource.set(row.sourceId, {
        sourceId: row.sourceId,
        number: row.sourceNumber,
        poCoNumber: row.sourcePoCoNumber,
        rows: [],
        cents: 0,
      })
    }
    const group = bySource.get(row.sourceId)
    group.rows.push(row)
    group.cents += Math.round(row.amount * 100)
  }

  const groups = [...bySource.values()].map(({ cents, ...group }) => ({ ...group, total: cents / 100 }))
  const cents = groups.reduce((sum, group) => sum + Math.round(group.total * 100), 0)
  return { groups, lots: rows.length, total: cents / 100 }
}
