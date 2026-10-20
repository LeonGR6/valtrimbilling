import { requireSupabase } from '../../../services/api.js'

function throwRepositoryError(error) {
  if (!error) return

  if (error.code === '42501') {
    throw new Error('You do not have permission to update Phase prices.', { cause: error })
  }
  if (error.code === '40001') {
    throw new Error(
      'Prices or Packages changed since this list was loaded. Reload it and try again.',
      { cause: error },
    )
  }
  if (error.code === '23514' || error.code === '23503') {
    throw new Error(error.message || 'Review the selected Phases.', { cause: error })
  }

  throw new Error(error.message || 'The Phase price request failed.', { cause: error })
}

/**
 * The Phases of a Job whose price differs from today's. `components` is 'PLAN',
 * 'OPTIONS' or 'ALL'; `planId` / `optionId` narrow it to what was just changed.
 */
export async function previewPhasePriceChanges(jobId, {
  planId = null,
  optionId = null,
  components = 'ALL',
} = {}) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc('preview_phase_price_changes', {
    p_job_id: Number(jobId),
    p_plan_id: planId == null ? null : Number(planId),
    p_option_id: optionId == null ? null : Number(optionId),
    p_components: components,
  })

  throwRepositoryError(error)
  return data ?? []
}

/** Moves the chosen Lots and Options to today's price. A reason is required. */
export async function applyPhasePriceChanges(jobId, { lotIds, options, reason }) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc('apply_phase_price_changes', {
    p_job_id: Number(jobId),
    p_lot_ids: lotIds.map(Number),
    p_options: options,
    p_reason: reason.trim(),
  })

  throwRepositoryError(error)
  return data
}
