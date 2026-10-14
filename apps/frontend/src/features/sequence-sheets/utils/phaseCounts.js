export function getPhaseRowCounts(phase) {
  return (phase?.lots ?? []).reduce((counts, row) => {
    if (row.isUtilityBuilding) counts.utility += 1
    else counts.lots += 1
    return counts
  }, { lots: 0, utility: 0 })
}

export function getSelectedOptionCount(phase) {
  return (phase?.lots ?? []).reduce(
    (total, lot) => total + (lot.optionIds?.length ?? 0),
    0,
  )
}
