import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeDmEmailSent,
  describeDmLots,
  describeDmStatus,
  describeMissingDmRoles,
  dmDraftFromPreview,
  formatDmDate,
  shiftDate,
  tomorrowInLosAngeles,
} from '../src/features/calendar/services/dmReminderRecord.js'

test('tomorrow is the next day by the California calendar', () => {
  // 03:00 UTC on Oct 23 is still the evening of Oct 22 in California.
  assert.equal(tomorrowInLosAngeles(new Date('2026-10-23T03:00:00Z')), '2026-10-23')
  assert.equal(tomorrowInLosAngeles(new Date('2026-10-23T20:00:00Z')), '2026-10-24')
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01')
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28')
  assert.equal(formatDmDate('2026-10-23'), 'Fri, Oct 23, 2026')
})

test('a DM names its lots', () => {
  const lots = (...numbers) => ({ lots: numbers.map((lotNumber) => ({ lotNumber })) })
  assert.equal(describeDmLots(lots('7')), 'Lot 7')
  assert.equal(describeDmLots(lots('1', '2', '3', '10')), 'Lots 1–3, 10')
})

test('a DM in the list says whether it was announced or has nobody to write to', () => {
  const draft = { recipients: [{ email: 'a@x.com' }] }

  assert.deepEqual(describeDmStatus({ draft }), { color: 'default', label: 'Not sent' })
  assert.deepEqual(describeDmStatus({ draft: { recipients: [] } }), {
    color: 'warning',
    label: 'Nobody to send to',
  })
  const sent = describeDmStatus({ draft, sentAt: '2026-10-22T16:00:00Z' })
  assert.equal(sent.color, 'success')
  assert.match(sent.label, /^Sent Oct 22, 2026/)
})

test('the dialog starts from the draft the server built', () => {
  const draft = dmDraftFromPreview({
    draft: {
      subject: 'DM Fri, Oct 23, 2026 · Job #1319',
      recipients: [
        { role: 'Supervisor', name: 'Hilario', email: ' Hilario@valtriminc.com ' },
        { role: 'Project Manager', name: 'Hilario', email: 'hilario@valtriminc.com' },
        { role: 'Project Manager', name: 'Pat', email: '' },
      ],
    },
    event: { missingRoles: ['Project Manager'] },
  })

  assert.equal(draft.subject, 'DM Fri, Oct 23, 2026 · Job #1319')
  assert.deepEqual(draft.recipients, [
    { email: 'hilario@valtriminc.com', role: 'Supervisor', name: 'Hilario' },
  ])
  assert.deepEqual(draft.missingRoles, ['Project Manager'])
  assert.deepEqual(dmDraftFromPreview(null).recipients, [])
})

test('missing contacts and sent emails read as sentences', () => {
  assert.equal(describeMissingDmRoles([]), null)
  assert.match(describeMissingDmRoles(['Project Manager']), /^Project Manager is not set on this Job or has no email/)
  assert.match(describeMissingDmRoles(['Supervisor', 'Project Manager']), /^Supervisor and Project Manager are not set/)

  assert.equal(
    describeDmEmailSent({ recipients: ['a@x.com', 'b@x.com'] }),
    'Email sent to a@x.com, b@x.com.',
  )
})
