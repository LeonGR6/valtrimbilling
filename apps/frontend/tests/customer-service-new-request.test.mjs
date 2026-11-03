import test from 'node:test'
import assert from 'node:assert/strict'
import customerServiceMockDatabase from '../src/features/customer-service/data/customerServiceMockDatabase.js'
import {
  buildPrototypeSourceDocument,
  calculateGeneralFixDuration,
  calculatePrototypeDueDate,
  createRequestedWorkItem,
  createPrototypeRequest,
  findDuplicateRequestedWorkItemDescriptions,
  getPrototypeServiceTask,
  hasNewRequestSource,
  isRequestPlanningLocked,
  maxRequestedWorkItemDescriptionCharacters,
  maxRequestedWorkItems,
  newRequestDraftSchema,
  newRequestPrototypeSchema,
  parsePrototypeCoordinates,
  prototypeServiceTaskOptions,
  prototypeWorkTypeOptions,
  requestAdministrativeEditSchema,
  renumberRequestedWorkItems,
  requestToPrototypeFormValues,
  serviceKindOptions,
  summarizeNewRequestFormErrors,
  updatePrototypeRequest,
  validatePrototypeSourcePdf,
} from '../src/features/customer-service/utils/newRequestPrototype.js'

import {
  buildRequestReviewSummary,
  markRequestReadyToPropose,
} from '../src/features/customer-service/utils/requestInbox.js'
import {
  formatUsDateInput,
  parseUsDateInput,
} from '../src/features/customer-service/utils/dates.js'

const primaryWorkItemId = 'work-item-primary'

test('Reported on uses the U.S. date format while preserving an ISO form value', () => {
  assert.equal(formatUsDateInput('2026-10-05'), '10/05/2026')
  assert.equal(parseUsDateInput('10/05/2026'), '2026-10-05')
  assert.equal(parseUsDateInput('05/10/2026'), '2026-05-10')
  assert.equal(parseUsDateInput('02/30/2026'), '')
  assert.equal(formatUsDateInput('2026-02-30'), '2026-02-30')
})

const validForm = {
  reportedAt: '2026-10-01',
  priority: 'MEDIUM',
  builderName: 'Magnolia Homes',
  jobId: '101',
  community: 'Magnolia at Arcadia',
  lotNumber: '88',
  address: '',
  coordinates: '33.97788205770745, -117.34520765941319',
  contactName: 'Elena Rivera',
  contactPhoneCountry: 'US',
  contactPhone: '9515550199',
  contactEmail: 'ELENA@example.com',
  serviceKind: 'Adjustment',
  workType: 'Hardware',
  serviceTask: 'GENERAL_FIX',
  requestedWorkItems: [{
    id: primaryWorkItemId,
    itemNumber: '1',
    description: 'The entry door does not latch consistently.',
    materialRequired: false,
    chargeable: false,
  }],
  estimatedDurationMinutes: 30,
  crewSize: 1,
  internalNotes: '',
  sourceEmailFrom: 'service@example.com',
  sourceEmailSubject: 'Lot 88 service request',
}

test('required capture data can be saved while classification and planning remain pending', () => {
  const draft = newRequestDraftSchema.parse({
    ...validForm,
    serviceKind: '',
    workType: '',
    serviceTask: '',
    estimatedDurationMinutes: '',
    crewSize: '',
  })
  const request = createPrototypeRequest(draft, [])
  const review = buildRequestReviewSummary(request)

  assert.equal(request.workflowStage, 'NEEDS_REVIEW')
  assert.equal(request.estimatedDurationMinutes, null)
  assert.equal(request.crewSize, null)
  assert.equal(review.completedCount, 2)
  assert.equal(review.isComplete, false)
  assert.equal(review.checks.find((check) => check.id === 'property').complete, true)
  assert.equal(review.checks.find((check) => check.id === 'customer').complete, true)
  assert.throws(() => markRequestReadyToPropose(request, { valtrimItemsConfirmed: true }), /Complete all/)
})

test('a blank request cannot be saved even when default classifications or source text exist', () => {
  const result = newRequestDraftSchema.safeParse({
    ...validForm,
    builderName: '',
    community: '',
    lotNumber: '',
    address: '   ',
    coordinates: '',
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    serviceTask: '',
    requestedWorkItems: [createRequestedWorkItem({ description: '   ' })],
    estimatedDurationMinutes: '',
    crewSize: '',
    sourceEmailBody: 'Source text without mapped property or work.',
  })
  assert.equal(result.success, false)
  assert.deepEqual(
    new Set(result.error.issues.map((issue) => issue.path[0])),
    new Set([
      'builderName', 'community', 'coordinates', 'contactName',
      'contactPhone', 'contactEmail', 'requestedWorkItems',
    ]),
  )
})

test('save for review requires Builder, Project / Job, coordinates, customer and contact', () => {
  const captureForm = {
    ...validForm,
    serviceKind: '', workType: '', serviceTask: '',
    estimatedDurationMinutes: '', crewSize: '',
  }

  assert.equal(newRequestDraftSchema.safeParse(captureForm).success, true)
  assert.equal(newRequestDraftSchema.safeParse({
    ...captureForm,
    contactPhone: '',
  }).success, true)
  assert.equal(newRequestDraftSchema.safeParse({
    ...captureForm,
    contactEmail: '',
  }).success, true)

  for (const missing of [
    { builderName: '' },
    { community: '' },
    { coordinates: '', address: '4234 Jasmine Lane' },
    { contactName: '' },
    { contactPhone: '', contactEmail: '' },
  ]) {
    const result = newRequestDraftSchema.safeParse({ ...captureForm, ...missing })
    assert.equal(result.success, false)
  }
})

test('a described work item is mandatory for drafts but additional pending rows are allowed for review', () => {
  for (const items of [[], [createRequestedWorkItem()], [
    createRequestedWorkItem({ itemNumber: 1, description: '  ' }),
    createRequestedWorkItem({ itemNumber: 2, description: '\t' }),
  ]]) {
    assert.equal(newRequestDraftSchema.safeParse({ ...validForm, requestedWorkItems: items }).success, false)
  }
  const draft = newRequestDraftSchema.parse({
    ...validForm,
    requestedWorkItems: [
      createRequestedWorkItem({ itemNumber: 1 }),
      createRequestedWorkItem({ itemNumber: 2, description: 'Adjust the front door.' }),
    ],
  })
  const review = buildRequestReviewSummary(createPrototypeRequest(draft, []))
  assert.equal(review.isComplete, false)
  assert.equal(review.checks.find((check) => check.id === 'work').complete, false)
})

test('source warning considers only the active PDF or nonempty email text, not an inactive source', () => {
  assert.equal(hasNewRequestSource({ sourceInputMode: 'PDF', sourcePdf: null }), false)
  assert.equal(hasNewRequestSource({ sourceInputMode: 'PDF', sourcePdf: { name: 'source.pdf' } }), true)
  assert.equal(hasNewRequestSource({ sourceInputMode: 'PDF', sourceEmailText: 'Inactive email.' }), false)
  assert.equal(hasNewRequestSource({ sourceInputMode: 'EMAIL_TEXT', sourceEmailText: ' \n ' }), false)
  assert.equal(hasNewRequestSource({ sourceInputMode: 'EMAIL_TEXT', sourceEmailText: 'A service request.' }), true)
  assert.equal(hasNewRequestSource({ sourceInputMode: 'EMAIL_TEXT', sourcePdf: { name: 'inactive.pdf' } }), false)
})

test('drafts permit missing fields, not invalid values entered by the user', () => {
  const invalidValues = [
    { contactEmail: 'wrong-email' },
    { contactPhone: 'abc' },
    { coordinates: '91, -117' },
    { estimatedDurationMinutes: 14 },
    { crewSize: 11 },
    { serviceTask: 'UNKNOWN_TASK' },
    { reportedAt: '2026-02-30' },
    { reportedAt: 'not-a-date' },
  ]
  invalidValues.forEach((values) => {
    assert.equal(newRequestDraftSchema.safeParse({ ...validForm, ...values }).success, false)
  })
  assert.throws(() => calculatePrototypeDueDate('not-a-date'), /valid reported date/)
})

test('a partial additional contact is preserved in a draft and must be completed for review', () => {
  const values = newRequestDraftSchema.parse({
    ...validForm,
    additionalContactEmail: 'another@example.com',
  })
  const request = createPrototypeRequest(values, [])
  assert.equal(request.additionalContacts[0].email, 'another@example.com')
  assert.equal(requestToPrototypeFormValues(request).additionalContactEmail, 'another@example.com')
  assert.equal(buildRequestReviewSummary(request).checks[0].complete, false)
})

test('three customers keep their own phones through save, reload and editing', () => {
  const values = newRequestPrototypeSchema.parse({
    ...validForm,
    additionalContacts: [
      { name: 'Second Owner', phoneCountry: 'US', phone: '9515550102', email: '' },
      { name: 'Third Owner', phoneCountry: 'MX', phone: '6645550103', email: 'THIRD@example.com' },
    ],
  })
  const request = createPrototypeRequest(values, [])
  assert.deepEqual(request.additionalContacts, [
    { name: 'Second Owner', phone: '+19515550102', email: '' },
    { name: 'Third Owner', phone: '+526645550103', email: 'third@example.com' },
  ])
  const reopened = requestToPrototypeFormValues(request)
  assert.equal(reopened.additionalContacts.length, 2)
  assert.equal(reopened.additionalContacts[1].phoneCountry, 'MX')
  assert.deepEqual(newRequestPrototypeSchema.parse(reopened).additionalContacts, request.additionalContacts)
  assert.equal(buildRequestReviewSummary(request).checks[0].complete, true)
})

test('a fourth customer is rejected and every additional customer is validated before approval', () => {
  const contact = { name: 'Owner', phone: '9515550102', phoneCountry: 'US', email: '' }
  assert.equal(newRequestPrototypeSchema.safeParse({ ...validForm, additionalContacts: [contact, contact, contact] }).success, false)
  const result = newRequestPrototypeSchema.safeParse({ ...validForm, additionalContacts: [contact, { ...contact, name: '', phone: 'invalid' }] })
  assert.equal(result.success, false)
  assert.equal(result.error.issues.some((issue) => issue.path.join('.') === 'additionalContacts.1.name'), true)
  assert.equal(result.error.issues.some((issue) => issue.path.join('.') === 'additionalContacts.1.phone'), true)
})

test('removing the second customer does not lose the third and nested errors remain visible', () => {
  const values = newRequestDraftSchema.parse({ ...validForm, additionalContacts: [
    { name: 'Third Owner', phone: '9515550103', phoneCountry: 'US', email: '' },
  ] })
  assert.equal(values.additionalContacts.length, 1)
  assert.equal(values.additionalContacts[0].name, 'Third Owner')
  const summary = summarizeNewRequestFormErrors({ additionalContacts: [undefined, { phone: { message: 'Invalid phone' } }] })
  assert.equal(summary[0].fieldName, 'additionalContacts.1.phone')
  assert.equal(summary[0].label, 'Customer 3 phone')
})

test('save incomplete, complete, approve and change critical data requires a fresh review', () => {
  const draft = createPrototypeRequest(newRequestDraftSchema.parse({
    ...validForm, contactEmail: '',
  }), [], ['email.pdf'])
  const completed = updatePrototypeRequest(draft, newRequestPrototypeSchema.parse(validForm))
  assert.equal(completed.workflowStage, 'NEEDS_REVIEW')
  const ready = markRequestReadyToPropose(completed, {
    reviewedBy: 'Anelda Calvillo', valtrimItemsConfirmed: true,
  })
  const changes = [
    { address: 'Another service location' },
    { coordinates: '33.9, -117.3' },
    { serviceTask: 'EXTERIOR_DOOR_REPLACEMENT' },
    { requestedWorkItems: [{ ...validForm.requestedWorkItems[0], description: 'Replace the door.' }] },
    { estimatedDurationMinutes: 45 },
    { crewSize: 2 },
  ]
  changes.forEach((change) => {
    const edited = updatePrototypeRequest(ready, newRequestPrototypeSchema.parse({ ...validForm, ...change }))
    assert.equal(edited.id, draft.id)
    assert.equal(edited.requestNumber, draft.requestNumber)
    assert.equal(edited.workflowStage, 'NEEDS_REVIEW')
    assert.equal(edited.review, null)
    assert.equal(edited.activity.at(-1).label, 'Review required')
    assert.deepEqual(edited.sourceEmail.attachmentNames, ['email.pdf'])
    assert.equal(markRequestReadyToPropose(edited, { valtrimItemsConfirmed: true }).workflowStage, 'READY_TO_PROPOSE')
  })
  assert.equal(ready.workflowStage, 'READY_TO_PROPOSE')
  assert.equal(ready.review.valtrimItemsConfirmed, true)
})

test('administrative edits preserve approval; removing required customer information does not', () => {
  const ready = markRequestReadyToPropose(createPrototypeRequest(
    newRequestPrototypeSchema.parse(validForm), [],
  ), { valtrimItemsConfirmed: true })
  const administrative = updatePrototypeRequest(ready, newRequestPrototypeSchema.parse({
    ...validForm, internalNotes: 'Coordinator note.', priority: 'HIGH',
  }))
  assert.equal(administrative.workflowStage, 'READY_TO_PROPOSE')
  assert.deepEqual(administrative.review, ready.review)
  const incomplete = updatePrototypeRequest(ready, {
    ...newRequestPrototypeSchema.parse(validForm),
    contactPhone: '',
    contactEmail: '',
  })
  assert.equal(incomplete.workflowStage, 'NEEDS_REVIEW')
  assert.equal(incomplete.review, null)
})

test('coordinates accept a full precision pasted pair', () => {
  assert.deepEqual(
    parsePrototypeCoordinates('33.97788205770745, -117.34520765941319'),
    {
      latitude: 33.97788205770745,
      longitude: -117.34520765941319,
    },
  )
  assert.equal(parsePrototypeCoordinates('33.97 -117.34'), null)
  assert.equal(parsePrototypeCoordinates('91, -117.34'), null)
})

test('work items are renumbered without gaps after deleting rows', () => {
  assert.deepEqual(
    renumberRequestedWorkItems([
      { id: 'first', itemNumber: '1', description: 'First' },
      { id: 'fifth', itemNumber: '5', description: 'Fifth' },
    ]),
    [
      { id: 'first', itemNumber: '1', description: 'First' },
      { id: 'fifth', itemNumber: '2', description: 'Fifth' },
    ],
  )
})

test('work item identifiers are stable and item booleans have explicit defaults', () => {
  const workItem = createRequestedWorkItem({ id: 'stable-id', itemNumber: 4 })

  assert.deepEqual(workItem, {
    id: 'stable-id',
    itemNumber: '4',
    description: '',
    materialRequired: false,
    chargeable: false,
  })
})

test('work item descriptions are limited to 1,000 characters and 25 items', () => {
  const tooLong = newRequestPrototypeSchema.safeParse({
    ...validForm,
    requestedWorkItems: [{
      ...validForm.requestedWorkItems[0],
      description: 'x'.repeat(maxRequestedWorkItemDescriptionCharacters + 1),
    }],
  })
  const tooMany = newRequestPrototypeSchema.safeParse({
    ...validForm,
    requestedWorkItems: Array.from({ length: maxRequestedWorkItems + 1 }, (_, index) => ({
      id: `work-item-${index + 1}`,
      itemNumber: String(index + 1),
      description: `Work item ${index + 1}`,
      materialRequired: false,
      chargeable: false,
    })),
  })

  assert.equal(tooLong.success, false)
  assert.equal(tooMany.success, false)
})

test('empty work items and non-boolean administrative flags are rejected', () => {
  const emptyDescription = newRequestPrototypeSchema.safeParse({
    ...validForm,
    requestedWorkItems: [{
      ...validForm.requestedWorkItems[0],
      description: '   ',
    }],
  })
  const invalidFlags = newRequestPrototypeSchema.safeParse({
    ...validForm,
    requestedWorkItems: [{
      ...validForm.requestedWorkItems[0],
      materialRequired: 'false',
      chargeable: 0,
    }],
  })

  assert.equal(emptyDescription.success, false)
  assert.equal(invalidFlags.success, false)
})

test('duplicate work descriptions produce a warning without blocking validation', () => {
  const requestedWorkItems = [
    validForm.requestedWorkItems[0],
    {
      ...validForm.requestedWorkItems[0],
      id: 'work-item-duplicate',
      itemNumber: '2',
      description: '  THE ENTRY DOOR does not latch consistently.  ',
    },
  ]

  assert.equal(newRequestPrototypeSchema.safeParse({
    ...validForm,
    requestedWorkItems,
  }).success, true)
  assert.deepEqual(findDuplicateRequestedWorkItemDescriptions(requestedWorkItems), [{
    description: 'The entry door does not latch consistently.',
    itemNumbers: ['1', '2'],
  }])
})

test('validation summary keeps form order and identifies the invalid work item', () => {
  assert.deepEqual(summarizeNewRequestFormErrors({
    crewSize: { message: 'Enter the required crew.' },
    requestedWorkItems: [
      undefined,
      { description: { message: 'Describe this work item.' } },
    ],
    builderName: { message: 'Choose a builder.' },
  }), [
    {
      key: 'builderName',
      fieldName: 'builderName',
      label: 'Builder',
      message: 'Choose a builder.',
    },
    {
      key: 'requestedWorkItems-1',
      fieldName: null,
      itemIndex: 1,
      label: 'Work item 2',
      message: 'Describe this work item.',
    },
    {
      key: 'crewSize',
      fieldName: 'crewSize',
      label: 'Crew required',
      message: 'Enter the required crew.',
    },
  ])
})

test('coordinates are required for approval even when an address is available', () => {
  const result = newRequestPrototypeSchema.safeParse({
    ...validForm,
    address: '4234 Jasmine Lane, Arcadia, CA 91006',
    coordinates: '',
  })

  assert.equal(result.success, false)
  assert.equal(
    result.error.issues.some((issue) => (
      issue.path[0] === 'coordinates'
      && issue.message === 'Select a Job with coordinates or enter valid coordinates.'
    )),
    true,
  )
})

test('coordinates are required when the address is unavailable', () => {
  const result = newRequestPrototypeSchema.safeParse({
    ...validForm,
    address: '',
    coordinates: '',
  })

  assert.equal(result.success, false)
  assert.equal(
    result.error.issues.some((issue) => (
      issue.path[0] === 'coordinates'
      && issue.message === 'Select a Job with coordinates or enter valid coordinates.'
    )),
    true,
  )
})

test('approval requires a customer email or phone, not both', () => {
  assert.equal(newRequestPrototypeSchema.safeParse({
    ...validForm,
    contactEmail: '',
  }).success, true)
  assert.equal(newRequestPrototypeSchema.safeParse({
    ...validForm,
    contactPhone: '',
  }).success, true)

  const missingBoth = newRequestPrototypeSchema.safeParse({
    ...validForm,
    contactPhone: '',
    contactEmail: '',
  })
  assert.equal(missingBoth.success, false)
  assert.deepEqual(
    missingBoth.error.issues
      .filter((issue) => ['contactPhone', 'contactEmail'].includes(issue.path[0]))
      .map((issue) => issue.path[0]),
    ['contactPhone', 'contactEmail'],
  )
})

test('provided coordinates must still use a valid latitude and longitude pair', () => {
  const result = newRequestPrototypeSchema.safeParse({
    ...validForm,
    address: '4234 Jasmine Lane, Arcadia, CA 91006',
    coordinates: 'invalid coordinates',
  })

  assert.equal(result.success, false)
})

test('source email attachment accepts one non-empty PDF up to 10 MB', () => {
  assert.equal(
    validatePrototypeSourcePdf({ name: 'service-email.pdf', type: 'application/pdf', size: 2048 }),
    '',
  )
  assert.equal(
    validatePrototypeSourcePdf({ name: 'service-email.txt', type: 'text/plain', size: 2048 }),
    'Only PDF files are allowed.',
  )
  assert.equal(
    validatePrototypeSourcePdf({ name: 'empty.pdf', type: 'application/pdf', size: 0 }),
    'The PDF file is empty.',
  )
  assert.equal(
    validatePrototypeSourcePdf({ name: 'large.pdf', type: 'application/pdf', size: 10 * 1024 * 1024 + 1 }),
    'The PDF must be 10 MB or smaller.',
  )
})

test('service task catalog defines planning duration and crew', () => {
  assert.deepEqual(
    prototypeServiceTaskOptions.map(({ value, durationMinutes, crewSize }) => ({
      value,
      durationMinutes,
      crewSize,
    })),
    [
      { value: 'GENERAL_FIX', durationMinutes: 30, crewSize: 1 },
      { value: 'EXTERIOR_DOOR_REPLACEMENT', durationMinutes: 120, crewSize: 1 },
      { value: 'EXTERIOR_FRAME_REPLACEMENT', durationMinutes: 120, crewSize: 1 },
      { value: 'SHUTTER_REPLACEMENT', durationMinutes: 120, crewSize: 2 },
      { value: 'SHELVING_REPLACEMENT', durationMinutes: 60, crewSize: 1 },
    ],
  )
  assert.equal(getPrototypeServiceTask('SHUTTER_REPLACEMENT').crewSize, 2)
  assert.equal(
    getPrototypeServiceTask('EXTERIOR_FRAME_REPLACEMENT').label,
    'Exterior frame replacement',
  )
})

test('general fix duration follows the described work item ranges', () => {
  assert.equal(calculateGeneralFixDuration(0), 30)
  assert.equal(calculateGeneralFixDuration(6), 30)
  assert.equal(calculateGeneralFixDuration(7), 45)
  assert.equal(calculateGeneralFixDuration(9), 45)
  assert.equal(calculateGeneralFixDuration(10), 60)
  assert.equal(calculateGeneralFixDuration(25), 60)
})

test('service kind exposes the requested options in order', () => {
  assert.deepEqual(
    serviceKindOptions.map((option) => option.value),
    ['Adjustment', 'Replacement', 'Paid Extra'],
  )
  assert.equal(
    newRequestPrototypeSchema.safeParse({ ...validForm, serviceKind: 'Paid extra' }).success,
    false,
  )
})

test('work type exposes the current categories and the multiple-items option', () => {
  assert.deepEqual(
    prototypeWorkTypeOptions.map((option) => option.value),
    [
      'Exterior Frames',
      'Doors',
      'Moldings',
      'Hardware',
      'Weatherstripping',
      'Shelving',
      'Multiple work types',
    ],
  )
  assert.equal(
    newRequestPrototypeSchema.safeParse({
      ...validForm,
      workType: 'Multiple work types',
    }).success,
    true,
  )
  assert.equal(
    newRequestPrototypeSchema.safeParse({ ...validForm, workType: 'Woodwork' }).success,
    false,
  )
})

test('new request validates the selected task planning values', () => {
  const result = newRequestPrototypeSchema.safeParse(validForm)

  assert.equal(result.success, true)
  assert.equal(result.data.estimatedDurationMinutes, 30)
  assert.equal(result.data.crewSize, 1)
  assert.equal(result.data.contactEmail, 'elena@example.com')
  assert.equal(result.data.lotNumber, '88')
  assert.equal(result.data.address, '')
  assert.equal(result.data.description, 'The entry door does not latch consistently.')
})

test('task duration and crew can be adjusted before creating the request', () => {
  const result = newRequestPrototypeSchema.safeParse({
    ...validForm,
    estimatedDurationMinutes: 45,
    crewSize: 2,
  })

  assert.equal(result.success, true)
  assert.equal(result.data.estimatedDurationMinutes, 45)
  assert.equal(result.data.crewSize, 2)
})

test('an optional second customer is normalized with their contact details', () => {
  const result = newRequestPrototypeSchema.safeParse({
    ...validForm,
    additionalContactName: 'Victor Rivera',
    additionalContactPhoneCountry: 'MX',
    additionalContactPhone: '6645550188',
    additionalContactEmail: 'VICTOR@example.com',
  })

  assert.equal(result.success, true)
  assert.deepEqual(result.data.additionalContacts, [{
    name: 'Victor Rivera',
    phone: '+526645550188',
    email: 'victor@example.com',
  }])
})

test('a second customer requires a name and either a phone or email', () => {
  const phoneOnly = newRequestPrototypeSchema.safeParse({
    ...validForm,
    additionalContactName: 'Victor Rivera',
    additionalContactPhoneCountry: 'MX',
    additionalContactPhone: '6645550188',
  })
  const emailOnly = newRequestPrototypeSchema.safeParse({
    ...validForm,
    additionalContactName: 'Victor Rivera',
    additionalContactEmail: 'victor@example.com',
  })
  const result = newRequestPrototypeSchema.safeParse({
    ...validForm,
    additionalContactName: 'Victor Rivera',
  })

  assert.equal(phoneOnly.success, true)
  assert.equal(emailOnly.success, true)
  assert.equal(result.success, false)
  assert.deepEqual(
    result.error.issues.map((issue) => issue.path[0]).sort(),
    ['additionalContactEmail', 'additionalContactPhone'],
  )
})

test('service task planning values are required', () => {
  const result = newRequestPrototypeSchema.safeParse({
    ...validForm,
    serviceTask: '',
    estimatedDurationMinutes: '',
    crewSize: '',
  })

  assert.equal(result.success, false)
  assert.deepEqual(
    result.error.issues.map((issue) => issue.path[0]).sort(),
    ['crewSize', 'estimatedDurationMinutes', 'serviceTask'],
  )
})

test('five business days start after the reported date', () => {
  assert.equal(calculatePrototypeDueDate('2026-10-05'), '2026-10-12')
})

test('created prototype request is immediately ready for inbox review', () => {
  const parsed = newRequestPrototypeSchema.parse(validForm)
  const created = createPrototypeRequest(
    parsed,
    customerServiceMockDatabase.requests,
    ['door-photo.jpg'],
    new Date('2026-10-01T17:00:00.000Z'),
  )

  assert.equal(created.requestNumber, 'CS-1065')
  assert.equal(created.createdAt, '2026-10-01T17:00:00.000Z')
  assert.equal(created.reportedAtSource, 'MANUAL')
  assert.equal(created.dueOn, '2026-10-08')
  assert.equal(created.workflowStage, 'NEEDS_REVIEW')
  assert.equal(created.lotNumber, '88')
  assert.equal(created.address, '')
  assert.equal(Object.hasOwn(created, 'plan'), false)
  assert.equal(Object.hasOwn(created, 'preferredContactMethod'), false)
  assert.deepEqual(created.additionalContacts, [])
  assert.equal(created.serviceTask, 'GENERAL_FIX')
  assert.equal(created.issue, 'General fix')
  assert.equal(created.estimatedDurationMinutes, 30)
  assert.equal(created.crewSize, 1)
  assert.deepEqual(created.customerUnavailableDates, [])
  assert.equal(created.customerNeedsContact, false)
  assert.equal(created.customerAvailabilityNotes, '')
  assert.equal(created.sourceEmail.attachmentCount, 1)
  assert.equal(created.sourceEmail.receivedAt, '2026-10-01T17:00:00.000Z')
  assert.equal(created.sourceEmail.body, '')
  assert.equal(created.sourceEmail.pinned, false)
  assert.equal(created.sourceEmail.forwardedToCrew, false)
  assert.deepEqual(created.requestedWorkItems, [{
    id: primaryWorkItemId,
    itemNumber: '1',
    description: 'The entry door does not latch consistently.',
    materialRequired: false,
    chargeable: false,
  }])
  assert.equal(created.prototypeOnly, true)
})

test('pasted source email content is kept in the frontend request record', () => {
  const parsed = newRequestPrototypeSchema.parse(validForm)
  const created = createPrototypeRequest(
    {
      ...parsed,
      sourceEmailBody: 'Original warranty email content.',
    },
    customerServiceMockDatabase.requests,
    [],
    new Date('2026-10-01T17:00:00.000Z'),
  )

  assert.equal(created.sourceEmail.body, 'Original warranty email content.')
})

const sourceExtractionFixture = {
  sourceType: 'PDF',
  fileName: 'original.pdf',
  fileSize: 42,
  pageCount: 1,
  model: 'test-ocr',
  text: 'Original OCR text',
  pages: [{ page: 1, markdown: 'Original OCR text', averageConfidence: 0.98, minimumConfidence: 0.9 }],
  structuredData: {
    schemaVersion: '1.0',
    document: { documentTitle: 'Original warranty request' },
    property: { lotNumber: '88' },
    contacts: [],
    serviceItems: [{ description: 'Original extracted work' }],
    warnings: ['Confirm the assigned vendor.'],
  },
}

test('a saved request retains the real PDF bytes and a separate complete extraction snapshot in memory', async () => {
  const file = new File(['%PDF-1.4\noriginal bytes'], 'original.pdf', { type: 'application/pdf' })
  const extraction = structuredClone(sourceExtractionFixture)
  const sourceDocument = buildPrototypeSourceDocument({
    sourceInputMode: 'PDF', sourcePdf: file, sourceExtraction: extraction,
  })
  const created = createPrototypeRequest({
    ...newRequestPrototypeSchema.parse(validForm), sourceDocument,
  }, [], [file.name])

  assert.equal(created.sourceDocument.sourceType, 'PDF')
  assert.strictEqual(created.sourceDocument.file, file)
  assert.equal(await created.sourceDocument.file.text(), '%PDF-1.4\noriginal bytes')
  assert.deepEqual(created.sourceDocument.extraction, sourceExtractionFixture)
  assert.notStrictEqual(created.sourceDocument.extraction, extraction)
  extraction.structuredData.serviceItems[0].description = 'A later analysis changed this'
  assert.equal(created.sourceDocument.extraction.structuredData.serviceItems[0].description, 'Original extracted work')
  assert.equal(Object.hasOwn(created.sourceDocument, 'url'), false)
})

test('editing or approving a request preserves its original file and AI reference, not the corrected form', () => {
  const file = new File(['%PDF-1.4\noriginal bytes'], 'original.pdf', { type: 'application/pdf' })
  const sourceDocument = buildPrototypeSourceDocument({
    sourceInputMode: 'PDF', sourcePdf: file, sourceExtraction: sourceExtractionFixture,
  })
  const original = createPrototypeRequest({
    ...newRequestPrototypeSchema.parse(validForm), sourceDocument,
  }, [], [file.name])
  const ready = markRequestReadyToPropose(original, { valtrimItemsConfirmed: true })
  const editedValues = newRequestPrototypeSchema.parse({
    ...requestToPrototypeFormValues(ready),
    requestedWorkItems: [{ ...validForm.requestedWorkItems[0], description: 'Corrected work scope.' }],
  })
  const updated = updatePrototypeRequest(ready, {
    ...editedValues,
    sourceDocument: null,
  })

  assert.strictEqual(ready.sourceDocument, sourceDocument)
  assert.strictEqual(updated.sourceDocument, sourceDocument)
  assert.strictEqual(updated.sourceDocument.file, file)
  assert.equal(updated.sourceDocument.extraction.text, 'Original OCR text')
  assert.equal(updated.sourceDocument.extraction.structuredData.serviceItems[0].description, 'Original extracted work')
  assert.equal(updated.requestedWorkItems[0].description, 'Corrected work scope.')
  assert.equal(updated.workflowStage, 'NEEDS_REVIEW')
  assert.deepEqual(updated.sourceEmail.attachmentNames, [file.name])
})

test('a PDF can be retained for review even when AI extraction failed', () => {
  const file = new File(['%PDF-1.4\noriginal bytes'], 'original.pdf', { type: 'application/pdf' })
  const sourceDocument = buildPrototypeSourceDocument({ sourceInputMode: 'PDF', sourcePdf: file })
  assert.strictEqual(sourceDocument.file, file)
  assert.equal(sourceDocument.extraction, null)
})

test('manual requests do not require a source and do not retain inactive files or extractions', () => {
  const file = new File(['%PDF-1.4'], 'inactive.pdf', { type: 'application/pdf' })
  assert.equal(buildPrototypeSourceDocument({ sourceInputMode: 'PDF' }), null)
  assert.equal(buildPrototypeSourceDocument({ sourceInputMode: 'EMAIL_TEXT', sourceEmailText: '  ', sourcePdf: file }), null)
  assert.equal(createPrototypeRequest(newRequestPrototypeSchema.parse(validForm), []).sourceDocument, null)

  const emailSource = buildPrototypeSourceDocument({
    sourceInputMode: 'EMAIL_TEXT', sourceEmailText: 'Original email', sourcePdf: file,
    sourceExtraction: sourceExtractionFixture,
  })
  assert.equal(emailSource.sourceType, 'EMAIL_TEXT')
  assert.equal(emailSource.file, null)
  assert.equal(emailSource.extraction, null)
})

test('pasted email retains its own complete analysis without attaching an inactive PDF', () => {
  const extraction = { ...sourceExtractionFixture, sourceType: 'EMAIL_TEXT' }
  const sourceDocument = buildPrototypeSourceDocument({
    sourceInputMode: 'EMAIL_TEXT', sourceEmailText: 'Original warranty email', sourceExtraction: extraction,
  })
  const created = createPrototypeRequest({
    ...newRequestPrototypeSchema.parse(validForm), sourceDocument, sourceEmailBody: 'Original warranty email',
  }, [])
  assert.equal(created.sourceDocument.file, null)
  assert.deepEqual(created.sourceDocument.extraction, extraction)
  assert.equal(created.sourceEmail.body, 'Original warranty email')
  assert.deepEqual(created.sourceEmail.attachmentNames, [])
})

test('editing a request before proposing preserves identity while updating form-owned data', () => {
  const parsed = newRequestPrototypeSchema.parse({
    ...validForm,
    priority: 'HIGH',
    estimatedDurationMinutes: 45,
    crewSize: 2,
  })
  const original = {
    ...customerServiceMockDatabase.requests.find((request) => request.workflowStage === 'NEEDS_REVIEW'),
    sourceEmail: {
      ...customerServiceMockDatabase.requests[5].sourceEmail,
      body: 'Original source content',
      attachmentNames: ['original.pdf'],
    },
  }
  const updated = updatePrototypeRequest(
    original,
    parsed,
    undefined,
    new Date('2026-10-08T18:00:00.000Z'),
    'Anelda Calvillo',
  )

  assert.equal(updated.id, original.id)
  assert.equal(updated.requestNumber, original.requestNumber)
  assert.equal(updated.workflowStage, original.workflowStage)
  assert.deepEqual(updated.customerWindow, original.customerWindow)
  assert.equal(updated.technicianName, original.technicianName)
  assert.equal(updated.priority, 'HIGH')
  assert.equal(updated.estimatedDurationMinutes, 45)
  assert.equal(updated.crewSize, 2)
  assert.equal(updated.coordinatorName, 'Anelda Calvillo')
  assert.equal(updated.sourceEmail.body, 'Original source content')
  assert.deepEqual(updated.sourceEmail.attachmentNames, ['original.pdf'])
  assert.equal(updated.activity.at(-1).label, 'Request updated')
  assert.equal(updated.activity.at(-1).detail, 'Edited by Anelda Calvillo')
})

test('planning is locked while awaiting a customer, after confirmation and after completion', () => {
  for (const workflowStage of ['AWAITING_CUSTOMER', 'CONFIRMED', 'COMPLETED']) {
    assert.equal(isRequestPlanningLocked({ workflowStage }), true)
  }
  for (const workflowStage of ['NEEDS_REVIEW', 'READY_TO_PROPOSE', 'NEEDS_CONTACT']) {
    assert.equal(isRequestPlanningLocked({ workflowStage }), false)
  }
  assert.equal(isRequestPlanningLocked(null), false)
})

for (const workflowStage of ['AWAITING_CUSTOMER', 'CONFIRMED']) {
  test(`${workflowStage} updates only priority and notes, preserving every operational field and source`, () => {
    const original = {
      ...customerServiceMockDatabase.requests.find((request) => request.workflowStage === workflowStage),
      coordinatorName: 'Original coordinator',
      sourceDocument: { file: new File(['%PDF-1.4'], 'original.pdf'), extraction: { text: 'Original OCR' } },
    }
    const before = { ...original }
    const updatedAt = new Date('2026-10-12T18:00:00.000Z')
    const updated = updatePrototypeRequest(original, {
      ...newRequestPrototypeSchema.parse(validForm),
      priority: 'HIGH',
      internalNotes: '  Administrative correction  ',
      estimatedDurationMinutes: 120,
      crewSize: 3,
      sourceEmailBody: 'Replacement content',
      sourceDocument: null,
      workflowStage: 'NEEDS_REVIEW',
      customerWindow: null,
      internalSlot: null,
      review: null,
    }, ['replacement.pdf'], updatedAt, 'Anelda Calvillo')

    const { updatedAt: timestamp, activity, prototypeOnly, ...updatedFields } = updated
    const { updatedAt: _timestamp, activity: _activity, prototypeOnly: _prototypeOnly, ...originalFields } = original
    assert.deepEqual(updatedFields, {
      ...originalFields, priority: 'HIGH', internalNotes: 'Administrative correction',
    })
    assert.equal(timestamp, updatedAt.toISOString())
    assert.equal(prototypeOnly, true)
    assert.equal(activity.at(-1).detail, 'Administrative fields edited by Anelda Calvillo')
    for (const field of ['sourceDocument', 'sourceEmail', 'requestedWorkItems', 'customerWindow', 'internalSlot', 'review']) {
      assert.strictEqual(updated[field], original[field])
    }
    assert.deepEqual(original, before)
  })
}

test('COMPLETED updates only internal notes and preserves priority and operational data', () => {
  const original = customerServiceMockDatabase.requests.find((request) => request.workflowStage === 'COMPLETED')
  const updated = updatePrototypeRequest(original, {
    ...requestToPrototypeFormValues(original),
    priority: original.priority === 'HIGH' ? 'LOW' : 'HIGH',
    internalNotes: '  Completion follow-up note  ',
  })

  assert.equal(updated.internalNotes, 'Completion follow-up note')
  assert.equal(updated.priority, original.priority)
  assert.strictEqual(updated.customerWindow, original.customerWindow)
  assert.strictEqual(updated.internalSlot, original.internalSlot)
})

test('administrative edits validate their own fields without requiring changes to locked legacy records', () => {
  const legacy = {
    ...customerServiceMockDatabase.requests.find((request) => request.workflowStage === 'CONFIRMED'),
    workType: 'Woodwork',
    serviceTask: '',
    crewSize: undefined,
    requestedWorkItems: undefined,
  }
  assert.equal(newRequestPrototypeSchema.safeParse(requestToPrototypeFormValues(legacy)).success, false)
  const parsed = requestAdministrativeEditSchema.parse({
    ...requestToPrototypeFormValues(legacy), priority: 'LOW', internalNotes: 'Legacy appointment note',
  })
  assert.deepEqual(parsed, { priority: 'LOW', internalNotes: 'Legacy appointment note' })
  const updated = updatePrototypeRequest(legacy, parsed)
  assert.equal(updated.internalNotes, 'Legacy appointment note')
  assert.equal(updated.workType, 'Woodwork')
  assert.equal(updated.crewSize, undefined)
  assert.strictEqual(updated.internalSlot, legacy.internalSlot)
  assert.throws(() => updatePrototypeRequest(legacy, { priority: 'URGENT', internalNotes: '' }))
  assert.throws(() => updatePrototypeRequest(legacy, { priority: 'LOW', internalNotes: 'x'.repeat(2001) }))
})
