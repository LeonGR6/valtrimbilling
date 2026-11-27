// Analyzes a PAYMENT_SCHEDULE Job document: finds every
// (Lot, draw) amount in the builder's table and where it sits on the page. It
// stores the result as a `needs_review` template; a person confirms the cells
// later through the confirm_payment_schedule_template RPC.
//
// POST body: { job_document_id: uuid, force?: boolean, use_ai?: boolean, learn_recipe?: boolean }
//
// A layout no parser knows is first looked up among the layouts remembered for the
// Job's builder (payment_schedule_recipes): read with one, nothing leaves the project.
// `learn_recipe` on a confirmed schedule that was read with AI remembers its layout
// for the builder, learned from the PDF and the confirmed cells
// (paymentScheduleRecipe.ts); only rules are stored, never document content.
//
// `use_ai` is the person's explicit request to read a layout no parser knows with
// AI (implies `force`). The parsers still run first; only when they fail are the
// text of the PDF and the Job's draws, Lots, Plans and prices sent to the model
// (Mistral, MISTRAL_API_KEY). The model only points at printed amounts and every
// answer is checked against the PDF and the Job (paymentScheduleAiVerify.ts).
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
import {
  analyzePaymentScheduleContent,
  analyzePaymentScheduleWithAi,
  readPaymentSchedulePdf,
} from '../_shared/paymentScheduleAnalysis.ts'
import {
  type AiJobContext,
  buildAiDocument,
  mistralScheduleReader,
  PaymentScheduleAiError,
} from '../_shared/paymentScheduleAi.ts'
import { verifyAiAnswer } from '../_shared/paymentScheduleAiVerify.ts'
import {
  learnRecipe,
  parseRecipeRules,
  readWithRecipe,
  RecipeError,
} from '../_shared/paymentScheduleRecipe.ts'
import type { ReleasePdfContent } from '../_shared/releasePdf.ts'
import { templateAnalysisColumns } from '../_shared/paymentScheduleRecord.ts'
import { type DrawName, PaymentScheduleError } from '../_shared/paymentScheduleTypes.ts'
import { decideAnalysis, type AnalysisStatus } from '../_shared/releaseAnalysisState.ts'
import { ReleasePdfError } from '../_shared/releasePdf.ts'
import { serviceClient, userClient } from '../_shared/supabase.ts'

const ALLOWED_ROLES = ['ADMIN', 'ACCOUNTING', 'DRAW_INVOICE']
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

function aiApiKey() {
  return Deno.env.get('MISTRAL_API_KEY')?.trim() || null
}

function describeFailure(error: unknown) {
  if (error instanceof PaymentScheduleError) {
    return { status: 422, message: error.message, log: error.name, reason: error.reason }
  }
  if (error instanceof ReleasePdfError) {
    return { status: 422, message: error.message, log: error.name }
  }
  if (error instanceof PaymentScheduleAiError) {
    return { status: 502, message: error.message, log: error.name }
  }
  if (error instanceof RecipeError) {
    return {
      status: 422,
      message: `This layout could not be remembered: ${error.message}`,
      log: error.name,
    }
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

/**
 * The draws of the Billing Setup the Job bills with. Some builders head the columns of a
 * schedule with these names instead of "1st Draw", and that is the only way to number
 * them. A schedule that does not need them is analyzed without, so a failure to read
 * them is not a failure of the analysis.
 */
async function loadDrawNames(db: AdminClient, jobId: number): Promise<DrawName[]> {
  try {
    const { data: job, error: jobError } = await db
      .from('jobs')
      .select('billing_setup_version_id')
      .eq('id', jobId)
      .maybeSingle()
    if (jobError) throw jobError
    if (!job?.billing_setup_version_id) return []

    const { data: draws, error: drawsError } = await db
      .from('billing_draws')
      .select('draw_number, name')
      .eq('setup_version_id', job.billing_setup_version_id)
    if (drawsError) throw drawsError
    return (draws ?? []).map((draw) => ({ draw: draw.draw_number, name: draw.name }))
  } catch (error) {
    // Class name and database code only, like every other failure here.
    const code = (error as { code?: unknown })?.code
    console.error(
      'Billing Setup draws could not be read:',
      `${(error as Error)?.name ?? 'Error'}${typeof code === 'string' ? ` ${code}` : ''}`,
    )
    return []
  }
}

/**
 * What the AI is told about the Job, and what its answer is checked against: the
 * draws of the Billing Setup with their percentages, and every Lot with its Phase,
 * Plan and price. A utility building is a Lot whose price the Phase's Lots share.
 */
async function loadAiJobContext(db: AdminClient, jobId: number): Promise<AiJobContext> {
  const { data: job, error: jobError } = await db
    .from('jobs')
    .select('billing_setup_version_id')
    .eq('id', jobId)
    .maybeSingle()
  if (jobError) throw jobError

  const [draws, lots, phases, plans] = await Promise.all([
    job?.billing_setup_version_id
      ? db.from('billing_draws')
        .select('draw_number, name, percentage')
        .eq('setup_version_id', job.billing_setup_version_id)
      : Promise.resolve({ data: [], error: null }),
    db.from('lots')
      .select('lot_number, phase_id, plan_id, plan_price_id, is_utility_building, utility_name')
      .eq('job_id', jobId),
    db.from('phases').select('id, code, is_active').eq('job_id', jobId),
    db.from('plans').select('id, code').eq('job_id', jobId),
  ])
  const failure = draws.error ?? lots.error ?? phases.error ?? plans.error
  if (failure) throw failure

  const planIds = (plans.data ?? []).map((plan) => plan.id)
  const { data: prices, error: pricesError } = planIds.length === 0
    ? { data: [], error: null }
    : await db.from('plan_prices')
      .select('id, plan_id, base_price, effective_to')
      .in('plan_id', planIds)
  if (pricesError) throw pricesError

  const toCents = (value: unknown) =>
    value === null || value === undefined || value === '' ? null : Math.round(Number(value) * 100)
  const priceById = new Map((prices ?? []).map((price) => [price.id, toCents(price.base_price)]))
  // A Lot without a price of its own takes the current price of its Plan.
  const currentByPlan = new Map(
    (prices ?? []).filter((price) => price.effective_to === null)
      .map((price) => [price.plan_id, toCents(price.base_price)]),
  )
  const planCode = new Map((plans.data ?? []).map((plan) => [plan.id, plan.code]))
  const activePhases = new Map(
    (phases.data ?? []).filter((phase) => phase.is_active).map((phase) => [phase.id, phase.code]),
  )

  return {
    draws: (draws.data ?? []).map((draw) => ({
      draw: draw.draw_number,
      name: draw.name,
      percentage: draw.percentage === null ? null : Number(draw.percentage),
    })),
    lots: (lots.data ?? [])
      .filter((lot) => activePhases.has(lot.phase_id) && lot.lot_number)
      .map((lot) => ({
        phase: activePhases.get(lot.phase_id)!,
        lot: lot.lot_number,
        plan: planCode.get(lot.plan_id) ?? null,
        priceCents: (lot.plan_price_id ? priceById.get(lot.plan_price_id) : undefined) ??
          currentByPlan.get(lot.plan_id) ?? null,
        utility: lot.is_utility_building === true,
      })),
  }
}

/** The builder of a Job, or null. */
async function jobBuilderId(db: AdminClient, jobId: number): Promise<number | null> {
  const { data, error } = await db.from('jobs').select('builder_id').eq('id', jobId).maybeSingle()
  if (error) throw error
  return data?.builder_id ?? null
}

/**
 * Reads the schedule with a layout remembered for the Job's builder, newest first.
 * Null when none fits. Nothing leaves the project.
 */
async function analyzeWithRecipes(
  db: AdminClient,
  jobId: number,
  content: ReleasePdfContent,
) {
  const builderId = await jobBuilderId(db, jobId)
  if (builderId === null) return null

  const { data: recipes, error } = await db
    .from('payment_schedule_recipes')
    .select('id, rules, learned_from_job_id')
    .eq('builder_id', builderId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  if (!recipes?.length) return null

  const document = buildAiDocument(content.pages)
  for (const recipe of recipes) {
    const rules = parseRecipeRules(recipe.rules)
    const answer = rules ? readWithRecipe(document, rules) : null
    if (!answer) continue

    let learnedFromJob: string | null = null
    if (recipe.learned_from_job_id) {
      const { data: job } = await db.from('jobs').select('code').eq('id', recipe.learned_from_job_id)
        .maybeSingle()
      learnedFromJob = job?.code ?? null
    }
    try {
      const verified = verifyAiAnswer(answer, document, await loadAiJobContext(db, jobId), 'recipe')
      return {
        ...verified,
        ai: { ...verified.ai, source: 'recipe' as const, recipe: { id: recipe.id, learnedFromJob } },
        detectionMethod: 'text_layer' as const,
        pageCount: content.pageCount,
        pageSizes: content.pageSizes,
      }
    } catch (error) {
      // A remembered layout that finds nothing here is not this schedule's.
      if (error instanceof PaymentScheduleError) continue
      throw error
    }
  }
  return null
}

/**
 * Remembers how a confirmed schedule read with AI is laid out, for the Job's builder.
 * Learned from the PDF and the confirmed cells; replaces an earlier recipe of the same
 * layout. Returns the recipe id and the builder's name.
 */
async function rememberLayout(
  db: AdminClient,
  document: { id: string; job_id: number; storage_bucket: string; storage_path: string },
  userId: string,
) {
  const { data: template, error: templateError } = await db
    .from('payment_schedule_templates')
    .select('id, status, mapping, analysis')
    .eq('job_document_id', document.id)
    .maybeSingle()
  if (templateError) throw templateError
  if (!template || template.status !== 'confirmed' || !template.mapping) {
    throw new RecipeError('confirm the Payment Schedule first.')
  }
  if (!template.analysis?.ai) {
    throw new RecipeError('only a layout read with AI is remembered; this one is read without it.')
  }

  const builderId = await jobBuilderId(db, document.job_id)
  if (builderId === null) throw new RecipeError('the Job has no builder.')

  const content = await readPaymentSchedulePdf(await downloadPdf(db, document))
  const learned = learnRecipe(buildAiDocument(content.pages), template.mapping)

  const { data: saved, error: saveError } = await db
    .from('payment_schedule_recipes')
    .upsert({
      builder_id: builderId,
      signature_key: learned.signatureKey,
      rules: learned.rules,
      learned_from_template_id: template.id,
      learned_from_job_id: document.job_id,
      created_by: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'builder_id,signature_key' })
    .select('id')
    .single()
  if (saveError) throw saveError

  const { data: builder } = await db.from('builders').select('name').eq('id', builderId).maybeSingle()
  return { id: saved.id, builder: builder?.name ?? null }
}

/**
 * Downloads the PDF of a Job document and reads its Lots and draws. A layout no parser
 * knows is read with a layout remembered for the builder, else, with `useAi`, with AI
 * (`useAi` skips the remembered layouts: the person asked for the AI).
 */
async function analyzeDocument(
  db: AdminClient,
  document: { job_id: number; storage_bucket: string; storage_path: string },
  { useAi = false }: { useAi?: boolean } = {},
) {
  const bytes = await downloadPdf(db, document)
  const content = await readPaymentSchedulePdf(bytes)
  try {
    return analyzePaymentScheduleContent(content, {
      drawNames: await loadDrawNames(db, document.job_id),
    })
  } catch (error) {
    if (!(error instanceof PaymentScheduleError) || error.reason !== 'unrecognized_layout') {
      throw error
    }
    if (!useAi) {
      const remembered = await analyzeWithRecipes(db, document.job_id, content)
      if (remembered) return remembered
      throw error
    }
    const apiKey = aiApiKey()
    if (!apiKey) {
      throw new PaymentScheduleAiError('Reading with AI is not set up on the server.')
    }
    return await analyzePaymentScheduleWithAi(
      content,
      await loadAiJobContext(db, document.job_id),
      mistralScheduleReader({
        apiKey,
        model: Deno.env.get('PAYMENT_SCHEDULE_AI_MODEL') ?? undefined,
      }),
    )
  }
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
    const learn = body?.learn_recipe === true
    const useAi = body?.use_ai === true
    const force = body?.force === true || useAi
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
    if (learn) {
      return json({ recipe: await rememberLayout(db, document, auth.userId) })
    }

    const { data: existingRow, error: existingError } = await db
      .from('payment_schedule_templates')
      .select(TEMPLATE_COLUMNS)
      .eq('job_document_id', document.id)
      .maybeSingle()
    if (existingError) throw existingError
    const existing = asTemplateRow(existingRow)

    // A confirmed schedule is refreshed in place: nothing is claimed, so a failure
    // cannot take it out of service.
    if (existing?.status === 'confirmed' && force) {
      const refreshed = await analyzeDocument(db, document, { useAi })
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
      { force, now: Date.now() },
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

    const analysis = await analyzeDocument(db, document, { useAi })

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
    return json({
      error: failure.message,
      template,
      // The parsers do not know this layout: the screen can offer to read it with AI.
      ...(failure.reason === 'unrecognized_layout'
        ? { reason: failure.reason, ai_available: aiApiKey() !== null }
        : {}),
    }, failure.status)
  }
})
