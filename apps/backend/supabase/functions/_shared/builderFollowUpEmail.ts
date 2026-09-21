export interface BuilderFollowUpEmailSnapshot {
  alreadySent: boolean
  providerMessageId?: string
  outboxId: string | null
  idempotencyKey: string
  checkpointId: string
  scheduleId: string
  checkpointCode: string
  daysBefore: number
  dueOn: string
  workDate: string
  stageType: 'EXT' | 'DM' | 'HW'
  variant: string
  jobCode: string
  community: string
  builderName: string
  phaseCode: string
  building: string
  lotStartLabel: string
  lotEndLabel: string
  recipientContactId: string
  recipientName: string
  recipientEmail: string
}

export interface RenderedBuilderFollowUpEmail {
  subject: string
  text: string
  html: string
}

export interface BuilderFollowUpResponseLinks {
  confirmed: string
  notReady: string
}

export interface BuilderFollowUpEscalationSnapshot {
  alreadySent: boolean
  providerMessageId?: string
  escalationId: string
  idempotencyKey: string
  noResponseEventId: string
  scheduleId: string
  noResponseSince: string
  waitBusinessDays: number
  dueOn: string
  workDate: string
  stageType: 'EXT' | 'SHUTTER' | 'DM' | 'HW'
  variant: string
  jobCode: string
  community: string
  builderName: string
  phaseCode: string
  building: string
  lotStartLabel: string
  lotEndLabel: string
  superintendentContactId: string
  superintendentName: string
  superintendentEmail: string
  recipientEmails: string[]
}

export interface RenderedBuilderFollowUpEscalationEmail {
  subject: string
  text: string
  html: string
}

interface ResendOptions {
  apiKey: string
  from: string
  replyTo: string
  snapshot: BuilderFollowUpEmailSnapshot
  rendered: RenderedBuilderFollowUpEmail
}

interface EscalationResendOptions {
  apiKey: string
  from: string
  replyTo: string
  snapshot: BuilderFollowUpEscalationSnapshot
  rendered: RenderedBuilderFollowUpEscalationEmail
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatWorkDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) throw new Error('The follow-up work date is invalid.')
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function lotLabel(snapshot: BuilderFollowUpEmailSnapshot) {
  if (!snapshot.lotStartLabel && !snapshot.lotEndLabel) return 'the scheduled lots'
  if (!snapshot.lotEndLabel || snapshot.lotStartLabel === snapshot.lotEndLabel) {
    return `Lot ${snapshot.lotStartLabel || snapshot.lotEndLabel}`
  }
  return `Lots ${snapshot.lotStartLabel}–${snapshot.lotEndLabel}`
}

function escalationLotLabel(snapshot: BuilderFollowUpEscalationSnapshot) {
  if (!snapshot.lotStartLabel && !snapshot.lotEndLabel) return 'Lots not specified'
  if (!snapshot.lotEndLabel || snapshot.lotStartLabel === snapshot.lotEndLabel) {
    return `Lot ${snapshot.lotStartLabel || snapshot.lotEndLabel}`
  }
  return `Lots ${snapshot.lotStartLabel}–${snapshot.lotEndLabel}`
}

export function renderBuilderFollowUpEmail(
  snapshot: BuilderFollowUpEmailSnapshot,
  responseLinks?: BuilderFollowUpResponseLinks,
): RenderedBuilderFollowUpEmail {
  const workDate = formatWorkDate(snapshot.workDate)
  const lots = lotLabel(snapshot)
  const location = snapshot.community.trim()
  const subject = `Action requested: confirm ${snapshot.stageType} for ${snapshot.jobCode} on ${snapshot.workDate}`
  const greeting = `Hello ${snapshot.recipientName},`
  const request = `ValTrim is following up to confirm ${snapshot.stageType} work for ${snapshot.jobCode} (${location}), ${lots}, scheduled for ${workDate}.`
  const response = responseLinks
    ? 'Please select Confirmed, or select Not ready to request a different date.'
    : 'Please reply to confirm the date, request a reschedule, or let us know about any readiness or scheduling conflict.'
  const reference = `Reference: ${snapshot.checkpointCode.replaceAll('_', ' ')} follow-up (${snapshot.daysBefore} days before work).`
  const responseText = responseLinks
    ? [
      '',
      `Confirmed: ${responseLinks.confirmed}`,
      `Not ready / request another date: ${responseLinks.notReady}`,
      '',
      'Opening a link does not record a response. Review the details and submit the response on the secure ValTrim page.',
    ]
    : []
  const footer = 'ValtrimBilling is the source of truth for this schedule. Only a submitted response can confirm the date or create a date-change request.'
  const text = [
    greeting,
    '',
    request,
    '',
    response,
    ...responseText,
    '',
    reference,
    '',
    footer,
  ].join('\n')
  const responseButtons = responseLinks
    ? `
      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0">
        <tr>
          <td style="padding-right:12px;padding-bottom:10px">
            <a href="${escapeHtml(responseLinks.confirmed)}" style="display:inline-block;background:#16803c;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">Confirmed</a>
          </td>
          <td style="padding-bottom:10px">
            <a href="${escapeHtml(responseLinks.notReady)}" style="display:inline-block;background:#b54708;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">Not ready / Request another date</a>
          </td>
        </tr>
      </table>
      <p style="font-size:13px;color:#64748b">Opening a button does not record a response. Review the details and submit on the secure ValTrim page.</p>
    `
    : ''
  const html = `
    <div style="font-family:Arial,sans-serif;color:#172033;line-height:1.55;max-width:640px">
      <p>${escapeHtml(greeting)}</p>
      <p>${escapeHtml(request)}</p>
      <p><strong>${escapeHtml(response)}</strong></p>
      ${responseButtons}
      <p style="color:#64748b">${escapeHtml(reference)}</p>
      <hr style="border:0;border-top:1px solid #d5dce7;margin:24px 0" />
      <p style="font-size:12px;color:#64748b">${escapeHtml(footer)}</p>
    </div>
  `.trim()

  return { subject, text, html }
}

export function renderBuilderFollowUpEscalationEmail(
  snapshot: BuilderFollowUpEscalationSnapshot,
): RenderedBuilderFollowUpEscalationEmail {
  const workDate = formatWorkDate(snapshot.workDate)
  const lots = escalationLotLabel(snapshot)
  const recipients = snapshot.recipientEmails.join(', ')
  const subject = `Needs attention: no response for ${snapshot.stageType} • ${snapshot.jobCode}`
  const summary = `No response has been recorded from ${snapshot.superintendentName} (${snapshot.superintendentEmail}) after ${snapshot.waitBusinessDays} business days.`
  const schedule = `${snapshot.stageType} for ${snapshot.jobCode} (${snapshot.community}), ${lots}, is scheduled for ${workDate}.`
  const request = 'Please review the Jobsite status and decide whether to contact the Superintendent again, reschedule, place the work on hold, or record a response in ValtrimBilling.'
  const reference = `Escalation ${snapshot.escalationId}; no response recorded ${snapshot.noResponseSince}; internal recipients: ${recipients}.`
  const footer = 'ValtrimBilling remains the source of truth. This alert does not change the Production date or confirmation status.'
  const text = [
    'ValTrim scheduling needs attention.',
    '',
    summary,
    schedule,
    '',
    request,
    '',
    reference,
    '',
    footer,
  ].join('\n')
  const html = `
    <div style="font-family:Arial,sans-serif;color:#172033;line-height:1.55;max-width:680px">
      <p style="font-size:18px;font-weight:700;color:#b42318">ValTrim scheduling needs attention.</p>
      <p>${escapeHtml(summary)}</p>
      <p>${escapeHtml(schedule)}</p>
      <p><strong>${escapeHtml(request)}</strong></p>
      <p style="color:#64748b">${escapeHtml(reference)}</p>
      <hr style="border:0;border-top:1px solid #d5dce7;margin:24px 0" />
      <p style="font-size:12px;color:#64748b">${escapeHtml(footer)}</p>
    </div>
  `.trim()

  return { subject, text, html }
}

async function sendWithResend(
  options: {
    apiKey: string
    from: string
    replyTo: string
    idempotencyKey: string
    recipients: string[]
    rendered: RenderedBuilderFollowUpEmail | RenderedBuilderFollowUpEscalationEmail
  },
  fetcher: typeof fetch,
) {
  const response = await fetcher('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': options.idempotencyKey,
    },
    body: JSON.stringify({
      from: options.from,
      to: options.recipients,
      reply_to: options.replyTo,
      subject: options.rendered.subject,
      text: options.rendered.text,
      html: options.rendered.html,
    }),
  })
  const payload = await response.json().catch(() => ({})) as {
    id?: string
    message?: string
    name?: string
  }

  if (!response.ok || !payload.id) {
    throw new Error(
      payload.message
        ? `Resend rejected the email: ${payload.message}`
        : `Resend rejected the email with status ${response.status}.`,
    )
  }

  return payload.id
}

export async function sendBuilderFollowUpWithResend(
  options: ResendOptions,
  fetcher: typeof fetch = fetch,
) {
  return sendWithResend({
    apiKey: options.apiKey,
    from: options.from,
    replyTo: options.replyTo,
    idempotencyKey: options.snapshot.idempotencyKey,
    recipients: [options.snapshot.recipientEmail],
    rendered: options.rendered,
  }, fetcher)
}

export async function sendBuilderFollowUpEscalationWithResend(
  options: EscalationResendOptions,
  fetcher: typeof fetch = fetch,
) {
  return sendWithResend({
    apiKey: options.apiKey,
    from: options.from,
    replyTo: options.replyTo,
    idempotencyKey: options.snapshot.idempotencyKey,
    recipients: options.snapshot.recipientEmails,
    rendered: options.rendered,
  }, fetcher)
}
