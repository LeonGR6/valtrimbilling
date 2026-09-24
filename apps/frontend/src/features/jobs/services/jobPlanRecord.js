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

export function toOptionPriceRpc(optionId, price) {
  return {
    p_option_id: Number(optionId),
    p_price: Number(price),
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
  }
}
