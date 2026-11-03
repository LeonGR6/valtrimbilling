import test from 'node:test'
import assert from 'node:assert/strict'
import { createCustomerServiceEmailImportRepository } from '../src/features/customer-service/services/customerServiceEmailImportRepository.js'
import { createCustomerServiceEmailImportStore } from '../src/features/customer-service/context/customerServiceEmailImportStore.js'
import { createCustomerServiceIntakeRepository } from '../src/features/customer-service/services/customerServiceIntakeRepository.js'
import { createCustomerServiceRequestStore } from '../src/features/customer-service/context/customerServiceRequestStore.js'
import { toCustomerServiceEmailRecoveryPayload } from '../src/features/customer-service/utils/customerServiceIntake.js'
import { canRetryEmailImport } from '../src/features/customer-service/utils/emailImportProblems.js'
import { importedRequestDraftSchema, newRequestDraftSchema, requestToPrototypeFormValues } from '../src/features/customer-service/utils/newRequestPrototype.js'

const receipt = { id: 'ea7461c0-0b79-4bc9-85bf-fa6910fd7d5b', updatedAt: '2026-10-23T18:00:00.123456+00:00',
  sourceStatus: 'AVAILABLE', status: 'NEEDS_ATTENTION', requestId: null }
function canonical({ pdf = false, available = false } = {}) {
  return {
    request: { id: 596, folio: 'CS-1596', email_import_id: receipt.id, submission_key: receipt.id,
      workflow_stage: 'NEEDS_REVIEW', priority: 'MEDIUM', reported_on: null, due_on: null,
      reviewed_at: null, reviewed_by: null, valtrim_items_confirmed: false },
    property: { job_id: null, latitude: null, longitude: null }, contacts: [{ role: 'PRIMARY', name: 'Elena Rivera' }],
    items: [{ id: 1, item_number: 1, description: 'Adjust door', material_required: false, chargeable: false }], workflowHistory: [],
    source: pdf ? { source_type: 'PDF', file_status: available ? 'AVAILABLE' : 'PENDING', file_id: available ? 8 : null,
      file: available ? { id: 8, bucket_id: 'customer-service-sources', object_path: 'requests/596/source.pdf', original_filename: 'recovery.pdf' } : null } : null,
  }
}
function values() {
  return { contactName: 'Elena Rivera', contactEmail: '', contactPhone: '', reportedAt: '', priority: 'MEDIUM',
    requestedWorkItems: [{ description: 'Adjust door', materialRequired: false, chargeable: false }],
    sourceEmailFrom: 'original@example.com', sourceEmailSubject: 'Original', latitude: null, longitude: null }
}
function deferred() {
  let resolve
  const promise = new Promise((res) => { resolve = res })
  return { promise, resolve }
}
function pdfFile() {
  return new File(['%PDF-1'], 'recovery.pdf', { type: 'application/pdf' })
}

test('only unlinked errors with AVAILABLE original sources can be retried', () => {
  assert.equal(canRetryEmailImport(receipt), true)
  for (const patch of [{ sourceStatus: 'REJECTED' }, { sourceStatus: 'UPLOADING' }, { requestId: 596 },
    { status: 'PENDING' }, { status: 'PROCESSING' }, { updatedAt: null }]) {
    assert.equal(canRetryEmailImport({ ...receipt, ...patch }), false)
  }
})

test('retry uses the signed-in function boundary and sends only identity and the exact version', async () => {
  let call
  const repository = createCustomerServiceEmailImportRepository({ getClient: async () => ({ functions: { invoke: async (...args) => {
    call = args
    return { data: { importId: receipt.id, status: 'PROCESSED', requestId: 596 } }
  } } }) })
  const result = await repository.retry({ ...receipt, workerSecret: 'must-not-forward', payload: values() })
  assert.deepEqual(call, ['customer-service-email-retry', { body: { importId: receipt.id, expectedUpdatedAt: receipt.updatedAt } }])
  assert.equal(result.requestId, 596)
})

test('retry distinguishes unfinished work and rejects an unconfirmed success or different identity', async () => {
  for (const status of ['PENDING', 'PROCESSING', 'NEEDS_ATTENTION']) {
    const repo = createCustomerServiceEmailImportRepository({ getClient: async () => ({ functions: { invoke: async () => ({ data: {
      importId: receipt.id, requestId: null, status,
    } }) } }) })
    assert.equal((await repo.retry(receipt)).status, status)
  }
  for (const data of [null, { importId: receipt.id, status: 'PROCESSED', requestId: null },
    { importId: 'other', status: 'PROCESSED', requestId: 596 }]) {
    const repo = createCustomerServiceEmailImportRepository({ getClient: async () => ({ functions: { invoke: async () => ({ data }) } }) })
    await assert.rejects(repo.retry(receipt), /not confirmed/)
  }
})

test('endpoint errors become English product messages without exposing raw diagnostics or secrets', async () => {
  const error = { context: new Response(JSON.stringify({ error: 'WORKER_DISABLED: deshabilitado PRIVATE_TOKEN' }), { status: 409 }) }
  const repo = createCustomerServiceEmailImportRepository({ getClient: async () => ({ functions: { invoke: async () => ({ error }) } }) })
  await assert.rejects(repo.retry(receipt), (failure) => {
    assert.match(failure.message, /Automatic processing is disabled/)
    assert.doesNotMatch(failure.message, /PRIVATE_TOKEN|deshabilitado/)
    return true
  })
})

test('double click cannot issue concurrent retries and results refresh real counts before showing success', async () => {
  const pending = deferred()
  let calls = 0
  const store = createCustomerServiceEmailImportStore({ count: async () => 0, list: async () => [], retry: () => { calls += 1; return pending.promise } })
  const first = store.retryImport(receipt)
  assert.equal(await store.retryImport(receipt), null)
  assert.equal(calls, 1)
  assert.equal(store.getSnapshot().retrying, true)
  pending.resolve({ importId: receipt.id, status: 'PROCESSED', requestId: 596 })
  await first
  assert.equal(store.getSnapshot().count, 0)
  assert.equal(store.getSnapshot().retryResult.requestId, 596)
  assert.equal(store.getSnapshot().retrying, false)
})

test('a failed retry is never a fake success and refreshes the canonical list', async () => {
  const store = createCustomerServiceEmailImportStore({ count: async () => 1, list: async () => [receipt],
    retry: async () => { throw new Error('Unknown result; refresh') } })
  assert.equal(await store.retryImport(receipt), null)
  assert.equal(store.getSnapshot().retryResult, null)
  assert.equal(store.getSnapshot().retryError, 'Unknown result; refresh')
  assert.equal(store.getSnapshot().items[0], receipt)
})

test('retry completion after sign-out cannot publish data into the abandoned actor store', async () => {
  const pending = deferred()
  const store = createCustomerServiceEmailImportStore({ retry: () => pending.promise,
    count: () => assert.fail('Abandoned store must not reload') })
  const action = store.retryImport(receipt)
  store.cancelLoads()
  const snapshot = store.getSnapshot()
  pending.resolve({ importId: receipt.id, status: 'PROCESSED', requestId: 596 })
  await action
  assert.equal(store.getSnapshot(), snapshot)
})

test('recovery serializes only intake and separate PDF metadata, not paths, binaries or original email substitutions', () => {
  const file = { name: 'recovery.pdf' }
  const { payload, source } = toCustomerServiceEmailRecoveryPayload({ ...values(), sourceDocument: {
    sourceType: 'PDF', file, extraction: { text: 'Recovery OCR', model: 'test', structuredData: { recovery: true } },
  } })
  assert.equal('source' in payload, false)
  assert.equal(source.extractedText, 'Recovery OCR')
  assert.equal(source.sourceType, 'PDF')
  for (const key of ['file', 'senderEmail', 'subject', 'objectPath', 'fileId']) assert.equal(key in source, false)
  assert.equal(toCustomerServiceEmailRecoveryPayload(values()).source, null)
  assert.throws(() => toCustomerServiceEmailRecoveryPayload({ ...values(), sourceDocument: { sourceType: 'EMAIL_TEXT' } }), /valid PDF/)
})

test('minimum recovery accepts owner and one item without a Job/date/channel, while ordinary manual capture stays strict', () => {
  const form = requestToPrototypeFormValues({ contactName: 'Elena Rivera', requestedWorkItems: [{ description: 'Adjust door' }] })
  assert.equal(form.reportedAt, '')
  assert.equal(importedRequestDraftSchema.safeParse(form).success, true)
  assert.equal(newRequestDraftSchema.safeParse(form).success, false)
  assert.equal(importedRequestDraftSchema.safeParse({ ...form, contactName: '' }).success, false)
  assert.equal(importedRequestDraftSchema.safeParse({ ...form, requestedWorkItems: [] }).success, false)
})

test('manual recovery uses the original import UUID/version, keeps human approval pending and adds no optimistic row', async () => {
  const pending = deferred()
  let call
  const repo = createCustomerServiceIntakeRepository({ getClient: async () => ({ rpc: async (name, params) => {
    call = { name, params }; return pending.promise
  } }) })
  const store = createCustomerServiceRequestStore(repo)
  const action = store.recoverRequest(receipt, values())
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(store.getSnapshot().requests.length, 0)
  assert.equal(call.name, 'recover_customer_service_email_import')
  assert.equal(call.params.p_import_id, receipt.id)
  assert.equal(call.params.p_expected_updated_at, receipt.updatedAt)
  assert.equal(call.params.p_source, null)
  pending.resolve({ data: canonical() })
  const saved = await action
  assert.equal(saved.id, 596)
  assert.equal(saved.workflowStage, 'NEEDS_REVIEW')
  assert.equal(saved.emailImportId, receipt.id)
  assert.equal(saved.reportedAt, null)
  assert.equal(store.getSnapshot().requests.length, 1)
})

test('a concurrent winner is authoritative and a newly selected PDF never replaces a manual saved source', async () => {
  const repo = createCustomerServiceIntakeRepository({ getClient: async () => ({ rpc: async () => ({ data: canonical() }) }),
    uploadPdf: () => assert.fail('Existing source must not be replaced') })
  const saved = await repo.recover(receipt, { ...values(), contactName: 'Stale edit', sourceDocument: { sourceType: 'PDF', file: pdfFile() } })
  assert.equal(saved.contactName, 'Elena Rivera')
})

test('recovery PDF upload failure preserves the committed record and retries the SAME identity/file', async () => {
  const file = pdfFile()
  let fail = true, uploads = 0
  const calls = []
  const repo = createCustomerServiceIntakeRepository({ getClient: async () => ({ rpc: async (name, params) => {
    calls.push({ name, params })
    return { data: name === 'read_customer_service_request_intakes' ? [canonical({ pdf: true })]
      : canonical({ pdf: true, available: name === 'complete_customer_service_email_recovery' }) }
  } }), uploadPdf: async (requestId, original) => {
    assert.equal(requestId, 596); assert.equal(original, file); uploads += 1
    if (fail) throw new Error('Upload failed')
  } })
  const store = createCustomerServiceRequestStore(repo)
  const input = { ...values(), sourceDocument: { sourceType: 'PDF', file } }
  await assert.rejects(store.recoverRequest(receipt, input), (error) => {
    assert.equal(error.savedIdentity.id, 596)
    return true
  })
  assert.equal(store.getSnapshot().requests[0].id, 596)
  assert.deepEqual(store.getSnapshot().pendingPdfIds, [596])
  fail = false
  const saved = await store.recoverRequest(receipt, input)
  assert.equal(saved.sourceDocument.fileStatus, 'AVAILABLE')
  assert.equal(store.getSnapshot().requests.length, 1)
  assert.deepEqual(store.getSnapshot().pendingPdfIds, [])
  assert.equal(uploads, 2)
  assert.equal(calls.filter((entry) => entry.name === 'recover_customer_service_email_import').length, 2)
  assert.ok(calls.filter((entry) => entry.name === 'recover_customer_service_email_import').every((entry) => entry.params.p_import_id === receipt.id))
})

test('already retained recovery PDF can be finalized after reload without a local File or another upload', async () => {
  let completed = 0
  const repo = createCustomerServiceIntakeRepository({ getClient: async () => ({ rpc: async (name) => {
    if (name === 'complete_customer_service_email_recovery') completed += 1
    return { data: canonical({ pdf: true, available: true }) }
  } }), uploadPdf: () => assert.fail('No second upload') })
  const saved = await repo.recover(receipt, values())
  assert.equal(saved.sourceDocument.fileStatus, 'AVAILABLE')
  assert.equal(completed, 1)
})

test('validation/permission/conflict failures do not add a request or begin uploading', async () => {
  for (const code of ['22023', '42501', '40001', '55000']) {
    const repo = createCustomerServiceIntakeRepository({ getClient: async () => ({ rpc: async () => ({ error: { code, message: 'Denied or stale' } }) }),
      uploadPdf: () => assert.fail('No file before committed recovery') })
    const store = createCustomerServiceRequestStore(repo)
    await assert.rejects(store.recoverRequest(receipt, values()), /Denied or stale/)
    assert.deepEqual(store.getSnapshot().requests, [])
  }
})

test('source viewer upload retry also finalizes the corresponding import recovery', async () => {
  const methods = []
  const repo = createCustomerServiceIntakeRepository({ uploadPdf: async () => {}, getClient: async () => ({ rpc: async (name) => {
    methods.push(name)
    return { data: name === 'read_customer_service_request_intakes' ? [canonical({ pdf: true, available: true })] : canonical({ pdf: true, available: true }) }
  } }) })
  const saved = await repo.retryPdf(596, {})
  assert.equal(saved.id, 596)
  assert.deepEqual(methods, ['read_customer_service_request_intakes', 'complete_customer_service_email_recovery'])
})

test('PDF identity is computed from real bytes before recovery and invalid binaries cannot create a request', async () => {
  let source
  const repo = createCustomerServiceIntakeRepository({ getClient: async () => ({ rpc: async (_name, params) => {
    source = params.p_source
    return { data: canonical() }
  } }) })
  await repo.recover(receipt, { ...values(), sourceDocument: { sourceType: 'PDF', file: pdfFile() } })
  assert.match(source.sha256, /^[a-f0-9]{64}$/)
  assert.equal(source.sizeBytes, 6)
  assert.equal(source.originalFilename, 'recovery.pdf')
  const noWrites = createCustomerServiceIntakeRepository({ getClient: () => assert.fail('Invalid file must not create a request') })
  await assert.rejects(noWrites.recover(receipt, { ...values(), sourceDocument: {
    sourceType: 'PDF', file: new File(['not-pdf'], 'fake.pdf', { type: 'application/pdf' }),
  } }), /valid PDF signature/)
})

test('a competing recovery PDF cannot upload over the winning source even before its first upload', async () => {
  const saved = canonical({ pdf: true })
  Object.assign(saved.source, { recovery_pdf_sha256: 'a'.repeat(64), recovery_pdf_size_bytes: 6, recovery_pdf_filename: 'winner.pdf' })
  const repo = createCustomerServiceIntakeRepository({ getClient: async () => ({ rpc: async (name) => ({
    data: name === 'read_customer_service_request_intakes' ? [saved] : saved,
  }) }), uploadPdf: () => assert.fail('Competing file must not upload') })
  await assert.rejects(repo.recover(receipt, { ...values(), sourceDocument: { sourceType: 'PDF', file: pdfFile() } }), (error) => {
    assert.equal(error.savedIdentity.id, 596)
    assert.match(error.message, /winner.pdf/)
    return true
  })
})
