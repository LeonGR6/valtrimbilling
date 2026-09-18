import {
  type BuilderFollowUpEmailSnapshot,
  renderBuilderFollowUpEmail,
  sendBuilderFollowUpWithResend,
} from '../_shared/builderFollowUpEmail.ts'
import { handlePreflight, json } from '../_shared/cors.ts'
import { serviceClient, userClient } from '../_shared/supabase.ts'

type Action = 'status' | 'preview_checkpoint' | 'send_checkpoint' | 'send_due'

interface RequestBody {
  action?: Action
  checkpointId?: string | number
  limit?: number
}

function emailMode() {
  return Deno.env.get('FOLLOW_UP_EMAIL_MODE')?.trim().toUpperCase() === 'LIVE'
    ? 'LIVE'
    : 'PREVIEW'
}

function requiredLiveEnv(name: string) {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing Edge Function secret: ${name}.`)
  return value
}

function safeError(error: unknown) {
  if (!(error instanceof Error)) return 'Unknown Builder follow-up email error.'
  return error.message.slice(0, 1000)
}

async function hashSecret(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return new Uint8Array(digest)
}

async function secretsMatch(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([hashSecret(left), hashSecret(right)])
  let difference = 0
  for (let index = 0; index < leftHash.length; index += 1) {
    difference |= leftHash[index] ^ rightHash[index]
  }
  return difference === 0
}

async function isCronRequest(req: Request, action: Action) {
  if (action !== 'send_due') return false
  const configuredSecret = Deno.env.get('FOLLOW_UP_CRON_SECRET')?.trim()
  const suppliedSecret = req.headers.get('x-valtrim-cron-secret')?.trim()
  if (!configuredSecret || !suppliedSecret) return false
  return secretsMatch(configuredSecret, suppliedSecret)
}

async function authorizeUser(req: Request) {
  const caller = userClient(req)
  const {
    data: { user },
    error: authError,
  } = await caller.auth.getUser()
  if (authError || !user) return false

  const { data: profile, error: profileError } = await caller
    .from('app_users')
    .select('role, is_active')
    .eq('id', user.id)
    .maybeSingle()
  if (profileError) throw profileError

  return Boolean(
    profile?.is_active
      && ['ADMIN', 'PROJECT_MANAGEMENT', 'SCHEDULING'].includes(profile.role),
  )
}

function checkpointId(value: unknown) {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9][0-9]*$/u.test(normalized)) {
    throw new Error('Select a valid Builder follow-up checkpoint.')
  }
  return normalized
}

function isSnapshot(value: unknown): value is BuilderFollowUpEmailSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Record<string, unknown>
  if (snapshot.alreadySent === true) return true
  return typeof snapshot.outboxId !== 'undefined'
    && typeof snapshot.idempotencyKey === 'string'
    && typeof snapshot.checkpointId === 'string'
    && typeof snapshot.scheduleId === 'string'
    && typeof snapshot.workDate === 'string'
    && ['EXT', 'DM', 'HW'].includes(String(snapshot.stageType))
    && typeof snapshot.recipientName === 'string'
    && typeof snapshot.recipientEmail === 'string'
}

async function prepareEmail(
  admin: ReturnType<typeof serviceClient>,
  id: string,
  preview: boolean,
) {
  const { data, error } = await admin.rpc('prepare_builder_follow_up_email', {
    p_checkpoint_id: id,
    p_preview: preview,
  })
  if (error) throw error
  if (!isSnapshot(data)) throw new Error('The Builder follow-up snapshot is invalid.')
  return data
}

async function finishEmail(
  admin: ReturnType<typeof serviceClient>,
  snapshot: BuilderFollowUpEmailSnapshot,
  rendered: ReturnType<typeof renderBuilderFollowUpEmail>,
  success: boolean,
  providerMessageId: string | null,
  lastError: string | null,
) {
  if (!snapshot.outboxId) throw new Error('The Builder follow-up outbox item is missing.')
  const { data, error } = await admin.rpc('finish_builder_follow_up_email', {
    p_outbox_id: snapshot.outboxId,
    p_success: success,
    p_subject: rendered.subject,
    p_text_body: rendered.text,
    p_html_body: rendered.html,
    p_provider_message_id: providerMessageId,
    p_last_error: lastError,
  })
  if (error) throw error
  return data as string
}

async function processCheckpoint(
  admin: ReturnType<typeof serviceClient>,
  id: string,
  mode: 'PREVIEW' | 'LIVE',
) {
  const preview = mode !== 'LIVE'
  const snapshot = await prepareEmail(admin, id, preview)
  if (snapshot.alreadySent) {
    return {
      checkpointId: id,
      sent: true,
      alreadySent: true,
      providerMessageId: snapshot.providerMessageId,
    }
  }

  const rendered = renderBuilderFollowUpEmail(snapshot)
  if (preview) {
    return { checkpointId: id, sent: false, preview: true, snapshot, rendered }
  }

  const apiKey = requiredLiveEnv('RESEND_API_KEY')
  const from = requiredLiveEnv('FOLLOW_UP_FROM_EMAIL')
  const replyTo = requiredLiveEnv('FOLLOW_UP_REPLY_TO')

  try {
    const providerMessageId = await sendBuilderFollowUpWithResend({
      apiKey,
      from,
      replyTo,
      snapshot,
      rendered,
    })
    const sentAt = await finishEmail(
      admin,
      snapshot,
      rendered,
      true,
      providerMessageId,
      null,
    )
    return { checkpointId: id, sent: true, providerMessageId, sentAt }
  } catch (error) {
    const message = safeError(error)
    try {
      await finishEmail(admin, snapshot, rendered, false, null, message)
    } catch (finishError) {
      console.error('Recording Builder follow-up delivery failure failed:', finishError)
    }
    throw error
  }
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  try {
    const body = await req.json().catch(() => ({})) as RequestBody
    const action = body.action ?? 'status'
    if (!['status', 'preview_checkpoint', 'send_checkpoint', 'send_due'].includes(action)) {
      return json({ error: 'Select a supported Builder follow-up action.' }, 400)
    }

    const cronAuthorized = await isCronRequest(req, action)
    if (!cronAuthorized && !await authorizeUser(req)) {
      return json({ error: 'Sign in with a Scheduling role first.' }, 401)
    }

    const mode = emailMode()
    if (action === 'status') return json({ mode })

    if (action === 'preview_checkpoint') {
      const admin = serviceClient()
      const snapshot = await prepareEmail(admin, checkpointId(body.checkpointId), true)
      if (snapshot.alreadySent) return json({ mode, alreadySent: true, snapshot })
      return json({
        mode,
        preview: true,
        snapshot,
        rendered: renderBuilderFollowUpEmail(snapshot),
      })
    }

    if (mode === 'LIVE') {
      requiredLiveEnv('RESEND_API_KEY')
      requiredLiveEnv('FOLLOW_UP_FROM_EMAIL')
      requiredLiveEnv('FOLLOW_UP_REPLY_TO')
    }

    const admin = serviceClient()
    if (action === 'send_checkpoint') {
      const result = await processCheckpoint(
        admin,
        checkpointId(body.checkpointId),
        mode,
      )
      return json({ mode, ...result })
    }

    const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 50)
    const { error: refreshError } = await admin.rpc('refresh_builder_follow_up_checkpoints')
    if (refreshError) throw refreshError
    const { data: dueRows, error: dueError } = await admin
      .from('builder_follow_up_queue')
      .select('checkpoint_id')
      .eq('checkpoint_status', 'PENDING')
      .in('delivery_status', ['DUE', 'OVERDUE', 'FAILED'])
      .order('due_on', { ascending: true })
      .order('checkpoint_id', { ascending: true })
      .limit(limit)
    if (dueError) throw dueError

    const results = []
    for (const row of dueRows ?? []) {
      try {
        results.push(await processCheckpoint(admin, String(row.checkpoint_id), mode))
      } catch (error) {
        results.push({
          checkpointId: String(row.checkpoint_id),
          sent: false,
          error: safeError(error),
        })
      }
    }

    const failed = results.filter((result) => 'error' in result).length
    const sent = results.filter((result) => (
      result.sent && !('alreadySent' in result && result.alreadySent)
    )).length
    return json({
      mode,
      processed: results.length,
      sent,
      failed,
      results,
    }, failed > 0 ? 207 : 200)
  } catch (error) {
    console.error('Builder follow-up email request failed:', error)
    return json({ error: safeError(error) }, 500)
  }
})
