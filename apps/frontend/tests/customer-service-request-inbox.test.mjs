import test from 'node:test'
import assert from 'node:assert/strict'
import customerServiceMockDatabase from '../src/features/customer-service/data/customerServiceMockDatabase.js'
import {
  newRequestPrototypeSchema,
  requestToPrototypeFormValues,
  updatePrototypeRequest,
} from '../src/features/customer-service/utils/newRequestPrototype.js'
import {
  buildRequestReviewSummary,
  canEditRequestInView,
  defaultProposalStage,
  filterAndSortRequestInbox,
  findRequestForView,
  customerServiceViewFromPath,
  customerServiceViewPaths,
  inboxFilterOptions,
  inboxPageSizeOptions,
  isRequestOverdue,
  markRequestReadyToPropose,
  paginateRequestInbox,
  proposalFilterOptions,
  proposalWorkspacePath,
  requestLocationLabel,
  requestPropertyLabel,
  requestsForView,
  summarizeRequestInbox,
} from '../src/features/customer-service/utils/requestInbox.js'

const requests = customerServiceMockDatabase.requests

test('Proposal Workspace never permits editing, including its full request dialog', () => {
  for (const request of requests) {
    assert.equal(canEditRequestInView(request, 'PROPOSALS'), false)
    assert.equal(canEditRequestInView(request, 'REQUESTS'), ['NEEDS_REVIEW', 'READY_TO_PROPOSE'].includes(request.workflowStage))
    assert.equal(canEditRequestInView(request, 'CALENDAR'), ['CONFIRMED', 'COMPLETED'].includes(request.workflowStage))
  }
  assert.equal(canEditRequestInView(null, 'REQUESTS'), false)
})

test('request inbox summary reflects the mock workflow', () => {
  assert.deepEqual(summarizeRequestInbox(requests), {
    needsReview: 1,
    readyToPropose: 1,
  })
})

test('ready mock requests have the complete information required by review', () => {
  requests.filter((request) => request.workflowStage === 'READY_TO_PROPOSE').forEach((request) => {
    assert.equal(buildRequestReviewSummary(request).isComplete, true)
    assert.equal(request.review.valtrimItemsConfirmed, true)
  })
})

test('request inbox searches only the review queue; proposals search their own queue', () => {
  const matches = filterAndSortRequestInbox(requests, { search: 'Brookfield' })

  assert.equal(matches.length, 1)
  assert.ok(matches.every((request) => request.workflowStage === 'READY_TO_PROPOSE'))
  assert.equal(filterAndSortRequestInbox(requests, { search: 'Magnolia' }).length, 0)
  assert.equal(filterAndSortRequestInbox(requests, { view: 'PROPOSALS', search: 'Magnolia' }).length, 2)
})

test('a request without lot uses its optional address as the location label', () => {
  const request = {
    ...requests[0],
    workflowStage: 'NEEDS_REVIEW',
    address: '1450 W Citrus St, Riverside, CA',
    lotNumber: undefined,
  }

  assert.equal(
    requestLocationLabel(request),
    'Magnolia at Arcadia · 1450 W Citrus St, Riverside, CA',
  )
  assert.equal(
    requestPropertyLabel(request),
    'Magnolia Homes · Magnolia at Arcadia · 1450 W Citrus St, Riverside, CA',
  )
  assert.deepEqual(
    filterAndSortRequestInbox([request], { search: 'Citrus' }),
    [request],
  )
})

test('review inbox prioritizes review before proposal preparation', () => {
  const matches = filterAndSortRequestInbox(requests, {
    sortBy: 'ACTION_REQUIRED',
  })

  assert.deepEqual(
    matches.map((request) => request.workflowStage),
    ['NEEDS_REVIEW', 'READY_TO_PROPOSE'],
  )
})

test('community and priority filters can be combined', () => {
  const matches = filterAndSortRequestInbox(requests, {
    view: 'PROPOSALS',
    area: 'Cielo',
    priority: 'MEDIUM',
  })

  assert.equal(matches.length, 1)
  assert.ok(matches.every((request) => request.community === 'Cielo'))
})

test('Requests exposes exactly two stages and All never exposes later workflow phases', () => {
  assert.deepEqual(inboxFilterOptions.map(({ value }) => value), ['all', 'NEEDS_REVIEW', 'READY_TO_PROPOSE'])
  assert.equal(filterAndSortRequestInbox(requests).length, 2)
  for (const stage of ['AWAITING_CUSTOMER', 'NEEDS_CONTACT', 'CONFIRMED', 'COMPLETED', 'OVERDUE']) {
    assert.deepEqual(filterAndSortRequestInbox(requests, { stage }), [])
  }
  assert.equal(filterAndSortRequestInbox(requests, { stage: 'NEEDS_REVIEW' }).length, 1)
  assert.equal(filterAndSortRequestInbox(requests, { stage: 'READY_TO_PROPOSE' }).length, 1)
})

test('proposal queue includes ready, awaiting and contact requests without changing their stages', () => {
  const before = structuredClone(requests)
  const queue = filterAndSortRequestInbox(requests, { view: 'PROPOSALS' })
  assert.deepEqual(proposalFilterOptions.map(({ value }) => value), ['all', 'READY_TO_PROPOSE', 'AWAITING_CUSTOMER', 'NEEDS_CONTACT'])
  assert.deepEqual(queue.map(({ workflowStage }) => workflowStage), ['NEEDS_CONTACT', 'NEEDS_CONTACT', 'READY_TO_PROPOSE', 'AWAITING_CUSTOMER'])
  const ready = requests.find((request) => request.workflowStage === 'READY_TO_PROPOSE')
  assert.equal(requestsForView(requests).find((request) => request.id === ready.id), ready)
  assert.equal(queue.find((request) => request.id === ready.id), ready)
  assert.deepEqual(requests, before)
})

test('Workspace starts with ready requests; contact and awaiting are explicit follow-up filters', () => {
  assert.equal(defaultProposalStage, 'READY_TO_PROPOSE')
  const initial = filterAndSortRequestInbox(requests, { view: 'PROPOSALS', stage: defaultProposalStage })
  assert.deepEqual(initial.map(({ requestNumber }) => requestNumber), ['CS-1061'])
  assert.ok(initial.every((request) => request.workflowStage === 'READY_TO_PROPOSE'))
  assert.ok(filterAndSortRequestInbox(requests, { view: 'PROPOSALS', stage: 'NEEDS_CONTACT' })
    .some((request) => request.requestNumber === 'CS-1059'))
  assert.deepEqual(filterAndSortRequestInbox(requests, { view: 'PROPOSALS', stage: 'NEEDS_REVIEW' }), [])
})

test('Workspace fixtures have completed review data and a reason for their current phase', () => {
  for (const request of requestsForView(requests, 'PROPOSALS')) {
    assert.equal(buildRequestReviewSummary(request).isComplete, true, request.requestNumber)
    assert.equal(request.review?.valtrimItemsConfirmed, true, request.requestNumber)
    assert.ok(request.review.completedAt)
    if (request.workflowStage === 'NEEDS_CONTACT') assert.equal(request.customerNeedsContact, true)
    if (request.workflowStage === 'AWAITING_CUSTOMER') {
      assert.equal(request.confirmationStatus, 'Proposal sent')
      assert.ok(request.customerWindow)
    }
    if (request.workflowStage === 'READY_TO_PROPOSE') {
      assert.equal(request.customerNeedsContact, false)
      assert.equal(request.customerWindow, null)
    }
  }
  const overdue = requests.find((request) => request.id === 'mock-1058')
  assert.equal(overdue.workflowStage, 'NEEDS_CONTACT')
  assert.equal(isRequestOverdue(overdue), true)
  assert.ok(requests.every((request) => request.workflowStage !== 'OVERDUE'))
})

test('list, selection and detail resolve the same current phase for each view', () => {
  const reviewed = requests.find((request) => request.workflowStage === 'READY_TO_PROPOSE')
  assert.strictEqual(findRequestForView(requests, reviewed.id, 'PROPOSALS'), reviewed)
  assert.strictEqual(findRequestForView(requests, reviewed.id, 'REQUESTS'), reviewed)
  const pending = { ...reviewed, workflowStage: 'NEEDS_REVIEW' }
  const changed = requests.map((request) => request.id === reviewed.id ? pending : request)
  assert.equal(findRequestForView(changed, reviewed.id, 'PROPOSALS'), null)
  assert.strictEqual(findRequestForView(changed, reviewed.id, 'REQUESTS'), pending)
  for (const request of requestsForView(requests, 'CALENDAR')) {
    assert.ok(['CONFIRMED', 'COMPLETED'].includes(request.workflowStage))
    assert.equal(findRequestForView(requests, request.id, 'PROPOSALS'), null)
    assert.strictEqual(findRequestForView(requests, request.id, 'CALENDAR'), request)
  }
  assert.equal(findRequestForView(requests, null, 'PROPOSALS'), null)
  assert.equal(findRequestForView(requests, 'unknown', 'PROPOSALS'), null)
})

test('overdue is an additional flag and does not displace the actual request phase', () => {
  for (const workflowStage of ['NEEDS_REVIEW', 'READY_TO_PROPOSE', 'AWAITING_CUSTOMER', 'CONFIRMED', 'NEEDS_CONTACT']) {
    const request = { workflowStage, dueOn: '2026-10-11' }
    assert.equal(isRequestOverdue(request, '2026-10-12'), true)
    assert.equal(request.workflowStage, workflowStage)
  }
  assert.equal(isRequestOverdue({ workflowStage: 'NEEDS_REVIEW', dueOn: '2026-10-12' }, '2026-10-12'), false)
  assert.equal(isRequestOverdue({ workflowStage: 'READY_TO_PROPOSE', dueOn: '2026-10-13' }, '2026-10-12'), false)
  assert.equal(isRequestOverdue({ workflowStage: 'COMPLETED', dueOn: '2026-10-01' }, '2026-10-12'), false)
  assert.equal(isRequestOverdue({ workflowStage: 'CLOSED', dueOn: '2026-10-01' }, '2026-10-12'), false)
  assert.equal(isRequestOverdue({ workflowStage: 'NEEDS_REVIEW' }, '2026-10-12'), false)
  assert.equal(isRequestOverdue({ workflowStage: 'NEEDS_REVIEW', dueOn: 'invalid' }, '2026-10-12'), false)
  assert.equal(isRequestOverdue({ workflowStage: 'OVERDUE' }, '2026-10-12'), true)
})

test('view navigation uses distinct routes and preserves a selected request safely in the URL', () => {
  for (const [view, path] of Object.entries(customerServiceViewPaths)) {
    assert.equal(customerServiceViewFromPath(path), view)
    assert.equal(customerServiceViewFromPath(`${path}/`), view)
  }
  const path = proposalWorkspacePath('test id/?&')
  const parsed = new URL(path, 'http://localhost')
  assert.equal(parsed.pathname, customerServiceViewPaths.PROPOSALS)
  assert.equal(parsed.searchParams.get('request'), 'test id/?&')
})

test('request inbox pagination supports 10, 15 and 20 rows', () => {
  const fixture = Array.from({ length: 32 }, (_, index) => ({ id: index + 1 }))

  assert.deepEqual(inboxPageSizeOptions, [10, 15, 20])
  assert.deepEqual(
    paginateRequestInbox(fixture, 1, 10).items.map((item) => item.id),
    [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  )
  assert.equal(paginateRequestInbox(fixture, 1, 15).items.length, 15)
  assert.equal(paginateRequestInbox(fixture, 1, 20).items.length, 12)
})

test('request inbox pagination clamps invalid page and row values', () => {
  const fixture = Array.from({ length: 12 }, (_, index) => ({ id: index + 1 }))
  const result = paginateRequestInbox(fixture, 99, 12)

  assert.equal(result.rowsPerPage, 10)
  assert.equal(result.page, 1)
  assert.deepEqual(result.items.map((item) => item.id), [11, 12])
})

test('review summary identifies complete and incomplete request information', () => {
  const completeRequest = {
    ...requests.find((request) => request.workflowStage === 'NEEDS_REVIEW'),
    serviceTask: 'GENERAL_FIX',
    crewSize: 1,
    requestedWorkItems: [{ description: 'Adjust the bedroom door.' }],
    extractionReviewNotes: ['Service task inferred as General fix.'],
  }
  const completeReview = buildRequestReviewSummary(completeRequest)

  assert.equal(completeReview.isComplete, true)
  assert.equal(completeReview.completedCount, 4)
  assert.deepEqual(completeReview.warnings, ['Service task inferred as General fix.'])

  const incompleteReview = buildRequestReviewSummary({
    ...completeRequest,
    contactPhone: '',
    contactEmail: '',
    address: '',
    latitude: null,
    longitude: null,
  })

  assert.equal(incompleteReview.isComplete, false)
  assert.deepEqual(
    incompleteReview.checks.filter((check) => !check.complete).map((check) => check.id),
    ['customer', 'property'],
  )
})

test('review rejects invalid values and every empty item, not only wholly empty requests', () => {
  const request = requests.find((entry) => entry.workflowStage === 'NEEDS_REVIEW')
  const invalidValues = [
    { contactEmail: 'not-an-email' },
    { contactPhone: '123' },
    { contactName: '1234' },
    { serviceTask: '' },
    { workType: 'Unsupported' },
    { latitude: 91, longitude: 0 },
    { estimatedDurationMinutes: 14 },
    { estimatedDurationMinutes: 721 },
    { crewSize: 1.5 },
    { crewSize: 11 },
    { requestedWorkItems: [{ description: 'Valid item' }, { description: ' ' }] },
    { requestedWorkItems: [] },
  ]
  invalidValues.forEach((values) => {
    const invalid = { ...request, ...values }
    const summary = buildRequestReviewSummary(invalid)
    assert.equal(summary.isComplete, false)
    assert.ok(summary.completedCount < 4)
    assert.throws(() => markRequestReadyToPropose(invalid, { valtrimItemsConfirmed: true }), /Complete all/)
  })
})

test('AI warnings are deduplicated and informative, and approval preserves request identity', () => {
  const request = {
    ...requests.find((entry) => entry.workflowStage === 'NEEDS_REVIEW'),
    extractionReviewNotes: ['Confirm inferred task.', 'Confirm inferred task.'],
    aiReviewWarnings: ['Check source.', ''],
  }
  const ready = markRequestReadyToPropose(request, { valtrimItemsConfirmed: true })
  assert.equal(ready.id, request.id)
  assert.equal(ready.requestNumber, request.requestNumber)
  assert.equal(ready.review.warningCount, 2)
  assert.equal(request.workflowStage, 'NEEDS_REVIEW')
  assert.throws(() => markRequestReadyToPropose(ready, { valtrimItemsConfirmed: true }), /Only requests/)
})

test('mark ready to propose requires complete data and Valtrim confirmation', () => {
  const request = {
    ...requests.find((entry) => entry.workflowStage === 'NEEDS_REVIEW'),
    serviceTask: 'GENERAL_FIX',
    crewSize: 1,
    requestedWorkItems: [{ description: 'Adjust the bedroom door.' }],
  }

  assert.throws(
    () => markRequestReadyToPropose(request),
    /Confirm that the requested work items belong to Valtrim/,
  )

  const reviewed = markRequestReadyToPropose(request, {
    reviewedBy: 'Anelda Calvillo',
    reviewedAt: new Date('2026-10-08T15:00:00.000Z'),
    valtrimItemsConfirmed: true,
  })

  assert.equal(reviewed.workflowStage, 'READY_TO_PROPOSE')
  assert.equal(reviewed.confirmationStatus, 'Ready for proposal')
  assert.equal(reviewed.review.valtrimItemsConfirmed, true)
  assert.equal(reviewed.activity.at(-1).label, 'Request reviewed')
})

test('review and edit transitions update both queues without duplicating or losing the source', () => {
  const sourceDocument = {
    sourceType: 'PDF',
    file: new File(['%PDF-1.4'], 'source.pdf', { type: 'application/pdf' }),
    extraction: { text: 'Original work order', structuredData: { schemaVersion: '1.0' } },
  }
  const original = {
    ...requests.find((request) => request.workflowStage === 'NEEDS_REVIEW'),
    sourceDocument,
  }
  let collection = [original]
  const replace = (updated) => {
    collection = collection.map((request) => request.id === updated.id ? updated : request)
    assert.equal(collection.length, 1)
    assert.equal(collection[0].requestNumber, original.requestNumber)
    assert.strictEqual(collection[0].sourceDocument, sourceDocument)
  }

  assert.equal(requestsForView(collection, 'PROPOSALS').length, 0)
  const ready = markRequestReadyToPropose(original, { valtrimItemsConfirmed: true })
  replace(ready)
  assert.strictEqual(requestsForView(collection)[0], requestsForView(collection, 'PROPOSALS')[0])

  const administrative = updatePrototypeRequest(ready, newRequestPrototypeSchema.parse({
    ...requestToPrototypeFormValues(ready), internalNotes: 'Coordinator note',
  }))
  replace(administrative)
  assert.equal(requestsForView(collection, 'PROPOSALS').length, 1)
  assert.equal(administrative.workflowStage, 'READY_TO_PROPOSE')

  const changed = updatePrototypeRequest(administrative, newRequestPrototypeSchema.parse({
    ...requestToPrototypeFormValues(administrative), estimatedDurationMinutes: '75',
  }))
  replace(changed)
  assert.equal(changed.workflowStage, 'NEEDS_REVIEW')
  assert.equal(requestsForView(collection, 'PROPOSALS').length, 0)
  assert.equal(requestsForView(collection)[0].estimatedDurationMinutes, 75)
  assert.equal(changed.internalNotes, 'Coordinator note')
  assert.equal(changed.requestedWorkItems.length, original.requestedWorkItems.length)
})
