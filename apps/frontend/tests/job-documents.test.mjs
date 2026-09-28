import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildJobDocumentLibrary,
  buildJobDocumentStoragePath,
  countPackagesMissingRequiredDocuments,
  describeJobDocumentProgress,
  summarizeJobDocumentRequirements,
  toJobDocument,
} from '../src/features/draw-invoice/services/jobDocumentRecord.js'

test('Job document rows map persisted Storage metadata to the UI model', () => {
  assert.deepEqual(toJobDocument({
    id: '50aa9672-a0b2-4e21-99c6-776d159bf247',
    job_id: 1307,
    document_type: 'RELEASE',
    storage_bucket: 'job-documents',
    storage_path: '1307/release/50aa9672-a0b2-4e21-99c6-776d159bf247.pdf',
    original_name: 'Release Lot 12.pdf',
    mime_type: 'application/pdf',
    size_bytes: 2048,
    uploaded_by: '1646e53a-c8eb-4db6-a25d-15c4ed2ba80f',
    created_at: '2026-09-24T18:00:00Z',
  }), {
    id: '50aa9672-a0b2-4e21-99c6-776d159bf247',
    jobId: 1307,
    documentType: 'RELEASE',
    typeKey: 'release',
    bucket: 'job-documents',
    storagePath: '1307/release/50aa9672-a0b2-4e21-99c6-776d159bf247.pdf',
    name: 'Release Lot 12.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    uploadedBy: '1646e53a-c8eb-4db6-a25d-15c4ed2ba80f',
    createdAt: '2026-09-24T18:00:00Z',
  })
})

test('document requirements follow each Job billing setup version', () => {
  const jobs = [
    { id: 1307, billingSetupVersionId: 7 },
    { id: 1412, billingSetupVersionId: 9 },
  ]
  const requirements = [
    {
      setup_version_id: 7,
      document_type: 'PURCHASE_ORDER',
      is_required: true,
    },
    {
      setup_version_id: 7,
      document_type: 'RELEASE',
      is_required: true,
    },
    {
      setup_version_id: 9,
      document_type: 'PAYMENT_SCHEDULE',
      is_required: true,
    },
    {
      setup_version_id: 9,
      document_type: 'BACKUP',
      is_required: false,
    },
    {
      setup_version_id: 9,
      document_type: 'INVOICE',
      is_required: true,
    },
  ]

  const library = buildJobDocumentLibrary(jobs, [], requirements)

  assert.deepEqual(library.requiredTypeKeysByJob['1307'], [
    'purchase-order',
    'release',
  ])
  assert.deepEqual(library.requiredTypeKeysByJob['1412'], ['payment-schedule'])
})

test('multiple Releases satisfy one required document type', () => {
  const summary = summarizeJobDocumentRequirements(
    ['release', 'purchase-order', 'payment-schedule'],
    [
      { typeKey: 'release' },
      { typeKey: 'release' },
      { typeKey: 'purchase-order' },
    ],
  )

  assert.equal(summary.requiredCount, 3)
  assert.equal(summary.completedCount, 2)
  assert.deepEqual(summary.missingTypeKeys, ['payment-schedule'])
  assert.equal(summary.isComplete, false)
})

test('a Job with every required type uploaded is complete', () => {
  const summary = summarizeJobDocumentRequirements(
    ['release', 'backup'],
    [{ typeKey: 'release' }, { typeKey: 'backup' }],
  )

  assert.equal(summary.isComplete, true)
  assert.deepEqual(summary.missingTypeKeys, [])
})

test('deleting the last PDF of a required type makes the Job incomplete again', () => {
  const complete = summarizeJobDocumentRequirements(
    ['purchase-order'],
    [{ typeKey: 'purchase-order' }],
  )
  const afterDeletion = summarizeJobDocumentRequirements(['purchase-order'], [])

  assert.equal(complete.isComplete, true)
  assert.equal(afterDeletion.isComplete, false)
  assert.deepEqual(afterDeletion.missingTypeKeys, ['purchase-order'])
})

test('Package document progress matches the complete and missing table states', () => {
  assert.deepEqual(
    describeJobDocumentProgress(
      ['purchase-order', 'payment-schedule', 'release'],
      [
        { typeKey: 'purchase-order' },
        { typeKey: 'release' },
        { typeKey: 'release' },
      ],
    ),
    {
      requiredCount: 3,
      completedCount: 2,
      missingTypeKeys: ['payment-schedule'],
      isComplete: false,
      countLabel: '2 of 3',
      status: 'missing',
      statusLabel: 'Missing 1',
    },
  )

  assert.equal(
    describeJobDocumentProgress(['release'], [{ typeKey: 'release' }]).statusLabel,
    'Complete',
  )
})

test('Package document progress identifies Jobs without submission requirements', () => {
  assert.deepEqual(describeJobDocumentProgress([], []), {
    requiredCount: 0,
    completedCount: 0,
    missingTypeKeys: [],
    isComplete: true,
    countLabel: '0 of 0',
    status: 'not-required',
    statusLabel: 'Not required',
  })
})

test('Missing Documents card counts Packages whose Job has pending requirements', () => {
  const packageJobIds = [1307, 1307, 1412, 1510, 1600]
  const documentsByJob = {
    1307: [{ typeKey: 'release' }],
    1412: [
      { typeKey: 'release' },
      { typeKey: 'purchase-order' },
    ],
    1510: [],
    1600: [],
  }
  const requiredTypeKeysByJob = {
    1307: ['release', 'purchase-order', 'payment-schedule'],
    1412: ['release', 'purchase-order'],
    1510: ['payment-schedule'],
    1600: [],
  }

  assert.equal(
    countPackagesMissingRequiredDocuments(
      packageJobIds,
      documentsByJob,
      requiredTypeKeysByJob,
    ),
    3,
  )
})

test('Storage paths isolate each Job and document category', () => {
  assert.equal(
    buildJobDocumentStoragePath(
      1307,
      'PAYMENT_SCHEDULE',
      '50aa9672-a0b2-4e21-99c6-776d159bf247',
    ),
    '1307/payment_schedule/50aa9672-a0b2-4e21-99c6-776d159bf247.pdf',
  )
  assert.throws(
    () => buildJobDocumentStoragePath(1307, 'INVOICE', 'document-id'),
    /supported Job document type/,
  )
})
