// Proposals waiting for the customer and the answers a coordinator records (block B,
// step B6). Until the customer page exists (step B5) the customer answers by replying to
// the invitation or by phone, and the coordinator records it here.
import { formatWeekdayDate, getCustomerServiceClock } from './dates.js'

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
