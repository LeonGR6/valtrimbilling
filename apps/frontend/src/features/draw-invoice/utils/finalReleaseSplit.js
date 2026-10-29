import { formatPhase, formatPhaseBuilding } from '../../sequence-sheets/utils/phaseBuildingCodes.js'
import { drawSelectionKey, hardwareChargeKey } from './drawPackages.js'
import { getHardwareBillingMode, getHardwareEventPercentage } from './drawWorksheet.js'

// When a Builder's setup asks for a Final Release per Phase (or per Building), the Package that
// finishes a Phase is the one that gets the Final Release, and the Packages that do not are
// Progress payments. A Package that finishes one Phase and also bills others that still have
// something left is a Progress payment as a whole, so the Phase it finished never gets its Final
// Release. This decides, before the Package is made, when that happens and how to divide it: every
// Phase the Package finishes goes in a Package of its own, and everything else stays together.
//
// It follows how the database decides the Final Release (get_final_release_status): a scope is
// every Lot (Utility rows too) in every Draw, plus the Separate Hardware parts when the setup has
// them, and it is finished by the Package that bills the last of them.

const HARDWARE_EVENTS = ['EXT', 'DM', 'HW']

/**
 * The level a Package has to be divided at (`PHASE` or `BUILDING`), or null when no division is
 * ever needed: the setup has no Final Release, it is per Project (there is one scope only), or
 * retention is released at the same level, in which case the Retention Release is the Final and a
 * Draw Package never is.
 */
export function finalReleaseSplitScope(schedule, builderSchedule = null) {
  // A setup made before the Final Release option has no level: the Builder's current setup decides,
  // as it does for the Release itself.
  const scope = schedule?.finalReleaseScope || builderSchedule?.finalReleaseScope
  if (scope !== 'PHASE' && scope !== 'BUILDING') return null

  const retentionOn = Boolean(schedule?.retentionEnabled) && Number(schedule?.retentionPercentage) > 0
  if (retentionOn && scope === 'BUILDING' && schedule?.retentionReleaseScope === 'BUILDING') return null

  return scope
}

/** The Phase or Building a phase row belongs to, as a Final Release scope. */
export function scopeOf(scope, phase) {
  return scope === 'PHASE'
    ? { key: `phase:${phase.name}`, label: formatPhase(phase.name) || String(phase.name) }
    : { key: `building:${phase.id}`, label: formatPhaseBuilding(phase.name, phase.building) }
}

function expectedHardwareParts(schedule) {
  if (!schedule?.separateHardwarePrice) return []
  if (getHardwareBillingMode(schedule) === 'BY_EVENT') {
    return HARDWARE_EVENTS.filter((eventType) => getHardwareEventPercentage(schedule, eventType) > 0)
  }
  return [null]
}

/**
 * Which Phases (or Buildings) a Package finishes and, when it also bills others, how to divide it.
 *
 * @param job             Job with `sequenceSheet.phases` (each with its `lots`)
 * @param schedule        the Job's billing setup (draws, Final Release scope, retention, hardware)
 * @param builderSchedule the Builder's current setup, which gives the Final Release scope when the
 *                        Job's setup has none
 * @param usedSelections  Map of the cells already in a Package (`buildUsedDrawSelections`)
 * @param billedHardwareCharges Map of the Hardware already billed (`buildBilledHardwareCharges`)
 * @param selections      the cells this Package would bill: { phaseId, lotId, drawIndex }
 * @param hardwareCharges the Hardware this Package would bill: { lotId, eventType }
 * @returns {{ scope, scopes, groups, needsSplit }}
 *   `scopes` has every scope the Package touches (`closes` says whether this Package finishes it);
 *   `groups` is the Packages it takes, Progress first and then one Final per Phase finished;
 *   `needsSplit` is true when it takes more than one.
 */
export function planFinalReleaseSplit({
  job,
  schedule,
  builderSchedule = null,
  usedSelections = new Map(),
  billedHardwareCharges = new Map(),
  selections = [],
  hardwareCharges = [],
}) {
  const scope = finalReleaseSplitScope(schedule, builderSchedule)
  const none = { scope, scopes: [], groups: [], needsSplit: false }
  const drawCount = schedule?.draws?.length ?? 0
  if (!scope || !job || drawCount === 0) return none

  const phases = (job.sequenceSheet?.phases ?? []).filter((phase) => phase.isActive !== false)
  const scopes = new Map()
  for (const phase of phases) {
    const { key, label } = scopeOf(scope, phase)
    const known = scopes.get(key) ?? { key, label, phaseIds: [], phases: [] }
    known.phaseIds.push(String(phase.id))
    known.phases.push(phase)
    scopes.set(key, known)
  }

  const hardwareMode = getHardwareBillingMode(schedule)
  const hardwareParts = expectedHardwareParts(schedule)
  const chosenCells = new Set(selections.map(
    ({ phaseId, lotId, drawIndex }) => `${phaseId}:${lotId}:${drawIndex}`,
  ))
  const chosenHardware = new Set(hardwareCharges.map(
    ({ lotId, eventType }) => hardwareChargeKey(lotId, hardwareMode, eventType),
  ))

  const result = []
  for (const candidate of scopes.values()) {
    let total = 0
    let before = 0
    let after = 0
    let touched = false

    for (const phase of candidate.phases) {
      for (const lot of phase.lots ?? []) {
        for (let drawIndex = 0; drawIndex < drawCount; drawIndex += 1) {
          const used = usedSelections.has(drawSelectionKey(job.id, phase.id, lot.id, drawIndex))
          const chosen = chosenCells.has(`${phase.id}:${lot.id}:${drawIndex}`)
          total += 1
          if (used) before += 1
          if (used || chosen) after += 1
          if (chosen) touched = true
        }

        if (lot.isUtilityBuilding) continue
        for (const part of hardwareParts) {
          const key = hardwareChargeKey(lot.id, hardwareMode, part)
          const used = billedHardwareCharges.has(key)
          const chosen = chosenHardware.has(key)
          total += 1
          if (used) before += 1
          if (used || chosen) after += 1
          if (chosen) touched = true
        }
      }
    }

    if (!touched) continue
    result.push({
      key: candidate.key,
      label: candidate.label,
      phaseIds: candidate.phaseIds,
      remainingAfter: total - after,
      closes: total > 0 && after === total && before < total,
    })
  }

  const open = result.filter(({ closes }) => !closes)
  const groups = [
    ...(open.length > 0
      ? [{
          type: 'PROGRESS',
          scopeKeys: open.map(({ key }) => key),
          phaseIds: open.flatMap(({ phaseIds }) => phaseIds),
          label: open.map(({ label }) => label).join(', '),
        }]
      : []),
    ...result.filter(({ closes }) => closes).map(({ key, label, phaseIds }) => ({
      type: 'FINAL',
      scopeKeys: [key],
      phaseIds,
      label,
    })),
  ]

  return { scope, scopes: result, groups, needsSplit: groups.length > 1 }
}

/**
 * The Package inputs a divided Package becomes, one per group in the order they are created. Each
 * cell, Hardware charge and Option goes with its Phase. An Option of a Lot is billed with a Draw at
 * or after the Options billing Draw of its own Package; when its group has none, it goes with the
 * first group that does, and when no group has one it is left out and counted in `unplacedOptions`.
 *
 * @param plan  result of `planFinalReleaseSplit`
 * @param input { jobId, selections, hardwareSelections, optionSelections, optionsBillingDrawIndex }
 */
export function splitPackageInput({ plan, job, input }) {
  const groupOfPhase = new Map()
  plan.groups.forEach((group, index) => {
    for (const phaseId of group.phaseIds) groupOfPhase.set(String(phaseId), index)
  })

  const phaseOfLot = new Map()
  for (const phase of job?.sequenceSheet?.phases ?? []) {
    for (const lot of phase.lots ?? []) phaseOfLot.set(String(lot.id), String(phase.id))
  }

  const parts = plan.groups.map(() => ({
    selections: [],
    hardwareSelections: [],
    optionSelections: [],
  }))
  for (const selection of input.selections ?? []) {
    parts[groupOfPhase.get(String(selection.phaseId))]?.selections.push(selection)
  }
  for (const hardware of input.hardwareSelections ?? []) {
    parts[groupOfPhase.get(String(hardware.phaseId))]?.hardwareSelections.push(hardware)
  }

  const optionsDrawIndex = input.optionsBillingDrawIndex
  const hasCarrier = (part) => optionsDrawIndex !== null
    && optionsDrawIndex !== undefined
    && part.selections.some(({ drawIndex }) => Number(drawIndex) >= Number(optionsDrawIndex))
  let unplacedOptions = 0
  for (const option of input.optionSelections ?? []) {
    const own = groupOfPhase.get(phaseOfLot.get(String(option.lotId)))
    const target = own !== undefined && hasCarrier(parts[own])
      ? own
      : parts.findIndex(hasCarrier)
    if (target === -1) {
      unplacedOptions += 1
    } else {
      parts[target].optionSelections.push(option)
    }
  }

  return {
    unplacedOptions,
    packages: plan.groups.map((group, index) => ({
      group,
      input: {
        jobId: input.jobId,
        selections: parts[index].selections,
        hardwareSelections: parts[index].hardwareSelections,
        optionSelections: parts[index].optionSelections,
        optionsBillingDrawIndex: input.optionsBillingDrawIndex,
      },
    })),
  }
}

/**
 * What a saved Package says about its own Final Release status, from the scopes the database
 * reports (`finalRelease` of the Release values): it needs dividing when it finishes a scope and
 * either touches another one or finishes more than one.
 */
export function describeSavedPackageSplit(finalRelease) {
  if (!finalRelease?.applicable || finalRelease.retentionFinal) return null
  if (finalRelease.scope !== 'PHASE' && finalRelease.scope !== 'BUILDING') return null

  const scopes = finalRelease.scopes ?? []
  const closing = scopes.filter(({ closes }) => closes)
  if (closing.length === 0 || scopes.length < 2) return null

  return {
    closing: closing.map(({ label }) => label),
    others: scopes.filter(({ closes }) => !closes).map(({ label }) => label),
  }
}
