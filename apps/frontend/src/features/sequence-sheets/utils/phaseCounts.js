import { countOptionUnits } from './optionDetails.js'

export function getPhaseRowCounts(phase) {
  return (phase?.lots ?? []).reduce((counts, row) => {
    if (row.isUtilityBuilding) counts.utility += 1
    else counts.lots += 1
    return counts
  }, { lots: 0, utility: 0 })
}

/** The Options selected in a Phase, counting each unit: an Option with quantity 3 counts three. */
export function getSelectedOptionCount(phase) {
  return (phase?.lots ?? []).reduce(
    (total, lot) => total + countOptionUnits(lot),
    0,
  )
}
