// Proposals waiting for the customer and the answers a coordinator records (block B,
// step B6). Until the customer page exists (step B5) the customer answers by replying to
// the invitation or by phone, and the coordinator records it here.
import { customerServiceTimeZone, formatWeekdayDate, getCustomerServiceClock } from './dates.js'
import { customerServiceEmailTime } from './customerServiceScheduling.js'

export const counterDayParts = [
  { value: 'MORNING', label: 'Morning' },
  { value: 'MIDDAY', label: 'Midday' },
  { value: 'AFTERNOON', label: 'Afternoon' },
]

export const counterNoteLimit = 1000

const minutesOf = (time) => {
  const [hours, minutes] = String(time ?? '').split(':').map(Number)
  return hours * 60 + minutes
}

// Whole hours since the proposal was sent; 24 and 48 hours drive the follow-ups (B7).
export function hoursSinceSent(proposal, now = new Date()) {
  const sent = Date.parse(proposal?.sentAt ?? '')
  return Number.isFinite(sent) ? Math.max(0, Math.floor((now.getTime() - sent) / 3_600_000)) : null
}

// Follow-ups (block B, step B7; decided 18-19 Nov 2026, calendar hours with weekends).
export const reminderAfterHours = 24
export const builderCallAfterHours = 48

const californiaDateTime = new Intl.DateTimeFormat('en-US', {
  timeZone: customerServiceTimeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
})
// "Tue, Nov 24, 9:00 AM", in California time.
export function formatCaliforniaDateTime(value) {
  const time = Date.parse(value ?? '')
  return Number.isFinite(time) ? californiaDateTime.format(new Date(time)) : ''
}

// What the coordinator sees about a waiting proposal's reminder and Builder call.
// reminder.severity: 'info' (scheduled or sent) or 'warning' (failed or not emailed).
// options: the held days ({ date, windowStart } in California); the server sends no
// reminder once every day has started, so none is promised then.
export function proposalFollowUp(proposal, now = new Date(), options = []) {
  const hours = hoursSinceSent(proposal, now)
  const sentAt = Date.parse(proposal?.sentAt ?? '')
  // 24 hours after sending, moved to 8:00 AM when that falls outside 8 AM–6 PM.
  const dueAt = Number.isFinite(sentAt) ? customerServiceEmailTime(new Date(sentAt + reminderAfterHours * 3_600_000)) : null
  const attempt = proposal?.reminder
  let reminder
  if (attempt?.status === 'SENT') {
    reminder = { severity: 'info', text: `Reminder emailed ${formatCaliforniaDateTime(attempt.at)}.` }
  } else if (attempt?.status === 'FAILED') {
    reminder = { severity: 'warning', text: `The reminder email failed: ${attempt.message || 'Microsoft 365 did not take it.'}` }
  } else if (proposal?.reminderSentAt) {
    reminder = { severity: 'warning', text: 'The reminder could not be emailed. Call the customer instead.' }
  } else if (dueAt && options.length && options.every((option) => {
    const due = getCustomerServiceClock(dueAt)
    return option.date < due.date || (option.date === due.date && minutesOf(option.windowStart) <= due.minutesSinceMidnight)
  })) {
    reminder = { severity: 'info', text: 'No reminder is emailed: every offered day starts before it would go out.' }
  } else if (dueAt && now.getTime() < dueAt.getTime()) {
    reminder = {
      severity: 'info',
      text: `If there is no answer, a reminder is emailed ${formatCaliforniaDateTime(dueAt.toISOString())}.`,
    }
  } else {
    reminder = { severity: 'info', text: 'The reminder is due and goes out within 15 minutes.' }
  }
  return {
    hours,
    reminder,
    builderCallDue: hours !== null && hours >= builderCallAfterHours && !proposal?.builderContactedAt,
    builderContacted: proposal?.builderContactedAt
      ? `Builder contacted ${formatCaliforniaDateTime(proposal.builderContactedAt)}.`
      : '',
    builderContact: proposal?.builderContact ?? null,
  }
}

export function sentAgoLabel(proposal, now = new Date()) {
  const hours = hoursSinceSent(proposal, now)
  if (hours === null) return ''
  return hours < 1 ? 'Sent less than an hour ago' : `Sent ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
}

// The held days of a waiting proposal. A day whose window has started can no longer be
// accepted (the server refuses it too); when every day has, the coordinator sends a new
// proposal (decision 6 of 19 Nov 2026: it is never cancelled automatically).
export function proposalOptionsStatus(request, now = new Date()) {
  const clock = getCustomerServiceClock(now)
  const options = [...(request?.proposalHolds ?? [])]
    .sort((left, right) => left.optionNumber - right.optionNumber)
    .map((hold) => ({
      ...hold,
      started: hold.date < clock.date || (hold.date === clock.date && minutesOf(hold.windowStart) <= clock.minutesSinceMidnight),
    }))
  return { options, allStarted: options.length > 0 && options.every((option) => option.started) }
}

export function counterProposalLabel(proposal) {
  const dates = (proposal?.counterDates ?? []).map(formatWeekdayDate).join(', ')
  const part = counterDayParts.find((entry) => entry.value === proposal?.counterDayPart)?.label.toLowerCase()
  return part ? `${dates} · ${part}` : dates
}

// The customer's last answer while the request is planned again: their dates after a
// counter-proposal, a rejection while it needs contact, or a cancelled proposal.
export function latestProposalAnswer(request, stage) {
  const proposal = request?.latestProposal
  if (!proposal) return null
  if (proposal.status === 'COUNTER_PROPOSED' && stage === 'READY_TO_PROPOSE') {
    return {
      severity: 'info',
      title: 'The customer asked for other dates',
      detail: counterProposalLabel(proposal),
      note: proposal.customerNote,
    }
  }
  if (proposal.status === 'REJECTED' && stage === 'NEEDS_CONTACT') {
    return {
      severity: 'warning',
      title: 'The customer declined the proposal',
      detail: 'Call them to agree on a new plan, then send another proposal or register the day they accept.',
      note: proposal.customerNote,
    }
  }
  if (proposal.status === 'CANCELLED' && stage === 'READY_TO_PROPOSE') {
    return { severity: 'info', title: 'The last proposal was cancelled', detail: proposal.cancelReason, note: '' }
  }
  return null
}

// The part of the day the customer page records for a picked window (same rule as the
// server's dayPartForWindow).
const dayPartOf = (windowStart) => (windowStart < '10:00' ? 'MORNING' : windowStart < '12:00' ? 'MIDDAY' : 'AFTERNOON')

// The other day the customer picked on the proposal page (step B5), as a slot the planner
// can use: the request is back in Ready to propose for the coordinator to approve it.
export function customerChosenSlot(request) {
  const proposal = request?.latestProposal
  if (proposal?.status !== 'COUNTER_PROPOSED' || proposal.counterDates?.length !== 1) return null
  const chosen = (proposal.alternatives ?? []).find((alternative) => alternative.date === proposal.counterDates[0]
    && dayPartOf(alternative.windowStart) === proposal.counterDayPart)
  if (!chosen) return null
  return {
    technicianIds: chosen.technicianIds.map(String), date: chosen.date, windowStart: chosen.windowStart,
    internalStart: chosen.workStart,
  }
}

// The best time to call that the customer typed on the proposal page, from the note the
// server writes ("… Best time to call: after 5 PM. Phone: …").
export function bestTimeToCall(note) {
  return /Best time to call: (.+?)\.(?: Phone: |$)/u.exec(note ?? '')?.[1] ?? ''
}

// The label the request list shows only when the coordinator must act on a proposal
// (decided 23 Nov 2026): the offered days passed, the Builder call is due, the customer
// picked another day to approve, or the customer asked for a call.
export function proposalListFlag(request, stage, now = new Date()) {
  const proposal = request?.latestProposal
  if (!proposal) return null
  if (stage === 'AWAITING_CUSTOMER' && proposal.status === 'SENT') {
    if (proposalOptionsStatus(request, now).allStarted) return { label: 'Days passed', color: 'error' }
    return proposalFollowUp(proposal, now).builderCallDue ? { label: 'Call the Builder', color: 'warning' } : null
  }
  if (stage === 'READY_TO_PROPOSE' && customerChosenSlot(request)) return { label: 'Customer picked a day', color: 'info' }
  if (stage === 'NEEDS_CONTACT' && proposal.status === 'REJECTED') {
    const bestTime = bestTimeToCall(proposal.customerNote)
    return { label: bestTime ? `Call the customer · ${bestTime}` : 'Call the customer', color: 'warning' }
  }
  return null
}

// dates: up to three YYYY-MM-DD values, blanks ignored.
export function counterProposalProblems({ dates = [], note = '' }, today = getCustomerServiceClock().date) {
  const filled = dates.filter(Boolean)
  const problems = []
  if (!filled.length) problems.push('Enter at least one date the customer can do.')
  else if (new Set(filled).size !== filled.length) problems.push('Enter different dates.')
  else if (filled.some((date) => date < today)) problems.push('Use dates from today on.')
  if (String(note).trim().length > counterNoteLimit) problems.push(`Keep the note to ${counterNoteLimit} characters.`)
  return problems
}

// Bodies for the Edge Function; it checks the proposal and the dates again.
export function buildProposalAcceptance({ proposalId, optionId, confirmationEmail = null }) {
  return {
    action: 'accept', proposalId: Number(proposalId), optionId: Number(optionId),
    ...(confirmationEmail ? { confirmationEmail } : {}),
  }
}

export function buildProposalDecline({ proposalId, counter = false, dates = [], dayPart = '', note = '' }) {
  const counterDates = counter ? [...new Set(dates.filter(Boolean))].sort() : []
  return {
    action: 'decline',
    proposalId: Number(proposalId),
    counterDates,
    dayPart: counter && dayPart ? dayPart : null,
    note: String(note).trim() || null,
  }
}

// What the coordinator reads after recording a decline or cancelling.
export function declineNotice(requestNumber, counter) {
  return counter
    ? {
      severity: 'success',
      message: `${requestNumber} is back in Ready to propose with the customer's dates. The held days were released.`,
    }
    : {
      severity: 'success',
      message: `${requestNumber} moved to Needs contact and its held days were released. Call the customer to agree on a new plan.`,
    }
}

export function cancelNotice(requestNumber) {
  return {
    severity: 'success',
    message: `${requestNumber} is back in Ready to propose. The proposal was cancelled and its days released.`,
  }
}

export function builderContactedNotice(requestNumber) {
  return { severity: 'success', message: `The Builder call about ${requestNumber} was recorded.` }
}
