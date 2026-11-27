import { emailImportProblemTitle } from '../utils/emailImportProblems.js'

const text = (value) => typeof value === 'string' ? value.trim() : ''

export function safeEmailWebLink(value) {
  if (!text(value)) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

function senderLabel(value) {
  if (typeof value === 'string') return text(value)
  const sender = value?.emailAddress ?? value
  return [text(sender?.name), text(sender?.address)].filter(Boolean).join(' · ')
}

// Retain display metadata only, not bodies, extraction, files or worker tokens.
export function toEmailImportSummary(row) {
  return {
    id: row.id,
    subject: text(row.subject) || 'No subject',
    sender: senderLabel(row.from) || 'Sender not available',
    status: row.status,
    attemptCount: row.attempt_count,
    lastAttemptAt: row.last_attempt_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    errorCode: text(row.error_code),
    errorMessage: row.error_message ? emailImportProblemTitle(row.error_code) : '',
    requestId: row.request_id ?? null,
    requestFolio: text(row.request_folio),
  }
}

export function toEmailImportDetail(row) {
  const source = row.source_payload ?? {}
  return {
    ...toEmailImportSummary({ ...row, subject: source.subject, from: source.from }),
    sourceStatus: text(row.source_status),
    nextAttemptAt: row.next_attempt_at ?? null,
    webLink: safeEmailWebLink(source.webLink),
    originalSender: text(source.from?.emailAddress?.address) || text(source.from?.address) || text(source.from),
    originalSubject: text(source.subject),
  }
}

export function createCustomerServiceEmailImportRepository({ getClient }) {
  async function read(name, params, message) {
    const client = await getClient()
    const { data, error } = await client.rpc(name, params)
    if (error) {
      throw new Error(error.code === '42501'
        ? 'Your session does not have permission to view these imports.'
        : message, { cause: error })
    }
    return data
  }

  return {
    async retry(receipt) {
      const client = await getClient()
      const { data, error } = await client.functions.invoke('customer-service-email-retry', {
        body: { importId: receipt.id, expectedUpdatedAt: receipt.updatedAt },
      })
      if (error || data?.error) {
        let body = data
        try { if (error?.context?.clone) body = await error.context.clone().json() } catch { /* Use a safe English fallback. */ }
        const message = typeof body?.error === 'string' && /^WORKER_DISABLED(?::|$)/.test(body.error)
          ? 'Automatic processing is disabled. Ask an administrator to enable it before retrying.'
          : error?.context?.status === 403 ? 'Your session does not have permission to retry this import.'
            : error?.context?.status === 409 ? 'The import changed or cannot be retried. Refresh its status before continuing.'
              : 'The retry was not confirmed. Refresh the status before trying again.'
        throw new Error(message, { cause: error })
      }
      if (data?.importId !== receipt.id || !['PENDING', 'PROCESSING', 'NEEDS_ATTENTION', 'PROCESSED'].includes(data.status)
        || (data.status === 'PROCESSED' && data.requestId == null)) {
        throw new Error('The retry result was not confirmed. Refresh the view.')
      }
      return { importId: data.importId, requestId: data.requestId, status: data.status,
        errorCode: data.errorCode ?? null, nextAttemptAt: data.nextAttemptAt ?? null }
    },
    async count() {
      const data = await read('count_customer_service_email_imports', {},
        'The email issue count could not be checked.')
      if (!Number.isSafeInteger(data?.needsAttention) || data.needsAttention < 0) {
        throw new Error('The server did not return a valid count.')
      }
      return data.needsAttention
    },
    async list({ limit = 10, offset = 0 } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100
        || !Number.isSafeInteger(offset) || offset < 0) {
        throw new Error('The import page is invalid.')
      }
      const data = await read('list_customer_service_email_imports', {
        p_status: 'NEEDS_ATTENTION', p_limit: limit, p_offset: offset,
      }, 'Emails with import issues could not be loaded.')
      if (!Array.isArray(data) || data.some((row) => !row?.id || row.status !== 'NEEDS_ATTENTION')) {
        throw new Error('The server did not return a valid import list.')
      }
      return data.map(toEmailImportSummary)
    },
    async detail(importId) {
      const data = await read('read_customer_service_email_import', { p_import_id: importId },
        'Import details could not be loaded.')
      if (!data || data.id !== importId) throw new Error('The requested import is not available.')
      return toEmailImportDetail(data)
    },
  }
}
