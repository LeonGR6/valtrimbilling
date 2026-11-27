function optionalText(value) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function optionalPositiveInteger(value) {
  if (value === '' || value === null || value === undefined) return null
  const normalized = Number(value)
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null
}

function sourcePayload(values) {
  const sourceDocument = values.sourceDocument
  const senderEmail = optionalText(values.sourceEmailFrom)
  const subject = optionalText(values.sourceEmailSubject)
  if (!sourceDocument?.sourceType) {
    if (!senderEmail && !subject) return null
    return {
      sourceType: 'EMAIL_METADATA',
      senderEmail,
      subject,
      emailText: null,
      extractedText: null,
      extractionPayload: null,
      extractionModel: null,
      extractedAt: null,
      reviewNotes: [],
    }
  }

  const extraction = sourceDocument.extraction
  return {
    sourceType: sourceDocument.sourceType,
    senderEmail,
    subject,
    emailText: optionalText(values.sourceEmailBody),
    extractedText: optionalText(extraction?.text),
    extractionPayload: extraction?.structuredData ?? null,
    extractionModel: optionalText(extraction?.model),
    extractedAt: null,
    reviewNotes: Array.isArray(values.extractionReviewNotes)
      ? values.extractionReviewNotes.map(String)
      : [],
  }
}

export function createCustomerServiceSubmissionKey() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function toCustomerServiceIntakePayload(values) {
  const describedItems = (values.requestedWorkItems ?? [])
    .filter((item) => String(item.description ?? '').trim())

  const contacts = [{
    role: 'PRIMARY',
    name: values.contactName,
    email: optionalText(values.contactEmail),
    phone: optionalText(values.contactPhone),
  }]
  for (const contact of values.additionalContacts ?? []) {
    if (!contact?.name && !contact?.email && !contact?.phone) continue
    contacts.push({
      role: 'ADDITIONAL',
      name: contact.name,
      email: optionalText(contact.email),
      phone: optionalText(contact.phone),
    })
  }

  return {
    property: {
      jobId: optionalText(values.jobId) == null ? null : Number(values.jobId),
      lotNumber: optionalText(values.lotNumber),
      address: optionalText(values.address),
      latitude: values.latitude,
      longitude: values.longitude,
    },
    request: {
      reportedOn: values.reportedAt,
      reportedOnSource: values.reportedAtSource ?? 'MANUAL',
      priority: values.priority,
      serviceKind: optionalText(values.serviceKind),
      workCategory: optionalText(values.workType),
      serviceTask: optionalText(values.serviceTask),
      estimatedDurationMinutes: optionalPositiveInteger(values.estimatedDurationMinutes),
      crewSize: optionalPositiveInteger(values.crewSize),
      internalNotes: optionalText(values.internalNotes),
    },
    contacts,
    items: describedItems.map((item, index) => ({
      itemNumber: index + 1,
      description: String(item.description).trim(),
      materialRequired: Boolean(item.materialRequired),
      chargeable: Boolean(item.chargeable),
    })),
    source: sourcePayload(values),
  }
}

export function toCustomerServiceIntakeEditPayload(request, values) {
  if (['AWAITING_CUSTOMER', 'CONFIRMED', 'WORKING', 'COMPLETED'].includes(request.workflowStage)) {
    return { request: {
      ...(request.workflowStage !== 'COMPLETED' && { priority: values.priority }),
      internalNotes: optionalText(values.internalNotes),
    } }
  }
  const { property, request: fields, contacts, items } = toCustomerServiceIntakePayload(values)
  return { property, request: fields, contacts, items }
}

export function toCustomerServiceEmailRecoveryPayload(values) {
  const { source, ...payload } = toCustomerServiceIntakePayload(values)
  if (values.sourceDocument && values.sourceDocument.sourceType !== 'PDF') {
    throw new Error('Recovery accepts a valid PDF or manual entry without a file.')
  }
  return { payload, source: source?.sourceType === 'PDF' ? {
    sourceType: 'PDF', extractedText: source.extractedText,
    extractionPayload: source.extractionPayload, extractionModel: source.extractionModel,
    reviewNotes: source.reviewNotes,
  } : null }
}
