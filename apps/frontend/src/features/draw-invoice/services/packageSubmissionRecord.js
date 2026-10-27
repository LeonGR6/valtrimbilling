// How a generated Package goes to the Builder, the way the Builder's setup says.
// Pure helpers; the call to the email function is in packageSubmissionRepository.js.

export const MAX_EMAIL_ATTACHMENT_BYTES = 15 * 1024 * 1024

/** The PDF as base64, built in chunks so a large file does not overflow the call stack. */
export function bytesToBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

export function newSubmissionRequestId() {
  return crypto.randomUUID().replaceAll('-', '')
}

/**
 * How the Package goes to the Builder: by email, by mail (printed) or through
 * the Builder's portal. Anything else is treated as a portal.
 */
export function describeSubmission(method, destination) {
  const target = String(destination ?? '').trim()
  if (method === 'EMAIL') {
    return { kind: 'EMAIL', title: 'Send by email', target }
  }
  if (method === 'MAIL') {
    return { kind: 'MAIL', title: 'Print and mail', target }
  }
  return { kind: 'PORTAL', title: 'Upload to the portal', target }
}

/**
 * Whether generating the Package (the button that downloads it) moves it to Awaiting payment: it is
 * still a Draft, and its invoice is a real one. A Package invoiced in QuickBooks Test can be
 * generated to review it but never counts as submitted.
 */
export function movesToAwaitingPaymentOnGenerate(packageRecord, { isTestInvoice = false } = {}) {
  return !isTestInvoice && packageRecord?.status === 'DRAFT'
}

/**
 * What the generate dialog adds about the status once the Package is downloaded. `attempted` is
 * whether the Package was to be moved; `workflowStatus` is what the database answered, and
 * `failed` that it could not be updated (the PDF is downloaded all the same).
 */
export function describeStatusAfterGenerate({ attempted = false, workflowStatus = null, failed = false } = {}) {
  if (!attempted) return ''
  if (failed) return ' Its status could not be updated: change it by hand.'
  return workflowStatus === 'AWAITING_PAYMENT' ? ' The Package is now Awaiting payment.' : ''
}

/** True when the PDF is small enough to travel as an email attachment. */
export function fitsAsAttachment(bytes) {
  return bytes.length > 0 && bytes.length <= MAX_EMAIL_ATTACHMENT_BYTES
}

// What the email calls the document: the invoice by its number once it has
// one, the Package by its own number before.
function documentName({ packageNumber, invoiceNumber }) {
  return invoiceNumber ? `Invoice ${invoiceNumber}` : `Draw Package ${packageNumber}`
}

/** The subject the email starts with; it can be edited before sending. */
export function defaultSubmissionSubject({ packageNumber, invoiceNumber, jobCode, community }) {
  return `${documentName({ packageNumber, invoiceNumber })} · Job #${jobCode} · ${community}`.trim()
}

/** The message the email starts with; it can be edited before sending. */
export function defaultSubmissionMessage({ packageNumber, invoiceNumber, jobCode, community, netAmount }) {
  const amount = netAmount == null
    ? ''
    : `\nInvoice amount: ${Number(netAmount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`
  return `Hello,\n\nPlease find attached ${documentName({ packageNumber, invoiceNumber })} for ${community} `
    + `(Job #${jobCode}).${amount}\n\nThank you.`
}

/** A row of `package_submissions` in the shape the screens use. */
export function toPackageSubmission(row) {
  return {
    id: row.id,
    packageId: row.package_id,
    method: row.method,
    destination: row.destination,
    subject: row.subject,
    fileName: row.file_name,
    sentAt: row.sent_at,
  }
}

/** "Oct 14" for a timestamp, in the viewer's own time zone. */
export function formatSentDay(sentAt) {
  return new Date(sentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** The addresses an email went to: what was saved, comma-separated, as a list. */
export function submissionRecipients(submission) {
  return String(submission?.destination ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean)
}

/**
 * The line shown on a Package that was emailed: "Sent to ap@builder.com · Oct 14",
 * with "(+2 more)" when that email went to more addresses. Only the latest
 * email is on the line; the full list and the earlier emails are in
 * `describeSentHistory`. Empty when it never was sent.
 */
export function describeSentPackage(submissions) {
  const [latest] = submissions
  if (!latest) return ''

  const [first, ...others] = submissionRecipients(latest)
  return `Sent to ${first ?? latest.destination}${
    others.length > 0 ? ` (+${others.length} more)` : ''
  } · ${formatSentDay(latest.sentAt)}`
}

const sentStampFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/**
 * Every email of a Package, newest first, for a tooltip: when it went out and
 * to whom. The first entry is the latest one; the rest are earlier emails.
 */
export function describeSentHistory(submissions) {
  return submissions.map((submission, index) => ({
    id: submission.id,
    when: sentStampFormatter.format(new Date(submission.sentAt)),
    recipients: submissionRecipients(submission),
    isLatest: index === 0,
  }))
}

export const MAX_RECIPIENTS = 10
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

/** Splits what was typed or pasted at commas, semicolons and line breaks. */
export function splitRecipientText(text) {
  return String(text ?? '')
    .split(/[,;\n]/u)
    .map((part) => part.trim().replace(/^<|>$/gu, '').toLowerCase())
    .filter(Boolean)
}

/** Adds the typed addresses to the list, once each. */
export function addRecipients(current, text) {
  const next = [...current]
  for (const email of splitRecipientText(text)) {
    if (!next.includes(email)) next.push(email)
  }
  return next
}

export const isValidRecipient = (email) => EMAIL_PATTERN.test(email)

/** Why the list cannot be sent, or '' when it can. */
export function recipientsProblem(recipients) {
  if (recipients.length === 0) return 'Add at least one recipient.'
  const invalid = recipients.filter((email) => !isValidRecipient(email))
  if (invalid.length > 0) {
    return `Fix or remove: ${invalid.join(', ')}.`
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return `A Package email can have up to ${MAX_RECIPIENTS} recipients.`
  }
  return ''
}
