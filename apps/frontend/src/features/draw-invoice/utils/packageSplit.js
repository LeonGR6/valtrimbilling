import { drawSelectionKey, hardwareChargeKey } from './drawPackages.js'
import { getHardwareBillingMode } from './drawWorksheet.js'
import { planFinalReleaseSplit, scopeOf } from './finalReleaseSplit.js'

// A Builder that takes a single invoice per Phase (or per Building) wants everything available of
// each one on one invoice, so a Package never bills more than one Phase (or Building): a selection
// that spans several is made as several Packages, one for each, created one after the other.
// Per Phase a Phase is all its Buildings together; per Building each Building stands alone.
//
// This is the division the Create Package dialog shows. It covers the Final Release division too:
// when the Builder asks for no single invoice, the Final Release decides how a selection is divided.

/** `PHASE` or `BUILDING` when the setup takes a single invoice at that level, else null. */
export function singleInvoiceScope(schedule) {
  const scope = schedule?.singleInvoiceScope
  return scope === 'PHASE' || scope === 'BUILDING' ? scope : null
}

/**
 * How a Package's cells are divided into Packages.
 *
 * @param job             Job with `sequenceSheet.phases` (each with its `lots`)
 * @param schedule        the Job's billing setup
 * @param builderSchedule the Builder's current setup (see `planFinalReleaseSplit`)
 * @param usedSelections  Map of the cells already in a Package (`buildUsedDrawSelections`)
 * @param billedHardwareCharges Map of the Hardware already billed (`buildBilledHardwareCharges`)
 * @param selections      the cells this Package would bill: { phaseId, lotId, drawIndex }
 * @param hardwareCharges the Hardware this Package would bill: { phaseId, lotId, eventType }
 * @returns {{ invoiceScope, finalScope, groups, needsSplit }}
 *   `groups` is the Packages it takes, in the order they are created. Each has the `phaseIds` it
 *   covers and a `label`; `type` is `FINAL` or `PROGRESS` when the Builder has a Final Release at
 *   that level (the Release the Package gets) and null when it does not. `needsSplit` is true when
 *   it takes more than one.
 */
export function planPackageSplit({
  job,
  schedule,
  builderSchedule = null,
  usedSelections = new Map(),
  billedHardwareCharges = new Map(),
  selections = [],
  hardwareCharges = [],
}) {
  const invoiceScope = singleInvoiceScope(schedule)
  if (!invoiceScope) {
    const plan = planFinalReleaseSplit({
      job,
      schedule,
      builderSchedule,
      usedSelections,
      billedHardwareCharges,
      selections,
      hardwareCharges,
    })
    return { invoiceScope: null, finalScope: plan.scope, groups: plan.groups, needsSplit: plan.needsSplit }
  }

  const none = { invoiceScope, finalScope: null, groups: [], needsSplit: false }
  if (!job) return none

  // The Phases of the Job, grouped into what one invoice covers, in the Job's own order.
  const phases = (job.sequenceSheet?.phases ?? []).filter((phase) => phase.isActive !== false)
  const units = new Map()
  const unitOfPhase = new Map()
  const phaseOfLot = new Map()
  for (const phase of phases) {
    const { key, label } = scopeOf(invoiceScope, phase)
    const unit = units.get(key) ?? { key, label, phaseIds: [], selections: [], hardwareCharges: [] }
    unit.phaseIds.push(String(phase.id))
    units.set(key, unit)
    unitOfPhase.set(String(phase.id), unit)
    for (const lot of phase.lots ?? []) phaseOfLot.set(String(lot.id), String(phase.id))
  }

  for (const selection of selections) unitOfPhase.get(String(selection.phaseId))?.selections.push(selection)
  for (const charge of hardwareCharges) {
    const phaseId = charge.phaseId ?? phaseOfLot.get(String(charge.lotId))
    unitOfPhase.get(String(phaseId))?.hardwareCharges.push(charge)
  }

  // Each Package is made after the ones before it, so what they bill counts as billed when the
  // Release of the next is decided: the one that finishes a Phase last is the one that gets the Final.
  const used = new Map(usedSelections)
  const billedHardware = new Map(billedHardwareCharges)
  const hardwareMode = getHardwareBillingMode(schedule)
  let finalScope = null
  const groups = []

  for (const unit of units.values()) {
    if (unit.selections.length === 0 && unit.hardwareCharges.length === 0) continue

    const release = planFinalReleaseSplit({
      job,
      schedule,
      builderSchedule,
      usedSelections: used,
      billedHardwareCharges: billedHardware,
      selections: unit.selections,
      hardwareCharges: unit.hardwareCharges,
    })
    finalScope = release.scope
    // As the database does: the Final Release is for a Package that finishes every scope it touches.
    const type = release.scopes.length === 0
      ? null
      : release.scopes.every(({ closes }) => closes) ? 'FINAL' : 'PROGRESS'
    groups.push({ type, scopeKeys: [unit.key], phaseIds: unit.phaseIds, label: unit.label })

    for (const { phaseId, lotId, drawIndex } of unit.selections) {
      used.set(drawSelectionKey(job.id, phaseId, lotId, drawIndex), {})
    }
    for (const { lotId, eventType } of unit.hardwareCharges) {
      billedHardware.set(hardwareChargeKey(lotId, hardwareMode, eventType), {})
    }
  }

  return { ...none, finalScope, groups, needsSplit: groups.length > 1 }
}

/**
 * What a saved Package covers when the Builder takes a single invoice: `{ scope, units }`, where
 * `units` maps the key of each Phase (or Building) its cells are in to its label. Null when the
 * setup takes no single invoice. A Package made as it should be has one unit.
 */
export function packageInvoiceUnits(schedule, job, phaseIds = []) {
  const scope = singleInvoiceScope(schedule)
  if (!scope) return null

  const inPackage = new Set(phaseIds.map(String))
  const units = new Map()
  for (const phase of job?.sequenceSheet?.phases ?? []) {
    if (!inPackage.has(String(phase.id))) continue
    const { key, label } = scopeOf(scope, phase)
    units.set(key, label)
  }
  return { scope, units }
}

/**
 * Whether a phase row belongs to the Phase (or Building) a Package covers, so an edit or a
 * transfer can take cells from it. Always true when the setup takes no single invoice.
 */
export function phaseFitsPackageInvoice(own, phase) {
  if (!own || !phase) return true
  return own.units.has(scopeOf(own.scope, phase).key)
}

/**
 * A saved Package that bills more than one Phase (or Building) although the Builder takes a single
 * invoice: `{ scope, labels }`, or null when it does not.
 */
export function describeSavedInvoiceSplit(schedule, job, phaseIds = []) {
  const own = packageInvoiceUnits(schedule, job, phaseIds)
  if (!own || own.units.size < 2) return null

  return { scope: own.scope, labels: [...own.units.values()] }
}
