import { requireSupabase } from '../../../services/api.js'
import {
  toJobPlan,
  toJobPlanMutation,
  toOptionPriceRpc,
  toPlanOption,
  toPlanOptionMutation,
  toPlanPriceRpc,
} from './jobPlanRecord.js'

const PLAN_COLUMNS = [
  'id',
  'job_id',
  'code',
  'name',
  'description',
  'is_active',
].join(', ')

const OPTION_COLUMNS = [
  'id',
  'plan_id',
  'code',
  'name',
  'description',
  'is_active',
].join(', ')

const PLAN_PRICE_COLUMNS = [
  'id',
  'plan_id',
  'base_price',
  'hardware_price',
  'effective_from',
  'effective_to',
].join(', ')

const OPTION_PRICE_COLUMNS = [
  'id',
  'option_id',
  'price',
  'effective_from',
  'effective_to',
].join(', ')

function throwRepositoryError(error) {
  if (!error) return

  if (error.code === '23505') {
    throw new Error('A Plan with that code already exists in this Job.', {
      cause: error,
    })
  }

  if (error.code === '42501') {
    throw new Error('You do not have permission to change Plans, Options or pricing.', {
      cause: error,
    })
  }

  if (error.code === '23503') {
    if (
      error.message?.includes('Reassign or remove')
      || error.message?.includes('assigned Lots')
    ) {
      throw new Error(error.message, { cause: error })
    }

    throw new Error('The selected Job, Plan or Option is no longer active.', {
      cause: error,
    })
  }

  if (error.code === '23514') {
    throw new Error('Review the price and enter a valid amount.', { cause: error })
  }

  throw new Error(error.message || 'The Plans and Options request failed.', {
    cause: error,
  })
}

function optionsByPlan(options) {
  return options.reduce((grouped, option) => {
    const planOptions = grouped.get(option.planId) ?? []
    planOptions.push(option)
    grouped.set(option.planId, planOptions)
    return grouped
  }, new Map())
}

export async function listJobPlans(jobIds) {
  const normalizedJobIds = [...new Set(jobIds.map(Number).filter(Number.isFinite))]
  if (normalizedJobIds.length === 0) return new Map()

  const client = await requireSupabase()
  const { data: planRows, error: plansError } = await client
    .from('plans')
    .select(PLAN_COLUMNS)
    .in('job_id', normalizedJobIds)
    .eq('is_active', true)
    .order('id', { ascending: true })

  throwRepositoryError(plansError)

  if (!planRows?.length) return new Map()

  const planIds = planRows.map(({ id }) => id)
  const [optionResult, planPriceResult] = await Promise.all([
    client
      .from('plan_options')
      .select(OPTION_COLUMNS)
      .in('plan_id', planIds)
      .eq('is_active', true)
      .order('id', { ascending: true }),
    client
      .from('plan_prices')
      .select(PLAN_PRICE_COLUMNS)
      .in('plan_id', planIds)
      .is('effective_to', null)
      .order('effective_from', { ascending: false }),
  ])

  throwRepositoryError(optionResult.error)
  throwRepositoryError(planPriceResult.error)

  const optionRows = optionResult.data ?? []
  const optionIds = optionRows.map(({ id }) => id)
  let optionPriceRows = []

  if (optionIds.length > 0) {
    const { data, error } = await client
      .from('option_prices')
      .select(OPTION_PRICE_COLUMNS)
      .in('option_id', optionIds)
      .is('effective_to', null)
      .order('effective_from', { ascending: false })

    throwRepositoryError(error)
    optionPriceRows = data ?? []
  }

  const planPrices = new Map(
    (planPriceResult.data ?? []).map((price) => [price.plan_id, price]),
  )
  const optionPrices = new Map(
    optionPriceRows.map((price) => [price.option_id, price]),
  )
  const groupedOptions = optionsByPlan(optionRows.map((row) => (
    toPlanOption(row, optionPrices.get(row.id))
  )))

  return planRows.reduce((grouped, row) => {
    const jobPlans = grouped.get(row.job_id) ?? []
    jobPlans.push(toJobPlan(
      row,
      planPrices.get(row.id),
      groupedOptions.get(row.id) ?? [],
    ))
    grouped.set(row.job_id, jobPlans)
    return grouped
  }, new Map())
}

export async function createJobPlan(jobId, plan) {
  const client = await requireSupabase()
  const mutation = toJobPlanMutation(jobId, plan)
  const { data: existing, error: existingError } = await client
    .from('plans')
    .select(PLAN_COLUMNS)
    .eq('job_id', mutation.job_id)
    .eq('code', mutation.code)
    .maybeSingle()

  throwRepositoryError(existingError)

  if (existing?.is_active) {
    throw new Error('A Plan with that code already exists in this Job.')
  }

  const query = existing
    ? client
        .from('plans')
        .update({
          code: mutation.code,
          name: mutation.name,
          description: mutation.description,
          is_active: true,
        })
        .eq('id', existing.id)
    : client.from('plans').insert(mutation)
  const { data, error } = await query.select(PLAN_COLUMNS).single()

  throwRepositoryError(error)
  if (!existing) return toJobPlan(data)

  const reloadedPlans = await listJobPlans([jobId])
  return reloadedPlans.get(Number(jobId))?.find((planRecord) => (
    planRecord.id === existing.id
  )) ?? toJobPlan(data)
}

export async function updateJobPlan(planId, plan) {
  const client = await requireSupabase()
  const mutation = toJobPlanMutation(plan.jobId, plan)
  const { data, error } = await client
    .from('plans')
    .update({
      code: mutation.code,
      name: mutation.name,
      description: mutation.description,
    })
    .eq('id', planId)
    .select(PLAN_COLUMNS)
    .single()

  throwRepositoryError(error)
  return toJobPlan(data)
}

export async function deactivateJobPlan(planId) {
  const client = await requireSupabase()
  const { error } = await client.rpc('deactivate_job_plan', {
    p_plan_id: Number(planId),
  })

  throwRepositoryError(error)
}

export async function createPlanOption(planId, option) {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('plan_options')
    .insert(toPlanOptionMutation(planId, option))
    .select(OPTION_COLUMNS)
    .single()

  throwRepositoryError(error)
  return toPlanOption(data)
}

export async function updatePlanOption(optionId, option) {
  const client = await requireSupabase()
  const mutation = toPlanOptionMutation(option.planId, option)
  const { data, error } = await client
    .from('plan_options')
    .update({
      code: mutation.code,
      name: mutation.name,
      description: mutation.description,
    })
    .eq('id', optionId)
    .select(OPTION_COLUMNS)
    .single()

  throwRepositoryError(error)
  return toPlanOption(data)
}

export async function deactivatePlanOption(optionId) {
  const client = await requireSupabase()
  const { error } = await client.rpc('deactivate_plan_option', {
    p_option_id: Number(optionId),
  })

  throwRepositoryError(error)
}

export async function saveJobPlanPrice(planId, basePrice, hardwarePrice) {
  const client = await requireSupabase()
  const { error } = await client.rpc(
    'set_plan_price',
    toPlanPriceRpc(planId, basePrice, hardwarePrice),
  )

  throwRepositoryError(error)
  return {
    price: Number(basePrice),
    hardwarePrice: hardwarePrice == null ? null : Number(hardwarePrice),
  }
}

export async function savePlanOptionPrice(optionId, price) {
  const client = await requireSupabase()
  const { error } = await client.rpc(
    'set_option_price',
    toOptionPriceRpc(optionId, price),
  )

  throwRepositoryError(error)
  return { price: Number(price) }
}
