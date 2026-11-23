// Emails to Customer Service customers, built the same way for the planner's preview
// and for the Edge Function that sends them (block B, step B4). Pure functions only.
//
// Each email has an HTML version, laid out like the team's other Valtrim emails (dark
// header, white card, centered title, light footer; decided 23 Nov 2026), and a plain
// text version kept in service_communications. Everything typed or read from the request
// is escaped, so nothing typed becomes HTML in the customer's inbox. The coordinator
// edits the greeting and the message; the visit details, the reply line and the
// signature are fixed (block B, decision 4 of 19 Nov 2026). The customer sees Valtrim,
// the address, the work and the day with its window: nothing internal (decision 7).
// English only, signed by the coordinator with no company phone (decided 23 Nov 2026).
import { customerServiceWindows } from './customerServiceScheduling.mjs'

export const confirmationTextLimits = { greeting: 200, message: 2000 }

const singleLine = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim()
// Line breaks typed in the message stay; other control characters do not.
const paragraph = (value) => String(value ?? '').replace(/\r\n?/gu, '\n')
  .replace(/[^\S\n]+/gu, ' ').split('\n').map((line) => line.trim()).join('\n').trim()
const hasControls = (value) => [...value].some((character) => {
  const code = character.charCodeAt(0)
  return (code < 32 && character !== '\n') || code === 127
})

const longDate = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
})
const shortDate = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
})
const windowLabel = (start) => customerServiceWindows.find((entry) => entry.start === start)?.label ?? ''

// "12720 Azure Way-Unit 33, Hawthorne, CA 90250"
export function mailingAddress({ street, city, state, postalCode } = {}) {
  const region = [state, postalCode].map(singleLine).filter(Boolean).join(' ')
  return [street, city, region].map(singleLine).filter(Boolean).join(', ')
}

// What is wrong with the typed greeting and message, as messages for the coordinator.
export function confirmationTextProblems({ greeting, message } = {}) {
  const problems = []
  const typedGreeting = String(greeting ?? '')
  const typedMessage = paragraph(message)
  if (!singleLine(typedGreeting)) problems.push('Enter a greeting.')
  else if (singleLine(typedGreeting).length > confirmationTextLimits.greeting) {
    problems.push(`Keep the greeting to ${confirmationTextLimits.greeting} characters.`)
  } else if (hasControls(singleLine(typedGreeting))) problems.push('Remove special characters from the greeting.')
  if (!typedMessage) problems.push('Enter a message.')
  else if (typedMessage.length > confirmationTextLimits.message) {
    problems.push(`Keep the message to ${confirmationTextLimits.message} characters.`)
  } else if (hasControls(typedMessage)) problems.push('Remove special characters from the message.')
  return problems
}

// --- HTML building blocks (inline styles only: email clients drop most CSS) ---

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/gu, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character])
const font = 'font-family: Arial, Helvetica, sans-serif;'

// A blank line starts a new paragraph; a single line break stays inside it.
const messageHtml = (text) => paragraph(text).split(/\n{2,}/u).map((block) => (
  `<p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6;">${block.split('\n').map(escapeHtml).join('<br>')}</p>`
)).join('\n')

const centeredNote = (text) => (
  `<p style="margin: 0 0 12px; color: #6b7280; font-size: 14px; line-height: 1.6; text-align: center;">${escapeHtml(text)}</p>`
)

// One compact block, a label and its value per line (decided 23 Nov 2026, so the email
// stays short). rows: [label, value]; rows without a value are left out.
function detailsCard(rows) {
  const shown = rows.filter(([, value]) => singleLine(value))
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 28px; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px;">
<tr>
  <td style="padding: 12px 16px; ${font}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${shown.map(([label, value]) => `      <tr>
        <td style="width: 80px; padding: 3px 12px 3px 0; color: #6b7280; ${font} font-size: 13px; line-height: 1.5; vertical-align: top; white-space: nowrap;">${escapeHtml(label)}</td>
        <td style="padding: 3px 0; color: #111827; ${font} font-size: 14px; line-height: 1.5; vertical-align: top;">${escapeHtml(singleLine(value))}</td>
      </tr>`).join('\n')}
    </table>
  </td>
</tr>
</table>`
}

function optionCard({ label, date, windowStart }) {
  const window = windowLabel(windowStart)
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 12px; border: 1px solid #bfdbfe; border-radius: 12px; background-color: #eff6ff;">
<tr>
  <td style="padding: 16px 20px; ${font}">
    ${label ? `<div style="margin: 0 0 4px; color: #2563eb; font-size: 12px; font-weight: 700; line-height: 1.4; text-transform: uppercase; letter-spacing: 0.6px;">${escapeHtml(label)}</div>` : ''}
    <div style="color: #111827; font-size: 18px; font-weight: 700; line-height: 1.4;">${escapeHtml(longDate(date))}</div>
    ${window ? `<div style="margin: 4px 0 0; color: #374151; font-size: 15px; line-height: 1.5;">Arrival window: ${escapeHtml(window)}</div>` : ''}
  </td>
</tr>
</table>`
}

function signatureHtml({ senderName, senderEmail }) {
  const lines = [
    singleLine(senderName) && `<span style="color: #111827; font-weight: 700;">${escapeHtml(singleLine(senderName))}</span>`,
    'Valtrim Customer Service',
    singleLine(senderEmail) && `<a href="mailto:${escapeHtml(singleLine(senderEmail))}" style="color: #2563eb; text-decoration: underline;">${escapeHtml(singleLine(senderEmail))}</a>`,
  ].filter(Boolean)
  return `<p style="margin: 28px 0 0; font-size: 15px; line-height: 1.6;">${lines.join('<br>')}</p>`
}

// The team's email frame: light page, 600 px white card, dark header, light footer.
function emailLayout({ title, preheader, content, footer }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    @media only screen and (max-width: 600px) {
      .email-container { width: 100% !important; }
      .email-content { padding: 32px 24px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f7fb;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f7fb;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="email-container" style="width: 600px; max-width: 600px; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden;">
          <tr>
            <td align="center" style="padding: 28px 24px; background-color: #111827; color: #ffffff; ${font} font-size: 20px; font-weight: 700; letter-spacing: 0.3px;">Valtrim</td>
          </tr>
          <tr>
            <td class="email-content" style="padding: 48px; ${font} color: #374151;">
              <h1 style="margin: 0 0 24px; color: #111827; font-size: 28px; line-height: 1.25; text-align: center;">${escapeHtml(title)}</h1>
${content}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 24px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; color: #9ca3af; ${font} font-size: 12px; line-height: 1.5;">${footer}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

const footerHtml = (folio) => (
  `You are receiving this email about your Valtrim service request ${escapeHtml(singleLine(folio))}. Reply to this email to reach your coordinator.`
)
const signatureText = ({ senderName, senderEmail }) => [
  singleLine(senderName), 'Valtrim Customer Service', singleLine(senderEmail),
].filter(Boolean).join('\n')

// --- Confirmation (path a, or an accepted proposal) ---

export function defaultConfirmationText({ homeownerName } = {}) {
  const name = singleLine(homeownerName)
  return {
    greeting: name ? `Hi ${name},` : 'Hello,',
    message: 'Thank you for confirming your service visit with Valtrim. Here are the details:',
  }
}

// date is YYYY-MM-DD and windowStart one of the customer windows, in California time.
export function confirmationEmail({
  folio, homeownerName, date, windowStart, address, work, greeting, message, senderName, senderEmail = '',
}) {
  const window = windowLabel(windowStart)
  const fallback = defaultConfirmationText({ homeownerName })
  const typedGreeting = singleLine(greeting) || fallback.greeting
  const typedMessage = paragraph(message) || fallback.message
  const details = [
    `Date: ${longDate(date)}`,
    window && `Arrival window: ${window}`,
    singleLine(address) && `Address: ${singleLine(address)}`,
    singleLine(work) && `Work: ${singleLine(work)}`,
    `Reference: ${singleLine(folio)}`,
  ].filter(Boolean)
  const reschedule = 'If this day no longer works for you, reply to this email.'
  return {
    subject: `Your Valtrim service visit is confirmed for ${shortDate(date)} (${singleLine(folio)})`,
    text: [
      typedGreeting,
      typedMessage,
      details.join('\n'),
      reschedule,
      signatureText({ senderName, senderEmail }),
    ].join('\n\n'),
    html: emailLayout({
      title: 'Your service visit is confirmed',
      preheader: `Your Valtrim service visit is confirmed for ${longDate(date)}${window ? `, ${window}` : ''}.`,
      content: [
        messageHtml(typedGreeting),
        messageHtml(typedMessage),
        `<div style="margin: 8px 0 16px;">
${optionCard({ label: '', date, windowStart })}
</div>`,
        detailsCard([['Address', address], ['Work', work], ['Reference', folio]]),
        centeredNote(reschedule),
        signatureHtml({ senderName, senderEmail }),
      ].join('\n'),
      footer: footerHtml(folio),
    }),
  }
}

// --- Invitation (path b, "Send proposal") ---

export function defaultInvitationText({ homeownerName } = {}) {
  const name = singleLine(homeownerName)
  return {
    greeting: name ? `Hi ${name},` : 'Hello,',
    message: 'We would like to schedule your service visit with Valtrim. Here is when we can come:',
  }
}

// One or two days, each with its arrival window, held until the customer answers. Until
// the customer page exists (step B5) the customer answers by replying, and the
// coordinator records the answer; B5 adds a button to the same layout.
// options: [{ date: 'YYYY-MM-DD', windowStart: '08:00' }], in California time.
export function invitationEmail({
  folio, homeownerName, options: offered, address, work, greeting, message, senderName, senderEmail = '',
}) {
  const fallback = defaultInvitationText({ homeownerName })
  const options = offered ?? []
  const several = options.length > 1
  const typedGreeting = singleLine(greeting) || fallback.greeting
  const typedMessage = paragraph(message) || fallback.message
  const days = options.map((option, index) => {
    const window = windowLabel(option.windowStart)
    const label = [longDate(option.date), window && `arrival window ${window}`].filter(Boolean).join(', ')
    return several ? `Option ${index + 1}: ${label}` : label
  })
  const details = [
    singleLine(address) && `Address: ${singleLine(address)}`,
    singleLine(work) && `Work: ${singleLine(work)}`,
    `Reference: ${singleLine(folio)}`,
  ].filter(Boolean)
  const answer = several
    ? 'Reply to this email with the option that works for you. We are holding both times for you until you answer.'
    : 'Reply to this email to confirm this time. We are holding it for you until you answer.'
  const otherDates = `If ${several ? 'none of these days work' : 'this day does not work'}, reply with up to three dates and ` +
    'the part of the day (morning, midday or afternoon) that suit you.'
  return {
    subject: several
      ? `Choose a day for your Valtrim service visit (${singleLine(folio)})`
      : `Can we visit on ${shortDate(options[0]?.date)}? Your Valtrim service visit (${singleLine(folio)})`,
    text: [
      typedGreeting,
      typedMessage,
      days.join('\n'),
      details.join('\n'),
      answer,
      otherDates,
      signatureText({ senderName, senderEmail }),
    ].join('\n\n'),
    html: emailLayout({
      title: several ? 'Choose a day for your service visit' : 'Can we visit on this day?',
      preheader: several
        ? `We are holding ${options.length} times for your Valtrim service visit. Reply to choose one.`
        : `We are holding ${longDate(options[0]?.date)} for your Valtrim service visit. Reply to confirm.`,
      content: [
        messageHtml(typedGreeting),
        messageHtml(typedMessage),
        `<div style="margin: 8px 0 16px;">\n${options.map((option, index) => optionCard({
          label: several ? `Option ${index + 1}` : '', date: option.date, windowStart: option.windowStart,
        })).join('\n')}\n</div>`,
        detailsCard([['Address', address], ['Work', work], ['Reference', folio]]),
        `<p style="margin: 0 0 12px; color: #111827; font-size: 16px; font-weight: 700; line-height: 1.6; text-align: center;">${escapeHtml(answer)}</p>`,
        centeredNote(otherDates),
        signatureHtml({ senderName, senderEmail }),
      ].join('\n'),
      footer: footerHtml(folio),
    }),
  }
}
