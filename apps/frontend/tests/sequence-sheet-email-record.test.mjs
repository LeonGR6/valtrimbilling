import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_SEQUENCE_SHEET_RECIPIENTS,
  DEFAULT_SEQUENCE_SHEET_RECIPIENT_TEXT,
  describeSequenceSheetEmailsSent,
  parseSequenceSheetRecipients,
  sequenceSheetEmailDrafts,
  sequenceSheetEmailPreviewDocument,
  validateSequenceSheetSubject,
} from '../src/features/sequence-sheets/services/sequenceSheetEmailRecord.js'

test('Sequence Sheet emails default to the two internal recipients', () => {
  assert.deepEqual(DEFAULT_SEQUENCE_SHEET_RECIPIENTS, [
    'amarquez@valtriminc.com',
    'dalvarez@valtriminc.com',
  ])
  assert.equal(
    DEFAULT_SEQUENCE_SHEET_RECIPIENT_TEXT,
    'amarquez@valtriminc.com, dalvarez@valtriminc.com',
  )
})

test('Sequence Sheet recipients are normalized, deduplicated and comma-separated', () => {
  assert.deepEqual(
    parseSequenceSheetRecipients(' Jamie@Example.com, billing@example.com, jamie@example.com '),
    {
      success: true,
      recipients: ['jamie@example.com', 'billing@example.com'],
    },
  )
})

test('Sequence Sheet recipients reject empty, malformed and oversized lists', () => {
  assert.equal(parseSequenceSheetRecipients('').success, false)
  assert.equal(parseSequenceSheetRecipients('not-an-email').success, false)
  assert.equal(
    parseSequenceSheetRecipients(
      Array.from({ length: 11 }, (_, index) => `person${index}@example.com`).join(','),
    ).success,
    false,
  )
})

test('Sequence Sheet preview wraps the rendered HTML without injecting actions', () => {
  const document = sequenceSheetEmailPreviewDocument('<table><tr><td>Lot 9</td></tr></table>')
  assert.match(document, /Lot 9/u)
  assert.doesNotMatch(document, /View in ValtrimBilling/u)
  assert.doesNotMatch(document, /\.pdf/iu)
})

test('the drafts become editable emails with the suggested recipients', () => {
  const drafts = sequenceSheetEmailDrafts({
    rendered: { subject: 'Sequence Sheet · Job #1 · Phase 1' },
    drafts: [
      {
        key: 'first-release',
        label: 'First release',
        subject: 'First Release',
        recipients: [
          { role: 'Job Coordinator', name: 'Jo', email: 'Jo@Builder.com' },
          { role: 'Options Coordinator', name: 'Op', email: 'options@builder.com' },
        ],
      },
      {
        key: 'finishes',
        label: 'Drywall & stucco',
        subject: 'Drywall',
        recipients: [{ role: 'Job Coordinator', name: 'Jo', email: 'jo@builder.com' }],
      },
    ],
  })

  assert.equal(drafts.length, 2)
  assert.equal(drafts[0].recipientText, 'jo@builder.com, options@builder.com')
  assert.deepEqual(drafts[0].recipientRoles, ['Job Coordinator', 'Options Coordinator'])
  assert.equal(drafts[1].recipientText, 'jo@builder.com')
  assert.equal(drafts[1].subject, 'Drywall')
})

test('a draft without suggested emails keeps the usual recipients', () => {
  const [draft] = sequenceSheetEmailDrafts({
    drafts: [{ key: 'a', label: 'A', subject: 'S', recipients: [{ role: 'Purchasing', email: '' }] }],
  })

  assert.equal(draft.recipientText, DEFAULT_SEQUENCE_SHEET_RECIPIENT_TEXT)
})

test('a preview without proposed drafts still yields one email', () => {
  const drafts = sequenceSheetEmailDrafts({ rendered: { subject: 'Sequence Sheet · Job #1' } })

  assert.equal(drafts.length, 1)
  assert.equal(drafts[0].subject, 'Sequence Sheet · Job #1')
  assert.equal(drafts[0].recipientText, DEFAULT_SEQUENCE_SHEET_RECIPIENT_TEXT)
  assert.deepEqual(sequenceSheetEmailDrafts(null), [])
})

test('the subject must be present and not too long', () => {
  assert.deepEqual(validateSequenceSheetSubject('  Hello  '), { success: true, subject: 'Hello' })
  assert.equal(validateSequenceSheetSubject('   ').success, false)
  assert.equal(validateSequenceSheetSubject('x'.repeat(201)).success, false)
})

test('the success notice names every recipient once', () => {
  assert.equal(
    describeSequenceSheetEmailsSent([{ recipients: ['a@x.com'] }]),
    'Sequence Sheet emailed to a@x.com.',
  )
  assert.equal(
    describeSequenceSheetEmailsSent([
      { recipients: ['a@x.com', 'b@x.com'] },
      { recipients: ['a@x.com'] },
    ]),
    '2 Sequence Sheet emails sent to a@x.com, b@x.com.',
  )
})
