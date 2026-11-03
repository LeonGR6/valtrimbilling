import { toCustomerServiceEmailRecoveryPayload, toCustomerServiceIntakeEditPayload, toCustomerServiceIntakePayload } from '../utils/customerServiceIntake.js'
import { toCustomerServiceIntakeRecord } from './customerServiceIntakeRecord.js'

export function createCustomerServiceIntakeRepository({ getClient, uploadPdf }) {
  async function read(requestId = null) {
    const client = await getClient()
    const { data, error } = await client.rpc('read_customer_service_request_intakes', {
      p_request_id: requestId,
    })
    if (error) throw new Error(error.message || 'Customer Service requests could not be loaded.', { cause: error })
    return (data ?? []).map(toCustomerServiceIntakeRecord)
  }

  async function readOne(id) {
    const [request] = await read(id)
    if (!request) throw new Error('The saved request could not be loaded. Reload requests and try again.')
    return request
  }

  async function completeRecovery(importId) {
    const client = await getClient()
    const { data, error } = await client.rpc('complete_customer_service_email_recovery', { p_import_id: importId })
    if (error) throw new Error(error.message || 'Recovery was not confirmed. Refresh the inbox.', { cause: error })
    return toCustomerServiceIntakeRecord(data)
  }

  return {
    list: () => read(),
    completeRecovery,
    async recover(receipt, values) {
      const { payload, source } = toCustomerServiceEmailRecoveryPayload(values)
      if (source) {
        const file = values.sourceDocument?.file
        if (!file || !file.name?.trim() || file.name.trim().length > 255 || typeof file.arrayBuffer !== 'function') {
          throw new Error('Select a valid PDF for recovery.')
        }
        const bytes = await file.arrayBuffer()
        if (bytes.byteLength !== file.size || file.size < 1 || file.size > 10485760
          || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') {
          throw new Error('The recovery PDF is empty, exceeds 10 MiB or does not have a valid PDF signature.')
        }
        source.sha256 = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))]
          .map((byte) => byte.toString(16).padStart(2, '0')).join('')
        source.sizeBytes = file.size
        source.originalFilename = file.name.trim()
      }
      const client = await getClient()
      const { data, error } = await client.rpc('recover_customer_service_email_import', {
        p_import_id: receipt.id, p_expected_updated_at: receipt.updatedAt,
        p_payload: payload, p_source: source,
      })
      if (error) throw new Error(error.message || 'The import could not be recovered.', { cause: error })
      const saved = toCustomerServiceIntakeRecord(data)
      if (saved.emailImportId !== receipt.id) throw new Error('The server did not confirm the link to the import.')
      try {
        // A concurrent winner is canonical. Never replace its source or fields.
        if (saved.sourceDocument?.sourceType === 'PDF') {
          if (saved.sourceDocument.fileStatus !== 'AVAILABLE') {
            const pinned = saved.sourceDocument.recoveryPdf
            if (pinned && source && (pinned.sha256 !== source.sha256 || pinned.sizeBytes !== source.sizeBytes
              || pinned.originalFilename !== source.originalFilename)) {
              throw new Error(`This request already has ${pinned.originalFilename} assigned as its recovery PDF. Open its recovery to finish uploading that file.`)
            }
            const file = values.sourceDocument?.file
            if (!file) throw new Error('The request already exists. Select its recovery PDF to finish uploading it.')
            await uploadPdf(saved.id, file)
          }
          return await completeRecovery(receipt.id)
        }
        return saved
      } catch (cause) {
        const failure = new Error(`${saved.requestNumber} was saved. ${cause.message}`, { cause })
        failure.savedIdentity = { id: saved.id, requestNumber: saved.requestNumber }
        failure.savedRequest = await readOne(saved.id).catch(() => saved)
        throw failure
      }
    },
    async markReady(request, { valtrimItemsConfirmed }) {
      const client = await getClient()
      const { data, error } = await client.rpc('mark_customer_service_request_ready', {
        p_request_id: request.id,
        p_expected_updated_at: request.updatedAt,
        p_valtrim_items_confirmed: valtrimItemsConfirmed === true,
      })
      if (error) throw new Error(error.message || 'The request could not be approved.', { cause: error })
      return toCustomerServiceIntakeRecord(data)
    },
    async update(request, values) {
      const client = await getClient()
      const { data, error } = await client.rpc('update_customer_service_request_intake', {
        p_request_id: request.id,
        // Preserve the exact database timestamp, including microseconds.
        p_expected_updated_at: request.updatedAt,
        p_payload: toCustomerServiceIntakeEditPayload(request, values),
      })
      if (error) throw new Error(error.message || 'The request could not be updated.', { cause: error })
      return toCustomerServiceIntakeRecord(data)
    },
    async create(values, submissionKey) {
      const client = await getClient()
      const { data: intake, error } = await client.rpc('create_customer_service_request_intake', {
        p_submission_key: submissionKey,
        p_payload: toCustomerServiceIntakePayload(values),
      })
      if (error) throw new Error(error.message || 'The request could not be saved.', { cause: error })

      try {
        const file = values.sourceDocument?.sourceType === 'PDF' ? values.sourceDocument.file : null
        if (file) await uploadPdf(intake.requestId, file)
        return await readOne(intake.requestId)
      } catch (cause) {
        const failure = new Error(
          `${intake.folio} was saved. ${cause.message} Retry to finish this same request.`,
          { cause },
        )
        failure.savedIdentity = { id: intake.requestId, requestNumber: intake.folio }
        // A failed PDF does not hide the committed request from the inbox.
        failure.savedRequest = await readOne(intake.requestId).catch(() => null)
        throw failure
      }
    },
    async retryPdf(requestId, file) {
      await uploadPdf(requestId, file)
      const saved = await readOne(requestId)
      return saved.emailImportId ? completeRecovery(saved.emailImportId) : saved
    },
  }
}
