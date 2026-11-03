import { z } from 'zod'
import { serviceWorkTypeOptions } from '../data/workTypes.js'
import {
  getNationalPhoneNumber,
  getPhoneCountry,
  normalizePhoneNumber,
} from '../../../utils/phoneNumbers.js'
import { findCustomerServiceJob } from '../data/customerServiceJobCatalog.js'
import {
  calculateGeneralFixDuration,
  getServiceTask as getPrototypeServiceTask,
  serviceKindOptions,
  serviceTaskOptions as prototypeServiceTaskOptions,
} from './customerServicePlanning.js'
export { calculateGeneralFixDuration, getPrototypeServiceTask, serviceKindOptions, prototypeServiceTaskOptions }

const namePattern = /^[\p{L}\p{M}\s.'-]+$/u

export const requestAdministrativeEditSchema = z.object({
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  internalNotes: z.string().trim().max(2000, 'Use 2,000 characters or fewer.'),
})

export const completedRequestEditSchema = z.object({
  internalNotes: requestAdministrativeEditSchema.shape.internalNotes,
})

export function isRequestPlanningLocked(request) {
  return ['AWAITING_CUSTOMER', 'CONFIRMED', 'WORKING', 'COMPLETED'].includes(request?.workflowStage)
}

export const prototypeSourcePdfMaxBytes = 10 * 1024 * 1024
export const maxRequestedWorkItems = 25
export const maxRequestedWorkItemDescriptionCharacters = 1000

function requestedWorkItemId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  return `work-item-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createRequestedWorkItem({
  id = requestedWorkItemId(),
  itemNumber = '1',
  description = '',
  materialRequired = false,
  chargeable = false,
} = {}) {
  return {
    id,
    itemNumber: String(itemNumber),
    description,
    materialRequired,
    chargeable,
  }
}

export function validatePrototypeSourcePdf(file) {
  if (!file) return 'Drop one PDF file.'

  const name = String(file.name ?? '').trim()
  const type = String(file.type ?? '').toLowerCase()
  const size = Number(file.size ?? 0)
  const isPdf = type === 'application/pdf' || name.toLowerCase().endsWith('.pdf')

  if (!isPdf) return 'Only PDF files are allowed.'
  if (!Number.isFinite(size) || size <= 0) return 'The PDF file is empty.'
  if (size > prototypeSourcePdfMaxBytes) return 'The PDF must be 10 MB or smaller.'
  return ''
}

export function hasNewRequestSource({ sourceInputMode, sourcePdf, sourceEmailText = '' }) {
  return sourceInputMode === 'PDF'
    ? Boolean(sourcePdf)
    : sourceInputMode === 'EMAIL_TEXT' && Boolean(sourceEmailText.trim())
}

export function buildPrototypeSourceDocument({
  sourceInputMode,
  sourcePdf = null,
  sourceEmailText = '',
  sourceExtraction = null,
}) {
  if (!hasNewRequestSource({ sourceInputMode, sourcePdf, sourceEmailText })) return null

  return {
    sourceType: sourceInputMode,
    // Keep the File in session memory, never a persisted or public URL.
    file: sourceInputMode === 'PDF' ? sourcePdf : null,
    extraction: sourceExtraction?.sourceType === sourceInputMode
      ? structuredClone(sourceExtraction)
      : null,
  }
}

function parseIsoDate(value) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function toIsoDate(value) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isValidIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value)
    && toIsoDate(parseIsoDate(value)) === value
}

export function calculatePrototypeDueDate(startDate, businessDays = 5) {
  if (!isValidIsoDate(startDate)) throw new Error('Enter a valid reported date.')
  const date = parseIsoDate(startDate)
  let counted = 0

  while (counted < businessDays) {
    date.setDate(date.getDate() + 1)
    const day = date.getDay()
    if (day >= 1 && day <= 5) counted += 1
  }

  return toIsoDate(date)
}

export function parsePrototypeCoordinates(value) {
  if (typeof value !== 'string') return null

  const parts = value.split(',').map((part) => part.trim())
  if (parts.length !== 2 || parts.some((part) => part === '')) return null

  const [latitude, longitude] = parts.map(Number)
  if (
    !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90
    || longitude < -180 || longitude > 180
  ) {
    return null
  }

  return { latitude, longitude }
}

const coordinatesSchema = z
  .string()
  .trim()
  .transform((value, context) => {
    if (!value) return null

    const coordinates = parsePrototypeCoordinates(value)
    if (!coordinates) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Paste latitude and longitude separated by a comma.',
      })
      return z.NEVER
    }
    return coordinates
  })

const durationSchema = z.preprocess(
  (value) => Number.isFinite(Number(value)) ? Number(value) : 0,
  z
    .number({ invalid_type_error: 'Enter the estimated duration.' })
    .int('Use complete minutes.')
    .min(15, 'Duration must be at least 15 minutes.')
    .max(720, 'Duration cannot exceed 720 minutes.'),
)

const crewSizeSchema = z.preprocess(
  (value) => Number.isFinite(Number(value)) ? Number(value) : 0,
  z
    .number({ invalid_type_error: 'Enter the required crew.' })
    .int('Use a whole number of people.')
    .min(1, 'At least one person is required.')
    .max(10, 'Crew cannot exceed 10 people.'),
)

function isServiceKind(value) {
  return serviceKindOptions.some((option) => option.value === value)
}

export const prototypeWorkTypeOptions = serviceWorkTypeOptions

function isPrototypeWorkType(value) {
  return prototypeWorkTypeOptions.some((option) => option.value === value)
}

export function renumberRequestedWorkItems(items) {
  return items.map((item, index) => ({
    ...item,
    itemNumber: String(index + 1),
  }))
}

function normalizedRequestedWorkDescription(value) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase()
}

export function findDuplicateRequestedWorkItemDescriptions(items) {
  const descriptions = new Map()

  items.forEach((item, index) => {
    const normalized = normalizedRequestedWorkDescription(item.description)
    if (!normalized) return

    const duplicate = descriptions.get(normalized) ?? {
      description: String(item.description).trim(),
      itemNumbers: [],
    }
    duplicate.itemNumbers.push(String(item.itemNumber || index + 1))
    descriptions.set(normalized, duplicate)
  })

  return [...descriptions.values()].filter((entry) => entry.itemNumbers.length > 1)
}

const newRequestFormFieldLabels = [
  ['reportedAt', 'Reported on'],
  ['priority', 'Priority'],
  ['builderName', 'Builder'],
  ['jobId', 'Project / Job'],
  ['community', 'Project / Job'],
  ['lotNumber', 'Lot #'],
  ['address', 'Address'],
  ['coordinates', 'Coordinates'],
  ['contactName', 'Customer name'],
  ['contactPhone', 'Customer phone'],
  ['contactEmail', 'Customer email'],
  ['additionalContactName', 'Additional customer name'],
  ['additionalContactPhone', 'Additional customer phone'],
  ['additionalContactEmail', 'Additional customer email'],
  ['serviceKind', 'Service kind'],
  ['workType', 'Work type'],
  ['serviceTask', 'Service task'],
  ['requestedWorkItems', 'Work items'],
  ['estimatedDurationMinutes', 'Estimated duration'],
  ['crewSize', 'Crew required'],
  ['internalNotes', 'Internal notes'],
  ['sourceEmailFrom', 'Source email sender'],
  ['sourceEmailSubject', 'Source email subject'],
]

function formErrorMessage(error) {
  return typeof error?.message === 'string' ? error.message : ''
}

export function summarizeNewRequestFormErrors(formErrors) {
  const summary = []

  const contactErrors = formErrors?.additionalContacts
  if (contactErrors?.message) {
    summary.push({ key: 'additionalContacts', fieldName: null, label: 'Additional customers', message: contactErrors.message })
  }
  if (Array.isArray(contactErrors)) contactErrors.forEach((contact, index) => {
    for (const [field, label] of [['name', 'name'], ['phone', 'phone'], ['email', 'email']]) {
      if (contact?.[field]?.message) summary.push({
        key: `additionalContacts.${index}.${field}`, fieldName: `additionalContacts.${index}.${field}`,
        label: `Customer ${index + 2} ${label}`, message: contact[field].message,
      })
    }
  })

  newRequestFormFieldLabels.forEach(([fieldName, label]) => {
    const fieldError = formErrors?.[fieldName]
    if (!fieldError) return

    if (fieldName !== 'requestedWorkItems') {
      const message = formErrorMessage(fieldError)
      if (message) {
        summary.push({
          key: fieldName,
          fieldName,
          label,
          message,
        })
      }
      return
    }

    const arrayMessage = formErrorMessage(fieldError)
    if (arrayMessage) {
      summary.push({
        key: fieldName,
        fieldName: null,
        label,
        message: arrayMessage,
      })
    }

    if (!Array.isArray(fieldError)) return
    fieldError.forEach((itemError, itemIndex) => {
      const nestedError = [
        itemError?.description,
        itemError?.itemNumber,
        itemError?.id,
        itemError?.materialRequired,
        itemError?.chargeable,
      ].find((error) => formErrorMessage(error))
      const message = formErrorMessage(nestedError)
      if (!message) return

      summary.push({
        key: `${fieldName}-${itemIndex}`,
        fieldName: null,
        itemIndex,
        label: `Work item ${itemIndex + 1}`,
        message,
      })
    })
  })

  return summary
}

const requestedWorkItemSchema = z.object({
  id: z.string().trim().min(1, 'The work item identifier is missing.'),
  itemNumber: z.string().regex(/^[1-9]\d*$/u, 'The work item number is invalid.'),
  description: z
    .string()
    .trim()
    .min(1, 'Describe this work item.')
    .max(
      maxRequestedWorkItemDescriptionCharacters,
      `Use ${maxRequestedWorkItemDescriptionCharacters.toLocaleString('en-US')} characters or fewer.`,
    ),
  materialRequired: z.boolean(),
  chargeable: z.boolean(),
})

function buildNewRequestSchema(allowIncomplete = false, importedReview = false, immutableEmailReference = false) {
  return z
  .object({
    reportedAt: z.string().refine((value) => (importedReview && !value) || isValidIsoDate(value), 'Enter a valid reported date.'),
    priority: requestAdministrativeEditSchema.shape.priority,
    builderName: importedReview ? z.string().trim() : z.string().trim().min(1, 'Choose a builder.'),
    jobId: z.string().trim().default(''),
    community: importedReview ? z.string().trim() : z.string().trim().min(1, 'Choose a Project / Job.'),
    lotNumber: z.string().trim().max(40, 'Use 40 characters or fewer.'),
    address: z.string().trim().max(importedReview || immutableEmailReference ? 240 : 250,
      `Use ${importedReview || immutableEmailReference ? 240 : 250} characters or fewer.`),
    coordinates: coordinatesSchema,
    contactName: z
      .string()
      .trim()
      .min(1, 'Enter the customer name.')
      .max(100, 'Use 100 characters or fewer.')
      .refine((value) => !value || namePattern.test(value), 'Enter a valid customer name.'),
    contactPhoneCountry: z.enum(['US', 'MX']).default('US'),
    contactPhone: z.string().trim(),
    additionalContacts: z.array(z.object({
      name: z.string().trim().max(100, 'Use 100 characters or fewer.')
        .refine((value) => !value || namePattern.test(value), 'Enter a valid customer name.').default(''),
      phoneCountry: z.enum(['US', 'MX']).default('US'),
      phone: z.string().trim().default(''),
      email: z.string().trim().max(160, 'Use 160 characters or fewer.')
        .refine((value) => !value || z.string().email().safeParse(value).success, 'Enter a valid email address.').default(''),
    })).max(2, 'A request supports up to three customers.').optional(),
    contactEmail: z
      .string()
      .trim()
      .max(160, 'Use 160 characters or fewer.')
      .refine((value) => !value || z.string().email().safeParse(value).success, 'Enter a valid email address.'),
    additionalContactName: z
      .string()
      .trim()
      .max(100, 'Use 100 characters or fewer.')
      .refine((value) => !value || namePattern.test(value), 'Enter a valid customer name.')
      .default(''),
    additionalContactPhoneCountry: z.enum(['US', 'MX']).default('US'),
    additionalContactPhone: z.string().trim().default(''),
    additionalContactEmail: z
      .string()
      .trim()
      .max(160, 'Use 160 characters or fewer.')
      .refine((value) => !value || z.string().email().safeParse(value).success, {
        message: 'Enter a valid email address.',
      })
      .default(''),
    serviceKind: z.string().refine((value) => (allowIncomplete && !value) || isServiceKind(value), 'Choose a service kind.'),
    workType: z.string().refine((value) => (allowIncomplete && !value) || isPrototypeWorkType(value), 'Choose a work type.'),
    serviceTask: z.string().refine(
      (value) => (allowIncomplete && !value) || Boolean(getPrototypeServiceTask(value)),
      'Choose a service task.',
    ),
    requestedWorkItems: z
      .array(allowIncomplete ? requestedWorkItemSchema.extend({
        description: z.string().trim().max(
          maxRequestedWorkItemDescriptionCharacters,
          `Use ${maxRequestedWorkItemDescriptionCharacters.toLocaleString('en-US')} characters or fewer.`,
        ),
      }) : requestedWorkItemSchema)
      .min(1, 'Add at least one work item.')
      .max(maxRequestedWorkItems, `Add no more than ${maxRequestedWorkItems} work items.`),
    estimatedDurationMinutes: allowIncomplete
      ? z.union([z.literal(''), durationSchema]).transform((value) => value === '' ? null : value)
      : durationSchema,
    crewSize: allowIncomplete
      ? z.union([z.literal(''), crewSizeSchema]).transform((value) => value === '' ? null : value)
      : crewSizeSchema,
    internalNotes: requestAdministrativeEditSchema.shape.internalNotes,
    sourceEmailFrom: importedReview || immutableEmailReference ? z.string() : z
      .string()
      .trim()
      .max(160, 'Use 160 characters or fewer.')
      .refine((value) => !value || z.string().email().safeParse(value).success, {
        message: 'Enter a valid email address.',
      }),
    sourceEmailSubject: importedReview || immutableEmailReference ? z.string() : z.string().trim().max(250, 'Use 250 characters or fewer.'),
  })
  .superRefine((data, context) => {
    if (!allowIncomplete && data.serviceTask === 'SHUTTER_REPLACEMENT' && data.crewSize < 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['crewSize'],
        message: 'Shutter replacement requires at least 2 people.',
      })
    }
    if (!importedReview && !data.coordinates) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['coordinates'],
        message: 'Select a Job with coordinates or enter valid coordinates.',
      })
    }

    if (allowIncomplete && data.requestedWorkItems.length > 0
      && !data.requestedWorkItems.some((item) => item.description.trim())) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requestedWorkItems', 0, 'description'],
        message: 'Describe at least one work item before saving for review.',
      })
    }

    data.requestedWorkItems.forEach((item, index) => {
      if (Number(item.itemNumber) !== index + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['requestedWorkItems', index, 'itemNumber'],
          message: 'Work item numbers must be consecutive.',
        })
      }
    })

    const phone = normalizePhoneNumber(data.contactPhone, data.contactPhoneCountry)
    if (data.contactPhone && !phone) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contactPhone'],
        message: 'Enter a 10-digit U.S. or Mexico phone number.',
      })
    }
    if (!importedReview && !phone && !data.contactEmail) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contactPhone'],
        message: 'Enter a customer phone or email.',
      })
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contactEmail'],
        message: 'Enter a customer email or phone.',
      })
    }

    for (const [index, contact] of (data.additionalContacts ?? []).entries()) {
      const phone = normalizePhoneNumber(contact.phone, contact.phoneCountry)
      if (!allowIncomplete && !contact.name) context.addIssue({
        code: z.ZodIssueCode.custom, path: ['additionalContacts', index, 'name'], message: 'Enter the customer name.',
      })
      if (contact.phone && !phone) context.addIssue({
        code: z.ZodIssueCode.custom, path: ['additionalContacts', index, 'phone'], message: 'Enter a 10-digit U.S. or Mexico phone number.',
      })
      if (!allowIncomplete && !phone && !contact.email) context.addIssue({
        code: z.ZodIssueCode.custom, path: ['additionalContacts', index, 'phone'], message: 'Enter a customer phone or email.',
      })
    }
    const hasAdditionalContact = data.additionalContacts === undefined && Boolean(
      data.additionalContactName
      || data.additionalContactPhone
      || data.additionalContactEmail,
    )
    if (hasAdditionalContact) {
      const additionalPhone = normalizePhoneNumber(
        data.additionalContactPhone,
        data.additionalContactPhoneCountry,
      )
      if (!allowIncomplete && !data.additionalContactName) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['additionalContactName'],
          message: 'Enter the additional customer name.',
        })
      }
      if (data.additionalContactPhone && !additionalPhone) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['additionalContactPhone'],
          message: 'Enter a 10-digit U.S. or Mexico phone number.',
        })
      }
      if (!allowIncomplete && !additionalPhone && !data.additionalContactEmail) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['additionalContactPhone'],
          message: 'Enter a phone number or email for the additional customer.',
        })
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['additionalContactEmail'],
          message: 'Enter an email or phone number for the additional customer.',
        })
      }
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (data.reportedAt && parseIsoDate(data.reportedAt) > today) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reportedAt'],
        message: 'The reported date cannot be in the future.',
      })
    }

  })
  .transform((data) => {
    const {
      contactPhoneCountry,
      additionalContactName,
      additionalContactPhoneCountry,
      additionalContactPhone,
      additionalContactEmail,
      additionalContacts: formContacts,
      coordinates,
      ...request
    } = data
    const additionalContacts = formContacts !== undefined
      ? formContacts.filter((contact) => contact.name || contact.phone || contact.email).map((contact) => ({
        name: contact.name, phone: normalizePhoneNumber(contact.phone, contact.phoneCountry) || '',
        email: contact.email.toLowerCase(),
      }))
      : additionalContactName || additionalContactPhone || additionalContactEmail
      ? [{
        name: additionalContactName,
        phone: normalizePhoneNumber(additionalContactPhone, additionalContactPhoneCountry),
        email: additionalContactEmail.toLowerCase(),
      }]
      : []

    return {
      ...request,
      description: data.requestedWorkItems
        .map((item) => item.description)
        .join('\n'),
      ...(coordinates ?? { latitude: null, longitude: null }),
      contactPhone: normalizePhoneNumber(data.contactPhone, contactPhoneCountry) || '',
      contactEmail: data.contactEmail.toLowerCase(),
      additionalContacts,
    }
  })
}

// Drafts require the agreed capture fields and described work. Approval also requires planning data.
export const newRequestPrototypeSchema = buildNewRequestSchema()
export const newRequestDraftSchema = buildNewRequestSchema(true)

// Existing imported requests and recovery linked to a registered import use
// this minimum. Ordinary manual creation and approval keep their validators.
export const importedRequestDraftSchema = buildNewRequestSchema(true, true)
export const importedRequestStandardEditSchema = buildNewRequestSchema(true, false, true)

export function canSavePartialImportedRequest(request) {
  return Boolean(request?.emailImportId) && request.workflowStage === 'NEEDS_REVIEW'
    && !isRequestPlanningLocked(request)
}

export function requestToPrototypeFormValues(request, builderOptions = []) {
  const primaryCountry = getPhoneCountry(request.contactPhone)
  const additionalContact = request.additionalContacts?.[0] ?? {}
  const additionalCountry = getPhoneCountry(additionalContact.phone)
  const canonicalOption = (options, value) => options.find((option) => (
    option.value.toLowerCase() === String(value ?? '').trim().toLowerCase()
  ))?.value ?? String(value ?? '')
  const hasCoordinates = request.latitude != null || request.longitude != null
  const catalogJob = findCustomerServiceJob(request, builderOptions)

  return {
    reportedAt: request.reportedAt ?? '',
    priority: request.priority ?? 'MEDIUM',
    builderName: request.builderName ?? '',
    jobId: request.jobId ?? catalogJob?.id ?? '',
    community: request.community ?? '',
    lotNumber: request.lotNumber ?? '',
    address: request.address ?? '',
    coordinates: hasCoordinates ? `${request.latitude ?? ''}, ${request.longitude ?? ''}` : '',
    contactName: request.contactName ?? '',
    contactPhoneCountry: primaryCountry,
    contactPhone: getNationalPhoneNumber(request.contactPhone, primaryCountry),
    contactEmail: request.contactEmail ?? '',
    additionalContacts: (request.additionalContacts ?? []).map((contact) => ({
      name: contact.name ?? '', email: contact.email ?? '',
      phoneCountry: getPhoneCountry(contact.phone),
      phone: getNationalPhoneNumber(contact.phone, getPhoneCountry(contact.phone)),
    })),
    additionalContactName: additionalContact.name ?? '',
    additionalContactPhoneCountry: additionalCountry,
    additionalContactPhone: getNationalPhoneNumber(additionalContact.phone, additionalCountry),
    additionalContactEmail: additionalContact.email ?? '',
    serviceKind: canonicalOption(serviceKindOptions, request.serviceKind),
    workType: canonicalOption(prototypeWorkTypeOptions, request.workType),
    serviceTask: request.serviceTask ?? '',
    requestedWorkItems: Array.isArray(request.requestedWorkItems)
      ? request.requestedWorkItems.map((item, index) => createRequestedWorkItem({
        id: `legacy-item-${request.id}-${index + 1}`,
        ...item,
        itemNumber: item.itemNumber ?? index + 1,
      }))
      : [createRequestedWorkItem({
        id: `legacy-item-${request.id}-1`,
        description: request.description || request.issue || '',
      })],
    estimatedDurationMinutes: request.estimatedDurationMinutes ?? '',
    crewSize: request.crewSize ?? '',
    internalNotes: request.internalNotes ?? '',
    sourceEmailFrom: request.sourceEmail?.from ?? '',
    sourceEmailSubject: request.sourceEmail?.subject ?? '',
  }
}

function nextRequestNumber(requests) {
  const highest = requests.reduce((current, request) => {
    const match = String(request.requestNumber ?? '').match(/(\d+)$/)
    return match ? Math.max(current, Number(match[1])) : current
  }, 1000)

  return `CS-${String(highest + 1).padStart(4, '0')}`
}

export function createPrototypeRequest(
  values,
  existingRequests,
  attachmentNames = [],
  createdAt = new Date(),
  coordinatorName = '',
  persistence = null,
) {
  const requestNumber = persistence?.folio ?? nextRequestNumber(existingRequests)
  const serviceTask = getPrototypeServiceTask(values.serviceTask)
  const persisted = Number.isSafeInteger(Number(persistence?.requestId))

  return {
    id: persisted
      ? Number(persistence.requestId)
      : `prototype-${requestNumber.toLowerCase()}-${createdAt.getTime()}`,
    requestNumber,
    coordinatorName,
    createdAt: persistence?.createdAt ?? createdAt.toISOString(),
    reportedAt: values.reportedAt,
    reportedAtSource: values.reportedAtSource ?? 'MANUAL',
    dueOn: persistence?.dueOn ?? calculatePrototypeDueDate(values.reportedAt),
    priority: values.priority,
    workflowStage: 'NEEDS_REVIEW',
    builderName: values.builderName,
    jobId: values.jobId ?? '',
    community: values.community,
    lotNumber: values.lotNumber,
    address: values.address,
    latitude: values.latitude,
    longitude: values.longitude,
    contactName: values.contactName,
    contactPhone: values.contactPhone,
    contactEmail: values.contactEmail,
    additionalContacts: values.additionalContacts,
    serviceKind: values.serviceKind,
    workType: values.workType,
    serviceTask: values.serviceTask,
    issue: serviceTask?.label ?? values.description.slice(0, 140),
    description: values.description,
    estimatedDurationMinutes: values.estimatedDurationMinutes,
    crewSize: values.crewSize,
    internalNotes: values.internalNotes,
    extractionReviewNotes: Array.isArray(values.extractionReviewNotes)
      ? values.extractionReviewNotes
      : [],
    sourceDocument: values.sourceDocument ?? null,
    customerWindow: null,
    technicianName: '',
    confirmationStatus: 'Not sent',
    customerUnavailableDates: [],
    customerNeedsContact: false,
    customerAvailabilityNotes: '',
    sourceEmail: {
      from: values.sourceEmailFrom,
      subject: values.sourceEmailSubject,
      receivedAt: createdAt.toISOString(),
      body: values.sourceEmailBody ?? '',
      pinned: false,
      forwardedToCrew: false,
      attachmentCount: attachmentNames.length,
      attachmentNames,
    },
    requestedWorkItems: Array.isArray(values.requestedWorkItems)
      ? values.requestedWorkItems
      : [],
    activity: [
      {
        id: 1,
        label: 'Request created',
        detail: persisted ? 'Saved in Supabase' : 'Saved in the frontend simulation',
        at: toIsoDate(createdAt),
      },
    ],
    prototypeOnly: !persisted,
  }
}

export function updatePrototypeRequest(
  request,
  values,
  attachmentNames,
  updatedAt = new Date(),
  coordinatorName = '',
) {
  if (isRequestPlanningLocked(request)) {
    // Only take administrative fields. Preserve the approved record and scheduling as-is,
    // including legacy values that the current creation schema no longer accepts.
    const administrativeValues = request.workflowStage === 'COMPLETED'
      ? completedRequestEditSchema.parse(values)
      : requestAdministrativeEditSchema.parse(values)
    return {
      ...request,
      ...administrativeValues,
      updatedAt: updatedAt.toISOString(),
      activity: [
        ...(request.activity ?? []),
        {
          id: `prototype-update-${updatedAt.getTime()}`,
          label: 'Request updated',
          detail: coordinatorName ? `Administrative fields edited by ${coordinatorName}` : 'Administrative fields edited',
          at: toIsoDate(updatedAt),
        },
      ],
      prototypeOnly: true,
    }
  }

  const serviceTask = getPrototypeServiceTask(values.serviceTask)
  const currentSourceEmail = request.sourceEmail ?? {}
  const hasReplacementAttachments = Array.isArray(attachmentNames)
  const nextAttachmentNames = hasReplacementAttachments
    ? attachmentNames
    : currentSourceEmail.attachmentNames ?? []

  const updatedRequest = {
    ...request,
    coordinatorName: coordinatorName || request.coordinatorName || '',
    reportedAt: values.reportedAt,
    reportedAtSource: values.reportedAtSource ?? request.reportedAtSource ?? 'MANUAL',
    dueOn: calculatePrototypeDueDate(values.reportedAt),
    priority: values.priority,
    builderName: values.builderName,
    jobId: values.jobId ?? request.jobId ?? '',
    community: values.community,
    lotNumber: values.lotNumber,
    address: values.address,
    latitude: values.latitude,
    longitude: values.longitude,
    contactName: values.contactName,
    contactPhone: values.contactPhone,
    contactEmail: values.contactEmail,
    additionalContacts: values.additionalContacts,
    serviceKind: values.serviceKind,
    workType: values.workType,
    serviceTask: values.serviceTask,
    issue: serviceTask?.label ?? values.description.slice(0, 140),
    description: values.description,
    estimatedDurationMinutes: values.estimatedDurationMinutes,
    crewSize: values.crewSize,
    internalNotes: values.internalNotes,
    extractionReviewNotes: Array.isArray(values.extractionReviewNotes)
      ? values.extractionReviewNotes
      : request.extractionReviewNotes ?? [],
    sourceEmail: {
      ...currentSourceEmail,
      from: values.sourceEmailFrom,
      subject: values.sourceEmailSubject,
      body: values.sourceEmailBody ?? currentSourceEmail.body ?? '',
      attachmentCount: hasReplacementAttachments
        ? nextAttachmentNames.length
        : currentSourceEmail.attachmentCount ?? nextAttachmentNames.length,
      attachmentNames: nextAttachmentNames,
    },
    requestedWorkItems: Array.isArray(values.requestedWorkItems)
      ? values.requestedWorkItems
      : [],
    updatedAt: updatedAt.toISOString(),
    activity: [
      ...(request.activity ?? []),
      {
        id: `prototype-update-${updatedAt.getTime()}`,
        label: 'Request updated',
        detail: coordinatorName ? `Edited by ${coordinatorName}` : 'Request details edited',
        at: toIsoDate(updatedAt),
      },
    ],
    prototypeOnly: true,
  }

  const scope = (record) => {
    const values = requestToPrototypeFormValues(record)
    return {
      builderName: values.builderName.trim(),
      jobId: values.jobId?.trim() ?? '',
      community: values.community.trim(),
      lotNumber: values.lotNumber.trim(),
      address: values.address.trim(),
      coordinates: parsePrototypeCoordinates(values.coordinates),
      serviceKind: values.serviceKind,
      workType: values.workType,
      serviceTask: values.serviceTask,
      items: values.requestedWorkItems.map((item) => ({
        description: item.description.trim(),
        materialRequired: item.materialRequired,
        chargeable: item.chargeable,
      })),
      duration: Number(record.estimatedDurationMinutes),
      crew: Number(record.crewSize),
    }
  }
  const requiresReview = request.workflowStage === 'READY_TO_PROPOSE' && (
    JSON.stringify(scope(request)) !== JSON.stringify(scope(updatedRequest))
    || !newRequestPrototypeSchema.safeParse(requestToPrototypeFormValues(updatedRequest)).success
  )

  if (requiresReview) {
    updatedRequest.workflowStage = 'NEEDS_REVIEW'
    updatedRequest.confirmationStatus = 'Not sent'
    updatedRequest.review = null
    updatedRequest.activity.push({
      id: `prototype-review-reset-${updatedAt.getTime()}`,
      label: 'Review required',
      detail: 'Approved location, work or planning changed, or required information is incomplete.',
      at: updatedAt.toISOString(),
    })
  }

  return updatedRequest
}
