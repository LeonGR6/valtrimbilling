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

interface ResendOptions {
  apiKey: string
  from: string
  replyTo: string
  snapshot: BuilderFollowUpEmailSnapshot
  rendered: RenderedBuilderFollowUpEmail
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

export function renderBuilderFollowUpEmail(
  snapshot: BuilderFollowUpEmailSnapshot,
): RenderedBuilderFollowUpEmail {
  const workDate = formatWorkDate(snapshot.workDate)
  const lots = lotLabel(snapshot)
  const location = snapshot.community.trim()
  const subject = `Action requested: confirm ${snapshot.stageType} for ${snapshot.jobCode} on ${snapshot.workDate}`
  const greeting = `Hello ${snapshot.recipientName},`
  const request = `ValTrim is following up to confirm ${snapshot.stageType} work for ${snapshot.jobCode} (${location}), ${lots}, scheduled for ${workDate}.`
  const response = 'Please reply to confirm the date, request a reschedule, or let us know about any readiness or scheduling conflict.'
  const reference = `Reference: ${snapshot.checkpointCode.replaceAll('_', ' ')} follow-up (${snapshot.daysBefore} days before work).`
  const footer = 'ValtrimBilling is the source of truth for this schedule. This email does not change or confirm the Production date by itself.'
  const text = [greeting, '', request, '', response, '', reference, '', footer].join('\n')
  const html = `
    <div style="font-family:Arial,sans-serif;color:#172033;line-height:1.55;max-width:640px">
      <p>${escapeHtml(greeting)}</p>
      <p>${escapeHtml(request)}</p>
      <p><strong>${escapeHtml(response)}</strong></p>
      <p style="color:#64748b">${escapeHtml(reference)}</p>
      <hr style="border:0;border-top:1px solid #d5dce7;margin:24px 0" />
      <p style="font-size:12px;color:#64748b">${escapeHtml(footer)}</p>
    </div>
  `.trim()

  return { subject, text, html }
}

export async function sendBuilderFollowUpWithResend(
  options: ResendOptions,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': options.snapshot.idempotencyKey,
    },
    body: JSON.stringify({
      from: options.from,
      to: [options.snapshot.recipientEmail],
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
