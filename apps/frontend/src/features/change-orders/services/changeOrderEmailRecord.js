// Pure helpers for the email that tells a Job's Scheduling contact which lots of an Extra / CO are
// charged with a Calendar event: when to offer it, and how the record of what was sent reads. Who
// the email goes to is handled by the same helpers as the other emails (purchaseOrderEmailRecord.js).
// Nothing here touches the network or React.

// An Extra / CO that is still a Draft is not something Scheduling should act on yet.
const OFFER_STATUSES = ['PENDING', 'APPROVED']

/** True when an Extra / CO can be announced to Scheduling: it is not a Draft or Cancelled. */
export const canTellScheduling = (status) => OFFER_STATUSES.includes(status)

/**
 * Whether, right after saving, the person is asked about telling Scheduling: the Extra / CO is no
 * longer a Draft and the save added a tie to an event, or changed the event of one. `links` is what is
 * being saved, `{ [lotId]: 'EXT' }`; `savedLinks` the ties it had when it was opened, `{ [lotId]: { event } }`
 * (none for a new one, so every tie of a new Extra / CO counts).
 */
export function shouldOfferSchedulingEmail({ status, links = {}, savedLinks = {} }) {
  if (!canTellScheduling(status)) return false
  return Object.entries(links).some(([lotId, event]) => savedLinks[lotId]?.event !== event)
}

/** What the screen says once the email is out: "Email sent to a@x.com, b@x.com." */
export function describeSchedulingEmailSent(result) {
  const recipients = result?.recipients ?? []
  return `Email sent to ${recipients.join(', ')}.`
}

/** A row of `change_order_event_emails`. */
export function toEmailRecord(row) {
  return {
    id: row.id,
    events: row.events ?? [],
    lotCount: Number(row.lot_count ?? 0),
    recipients: row.recipients ?? [],
    subject: row.subject ?? '',
    sentAt: row.sent_at,
  }
}

/**
 * How the last email reads under the Calendar event: "Scheduling was emailed on {date}: a@x.com, b@x.com",
 * with "(and 1 more time)" when it went out more than once. `formatWhen` writes the date.
 */
export function describeEmailHistory(records, formatWhen) {
  if (!records || records.length === 0) return ''
  const [last] = records
  const again = records.length > 1
    ? ` (${records.length - 1} earlier ${records.length === 2 ? 'email' : 'emails'})`
    : ''
  return `Scheduling was emailed on ${formatWhen(last.sentAt)}: ${last.recipients.join(', ')}${again}`
}
