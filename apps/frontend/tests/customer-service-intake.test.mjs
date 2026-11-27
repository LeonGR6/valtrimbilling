import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createCustomerServiceSubmissionKey,
  toCustomerServiceIntakePayload,
} from '../src/features/customer-service/utils/customerServiceIntake.js'
import { createPrototypeRequest } from '../src/features/customer-service/utils/newRequestPrototype.js'

for (const [label, fields, expected] of [
  ['sender only', { sourceEmailFrom: ' builder@example.com ' }, { senderEmail: 'builder@example.com', subject: null }],
  ['subject only', { sourceEmailSubject: ' Warranty follow-up ' }, { senderEmail: null, subject: 'Warranty follow-up' }],
  ['sender and subject', { sourceEmailFrom: 'builder@example.com', sourceEmailSubject: 'Work order' }, { senderEmail: 'builder@example.com', subject: 'Work order' }],
]) {
  test(`persists ${label} without a document, body or extraction`, () => {
    const { source } = toCustomerServiceIntakePayload({
      ...fields,
      sourceDocument: null,
      // Inactive content must not be repackaged as a real source.
      sourceEmailBody: 'Inactive email text',
      extractionReviewNotes: ['Inactive extraction note'],
    })
    assert.deepEqual(source, {
      sourceType: 'EMAIL_METADATA', ...expected, emailText: null,
      extractedText: null, extractionPayload: null, extractionModel: null,
      extractedAt: null, reviewNotes: [],
    })
  })
}

test('a manual request with blank optional email details still has no source', () => {
  assert.equal(toCustomerServiceIntakePayload({ sourceEmailFrom: ' ', sourceEmailSubject: '' }).source, null)
})

test('builds the atomic Customer Service intake payload and omits empty work rows', () => {
  const payload = toCustomerServiceIntakePayload({
    jobId: '42',
    lotNumber: ' 88 ',
    address: ' 100 Test Way ',
    latitude: 33.9,
    longitude: -117.3,
    reportedAt: '2026-10-20',
    reportedAtSource: 'ORDER_DATE',
    priority: 'MEDIUM',
    serviceKind: 'Adjustment',
    workType: 'Doors',
    serviceTask: 'GENERAL_FIX',
    estimatedDurationMinutes: '30',
    crewSize: '1',
    internalNotes: ' Review ',
    contactName: 'Primary Contact',
    contactEmail: 'primary@example.com',
    contactPhone: '',
    additionalContacts: [{
      name: 'Additional Contact',
      email: '',
      phone: '+19515550101',
    }],
    requestedWorkItems: [
      { description: ' Adjust front door ', materialRequired: false, chargeable: true },
      { description: '   ', materialRequired: true, chargeable: false },
      { description: 'Replace hinge', materialRequired: true, chargeable: false },
    ],
    sourceEmailFrom: 'builder@example.com',
    sourceEmailSubject: 'Work order',
    sourceEmailBody: '',
    extractionReviewNotes: ['Verify hinge.'],
    sourceDocument: {
      sourceType: 'PDF',
      extraction: {
        text: 'OCR text',
        model: 'test-model',
        structuredData: { schemaVersion: '1.0' },
      },
    },
  })

  assert.deepEqual(payload.property, {
    jobId: 42,
    lotNumber: '88',
    address: '100 Test Way',
    latitude: 33.9,
    longitude: -117.3,
  })
  assert.deepEqual(payload.contacts, [
    {
      role: 'PRIMARY', name: 'Primary Contact',
      email: 'primary@example.com', phone: null,
    },
    {
      role: 'ADDITIONAL', name: 'Additional Contact',
      email: null, phone: '+19515550101',
    },
  ])
  assert.deepEqual(payload.items, [
    {
      itemNumber: 1, description: 'Adjust front door',
      materialRequired: false, chargeable: true,
    },
    {
      itemNumber: 2, description: 'Replace hinge',
      materialRequired: true, chargeable: false,
    },
  ])
  assert.deepEqual(payload.source, {
    sourceType: 'PDF',
    senderEmail: 'builder@example.com',
    subject: 'Work order',
    emailText: null,
    extractedText: 'OCR text',
    extractionPayload: { schemaVersion: '1.0' },
    extractionModel: 'test-model',
    extractedAt: null,
    reviewNotes: ['Verify hinge.'],
  })
})

test('creates UUID submission keys for idempotent retries', () => {
  assert.match(
    createCustomerServiceSubmissionKey(),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  )
})

test('uses the persisted request identity and private PDF metadata in the session model', () => {
  const sourceDocument = {
    sourceType: 'PDF',
    file: new File(['%PDF-1.7'], 'source.pdf', { type: 'application/pdf' }),
    extraction: null,
    storage: {
      requestId: 42,
      fileId: 9,
      fileStatus: 'AVAILABLE',
      bucketId: 'customer-service-sources',
      objectPath: 'requests/42/source.pdf',
    },
  }
  const request = createPrototypeRequest({
    reportedAt: '2026-10-20',
    priority: 'MEDIUM',
    builderName: 'Test Builder',
    jobId: 7,
    community: 'Test Community',
    lotNumber: '',
    address: '',
    latitude: 33.9,
    longitude: -117.3,
    contactName: 'Test Contact',
    contactPhone: '+19515550101',
    contactEmail: '',
    additionalContacts: [],
    serviceKind: '',
    workType: '',
    serviceTask: '',
    description: 'Adjust door',
    requestedWorkItems: [{ itemNumber: 1, description: 'Adjust door' }],
    estimatedDurationMinutes: '',
    crewSize: '',
    internalNotes: '',
    sourceDocument,
  }, [], ['source.pdf'], new Date('2026-10-20T18:00:00Z'), 'Coordinator', {
    requestId: 42,
    folio: 'CS-1042',
    dueOn: '2026-10-27',
    createdAt: '2026-10-20T18:00:00Z',
  })

  assert.equal(request.id, 42)
  assert.equal(request.requestNumber, 'CS-1042')
  assert.equal(request.dueOn, '2026-10-27')
  assert.equal(request.prototypeOnly, false)
  assert.equal(request.sourceDocument.storage.objectPath, 'requests/42/source.pdf')
  assert.equal(request.activity[0].detail, 'Saved in Supabase')
})
