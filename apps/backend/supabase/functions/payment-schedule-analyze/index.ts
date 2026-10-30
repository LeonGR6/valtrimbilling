// Analyzes a PAYMENT_SCHEDULE Job document: finds every
// (Lot, draw) amount in the builder's table and where it sits on the page. It
// stores the result as a `needs_review` template; a person confirms the cells
// later through the confirm_payment_schedule_template RPC.
//
// POST body: { job_document_id: uuid, force?: boolean }
//
// `force` on a template that is already confirmed refreshes what was detected
// (cells, draws, summary rows) and leaves its status and confirmed cells alone, so
// the schedule keeps working for Packages while it is reviewed again.
//
// Trust boundary: the caller's JWT and role are checked first and the document
// is read with the caller's own permissions (RLS). Only then does the function
// act as the system: it downloads the private PDF and writes the analysis with
// the service role. The service key and Storage URLs never reach the browser.
//
// Nothing from the document is logged. Errors are logged by class and code only.

import { handlePreflight, json } from '../_shared/cors.ts'
import { analyzePaymentSchedulePdf } from '../_shared/paymentScheduleAnalysis.ts'
import { templateAnalysisColumns } from '../_shared/paymentScheduleRecord.ts'
import { PaymentScheduleError } from '../_shared/paymentScheduleTypes.ts'
import { decideAnalysis, type AnalysisStatus } from '../_shared/releaseAnalysisState.ts'
import { ReleasePdfError } from '../_shared/releasePdf.ts'
import { serviceClient, userClient } from '../_shared/supabase.ts'

const ALLOWED_ROLES = ['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT']
const MAX_PDF_BYTES = 25 * 1024 * 1024
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

const TEMPLATE_COLUMNS = [
  'id',
  'job_document_id',
  'job_id',
  'layout',
  'detection_method',
  'page_count',
  'page_sizes',
  'detected_cells',
  'analysis',
  'mapping',
  'status',
  'error',
  'confirmed_by',
  'confirmed_at',
  'analyzed_at',
  'created_at',
  'updated_at',
].join(', ')

type AdminClient = ReturnType<typeof serviceClient>

// The columns the function reads back. The select list is built at runtime, so
// the client cannot infer the row type and it is stated once here.
interface TemplateRow {
  id: string
  status: AnalysisStatus
  updated_at: string
}

const asTemplateRow = (value: unknown) => value as TemplateRow | null

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
  if (error instanceof ReleasePdfError || error instanceof PaymentScheduleError) {
    return { status: 422, message: error.message, log: error.name }
  }

  // Class name and database code only: an error object can carry row data.
  const code = (error as { code?: unknown })?.code
  return {
    status: 500,
    message: 'The Payment Schedule analysis could not be completed. Try again.',
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

async function markFailed(db: AdminClient, templateId: string, message: string) {
  const { data } = await db
    .from('payment_schedule_templates')
    .update({ status: 'failed', error: message.slice(0, 500) })
    .eq('id', templateId)
    .select(TEMPLATE_COLUMNS)
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
        error: 'Only Admin, Accounting or Project Management users can analyze Payment Schedules.',
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
    if (document.document_type !== 'PAYMENT_SCHEDULE') {
      return json({
        error: 'Only Payment Schedule documents can be used as a Payment Schedule.',
      }, 400)
    }

    db = serviceClient()
    const { data: existingRow, error: existingError } = await db
      .from('payment_schedule_templates')
      .select(TEMPLATE_COLUMNS)
      .eq('job_document_id', document.id)
      .maybeSingle()
    if (existingError) throw existingError
    const existing = asTemplateRow(existingRow)

    // A confirmed schedule is refreshed in place: nothing is claimed, so a failure
    // cannot take it out of service.
    if (existing?.status === 'confirmed' && body?.force === true) {
      const refreshed = await analyzePaymentSchedulePdf(await downloadPdf(db, document))
      // Status, error and the confirmed cells are not part of a refresh.
      const { status: _status, error: _error, ...detected } = templateAnalysisColumns(refreshed)
      const { data: saved, error: saveError } = await db
        .from('payment_schedule_templates')
        .update(detected)
        .eq('id', existing.id)
        .eq('status', 'confirmed')
        .select(TEMPLATE_COLUMNS)
        .single()
      if (saveError) throw saveError
      return json({ template: saved, reused: false })
    }

    const decision = decideAnalysis(
      existing ? { status: existing.status, updatedAt: existing.updated_at } : null,
      { force: body?.force === true, now: Date.now() },
    )
    if (decision === 'return_existing') return json({ template: existingRow, reused: true })
    if (decision === 'in_progress') {
      return json({
        error: 'This Payment Schedule is already being analyzed. Try again in a moment.',
        template: existingRow,
      }, 409)
    }

    // Claim the document before the slow work, so a second request sees
    // `analyzing` instead of starting a duplicate analysis.
    const claim = decision === 'create'
      ? await db
        .from('payment_schedule_templates')
        .insert({
          job_document_id: document.id,
          requested_by: auth.userId,
          status: 'analyzing',
        })
        .select(TEMPLATE_COLUMNS)
        .single()
      : await db
        .from('payment_schedule_templates')
        .update({ status: 'analyzing', error: null, requested_by: auth.userId })
        .eq('id', existing!.id)
        .eq('status', existing!.status)
        .eq('updated_at', existing!.updated_at)
        .select(TEMPLATE_COLUMNS)
        .maybeSingle()
    if (claim.error?.code === '23505') {
      return json({
        error: 'This Payment Schedule is already being analyzed. Try again in a moment.',
      }, 409)
    }
    if (claim.error) throw claim.error
    if (!claim.data) {
      return json({ error: 'This Payment Schedule changed while it was being opened. Try again.' }, 409)
    }
    claimedId = asTemplateRow(claim.data)!.id

    const bytes = await downloadPdf(db, document)

    const analysis = await analyzePaymentSchedulePdf(bytes)

    const { data: saved, error: saveError } = await db
      .from('payment_schedule_templates')
      .update(templateAnalysisColumns(analysis))
      .eq('id', claimedId)
      .select(TEMPLATE_COLUMNS)
      .single()
    if (saveError) throw saveError

    return json({ template: saved, reused: false })
  } catch (error) {
    const failure = describeFailure(error)
    console.error('Payment Schedule analysis failed:', failure.log)
    const template = db && claimedId
      ? await markFailed(db, claimedId, failure.message).catch(() => null)
      : null
    return json({ error: failure.message, template }, failure.status)
  }
})
