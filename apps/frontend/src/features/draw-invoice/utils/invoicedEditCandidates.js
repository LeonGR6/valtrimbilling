import { buildAvailableSeparateHardwareSelections } from './calendarDrawSuggestions.js'
import {
  buildBilledHardwareCharges,
  buildOptionChargeContext,
  getOptionsBillingDrawIndex,
  getSelectedOptionRows,
  hardwareChargeKey,
  isAtOrAfterOptionsBillingDraw,
  optionBillingIdentity,
} from './drawPackages.js'

// What the edit of an invoiced Package can still put on it: Option units and Separate Hardware lines
// that are free (no Package bills them) on the Lots the Package bills. The database repeats every one of
// these rules, so a list that is wrong only costs the person an error message.

/**
 * The Option units a Package could take. A unit qualifies when
 *   - it is selected on a Lot the Package bills (a cell of that Lot stays in the edit),
 *   - the Lot reached the Options billing Draw: a cell of it at or after that Draw stays, or another
 *     Package of the Job billed one,
 *   - no Package, this one included, bills the unit. A unit this Package bills is kept or released
 *     with its own checkbox; one released in this edit becomes free once the edit is saved.
 *
 * @param phaseModels the Phases on screen, each { phase, worksheet } (`buildDrawWorksheet`)
 * @param selections the cells the Package keeps after the edit
 * @param record the Package
 * @param packages the Job's Packages
 */
export function listFreeOptionUnits({
  phaseModels = [],
  selections = [],
  record,
  packages = [],
  schedule,
}) {
  const optionsBillingDrawIndex = getOptionsBillingDrawIndex(record, schedule)
  if (optionsBillingDrawIndex === null) return []

  const otherPackages = packages.filter((candidate) => String(candidate.id) !== String(record.id))
  const reached = new Set(
    buildOptionChargeContext(otherPackages, record.jobId, optionsBillingDrawIndex)
      .eligibleOptionLotIds.map(String),
  )
  for (const selection of selections) {
    if (isAtOrAfterOptionsBillingDraw(selection.drawIndex, optionsBillingDrawIndex)) {
      reached.add(String(selection.lotId))
    }
  }

  const billed = new Set(
    buildOptionChargeContext(packages, record.jobId, optionsBillingDrawIndex)
      .billedOptionEntries.map(({ identity }) => identity),
  )
  const packageLotIds = new Set(selections.map(({ lotId }) => String(lotId)))

  const rows = phaseModels.flatMap(({ phase, worksheet }) => worksheet.rows
    .filter((row) => !row.isUtilityBuilding
      && packageLotIds.has(String(row.id))
      && reached.has(String(row.id)))
    .map((row) => ({
      ...row,
      phaseId: phase.id,
      phaseCode: phase.name ?? phase.code ?? null,
      building: phase.building ?? null,
    })))

  return getSelectedOptionRows(rows).filter(
    (option) => !billed.has(optionBillingIdentity(option.lotId, option.optionId, option.unitNo)),
  )
}

/**
 * The Separate Hardware lines a Package could take: the Calendar events of the Hardware price (EXT, DM,
 * HW) of the Lots it bills, with their cells or with Hardware lines alone, that no Package bills yet. A
 * Builder that does not price Hardware by event has none.
 *
 * @param job the Job, with its Sequence Sheet
 * @param selections the cells the Package keeps after the edit
 * @param keptHardwareLines the Separate Hardware lines the Package keeps
 */
export function listFreeHardwareEvents({
  job,
  schedule,
  selections = [],
  keptHardwareLines = [],
  record,
  packages = [],
}) {
  const available = buildAvailableSeparateHardwareSelections({ job, schedule })
  if (available.length === 0) return []

  const billed = buildBilledHardwareCharges(packages, record.jobId)
  const packageLotIds = new Set([
    ...selections.map(({ lotId }) => String(lotId)),
    ...keptHardwareLines.map(({ lotId }) => String(lotId)),
  ])
  const phases = new Map((job?.sequenceSheet?.phases ?? []).map((phase) => [String(phase.id), phase]))

  return available
    .filter(({ lotId, eventType }) => packageLotIds.has(String(lotId))
      && !billed.has(hardwareChargeKey(lotId, 'BY_EVENT', eventType)))
    .map(({ phaseId, lotId, eventType }) => {
      const phase = phases.get(String(phaseId))
      const lot = (phase?.lots ?? []).find((candidate) => String(candidate.id) === String(lotId))
      return {
        id: `${lotId}:${eventType}`,
        phaseId,
        phaseCode: phase?.name ?? phase?.code ?? null,
        building: phase?.building ?? null,
        lotId,
        lotNumber: lot?.lotNumber ?? '',
        eventType,
      }
    })
}
