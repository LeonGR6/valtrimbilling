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
// of the Phase exactly once, as `{ problem, index }`, or null when they do.
// `index` is the division that has the problem; it is null when the problem
// belongs to the divisions as a whole (a Lot left out or repeated).
export function findSplitCoverageIssue(parts, lotNumbers) {
  const lots = sortedLotNumbers(lotNumbers)
  const timesCovered = new Map(lots.map((lot) => [lot, 0]))

  for (const [index, part] of parts.entries()) {
    if (!(Number(part.lotEnd) >= Number(part.lotStart))) return { problem: 'invalid-range', index }

    const covered = lotsInRange(lots, part.lotStart, part.lotEnd)
    if (covered.length === 0) return { problem: 'empty-division', index }
    covered.forEach((lot) => timesCovered.set(lot, timesCovered.get(lot) + 1))
  }

  return [...timesCovered.values()].every((times) => times === 1)
    ? null
    : { problem: 'uneven-coverage', index: null }
}

// The same check, for callers that only need to know which problem it is.
export function findSplitCoverageProblem(parts, lotNumbers) {
  return findSplitCoverageIssue(parts, lotNumbers)?.problem ?? null
}
