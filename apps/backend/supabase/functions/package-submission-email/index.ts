import {
  decodePdfAttachment,
  parseRecipients,
  type PackageSubmissionContext,
  renderPackageSubmissionEmail,
  sendPackageSubmissionWithResend,
} from '../_shared/packageSubmissionEmail.ts'
import { handlePreflight, json } from '../_shared/cors.ts'
import { serviceClient, userClient } from '../_shared/supabase.ts'

// Sends a Draw Package PDF to the Builder by email, for a Builder whose setup
// says "submit by email". The recipient is the address saved in that setup.

interface RequestBody {
  packageId?: string | number
  recipientEmails?: string[]
  subject?: string
  message?: string
  fileName?: string
  pdfBase64?: string
  requestId?: string
}

const SUBMIT_ROLES = ['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT']

function requiredEnv(primary: string, ...fallbacks: string[]) {
  for (const name of [primary, ...fallbacks]) {
    const value = Deno.env.get(name)?.trim()
    if (value) return value
  }
  throw new Error(
    `Missing Edge Function secret: ${[primary, ...fallbacks].join(' or ')}.`,
  )
}

function safeError(error: unknown) {
  if (!(error instanceof Error)) return 'Unknown Package email error.'
  return error.message.slice(0, 1000)
}

function requiredPositiveId(value: unknown, label: string) {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9][0-9]*$/u.test(normalized)) throw new Error(`Select a valid ${label}.`)
  return normalized
}

function requestId(value: unknown) {
  const normalized = String(value ?? '').trim()
  if (!/^[A-Za-z0-9_-]{8,100}$/u.test(normalized)) {
    throw new Error('The email request identifier is invalid. Generate the Package again.')
  }
  return normalized
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
  if (!profile?.is_active || !SUBMIT_ROLES.includes(profile.role)) return null

  return { caller, userId: user.id }
}

async function loadPackage(caller: ReturnType<typeof userClient>, packageId: string) {
  const { data: record, error } = await caller
    .from('draw_packages')
    .select('id, package_number, package_type, status, job_id, builder_id, setup_version_id, quickbooks_status, quickbooks_reference')
    .eq('id', packageId)
    .maybeSingle()
  if (error) throw error
  if (!record) throw new Error('The Package is no longer available.')
  if (['CANCELLED', 'VOIDED'].includes(String(record.status))) {
    throw new Error('A cancelled Package cannot be sent.')
  }

  const [setup, job, builder, invoice] = await Promise.all([
    caller
      .from('billing_setup_versions')
      .select('submission_method')
      .eq('id', record.setup_version_id)
      .maybeSingle(),
    caller.from('jobs').select('code, community').eq('id', record.job_id).maybeSingle(),
    caller.from('builders').select('name').eq('id', record.builder_id).maybeSingle(),
    caller.from('invoices').select('net_amount, invoice_number').eq('package_id', record.id).maybeSingle(),
  ])
  for (const result of [setup, job, builder, invoice]) {
    if (result.error) throw result.error
  }

  if (setup.data?.submission_method !== 'EMAIL') {
    throw new Error("This Builder's setup does not submit packages by email.")
  }

  const context: PackageSubmissionContext = {
    packageNumber: String(record.package_number),
    packageType: String(record.package_type ?? 'DRAW'),
    // The invoice number the Builder knows it by: the saved one, else QuickBooks'.
    invoiceNumber: invoice.data?.invoice_number
      ?? (record.quickbooks_status === 'CREATED' ? record.quickbooks_reference : null)
      ?? null,
    jobCode: String(job.data?.code ?? ''),
    community: String(job.data?.community ?? ''),
    builderName: String(builder.data?.name ?? ''),
    netAmount: invoice.data?.net_amount == null ? null : Number(invoice.data.net_amount),
  }
  return { packageId: String(record.id), context }
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  try {
    const authorized = await authorizeUser(req)
    if (!authorized) {
      return json({ error: 'Sign in with an Admin, Accounting or Project Management role first.' }, 401)
    }

    const body = await req.json().catch(() => ({})) as RequestBody
    const loaded = await loadPackage(authorized.caller, requiredPositiveId(body.packageId, 'Package'))
    // The Builder's saved address is only where the list starts: the person may
    // remove it or add more, so what is sent is the list they confirmed.
    const recipients = parseRecipients(body.recipientEmails)
    const rendered = renderPackageSubmissionEmail(loaded.context, body.subject, body.message)
    const attachment = decodePdfAttachment(body.pdfBase64, body.fileName)

    const providerMessageId = await sendPackageSubmissionWithResend({
      apiKey: requiredEnv('RESEND_API_KEY'),
      from: requiredEnv('PACKAGE_SUBMISSION_FROM_EMAIL', 'SEQUENCE_SHEET_FROM_EMAIL', 'FOLLOW_UP_FROM_EMAIL'),
      replyTo: requiredEnv('PACKAGE_SUBMISSION_REPLY_TO', 'SEQUENCE_SHEET_REPLY_TO', 'FOLLOW_UP_REPLY_TO'),
      idempotencyKey: `package-submission-${loaded.packageId}-${requestId(body.requestId)}`,
      recipients,
      rendered,
      attachment,
    })

    // The email is out: keep a record so the Package can say it was sent. The
    // caller's role was checked above; users cannot write this table themselves.
    const sentAt = new Date().toISOString()
    const { error: recordError } = await serviceClient()
      .from('package_submissions')
      .insert({
        package_id: loaded.packageId,
        method: 'EMAIL',
        destination: recipients.join(', '),
        subject: rendered.subject,
        file_name: attachment.fileName,
        provider_message_id: providerMessageId,
        sent_by: authorized.userId,
        sent_at: sentAt,
      })
    if (recordError) console.error('Package submission was sent but not recorded:', recordError)

    // Once it is out, the Package waits for payment (a Package already past
    // Draft stays as it is). The email is sent either way, so a failure here is
    // reported instead of undoing it.
    const { data: workflowStatus, error: statusError } = await authorized.caller.rpc(
      'mark_package_submitted',
      { p_package_id: Number(loaded.packageId) },
    )
    if (statusError) console.error('Package was sent but its status was not updated:', statusError)

    return json({
      sent: true,
      recorded: !recordError,
      workflowStatus: statusError ? null : workflowStatus,
      sentAt,
      providerMessageId,
      recipients,
      subject: rendered.subject,
      attachmentBytes: attachment.size,
    })
  } catch (error) {
    console.error('Package submission email failed:', error)
    return json({ error: safeError(error) }, 400)
  }
})
