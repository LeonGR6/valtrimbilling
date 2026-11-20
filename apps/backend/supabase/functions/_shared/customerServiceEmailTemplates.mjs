// Emails to Customer Service customers, built the same way for the planner's preview
// and for the Edge Function that sends them (block B, step B4). Pure functions only.
//
// Plain text, so nothing typed becomes HTML in the customer's inbox. The coordinator
// edits the greeting and the message; the visit details, the reply line and the
// signature are fixed (block B, decision 4 of 19 Nov 2026). The customer sees Valtrim,
// the address, the work and the day with its window: nothing internal (decision 7).
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

// "12720 Azure Way-Unit 33, Hawthorne, CA 90250"
export function mailingAddress({ street, city, state, postalCode } = {}) {
  const region = [state, postalCode].map(singleLine).filter(Boolean).join(' ')
  return [street, city, region].map(singleLine).filter(Boolean).join(', ')
}

export function defaultConfirmationText({ homeownerName } = {}) {
  const name = singleLine(homeownerName)
  return {
    greeting: name ? `Hi ${name},` : 'Hello,',
    message: 'Thank you for confirming your service visit with Valtrim. Here are the details:',
  }
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

// The confirmation sent when the customer accepted by phone (path a). date is
// YYYY-MM-DD and windowStart one of the customer windows, in California time.
export function confirmationEmail({
  folio, homeownerName, date, windowStart, address, work, greeting, message, senderName,
}) {
  const window = customerServiceWindows.find((entry) => entry.start === windowStart)
  const fallback = defaultConfirmationText({ homeownerName })
  const details = [
    `Date: ${longDate(date)}`,
    window && `Arrival window: ${window.label}`,
    singleLine(address) && `Address: ${singleLine(address)}`,
    singleLine(work) && `Work: ${singleLine(work)}`,
    `Reference: ${singleLine(folio)}`,
  ].filter(Boolean)
  const signature = [singleLine(senderName), 'Valtrim Customer Service'].filter(Boolean)
  return {
    subject: `Your Valtrim service visit is confirmed for ${shortDate(date)} (${singleLine(folio)})`,
    text: [
      singleLine(greeting) || fallback.greeting,
      paragraph(message) || fallback.message,
      details.join('\n'),
      'If this day no longer works for you, reply to this email.',
      signature.join('\n'),
    ].join('\n\n'),
  }
}
