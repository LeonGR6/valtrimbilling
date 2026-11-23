import test from 'node:test'
import assert from 'node:assert/strict'
import { applyAppointmentsToRequests } from '../src/features/customer-service/utils/appointmentRecords.js'
import { buildProposalSend, proposalSentNotice } from '../src/features/customer-service/utils/proposalDraft.js'
import {
  buildProposalAcceptance, buildProposalDecline, cancelNotice, counterProposalLabel, counterProposalProblems, declineNotice,
  hoursSinceSent, latestProposalAnswer, proposalOptionsStatus, sentAgoLabel,
} from '../src/features/customer-service/utils/proposalAnswers.js'
import { invitationEmail } from '../src/features/customer-service/utils/customerServiceEmailTemplates.js'

// Friday 2026-11-20, 9:00 AM in California.
const now = new Date('2026-11-20T17:00:00Z')
const proposalRow = (overrides = {}) => ({
  id: 30, request_id: 20, status: 'SENT', sender_mailbox: 'victor@valtriminc.com', sent_at: '2026-11-19T15:00:00Z',
  reminder_sent_at: null, builder_contacted_at: null, responded_at: null, response_via: null, counter_dates: null,
  counter_day_part: null, customer_note: null, cancelled_at: null, cancel_reason: null, ...overrides,
})
// Option 1 Tue 24 8:00–10:00 window (work 8:00–8:45), option 2 Mon 23 10:00–12:00.
const holdRow = (overrides = {}) => ({
  option_id: 41, option_number: 1, proposal_id: 30, request_id: 20, sent_at: '2026-11-19T15:00:00Z', technician_ids: [4],
  window_starts_at: '2026-11-24T16:00:00Z', window_ends_at: '2026-11-24T18:00:00Z',
  starts_at: '2026-11-24T16:00:00Z', ends_at: '2026-11-24T16:45:00Z', pickup_minutes: 10, ...overrides,
})
const secondHold = holdRow({
  option_id: 42, option_number: 2, window_starts_at: '2026-11-23T18:00:00Z', window_ends_at: '2026-11-23T20:00:00Z',
  starts_at: '2026-11-23T18:00:00Z', ends_at: '2026-11-23T18:45:00Z',
})

test('each request gets its newest proposal and the days it holds', () => {
  const [awaiting, other] = applyAppointmentsToRequests(
    [{ id: 20, requestNumber: 'CS-20' }, { id: 21, requestNumber: 'CS-21' }], [], [], [secondHold, holdRow()],
    [proposalRow(), proposalRow({ id: 12, status: 'COUNTER_PROPOSED', sent_at: '2026-11-10T15:00:00Z' })],
  )
  assert.equal(awaiting.latestProposal.id, 30)
  assert.equal(awaiting.latestProposal.status, 'SENT')
  assert.equal(awaiting.latestProposal.senderMailbox, 'victor@valtriminc.com')
  assert.deepEqual(awaiting.proposalHolds.map((hold) => [hold.optionId, hold.date, hold.windowStart]), [
    [41, '2026-11-24', '08:00'], [42, '2026-11-23', '10:00'],
  ])
  assert.equal(other.latestProposal, undefined)
})

test('the waiting time counts whole hours since the invitation', () => {
  const proposal = { sentAt: '2026-11-19T15:00:00Z' }
  assert.equal(hoursSinceSent(proposal, now), 26)
  assert.equal(sentAgoLabel(proposal, now), 'Sent 26 hours ago')
  assert.equal(sentAgoLabel({ sentAt: '2026-11-20T16:30:00Z' }, now), 'Sent less than an hour ago')
  assert.equal(sentAgoLabel({ sentAt: '2026-11-20T16:00:00Z' }, now), 'Sent 1 hour ago')
  assert.equal(hoursSinceSent({}, now), null)
})

test('a held day whose window has started can no longer be accepted', () => {
  const [request] = applyAppointmentsToRequests([{ id: 20 }], [], [], [holdRow(), secondHold], [proposalRow()])
  const before = proposalOptionsStatus(request, now)
  assert.deepEqual(before.options.map((option) => option.started), [false, false])
  assert.equal(before.allStarted, false)
  // Monday 23 at 10:00 AM: option 2 started, option 1 (Tuesday) still open.
  const monday = proposalOptionsStatus(request, new Date('2026-11-23T18:00:00Z'))
  assert.deepEqual(monday.options.map((option) => option.started), [false, true])
  const wednesday = proposalOptionsStatus(request, new Date('2026-11-25T17:00:00Z'))
  assert.equal(wednesday.allStarted, true)
})

test('the last answer shows while the request is planned again', () => {
  const counter = {
    latestProposal: {
      status: 'COUNTER_PROPOSED', counterDates: ['2026-12-01', '2026-12-02'], counterDayPart: 'MORNING', customerNote: 'After 9',
    },
  }
  assert.equal(counterProposalLabel(counter.latestProposal), 'Tue, Dec 1, Wed, Dec 2 · morning')
  assert.deepEqual(latestProposalAnswer(counter, 'READY_TO_PROPOSE'), {
    severity: 'info', title: 'The customer asked for other dates', detail: 'Tue, Dec 1, Wed, Dec 2 · morning', note: 'After 9',
  })
  assert.equal(latestProposalAnswer(counter, 'AWAITING_CUSTOMER'), null)
  assert.equal(latestProposalAnswer({ latestProposal: { status: 'REJECTED', customerNote: '' } }, 'NEEDS_CONTACT').severity, 'warning')
  assert.equal(latestProposalAnswer({ latestProposal: { status: 'CANCELLED', cancelReason: 'Wrong day' } }, 'READY_TO_PROPOSE').detail,
    'Wrong day')
  assert.equal(latestProposalAnswer({ latestProposal: { status: 'ACCEPTED' } }, 'READY_TO_PROPOSE'), null)
  assert.equal(latestProposalAnswer({}, 'READY_TO_PROPOSE'), null)
})

test('a counter-proposal needs one to three different dates from today on', () => {
  const today = '2026-11-20'
  assert.deepEqual(counterProposalProblems({ dates: ['2026-12-01', '', ''] }, today), [])
  assert.deepEqual(counterProposalProblems({ dates: ['', '', ''] }, today), ['Enter at least one date the customer can do.'])
  assert.deepEqual(counterProposalProblems({ dates: ['2026-12-01', '2026-12-01', ''] }, today), ['Enter different dates.'])
  assert.deepEqual(counterProposalProblems({ dates: ['2026-11-19', '', ''] }, today), ['Use dates from today on.'])
  assert.deepEqual(counterProposalProblems({ dates: ['2026-12-01'], note: 'x'.repeat(1001) }, today),
    ['Keep the note to 1000 characters.'])
})

test('recorded answers become bodies for the Edge Function', () => {
  assert.deepEqual(buildProposalAcceptance({ proposalId: '30', optionId: 42 }), { action: 'accept', proposalId: 30, optionId: 42 })
  const email = { greeting: 'Hi,', message: 'Confirmed.' }
  assert.deepEqual(buildProposalAcceptance({ proposalId: 30, optionId: 42, confirmationEmail: email }).confirmationEmail, email)
  assert.deepEqual(buildProposalDecline({
    proposalId: 30, counter: true, dates: ['2026-12-02', '', '2026-12-01'], dayPart: 'MIDDAY', note: ' After 9 ',
  }), { action: 'decline', proposalId: 30, counterDates: ['2026-12-01', '2026-12-02'], dayPart: 'MIDDAY', note: 'After 9' })
  assert.deepEqual(buildProposalDecline({ proposalId: 30, counter: false, dates: ['2026-12-01'], dayPart: 'MIDDAY', note: '' }), {
    action: 'decline', proposalId: 30, counterDates: [], dayPart: null, note: null,
  })
  assert.match(declineNotice('CS-20', true).message, /back in Ready to propose with the customer's dates/u)
  assert.match(declineNotice('CS-20', false).message, /moved to Needs contact/u)
  assert.match(cancelNotice('CS-20').message, /proposal was cancelled and its days released/u)
})

test('a proposal sends each day with the travel of its own sequence', () => {
  const request = { id: '20', updatedAt: '2026-11-19T10:00:00Z' }
  const option = (date, legs) => ({
    values: { technicianIds: ['4'], date, windowStart: '08:00', internalStart: '08:00' },
    validation: { travelLegs: legs },
  })
  const invitation = { greeting: 'Hi,', message: 'These times work:' }
  assert.deepEqual(buildProposalSend({
    request,
    options: [option('2026-11-24', [{ key: '10>20', minutes: 25 }, { key: '20>11', minutes: null }]), option('2026-11-23', [])],
    invitation,
  }), {
    requestId: 20,
    expectedRequestUpdatedAt: '2026-11-19T10:00:00Z',
    options: [
      { technicianIds: [4], date: '2026-11-24', windowStart: '08:00', workStart: '08:00', travelMinutes: { '10>20': 25 } },
      { technicianIds: [4], date: '2026-11-23', windowStart: '08:00', workStart: '08:00', travelMinutes: {} },
    ],
    invitation,
  })
})

test('after sending, the coordinator reads where the invitation went', () => {
  assert.deepEqual(proposalSentNotice('CS-20', {
    optionIds: [41, 42], invitation: { status: 'SENT', to: 'tester@example.com', testMode: true },
  }), {
    severity: 'success',
    message: 'CS-20 is waiting for the customer: its 2 days are held. The invitation was emailed to tester@example.com (test inbox).',
  })
  const uncertain = proposalSentNotice('CS-20', { optionIds: [41], invitation: { status: 'UNCERTAIN', message: 'Check Sent Items.' } })
  assert.equal(uncertain.severity, 'warning')
  assert.equal(uncertain.message, 'CS-20 is waiting for the customer: its day is held. Check Sent Items.')
})

test('the planner previews the same invitation the server sends', () => {
  const email = invitationEmail({
    folio: 'CS-20', homeownerName: 'Ana', options: [{ date: '2026-11-24', windowStart: '08:00' }],
    address: '', work: 'Door', greeting: 'Hi Ana,', message: 'We can come:', senderName: 'Victor',
  })
  assert.equal(email.subject, 'Can we visit on Tue, Nov 24? Your Valtrim service visit (CS-20)')
  assert.match(email.text, /Tuesday, November 24, 2026, arrival window 8:00 AM–10:00 AM/u)
})
