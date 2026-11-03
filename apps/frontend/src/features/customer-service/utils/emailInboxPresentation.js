import { canRetryEmailImport, emailImportProblemTitle } from './emailImportProblems.js'
import { emailInboxImportReceipt } from '../services/customerServiceEmailInboxRepository.js'

export const emailInboxStates = {
  REQUIRES_ACTION: { label: 'Import issue', color: 'warning' },
  PROCESSING: { label: 'Processing', color: 'info' },
  REGISTERED: { label: 'Registered', color: 'success' },
}

export const emailInboxCounters = [
  { key: 'unmatched', label: 'Emails to match', color: 'info' },
  { key: 'importIssues', label: 'Import issues', color: 'warning' },
  { key: 'processing', label: 'Processing', color: 'info' },
  { key: 'registered', label: 'Registered emails', color: 'success' },
]

export function emailInboxItemState(item) {
  if (item.state === 'REQUIRES_ACTION' && item.sourceKind === 'FOLDER_MESSAGE') return item.reasonCode === 'LINKED_REQUEST_REMOVED'
    ? { label: 'Request link missing', color: 'warning' } : { label: 'Unmatched email', color: 'info' }
  return emailInboxStates[item.state]
}

export function emailInboxReviewLabel(counts) {
  if (!counts) return 'View emails · — to review'
  if (!counts.requiresAction) return 'View emails · no pending review'
  return `View emails · ${[
    counts.unmatched ? `${counts.unmatched} to match` : null,
    counts.importIssues ? `${counts.importIssues} import ${counts.importIssues === 1 ? 'issue' : 'issues'}` : null,
  ].filter(Boolean).join(' · ')}`
}

export function emailInboxReason(item) {
  if (item.state === 'REGISTERED') return item.reasonCode === 'CONFIRMED_EXISTING_REQUEST'
    ? 'This email has a confirmed link to an existing request.' : 'This email has a registered request.'
  if (item.state === 'PROCESSING') return item.nextAttemptAt
    ? 'Another processing attempt is scheduled. The status will update automatically.'
    : 'The request is being prepared. The status will update automatically.'
  if (item.reasonCode === 'NO_IMPORT') return 'This email has no confirmed request link. If its original or forwarded copy already created a request, match it to that request to clear this review.'
  if (item.reasonCode === 'LINKED_REQUEST_REMOVED') return `Request${item.previousRequestFolio ? ` ${item.previousRequestFolio}` : ''} is no longer available. Review the email before matching it again.`
  if (item.reasonCode === 'ANALYSIS_INCOMPLETE') return 'Required details could not be completed. Review the email, then retry the analysis or complete the details.'
  if (item.reasonCode === 'RECOVERY_PDF_PENDING') return 'The request exists, but its PDF recovery is incomplete.'
  return emailImportProblemTitle(item.reasonCode)
}

export function canRetryInboxItem(item, now = Date.now()) {
  return item?.sourceKind === 'IMPORT' && item.state === 'REQUIRES_ACTION'
    && canRetryEmailImport(emailInboxImportReceipt(item))
    && (!item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= now)
}

export function emailInboxRequestLabel(request) {
  return [request.requestNumber, request.contactName, request.street].filter(Boolean).join(' · ')
}

export function emailInboxRequestStage(stage) {
  return ({ NEEDS_REVIEW: 'Awaiting human review', READY_TO_PROPOSE: 'Ready to propose',
    AWAITING_CUSTOMER: 'Awaiting customer response', NEEDS_CONTACT: 'Customer contact needed',
    CONFIRMED: 'Appointment confirmed', WORKING: 'Service in progress', COMPLETED: 'Service completed', CLOSED: 'Request closed' })[stage]
    ?? 'Check the request status'
}
