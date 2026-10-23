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
    options,
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
