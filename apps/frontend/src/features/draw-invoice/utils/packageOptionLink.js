import { getOptionsBillingDrawIndex, isAtOrAfterOptionsBillingDraw } from './drawPackages.js'

// A Lot's Options are billed once the Lot reaches the Options billing Draw: with a
// cell of that Draw or a later one. In the create dialog, selecting such a cell
// selects the Lot's Options and clearing the last one clears them; each Option can
// still be changed on its own.

/** The Lots (as "phaseId:lotId") that have a selected cell at or after the Options billing Draw. */
function reachedLots(cells, optionsBillingDrawIndex) {
  return new Map(cells
    .filter(({ drawIndex }) => isAtOrAfterOptionsBillingDraw(drawIndex, optionsBillingDrawIndex))
    .map(({ phaseId, lotId }) => [`${phaseId}:${lotId}`, { phaseId, lotId }]))
}

/**
 * The excluded Option keys after the selected cells go from `previousCells` to
 * `nextCells`. A Lot that reaches the Options billing Draw gets all its Options
 * back (none excluded); a Lot that no longer reaches it has all of them excluded.
 * Lots whose reach did not change keep what was chosen by hand.
 *
 * `optionKeysOfLot(phaseId, lotId)` lists the selection keys of the Lot's Options.
 */
export function excludedOptionsAfterCellChange({
  schedule,
  excludedKeys,
  previousCells,
  nextCells,
  optionKeysOfLot,
}) {
  const optionsBillingDrawIndex = getOptionsBillingDrawIndex(null, schedule)
  if (optionsBillingDrawIndex === null) return excludedKeys

  const before = reachedLots(previousCells, optionsBillingDrawIndex)
  const after = reachedLots(nextCells, optionsBillingDrawIndex)
  const next = new Set(excludedKeys)

  for (const [key, { phaseId, lotId }] of after) {
    if (!before.has(key)) optionKeysOfLot(phaseId, lotId).forEach((option) => next.delete(option))
  }
  for (const [key, { phaseId, lotId }] of before) {
    if (!after.has(key)) optionKeysOfLot(phaseId, lotId).forEach((option) => next.add(option))
  }

  return [...next]
}

/**
 * The excluded Option keys after all of `optionKeys` are included or excluded at once, from the
 * check in the "Include" column. Options that are not in `optionKeys` keep what was chosen.
 */
export function excludedOptionsAfterBulkChoice({ excludedKeys, optionKeys, included }) {
  const chosen = new Set(optionKeys)
  return included
    ? excludedKeys.filter((key) => !chosen.has(key))
    : [...new Set([...excludedKeys, ...optionKeys])]
}

/**
 * The state of the check that includes or excludes all the Options in the table: checked when
 * every one is included, empty when none is, and in between otherwise. Nothing to choose has no check.
 */
export function bulkOptionCheck(optionKeys, includedKeys) {
  const included = optionKeys.filter((key) => includedKeys.has(key)).length
  return {
    visible: optionKeys.length > 0,
    checked: optionKeys.length > 0 && included === optionKeys.length,
    indeterminate: included > 0 && included < optionKeys.length,
  }
}
