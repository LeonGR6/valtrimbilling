import { drawSelectionKey, hardwareChargeKey } from './drawPackages.js'
import { getHardwareBillingMode } from './drawWorksheet.js'
import { planFinalReleaseSplit, scopeOf, splitPackageInput } from './finalReleaseSplit.js'

// A Builder that takes a single invoice per Phase (or per Building) wants one invoice for each, so a
// Package never bills more than one Phase (or Building): a selection that spans several is made as
// several Packages, one for each, created one after the other. What goes in each is what was chosen
// of it; nothing is added or required. Per Phase a Phase is all its Buildings together; per
// Building each Building stands alone.
//
// This is the division the Create Package dialog shows. It covers the Final Release division too:
// when the Builder asks for no single invoice, the Final Release decides how a selection is divided.
// An Option that has no Draw of its own Phase to ride on is billed on an Options Package.

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
 * The Packages that bill Options on their own (Options Packages): Options with no Lot / Draw cell
 * to ride on. A Builder with a single invoice per Phase (or Building) gets one for each Phase (or
 * Building) the Options are in, so an Option is never on another one's invoice; any other Builder
 * gets one for all of them.
 *
 * @param optionSelections the Options to bill: { lotId, optionId }
 * @returns {{ kind: 'OPTIONS', group, input }[]} `group.phaseIds` are the Phases the Options are in
 */
export function planOptionsPackages({ job, schedule, optionSelections = [], notes = null }) {
  const options = [...new Map(optionSelections.map(
    (option) => [`${option.lotId}:${option.optionId}`, option],
  )).values()]
  if (options.length === 0) return []

  const invoiceScope = singleInvoiceScope(schedule)
  const phases = (job?.sequenceSheet?.phases ?? []).filter((phase) => phase.isActive !== false)
  const phaseOfLot = new Map()
  for (const phase of phases) {
    for (const lot of phase.lots ?? []) phaseOfLot.set(String(lot.id), phase)
  }

  const groups = new Map()
  for (const option of options) {
    const phase = phaseOfLot.get(String(option.lotId))
    const { key, label } = invoiceScope && phase
      ? scopeOf(invoiceScope, phase)
      : { key: 'options', label: 'Options' }
    const group = groups.get(key) ?? { key, label, phaseIds: new Set(), options: [] }
    if (phase) group.phaseIds.add(String(phase.id))
    group.options.push(option)
    groups.set(key, group)
  }

  // In the order of the Job's Phases, so the Packages come out the same however the Options were picked.
  const phaseOrder = new Map(phases.map((phase, index) => [String(phase.id), index]))
  const rank = (group) => Math.min(...[...group.phaseIds].map((id) => phaseOrder.get(id) ?? Infinity))

  return [...groups.values()]
    .sort((left, right) => rank(left) - rank(right))
    .map((group) => ({
      kind: 'OPTIONS',
      group: {
        type: 'OPTIONS',
        scopeKeys: [group.key],
        phaseIds: [...group.phaseIds],
        label: group.label,
      },
      input: {
        kind: 'OPTIONS',
        jobId: job?.id,
        optionSelections: group.options.map(({ lotId, optionId }) => ({ lotId, optionId })),
        notes,
      },
    }))
}

/**
 * Every Package the Create Package dialog makes, in the order they are created: the Draw Packages
 * first (one, or the division the Builder's single invoice or Final Release asks for) and then the
 * Options Packages.
 *
 * An Option rides on a Draw of the Package that bills its Lot, from the Options billing Draw on.
 * One that cannot (its Phase has no such Draw in the selection, and the Builder's single invoice
 * keeps it off another Phase's invoice) is billed on a Package of its own, as are the Options that
 * were asked to be billed alone, which is what a Lot that already reached the Options Draw needs
 * for an Option added since.
 *
 * The price differences chosen to be collected ride on the Draw Package that bills their Phase (a
 * Package that is one invoice per Phase never takes another Phase's).
 *
 * @param splitPlan  result of `planPackageSplit`
 * @param input      { jobId, selections, hardwareSelections, optionSelections, optionsBillingDrawIndex,
 *                   notes }, where `optionSelections` are the Options that ride on a Draw
 * @param ownOptions the Options { lotId, optionId } to bill on their own
 * @param priceDifferences the pending differences { id, phaseId } to collect with the Draw Packages
 * @returns {{ kind: 'DRAW' | 'OPTIONS', group, input }[]}
 */
export function planCreatedPackages({
  job,
  schedule,
  splitPlan,
  input,
  ownOptions = [],
  priceDifferences = [],
}) {
  const hasDrawContent = (input.selections?.length ?? 0) > 0
    || (input.hardwareSelections?.length ?? 0) > 0
  const alone = [...ownOptions]
  let drawPackages = []

  if (hasDrawContent) {
    if (splitPlan.invoiceScope || splitPlan.groups.length > 1) {
      // Also with one group when the Builder takes a single invoice: its Options go on its own invoice.
      const placed = splitPackageInput({ plan: splitPlan, job, input })
      drawPackages = placed.packages.map(({ group, input: part }) => ({ kind: 'DRAW', group, input: part }))
      alone.push(...placed.unplaced)
    } else {
      drawPackages = [{ kind: 'DRAW', group: splitPlan.groups[0] ?? null, input }]
    }
  }

  if (priceDifferences.length > 0) {
    drawPackages = drawPackages.map((drawPackage) => {
      const billedPhaseIds = new Set([
        ...(drawPackage.input.selections ?? []),
        ...(drawPackage.input.hardwareSelections ?? []),
      ].map(({ phaseId }) => String(phaseId)))
      const priceDifferenceIds = priceDifferences
        .filter(({ phaseId }) => billedPhaseIds.has(String(phaseId)))
        .map(({ id }) => id)

      return priceDifferenceIds.length === 0
        ? drawPackage
        : { ...drawPackage, input: { ...drawPackage.input, priceDifferenceIds } }
    })
  }

  return [
    ...drawPackages,
    ...planOptionsPackages({ job, schedule, optionSelections: alone, notes: input.notes }),
  ]
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
