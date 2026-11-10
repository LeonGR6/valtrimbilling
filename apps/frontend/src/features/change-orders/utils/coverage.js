import {
  formatBuilding,
  formatPhase,
  normalizePhaseCode,
} from '../../sequence-sheets/utils/phaseBuildingCodes.js'

// What an Extra / Change Order covers, read from the sequence sheet of one Job:
// Phase -> Building -> Lot. A "phase" record of the Job is one Phase in one
// Building, so a Phase with several Buildings is several records.
//
// A selection is a set of leaf keys: Lot ids ("lots" coverage) or phase record
// ids ("phase" coverage). Utility rows are not Lots and are never covered.

const byNumber = (left, right) => String(left).localeCompare(String(right), 'en', {
  numeric: true,
  sensitivity: 'base',
})

function jobPlans(job) {
  return job?.sequenceSheet?.plans ?? []
}

function jobPhases(job) {
  return job?.sequenceSheet?.phases ?? []
}

function realLots(phase) {
  return [...(phase.lots ?? [])]
    .filter((lot) => !lot.isUtilityBuilding)
    .sort((left, right) => byNumber(left.lotNumber, right.lotNumber))
}

function planCodeOf(job, planId) {
  return jobPlans(job).find((plan) => plan.id === planId)?.code ?? ''
}

/** Every Lot of the Job as one row, in Phase / Building / Lot order. */
export function listCoverageLots(job) {
  return [...jobPhases(job)]
    .sort((left, right) => byNumber(
      normalizePhaseCode(left.name),
      normalizePhaseCode(right.name),
    ) || byNumber(left.building, right.building))
    .flatMap((phase) => realLots(phase).map((lot) => ({
      lotId: String(lot.id),
      recordId: String(phase.id),
      phaseKey: normalizePhaseCode(phase.name),
      phase: formatPhase(phase.name),
      building: formatBuilding(phase.building),
      lot: String(lot.lotNumber),
      planId: lot.planId == null ? null : String(lot.planId),
      plan: planCodeOf(job, lot.planId),
    })))
}

/**
 * The tree the person ticks: Phase -> Building -> Lot ("lots" coverage), or
 * Phase -> Building ("phase" coverage). Each node carries the leaf keys under
 * it, so a node is ticked when all of them are.
 */
export function buildCoverageTree(job, leafLevel) {
  const lots = listCoverageLots(job)
  const phaseKeys = [...new Set(lots.map((row) => row.phaseKey))]
  // A Phase whose records have no lots still exists for "phase" coverage.
  for (const phase of jobPhases(job)) {
    const key = normalizePhaseCode(phase.name)
    if (!phaseKeys.includes(key)) phaseKeys.push(key)
  }
  phaseKeys.sort(byNumber)

  return phaseKeys.map((phaseKey) => {
    const records = jobPhases(job)
      .filter((phase) => normalizePhaseCode(phase.name) === phaseKey)
      .sort((left, right) => byNumber(left.building, right.building))
    const lotNode = (row) => ({
      id: `lot:${row.lotId}`,
      label: `Lot ${row.lot}${row.plan ? ` – Plan ${row.plan}` : ''}`,
      leaves: [row.lotId],
      searchText: [row.phase, row.building, `lot ${row.lot}`, row.plan].join(' '),
      children: [],
    })
    const recordNode = (phase) => {
      const children = leafLevel === 'lot'
        ? lots.filter((row) => row.recordId === String(phase.id)).map(lotNode)
        : []
      return {
        id: `record:${phase.id}`,
        label: formatBuilding(phase.building) || 'No building',
        leaves: leafLevel === 'lot'
          ? children.flatMap((child) => child.leaves)
          : [String(phase.id)],
        searchText: [formatPhase(phase.name), formatBuilding(phase.building)].join(' '),
        children,
      }
    }

    const onlyUnbuilt = records.length === 1 && !normalizePhaseCode(records[0].building)
    const children = onlyUnbuilt && leafLevel === 'lot'
      ? recordNode(records[0]).children
      : records.map(recordNode)

    return {
      id: `phase:${phaseKey}`,
      label: formatPhase(phaseKey),
      leaves: children.flatMap((child) => child.leaves),
      searchText: formatPhase(phaseKey),
      children,
    }
  })
}

/** Keeps the nodes that match `query` or hold something that does. */
export function filterCoverageTree(nodes, query) {
  const needle = query.trim().toLowerCase()
  if (!needle) return nodes

  return nodes.flatMap((node) => {
    if (node.searchText.toLowerCase().includes(needle)) return [node]
    const children = filterCoverageTree(node.children, query)
    return children.length > 0 ? [{ ...node, children }] : []
  })
}

/** 'none' | 'some' | 'all' of the node's leaves that are selected. */
export function nodeSelectionState(node, selected) {
  if (node.leaves.length === 0) return 'none'
  const count = node.leaves.filter((leaf) => selected.has(leaf)).length
  if (count === 0) return 'none'
  return count === node.leaves.length ? 'all' : 'some'
}

/** Ticks every leaf under the node, or clears them when all were ticked. */
export function toggleNode(node, selected) {
  const next = new Set(selected)
  const allSelected = nodeSelectionState(node, selected) === 'all'
  for (const leaf of node.leaves) {
    if (allSelected) next.delete(leaf)
    else next.add(leaf)
  }
  return next
}

/** The Lots a coverage reaches. `coverage` is { mode, lotIds, recordIds, planIds }. */
export function coveredLots(job, coverage) {
  const lots = listCoverageLots(job)

  switch (coverage.mode) {
    case 'lots':
      return lots.filter((row) => coverage.lotIds.has(row.lotId))
    case 'phase':
      return lots.filter((row) => coverage.recordIds.has(row.recordId))
    case 'plans':
      return lots.filter((row) => row.planId && coverage.planIds.has(row.planId))
    case 'job':
      return lots
    default:
      return []
  }
}

const COVERAGE_MODES = ['lots', 'phase', 'job', 'plans']

/**
 * The coverage to open a saved Extra / CO with. The lines are what was saved, so the way the Lots were
 * chosen is only kept when it still reaches exactly those Lots (a Lot added to the Job since would
 * otherwise slip in as a new line); if not, the saved Lots are shown ticked one by one.
 * Specific Plan Types is always kept: the Plans are the point of it (their Scope and Amount), and a Lot
 * of those Plans added since does belong on it.
 * `saved` is the coverage as stored ({ mode, lotIds, recordIds, planIds } with lists, or null) and
 * `lotIds` the Lots of the saved lines.
 */
export function restoreCoverage(job, saved, lotIds) {
  const savedLots = new Set(lotIds.map(String))
  const asLots = {
    mode: 'lots',
    lotIds: savedLots,
    recordIds: new Set(),
    planIds: new Set(),
  }
  if (!job || !saved || !COVERAGE_MODES.includes(saved.mode)) return asLots

  const asSaved = {
    mode: saved.mode,
    lotIds: new Set((saved.lotIds ?? []).map(String)),
    recordIds: new Set((saved.recordIds ?? []).map(String)),
    planIds: new Set((saved.planIds ?? []).map(String)),
  }
  if (saved.mode === 'plans') return asSaved

  const reached = coveredLots(job, asSaved).map((row) => row.lotId)
  const sameLots = reached.length === savedLots.size && reached.every((id) => savedLots.has(id))

  return sameLots ? asSaved : asLots
}

export function summarizeCoverage(rows) {
  return {
    lots: rows.length,
    phases: new Set(rows.map((row) => row.phaseKey)).size,
    buildings: new Set(rows.filter((row) => row.building).map((row) => row.recordId)).size,
  }
}

export function filterCoverageRows(rows, query) {
  const needle = query.trim().toLowerCase()
  if (!needle) return rows

  return rows.filter((row) => (
    [row.phase, row.building, `lot ${row.lot}`, row.lot, row.plan, `plan ${row.plan}`]
      .some((value) => String(value).toLowerCase().includes(needle))
  ))
}
