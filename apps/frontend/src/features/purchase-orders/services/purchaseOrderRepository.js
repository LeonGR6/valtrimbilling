import { requireSupabase } from '../../../services/api.js'
import { PACKAGE_DOCUMENT_BUCKET } from '../../release-templates/services/packageRelease.js'
import {
  toComparisonLine,
  toImportResult,
  toPriceResult,
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

/**
 * Creates the options the chosen lines print that their Plan lacks and selects
 * them for the Lot. One transaction; what cannot be imported comes back skipped.
 */
export async function importPurchaseOrderOptions(lineIds) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc('import_purchase_order_options', {
    p_line_ids: lineIds.map(Number),
  })

  if (error) {
    if (error.code === '42501') {
      throw new Error('Only Admin and Project Management users can import options.', {
        cause: error,
      })
    }
    // Validation messages from the database are written for the reviewer.
    throw new Error(error.message || 'The options could not be imported.', { cause: error })
  }
  return toImportResult(data)
}

/**
 * Makes the price a Purchase Order prints the option's price in its Plan and moves
 * the chosen Lots to it, with a reason, in one transaction. A Draft Package that
 * bills it is calculated again; one that cannot change keeps its amount and the
 * difference is recorded. `removeDocuments` allows removing the Release and Payment
 * Schedule of those Draft Packages, which no longer match.
 */
export async function adoptPurchaseOrderPrice({ lineIds, reason, removeDocuments = false }) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc('use_purchase_order_price', {
    p_line_ids: lineIds.map(Number),
    p_reason: reason.trim(),
    p_remove_documents: Boolean(removeDocuments),
  })

  if (error) {
    const messages = {
      42501: 'Only Admin and Project Management users can change option prices.',
      40001: 'Prices or Packages changed since this list was loaded. Reload it and try again.',
      P0003: 'A Package has a generated Release or Payment Schedule. Confirm that they can be removed and try again.',
    }
    throw Object.assign(
      new Error(messages[error.code] ?? error.message ?? 'The price could not be changed.', {
        cause: error,
      }),
      { code: error.code },
    )
  }

  const result = toPriceResult(data)
  // Storage objects cannot be deleted from SQL: the removed PDFs go here, best effort.
  if (result.removedStoragePaths.length > 0) {
    await client.storage.from(PACKAGE_DOCUMENT_BUCKET).remove(result.removedStoragePaths)
      .catch(() => {})
  }
  return result
}

/**
 * The Lot and Phase every stored line of a Job's Purchase Orders was matched with, by
 * analysis. Superseded lines count too: they say which Phase a PDF belongs to.
 */
export async function listPurchaseOrderLineLots(jobId) {
  const client = await requireSupabase()
  const lotsByAnalysis = new Map()

  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await client
      .from('purchase_order_lines')
      .select('id, analysis_id, phase_id, lot_raw')
      .eq('job_id', Number(jobId))
      .order('id', { ascending: true })
      .range(start, start + PAGE_SIZE - 1)
    if (error) {
      throw new Error(error.message || 'The Purchase Order lots could not be loaded.', {
        cause: error,
      })
    }

    for (const row of data ?? []) {
      const list = lotsByAnalysis.get(row.analysis_id) ?? []
      list.push({
        phaseId: row.phase_id == null ? null : Number(row.phase_id),
        lotRaw: row.lot_raw ?? '',
      })
      lotsByAnalysis.set(row.analysis_id, list)
    }
    if ((data ?? []).length < PAGE_SIZE) break
  }

  return lotsByAnalysis
}
