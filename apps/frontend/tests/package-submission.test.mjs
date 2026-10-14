import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_EMAIL_ATTACHMENT_BYTES,
  bytesToBase64,
  defaultSubmissionMessage,
  defaultSubmissionSubject,
  addRecipients,
  describeSentHistory,
  describeSentPackage,
  describeSubmission,
  fitsAsAttachment,
  recipientsProblem,
  splitRecipientText,
  toPackageSubmission,
} from '../src/features/draw-invoice/services/packageSubmissionRecord.js'

test('a large PDF is turned into base64 without overflowing the stack', () => {
  const bytes = new Uint8Array(200_000).map((_, index) => index % 251)
  const base64 = bytesToBase64(bytes)

  assert.equal(Buffer.from(base64, 'base64').equals(Buffer.from(bytes)), true)
  assert.equal(bytesToBase64(new Uint8Array([37, 80, 68, 70])), 'JVBERg==')
})

test('the Builder setup decides how the Package goes out', () => {
  assert.deepEqual(describeSubmission('EMAIL', ' ap@builder.com '), {
    kind: 'EMAIL',
    title: 'Send by email',
    target: 'ap@builder.com',
  })
  assert.equal(describeSubmission('MAIL', '12 Main St, Austin TX').kind, 'MAIL')
  assert.equal(describeSubmission('PORTAL', 'Textura').kind, 'PORTAL')
  // A setup with no known method is treated as a portal.
  assert.equal(describeSubmission(undefined, null).kind, 'PORTAL')
})

test('only a PDF that fits is sent as an attachment', () => {
  assert.equal(fitsAsAttachment(new Uint8Array(10)), true)
  assert.equal(fitsAsAttachment(new Uint8Array(0)), false)
  assert.equal(fitsAsAttachment({ length: MAX_EMAIL_ATTACHMENT_BYTES + 1 }), false)
})

test('the email starts with a subject and message that name the Package', () => {
  const context = { packageNumber: 'DP-00000004', jobCode: '1319', community: 'El Monte', netAmount: 53138.25 }

  assert.equal(defaultSubmissionSubject(context), 'Draw Package DP-00000004 · Job #1319 · El Monte')
  const message = defaultSubmissionMessage(context)
  assert.match(message, /DP-00000004/)
  assert.match(message, /\$53,138\.25/)
  assert.equal(defaultSubmissionMessage({ ...context, netAmount: null }).includes('Invoice amount'), false)

  // Once the Package has an invoice, the email speaks of the invoice by its number.
  const invoiced = { ...context, invoiceNumber: '15001' }
  assert.equal(defaultSubmissionSubject(invoiced), 'Invoice 15001 · Job #1319 · El Monte')
  assert.match(defaultSubmissionMessage(invoiced), /attached Invoice 15001/)
  assert.doesNotMatch(defaultSubmissionMessage(invoiced), /DP-00000004/)
})

test('a Package that was emailed says to whom and when, and how many more addresses', () => {
  const row = (id, destination, sent_at) => toPackageSubmission({
    id,
    package_id: 4,
    method: 'EMAIL',
    destination,
    subject: 's',
    file_name: 'f.pdf',
    sent_at,
  })
  const newest = row(2, 'ap@builder.com, cc@builder.com, boss@builder.com', '2026-10-14T18:30:00Z')
  const older = row(1, 'old@builder.com', '2026-10-13T18:30:00Z')

  assert.equal(describeSentPackage([]), '')
  assert.match(describeSentPackage([row(3, 'ap@builder.com', '2026-10-14T18:30:00Z')]), /^Sent to ap@builder\.com · Oct 1[34]$/)
  // "(+2 more)" counts the other addresses of that email, not earlier emails.
  assert.match(describeSentPackage([newest, older]), /^Sent to ap@builder\.com \(\+2 more\) · Oct 1[34]$/)
  assert.deepEqual(
    { id: newest.id, destination: newest.destination, fileName: newest.fileName },
    { id: 2, destination: 'ap@builder.com, cc@builder.com, boss@builder.com', fileName: 'f.pdf' },
  )
})

test('the history lists every email with its date and all its recipients', () => {
  const history = describeSentHistory([
    toPackageSubmission({ id: 2, package_id: 4, method: 'EMAIL', destination: 'ap@builder.com, cc@builder.com', subject: 's', file_name: 'f.pdf', sent_at: '2026-10-14T18:30:00Z' }),
    toPackageSubmission({ id: 1, package_id: 4, method: 'EMAIL', destination: 'old@builder.com', subject: 's', file_name: 'f.pdf', sent_at: '2026-10-13T18:30:00Z' }),
  ])

  assert.deepEqual(history.map((entry) => [entry.id, entry.isLatest, entry.recipients]), [
    [2, true, ['ap@builder.com', 'cc@builder.com']],
    [1, false, ['old@builder.com']],
  ])
  assert.match(history[0].when, /Oct 1[34], 2026/)
})

test('recipients typed with commas are added once each, in lowercase', () => {
  assert.deepEqual(splitRecipientText(' A@x.com, b@y.com;\nC@z.com ,, '), ['a@x.com', 'b@y.com', 'c@z.com'])
  assert.deepEqual(addRecipients(['ap@builder.com'], 'AP@builder.com, cc@builder.com'), [
    'ap@builder.com',
    'cc@builder.com',
  ])
  assert.deepEqual(addRecipients([], ''), [])
})

test('the list of recipients says what is wrong with it', () => {
  assert.equal(recipientsProblem(['ap@builder.com', 'cc@builder.com']), '')
  assert.equal(recipientsProblem([]), 'Add at least one recipient.')
  assert.match(recipientsProblem(['ap@builder.com', 'oops']), /Fix or remove: oops\./)
  assert.match(
    recipientsProblem(Array.from({ length: 11 }, (_, index) => `a${index}@builder.com`)),
    /up to 10/,
  )
})
