import { sortOptionsByCode } from '../../../utils/optionOrder.js'

function moneyValue(value) {
  return value == null ? null : Number(value)
}

export function toJobPlanMutation(jobId, plan) {
  const code = plan.code.trim().toUpperCase()
  const name = plan.name.trim()

  return {
    job_id: Number(jobId),
    code,
    name: name || code,
    description: null,
  }
}

export function toPlanOptionMutation(planId, option) {
  const description = option.description.trim()

  return {
    plan_id: Number(planId),
    code: option.code.trim().toUpperCase(),
    name: description,
    description,
  }
}

export function toPlanOption(row, currentPrice = null) {
  return {
    id: row.id,
    planId: row.plan_id,
    code: row.code,
    description: row.description ?? row.name,
    price: moneyValue(currentPrice?.price),
    // NA: the price is $0 and shown as "NA"; it adds and subtracts nothing.
    priceNotApplicable: Boolean(currentPrice?.is_not_applicable),
    isActive: row.is_active,
  }
}

export function toJobPlan(row, currentPrice = null, options = []) {
  return {
    id: row.id,
    jobId: row.job_id,
    code: row.code,
    name: row.name === row.code && !row.description ? '' : row.name,
    price: moneyValue(currentPrice?.base_price),
    hardwarePrice: moneyValue(currentPrice?.hardware_price),
    isActive: row.is_active,
    options: sortOptionsByCode(options),
  }
}

export function toPlanPriceRpc(planId, basePrice, hardwarePrice) {
  return {
    p_plan_id: Number(planId),
    p_base_price: Number(basePrice),
    p_hardware_price: hardwarePrice == null ? null : Number(hardwarePrice),
  }
}

export function toOptionPriceRpc(optionId, price, notApplicable = false) {
  return {
    p_option_id: Number(optionId),
    p_price: notApplicable ? 0 : Number(price),
    p_not_applicable: Boolean(notApplicable),
  }
}

/**
 * The changed prices of the price sheet as set_job_prices takes them: the Plans (with their
 * Hardware price) and the Options (a price, or NA) of one Job.
 */
export function toJobPricesRpc(jobId, changes) {
  const plans = []
  const options = []

  for (const change of changes) {
    if (change.type === 'option') {
      options.push({
        option_id: Number(change.option.id),
        price: change.to.notApplicable ? 0 : Number(change.to.amount),
        not_applicable: Boolean(change.to.notApplicable),
      })
    } else {
      plans.push({
        plan_id: Number(change.plan.id),
        base_price: Number(change.to.base),
        hardware_price: change.to.hardware == null ? null : Number(change.to.hardware),
      })
    }
  }

  return { p_job_id: Number(jobId), p_plans: plans, p_options: options }
}

/** The Plans of a Job as they are once the changed prices are saved. */
export function applyJobPriceChanges(plans, changes) {
  const planChanges = new Map()
  const optionChanges = new Map()
  for (const change of changes) {
    if (change.type === 'option') optionChanges.set(change.option.id, change)
    else planChanges.set(change.plan.id, change)
  }

  return plans.map((plan) => {
    const planChange = planChanges.get(plan.id)
    const savedPlan = planChange
      ? {
        ...plan,
        price: Number(planChange.to.base),
        hardwarePrice: planChange.to.hardware == null ? null : Number(planChange.to.hardware),
      }
      : plan

    if (!(savedPlan.options ?? []).some((option) => optionChanges.has(option.id))) return savedPlan

    return {
      ...savedPlan,
      options: savedPlan.options.map((option) => {
        const change = optionChanges.get(option.id)
        if (!change) return option

        return {
          ...option,
          price: change.to.notApplicable ? 0 : Number(change.to.amount),
          priceNotApplicable: Boolean(change.to.notApplicable),
        }
      }),
    }
  })
}

export function mergeJobPlanRecord(currentPlan, updatedPlan) {
  return {
    ...currentPlan,
    ...updatedPlan,
    price: currentPlan.price,
    hardwarePrice: currentPlan.hardwarePrice,
    options: currentPlan.options ?? [],
  }
}

export function mergePlanOptionRecord(currentOption, updatedOption) {
  return {
    ...currentOption,
    ...updatedOption,
    price: currentOption.price,
    ...('priceNotApplicable' in currentOption
      ? { priceNotApplicable: currentOption.priceNotApplicable }
      : {}),
  }
}

/** What apply_plan_option_changes reports, with the names the page uses. */
export function toBulkChangeResult(data) {
  return {
    plansCreated: Number(data?.plans_created) || 0,
    plansRestored: Number(data?.plans_restored) || 0,
    plansUpdated: Number(data?.plans_updated) || 0,
    plansDeleted: Number(data?.plans_deleted) || 0,
    optionsCreated: Number(data?.options_created) || 0,
    optionsSkipped: Number(data?.options_skipped) || 0,
    optionsUpdated: Number(data?.options_updated) || 0,
    optionsDeleted: Number(data?.options_deleted) || 0,
    plans: (data?.plans ?? []).map((plan) => ({
      id: Number(plan.id),
      code: plan.code,
      created: Boolean(plan.created),
    })),
    optionPlanIds: (data?.option_plan_ids ?? []).map(Number),
  }
}
