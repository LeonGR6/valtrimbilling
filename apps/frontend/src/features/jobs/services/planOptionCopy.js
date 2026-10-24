// Copying Options from one Plan of a Job into another, so Plans that share most
// of their Options are not typed in one by one. Pure; the saving lives in the
// repository.

function sameOption(left, right) {
  return String(left.code).trim().toUpperCase() === String(right.code).trim().toUpperCase()
    && String(left.description ?? '').trim().toLowerCase()
      === String(right.description ?? '').trim().toLowerCase()
}

/** The Plans another Plan can copy from: any other Plan that has Options. */
export function plansToCopyFrom(plans, targetPlanId = null) {
  return plans.filter((plan) => (
    plan.id !== targetPlanId && (plan.options ?? []).length > 0
  ))
}

/**
 * The Options of `source`, each flagged when `target` already has the same one
 * (same OPT # and description), so copying twice does not repeat them.
 */
export function copyableOptions(source, target = null) {
  const existing = target?.options ?? []
  return (source?.options ?? []).map((option) => ({
    option,
    alreadyInTarget: existing.some((current) => sameOption(current, option)),
  }))
}

/** The Options to create from the ids picked, in the source Plan's order. */
export function optionsToCopy(source, selectedIds, target = null) {
  return copyableOptions(source, target)
    .filter(({ option, alreadyInTarget }) => selectedIds.has(option.id) && !alreadyInTarget)
    .map(({ option }) => ({ code: option.code, description: option.description }))
}

/** What the picker holds before a Plan is chosen. */
export const NO_COPY_SOURCE = ''
export const emptyCopySelection = { sourceId: NO_COPY_SOURCE, selectedIds: new Set() }

/** The Options picked in a picker value (`{ sourceId, selectedIds }`), ready to create. */
export function selectedCopyOptions(sources, value, target = null) {
  const source = sources.find(({ id }) => id === value.sourceId)
  return source ? optionsToCopy(source, value.selectedIds, target) : []
}
