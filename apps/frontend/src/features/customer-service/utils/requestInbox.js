import {
  newRequestPrototypeSchema,
  requestToPrototypeFormValues,
} from './newRequestPrototype.js'
import { getCustomerServiceClock } from './dates.js'

export const requestViewStages = {
  REQUESTS: ['NEEDS_REVIEW', 'READY_TO_PROPOSE'],
  PROPOSALS: ['READY_TO_PROPOSE', 'AWAITING_CUSTOMER', 'NEEDS_CONTACT'],
  CALENDAR: ['CONFIRMED', 'COMPLETED'],
}

export const defaultProposalStage = 'READY_TO_PROPOSE'

export const customerServiceViewPaths = {
  REQUESTS: '/customer-service',
  PROPOSALS: '/customer-service/proposals',
  CALENDAR: '/customer-service/calendar',
}

export function customerServiceViewFromPath(pathname) {
  return Object.keys(customerServiceViewPaths)
    .find((view) => customerServiceViewPaths[view] === pathname.replace(/\/$/u, '')) ?? 'REQUESTS'
}

export function proposalWorkspacePath(requestId) {
  return `${customerServiceViewPaths.PROPOSALS}?request=${encodeURIComponent(requestId)}`
}

export const requestWorkflowStages = {
  NEEDS_REVIEW: {
    label: 'Needs review',
    color: 'warning',
    nextAction: 'Review request',
  },
  READY_TO_PROPOSE: {
    label: 'Ready to propose',
    color: 'info',
    nextAction: 'Open Proposal Workspace',
  },
  AWAITING_CUSTOMER: {
    label: 'Awaiting customer',
    color: 'secondary',
    nextAction: 'View proposal',
  },
  CONFIRMED: {
    label: 'Confirmed',
    color: 'success',
    nextAction: 'View confirmation',
  },
  NEEDS_CONTACT: {
    label: 'Needs contact',
    color: 'warning',
    nextAction: 'Contact customer',
  },
  OVERDUE: {
    label: 'Overdue',
    color: 'error',
    nextAction: 'Resolve overdue request',
  },
  COMPLETED: {
    label: 'Completed',
    color: 'neutral',
    nextAction: 'View completed request',
  },
}

export const inboxFilterOptions = [
  { value: 'all', label: 'All requests' },
  { value: 'NEEDS_REVIEW', label: 'Needs review' },
  { value: 'READY_TO_PROPOSE', label: 'Ready to propose' },
]

export const proposalFilterOptions = [
  { value: 'all', label: 'All proposals' },
  { value: 'READY_TO_PROPOSE', label: 'Ready to propose' },
  { value: 'AWAITING_CUSTOMER', label: 'Awaiting customer' },
  { value: 'NEEDS_CONTACT', label: 'Needs contact' },
]

export const inboxSortOptions = [
  { value: 'ACTION_REQUIRED', label: 'Action required' },
  { value: 'DUE_DATE', label: 'Due date' },
  { value: 'NEWEST', label: 'Newest first' },
]

export const inboxPageSizeOptions = [10, 15, 20]

export function effectiveRequestWorkflowStage(request) {
  return request?.workflowStage || 'NEEDS_REVIEW'
}

export function requestsForView(requests, view = 'REQUESTS') {
  const stages = requestViewStages[view] ?? []
  return requests.filter((request) => stages.includes(effectiveRequestWorkflowStage(request)))
}

// Resolve the current record, not a saved dialog snapshot from another workflow phase.
export function findRequestForView(requests, requestId, view = 'REQUESTS') {
  if (requestId == null) return null
  return requestsForView(requests, view)
    .find((request) => String(request.id) === String(requestId)) ?? null
}

export function canEditRequestInView(request, view = 'REQUESTS') {
  return Boolean(request) && view !== 'PROPOSALS'
    && requestsForView([request], view).length > 0
}

export function isRequestOverdue(request, today = getCustomerServiceClock().date) {
  const stage = effectiveRequestWorkflowStage(request)
  if (['COMPLETED', 'CLOSED'].includes(stage)) return false
  return stage === 'OVERDUE'
    || (typeof request.dueOn === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(request.dueOn)
      && request.dueOn < today)
}

function hasText(value) {
  return Boolean(String(value ?? '').trim())
}

export function buildRequestReviewSummary(request) {
  const formValues = requestToPrototypeFormValues(request)
  // Imported metadata is an immutable external reference, not an editable
  // business requirement. An original long subject must not prevent approval.
  const validation = newRequestPrototypeSchema.safeParse(request.emailImportId
    ? { ...formValues, sourceEmailFrom: '', sourceEmailSubject: '' }
    : formValues)
  const issues = validation.success ? [] : validation.error.issues
  if (request.prototypeOnly === false && !/^[1-9][0-9]*$/.test(String(request.jobId ?? ''))) {
    issues.push({ path: ['jobId'], message: 'Select an active Project / Job before approving.' })
  }
  const checks = [
    {
      id: 'customer',
      label: 'Customer information',
      fields: ['contactName', 'contactPhoneCountry', 'contactPhone', 'contactEmail',
        'additionalContacts',
        'additionalContactName', 'additionalContactPhoneCountry', 'additionalContactPhone',
        'additionalContactEmail', 'sourceEmailFrom', 'sourceEmailSubject'],
      completeDetail: 'Customer name and at least one contact method are available.',
    },
    {
      id: 'property',
      label: 'Property and location',
      fields: ['builderName', 'jobId', 'community', 'lotNumber', 'address', 'coordinates'],
      completeDetail: 'Builder, Project / Job and coordinates are available.',
    },
    {
      id: 'work',
      label: 'Service scope',
      fields: ['serviceKind', 'workType', 'serviceTask', 'requestedWorkItems'],
      completeDetail: 'Service classification and requested work are available.',
    },
    {
      id: 'planning',
      label: 'Duration and crew',
      fields: ['reportedAt', 'priority', 'estimatedDurationMinutes', 'crewSize', 'internalNotes'],
      completeDetail: 'Estimated duration and crew size are available.',
    },
  ].map((check) => {
    const fieldIssues = new Map()
    issues.filter((issue) => check.fields.includes(issue.path[0])).forEach((issue) => {
      const field = issue.path.join('.')
      if (!fieldIssues.has(field)) fieldIssues.set(field, issue)
    })
    const messages = [...fieldIssues.values()]
      .map((issue) => issue.path[0] === 'requestedWorkItems' && typeof issue.path[1] === 'number'
        ? `Item ${issue.path[1] + 1}: ${issue.message}`
        : issue.message)
    return {
      ...check,
      complete: messages.length === 0,
      incompleteDetail: messages.join(' '),
    }
  })
  const warnings = [
    ...(Array.isArray(request.extractionReviewNotes) ? request.extractionReviewNotes : []),
    ...(Array.isArray(request.aiReviewWarnings) ? request.aiReviewWarnings : []),
  ].filter(hasText)

  return {
    checks,
    completedCount: checks.filter((check) => check.complete).length,
    isComplete: issues.length === 0,
    warnings: [...new Set(warnings)],
  }
}

export function markRequestReadyToPropose(
  request,
  {
    reviewedBy = '',
    reviewedAt = new Date(),
    valtrimItemsConfirmed = false,
  } = {},
) {
  if (effectiveRequestWorkflowStage(request) !== 'NEEDS_REVIEW') {
    throw new Error('Only requests that need review can be marked ready to propose.')
  }

  const review = buildRequestReviewSummary(request)
  if (!review.isComplete) {
    throw new Error('Complete all required request information before marking it ready.')
  }
  if (!valtrimItemsConfirmed) {
    throw new Error('Confirm that the requested work items belong to Valtrim.')
  }

  const reviewedAtValue = reviewedAt instanceof Date
    ? reviewedAt.toISOString()
    : new Date(reviewedAt).toISOString()

  return {
    ...request,
    workflowStage: 'READY_TO_PROPOSE',
    confirmationStatus: 'Ready for proposal',
    review: {
      completedAt: reviewedAtValue,
      completedBy: reviewedBy,
      valtrimItemsConfirmed: true,
      warningCount: review.warnings.length,
    },
    activity: [
      ...(request.activity ?? []),
      {
        id: `prototype-review-${new Date(reviewedAtValue).getTime()}`,
        label: 'Request reviewed',
        detail: reviewedBy
          ? `Marked ready to propose by ${reviewedBy}`
          : 'Marked ready to propose',
        at: reviewedAtValue,
      },
    ],
  }
}

export function paginateRequestInbox(requests, page = 0, rowsPerPage = 10) {
  const resolvedRowsPerPage = inboxPageSizeOptions.includes(rowsPerPage)
    ? rowsPerPage
    : inboxPageSizeOptions[0]
  const totalPages = Math.max(1, Math.ceil(requests.length / resolvedRowsPerPage))
  const resolvedPage = Math.min(
    Math.max(0, Math.floor(Number(page) || 0)),
    totalPages - 1,
  )
  const start = resolvedPage * resolvedRowsPerPage

  return {
    items: requests.slice(start, start + resolvedRowsPerPage),
    page: resolvedPage,
    rowsPerPage: resolvedRowsPerPage,
    totalPages,
  }
}

const actionRank = {
  OVERDUE: 0,
  NEEDS_CONTACT: 1,
  NEEDS_REVIEW: 2,
  READY_TO_PROPOSE: 3,
  AWAITING_CUSTOMER: 4,
  CONFIRMED: 5,
  COMPLETED: 6,
}

export function requestLocationLabel(request) {
  const locationDetail = request.address || (
    request.lotNumber ? `Lot ${request.lotNumber}` : ''
  )
  return [request.community, locationDetail].filter(Boolean).join(' · ')
}

export function requestPropertyLabel(request) {
  return [request.builderName, requestLocationLabel(request)]
    .filter(Boolean)
    .join(' · ')
}

function matchesStageFilter(request, filter) {
  if (filter === 'all') return true
  return effectiveRequestWorkflowStage(request) === filter
}

export function summarizeRequestInbox(requests) {
  return {
    needsReview: requests.filter(
      (request) => effectiveRequestWorkflowStage(request) === 'NEEDS_REVIEW',
    ).length,
    readyToPropose: requests.filter(
      (request) => effectiveRequestWorkflowStage(request) === 'READY_TO_PROPOSE',
    ).length,
  }
}

export function filterAndSortRequestInbox(
  requests,
  {
    search = '',
    stage = 'all',
    area = 'all',
    priority = 'all',
    sortBy = 'ACTION_REQUIRED',
    view = 'REQUESTS',
  } = {},
) {
  const query = search.trim().toLowerCase()
  const scopedRequests = requestsForView(requests, view)
  const matching = scopedRequests.filter((request) => {
    const searchable = [
      request.requestNumber,
      request.builderName,
      request.community,
      request.address,
      request.lotNumber,
      request.contactName,
      request.contactPhone,
      request.contactEmail,
      request.issue,
      request.description,
      request.serviceKind,
      request.sourceEmail?.subject,
      request.latitude,
      request.longitude,
    ]
      .filter((value) => value !== null && value !== undefined)
      .join(' ')
      .toLowerCase()

    return (
      (!query || searchable.includes(query)) &&
      matchesStageFilter(request, stage) &&
      (area === 'all' || request.community === area) &&
      (priority === 'all' || request.priority === priority)
    )
  })

  return matching.sort((left, right) => {
    if (sortBy === 'NEWEST') {
      return compareKnownDates(left.reportedAt, right.reportedAt, true)
    }
    if (sortBy === 'DUE_DATE') {
      return compareKnownDates(left.dueOn, right.dueOn)
    }
    return (
      actionRank[effectiveRequestWorkflowStage(left)]
        - actionRank[effectiveRequestWorkflowStage(right)] ||
      compareKnownDates(left.dueOn, right.dueOn) ||
      right.requestNumber.localeCompare(left.requestNumber, undefined, {
        numeric: true,
      })
    )
  })
}

function compareKnownDates(left, right, descending = false) {
  // Missing source dates are not today's date and do not imply a deadline.
  // Keep undated requests visible after known dates, without calling methods on null.
  if (!left || !right) return Number(Boolean(right)) - Number(Boolean(left))
  return descending ? right.localeCompare(left) : left.localeCompare(right)
}
