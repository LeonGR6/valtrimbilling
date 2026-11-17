// The search of Plans & options and of Plan pricing: both look for the same words in the same
// places, so both lists narrow the same way.

/**
 * The Plans that match `query`: a Plan whose code or name has the words (any case) with all of its
 * Options, or a Plan with some Options that do, with only those Options. A narrowed Plan keeps
 * everything it had in `allOptions` and how many that was in `optionCount`.
 */
export function filterPlansByQuery(plans, query) {
  const needle = String(query ?? '').trim().toLowerCase()
  if (!needle) return plans

  const matches = (...values) => values.join(' ').toLowerCase().includes(needle)

  return plans.flatMap((plan) => {
    const allOptions = plan.options ?? []
    if (matches(plan.code, plan.name ?? '')) return [plan]

    const options = allOptions.filter((option) => matches(option.code, option.description ?? ''))
    return options.length > 0
      ? [{ ...plan, options, allOptions, optionCount: allOptions.length }]
      : []
  })
}
