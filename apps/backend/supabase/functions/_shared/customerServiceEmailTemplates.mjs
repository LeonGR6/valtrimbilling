// Emails to Customer Service customers, built the same way for the planner's preview
// and for the Edge Function that sends them (block B, step B4), and the notices to the
// coordinator who sent a proposal. Pure functions only.
//
// Each email has an HTML version, laid out like the team's other Valtrim emails (dark
// header, white card, centered title, light footer; decided 23 Nov 2026), and a plain
// text version kept in service_communications. Everything typed or read from the request
// is escaped, so nothing typed becomes HTML in the customer's inbox. The coordinator
// edits the greeting and the message; the visit details and the reply line are fixed
// (block B, decision 4 of 19 Nov 2026). The customer sees Valtrim, the address, the work
// and the day with its window: nothing internal (decision 7). English only (decided
// 23 Nov 2026). The closing note and the coordinator's signature were removed at the
// user's request (23 Nov 2026); the email leaves from the coordinator's own mailbox.
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

// A button like the team's other emails: a table cell, so Outlook draws it too.
// primary: the blue "Accept"; otherwise the light "None of these days work".
function buttonHtml({ url, label, primary = true, margin = '12px 0 0' }) {
  const colors = primary
    ? 'background-color: #2563eb; color: #ffffff; border: 1px solid #2563eb;'
    : 'background-color: #ffffff; color: #374151; border: 1px solid #d1d5db;'
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: ${margin};">
<tr>
  <td align="center" bgcolor="${primary ? '#2563eb' : '#ffffff'}" style="border-radius: 8px;">
    <a href="${escapeHtml(url)}" target="_blank" style="display: inline-block; padding: 12px 22px; ${colors} ${font} font-size: 15px; font-weight: 700; line-height: 1; text-decoration: none; border-radius: 8px;">${escapeHtml(label)}</a>
  </td>
</tr>
</table>`
}

function optionCard({ label, date, windowStart, acceptUrl = '' }) {
  const window = windowLabel(windowStart)
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 12px; border: 1px solid #bfdbfe; border-radius: 12px; background-color: #eff6ff;">
<tr>
  <td style="padding: 16px 20px; ${font}">
    ${label ? `<div style="margin: 0 0 4px; color: #2563eb; font-size: 12px; font-weight: 700; line-height: 1.4; text-transform: uppercase; letter-spacing: 0.6px;">${escapeHtml(label)}</div>` : ''}
    <div style="color: #111827; font-size: 18px; font-weight: 700; line-height: 1.4;">${escapeHtml(longDate(date))}</div>
    ${window ? `<div style="margin: 4px 0 0; color: #374151; font-size: 15px; line-height: 1.5;">Arrival window: ${escapeHtml(window)}</div>` : ''}
    ${acceptUrl ? buttonHtml({ url: acceptUrl, label: 'Accept this day' }) : ''}
  </td>
</tr>
</table>`
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
  folio, homeownerName, date, windowStart, address, work, greeting, message,
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
  return {
    subject: `Your Valtrim service visit is confirmed for ${shortDate(date)} (${singleLine(folio)})`,
    text: [typedGreeting, typedMessage, details.join('\n')].join('\n\n'),
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
      ].join('\n'),
      footer: footerHtml(folio),
    }),
  }
}

// --- Invitation (path b, "Send proposal") ---

/** @typedef {{ options: { number: number, url: string }[], none: string }} ProposalLinks */

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
// options: [{ date: 'YYYY-MM-DD', windowStart: '08:00', number? }], in California time;
// number keeps an option's place in the proposal when an earlier one is left out.
// reminder: the 24-hour reminder of step B7 (see reminderEmail).
// links (step B5): { options: [{ number, url }], none } from the server; each opens the
// customer page, where the customer confirms. Without links the customer replies.
/**
 * @param {{ folio: any, homeownerName: any, options: any, address: any, work: any, greeting: any, message: any,
 *   reminder?: boolean, links?: ProposalLinks | null }} params
 */
export function invitationEmail({
  folio, homeownerName, options: offered, address, work, greeting, message, reminder = false, links = null,
}) {
  const fallback = defaultInvitationText({ homeownerName })
  const options = offered ?? []
  const several = options.length > 1
  const typedGreeting = singleLine(greeting) || fallback.greeting
  const typedMessage = paragraph(message) || fallback.message
  const days = options.map((option, index) => {
    const window = windowLabel(option.windowStart)
    const label = [longDate(option.date), window && `arrival window ${window}`].filter(Boolean).join(', ')
    return several ? `Option ${option.number ?? index + 1}: ${label}` : label
  })
  const details = [
    singleLine(address) && `Address: ${singleLine(address)}`,
    singleLine(work) && `Work: ${singleLine(work)}`,
    `Reference: ${singleLine(folio)}`,
  ].filter(Boolean)
  const acceptUrl = (option, index) => links?.options?.find((entry) => entry.number === (option.number ?? index + 1))?.url ?? ''
  const buttons = Boolean(links?.none) && options.every((option, index) => acceptUrl(option, index))
  const holding = several ? 'We are holding both times for you until you answer.' : 'We are holding it for you until you answer.'
  const answer = buttons
    ? `${several ? 'Choose the day that works for you with its button.' : 'Confirm this day with the button above.'} ${holding}`
    : `${several ? 'Reply to this email with the option that works for you.' : 'Reply to this email to confirm this time.'} ${holding}`
  const textLinks = buttons
    ? [
      ...options.map((option, index) => `Accept ${several ? `option ${option.number ?? index + 1}` : 'this day'}: ${acceptUrl(option, index)}`),
      `None of these days work: ${links.none}`,
    ].join('\n')
    : ''
  return {
    subject: `${reminder ? 'Reminder: ' : ''}${several
      ? `${reminder ? 'choose' : 'Choose'} a day for your Valtrim service visit (${singleLine(folio)})`
      : `${reminder ? 'can' : 'Can'} we visit on ${shortDate(options[0]?.date)}? Your Valtrim service visit (${singleLine(folio)})`}`,
    text: [typedGreeting, typedMessage, days.join('\n'), details.join('\n'), answer, textLinks].filter(Boolean).join('\n\n'),
    html: emailLayout({
      title: `${reminder ? 'Reminder: ' : ''}${several
        ? `${reminder ? 'choose' : 'Choose'} a day for your service visit`
        : `${reminder ? 'can' : 'Can'} we visit on this day?`}`,
      preheader: several
        ? `We are ${reminder ? 'still ' : ''}holding ${options.length} times for your Valtrim service visit. ${buttons ? 'Choose one' : 'Reply to choose one'}.`
        : `We are ${reminder ? 'still ' : ''}holding ${longDate(options[0]?.date)} for your Valtrim service visit. ${buttons ? 'Confirm it' : 'Reply to confirm'}.`,
      content: [
        messageHtml(typedGreeting),
        messageHtml(typedMessage),
        `<div style="margin: 8px 0 16px;">\n${options.map((option, index) => optionCard({
          label: several ? `Option ${option.number ?? index + 1}` : '', date: option.date, windowStart: option.windowStart,
          acceptUrl: buttons ? acceptUrl(option, index) : '',
        })).join('\n')}\n</div>`,
        detailsCard([['Address', address], ['Work', work], ['Reference', folio]]),
        `<p style="margin: 0; color: #111827; font-size: 16px; font-weight: 700; line-height: 1.6; text-align: center;">${escapeHtml(answer)}</p>`,
        buttons
          ? `<div style="text-align: center;">\n${buttonHtml({
            url: links.none, label: several ? 'None of these days work' : 'This day does not work', primary: false,
            margin: '20px auto 0',
          })}\n</div>`
          : '',
      ].filter(Boolean).join('\n'),
      footer: footerHtml(folio),
    }),
  }
}

// --- Reminder (step B7) ---

// 24 hours after the invitation without an answer, sent automatically from the same
// mailbox: the same email with a fixed text, listing only the days that have not started.
/**
 * @param {{ folio: any, homeownerName: any, options: any, address: any, work: any, links?: ProposalLinks | null }} params
 */
export function reminderEmail({ folio, homeownerName, options, address, work, links = null }) {
  const name = singleLine(homeownerName)
  const several = (options ?? []).length > 1
  return invitationEmail({
    folio, homeownerName, options, address, work, reminder: true, links,
    greeting: name ? `Hi ${name},` : 'Hello,',
    message: `We have not heard back about your service visit yet, so we are still holding ${several ? 'these times' : 'this time'} for you:`,
  })
}

// --- Visit reminder (decided 23 Nov 2026) ---

// The business day before the visit, from 3:00 PM California time, from the mailbox that
// confirmed it: the visit details again, with no closing note.
export function visitReminderEmail({ folio, homeownerName, date, windowStart, address, work }) {
  const window = windowLabel(windowStart)
  const name = singleLine(homeownerName)
  const greeting = name ? `Hi ${name},` : 'Hello,'
  const message = 'This is a reminder of your upcoming Valtrim service visit. Here are the details:'
  const details = [
    `Date: ${longDate(date)}`,
    window && `Arrival window: ${window}`,
    singleLine(address) && `Address: ${singleLine(address)}`,
    singleLine(work) && `Work: ${singleLine(work)}`,
    `Reference: ${singleLine(folio)}`,
  ].filter(Boolean)
  return {
    subject: `Reminder: your Valtrim service visit is on ${shortDate(date)} (${singleLine(folio)})`,
    text: [greeting, message, details.join('\n')].join('\n\n'),
    html: emailLayout({
      title: 'Your service visit is coming up',
      preheader: `Your Valtrim service visit is on ${longDate(date)}${window ? `, ${window}` : ''}.`,
      content: [
        messageHtml(greeting),
        messageHtml(message),
        `<div style="margin: 8px 0 16px;">
${optionCard({ label: '', date, windowStart })}
</div>`,
        detailsCard([['Address', address], ['Work', work], ['Reference', folio]]),
      ].join('\n'),
      footer: footerHtml(folio),
    }),
  }
}

// --- Visit moved or cancelled (Reschedule block, 27 Nov 2026) ---

// The day a visit no longer has: gray and struck through, so it reads as replaced.
function previousCard({ label, date, windowStart }) {
  const window = windowLabel(windowStart)
  const when = [longDate(date), window].filter(Boolean).join(', ')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 12px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #f9fafb;">
<tr>
  <td style="padding: 12px 20px; ${font}">
    <div style="margin: 0 0 4px; color: #6b7280; font-size: 12px; font-weight: 700; line-height: 1.4; text-transform: uppercase; letter-spacing: 0.6px;">${escapeHtml(label)}</div>
    <div style="color: #6b7280; font-size: 15px; line-height: 1.5; text-decoration: line-through;">${escapeHtml(when)}</div>
  </td>
</tr>
</table>`
}

const calendarNoteHtml = (text) => (
  `<p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 1.6; text-align: center;">${escapeHtml(text)}</p>`
)

export function defaultVisitMovedText({ homeownerName } = {}) {
  const name = singleLine(homeownerName)
  return {
    greeting: name ? `Hi ${name},` : 'Hello,',
    message: 'As we agreed, your Valtrim service visit has a new date. Here are the details:',
  }
}

// The coordinator moved a confirmed visit to a day agreed with the customer (decision
// P1). date and windowStart are the new visit; previousDate and previousWindowStart the
// replaced one, in California time. The greeting and message are editable, like the
// confirmation; the details are fixed.
export function visitMovedEmail({
  folio, homeownerName, date, windowStart, previousDate, previousWindowStart, address, work, greeting, message,
}) {
  const window = windowLabel(windowStart)
  const previousWindow = windowLabel(previousWindowStart)
  const fallback = defaultVisitMovedText({ homeownerName })
  const typedGreeting = singleLine(greeting) || fallback.greeting
  const typedMessage = paragraph(message) || fallback.message
  const calendarNote = 'The attached calendar file updates your visit. If your calendar still shows the previous date, delete it.'
  const details = [
    `New date: ${longDate(date)}`,
    window && `Arrival window: ${window}`,
    previousDate && `Previous date: ${[longDate(previousDate), previousWindow].filter(Boolean).join(', ')}`,
    singleLine(address) && `Address: ${singleLine(address)}`,
    singleLine(work) && `Work: ${singleLine(work)}`,
    `Reference: ${singleLine(folio)}`,
  ].filter(Boolean)
  return {
    subject: `Your Valtrim service visit was moved to ${shortDate(date)} (${singleLine(folio)})`,
    text: [typedGreeting, typedMessage, details.join('\n'), calendarNote].join('\n\n'),
    html: emailLayout({
      title: 'Your service visit was moved',
      preheader: `Your Valtrim service visit is now on ${longDate(date)}${window ? `, ${window}` : ''}.`,
      content: [
        messageHtml(typedGreeting),
        messageHtml(typedMessage),
        `<div style="margin: 8px 0 16px;">
${optionCard({ label: 'New date', date, windowStart })}
${previousDate ? previousCard({ label: 'Previous date', date: previousDate, windowStart: previousWindowStart }) : ''}
</div>`,
        detailsCard([['Address', address], ['Work', work], ['Reference', folio]]),
        calendarNoteHtml(calendarNote),
      ].join('\n'),
      footer: footerHtml(folio),
    }),
  }
}

export function defaultVisitCancelledText({ homeownerName } = {}) {
  const name = singleLine(homeownerName)
  return {
    greeting: name ? `Hi ${name},` : 'Hello,',
    message: 'Your Valtrim service visit has been cancelled. These were its details:',
  }
}

// The coordinator cancelled a confirmed visit. date and windowStart are the cancelled visit.
export function visitCancelledEmail({ folio, homeownerName, date, windowStart, address, work, greeting, message }) {
  const window = windowLabel(windowStart)
  const fallback = defaultVisitCancelledText({ homeownerName })
  const typedGreeting = singleLine(greeting) || fallback.greeting
  const typedMessage = paragraph(message) || fallback.message
  const calendarNote = 'The attached calendar file removes the visit. If your calendar still shows it, delete it.'
  const details = [
    `Cancelled visit: ${[longDate(date), window].filter(Boolean).join(', ')}`,
    singleLine(address) && `Address: ${singleLine(address)}`,
    singleLine(work) && `Work: ${singleLine(work)}`,
    `Reference: ${singleLine(folio)}`,
  ].filter(Boolean)
  return {
    subject: `Your Valtrim service visit on ${shortDate(date)} was cancelled (${singleLine(folio)})`,
    text: [typedGreeting, typedMessage, details.join('\n'), calendarNote].join('\n\n'),
    html: emailLayout({
      title: 'Your service visit was cancelled',
      preheader: `Your Valtrim service visit on ${longDate(date)} was cancelled.`,
      content: [
        messageHtml(typedGreeting),
        messageHtml(typedMessage),
        `<div style="margin: 8px 0 16px;">
${previousCard({ label: 'Cancelled visit', date, windowStart })}
</div>`,
        detailsCard([['Address', address], ['Work', work], ['Reference', folio]]),
        calendarNoteHtml(calendarNote),
      ].join('\n'),
      footer: footerHtml(folio),
    }),
  }
}

// --- Notices to the coordinator who sent a proposal (decided 23 Nov 2026) ---

// Only when they must act: the customer picked another day or asked for a call on the
// proposal page, 48 hours passed without an answer, or every offered day started.
// kind: 'CUSTOMER_PICKED_DAY' (date, windowStart), 'CALL_CUSTOMER' (bestTime, phone),
// 'BUILDER_CALL' (builder: { name, superintendent, phone, email }) or 'DAYS_PASSED'.
/**
 * @param {{ kind: string, folio: any, customerName: any, address: any, date?: string, windowStart?: string,
 *   bestTime?: string, phone?: string,
 *   builder?: { name?: string, superintendent?: string, phone?: string, email?: string } | null }} params
 */
export function coordinatorNoticeEmail({
  kind, folio, customerName, address, date = '', windowStart = '', bestTime = '', phone = '', builder = null,
}) {
  const reference = singleLine(folio)
  const customer = singleLine(customerName) || 'The customer'
  const window = windowLabel(windowStart)
  const notice = {
    CUSTOMER_PICKED_DAY: {
      subject: `${reference}: the customer picked another day (${date ? shortDate(date) : 'see the request'})`,
      title: 'The customer picked another day',
      message: `None of the offered days worked for ${customer}, who picked ${date ? longDate(date) : 'another day'}${
        window ? `, arrival window ${window}` : ''} on the proposal page. Approve it in the Proposal Workspace: the request is in Ready to propose.`,
      rows: [],
    },
    CALL_CUSTOMER: {
      subject: `${reference}: call the customer`,
      title: 'Call the customer',
      message: `None of the offered days work for ${customer}, who asked for a call on the proposal page. Call them to find another time: the request is in Needs contact.`,
      rows: [['Best time', bestTime], ['Phone', phone]],
    },
    BUILDER_CALL: {
      subject: `${reference}: no answer after 48 hours, call the Builder`,
      title: 'No answer after 48 hours',
      message: `${customer} has not answered the proposal in 48 hours. Call the Builder's superintendent, then record it with Builder contacted in the Proposal Workspace.`,
      rows: [['Builder', builder?.name], ['Contact', builder?.superintendent], ['Phone', builder?.phone], ['Email', builder?.email]],
    },
    DAYS_PASSED: {
      subject: `${reference}: the offered days passed without an answer`,
      title: 'The offered days passed',
      message: `Every day offered to ${customer} has started without an answer. Call the customer and plan a new day in the Proposal Workspace: the new proposal or visit closes this one.`,
      rows: [],
    },
  }[kind]
  if (!notice) throw new Error(`Unknown coordinator notice: ${kind}`)
  const rows = [['Customer', customerName], ['Address', address], ...notice.rows, ['Reference', reference]]
  return {
    subject: notice.subject,
    text: [notice.message, rows.filter(([, value]) => singleLine(value)).map(([label, value]) => `${label}: ${singleLine(value)}`).join('\n')]
      .join('\n\n'),
    html: emailLayout({
      title: notice.title,
      preheader: notice.message,
      content: [messageHtml(notice.message), detailsCard(rows)].join('\n'),
      footer: 'An automatic notice from Valtrim Customer Service.',
    }),
  }
}
