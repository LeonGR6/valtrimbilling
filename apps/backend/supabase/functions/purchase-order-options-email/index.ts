// Tells Purchasing and the Job Coordinator which options a Purchase Order added to
// the Sequence Sheet: it renders the email for review (preview) and sends it (send).
//
// POST body: {
//   action: 'preview' | 'send',
//   jobId: number,
//   additions: [{ lotId, optionId, createdOption? }],   // what the import reported
//   recipientEmails?, subject?, requestId?               // send only
// }
//
// The browser only says WHICH options were added. Everything the email shows (the
// Lots, Plans, options, prices, work orders and the people it is addressed to) is
// loaded here with the signed-in user's own permissions, so a tampered request
// cannot make the email say something the database does not. An option that is not
// really selected for its Lot is left out.
//
// Sending uses Resend, like the Sequence Sheet email, and reuses its sender secrets.
// Nothing is logged but the error message.

import { handlePreflight, json } from '../_shared/cors.ts'
import {
  loadOptionsEmailSnapshot,
  type RequestedAddition,
} from '../_shared/purchaseOrderOptionsEmailLoader.ts'
import {
  buildOptionsEmailDraft,
  renderOptionsEmail,
} from '../_shared/purchaseOrderOptionsEmail.ts'
import { sendSequenceSheetWithResend } from '../_shared/sequenceSheetEmail.ts'
import { userClient } from '../_shared/supabase.ts'

type Action = 'preview' | 'send'

interface RequestBody {
  action?: Action
  jobId?: string | number
  additions?: unknown
  recipientEmails?: string[]
  subject?: string
  requestId?: string
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const MAX_ADDITIONS = 200
const MAX_RECIPIENTS = 10

function firstEnv(names: string[]) {
  for (const name of names) {
    const value = Deno.env.get(name)?.trim()
    if (value) return value
  }
  throw new Error(`Missing Edge Function secret: ${names.join(' or ')}.`)
}

function safeError(error: unknown) {
  if (!(error instanceof Error)) return 'Unknown Purchase Order options email error.'
  return error.message.slice(0, 1000)
}

function requiredPositiveId(value: unknown, label: string) {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9][0-9]*$/u.test(normalized)) throw new Error(`Select a valid ${label}.`)
  return normalized
}

function requestedAdditions(value: unknown): RequestedAddition[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ADDITIONS) {
    throw new Error(`Choose between 1 and ${MAX_ADDITIONS} added options.`)
  }
  const seen = new Set<string>()
  const additions: RequestedAddition[] = []
  for (const item of value) {
    const lotId = requiredPositiveId(item?.lotId, 'Lot')
    const optionId = requiredPositiveId(item?.optionId, 'option')
    const key = `${lotId}:${optionId}`
    if (seen.has(key)) continue
    seen.add(key)
    additions.push({ lotId, optionId, createdOption: item?.createdOption === true })
  }
  return additions
}

function recipientEmails(value: unknown) {
  if (!Array.isArray(value)) throw new Error('Enter at least one recipient email address.')

  const recipients = [...new Set(value.map((email) => String(email).trim().toLowerCase()))]
  if (recipients.length === 0 || recipients.some((email) => !EMAIL_PATTERN.test(email))) {
    throw new Error('Enter valid recipient email addresses.')
  }
  if (recipients.length > MAX_RECIPIENTS) {
    throw new Error(`The email can have up to ${MAX_RECIPIENTS} recipients.`)
  }
  return recipients
}

// The user may rewrite the subject in the dialog; only the shape is checked.
function subjectOverride(value: unknown, fallback: string) {
  if (value == null || String(value).trim() === '') return fallback
  const subject = String(value).trim()
  if (/[\r\n]/u.test(subject)) throw new Error('The subject must be a single line.')
  if (subject.length > 200) throw new Error('Use 200 characters or fewer in the subject.')
  return subject
}

function requestId(value: unknown) {
  const normalized = String(value ?? '').trim()
  if (!/^[A-Za-z0-9_-]{8,100}$/u.test(normalized)) {
    throw new Error('The email request identifier is invalid. Reopen the email dialog.')
  }
  return normalized
}

async function fingerprint(parts: string[]) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(parts.join('|')),
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
    .select('name, role, is_active')
    .eq('id', user.id)
    .maybeSingle()
  if (profileError) throw profileError
  if (!profile?.is_active || !['ADMIN', 'PROJECT_MANAGEMENT'].includes(profile.role)) {
    return null
  }

  return { caller, name: String(profile.name ?? user.email ?? 'A ValtrimBilling user') }
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  try {
    const auth = await authorizeUser(req)
    if (!auth) {
      return json({ error: 'Sign in with an Admin or Project Management role first.' }, 401)
    }

    const body = await req.json().catch(() => ({})) as RequestBody
    const action = body.action ?? 'preview'
    if (!['preview', 'send'].includes(action)) {
      return json({ error: 'Select a supported email action.' }, 400)
    }

    const { jobId, snapshot } = await loadOptionsEmailSnapshot(
      auth.caller,
      auth.name,
      requiredPositiveId(body.jobId, 'Job'),
      requestedAdditions(body.additions),
    )
    const rendered = renderOptionsEmail(snapshot)

    if (action === 'preview') {
      return json({
        preview: true,
        snapshot,
        rendered,
        draft: buildOptionsEmailDraft(snapshot),
      })
    }

    const recipients = recipientEmails(body.recipientEmails)
    const subject = subjectOverride(body.subject, rendered.subject)
    const idempotencyKey = [
      'purchase-order-options',
      jobId,
      requestId(body.requestId),
      await fingerprint([recipients.join(','), subject]),
    ].join('-')
    const providerMessageId = await sendSequenceSheetWithResend({
      apiKey: firstEnv(['RESEND_API_KEY']),
      from: firstEnv([
        'PURCHASE_ORDER_OPTIONS_FROM_EMAIL',
        'SEQUENCE_SHEET_FROM_EMAIL',
        'FOLLOW_UP_FROM_EMAIL',
      ]),
      replyTo: firstEnv([
        'PURCHASE_ORDER_OPTIONS_REPLY_TO',
        'SEQUENCE_SHEET_REPLY_TO',
        'FOLLOW_UP_REPLY_TO',
      ]),
      idempotencyKey,
      recipients,
      rendered: { ...rendered, subject },
    })

    return json({
      sent: true,
      sentAt: new Date().toISOString(),
      providerMessageId,
      recipients,
      rendered: { ...rendered, subject },
    })
  } catch (error) {
    console.error('Purchase Order options email failed:', error)
    return json({ error: safeError(error) }, 400)
  }
})
