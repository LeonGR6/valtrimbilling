import { createCustomerServiceEmailImportRepository, safeEmailWebLink } from './customerServiceEmailImportRepository.js'
import { emailImportProblemTitle } from '../utils/emailImportProblems.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const states = new Set(['PROCESSING', 'REQUIRES_ACTION', 'REGISTERED'])
const kinds = new Set(['IMPORT', 'FOLDER_MESSAGE'])
const text = (value) => typeof value === 'string' ? value.trim() : ''
const positiveId = (value) => Number.isSafeInteger(value) && value > 0
const date = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null

export function toEmailInboxItem(row) {
  if (!row || !uuid.test(row.id) || !kinds.has(row.sourceKind) || !states.has(row.state)
    || !Number.isSafeInteger(row.resolutionVersion) || row.resolutionVersion < 0
    || !date(row.updatedAt) || (row.requestId != null && !positiveId(row.requestId))
    || (row.state === 'REGISTERED' && (!positiveId(row.requestId) || !text(row.requestFolio)))) {
    throw new Error('The email status could not be confirmed. Refresh the inbox.')
  }
  const sender = row.sender?.emailAddress ?? row.sender
  return {
    id: row.id, sourceKind: row.sourceKind, state: row.state,
    subject: text(row.subject) || 'Subject not yet available',
    metadataPending: row.sourceKind === 'FOLDER_MESSAGE' && !text(row.subject) && !row.sender && !row.receivedAt,
    sender: typeof sender === 'string' ? text(sender) : [text(sender?.name), text(sender?.address)].filter(Boolean).join(' · '),
    webLink: safeEmailWebLink(row.webLink), reasonCode: text(row.reasonCode),
    errorMessage: row.errorMessage ? emailImportProblemTitle(row.reasonCode) : '',
    createdAt: date(row.createdAt), updatedAt: row.updatedAt, receivedAt: date(row.receivedAt), lastAttemptAt: date(row.lastAttemptAt),
    requestId: row.requestId ?? null, requestFolio: text(row.requestFolio), requestWorkflowStage: text(row.requestWorkflowStage),
    previousRequestFolio: text(row.previousRequestFolio), confirmedAt: date(row.confirmedAt),
    resolutionVersion: row.resolutionVersion, importStatus: text(row.importStatus), sourceStatus: text(row.sourceStatus),
    importUpdatedAt: date(row.importUpdatedAt), nextAttemptAt: date(row.nextAttemptAt),
  }
}

export function toEmailInboxCounts(row) {
  if (!row || !['processing', 'requiresAction', 'unmatched', 'importIssues', 'registered', 'total'].every((key) => Number.isSafeInteger(row[key]) && row[key] >= 0)
    || row.processing + row.requiresAction + row.registered !== row.total
    || row.unmatched + row.importIssues !== row.requiresAction || typeof row.revision !== 'string') {
    throw new Error('Email counts could not be confirmed. Refresh the inbox.')
  }
  return { processing: row.processing, requiresAction: row.requiresAction, unmatched: row.unmatched, importIssues: row.importIssues,
    registered: row.registered, total: row.total, revision: row.revision }
}

export function emailInboxImportReceipt(item) {
  return { id: item.id, subject: item.subject, originalSubject: item.subject, sender: item.sender, originalSender: item.sender,
    status: item.importStatus, sourceStatus: item.sourceStatus, updatedAt: item.importUpdatedAt,
    requestId: item.requestId, requestFolio: item.requestFolio, errorCode: item.reasonCode, errorMessage: item.errorMessage,
    webLink: item.webLink, nextAttemptAt: item.nextAttemptAt }
}

export function createCustomerServiceEmailInboxRepository({ getClient }) {
  const imports = createCustomerServiceEmailImportRepository({ getClient })
  async function rpc(name, args) {
    const client = await getClient()
    const { data, error } = await client.rpc(name, args)
    if (error) {
      const messages = {
        '42501': 'Your session does not have permission for this operation.',
        '40001': 'The email changed during review. Refresh and check its result.',
        '55000': 'The email is being processed or already has another result. Refresh before continuing.',
        P0002: 'The email or request is no longer available. Refresh the inbox.',
      }
      throw new Error(messages[error.code] || 'The operation could not be confirmed. Refresh the status before repeating it.', { cause: error })
    }
    return data
  }
  function identity(item) {
    if (!uuid.test(item?.id) || !kinds.has(item?.sourceKind)) throw new Error('The selected email is invalid.')
  }
  return {
    async count() { return toEmailInboxCounts(await rpc('count_customer_service_email_inbox', {})) },
    async list({ state = null, limit = 10, offset = 0 } = {}) {
      if ((state !== null && !states.has(state)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
        || !Number.isSafeInteger(offset) || offset < 0) throw new Error('The email query is invalid.')
      const data = await rpc('list_customer_service_email_inbox', { p_state: state, p_limit: limit, p_offset: offset })
      if (!Array.isArray(data) || data.length > limit) throw new Error('The email list could not be read.')
      const rows = data.map(toEmailInboxItem)
      if (rows.some((row) => state && row.state !== state)
        || new Set(rows.map((row) => `${row.sourceKind}:${row.id}`)).size !== rows.length) throw new Error('The email list changed. Refresh the view.')
      return rows
    },
    async read(item) {
      identity(item)
      const data = await rpc('read_customer_service_email_inbox_item', { p_source_kind: item.sourceKind, p_id: item.id })
      if (data?.id !== item.id || data?.sourceKind !== item.sourceKind) throw new Error('The email is no longer in this inbox. Refresh the view.')
      return toEmailInboxItem(data)
    },
    async retry(item) {
      identity(item)
      if (item.sourceKind !== 'IMPORT') throw new Error('This email does not yet have an analysis to retry.')
      return imports.retry(emailInboxImportReceipt(item))
    },
    async confirm(item, requestId) {
      identity(item)
      if (item.sourceKind !== 'FOLDER_MESSAGE' || item.state !== 'REQUIRES_ACTION' || !positiveId(requestId)
        || !Number.isSafeInteger(item.resolutionVersion) || item.resolutionVersion < 0) throw new Error('Select a pending email and an existing request.')
      const data = await rpc('confirm_customer_service_email_request', {
        p_message_id: item.id, p_request_id: requestId, p_expected_version: item.resolutionVersion,
      })
      if (data?.id !== item.id || data.state !== 'REGISTERED' || data.requestId !== requestId || !text(data.requestFolio)) {
        throw new Error('The match was not confirmed. Refresh the email status.')
      }
      return data
    },
  }
}
