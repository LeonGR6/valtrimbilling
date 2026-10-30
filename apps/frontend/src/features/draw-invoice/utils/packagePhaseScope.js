import {
  formatPhaseBuilding,
  normalizeBuildingCode,
  normalizePhaseCode,
} from '../../sequence-sheets/utils/phaseBuildingCodes.js'
import {
  buildAvailableSeparateHardwareSelections,
  buildCalendarDrawSuggestion,
} from './calendarDrawSuggestions.js'
import {
  drawSelectionKey,
  getOptionsBillingDrawIndex,
  hardwareChargeKey,
  optionBillingIdentity,
  utilityChargeKey,
} from './drawPackages.js'
import {
  getUtilityBillingMode,
  getUtilityEventPercentage,
} from './drawWorksheet.js'

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

const compareCodes = (left, right) => left.localeCompare(right, 'en', {
  numeric: true,
  sensitivity: 'base',
})

/**
 * The Phases in the order they are offered: the ones whose code starts with a
 * letter first (MBO 1, MBO 2, MBO 10), then the numbered ones (14, 15, 16, 16A).
 * A Phase split in Buildings goes by its Building within the Phase. The codes are
 * compared as they are shown, without the word "Phase".
 */
export function sortPhasesForPicking(phases) {
  const startsWithDigit = (code) => /^\d/.test(code)

  return [...phases].sort((left, right) => {
    const leftCode = normalizePhaseCode(left.name)
    const rightCode = normalizePhaseCode(right.name)

    return (Number(startsWithDigit(leftCode)) - Number(startsWithDigit(rightCode)))
      || compareCodes(leftCode, rightCode)
      || compareCodes(normalizeBuildingCode(left.building), normalizeBuildingCode(right.building))
  })
}

export function phaseScopeLabel(phaseName, building) {
  return formatPhaseBuilding(phaseName, building, { separator: ' / ' })
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

const BILLING_EVENT_ORDER = ['EXT', 'DM', 'HW']

/**
 * How much of a Phase / Building is still to be billed. A Phase is complete
 * when every Lot / Draw cell, every Utility charge and every Separate Hardware
 * charge it has is already in a Package (cancelled Packages do not count), and
 * every Option selected on its Lots was charged too: an Option added after its Lot
 * was billed leaves the Phase open, so it can be added to a Package to bill it.
 * A Phase with nothing to bill, or a Job without a usable schedule, is never
 * reported as complete, so it stays among the ones to review.
 *
 * @param usedSelections Map from `buildUsedDrawSelections`
 * @param billedUtilityCharges Map from `buildBilledUtilityCharges`
 * @param billedHardwareCharges Map from `buildBilledHardwareCharges`
 * @param billedOptionIdentities Set of "lotId:optionId" already billed (`buildOptionChargeContext`)
 */
export function phaseBillingProgress({
  job,
  phase,
  schedule,
  usedSelections,
  billedUtilityCharges,
  billedHardwareCharges,
  billedOptionIdentities = new Set(),
}) {
  const draws = schedule?.draws ?? []
  const rows = phase?.lots ?? []
  const lotRows = rows.filter((row) => !row.isUtilityBuilding)
  const utilityRows = rows.filter((row) => row.isUtilityBuilding)

  let totalCells = 0
  let billedCells = 0
  for (const row of lotRows) {
    draws.forEach((_, drawIndex) => {
      totalCells += 1
      if (usedSelections.has(drawSelectionKey(job?.id, phase.id, row.id, drawIndex))) {
        billedCells += 1
      }
    })
  }

  const utilityMode = getUtilityBillingMode(schedule)
  const utilityEvents = utilityMode === 'BY_EVENT'
    ? BILLING_EVENT_ORDER.filter((eventType) => getUtilityEventPercentage(schedule, eventType) > 0)
    : [null]
  let totalUtility = 0
  let billedUtility = 0
  for (const row of utilityRows) {
    for (const eventType of utilityEvents) {
      totalUtility += 1
      if (billedUtilityCharges.has(utilityChargeKey(row.id, utilityMode, eventType))) {
        billedUtility += 1
      }
    }
  }

  const phaseHardware = buildAvailableSeparateHardwareSelections({ job, schedule })
    .filter(({ phaseId }) => String(phaseId) === String(phase.id))
  const billedHardware = phaseHardware.filter(({ lotId, eventType }) => (
    billedHardwareCharges.has(hardwareChargeKey(lotId, 'BY_EVENT', eventType))
  )).length

  // The Options selected on its Lots. A Builder that does not bill Options has none to wait for.
  let totalOptions = 0
  let billedOptions = 0
  if (getOptionsBillingDrawIndex(null, schedule) !== null) {
    const plans = job?.sequenceSheet?.plans ?? []
    for (const row of lotRows) {
      const selectedOptionIds = new Set((row.optionIds ?? []).map(String))
      const plan = plans.find((candidate) => String(candidate.id) === String(row.planId))
      for (const option of plan?.options ?? []) {
        if (!selectedOptionIds.has(String(option.id))) continue
        totalOptions += 1
        if (billedOptionIdentities.has(optionBillingIdentity(row.id, option.id))) billedOptions += 1
      }
    }
  }

  const total = totalCells + totalUtility + phaseHardware.length + totalOptions
  const billed = billedCells + billedUtility + billedHardware + billedOptions

  return {
    lotCount: lotRows.length,
    utilityCount: utilityRows.length,
    drawCount: draws.length,
    totalCells,
    billedCells,
    totalUtility,
    billedUtility,
    totalHardware: phaseHardware.length,
    billedHardware,
    totalOptions,
    billedOptions,
    // Selected on a Lot and not charged yet.
    pendingOptions: totalOptions - billedOptions,
    remaining: total - billed,
    isComplete: total > 0 && billed === total,
  }
}
