// Pure helpers for the DM reminder emails: dates, how the current mode is described, and the
// sentences the screen shows. Nothing here touches the network or React.

import { formatLotRange } from '../../draw-invoice/utils/drawPackages.js'

const LOS_ANGELES_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** YYYY-MM-DD moved by whole days. */
export function shiftDate(date, days) {
  const shifted = new Date(`${date}T00:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

/** The day whose DMs are announced today: tomorrow, by the California calendar. */
export function tomorrowInLosAngeles(now = new Date()) {
  return shiftDate(LOS_ANGELES_DAY.format(now), 1)
}

/** "Fri, Oct 23, 2026". */
export function formatDmDate(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** How the mode reads on screen, and whether an email can be sent in it. */
export function describeReminderMode(mode, testRecipients = []) {
  if (mode === 'LIVE') {
    return {
      severity: 'success',
      title: 'Live',
      text: 'Emails go to the people chosen in each message.',
      canSend: true,
    }
  }
  if (mode === 'TEST') {
    return testRecipients.length > 0
      ? {
        severity: 'warning',
        title: 'Test mode',
        text: `Emails go only to ${testRecipients.join(', ')}, never to the Job's contacts. Each says who it would have gone to.`,
        canSend: true,
      }
      : {
        severity: 'warning',
        title: 'Test mode without test addresses',
        text: 'Add the DM_REMINDER_TEST_RECIPIENTS secret with your own email addresses to send test emails.',
        canSend: false,
      }
  }
  return {
    severity: 'info',
    title: 'Preview mode',
    text: 'You can review every email, but none can be sent yet.',
    canSend: false,
  }
}

/** "Lots 1–9" for the lots of a DM, with their number when it helps. */
export function describeDmLots(event) {
  const numbers = event.lots.map((lot) => lot.lotNumber)
  return numbers.length === 1
    ? `Lot ${numbers[0]}`
    : `Lots ${formatLotRange(numbers)}`
}

const timestamp = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })

/** The status chip of one DM in the list. */
export function describeDmStatus(event) {
  if (event.sentAt) {
    const when = new Date(event.sentAt)
    return {
      color: 'success',
      label: Number.isNaN(when.getTime()) ? 'Sent' : `Sent ${timestamp.format(when)}`,
    }
  }
  if (!event.draft?.recipients?.length) {
    return { color: 'warning', label: 'Nobody to send to' }
  }
  return { color: 'default', label: 'Not sent' }
}

/** The roles with nobody to write to, as a sentence for the dialog. */
export function describeMissingDmRoles(roles) {
  if (!roles || roles.length === 0) return null
  const names = roles.length > 1
    ? `${roles.slice(0, -1).join(' and ')} and ${roles.at(-1)}`
    : roles[0]
  return `${names} ${roles.length > 1 ? 'are' : 'is'} not set on this Job or ${roles.length > 1 ? 'have' : 'has'} no email on file. Add an email below if they should know.`
}

/** What the dialog starts from, in the shape the recipients field uses. */
export function dmDraftFromPreview(preview) {
  const seen = new Set()
  const recipients = []
  for (const recipient of preview?.draft?.recipients ?? []) {
    const email = String(recipient?.email ?? '').trim().toLowerCase()
    if (email === '' || seen.has(email)) continue
    seen.add(email)
    recipients.push({ email, role: recipient.role ?? null, name: recipient.name ?? '' })
  }
  return {
    subject: String(preview?.draft?.subject ?? preview?.rendered?.subject ?? ''),
    recipients,
    missingRoles: preview?.event?.missingRoles ?? [],
  }
}

export function describeDmEmailSent(result) {
  const to = (result?.recipients ?? []).join(', ')
  if (result?.mode === 'TEST') {
    const intended = (result?.intendedRecipients ?? []).join(', ')
    return `Test email sent to ${to}.${intended ? ` It would have gone to ${intended}.` : ''}`
  }
  return `Email sent to ${to}.`
}
