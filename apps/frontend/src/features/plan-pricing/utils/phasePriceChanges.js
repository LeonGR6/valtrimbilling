// Updating the price of Phases that already exist. A Phase keeps the price it was
// created with; these helpers turn what the server reports into the list an
// administrator picks from, and the picked list into what the server is asked to
// change. What a Draft Package bills is calculated again with the new price. What a
// Package with a QuickBooks invoice, sent or paid bills keeps its amount, and the
// difference is recorded as pending to collect. The server enforces the same rules.

import { sortOptionsByCode } from '../../../utils/optionOrder.js'

function money(value) {
  return value == null ? null : Number(value)
}

function toPackages(packages = []) {
  return packages.map((item) => ({
    packageId: Number(item.package_id),
    packageNumber: item.package_number,
    recalculable: Boolean(item.recalculable),
    hasDocuments: Boolean(item.has_documents),
    workflowStatus: item.workflow_status ?? null,
  }))
}

function toPlanChange(change) {
  if (!change) return null

  const fromBase = money(change.from_base)
  const toBase = money(change.to_base)
  const fromHardware = money(change.from_hardware)
  const toHardware = money(change.to_hardware)

  return {
    billed: Boolean(change.billed),
    // Billed in a Package that cannot be recalculated: it never changes here.
    locked: Boolean(change.locked),
    packages: toPackages(change.packages),
    fromBase,
    toBase,
    fromHardware,
    toHardware,
    baseChanged: fromBase !== toBase,
    hardwareChanged: fromHardware !== toHardware,
  }
}

function toOptionChange(change) {
  return {
    optionId: Number(change.option_id),
    code: change.code,
    description: change.description ?? '',
    billed: Boolean(change.billed),
    locked: Boolean(change.locked),
    packages: toPackages(change.packages),
    fromPrice: money(change.from_price),
    fromNotApplicable: Boolean(change.from_na),
    toPrice: money(change.to_price),
    toNotApplicable: Boolean(change.to_na),
  }
}

function lotLabel(lot) {
  if (lot.is_utility_building) {
    return lot.utility_name?.trim() || 'Utility'
  }
  return `Lot ${lot.lot_number}`
}

/** The server's list of Phases with prices different from today's, for the screen. */
export function toPhasePriceChanges(rows = []) {
  return rows.map((row) => ({
    phaseId: Number(row.phase_id),
    code: row.code,
    building: row.building ?? '',
    label: row.building ? `${row.code} · ${row.building}` : String(row.code),
    lots: (row.lots ?? []).map((lot) => ({
      lotId: Number(lot.lot_id),
      label: lotLabel(lot),
      planId: Number(lot.plan_id),
      planCode: lot.plan_code,
      plan: toPlanChange(lot.plan_change),
      options: sortOptionsByCode((lot.option_changes ?? []).map(toOptionChange)),
    })),
  }))
}

/**
 * What picking a Phase would change for the chosen components: the Lots whose Plan
 * price moves and the Options whose price moves, with the Packages that bill them.
 */
export function phaseEligibleChanges(phase, { includePlan = true, includeOptions = true } = {}) {
  const lots = []
  const options = []
  const packages = new Map()

  const addPackages = (items) => {
    items.forEach((item) => packages.set(item.packageId, item))
  }

  phase.lots.forEach((lot) => {
    if (includePlan && lot.plan) {
      lots.push(lot)
      addPackages(lot.plan.packages)
    }
    if (includeOptions) {
      lot.options.forEach((option) => {
        options.push({ lot, option })
        addPackages(option.packages)
      })
    }
  })

  return {
    lots,
    options,
    packages: [...packages.values()],
    count: lots.length + options.length,
  }
}

/** The request for the picked Phases: only what can still change. */
export function buildPhasePriceRequest(phases, selectedPhaseIds, components) {
  const selected = new Set(selectedPhaseIds)
  const lotIds = []
  const options = []

  phases.filter((phase) => selected.has(phase.phaseId)).forEach((phase) => {
    const eligible = phaseEligibleChanges(phase, components)
    eligible.lots.forEach((lot) => lotIds.push(lot.lotId))
    eligible.options.forEach(({ lot, option }) => {
      options.push({ lot_id: lot.lotId, option_id: option.optionId })
    })
  })

  return { lotIds, options }
}

function affectedPackages(phases, selectedPhaseIds, components) {
  const selected = new Set(selectedPhaseIds)
  const packages = new Map()

  phases.filter((phase) => selected.has(phase.phaseId)).forEach((phase) => {
    phaseEligibleChanges(phase, components).packages.forEach((item) => {
      packages.set(item.packageId, item)
    })
  })

  return [...packages.values()].sort((left, right) => left.packageId - right.packageId)
}

/** The Draft Packages that picking these Phases would recalculate, each once. */
export function affectedDraftPackages(phases, selectedPhaseIds, components) {
  return affectedPackages(phases, selectedPhaseIds, components)
    .filter((item) => item.recalculable)
}

/** The Packages that keep their amount: the difference is recorded for them. */
export function affectedIssuedPackages(phases, selectedPhaseIds, components) {
  return affectedPackages(phases, selectedPhaseIds, components)
    .filter((item) => !item.recalculable)
}

/** Totals for the confirmation line and the button. */
export function summarizePhasePriceRequest(phases, selectedPhaseIds, components) {
  const { lotIds, options } = buildPhasePriceRequest(phases, selectedPhaseIds, components)
  const selected = new Set(selectedPhaseIds)
  const phaseCount = phases.filter((phase) => (
    selected.has(phase.phaseId) && phaseEligibleChanges(phase, components).count > 0
  )).length
  const drafts = affectedDraftPackages(phases, selectedPhaseIds, components)
  const issued = affectedIssuedPackages(phases, selectedPhaseIds, components)

  return {
    phaseCount,
    lotCount: lotIds.length,
    optionCount: options.length,
    packageCount: drafts.length,
    packagesWithDocuments: drafts.filter((item) => item.hasDocuments).length,
    issuedPackageCount: issued.length,
  }
}

/** Plan price changes of a Phase grouped by Plan, so equal changes read once. */
export function groupPlanChanges(phase) {
  const groups = new Map()

  phase.lots.forEach((lot) => {
    if (!lot.plan) return
    const key = [
      lot.planId, lot.plan.fromBase, lot.plan.toBase,
      lot.plan.fromHardware, lot.plan.toHardware, lot.plan.locked,
    ].join('|')
    const group = groups.get(key) ?? { planCode: lot.planCode, ...lot.plan, lotCount: 0 }
    group.lotCount += 1
    groups.set(key, group)
  })

  return [...groups.values()]
}

/** Option price changes of a Phase grouped by Option, so equal changes read once. */
export function groupOptionChanges(phase) {
  const groups = new Map()

  phase.lots.forEach((lot) => {
    lot.options.forEach((option) => {
      const key = [
        option.optionId, option.fromPrice, option.fromNotApplicable,
        option.toPrice, option.toNotApplicable,
      ].join('|')
      const group = groups.get(key) ?? { ...option, lotCount: 0 }
      group.lotCount += 1
      groups.set(key, group)
    })
  })

  return sortOptionsByCode([...groups.values()])
}
