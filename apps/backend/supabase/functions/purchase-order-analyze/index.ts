// Analyzes a PURCHASE_ORDER Job document: reads the option lines the builder's work
// orders print and matches each header (Lot, Phase, Plan + elevation) with the
// Job's Lots. The lines are stored; comparing them with the system's options is
// done live by compare_purchase_orders, so it never goes stale.
//
// POST body: { job_document_id: uuid, force?: boolean }
//
// A PDF that is not a Purchase Order of options (or whose layout is not supported
// yet) ends as `not_option_po` with the reason: that is a result, not an error.
//
// Trust boundary: the caller's JWT and role are checked first and the document
// is read with the caller's own permissions (RLS). Only then does the function
// act as the system: it downloads the private PDF and writes the analysis with
// the service role. The service key and Storage URLs never reach the browser.
//
// Nothing from the document is logged. Errors are logged by class and code only.

import { handlePreflight, json } from '../_shared/cors.ts'
import { parsePurchaseOrder } from '../_shared/purchaseOrder.ts'
import { buildAnalysisRecord } from '../_shared/purchaseOrderRecord.ts'
import type { JobContext, JobPlanOption } from '../_shared/purchaseOrderResolve.ts'
import {
  decidePurchaseOrderAnalysis,
  type PurchaseOrderStatus,
} from '../_shared/purchaseOrderState.ts'
import { PurchaseOrderError } from '../_shared/purchaseOrderTypes.ts'
import { MAX_ANALYZED_PAGES, readReleasePdf, ReleasePdfError } from '../_shared/releasePdf.ts'
import { serviceClient, userClient } from '../_shared/supabase.ts'

const ALLOWED_ROLES = ['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT']
const MAX_PDF_BYTES = 25 * 1024 * 1024
const PAGE_SIZE = 1000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

const ANALYSIS_COLUMNS = [
  'id',
  'job_document_id',
  'job_id',
  'parser',
  'page_count',
  'issues',
  'status',
  'error',
  'requested_by',
  'analyzed_at',
  'created_at',
  'updated_at',
].join(', ')

type AdminClient = ReturnType<typeof serviceClient>

// The columns the function reads back. The select list is built at runtime, so
// the client cannot infer the row type and it is stated once here.
interface AnalysisRow {
  id: string
  status: PurchaseOrderStatus
  updated_at: string
}

const asAnalysisRow = (value: unknown) => value as AnalysisRow | null

async function authorizeUser(req: Request) {
  const caller = userClient(req)
  const {
    data: { user },
    error: authError,
  } = await caller.auth.getUser()
  if (authError || !user) return { kind: 'unauthenticated' as const }

  const { data: profile, error: profileError } = await caller
    .from('app_users')
    .select('role, is_active')
    .eq('id', user.id)
    .maybeSingle()
  if (profileError) throw profileError
  if (!profile?.is_active || !ALLOWED_ROLES.includes(profile.role)) {
    return { kind: 'forbidden' as const }
  }

  return { kind: 'allowed' as const, caller, userId: user.id }
}

function describeFailure(error: unknown) {
  if (error instanceof ReleasePdfError) {
    return { status: 422, message: error.message, log: error.name }
  }

  // Class name and database code only: an error object can carry row data.
  const code = (error as { code?: unknown })?.code
  return {
    status: 500,
    message: 'The Purchase Order analysis could not be completed. Try again.',
    log: `${(error as Error)?.name ?? 'Error'}${typeof code === 'string' ? ` ${code}` : ''}`,
  }
}

/** Reads the private PDF of a Job document and checks it is a PDF of a sane size. */
async function downloadPdf(
  db: AdminClient,
  document: { storage_bucket: string; storage_path: string },
) {
  const { data: file, error: downloadError } = await db.storage
    .from(document.storage_bucket)
    .download(document.storage_path)
  if (downloadError || !file) {
    throw new ReleasePdfError('The PDF could not be read from private Storage.')
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const header = new TextDecoder().decode(bytes.slice(0, 5))
  if (bytes.length === 0 || bytes.length > MAX_PDF_BYTES || header !== '%PDF-') {
    throw new ReleasePdfError('The file is not a valid PDF of 25 MB or less.')
  }
  return bytes
}

/** Every row of a query, one page at a time (a Job can hold more than one page of Lots). */
async function fetchAll<Row>(
  page: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>,
) {
  const rows: Row[] = []
  for (let from = 0;; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if ((data ?? []).length < PAGE_SIZE) return rows
  }
}

/** The Job's Phases, Plans, Lots and active options, plus the names a reviewer taught it. */
async function loadJobContext(db: AdminClient, jobId: number) {
  const [phases, plans, lots, aliasRows] = await Promise.all([
    fetchAll((from, to) =>
      db.from('phases').select('id, code').eq('job_id', jobId).order('id').range(from, to)
    ),
    fetchAll((from, to) =>
      db.from('plans').select('id, code').eq('job_id', jobId).order('id').range(from, to)
    ),
    fetchAll((from, to) =>
      db.from('lots').select('id, phase_id, plan_id, lot_number').eq('job_id', jobId)
        .order('id').range(from, to)
    ),
    fetchAll((from, to) =>
      db.from('purchase_order_aliases').select('kind, raw_key, target_key').eq('job_id', jobId)
        .order('id').range(from, to)
    ),
  ])

  const planIds = plans.map((plan) => Number(plan.id))
  const optionRows = planIds.length === 0 ? [] : await fetchAll((from, to) =>
    db.from('plan_options').select('id, plan_id, code, name, description')
      .in('plan_id', planIds).eq('is_active', true).order('id').range(from, to)
  )

  const aliases = { phase: new Map<string, string>(), plan: new Map<string, string>() }
  for (const alias of aliasRows) {
    const kind = String(alias.kind)
    if (kind === 'phase' || kind === 'plan') {
      aliases[kind].set(String(alias.raw_key), String(alias.target_key))
    }
  }

  const context: JobContext = {
    phases: phases.map((phase) => ({ id: Number(phase.id), code: String(phase.code) })),
    plans: plans.map((plan) => ({ id: Number(plan.id), code: String(plan.code) })),
    lots: lots.map((lot) => ({
      id: Number(lot.id),
      phaseId: Number(lot.phase_id),
      planId: Number(lot.plan_id),
      lotNumber: String(lot.lot_number),
    })),
  }
  const options: JobPlanOption[] = optionRows.map((option) => ({
    id: Number(option.id),
    planId: Number(option.plan_id),
    code: String(option.code),
    name: String(option.name),
    description: option.description === null ? null : String(option.description),
  }))

  return { context, aliases, options }
}

async function markFailed(db: AdminClient, analysisId: string, message: string) {
  const { data } = await db
    .from('purchase_order_analyses')
    .update({ status: 'failed', error: message.slice(0, 500) })
    .eq('id', analysisId)
    .select(ANALYSIS_COLUMNS)
    .maybeSingle()
  return data ?? null
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  let db: AdminClient | null = null
  let claimedId: string | null = null

  try {
    const auth = await authorizeUser(req)
    if (auth.kind === 'unauthenticated') return json({ error: 'Sign in first.' }, 401)
    if (auth.kind === 'forbidden') {
      return json({
        error: 'Only Admin, Accounting or Project Management users can analyze Purchase Orders.',
      }, 403)
    }

    const body = await req.json().catch(() => null)
    const documentId = body?.job_document_id
    if (typeof documentId !== 'string' || !UUID_PATTERN.test(documentId)) {
      return json({ error: 'Select a valid Job document.' }, 400)
    }

    // RLS: the caller must be able to see this document.
    const { data: document, error: documentError } = await auth.caller
      .from('job_documents')
      .select('id, job_id, document_type, storage_bucket, storage_path, original_name, size_bytes')
      .eq('id', documentId)
      .maybeSingle()
    if (documentError) throw documentError
    if (!document) return json({ error: 'The Job document is no longer available.' }, 404)
    if (document.document_type !== 'PURCHASE_ORDER') {
      return json({
        error: 'Only Purchase Order documents can be analyzed as Purchase Orders.',
      }, 400)
    }

    db = serviceClient()
    const { data: existingRow, error: existingError } = await db
      .from('purchase_order_analyses')
      .select(ANALYSIS_COLUMNS)
      .eq('job_document_id', document.id)
      .maybeSingle()
    if (existingError) throw existingError
    const existing = asAnalysisRow(existingRow)

    const decision = decidePurchaseOrderAnalysis(
      existing ? { status: existing.status, updatedAt: existing.updated_at } : null,
      { force: body?.force === true, now: Date.now() },
    )
    if (decision === 'return_existing') return json({ analysis: existingRow, reused: true })
    if (decision === 'in_progress') {
      return json({
        error: 'This Purchase Order is already being analyzed. Try again in a moment.',
        analysis: existingRow,
      }, 409)
    }

    // Claim the document before the slow work, so a second request sees
    // `analyzing` instead of starting a duplicate analysis.
    const claim = decision === 'create'
      ? await db
        .from('purchase_order_analyses')
        .insert({
          job_document_id: document.id,
          requested_by: auth.userId,
          status: 'analyzing',
        })
        .select(ANALYSIS_COLUMNS)
        .single()
      : await db
        .from('purchase_order_analyses')
        .update({ status: 'analyzing', error: null, requested_by: auth.userId })
        .eq('id', existing!.id)
        .eq('status', existing!.status)
        .eq('updated_at', existing!.updated_at)
        .select(ANALYSIS_COLUMNS)
        .maybeSingle()
    if (claim.error?.code === '23505') {
      return json({
        error: 'This Purchase Order is already being analyzed. Try again in a moment.',
      }, 409)
    }
    if (claim.error) throw claim.error
    if (!claim.data) {
      return json({ error: 'This Purchase Order changed while it was being opened. Try again.' }, 409)
    }
    claimedId = asAnalysisRow(claim.data)!.id

    const content = await readReleasePdf(await downloadPdf(db, document), {
      maxContentPages: MAX_ANALYZED_PAGES,
    })

    let saved: { columns: Record<string, unknown>; rows: unknown[] } | null = null
    let status: 'analyzed' | 'not_option_po' = 'analyzed'
    try {
      const parsed = parsePurchaseOrder(content.pages)
      const job = await loadJobContext(db, document.job_id)
      saved = buildAnalysisRecord({ parsed, pageCount: content.pageCount, ...job })
      if (saved.rows.length === 0) {
        throw new PurchaseOrderError(
          'unrecognized_layout',
          'No option lines were found in this Purchase Order.',
        )
      }
    } catch (error) {
      if (!(error instanceof PurchaseOrderError)) throw error
      // Not a Purchase Order of options (or not a layout we read yet): a result.
      status = 'not_option_po'
      saved = { columns: { error: error.message }, rows: [] }
    }

    const { error: saveError } = await db.rpc('save_purchase_order_analysis', {
      p_analysis_id: claimedId,
      p_status: status,
      p_columns: saved.columns,
      p_lines: saved.rows,
    })
    if (saveError) throw saveError

    const { data: analysis, error: readError } = await db
      .from('purchase_order_analyses')
      .select(ANALYSIS_COLUMNS)
      .eq('id', claimedId)
      .single()
    if (readError) throw readError

    return json({ analysis, lineCount: saved.rows.length, reused: false })
  } catch (error) {
    const failure = describeFailure(error)
    console.error('Purchase Order analysis failed:', failure.log)
    const analysis = db && claimedId
      ? await markFailed(db, claimedId, failure.message).catch(() => null)
      : null
    return json({ error: failure.message, analysis }, failure.status)
  }
})
