// A Phase can hold separate groups of Lots (11–14 and 21–23): the numbers in
// between are not Lots of the Phase. A split division is a From–To range, so
// it is always checked against the Lots the Phase really has, never against a
// continuous run from the first Lot to the last.

export function sortedLotNumbers(lotNumbers = []) {
  return [...new Set((lotNumbers ?? []).map(Number).filter(Number.isFinite))]
    .sort((left, right) => left - right)
}

export function lotsInRange(lotNumbers, lotStart, lotEnd) {
  return sortedLotNumbers(lotNumbers).filter((lot) => (
    lot >= Number(lotStart) && lot <= Number(lotEnd)
  ))
}

// Returns the first problem that keeps the divisions from scheduling every Lot
// of the Phase exactly once, or null when they do.
export function findSplitCoverageProblem(parts, lotNumbers) {
  const lots = sortedLotNumbers(lotNumbers)
  const timesCovered = new Map(lots.map((lot) => [lot, 0]))

  for (const part of parts) {
    if (!(Number(part.lotEnd) >= Number(part.lotStart))) return 'invalid-range'

    const covered = lotsInRange(lots, part.lotStart, part.lotEnd)
    if (covered.length === 0) return 'empty-division'
    covered.forEach((lot) => timesCovered.set(lot, timesCovered.get(lot) + 1))
  }

  return [...timesCovered.values()].every((times) => times === 1) ? null : 'uneven-coverage'
}
