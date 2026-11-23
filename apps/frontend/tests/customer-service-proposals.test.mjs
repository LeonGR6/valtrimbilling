import test from 'node:test'
import assert from 'node:assert/strict'
import { applyAppointmentsToRequests } from '../src/features/customer-service/utils/appointmentRecords.js'
import { buildProposalSend, proposalSentNotice } from '../src/features/customer-service/utils/proposalDraft.js'
import {
  bestTimeToCall, buildProposalAcceptance, buildProposalDecline, cancelNotice, counterProposalLabel, counterProposalProblems,
  customerChosenSlot, declineNotice,
  formatCaliforniaDateTime, hoursSinceSent, latestProposalAnswer, proposalFollowUp, proposalListFlag, proposalOptionsStatus,
  sentAgoLabel,
} from '../src/features/customer-service/utils/proposalAnswers.js'
import { customerServiceEmailTime } from '../src/features/customer-service/utils/customerServiceScheduling.js'
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
    alternatives: [],
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
    address: '', work: 'Door', greeting: 'Hi Ana,', message: 'We can come:',
  })
  assert.equal(email.subject, 'Can we visit on Tue, Nov 24? Your Valtrim service visit (CS-20)')
  assert.match(email.text, /Tuesday, November 24, 2026, arrival window 8:00 AM–10:00 AM/u)
})

test('each waiting proposal gets its last reminder attempt and its Builder contact', () => {
  const [request] = applyAppointmentsToRequests([{ id: 20 }], [], [], [holdRow()], [proposalRow()], {
    reminders: [
      { request_id: 20, status: 'FAILED', occurred_at: '2026-11-20T15:00:00Z', error_message: 'Busy', metadata: { proposalId: 30 } },
      { request_id: 20, status: 'SENT', occurred_at: '2026-11-20T15:15:00Z', error_message: null, metadata: { proposalId: 30 } },
      { request_id: 20, status: 'SENT', occurred_at: '2026-11-20T16:00:00Z', error_message: null, metadata: { proposalId: 99 } },
    ],
    builderContacts: [{
      id: 20,
      service_properties: { jobs: { builders: { name: 'Harmony Builder' }, superintendent: {
        name: 'Sam Super', phone: '9515550100', office_phone: null, email: 'sam@example.com',
      } } },
    }],
  })
  assert.deepEqual(request.latestProposal.reminder, { status: 'SENT', at: '2026-11-20T15:15:00Z', message: '' })
  assert.deepEqual(request.latestProposal.builderContact, {
    builderName: 'Harmony Builder', name: 'Sam Super', phone: '9515550100', officePhone: '', email: 'sam@example.com',
  })
  const [bare] = applyAppointmentsToRequests([{ id: 20 }], [], [], [], [proposalRow()])
  assert.equal(bare.latestProposal.reminder, null)
  assert.equal(bare.latestProposal.builderContact, null)
})

test('the screen shows when the reminder goes out, how it went and when to call the Builder', () => {
  // Sent Thursday 19 at 7:00 AM California time.
  const proposal = { sentAt: '2026-11-19T15:00:00Z', reminder: null, reminderSentAt: null, builderContactedAt: null }
  assert.equal(formatCaliforniaDateTime('2026-11-20T15:00:00Z'), 'Fri, Nov 20, 7:00 AM')
  // 24 hours later is 7:00 AM, before emails go out: it waits for 8:00 AM.
  const early = proposalFollowUp(proposal, new Date('2026-11-19T20:00:00Z'))
  assert.deepEqual(early.reminder, { severity: 'info', text: 'If there is no answer, a reminder is emailed Fri, Nov 20, 8:00 AM.' })
  assert.equal(early.builderCallDue, false)
  assert.equal(proposalFollowUp(proposal, new Date('2026-11-20T15:05:00Z')).reminder.text,
    'If there is no answer, a reminder is emailed Fri, Nov 20, 8:00 AM.')
  assert.equal(proposalFollowUp(proposal, new Date('2026-11-20T16:05:00Z')).reminder.text,
    'The reminder is due and goes out within 15 minutes.')
  const sent = proposalFollowUp({ ...proposal, reminderSentAt: '2026-11-20T15:00:00Z',
    reminder: { status: 'SENT', at: '2026-11-20T15:00:00Z', message: '' } }, new Date('2026-11-20T18:00:00Z'))
  assert.deepEqual(sent.reminder, { severity: 'info', text: 'Reminder emailed Fri, Nov 20, 7:00 AM.' })
  const failed = proposalFollowUp({ ...proposal, reminderSentAt: '2026-11-20T15:00:00Z',
    reminder: { status: 'FAILED', at: '2026-11-20T15:00:00Z', message: 'Busy.' } }, new Date('2026-11-20T18:00:00Z'))
  assert.deepEqual(failed.reminder, { severity: 'warning', text: 'The reminder email failed: Busy.' })
  assert.equal(proposalFollowUp({ ...proposal, reminderSentAt: '2026-11-20T15:00:00Z' }, now).reminder.severity, 'warning')
  // 48 calendar hours: Saturday 21 at 7:00 AM.
  assert.equal(proposalFollowUp(proposal, new Date('2026-11-21T14:59:00Z')).builderCallDue, false)
  assert.equal(proposalFollowUp(proposal, new Date('2026-11-21T15:00:00Z')).builderCallDue, true)
  // Every held day starts before the reminder would go out (Friday 20 at 8:00 AM).
  assert.equal(proposalFollowUp(proposal, new Date('2026-11-19T20:00:00Z'), [{ date: '2026-11-20', windowStart: '06:00' }]).reminder.text,
    'No reminder is emailed: every offered day starts before it would go out.')
  assert.equal(proposalFollowUp(proposal, new Date('2026-11-19T20:00:00Z'), [
    { date: '2026-11-20', windowStart: '06:00' }, { date: '2026-11-23', windowStart: '08:00' },
  ]).reminder.text, 'If there is no answer, a reminder is emailed Fri, Nov 20, 8:00 AM.')
  assert.equal(proposalFollowUp(proposal, new Date('2026-11-19T20:00:00Z'), [{ date: '2026-11-20', windowStart: '07:30' }]).reminder.text,
    'No reminder is emailed: every offered day starts before it would go out.')
  const called = proposalFollowUp({ ...proposal, builderContactedAt: '2026-11-21T17:30:00Z' }, new Date('2026-11-21T18:00:00Z'))
  assert.equal(called.builderCallDue, false)
  assert.equal(called.builderContacted, 'Builder contacted Sat, Nov 21, 9:30 AM.')
})

test('the proposal waiting for the customer is the current one, whatever its send time', () => {
  const [request] = applyAppointmentsToRequests([{ id: 20 }], [], [], [holdRow()], [
    proposalRow({ id: 31, status: 'ACCEPTED', sent_at: '2026-11-20T15:00:00Z' }),
    proposalRow({ id: 30, status: 'SENT', sent_at: '2026-11-18T15:00:00Z' }),
  ])
  assert.equal(request.latestProposal.id, 30)
})

test('the day the customer picked on the proposal page becomes a slot the planner can use', () => {
  const alternatives = [
    { date: '2026-11-26', windowStart: '10:00', workStart: '10:15', technicianIds: [4] },
    { date: '2026-11-27', windowStart: '12:00', workStart: '12:00', technicianIds: [5] },
  ]
  const request = (overrides) => ({
    latestProposal: { status: 'COUNTER_PROPOSED', counterDates: ['2026-11-27'], counterDayPart: 'AFTERNOON', alternatives, ...overrides },
  })
  assert.deepEqual(customerChosenSlot(request()), {
    technicianIds: ['5'], date: '2026-11-27', windowStart: '12:00', internalStart: '12:00',
  })
  // Dates the coordinator typed by hand, or any other answer, are not a picked slot.
  assert.equal(customerChosenSlot(request({ counterDates: ['2026-11-26', '2026-11-27'] })), null)
  assert.equal(customerChosenSlot(request({ counterDayPart: 'MORNING' })), null)
  assert.equal(customerChosenSlot(request({ status: 'REJECTED' })), null)
  assert.equal(customerChosenSlot({}), null)
})

test('emails go out from 8 AM to 6 PM in California; one due outside waits for 8 AM', () => {
  const at = (iso) => customerServiceEmailTime(new Date(iso)).toISOString()
  assert.equal(at('2026-11-20T20:00:00Z'), '2026-11-20T20:00:00.000Z') // Fri 12:00 PM: as is
  assert.equal(at('2026-11-20T15:00:00Z'), '2026-11-20T16:00:00.000Z') // Fri 7:00 AM → 8:00 AM
  assert.equal(at('2026-11-21T02:00:00Z'), '2026-11-21T16:00:00.000Z') // Fri 6:00 PM → Sat 8:00 AM
  assert.equal(at('2026-11-21T07:30:00Z'), '2026-11-21T16:00:00.000Z') // Fri 11:30 PM → Sat 8:00 AM
})

test('the list labels a proposal only when the coordinator must act', () => {
  const now = new Date('2026-11-20T17:00:00Z') // Friday 9:00 AM
  const waiting = (overrides = {}) => ({
    latestProposal: { status: 'SENT', sentAt: '2026-11-20T15:00:00Z', builderContactedAt: null, ...overrides },
    proposalHolds: [{ optionNumber: 1, date: '2026-11-24', windowStart: '08:00' }],
  })
  assert.equal(proposalListFlag(waiting(), 'AWAITING_CUSTOMER', now), null)
  assert.deepEqual(proposalListFlag(waiting({ sentAt: '2026-11-18T15:00:00Z' }), 'AWAITING_CUSTOMER', now),
    { label: 'Call the Builder', color: 'warning' })
  assert.deepEqual(proposalListFlag({ ...waiting(), proposalHolds: [{ optionNumber: 1, date: '2026-11-20', windowStart: '08:00' }] },
    'AWAITING_CUSTOMER', now), { label: 'Days passed', color: 'error' })
  const picked = {
    latestProposal: {
      status: 'COUNTER_PROPOSED', counterDates: ['2026-11-27'], counterDayPart: 'AFTERNOON',
      alternatives: [{ date: '2026-11-27', windowStart: '12:00', workStart: '12:00', technicianIds: [5] }],
    },
  }
  assert.deepEqual(proposalListFlag(picked, 'READY_TO_PROPOSE', now), { label: 'Customer picked a day', color: 'info' })
  const note = 'From the proposal page: none of the days work for the customer. Call them to find another time. ' +
    'Best time to call: after 5 p.m.. Phone: (951) 555-0101.'
  assert.equal(bestTimeToCall(note), 'after 5 p.m.')
  assert.equal(bestTimeToCall('Best time to call: mornings.'), 'mornings')
  assert.equal(bestTimeToCall('Called back.'), '')
  assert.deepEqual(proposalListFlag({ latestProposal: { status: 'REJECTED', customerNote: note } }, 'NEEDS_CONTACT', now),
    { label: 'Call the customer · after 5 p.m.', color: 'warning' })
  assert.deepEqual(proposalListFlag({ latestProposal: { status: 'REJECTED', customerNote: '' } }, 'NEEDS_CONTACT', now),
    { label: 'Call the customer', color: 'warning' })
  assert.equal(proposalListFlag({ latestProposal: { status: 'ACCEPTED' } }, 'CONFIRMED', now), null)
  assert.equal(proposalListFlag({}, 'READY_TO_PROPOSE', now), null)
})
