// Which Plans and Options of a Job its Lots use. A Plan or an Option that a Lot uses cannot be
// deleted. Pure: nothing here touches the network or React.

/**
 * How many Lots use each Plan and each Option of the Job, in one pass over its Lots:
 * `{ plans: Map(planId -> lots), options: Map(optionId -> lots) }`. A Lot that uses an Option of a
 * Plan counts for the Plan too.
 */
export function getJobPlanUsage(job) {
  const planOfOption = new Map()
  for (const plan of job.sequenceSheet?.plans ?? []) {
    for (const option of plan.options ?? []) planOfOption.set(option.id, plan.id)
  }

  const plans = new Map()
  const options = new Map()
  const add = (map, id) => map.set(id, (map.get(id) ?? 0) + 1)

  for (const phase of job.sequenceSheet?.phases ?? []) {
    for (const lot of phase.lots ?? []) {
      const planIds = new Set()
      if (lot.planId != null) planIds.add(lot.planId)

      for (const optionId of lot.optionIds ?? []) {
        add(options, optionId)
        if (planOfOption.has(optionId)) planIds.add(planOfOption.get(optionId))
      }
      planIds.forEach((planId) => add(plans, planId))
    }
  }

  return { plans, options }
}
