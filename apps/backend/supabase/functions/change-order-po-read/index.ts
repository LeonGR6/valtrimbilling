// Reads a builder Purchase Order PDF uploaded to a Job for its Extras / Change Orders: finds every order
// in it (number, kind, date, Lots, printed amounts) and saves them, replacing an earlier reading.
//
// POST body: { file_id: uuid }
//
// The text of the PDF is read here; scanned pages go to Mistral OCR, and the whole text goes to a
// Mistral model (MISTRAL_API_KEY) that says where each order is. The model only points at printed
// amounts, and every number it gives is checked against the PDF (changeOrderPoRead.ts).
//
// Trust boundary: the caller's JWT and role are checked first (ADMIN, PROJECT_MANAGEMENT, SCHEDULING, the
// roles that work Extras / COs) and the PDF record is read with the caller's own permissions (RLS). Only
// then does the function act as the system: it downloads the private PDF and saves the result with the
// service role. Nothing from the document is logged; errors are logged by class and code only.

import { handlePreflight, json } from '../_shared/cors.ts'
import {
  buildPoDocument,
  ChangeOrderPoReadError,
  pagesFromPdf,
  pagesWithoutText,
  type ReadPo,
  readOrdersWithAi,
  readWithOcr,
  withOcrText,
} from '../_shared/changeOrderPoRead.ts'
import { MAX_ANALYZED_PAGES, readReleasePdf, ReleasePdfError } from '../_shared/releasePdf.ts'
import { serviceClient, userClient } from '../_shared/supabase.ts'

const ALLOWED_ROLES = ['ADMIN', 'PROJECT_MANAGEMENT', 'SCHEDULING']
const MAX_PDF_BYTES = 25 * 1024 * 1024
// The whole reading (download, OCR, AI and a second AI try) stays inside the Edge Function wall clock.
const READ_BUDGET_MS = 140_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

const dollars = (cents: number | null) => (cents === null ? null : cents / 100)

/** What the database saves for each order read. */
function toSaved(order: ReadPo) {
  return {
    number: order.number,
    number_label: order.numberLabel,
    kind: order.kind,
    pages: order.pages,
    date: order.date,
    builder: order.builder,
    project: order.project,
    description: order.description,
    total: dollars(order.totalCents),
    net_total: dollars(order.netTotalCents),
    other_numbers: order.otherNumbers,
    warnings: order.warnings,
    lines: order.lines.map((line) => ({
      lots: line.lots,
      lots_text: line.lotsText,
      lots_checked: line.lotsChecked,
      phase: line.phase,
      building: line.building,
      plan: line.plan,
      description: line.description,
      amount: dollars(line.amountCents),
    })),
  }
}

function failure(error: unknown) {
  if (error instanceof ChangeOrderPoReadError || error instanceof ReleasePdfError) {
    return { status: 422, message: error.message, log: error.name }
  }
  const code = (error as { code?: unknown })?.code
  if (code === '55P03') return { status: 409, message: (error as Error).message, log: 'busy' }
  if (code === 'P0002') return { status: 404, message: 'The Purchase Order PDF is no longer available.', log: 'gone' }
  return {
    status: 500,
    message: 'The Purchase Order PDF could not be read. Try again.',
    log: `${(error as Error)?.name ?? 'Error'}${typeof code === 'string' ? ` ${code}` : ''}`,
  }
}

Deno.serve(async (req) => {
  const startedAt = Date.now()
  const preflight = handlePreflight(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  const body = await req.json().catch(() => null) as { file_id?: unknown } | null
  const fileId = typeof body?.file_id === 'string' ? body.file_id : ''
  if (!UUID_PATTERN.test(fileId)) return json({ error: 'Send the file_id of a Purchase Order PDF.' }, 400)

  const apiKey = Deno.env.get('MISTRAL_API_KEY')?.trim()
  if (!apiKey) return json({ error: 'Reading Purchase Orders is not set up (the AI key is missing).' }, 503)

  // Who is asking, with their own permissions.
  const caller = userClient(req)
  const { data: { user }, error: authError } = await caller.auth.getUser()
  if (authError || !user) return json({ error: 'Sign in again.' }, 401)
  const { data: profile, error: profileError } = await caller
    .from('app_users').select('role, is_active').eq('id', user.id).maybeSingle()
  if (profileError) return json({ error: 'Your role could not be checked. Try again.' }, 500)
  if (!profile?.is_active || !ALLOWED_ROLES.includes(profile.role)) {
    return json({ error: 'You do not have permission to read Purchase Orders.' }, 403)
  }
  const { data: file, error: fileError } = await caller
    .from('change_order_po_files')
    .select('id, storage_bucket, storage_path')
    .eq('id', fileId)
    .maybeSingle()
  if (fileError) return json({ error: 'The Purchase Order PDF could not be found. Try again.' }, 500)
  if (!file) return json({ error: 'The Purchase Order PDF is no longer available.' }, 404)

  const db = serviceClient()
  try {
    const { error: claimError } = await db.rpc('claim_change_order_po_read', { p_file_id: fileId })
    if (claimError) throw claimError
  } catch (error) {
    const result = failure(error)
    return json({ error: result.message }, result.status)
  }

  try {
    const { data: blob, error: downloadError } = await db.storage.from(file.storage_bucket).download(file.storage_path)
    if (downloadError || !blob) throw new ReleasePdfError('The PDF could not be read from private Storage.')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (bytes.length === 0 || bytes.length > MAX_PDF_BYTES || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') {
      throw new ReleasePdfError('The file is not a valid PDF of 25 MB or less.')
    }

    const content = await readReleasePdf(bytes, { maxContentPages: MAX_ANALYZED_PAGES })
    let pages = pagesFromPdf(content)
    const scanned = pagesWithoutText(pages)
    if (scanned.length > 0) pages = withOcrText(pages, await readWithOcr(bytes, { apiKey }), scanned)
    if (pagesWithoutText(pages).length === pages.length) {
      throw new ChangeOrderPoReadError('No text could be read from this PDF, not even with OCR.')
    }

    const { model, orders } = await readOrdersWithAi(buildPoDocument(pages), {
      apiKey,
      model: Deno.env.get('CHANGE_ORDER_PO_AI_MODEL') ?? undefined,
      deadline: startedAt + READ_BUDGET_MS,
    })
    const { data: saved, error: saveError } = await db.rpc('save_change_order_po_read', {
      p_file_id: fileId,
      p_orders: orders.map(toSaved),
      p_model: model,
      p_page_count: content.pageCount,
      p_ocr_pages: scanned,
    })
    if (saveError) throw saveError

    return json({
      file_id: fileId,
      orders: saved,
      ocr_pages: scanned,
      warnings: orders.reduce((total, order) => total + order.warnings.length, 0),
    })
  } catch (error) {
    const result = failure(error)
    if (result.status === 500) console.error('change-order-po-read failed:', result.log)
    await db.rpc('fail_change_order_po_read', { p_file_id: fileId, p_error: result.message })
    return json({ error: result.message }, result.status)
  }
})
