import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canSavePartialImportedRequest,
  importedRequestDraftSchema,
  importedRequestStandardEditSchema,
  newRequestDraftSchema,
  newRequestPrototypeSchema,
  requestToPrototypeFormValues,
} from '../src/features/customer-service/utils/newRequestPrototype.js'
import { toCustomerServiceIntakeRecord } from '../src/features/customer-service/services/customerServiceIntakeRecord.js'
import { buildRequestReviewSummary, filterAndSortRequestInbox, isRequestOverdue } from '../src/features/customer-service/utils/requestInbox.js'
import { toCustomerServiceIntakeEditPayload } from '../src/features/customer-service/utils/customerServiceIntake.js'
import { createCustomerServiceIntakeRepository } from '../src/features/customer-service/services/customerServiceIntakeRepository.js'
import { createCustomerServiceRequestStore } from '../src/features/customer-service/context/customerServiceRequestStore.js'

const importId = '00000000-0000-4000-8000-000000000002'

function importedRecord() {
  return {
    request: {
      id: 501, folio: 'CS-1501', submission_key: importId, email_import_id: importId,
      reported_on: null, reported_on_source: 'MANUAL', due_on: null, priority: 'MEDIUM',
      homeowner_name: 'Elena Rivera', homeowner_email: null, homeowner_phone: null,
      workflow_stage: 'NEEDS_REVIEW', service_kind: null, work_category: null,
      service_task: null, estimated_duration_minutes: null, crew_size: null,
      created_at: '2026-10-22T18:00:00Z', updated_at: '2026-10-22T18:00:00.123456+00:00',
      reviewed_at: null, valtrim_items_confirmed: false,
    },
    property: { job_id: null, latitude: null, longitude: null, address: null, lot_number: null },
    contacts: [{ id: 12, role: 'PRIMARY', name: 'Elena Rivera', email: null, phone: null }],
    items: [{ id: 13, item_number: 1, description: 'Adjust the entry door', material_required: false, chargeable: false }],
    source: null,
    emailImport: {
      id: importId, status: 'PROCESSED', attachment_refs: [],
      source_payload: {
        from: { emailAddress: { address: 'builder@example.com' } },
        subject: 'Original work order', bodyText: 'Original message with homeowner details',
        attachments: [{ id: 'pdf-1', name: 'work-order.pdf' }, { id: 'image-1', name: 'photo.jpg' }],
      },
      extraction_payload: { contacts: [{ role: 'PRIMARY', name: 'Elena Rivera' }], items: [{ description: 'Adjust the entry door' }] },
    },
    workflowHistory: [{ id: 14, previous_stage: null, new_stage: 'NEEDS_REVIEW', changed_at: '2026-10-22T18:00:00Z' }],
  }
}

test('an imported request with only homeowner and described work can be opened and saved without invented dates or location', () => {
  const request = toCustomerServiceIntakeRecord(importedRecord())
  const form = requestToPrototypeFormValues(request)
  assert.equal(request.emailImportId, importId)
  assert.equal(request.reportedAt, null)
  assert.equal(request.dueOn, null)
  assert.equal(request.coordinatorName, '')
  assert.equal(form.reportedAt, '')
  assert.equal(form.builderName, '')
  assert.equal(form.jobId, '')
  assert.equal(form.coordinates, '')
  const result = importedRequestDraftSchema.safeParse(form)
  assert.equal(result.success, true)
  const payload = toCustomerServiceIntakeEditPayload(request, result.data)
  assert.equal(payload.property.jobId, null)
  assert.equal(payload.property.latitude, null)
  assert.equal(payload.request.reportedOn, '')
  assert.equal(payload.contacts[0].email, null)
  assert.equal(payload.contacts[0].phone, null)
  assert.equal(payload.items.length, 1)
  assert.equal(payload.source, undefined)
  assert.equal(payload.request.workflowStage, undefined)
})

test('the imported minimum does not relax manual capture or approval', () => {
  const request = toCustomerServiceIntakeRecord(importedRecord())
  const form = requestToPrototypeFormValues(request)
  assert.equal(newRequestDraftSchema.safeParse(form).success, false)
  assert.equal(newRequestPrototypeSchema.safeParse(form).success, false)
  const review = buildRequestReviewSummary(request)
  assert.equal(review.isComplete, false)
  assert.equal(review.checks.find((check) => check.id === 'customer').complete, false)
  assert.equal(review.checks.find((check) => check.id === 'property').complete, false)
  assert.equal(review.checks.find((check) => check.id === 'planning').complete, false)
})

test('the inbox lists and sorts undated imports without inventing dates, hiding them or marking them overdue', () => {
  const undated = toCustomerServiceIntakeRecord(importedRecord())
  const dated = { ...undated, id: 502, requestNumber: 'CS-1502', reportedAt: '2026-10-20', dueOn: '2026-10-27' }
  for (const sortBy of ['ACTION_REQUIRED','DUE_DATE','NEWEST']) {
    const sorted = filterAndSortRequestInbox([undated, dated], { sortBy })
    assert.equal(sorted.length, 2)
    assert.equal(sorted[0].id, dated.id)
    assert.equal(sorted[1].id, undated.id)
  }
  assert.equal(isRequestOverdue(undated, '2099-01-01'), false)
  assert.equal(undated.reportedAt, null)
  assert.equal(undated.dueOn, null)
})

test('partial imported editing is selected only for an identified import in NEEDS_REVIEW', () => {
  const request = toCustomerServiceIntakeRecord(importedRecord())
  assert.equal(canSavePartialImportedRequest(request), true)
  assert.equal(canSavePartialImportedRequest({ ...request, emailImportId: null }), false)
  for (const workflowStage of ['READY_TO_PROPOSE','AWAITING_CUSTOMER','CONFIRMED','WORKING','COMPLETED']) {
    assert.equal(canSavePartialImportedRequest({ ...request, workflowStage }), false)
  }
  assert.equal(canSavePartialImportedRequest(null), false)
})

test('imported editing rejects a missing homeowner, missing described work and invalid supplied values', () => {
  const form = requestToPrototypeFormValues(toCustomerServiceIntakeRecord(importedRecord()))
  for (const invalid of [
    { contactName: '' },
    { requestedWorkItems: [] },
    { requestedWorkItems: [{ ...form.requestedWorkItems[0], description: ' ' }] },
    { contactEmail: 'invalid' },
    { contactPhone: '123' },
    { reportedAt: '2026-02-30' },
    { reportedAt: '2099-01-01' },
    { coordinates: '95, -117' },
    { coordinates: '34,' },
    { serviceKind: 'Unknown' },
    { estimatedDurationMinutes: 5 },
    { crewSize: 20 },
    { address: 'x'.repeat(241) },
  ]) {
    assert.equal(importedRequestDraftSchema.safeParse({ ...form, ...invalid }).success, false, JSON.stringify(invalid))
  }
})

test('partial additional contact data survives imported editing but blocks approval until complete', () => {
  const record = importedRecord()
  record.contacts.push({ id: 15, role: 'ADDITIONAL', name: null, email: 'additional@example.com', phone: null })
  const request = toCustomerServiceIntakeRecord(record)
  const result = importedRequestDraftSchema.parse(requestToPrototypeFormValues(request))
  assert.equal(result.additionalContacts[0].email, 'additional@example.com')
  assert.equal(result.additionalContacts[0].name, '')
  assert.equal(buildRequestReviewSummary(request).isComplete, false)
})

test('canonical imports retain the original email, file metadata and extraction without pretending to upload files', () => {
  const record = importedRecord()
  const request = toCustomerServiceIntakeRecord(record)
  assert.equal(request.sourceEmail.from, 'builder@example.com')
  assert.equal(request.sourceEmail.body, record.emailImport.source_payload.bodyText)
  assert.equal(request.sourceEmail.attachmentCount, 2)
  assert.deepEqual(request.sourceEmail.attachmentNames, ['work-order.pdf','photo.jpg'])
  assert.equal(request.sourceDocument.storage, null)
  assert.equal(request.sourceDocument.fileStatus, 'NOT_APPLICABLE')
  assert.deepEqual(request.sourceDocument.extraction.structuredData, record.emailImport.extraction_payload)
  const form = importedRequestDraftSchema.parse(requestToPrototypeFormValues(request))
  form.requestedWorkItems[0].description = 'Human correction'
  const edit = toCustomerServiceIntakeEditPayload(request, form)
  assert.equal(edit.source, undefined)
  assert.equal(edit.emailImport, undefined)
  assert.equal(edit.items[0].description, 'Human correction')
  assert.equal(request.sourceDocument.extraction.structuredData.items[0].description, 'Adjust the entry door')
})

test('Graph HTML is kept as a plain string reference, not a URL or executable page', () => {
  const record = importedRecord()
  delete record.emailImport.source_payload.bodyText
  record.emailImport.source_payload.body = { contentType: 'html', content: '<img src="https://example.com/tracker"><script>alert(1)</script>' }
  const request = toCustomerServiceIntakeRecord(record)
  assert.equal(request.sourceEmail.bodyFormat, 'HTML')
  assert.equal(request.sourceEmail.body, record.emailImport.source_payload.body.content)
  assert.equal(request.sourceDocument.storage, null)
})

test('an imported complete request remains unapproved and immutable metadata does not become a business requirement', () => {
  const record = importedRecord()
  Object.assign(record.request, { reported_on: '2026-10-20', due_on: '2026-10-27', service_kind: 'ADJUSTMENT',
    work_category: 'DOORS', service_task: 'GENERAL_FIX', estimated_duration_minutes: 30, crew_size: 1 })
  Object.assign(record.property, { job_id: 7, latitude: '34.0', longitude: '-117.0' })
  record.builderName = 'Builder'
  record.community = 'Community'
  record.contacts[0].email = 'owner@example.com'
  record.emailImport.source_payload.subject = 'x'.repeat(600)
  record.emailImport.source_payload.from = 'Unparsed original sender'
  const request = toCustomerServiceIntakeRecord(record)
  assert.equal(buildRequestReviewSummary(request).isComplete, true)
  assert.equal(request.workflowStage, 'NEEDS_REVIEW')
  assert.equal(request.review, null)
  assert.equal(importedRequestDraftSchema.safeParse(requestToPrototypeFormValues(request)).success, true)
  assert.equal(importedRequestStandardEditSchema.safeParse(requestToPrototypeFormValues(request)).success, true)
  const withoutDate = { ...requestToPrototypeFormValues(request), reportedAt: '' }
  assert.equal(importedRequestStandardEditSchema.safeParse(withoutDate).success, false)
})

test('a partial human update uses the existing versioned RPC and a fresh reload keeps the same request and original source', async () => {
  const record = importedRecord()
  let lastCall
  const repository = createCustomerServiceIntakeRepository({ getClient: async () => ({ rpc: async (name, params) => {
    if (name === 'read_customer_service_request_intakes') return { data: [record] }
    lastCall = { name, params }
    assert.equal(params.p_payload.property.jobId, null)
    assert.equal(params.p_payload.source, undefined)
    record.request.internal_notes = params.p_payload.request.internalNotes
    record.request.updated_at = '2026-10-22T18:00:01.123456+00:00'
    return { data: record }
  } }) })
  const store = createCustomerServiceRequestStore(repository)
  await store.reloadRequests()
  const original = store.getSnapshot().requests[0]
  const values = importedRequestDraftSchema.parse(requestToPrototypeFormValues(original))
  values.internalNotes = 'Contact details still pending'
  await store.updateRequest(original, values)
  assert.equal(lastCall.name, 'update_customer_service_request_intake')
  assert.equal(lastCall.params.p_expected_updated_at, '2026-10-22T18:00:00.123456+00:00')
  await store.reloadRequests()
  const current = store.getSnapshot().requests[0]
  assert.equal(current.id, original.id)
  assert.equal(current.internalNotes, values.internalNotes)
  assert.equal(current.reportedAt, null)
  assert.equal(current.workflowStage, 'NEEDS_REVIEW')
  assert.deepEqual(current.sourceEmail, original.sourceEmail)
})
