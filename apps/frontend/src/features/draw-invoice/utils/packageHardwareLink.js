import { hardwareChargeKey } from './drawPackages.js'
import { getHardwareBillingMode, getHardwareEventPercentage } from './drawWorksheet.js'

// A Separate Hardware portion belongs to a Lot and an event (EXT, DM, HW). In the
// create dialog, selecting that Lot's Draw of the event brings the portion along and
// clearing the Draw takes it out; the portion can still be changed on its own.

const cellKey = ({ phaseId, lotId, drawIndex }) => `${phaseId}:${lotId}:${drawIndex}`

/** The Hardware charge a Lot Draw cell brings along, or null when its Draw carries none. */
export function hardwareChargeKeyOfCell(schedule, { lotId, drawIndex }) {
  if (getHardwareBillingMode(schedule) !== 'BY_EVENT') return null

  const eventType = schedule?.draws?.[drawIndex]?.eventType
  if (getHardwareEventPercentage(schedule, eventType) <= 0) return null
  return hardwareChargeKey(lotId, 'BY_EVENT', eventType)
}

/**
 * The chosen Hardware charges after the selected cells go from `previousCells` to
 * `nextCells`. A cell that is added chooses its charge, unless an earlier Package
 * already billed it; a cell that is removed clears its charge, unless another
 * selected cell of the same Lot and event still carries it. Charges of cells that
 * did not change stay as they are, so a portion chosen by hand is only touched when
 * its Draw is.
 */
export function hardwareChargesAfterCellChange({
  schedule,
  chargeKeys,
  previousCells,
  nextCells,
  billedChargeKeys,
}) {
  const before = new Set(previousCells.map(cellKey))
  const after = new Set(nextCells.map(cellKey))
  const carried = new Set(nextCells.map((cell) => hardwareChargeKeyOfCell(schedule, cell)))
  const next = new Set(chargeKeys)

  for (const cell of previousCells) {
    const key = hardwareChargeKeyOfCell(schedule, cell)
    if (key && !after.has(cellKey(cell)) && !carried.has(key)) next.delete(key)
  }
  for (const cell of nextCells) {
    const key = hardwareChargeKeyOfCell(schedule, cell)
    if (key && !before.has(cellKey(cell)) && !billedChargeKeys.has(key)) next.add(key)
  }

  return [...next]
}
