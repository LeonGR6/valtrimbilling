import { requireSupabase } from '../../../services/api.js'
import { PACKAGE_DOCUMENT_BUCKET } from '../../release-templates/services/packageRelease.js'
import { mergePhasePreviews } from '../utils/priceWorksheet.js'

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
  if (error.code === 'P0003') {
    throw new Error(
      'A Package has a generated Release or Payment Schedule. Confirm that they can be removed and try again.',
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

/**
 * The Phases whose price differs from today's for several changed prices at once:
 * one look-up per changed Plan or Option price, merged into one list.
 */
export async function previewPhasePriceChangesFor(jobId, changes) {
  const previews = await Promise.all(changes.map((change) => (
    change.type === 'option'
      ? previewPhasePriceChanges(jobId, { optionId: change.option.id, components: 'OPTIONS' })
      : previewPhasePriceChanges(jobId, { planId: change.plan.id, components: 'PLAN' })
  )))

  return mergePhasePreviews(previews)
}

/**
 * Moves the chosen Lots and Options to today's price and calculates again the Draft
 * Packages that bill them. A reason is required. `removeDocuments` allows removing
 * the Release / Payment Schedule of those Packages, which no longer match.
 */
export async function applyPhasePriceChanges(jobId, {
  lotIds,
  options,
  reason,
  removeDocuments = false,
}) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc('apply_phase_price_changes', {
    p_job_id: Number(jobId),
    p_lot_ids: lotIds.map(Number),
    p_options: options,
    p_reason: reason.trim(),
    p_remove_documents: Boolean(removeDocuments),
  })

  throwRepositoryError(error)

  // Storage objects cannot be deleted from SQL: the removed PDFs go here, best effort.
  const paths = data?.removed_storage_paths ?? []
  if (paths.length > 0) {
    await client.storage.from(PACKAGE_DOCUMENT_BUCKET).remove(paths).catch(() => {})
  }

  return data
}
