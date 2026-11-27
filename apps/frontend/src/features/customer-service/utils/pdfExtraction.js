import { suggestRequestPlanning } from './customerServicePlanning.js'
import {
  createRequestedWorkItem,
  parsePrototypeCoordinates,
  renumberRequestedWorkItems,
} from './newRequestPrototype.js'
import {
  getPhoneCountry,
  normalizePhoneNumber,
} from '../../../utils/phoneNumbers.js'
import { getCustomerServiceClock } from './dates.js'
import {
  customerServiceJobCoordinatesValue,
  resolveCustomerServiceBuilder,
  resolveCustomerServiceJob,
} from '../data/customerServiceJobCatalog.js'

const emailMonthNumbers = new Map([
  ['january', 1],
  ['february', 2],
  ['march', 3],
  ['april', 4],
  ['may', 5],
  ['june', 6],
  ['july', 7],
  ['august', 8],
  ['september', 9],
  ['october', 10],
  ['november', 11],
  ['december', 12],
])

function isoDateParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() + 1 !== month
    || date.getUTCDate() !== day
  ) return ''

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function outlookSentDate(value) {
  const normalized = text(value)
  const namedDate = normalized.match(
    /(?:[a-z]+,\s*)?([a-z]+)\s+(\d{1,2}),\s+(\d{4})/iu,
  )
  if (namedDate) {
    const month = emailMonthNumbers.get(namedDate[1].toLowerCase())
    if (month) return isoDateParts(Number(namedDate[3]), month, Number(namedDate[2]))
  }

  const numericDate = normalized.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/u)
  return numericDate
    ? isoDateParts(Number(numericDate[3]), Number(numericDate[1]), Number(numericDate[2]))
    : ''
}

function emails(value) {
  return String(value ?? '').match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+/giu) ?? []
}

function isValtrimEmail(value) {
  return value.toLowerCase().endsWith('@valtriminc.com')
}

export function extractOriginalValtrimEmailSentDate(value) {
  if (typeof value !== 'string' || !value.trim()) return ''

  const lines = value.split(/\r?\n/u)
  const messages = []
  for (let index = 0; index < lines.length; index += 1) {
    const fromMatch = lines[index].match(/^\s*From:\s*(.+)$/iu)
    if (!fromMatch) continue

    const message = { from: fromMatch[1], sent: '', to: '' }
    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 10); cursor += 1) {
      if (/^\s*From:/iu.test(lines[cursor])) break
      const sentMatch = lines[cursor].match(/^\s*Sent:\s*(.+)$/iu)
      if (sentMatch) message.sent = sentMatch[1]
      const toMatch = lines[cursor].match(/^\s*To:\s*(.+)$/iu)
      if (toMatch) message.to = toMatch[1]
      if (/^\s*Subject:/iu.test(lines[cursor])) break
    }
    messages.push(message)
  }

  const externalMessagesToValtrim = messages.filter((message) => (
    emails(message.from).some((email) => !isValtrimEmail(email))
    && emails(message.to).some(isValtrimEmail)
    && outlookSentDate(message.sent)
  ))

  // Forwarded Outlook chains are ordered newest to oldest. The deepest matching
  // external message is the original notification received by Valtrim.
  return outlookSentDate(externalMessagesToValtrim.at(-1)?.sent)
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function uniqueText(values) {
  return [...new Set(values.map(text).filter(Boolean))]
}

function contactName(value) {
  const original = text(value)
  const lastNameFirst = original.match(/^([^,]+),\s*(.+)$/u)
  return lastNameFirst
    ? `${lastNameFirst[2].trim()} ${lastNameFirst[1].trim()}`
    : original
}

function actionableSourceWarnings(warnings, { builderInferredFromIssuer }) {
  return warnings.filter((warning) => {
    const normalized = text(warning).toLowerCase()
    if (/order date.+after.+warranty effective date/u.test(normalized)) return false
    if (
      builderInferredFromIssuer
      && /builder (name )?(is )?(not provided|missing)/u.test(normalized)
    ) return false
    if (/no coordinates?.+(provided|present)/u.test(normalized)) return false
    if (/coordinates?.+(not provided|not present)/u.test(normalized)) return false
    if (/warranty representative name.+not provided/u.test(normalized)) return false
    return true
  })
}

function contactPhone(contact) {
  const priorities = ['MOBILE', 'HOME', 'WORK', 'OTHER', 'UNKNOWN']
  return [...(Array.isArray(contact?.phones) ? contact.phones : [])]
    .filter((phone) => text(phone?.number))
    .sort((left, right) => (
      priorities.indexOf(left.type) - priorities.indexOf(right.type)
    ))[0]?.number ?? ''
}

function contactScore(contact) {
  const roleScore = {
    PRIMARY_CONTACT: 50,
    HOMEOWNER: 40,
    WARRANTY_REP: 20,
    BUILDER_CONTACT: 10,
    OTHER: 5,
    UNKNOWN: 0,
  }[contact?.role] ?? 0

  return roleScore
    + (text(contact?.name) ? 10 : 0)
    + (contactPhone(contact) ? 10 : 0)
    + (text(contact?.email) ? 10 : 0)
}

function sortedContacts(contacts) {
  return [...contacts]
    .map((contact, index) => ({ contact, index, score: contactScore(contact) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
}

function completeAdditionalContact(contact) {
  const phone = contactPhone(contact)
  const country = getPhoneCountry(phone, 'US')
  return Boolean(
    text(contact?.name)
    && (text(contact?.email) || normalizePhoneNumber(phone, country)),
  )
}

function formattedAddress(property) {
  const address = property?.address ?? {}
  if (text(address.formatted)) return text(address.formatted)

  const locality = [text(address.city), text(address.state), text(address.postalCode)]
    .filter(Boolean)
    .join(' ')
  return [text(address.street), text(address.unit), locality].filter(Boolean).join(', ')
}

function coordinatesValue(property) {
  const coordinates = property?.coordinates ?? {}
  if (finiteNumber(coordinates.latitude) !== null && finiteNumber(coordinates.longitude) !== null) {
    return `${coordinates.latitude}, ${coordinates.longitude}`
  }

  const raw = text(coordinates.raw)
  return raw && parsePrototypeCoordinates(raw) ? raw : ''
}

function relevantServiceItems(structured) {
  return structured.serviceItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.assignedToValtrim !== false)
    .sort((left, right) => (
      Number(right.item.assignedToValtrim === true)
      - Number(left.item.assignedToValtrim === true)
      || left.index - right.index
    ))
}

export function customerServicePdfRequestedWorkItems(structured) {
  return renumberRequestedWorkItems(structured.serviceItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.assignedToValtrim !== false)
    .map(({ item, index }) => createRequestedWorkItem({
      itemNumber: text(item.sourceItemNumber) || String(index + 1),
      description: text(item.description) || text(item.requestedAction),
      materialRequired: false,
      chargeable: false,
    })))
}

export function customerServicePdfExcludedWorkItems(structured) {
  return structured.serviceItems.flatMap((item, sourceIndex) => (
    item.assignedToValtrim === false
      ? [{
        sourceIndex,
        sourceItemNumber: text(item.sourceItemNumber) || String(sourceIndex + 1),
        description: text(item.description),
        requestedAction: text(item.requestedAction),
        location: text(item.location),
        assignedVendor: text(item.assignedVendor) || 'Another vendor',
      }]
      : []
  ))
}

export function buildNewRequestDraftFromPdf(
  structured,
  {
    builderOptions = [],
    today = getCustomerServiceClock().date,
  } = {},
) {
  const values = {}
  const reviewNotes = []
  const applicableEntries = relevantServiceItems(structured)
  const applicableItems = applicableEntries.map(({ item }) => item)
  const property = structured.property ?? {}
  const propertyBuilder = text(property.builderName)
  const issuerName = text(structured.document?.issuerName)
  const builderInferredFromIssuer = !propertyBuilder && Boolean(issuerName)
  const extractedBuilder = propertyBuilder || issuerName
  const builderResolution = resolveCustomerServiceBuilder(extractedBuilder, builderOptions)
  const matchedBuilder = builderResolution.match
  const builderName = matchedBuilder?.value || extractedBuilder

  const reportedOnCandidates = [
    ['EMAIL_SENT', text(structured.document?.sourceEmailSentDate)],
    ['ORDER_DATE', text(structured.document?.orderDate)],
    ['SCHEDULED_DATE', text(structured.document?.scheduledDate)],
  ]
  const futureReportedOnCandidates = reportedOnCandidates.filter(([, date]) => date > today)
  const reportedOnCandidate = reportedOnCandidates.find(([, date]) => (
    /^\d{4}-\d{2}-\d{2}$/u.test(date) && date <= today
  ))
  if (reportedOnCandidate) {
    values.reportedAt = reportedOnCandidate[1]
  }
  if (futureReportedOnCandidates.length > 0) {
    reviewNotes.push('A source date is in the future and was not used for Reported on.')
  }

  if (builderName) values.builderName = builderName
  if (builderInferredFromIssuer && builderName) {
    reviewNotes.push(`Builder inferred from document issuer as ${builderName}.`)
  }
  if (extractedBuilder && builderResolution.status === 'NOT_FOUND') {
    reviewNotes.push(`Builder “${extractedBuilder}” does not match a registered Builder.`)
  }
  if (builderResolution.status === 'AMBIGUOUS') {
    reviewNotes.push(`Builder “${extractedBuilder}” matches more than one catalog alias. Select the builder manually.`)
  }

  const extractedJob = text(property.communityName)
  const jobResolution = matchedBuilder
    ? resolveCustomerServiceJob(extractedJob, matchedBuilder, builderOptions)
    : { status: extractedJob ? 'NOT_FOUND' : 'EMPTY', match: null }
  const matchedJob = jobResolution.match
  if (extractedJob) {
    values.community = matchedJob?.name ?? matchedJob?.value ?? extractedJob
    if (matchedJob?.id) values.jobId = matchedJob.id
    if (matchedBuilder && jobResolution.status === 'NOT_FOUND') {
      reviewNotes.push(`Project / Job “${extractedJob}” does not match an alias linked to ${matchedBuilder.value}.`)
    }
    if (jobResolution.status === 'AMBIGUOUS') {
      reviewNotes.push(`Project / Job “${extractedJob}” matches more than one alias. Select the Job manually.`)
    }
  }

  if (text(property.lotNumber)) values.lotNumber = text(property.lotNumber)
  const address = formattedAddress(property)
  if (address) values.address = address
  const jobCoordinates = customerServiceJobCoordinatesValue(matchedJob)
  const extractedCoordinates = coordinatesValue(property)
  if (jobCoordinates) {
    values.coordinates = jobCoordinates
  } else if (matchedJob) {
    reviewNotes.push(`Registered Project / Job ${values.community} has no valid Community coordinates. Correct the Job before continuing.`)
  } else if (extractedCoordinates) {
    values.coordinates = extractedCoordinates
  }

  const contacts = sortedContacts(Array.isArray(structured.contacts) ? structured.contacts : [])
  const primary = contacts[0]?.contact
  if (primary) {
    const phone = contactPhone(primary)
    if (text(primary.name)) values.contactName = contactName(primary.name)
    if (phone) {
      values.contactPhoneCountry = getPhoneCountry(phone, 'US')
      values.contactPhone = phone
    }
    if (text(primary.email)) values.contactEmail = text(primary.email)
  }

  const additionalCustomers = contacts
    .slice(1)
    .sort((left, right) => left.index - right.index)
    .map(({ contact }) => contact)
    .filter((contact) => ['HOMEOWNER', 'PRIMARY_CONTACT'].includes(contact.role))
    .filter(completeAdditionalContact)
  values.additionalContacts = additionalCustomers.slice(0, 2).map((contact) => ({
    name: contactName(contact.name), phoneCountry: getPhoneCountry(contactPhone(contact), 'US'),
    phone: contactPhone(contact), email: text(contact.email),
  }))
  const additional = additionalCustomers[0]
  if (additionalCustomers.length > 2) reviewNotes.push('The request supports three customers; remaining contacts are preserved in the extraction for review.')
  if (additional) {
    const phone = contactPhone(additional)
    values.additionalContactName = contactName(additional.name)
    values.additionalContactPhoneCountry = getPhoneCountry(phone, 'US')
    values.additionalContactPhone = phone
    values.additionalContactEmail = text(additional.email)
  }

  const planning = suggestRequestPlanning(applicableItems)
  for (const field of ['serviceKind', 'workType', 'serviceTask', 'estimatedDurationMinutes', 'crewSize']) {
    if (planning[field] !== '' && planning[field] !== null) values[field] = planning[field]
  }
  reviewNotes.push(...planning.warnings)

  if (text(structured.document?.sourceEmailFrom)) {
    values.sourceEmailFrom = text(structured.document.sourceEmailFrom)
  }
  if (text(structured.document?.sourceEmailSubject)) {
    values.sourceEmailSubject = text(structured.document.sourceEmailSubject)
  }

  const missingFields = [
    ['builderName', 'Builder'],
    ['community', 'Project / Job'],
    ['contactName', 'Customer name'],
    ['serviceKind', 'Service kind'],
    ['workType', 'Work type'],
    ['serviceTask', 'Service task'],
  ].filter(([field]) => !text(values[field])).map(([, label]) => label)
  if (!applicableItems.some((serviceItem) => text(serviceItem.description))) {
    missingFields.push('Requested work')
  }
  if (!text(values.coordinates)) {
    missingFields.splice(2, 0, 'Coordinates')
  }
  if (!text(values.contactPhone) && !text(values.contactEmail)) {
    missingFields.push('Customer email or phone')
  }

  const otherVendorCount = structured.serviceItems.filter(
    (serviceItem) => serviceItem.assignedToValtrim === false,
  ).length
  const relevantCount = applicableItems.length
  const unassignedItemCount = applicableItems.filter(
    (serviceItem) => serviceItem.assignedToValtrim === null,
  ).length
  if (otherVendorCount > 0) {
    reviewNotes.push(`${otherVendorCount} service item(s) assigned to other vendors were not loaded.`)
  }
  if (unassignedItemCount > 0) {
    reviewNotes.push(`${unassignedItemCount} unassigned service item(s) were loaded for review; confirm that they belong to Valtrim.`)
  }

  return {
    values,
    reportedAtSource: reportedOnCandidate?.[0] ?? 'MANUAL',
    hasAdditionalContact: Boolean(additional),
    missingFields,
    reviewNotes: uniqueText([
      ...actionableSourceWarnings(
        Array.isArray(structured.warnings) ? structured.warnings : [],
        { builderInferredFromIssuer },
      ),
      ...applicableItems.flatMap((serviceItem) => (
        Array.isArray(serviceItem.reviewReasons) ? serviceItem.reviewReasons : []
      )),
      ...reviewNotes,
    ]),
    relevantServiceItemCount: relevantCount,
    otherVendorCount,
    unassignedItemCount,
  }
}

function structuredData(value) {
  if (
    !value
    || typeof value !== 'object'
    || value.schemaVersion !== '1.0'
    || !value.document
    || typeof value.document !== 'object'
    || !value.property
    || typeof value.property !== 'object'
    || !Array.isArray(value.contacts)
    || !Array.isArray(value.serviceItems)
    || !Array.isArray(value.warnings)
  ) {
    throw new Error('The source extraction returned invalid structured data.')
  }
  return value
}

export function normalizeCustomerServicePdfExtraction(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.pages)) {
    throw new Error('The source extraction response is invalid.')
  }

  const pages = value.pages.map((page, position) => {
    if (!page || typeof page !== 'object' || typeof page.markdown !== 'string') {
      throw new Error('The source extraction returned an invalid page.')
    }
    return {
      page: Number.isInteger(page.page) && page.page > 0 ? page.page : position + 1,
      markdown: page.markdown,
      averageConfidence: finiteNumber(page.averageConfidence),
      minimumConfidence: finiteNumber(page.minimumConfidence),
    }
  })

  return {
    sourceType: value.sourceType === 'EMAIL_TEXT' ? 'EMAIL_TEXT' : 'PDF',
    fileName: typeof value.fileName === 'string' ? value.fileName : '',
    fileSize: finiteNumber(value.fileSize),
    pageCount: Number.isInteger(value.pageCount) && value.pageCount >= 0
      ? value.pageCount
      : pages.length,
    model: typeof value.model === 'string' ? value.model : '',
    text: typeof value.text === 'string'
      ? value.text
      : pages.map((page) => page.markdown.trim()).filter(Boolean).join('\n\n'),
    pages,
    structuredData: structuredData(value.structuredData),
  }
}

export function pdfExtractionConfidenceLabel(pages) {
  const scores = pages
    .map((page) => page.averageConfidence)
    .filter((score) => typeof score === 'number')
  if (scores.length === 0) return ''

  const average = scores.reduce((total, score) => total + score, 0) / scores.length
  return `${Math.round(average * 100)}% average OCR confidence`
}
