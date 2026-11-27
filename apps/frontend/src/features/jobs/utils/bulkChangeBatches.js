// A big paste (thousands of Options) is saved in several requests, each one a transaction of its own.
// apply_plan_option_changes takes at most 3000 changes at a time and each request has to finish within
// the API's time limit; a request of this size takes about half a second.

/** Changes per request: a Plan counts one, and so does each Option, edit and deletion. */
export const BULK_BATCH_SIZE = 2000

const EMPTY_BATCH = () => ({
  new_plans: [],
  option_adds: [],
  plan_updates: [],
  option_updates: [],
  deleted_plans: [],
  deleted_options: [],
})

export function countBulkChanges(changes) {
  const list = (key) => changes?.[key] ?? []
  return list('new_plans').reduce((sum, plan) => sum + 1 + (plan.options?.length ?? 0), 0)
    + list('option_adds').length
    + list('plan_updates').length
    + list('option_updates').length
    + list('deleted_plans').length
    + list('deleted_options').length
}

/**
 * Cuts the changes of a save into batches of at most `size` changes, in the order the database applies
 * them (deletions, Plan edits, Option edits, new Plans with their Options, new Options). What has to be
 * together stays together: all the Plan edits go in one batch (two Plans can swap codes only in one
 * transaction), and a new Plan whose Options do not fit is repeated in the next batch with the rest of
 * them, which the database reads as the same Plan (same code) getting more Options.
 */
export function splitBulkChanges(changes, size = BULK_BATCH_SIZE) {
  const batches = []
  let batch = EMPTY_BATCH()
  let used = 0

  const flush = () => {
    if (used === 0) return
    batches.push(batch)
    batch = EMPTY_BATCH()
    used = 0
  }
  // Adds `weight` changes through `add`, starting a new batch first if they do not fit in this one.
  const place = (weight, add) => {
    if (used > 0 && used + weight > size) flush()
    add(batch)
    used += weight
  }

  for (const id of changes.deleted_plans ?? []) place(1, (target) => target.deleted_plans.push(id))
  for (const id of changes.deleted_options ?? []) place(1, (target) => target.deleted_options.push(id))

  const planUpdates = changes.plan_updates ?? []
  if (planUpdates.length > 0) place(planUpdates.length, (target) => target.plan_updates.push(...planUpdates))

  for (const update of changes.option_updates ?? []) place(1, (target) => target.option_updates.push(update))

  for (const plan of changes.new_plans ?? []) {
    const options = plan.options ?? []
    let from = 0
    do {
      // Room left in this batch for the Plan itself and at least one Option, else a fresh batch.
      if (used > 0 && used + 2 > size) flush()
      const room = Math.max(1, size - used - 1)
      const slice = options.slice(from, from + room)
      from += slice.length
      const part = { ...plan, options: slice }
      batch.new_plans.push(part)
      used += 1 + slice.length
      if (from < options.length) flush()
    } while (from < options.length)
  }

  for (const add of changes.option_adds ?? []) place(1, (target) => target.option_adds.push(add))

  flush()
  return batches
}

/** Adds up what each request answered, as toBulkChangeResult reads it. */
export function mergeBulkResults(results) {
  const total = {
    plansCreated: 0,
    plansRestored: 0,
    plansUpdated: 0,
    plansDeleted: 0,
    optionsCreated: 0,
    optionsSkipped: 0,
    optionsUpdated: 0,
    optionsDeleted: 0,
    plans: [],
    optionPlanIds: [],
  }
  const plansById = new Map()
  const optionPlanIds = new Set()

  for (const result of results) {
    total.plansCreated += result.plansCreated
    total.plansRestored += result.plansRestored
    total.plansUpdated += result.plansUpdated
    total.plansDeleted += result.plansDeleted
    total.optionsCreated += result.optionsCreated
    total.optionsSkipped += result.optionsSkipped
    total.optionsUpdated += result.optionsUpdated
    total.optionsDeleted += result.optionsDeleted
    for (const plan of result.plans) {
      // A Plan repeated in a later batch (more Options) was created, or restored, by the first one.
      const seen = plansById.get(plan.id)
      if (seen) seen.created = seen.created || plan.created
      else plansById.set(plan.id, { ...plan })
    }
    result.optionPlanIds.forEach((id) => optionPlanIds.add(id))
  }

  total.plans = [...plansById.values()]
  total.optionPlanIds = [...optionPlanIds]
  return total
}
