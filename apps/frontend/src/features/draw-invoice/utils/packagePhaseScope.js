import { formatBuilding, formatPhase } from '../../sequence-sheets/utils/phaseBuildingCodes.js'
import { buildCalendarDrawSuggestion } from './calendarDrawSuggestions.js'

// Which Phases / Buildings of a Job a Package covers, and how the create
// dialog decides which of them to show.

/**
 * Phases the create dialog opens with. Nothing for a Package started by hand;
 * for one started from a Package Suggestion, the suggested Phase plus every
 * Phase the Calendar suggests work for, in the Job's own order.
 */
export function initialShownPhaseIds({
  job,
  initialPhaseId = null,
  schedule,
  productionActivities = [],
  packages = [],
  asOfDate,
}) {
  if (!job) return []

  const phases = job.sequenceSheet?.phases ?? []
  const ids = new Set()
  if (phases.some((phase) => String(phase.id) === String(initialPhaseId))) {
    ids.add(String(initialPhaseId))
  }

  const suggestion = buildCalendarDrawSuggestion({
    activities: productionActivities,
    job,
    schedule,
    packages,
    asOfDate,
  })
  for (const selection of [
    ...suggestion.suggestedSelections,
    ...suggestion.suggestedHardwareSelections,
  ]) {
    ids.add(String(selection.phaseId))
  }

  return phases.map((phase) => String(phase.id)).filter((id) => ids.has(id))
}

export function phaseScopeLabel(phaseName, building) {
  return `${formatPhase(phaseName)} / ${formatBuilding(building)}`
}

/** "Phase 1 / Building A" for each Phase of a package summary. */
export function packagePhaseLabels(phaseSummaries = []) {
  return phaseSummaries.map(
    (scope) => phaseScopeLabel(scope.phaseCode, scope.building),
  )
}

export function isMultiPhasePackage(phaseCount) {
  return Number(phaseCount) > 1
}
