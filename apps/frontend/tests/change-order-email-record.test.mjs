import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canTellScheduling,
  describeEmailHistory,
  describeSchedulingEmailSent,
  shouldOfferSchedulingEmail,
  toEmailRecord,
} from '../src/features/change-orders/services/changeOrderEmailRecord.js'

test('Scheduling is only told about an Extra / CO that is Pending or Approved', () => {
  assert.equal(canTellScheduling('PENDING'), true)
  assert.equal(canTellScheduling('APPROVED'), true)
  assert.equal(canTellScheduling('DRAFT'), false)
  assert.equal(canTellScheduling('CANCELLED'), false)
})

test('a new Pending Extra / CO with lots tied to an event offers the email', () => {
  assert.equal(
    shouldOfferSchedulingEmail({ status: 'PENDING', links: { 70: 'EXT', 80: 'EXT' } }),
    true,
  )
  assert.equal(
    shouldOfferSchedulingEmail({ status: 'APPROVED', links: { 70: 'DM' } }),
    true,
  )
})

test('a Draft never offers it: it is not something Scheduling should act on', () => {
  assert.equal(shouldOfferSchedulingEmail({ status: 'DRAFT', links: { 70: 'EXT' } }), false)
})

test('with no lot tied to an event there is nothing to tell', () => {
  assert.equal(shouldOfferSchedulingEmail({ status: 'PENDING', links: {} }), false)
  assert.equal(shouldOfferSchedulingEmail({ status: 'PENDING' }), false)
})

test('saving an edit with the same ties does not ask again', () => {
  const savedLinks = { 70: { event: 'EXT', date: '2026-11-20' }, 80: { event: 'EXT', date: '2026-11-20' } }
  assert.equal(
    shouldOfferSchedulingEmail({ status: 'PENDING', links: { 70: 'EXT', 80: 'EXT' }, savedLinks }),
    false,
  )
})

test('an edit that ties one more lot, or changes the event, asks', () => {
  const savedLinks = { 70: { event: 'EXT', date: '2026-11-20' } }
  assert.equal(
    shouldOfferSchedulingEmail({ status: 'PENDING', links: { 70: 'EXT', 80: 'EXT' }, savedLinks }),
    true,
  )
  assert.equal(
    shouldOfferSchedulingEmail({ status: 'PENDING', links: { 70: 'HW' }, savedLinks }),
    true,
  )
})

test('an edit that unties lots does not ask: nothing new to tell', () => {
  const savedLinks = { 70: { event: 'EXT', date: '2026-11-20' }, 80: { event: 'EXT', date: '2026-11-20' } }
  assert.equal(
    shouldOfferSchedulingEmail({ status: 'PENDING', links: { 70: 'EXT' }, savedLinks }),
    false,
  )
})

test('once sent, the screen says to whom', () => {
  assert.equal(
    describeSchedulingEmailSent({ recipients: ['sam@valtriminc.com', 'pm@valtriminc.com'] }),
    'Email sent to sam@valtriminc.com, pm@valtriminc.com.',
  )
})

test('a row of the record is read as the screen needs it', () => {
  assert.deepEqual(
    toEmailRecord({
      id: 'a1',
      events: ['EXT'],
      lot_count: 3,
      recipients: ['sam@valtriminc.com'],
      subject: 'Extra / Change Order CO-0005',
      sent_at: '2026-11-05T18:00:00Z',
    }),
    {
      id: 'a1',
      events: ['EXT'],
      lotCount: 3,
      recipients: ['sam@valtriminc.com'],
      subject: 'Extra / Change Order CO-0005',
      sentAt: '2026-11-05T18:00:00Z',
    },
  )
})

test('the history says when Scheduling was last emailed, and how many times before', () => {
  const write = (value) => value
  const record = (sentAt, recipients) => ({ sentAt, recipients })

  assert.equal(describeEmailHistory([], write), '')
  assert.equal(describeEmailHistory(undefined, write), '')
  assert.equal(
    describeEmailHistory([record('2026-11-05', ['a@x.co', 'b@x.co'])], write),
    'Scheduling was emailed on 2026-11-05: a@x.co, b@x.co',
  )
  assert.equal(
    describeEmailHistory([record('2026-11-06', ['a@x.co']), record('2026-11-05', ['b@x.co'])], write),
    'Scheduling was emailed on 2026-11-06: a@x.co (1 earlier email)',
  )
  assert.equal(
    describeEmailHistory([
      record('2026-11-07', ['a@x.co']), record('2026-11-06', ['a@x.co']), record('2026-11-05', ['a@x.co']),
    ], write),
    'Scheduling was emailed on 2026-11-07: a@x.co (2 earlier emails)',
  )
})
