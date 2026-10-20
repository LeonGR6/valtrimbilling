// Updating the price of Phases that already exist. A Phase keeps the price it was
// created with; these helpers turn what the server reports into the list an
// administrator picks from, and the picked list into what the server is asked to
// change. Only what no Package has billed can move; the server enforces it too.

function money(value) {
  return value == null ? null : Number(value)
}

function toPlanChange(change) {
  if (!change) return null

  const fromBase = money(change.from_base)
  const toBase = money(change.to_base)
  const fromHardware = money(change.from_hardware)
  const toHardware = money(change.to_hardware)

  return {
    billed: Boolean(change.billed),
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
      options: (lot.option_changes ?? []).map(toOptionChange),
    })),
  }))
}

/**
 * What picking a Phase would change for the chosen components: the Lots whose
 * Plan price moves and the Options whose price moves. Billed ones are left out.
 */
export function phaseEligibleChanges(phase, { includePlan = true, includeOptions = true } = {}) {
  const lots = []
  const options = []
  let blocked = 0

  phase.lots.forEach((lot) => {
    if (includePlan && lot.plan) {
      if (lot.plan.billed) blocked += 1
      else lots.push(lot)
    }
    if (includeOptions) {
      lot.options.forEach((option) => {
        if (option.billed) blocked += 1
        else options.push({ lot, option })
      })
    }
  })

  return { lots, options, blocked, count: lots.length + options.length }
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

/** Totals for the confirmation line and the button. */
export function summarizePhasePriceRequest(phases, selectedPhaseIds, components) {
  const { lotIds, options } = buildPhasePriceRequest(phases, selectedPhaseIds, components)
  const selected = new Set(selectedPhaseIds)
  const phaseCount = phases.filter((phase) => (
    selected.has(phase.phaseId) && phaseEligibleChanges(phase, components).count > 0
  )).length

  return { phaseCount, lotCount: lotIds.length, optionCount: options.length }
}

/** Plan price changes of a Phase grouped by Plan, so equal changes read once. */
export function groupPlanChanges(phase) {
  const groups = new Map()

  phase.lots.forEach((lot) => {
    if (!lot.plan) return
    const key = [
      lot.planId, lot.plan.fromBase, lot.plan.toBase,
      lot.plan.fromHardware, lot.plan.toHardware, lot.plan.billed,
    ].join('|')
    const group = groups.get(key) ?? { planCode: lot.planCode, ...lot.plan, lotCount: 0 }
    group.lotCount += 1
    groups.set(key, group)
  })

  return [...groups.values()]
}
