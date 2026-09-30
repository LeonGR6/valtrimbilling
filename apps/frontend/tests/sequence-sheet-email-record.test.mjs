import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseSequenceSheetRecipients,
  sequenceSheetEmailPreviewDocument,
} from '../src/features/sequence-sheets/services/sequenceSheetEmailRecord.js'

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
