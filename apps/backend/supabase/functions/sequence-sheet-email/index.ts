import {
  type SequenceSheetEmailLot,
  type SequenceSheetEmailOption,
  type SequenceSheetEmailSnapshot,
  renderSequenceSheetEmail,
  sendSequenceSheetWithResend,
} from '../_shared/sequenceSheetEmail.ts'
import { handlePreflight, json } from '../_shared/cors.ts'
import { userClient } from '../_shared/supabase.ts'

type Action = 'preview' | 'send'

interface RequestBody {
  action?: Action
  phaseId?: string | number
  recipientEmails?: string[]
  requestId?: string
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

function requiredEnv(primary: string, fallback?: string) {
  const value = Deno.env.get(primary)?.trim()
    || (fallback ? Deno.env.get(fallback)?.trim() : '')
  if (!value) {
    throw new Error(
      fallback
        ? `Missing Edge Function secret: ${primary} or ${fallback}.`
        : `Missing Edge Function secret: ${primary}.`,
    )
  }
  return value
}

function safeError(error: unknown) {
  if (!(error instanceof Error)) return 'Unknown Sequence Sheet email error.'
  return error.message.slice(0, 1000)
}

function requiredPositiveId(value: unknown, label: string) {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9][0-9]*$/u.test(normalized)) {
    throw new Error(`Select a valid ${label}.`)
  }
  return normalized
}

function recipientEmails(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error('Enter at least one recipient email address.')
  }

  const recipients = [...new Set(value.map((email) => String(email).trim().toLowerCase()))]
  if (recipients.length === 0 || recipients.some((email) => !EMAIL_PATTERN.test(email))) {
    throw new Error('Enter valid recipient email addresses separated by commas.')
  }
  if (recipients.length > 10) {
    throw new Error('A Sequence Sheet email can have up to 10 recipients.')
  }
  return recipients
}

function requestId(value: unknown) {
  const normalized = String(value ?? '').trim()
  if (!/^[A-Za-z0-9_-]{8,100}$/u.test(normalized)) {
    throw new Error('The email request identifier is invalid. Reopen the email dialog.')
  }
  return normalized
}

async function recipientFingerprint(recipients: string[]) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(recipients.join(',')),
  )
  return Array.from(new Uint8Array(digest).slice(0, 6))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

async function authorizeUser(req: Request) {
  const caller = userClient(req)
  const {
    data: { user },
    error: authError,
  } = await caller.auth.getUser()
  if (authError || !user) return null

  const { data: profile, error: profileError } = await caller
    .from('app_users')
    .select('role, is_active')
    .eq('id', user.id)
    .maybeSingle()
  if (profileError) throw profileError
  if (!profile?.is_active || !['ADMIN', 'PROJECT_MANAGEMENT'].includes(profile.role)) {
    return null
  }

  return caller
}

async function loadSnapshot(
  caller: ReturnType<typeof userClient>,
  phaseId: string,
): Promise<SequenceSheetEmailSnapshot> {
  const { data: phase, error: phaseError } = await caller
    .from('phases')
    .select('id, job_id, code, building, is_active')
    .eq('id', phaseId)
    .eq('is_active', true)
    .maybeSingle()
  if (phaseError) throw phaseError
  if (!phase) throw new Error('The selected Phase is no longer available.')

  const [{ data: job, error: jobError }, { data: lots, error: lotsError }] = await Promise.all([
    caller
      .from('jobs')
      .select('id, code, builder_id, community, superintendent_id, sequence_sheet_name, is_active')
      .eq('id', phase.job_id)
      .eq('is_active', true)
      .maybeSingle(),
    caller
      .from('lots')
      .select('id, plan_id, lot_number, is_reverse, display_order')
      .eq('phase_id', phase.id)
      .order('display_order', { ascending: true })
      .order('id', { ascending: true }),
  ])
  if (jobError) throw jobError
  if (lotsError) throw lotsError
  if (!job) throw new Error('The Job for this Phase is no longer available.')
  if (!lots?.length) throw new Error('The selected Phase has no Lots to email.')

  const planIds = [...new Set(lots.map((lot) => lot.plan_id))]
  const lotIds = lots.map((lot) => lot.id)
  const [builderResult, recipientResult, plansResult, lotOptionsResult] = await Promise.all([
    caller.from('builders').select('id, name').eq('id', job.builder_id).maybeSingle(),
    caller
      .from('builder_contacts')
      .select('id, name, email')
      .eq('id', job.superintendent_id)
      .maybeSingle(),
    caller.from('plans').select('id, code').in('id', planIds),
    caller.from('lot_options').select('lot_id, option_id').in('lot_id', lotIds),
  ])
  if (builderResult.error) throw builderResult.error
  if (recipientResult.error) throw recipientResult.error
  if (plansResult.error) throw plansResult.error
  if (lotOptionsResult.error) throw lotOptionsResult.error

  const optionIds = [...new Set((lotOptionsResult.data ?? []).map((row) => row.option_id))]
  const { data: options, error: optionsError } = optionIds.length === 0
    ? { data: [], error: null }
    : await caller
      .from('plan_options')
      .select('id, code, name, description')
      .in('id', optionIds)
  if (optionsError) throw optionsError

  const plansById = new Map(
    (plansResult.data ?? []).map((plan) => [String(plan.id), String(plan.code ?? '')]),
  )
  const optionsById = new Map(
    (options ?? []).map((option) => [String(option.id), {
      code: String(option.code ?? ''),
      description: String(option.description ?? option.name ?? ''),
    } satisfies SequenceSheetEmailOption]),
  )
  const optionIdsByLot = new Map<string, string[]>()
  for (const row of lotOptionsResult.data ?? []) {
    const key = String(row.lot_id)
    optionIdsByLot.set(key, [...(optionIdsByLot.get(key) ?? []), String(row.option_id)])
  }

  const emailLots: SequenceSheetEmailLot[] = lots.map((lot) => ({
    lotNumber: String(lot.lot_number ?? ''),
    planCode: plansById.get(String(lot.plan_id)) ?? 'Plan unavailable',
    reverse: Boolean(lot.is_reverse),
    options: (optionIdsByLot.get(String(lot.id)) ?? [])
      .map((optionId) => optionsById.get(optionId))
      .filter((option): option is SequenceSheetEmailOption => Boolean(option)),
  }))

  return {
    phaseId: String(phase.id),
    sequenceSheetName: String(job.sequence_sheet_name ?? 'Options Sequence Sheet'),
    jobCode: String(job.code ?? ''),
    community: String(job.community ?? ''),
    builderName: String(builderResult.data?.name ?? ''),
    phaseCode: String(phase.code ?? ''),
    building: String(phase.building ?? ''),
    defaultRecipientName: String(recipientResult.data?.name ?? ''),
    defaultRecipientEmail: String(recipientResult.data?.email ?? ''),
    lots: emailLots,
  }
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  try {
    const caller = await authorizeUser(req)
    if (!caller) {
      return json({ error: 'Sign in with an Admin or Project Management role first.' }, 401)
    }

    const body = await req.json().catch(() => ({})) as RequestBody
    const action = body.action ?? 'preview'
    if (!['preview', 'send'].includes(action)) {
      return json({ error: 'Select a supported Sequence Sheet email action.' }, 400)
    }

    const snapshot = await loadSnapshot(
      caller,
      requiredPositiveId(body.phaseId, 'Sequence Sheet Phase'),
    )
    const rendered = renderSequenceSheetEmail(snapshot)

    if (action === 'preview') {
      return json({ preview: true, snapshot, rendered })
    }

    const recipients = recipientEmails(body.recipientEmails)
    const idempotencyKey = [
      'sequence-sheet',
      snapshot.phaseId,
      requestId(body.requestId),
      await recipientFingerprint(recipients),
    ].join('-')
    const providerMessageId = await sendSequenceSheetWithResend({
      apiKey: requiredEnv('RESEND_API_KEY'),
      from: requiredEnv('SEQUENCE_SHEET_FROM_EMAIL', 'FOLLOW_UP_FROM_EMAIL'),
      replyTo: requiredEnv('SEQUENCE_SHEET_REPLY_TO', 'FOLLOW_UP_REPLY_TO'),
      idempotencyKey,
      recipients,
      rendered,
    })

    return json({
      sent: true,
      sentAt: new Date().toISOString(),
      providerMessageId,
      recipients,
      rendered,
    })
  } catch (error) {
    console.error('Sequence Sheet email failed:', error)
    return json({ error: safeError(error) }, 400)
  }
})
