import { requireSupabase } from '../../../services/api.js'
import {
  toComparisonLine,
  toPurchaseOrderAnalysis,
  toUncoveredOption,
} from './purchaseOrderRecord.js'

const ANALYZE_FUNCTION = 'purchase-order-analyze'
const PAGE_SIZE = 1000

const ANALYSIS_COLUMNS = [
  'id',
  'job_document_id',
  'job_id',
  'parser',
  'page_count',
  'issues',
  'status',
  'error',
  'analyzed_at',
  'updated_at',
].join(', ')

async function functionErrorMessage(error, data, fallback) {
  if (data?.error) return data.error
  const response = error?.context
  if (response && typeof response.clone === 'function') {
    const payload = await response.clone().json().catch(() => null)
    if (payload?.error) return payload.error
  }
  return error?.message || fallback
}

async function invoke(body, fallback) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(ANALYZE_FUNCTION, { body })
  if (error || data?.error) {
    throw new Error(await functionErrorMessage(error, data, fallback), { cause: error })
  }
  return data
}

/** The analyses of a set of Purchase Order documents, by document id. */
export async function listPurchaseOrderAnalyses(documentIds) {
  if (documentIds.length === 0) return {}

  const client = await requireSupabase()
  const { data, error } = await client
    .from('purchase_order_analyses')
    .select(ANALYSIS_COLUMNS)
    .in('job_document_id', documentIds)

  if (error) {
    throw new Error(error.message || 'Purchase Orders could not be loaded.', { cause: error })
  }

  return Object.fromEntries(
    (data ?? []).map((row) => {
      const analysis = toPurchaseOrderAnalysis(row)
      return [analysis.documentId, analysis]
    }),
  )
}

export async function analyzePurchaseOrder(documentId, { force = false } = {}) {
  const data = await invoke(
    { job_document_id: documentId, force },
    'The Purchase Order analysis failed.',
  )
  return toPurchaseOrderAnalysis(data.analysis)
}

/** Matches the Job's stored Purchase Order lines with its Lots again. */
export async function rematchPurchaseOrders(documentId) {
  await invoke(
    { job_document_id: documentId, action: 'rematch' },
    'The Purchase Orders could not be matched again.',
  )
}

/** Accepts the suggested match of one work order and remembers the names it used. */
export async function confirmPurchaseOrderHeader({ documentId, workOrderNo }) {
  await invoke(
    { job_document_id: documentId, action: 'confirm_header', work_order_no: workOrderNo },
    'The match could not be confirmed.',
  )
}

/** Every current Purchase Order line of a Job against what the system holds. */
export async function comparePurchaseOrders(jobId) {
  const client = await requireSupabase()
  const rows = []

  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await client
      .rpc('compare_purchase_orders', { p_job_id: Number(jobId) })
      .range(start, start + PAGE_SIZE - 1)
    if (error) {
      throw new Error(error.message || 'The Purchase Orders could not be compared.', {
        cause: error,
      })
    }
    rows.push(...(data ?? []))
    if ((data ?? []).length < PAGE_SIZE) break
  }

  return rows.map(toComparisonLine)
}

/** Options a Lot has selected that no Purchase Order covers. */
export async function listUncoveredOptions(jobId) {
  const client = await requireSupabase()
  const rows = []

  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await client
      .rpc('purchase_order_uncovered_options', { p_job_id: Number(jobId) })
      .range(start, start + PAGE_SIZE - 1)
    if (error) {
      throw new Error(error.message || 'The uncovered options could not be loaded.', {
        cause: error,
      })
    }
    rows.push(...(data ?? []))
    if ((data ?? []).length < PAGE_SIZE) break
  }

  return rows.map(toUncoveredOption)
}
