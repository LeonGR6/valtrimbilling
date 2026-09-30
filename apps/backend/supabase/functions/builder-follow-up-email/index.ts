import {
  type BuilderFollowUpEscalationSnapshot,
  type BuilderFollowUpEmailSnapshot,
  type BuilderFollowUpResponseEmailSnapshot,
  renderBuilderFollowUpEscalationEmail,
  renderBuilderFollowUpEmail,
  renderBuilderFollowUpResponseEmail,
  sendBuilderFollowUpEscalationWithResend,
  sendBuilderFollowUpWithResend,
  sendBuilderFollowUpResponseWithResend,
} from '../_shared/builderFollowUpEmail.ts'
import {
  buildBuilderFollowUpResponseLinks,
  createBuilderFollowUpResponseToken,
} from '../_shared/builderFollowUpResponse.ts'
import { handlePreflight, json } from '../_shared/cors.ts'
import { serviceClient, userClient } from '../_shared/supabase.ts'

type Action =
  | 'status'
  | 'preview_checkpoint'
  | 'send_checkpoint'
  | 'preview_escalation'
  | 'send_escalation'
  | 'send_due'

interface RequestBody {
  action?: Action
  checkpointId?: string | number
  escalationId?: string | number
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

function previewResponseLinks() {
  const base = Deno.env.get('FOLLOW_UP_PUBLIC_APP_URL')?.trim()
    || 'http://localhost:5173'
  return buildBuilderFollowUpResponseLinks(base, 'preview-token')
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

function escalationId(value: unknown) {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9][0-9]*$/u.test(normalized)) {
    throw new Error('Select a valid no-response escalation.')
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

function isEscalationSnapshot(value: unknown): value is BuilderFollowUpEscalationSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Record<string, unknown>
  if (snapshot.alreadySent === true) return true
  return typeof snapshot.escalationId === 'string'
    && typeof snapshot.idempotencyKey === 'string'
    && typeof snapshot.noResponseEventId === 'string'
    && typeof snapshot.scheduleId === 'string'
    && typeof snapshot.noResponseSince === 'string'
    && typeof snapshot.waitBusinessDays === 'number'
    && typeof snapshot.workDate === 'string'
    && ['EXT', 'SHUTTER', 'DM', 'HW'].includes(String(snapshot.stageType))
    && typeof snapshot.superintendentName === 'string'
    && typeof snapshot.superintendentEmail === 'string'
    && Array.isArray(snapshot.recipientEmails)
    && snapshot.recipientEmails.length > 0
    && snapshot.recipientEmails.every((email) => typeof email === 'string')
}

function isResponseEmailSnapshot(
  value: unknown,
): value is BuilderFollowUpResponseEmailSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Record<string, unknown>
  if (snapshot.alreadySent === true) {
    return typeof snapshot.notificationId === 'string'
  }
  return typeof snapshot.notificationId === 'string'
    && ['JOBSITE_RECEIPT', 'INTERNAL_ALERT'].includes(String(snapshot.notificationType))
    && typeof snapshot.idempotencyKey === 'string'
    && Array.isArray(snapshot.recipientEmails)
    && snapshot.recipientEmails.length > 0
    && snapshot.recipientEmails.every((email) => typeof email === 'string')
    && ['CONFIRMED', 'NOT_READY'].includes(String(snapshot.responseAction))
    && typeof snapshot.targetWorkDate === 'string'
    && typeof snapshot.finalWorkDate === 'string'
    && typeof snapshot.superintendentName === 'string'
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

async function prepareEscalation(
  admin: ReturnType<typeof serviceClient>,
  id: string,
  preview: boolean,
) {
  const { data, error } = await admin.rpc('prepare_builder_follow_up_escalation', {
    p_escalation_id: id,
    p_preview: preview,
  })
  if (error) throw error
  if (!isEscalationSnapshot(data)) {
    throw new Error('The no-response escalation snapshot is invalid.')
  }
  return data
}

async function issueResponseLinks(
  admin: ReturnType<typeof serviceClient>,
  snapshot: BuilderFollowUpEmailSnapshot,
) {
  if (!snapshot.outboxId) throw new Error('The Builder follow-up outbox item is missing.')
  const { data, error } = await admin.rpc('issue_builder_follow_up_response_token', {
    p_outbox_id: snapshot.outboxId,
  })
  if (error) throw error

  const publicId = String(data?.publicId ?? '').trim()
  if (!publicId) throw new Error('The Builder follow-up response id is missing.')
  const token = await createBuilderFollowUpResponseToken(
    publicId,
    requiredLiveEnv('FOLLOW_UP_RESPONSE_SECRET'),
  )
  return buildBuilderFollowUpResponseLinks(
    requiredLiveEnv('FOLLOW_UP_PUBLIC_APP_URL'),
    token,
  )
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

async function finishEscalation(
  admin: ReturnType<typeof serviceClient>,
  snapshot: BuilderFollowUpEscalationSnapshot,
  rendered: ReturnType<typeof renderBuilderFollowUpEscalationEmail>,
  success: boolean,
  providerMessageId: string | null,
  lastError: string | null,
) {
  const { data, error } = await admin.rpc('finish_builder_follow_up_escalation', {
    p_escalation_id: snapshot.escalationId,
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

async function finishResponseEmail(
  admin: ReturnType<typeof serviceClient>,
  snapshot: BuilderFollowUpResponseEmailSnapshot,
  rendered: ReturnType<typeof renderBuilderFollowUpResponseEmail>,
  success: boolean,
  providerMessageId: string | null,
  lastError: string | null,
) {
  const { data, error } = await admin.rpc('finish_builder_follow_up_response_email', {
    p_notification_id: snapshot.notificationId,
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

  let rendered = renderBuilderFollowUpEmail(snapshot, previewResponseLinks())
  if (preview) {
    return { checkpointId: id, sent: false, preview: true, snapshot, rendered }
  }

  const apiKey = requiredLiveEnv('RESEND_API_KEY')
  const from = requiredLiveEnv('FOLLOW_UP_FROM_EMAIL')
  const replyTo = requiredLiveEnv('FOLLOW_UP_REPLY_TO')

  try {
    rendered = renderBuilderFollowUpEmail(
      snapshot,
      await issueResponseLinks(admin, snapshot),
    )
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

async function processEscalation(
  admin: ReturnType<typeof serviceClient>,
  id: string,
  mode: 'PREVIEW' | 'LIVE',
) {
  const preview = mode !== 'LIVE'
  const snapshot = await prepareEscalation(admin, id, preview)
  if (snapshot.alreadySent) {
    return {
      type: 'ESCALATION' as const,
      escalationId: id,
      sent: true,
      alreadySent: true,
      providerMessageId: snapshot.providerMessageId,
    }
  }

  const rendered = renderBuilderFollowUpEscalationEmail(snapshot)
  if (preview) {
    return {
      type: 'ESCALATION' as const,
      escalationId: id,
      sent: false,
      preview: true,
      snapshot,
      rendered,
    }
  }

  const apiKey = requiredLiveEnv('RESEND_API_KEY')
  const from = requiredLiveEnv('FOLLOW_UP_FROM_EMAIL')
  const replyTo = requiredLiveEnv('FOLLOW_UP_REPLY_TO')

  try {
    const providerMessageId = await sendBuilderFollowUpEscalationWithResend({
      apiKey,
      from,
      replyTo,
      snapshot,
      rendered,
    })
    const sentAt = await finishEscalation(
      admin,
      snapshot,
      rendered,
      true,
      providerMessageId,
      null,
    )
    return {
      type: 'ESCALATION' as const,
      escalationId: id,
      sent: true,
      providerMessageId,
      sentAt,
    }
  } catch (error) {
    const message = safeError(error)
    try {
      await finishEscalation(admin, snapshot, rendered, false, null, message)
    } catch (finishError) {
      console.error('Recording no-response escalation delivery failure failed:', finishError)
    }
    throw error
  }
}

async function processResponseEmail(
  admin: ReturnType<typeof serviceClient>,
  id: string,
) {
  const { data, error } = await admin.rpc('prepare_builder_follow_up_response_email', {
    p_notification_id: id,
  })
  if (error) throw error
  if (!isResponseEmailSnapshot(data)) {
    throw new Error('The follow-up response email snapshot is invalid.')
  }
  if (data.alreadySent) {
    return {
      type: 'RESPONSE_NOTIFICATION' as const,
      notificationId: id,
      sent: true,
      alreadySent: true,
      providerMessageId: data.providerMessageId,
    }
  }

  const rendered = renderBuilderFollowUpResponseEmail(data)
  try {
    const providerMessageId = await sendBuilderFollowUpResponseWithResend({
      apiKey: requiredLiveEnv('RESEND_API_KEY'),
      from: requiredLiveEnv('FOLLOW_UP_FROM_EMAIL'),
      replyTo: requiredLiveEnv('FOLLOW_UP_REPLY_TO'),
      snapshot: data,
      rendered,
    })
    const sentAt = await finishResponseEmail(
      admin,
      data,
      rendered,
      true,
      providerMessageId,
      null,
    )
    return {
      type: 'RESPONSE_NOTIFICATION' as const,
      notificationId: id,
      sent: true,
      providerMessageId,
      sentAt,
    }
  } catch (deliveryError) {
    const message = safeError(deliveryError)
    try {
      await finishResponseEmail(admin, data, rendered, false, null, message)
    } catch (finishError) {
      console.error('Recording follow-up response email failure failed:', finishError)
    }
    throw deliveryError
  }
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  try {
    const body = await req.json().catch(() => ({})) as RequestBody
    const action = body.action ?? 'status'
    if (![
      'status',
      'preview_checkpoint',
      'send_checkpoint',
      'preview_escalation',
      'send_escalation',
      'send_due',
    ].includes(action)) {
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
        rendered: renderBuilderFollowUpEmail(snapshot, previewResponseLinks()),
      })
    }

    if (action === 'preview_escalation') {
      const admin = serviceClient()
      const snapshot = await prepareEscalation(
        admin,
        escalationId(body.escalationId),
        true,
      )
      if (snapshot.alreadySent) return json({ mode, alreadySent: true, snapshot })
      return json({
        mode,
        preview: true,
        snapshot,
        rendered: renderBuilderFollowUpEscalationEmail(snapshot),
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


    if (action === 'send_escalation') {
      const result = await processEscalation(
        admin,
        escalationId(body.escalationId),
        mode,
      )
      return json({ mode, ...result })
    }

    const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 50)
    const [checkpointRefresh, escalationRefresh] = await Promise.all([
      admin.rpc('refresh_builder_follow_up_checkpoints'),
      admin.rpc('refresh_builder_follow_up_escalations'),
    ])
    if (checkpointRefresh.error) throw checkpointRefresh.error
    if (escalationRefresh.error) throw escalationRefresh.error

    const results = []
    if (mode === 'LIVE') {
      const { data: responseEmails, error: responseEmailError } = await admin
        .from('builder_follow_up_response_emails')
        .select('id')
        .in('status', ['PENDING', 'FAILED'])
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit)
      if (responseEmailError) throw responseEmailError

      for (const row of responseEmails ?? []) {
        try {
          results.push(await processResponseEmail(admin, String(row.id)))
        } catch (error) {
          results.push({
            type: 'RESPONSE_NOTIFICATION',
            notificationId: String(row.id),
            sent: false,
            error: safeError(error),
          })
        }
      }
    }

    const remainingAfterResponses = Math.max(limit - results.length, 0)
    let dueEscalations: Array<{ escalation_id: string | number }> = []
    if (remainingAfterResponses > 0) {
      const { data, error: escalationError } = await admin
        .from('builder_follow_up_attention_queue')
        .select('escalation_id')
        .in('delivery_status', ['DUE', 'OVERDUE', 'FAILED'])
        .not('escalation_id', 'is', null)
        .order('due_on', { ascending: true })
        .order('escalation_id', { ascending: true })
        .limit(remainingAfterResponses)
      if (escalationError) throw escalationError
      dueEscalations = data ?? []
    }

    for (const row of dueEscalations ?? []) {
      try {
        results.push(await processEscalation(
          admin,
          String(row.escalation_id),
          mode,
        ))
      } catch (error) {
        results.push({
          type: 'ESCALATION',
          escalationId: String(row.escalation_id),
          sent: false,
          error: safeError(error),
        })
      }
    }

    const remaining = Math.max(limit - results.length, 0)
    let dueRows: Array<{ checkpoint_id: string | number }> = []
    if (remaining > 0) {
      const { data, error: dueError } = await admin
        .from('builder_follow_up_queue')
        .select('checkpoint_id')
        .eq('checkpoint_status', 'PENDING')
        .in('delivery_status', ['DUE', 'OVERDUE', 'FAILED'])
        .order('due_on', { ascending: true })
        .order('checkpoint_id', { ascending: true })
        .limit(remaining)
      if (dueError) throw dueError
      dueRows = data ?? []
    }

    for (const row of dueRows ?? []) {
      try {
        results.push({
          type: 'FOLLOW_UP',
          ...await processCheckpoint(admin, String(row.checkpoint_id), mode),
        })
      } catch (error) {
        results.push({
          type: 'FOLLOW_UP',
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
    const escalationCount = results.filter((result) => result.type === 'ESCALATION').length
    const responseNotificationCount = results.filter(
      (result) => result.type === 'RESPONSE_NOTIFICATION',
    ).length
    const followUpCount = results.filter((result) => result.type === 'FOLLOW_UP').length
    return json({
      mode,
      processed: results.length,
      sent,
      failed,
      escalations: escalationCount,
      responseNotifications: responseNotificationCount,
      followUps: followUpCount,
      results,
    }, failed > 0 ? 207 : 200)
  } catch (error) {
    console.error('Builder follow-up email request failed:', error)
    return json({ error: safeError(error) }, 500)
  }
})
