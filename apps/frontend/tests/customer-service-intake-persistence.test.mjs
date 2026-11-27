import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRequestReviewSummary } from '../src/features/customer-service/utils/requestInbox.js'
import { toCustomerServiceIntakeRecord } from '../src/features/customer-service/services/customerServiceIntakeRecord.js'
import { createCustomerServiceIntakeRepository } from '../src/features/customer-service/services/customerServiceIntakeRepository.js'
import { createCustomerServiceRequestStore } from '../src/features/customer-service/context/customerServiceRequestStore.js'
import { requestToPrototypeFormValues } from '../src/features/customer-service/utils/newRequestPrototype.js'
import { toCustomerServiceIntakeEditPayload } from '../src/features/customer-service/utils/customerServiceIntake.js'

function fixture() {
  return {
    request: {
      id: 42, folio: 'CS-1042', submission_key: 'test-key', priority: 'MEDIUM',
      reported_on: '2026-10-20', reported_on_source: 'EMAIL_SENT', due_on: '2026-10-27',
      workflow_stage: 'NEEDS_REVIEW', service_kind: 'PAID_EXTRA', work_category: 'MULTIPLE_WORK_TYPES',
      service_task: 'GENERAL_FIX', estimated_duration_minutes: 30, crew_size: 1,
      created_at: '2026-10-20T18:00:00Z', updated_at: '2026-10-20T18:00:00Z',
      reviewed_at: null, valtrim_items_confirmed: false,
    },
    property: { job_id: 7, latitude: '33.977882057707450', longitude: '-117.345207659413190', address: null, lot_number: '88' },
    builderName: 'Real Builder', community: 'Real Community', jobCode: 'JOB-7', coordinatorName: 'Coordinator',
    contacts: [
      { id: 1, role: 'PRIMARY', name: 'Primary Contact', email: 'primary@example.com', phone: null },
      { id: 2, role: 'ADDITIONAL', name: 'Additional Contact', email: null, phone: '+19515550101' },
    ],
    items: [
      { id: 3, item_number: 1, description: 'Adjust the door', material_required: false, chargeable: true },
      { id: 4, item_number: 2, description: 'Replace hinge', material_required: true, chargeable: false },
    ],
    source: {
      source_type: 'PDF', file_status: 'FAILED', file_error: 'Upload interrupted',
      sender_email: 'builder@example.com', subject: 'Original subject', email_text: 'Original email',
      extracted_text: 'Original OCR', extraction_payload: { schemaVersion: '1.0' },
      extraction_model: 'test-model', review_notes: ['Check hinge'], file: null,
    },
    workflowHistory: [{ id: 5, previous_stage: null, new_stage: 'NEEDS_REVIEW', changed_at: '2026-10-20T18:00:00Z' }],
  }
}

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('intake records use the current classification when legacy request columns are absent', () => {
  const record = fixture()
  const request = toCustomerServiceIntakeRecord(record)
  assert.equal(request.workType, 'Multiple work types')
  assert.equal(request.workflowStage, 'NEEDS_REVIEW')
  assert.equal(request.contactName, 'Primary Contact')
  assert.equal(request.requestedWorkItems.length, 2)
  record.request.work_category = null
  record.request.work_type = 'HW_WS'
  assert.equal(toCustomerServiceIntakeRecord(record).workType, '')
})

test('approval awaits the server, sends only confirmation and the reviewed version, and restores canonical review on reload', async () => {
  const result = deferred()
  const record = fixture()
  record.request.updated_at = '2026-10-20T18:00:00.123456+00:00'
  let call
  const repository = createCustomerServiceIntakeRepository({ getClient: async () => ({ rpc: async (name, params) => {
    if (name === 'read_customer_service_request_intakes') return { data: [record] }
    call = { name, params }
    return result.promise
  } }) })
  const store = createCustomerServiceRequestStore(repository)
  await store.reloadRequests()
  const original = store.getSnapshot().requests[0]
  const pending = store.markRequestReady(original, { valtrimItemsConfirmed: true, reviewedBy: 'Untrusted reviewer', reviewedAt: 'yesterday' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(store.getSnapshot().requests[0], original)
  assert.equal(original.workflowStage, 'NEEDS_REVIEW')
  assert.deepEqual(call, { name: 'mark_customer_service_request_ready', params: {
    p_request_id: 42, p_expected_updated_at: '2026-10-20T18:00:00.123456+00:00', p_valtrim_items_confirmed: true,
  } })
  const approved = structuredClone(record)
  approved.request.workflow_stage = 'READY_TO_PROPOSE'
  approved.request.reviewed_at = '2026-10-20T19:00:00.654321+00:00'
  approved.request.updated_at = '2026-10-20T19:00:00.654322+00:00'
  approved.request.valtrim_items_confirmed = true
  approved.reviewerName = 'Server Reviewer'
  result.resolve({ data: approved })
  const updated = await pending
  assert.equal(updated.review.completedBy, 'Server Reviewer')
  assert.equal(updated.review.completedAt, approved.request.reviewed_at)
  assert.equal(updated.review.valtrimItemsConfirmed, true)
  assert.equal(updated.workflowStage, 'READY_TO_PROPOSE')
  assert.equal(updated.requestNumber, original.requestNumber)
  assert.deepEqual(updated.sourceDocument, original.sourceDocument)
  assert.deepEqual(updated.sourceEmail, original.sourceEmail)
  assert.equal(store.getSnapshot().requests.length, 1)
  assert.equal(store.getSnapshot().requests[0], updated)
  const fresh = createCustomerServiceRequestStore({ list: async () => [toCustomerServiceIntakeRecord(approved)] })
  await fresh.reloadRequests()
  assert.deepEqual(fresh.getSnapshot().requests[0].review, updated.review)
  assert.equal(fresh.getSnapshot().requests[0].workflowStage, 'READY_TO_PROPOSE')
})

test('approval validation, stale-version, permission and state errors leave the request unchanged', async () => {
  for (const code of ['22023', '40001', '42501', '55000']) {
    const record = fixture()
    const repository = createCustomerServiceIntakeRepository({ getClient: async () => ({ rpc: async (name) => (
      name === 'read_customer_service_request_intakes' ? { data: [record] } : { error: { code, message: 'Approval failed' } }
    ) }) })
    const store = createCustomerServiceRequestStore(repository)
    await store.reloadRequests()
    const original = store.getSnapshot().requests[0]
    await assert.rejects(store.markRequestReady(original, { valtrimItemsConfirmed: true }), (error) => {
      assert.equal(error.message, 'Approval failed')
      assert.equal(error.cause.code, code)
      return true
    })
    assert.equal(store.getSnapshot().requests[0], original)
    assert.equal(original.review, null)
  }
})

test('only literal true is explicit Valtrim confirmation in the approval RPC', async () => {
  const calls = []
  const repository = createCustomerServiceIntakeRepository({ getClient: async () => ({ rpc: async (name, params) => {
    calls.push(params)
    return { data: fixture() }
  } }) })
  for (const valtrimItemsConfirmed of [false, null, undefined, 'true', 1]) {
    await repository.markReady(toCustomerServiceIntakeRecord(fixture()), { valtrimItemsConfirmed })
  }
  assert.ok(calls.every((params) => params.p_valtrim_items_confirmed === false))
})

test('review warnings do not block a complete request, but Shutter replacement requires two people', () => {
  const request = toCustomerServiceIntakeRecord(fixture())
  const review = buildRequestReviewSummary(request)
  assert.equal(review.isComplete, true)
  assert.deepEqual(review.warnings, ['Check hinge'])
  request.serviceTask = 'SHUTTER_REPLACEMENT'
  assert.equal(buildRequestReviewSummary(request).isComplete, false)
  request.crewSize = 2
  assert.equal(buildRequestReviewSummary(request).isComplete, true)
})

test('a persisted legacy request cannot pass review using only a community name without a linked Job', () => {
  const record = fixture()
  record.property.job_id = null
  const review = buildRequestReviewSummary(toCustomerServiceIntakeRecord(record))
  assert.equal(review.isComplete, false)
  assert.equal(review.checks.find((check) => check.id === 'property').complete, false)
})

test('canonical read restores form, contacts, ordered items, classification and original extraction', () => {
  const request = toCustomerServiceIntakeRecord(fixture())
  const form = requestToPrototypeFormValues(request)
  assert.equal(request.id, 42)
  assert.equal(request.requestNumber, 'CS-1042')
  assert.equal(request.prototypeOnly, false)
  assert.equal(form.jobId, '7')
  assert.equal(form.builderName, 'Real Builder')
  assert.equal(form.serviceKind, 'Paid Extra')
  assert.equal(form.workType, 'Multiple work types')
  assert.equal(form.additionalContactName, 'Additional Contact')
  assert.equal(form.requestedWorkItems[1].description, 'Replace hinge')
  assert.equal(form.requestedWorkItems[1].materialRequired, true)
  assert.equal(request.latitude, 33.97788205770745)
  assert.equal(request.sourceDocument.fileStatus, 'FAILED')
  assert.equal(request.sourceDocument.extraction.text, 'Original OCR')
  assert.deepEqual(request.sourceDocument.extraction.structuredData, { schemaVersion: '1.0' })
  assert.equal(request.sourceEmail.body, 'Original email')
  assert.equal(request.sourceEmail.attachmentCount, 1)
  assert.deepEqual(request.extractionReviewNotes, ['Check hinge'])
})

test('private PDF metadata and review identity survive a fresh read without a local File', () => {
  const record = fixture()
  record.source.file_status = 'AVAILABLE'
  record.source.file = { id: 9, original_filename: 'original.pdf', bucket_id: 'customer-service-sources', object_path: 'requests/42/source.pdf' }
  record.request.workflow_stage = 'READY_TO_PROPOSE'
  record.request.reviewed_at = '2026-10-20T19:00:00Z'
  record.request.valtrim_items_confirmed = true
  record.reviewerName = 'Reviewer'
  const request = toCustomerServiceIntakeRecord(record)
  assert.equal(request.sourceDocument.storage.requestId, 42)
  assert.equal(request.sourceDocument.storage.objectPath, 'requests/42/source.pdf')
  assert.deepEqual(request.sourceEmail.attachmentNames, ['original.pdf'])
  assert.equal(request.review.completedBy, 'Reviewer')
  assert.equal(request.review.valtrimItemsConfirmed, true)
})

test('manual and legacy records do not invent a source, Job, classification or work items', () => {
  const record = fixture()
  record.source = null
  record.property.job_id = null
  record.items = []
  record.contacts = []
  record.request.service_kind = null
  record.request.work_category = null
  const request = toCustomerServiceIntakeRecord(record)
  assert.equal(request.sourceDocument, null)
  assert.equal(request.jobId, '')
  assert.equal(request.workType, '')
  assert.deepEqual(request.requestedWorkItems, [])
  assert.deepEqual(request.activity.map((event) => event.label), ['Request created'])
})

test('a fresh read restores email details without inventing an attachment or extraction', async () => {
  const record = fixture()
  record.source = {
    source_type: 'EMAIL_METADATA', sender_email: 'builder@example.com',
    subject: 'Service request', email_text: null, extracted_text: null,
    extraction_payload: null, file_status: 'NOT_APPLICABLE', file: null,
    review_notes: [],
  }
  const repository = createCustomerServiceIntakeRepository({ getClient: async () => ({
    rpc: async () => ({ data: [record] }),
  }) })
  const store = createCustomerServiceRequestStore(repository)
  await store.reloadRequests()
  const [request] = store.getSnapshot().requests
  assert.equal(request.sourceEmail.from, 'builder@example.com')
  assert.equal(request.sourceEmail.subject, 'Service request')
  assert.equal(request.sourceEmail.body, '')
  assert.equal(request.sourceEmail.attachmentCount, 0)
  assert.deepEqual(request.sourceEmail.attachmentNames, [])
  assert.equal(request.sourceDocument, null)
  const form = requestToPrototypeFormValues(request)
  assert.equal(form.sourceEmailFrom, 'builder@example.com')
  assert.equal(form.sourceEmailSubject, 'Service request')
})

test('creating email details without a document never uploads a PDF and returns canonical metadata', async () => {
  const record = fixture()
  record.source = { source_type: 'EMAIL_METADATA', sender_email: 'builder@example.com', subject: 'Work order', file: null }
  let payload
  const repository = createCustomerServiceIntakeRepository({
    getClient: async () => ({ rpc: async (name, params) => {
      if (name === 'read_customer_service_request_intakes') return { data: [record] }
      payload = params.p_payload
      return { data: { requestId: record.request.id, folio: record.request.folio } }
    } }),
    uploadPdf: () => assert.fail('Metadata-only requests must not upload a file'),
  })
  const saved = await repository.create({ sourceEmailFrom: 'builder@example.com', sourceEmailSubject: 'Work order' }, 'test-key')
  assert.equal(payload.source.sourceType, 'EMAIL_METADATA')
  assert.equal(saved.sourceEmail.from, 'builder@example.com')
  assert.equal(saved.sourceEmail.subject, 'Work order')
  assert.equal(saved.sourceDocument, null)
})

test('loading, failure, retry and a real empty result never fall back to fixtures', async () => {
  let attempts = 0
  const store = createCustomerServiceRequestStore({ list: async () => {
    if (++attempts === 1) throw new Error('Read failed')
    return []
  } })
  assert.equal(store.getSnapshot().loading, true)
  assert.deepEqual(store.getSnapshot().requests, [])
  await store.reloadRequests()
  assert.equal(store.getSnapshot().loading, false)
  assert.equal(store.getSnapshot().error, 'Read failed')
  await store.reloadRequests()
  assert.equal(store.getSnapshot().error, null)
  assert.deepEqual(store.getSnapshot().requests, [])
})

test('a stale response cannot replace a later load or a completed create', async () => {
  const old = deferred()
  let loads = 0
  const created = toCustomerServiceIntakeRecord(fixture())
  const store = createCustomerServiceRequestStore({
    list: () => ++loads === 1 ? old.promise : Promise.resolve([created]),
    create: async () => created,
  })
  const firstLoad = store.reloadRequests()
  await store.createRequest({}, 'test-key')
  old.resolve([])
  await firstLoad
  assert.equal(store.getSnapshot().loading, false)
  assert.deepEqual(store.getSnapshot().requests, [created])

  const stale = deferred()
  const other = createCustomerServiceRequestStore({ list: () => stale.promise })
  const pending = other.reloadRequests()
  other.cancelLoads()
  stale.resolve([created])
  await pending
  assert.deepEqual(other.getSnapshot().requests, [])
})

test('create remains pending until canonical read finishes and never inserts optimistically', async () => {
  const read = deferred()
  const calls = []
  const repository = createCustomerServiceIntakeRepository({ getClient: async () => ({ rpc: async (name, params) => {
    calls.push({ name, params })
    return name === 'create_customer_service_request_intake'
      ? { data: { requestId: 42, folio: 'CS-1042' } }
      : read.promise
  } }) })
  const store = createCustomerServiceRequestStore(repository)
  const promise = store.createRequest({ jobId: '7' }, 'test-key')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(store.getSnapshot().requests, [])
  read.resolve({ data: [fixture()] })
  const request = await promise
  assert.equal(request.contactName, 'Primary Contact')
  assert.equal(calls[0].params.p_submission_key, 'test-key')
  assert.equal(calls[1].params.p_request_id, 42)
})

test('failed creation propagates the server message and does not add a request', async () => {
  const repository = createCustomerServiceIntakeRepository({ getClient: async () => ({
    rpc: async () => ({ error: { message: 'The selected Job is not active' } }),
  }) })
  const store = createCustomerServiceRequestStore(repository)
  await assert.rejects(store.createRequest({}, 'key'), /Job is not active/)
  assert.deepEqual(store.getSnapshot().requests, [])
})

test('PDF failure keeps the committed record; retry uses the same key and never duplicates or rebuilds from edited form data', async () => {
  const record = fixture()
  let uploadAttempts = 0
  const keys = []
  const file = new File(['%PDF-1.7'], 'original.pdf', { type: 'application/pdf' })
  const repository = createCustomerServiceIntakeRepository({
    getClient: async () => ({ rpc: async (name, params) => {
      if (name === 'create_customer_service_request_intake') {
        keys.push(params.p_submission_key)
        return { data: { requestId: 42, folio: 'CS-1042', idempotentReplay: keys.length > 1 } }
      }
      return { data: [record] }
    } }),
    uploadPdf: async (id, original) => {
      assert.equal(id, 42)
      assert.equal(original, file)
      if (++uploadAttempts === 1) throw new Error('Upload interrupted')
      record.source.file_status = 'AVAILABLE'
    },
  })
  const store = createCustomerServiceRequestStore(repository)
  const values = { jobId: '7', sourceDocument: { sourceType: 'PDF', file } }
  await assert.rejects(store.createRequest(values, 'same-key'), (error) => {
    assert.equal(error.savedIdentity.requestNumber, 'CS-1042')
    return /was saved/.test(error.message)
  })
  assert.equal(store.getSnapshot().requests.length, 1)
  assert.deepEqual(store.getSnapshot().pendingPdfIds, [42])
  const request = await store.createRequest({ ...values, contactName: 'Unsaved change' }, 'same-key')
  assert.equal(request.contactName, 'Primary Contact')
  assert.deepEqual(keys, ['same-key', 'same-key'])
  assert.equal(store.getSnapshot().requests.length, 1)
  assert.deepEqual(store.getSnapshot().pendingPdfIds, [])
})

test('the retained PDF can be retried from the source viewer after closing the form', async () => {
  const file = new File(['pdf'], 'original.pdf')
  const request = toCustomerServiceIntakeRecord(fixture())
  const repository = {
    create: async () => { throw Object.assign(new Error('PDF failed'), { savedRequest: request, savedIdentity: request }) },
    retryPdf: async (id, original) => {
      assert.equal(id, 42)
      assert.equal(original, file)
      return request
    },
  }
  const store = createCustomerServiceRequestStore(repository)
  await assert.rejects(store.createRequest({ sourceDocument: { sourceType: 'PDF', file } }, 'key'))
  await store.retrySourcePdf(42)
  assert.equal(store.getSnapshot().requests.length, 1)
  assert.deepEqual(store.getSnapshot().pendingPdfIds, [])
})

test('a new store reloads the saved identity and content independently of the previous session', async () => {
  const request = toCustomerServiceIntakeRecord(fixture())
  const fresh = createCustomerServiceRequestStore({ list: async () => [request] })
  await fresh.reloadRequests()
  assert.equal(fresh.getSnapshot().requests[0].requestNumber, 'CS-1042')
  assert.equal(fresh.getSnapshot().requests[0].requestedWorkItems.length, 2)
  assert.deepEqual(fresh.getSnapshot().pendingPdfIds, [])
})

test('editing waits for the atomic response, preserves the exact version and replaces the record with canonical data', async () => {
  const result = deferred()
  const record = fixture()
  record.request.updated_at = '2026-10-20T18:00:00.123456+00:00'
  const original = toCustomerServiceIntakeRecord(record)
  let savedCall
  const repository = createCustomerServiceIntakeRepository({ getClient: async () => ({ rpc: async (name, params) => {
    if (name === 'read_customer_service_request_intakes') return { data: [record] }
    savedCall = { name, params }
    return result.promise
  } }) })
  const store = createCustomerServiceRequestStore(repository)
  await store.reloadRequests()
  const values = {
    jobId: '7', reportedAt: original.reportedAt, priority: 'HIGH',
    contactName: 'Unsaved client name', additionalContacts: [], requestedWorkItems: [],
    sourceDocument: { sourceType: 'PDF', file: new File(['new'], 'replacement.pdf') },
    sourceEmailFrom: 'changed@example.com', sourceEmailBody: 'Changed source',
  }
  const pending = store.updateRequest(original, values)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(store.getSnapshot().requests[0].priority, 'MEDIUM')
  assert.equal(savedCall.name, 'update_customer_service_request_intake')
  assert.equal(savedCall.params.p_request_id, 42)
  assert.equal(savedCall.params.p_expected_updated_at, '2026-10-20T18:00:00.123456+00:00')
  assert.equal('source' in savedCall.params.p_payload, false)
  const updatedRecord = structuredClone(record)
  updatedRecord.request.priority = 'HIGH'
  updatedRecord.request.updated_at = '2026-10-20T18:01:00.654321+00:00'
  result.resolve({ data: updatedRecord })
  const updated = await pending
  assert.equal(updated.contactName, 'Primary Contact')
  assert.equal(updated.requestNumber, original.requestNumber)
  assert.equal(updated.submissionKey, original.submissionKey)
  assert.deepEqual(updated.sourceDocument, original.sourceDocument)
  assert.deepEqual(updated.sourceEmail, original.sourceEmail)
  assert.equal(store.getSnapshot().requests.length, 1)
  assert.equal(store.getSnapshot().requests[0].updatedAt, '2026-10-20T18:01:00.654321+00:00')
})

test('edit validation and stale-version errors propagate without changing the saved record', async () => {
  for (const error of [
    { code: '22023', message: 'Contact phone is invalid' },
    { code: '40001', message: 'This request changed after you opened it' },
    { code: '42501', message: 'You do not have permission' },
  ]) {
    const record = fixture()
    const repository = createCustomerServiceIntakeRepository({ getClient: async () => ({ rpc: async (name) => (
      name === 'read_customer_service_request_intakes' ? { data: [record] } : { error }
    ) }) })
    const store = createCustomerServiceRequestStore(repository)
    await store.reloadRequests()
    const original = store.getSnapshot().requests[0]
    await assert.rejects(store.updateRequest(original, {}), (failure) => {
      assert.equal(failure.message, error.message)
      assert.equal(failure.cause.code, error.code)
      return true
    })
    assert.equal(store.getSnapshot().requests[0], original)
  }
})

test('administrative payloads never include operational fields, even for legacy requests', () => {
  const values = { priority: 'HIGH', internalNotes: ' Changed notes ',
    jobId: 'invalid legacy', contactName: '', sourceDocument: { sourceType: 'PDF' } }
  for (const workflowStage of ['AWAITING_CUSTOMER', 'CONFIRMED', 'WORKING']) {
    assert.deepEqual(toCustomerServiceIntakeEditPayload({ workflowStage }, values), {
      request: { priority: 'HIGH', internalNotes: 'Changed notes' },
    })
  }
  assert.deepEqual(toCustomerServiceIntakeEditPayload({ workflowStage: 'COMPLETED' }, values), {
    request: { internalNotes: 'Changed notes' },
  })
})

test('an invalidated approval from the server clears the local review and survives a fresh read', async () => {
  const before = fixture()
  before.request.workflow_stage = 'READY_TO_PROPOSE'
  before.request.reviewed_at = '2026-10-20T19:00:00Z'
  before.request.valtrim_items_confirmed = true
  const after = fixture()
  after.request.crew_size = 2
  const repository = createCustomerServiceIntakeRepository({ getClient: async () => ({ rpc: async (name) => (
    name === 'read_customer_service_request_intakes' ? { data: [before] } : { data: after }
  ) }) })
  const store = createCustomerServiceRequestStore(repository)
  await store.reloadRequests()
  assert.equal(store.getSnapshot().requests[0].workflowStage, 'READY_TO_PROPOSE')
  const updated = await store.updateRequest(store.getSnapshot().requests[0], { crewSize: 2 })
  assert.equal(updated.workflowStage, 'NEEDS_REVIEW')
  assert.equal(updated.review, null)
  assert.equal(store.getSnapshot().requests[0].crewSize, 2)
  const fresh = createCustomerServiceRequestStore({ list: async () => [toCustomerServiceIntakeRecord(after)] })
  await fresh.reloadRequests()
  assert.equal(fresh.getSnapshot().requests[0].review, null)
})
