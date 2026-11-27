import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildNewRequestDraftFromPdf,
  customerServicePdfExcludedWorkItems,
  customerServicePdfRequestedWorkItems,
  extractOriginalValtrimEmailSentDate,
  normalizeCustomerServicePdfExtraction,
  pdfExtractionConfidenceLabel,
} from '../src/features/customer-service/utils/pdfExtraction.js'
import { buildCustomerServiceBuilderOptions } from '../src/features/customer-service/data/customerServiceJobCatalog.js'

const registeredBuilderOptions = buildCustomerServiceBuilderOptions([
  { id: 7, code: 'BR', name: 'Brookfield Residential', isActive: true },
  { id: 9, code: 'TPIE', name: 'Tri Pointe Homes Inland Empire', isActive: true },
], [
  {
    id: 101,
    builderId: 7,
    code: 'BR-MAG',
    community: 'Magnolia at Arcadia',
    communityLatitude: 34.111521,
    communityLongitude: -118.00946,
    isActive: true,
  },
  {
    id: 102,
    builderId: 9,
    code: 'TPIE-VITA',
    community: 'Vita at Altis',
    communityLatitude: null,
    communityLongitude: null,
    isActive: true,
  },
])

function structuredData() {
  return {
    schemaVersion: '1.0',
    document: {
      documentType: 'WORK_ORDER',
      issuerName: 'Example Builder',
      documentTitle: 'Warranty Work Order',
      workOrderNumbers: ['WO-100'],
      orderDate: '2026-09-10',
      scheduledDate: null,
      sourceEmailSentDate: null,
      sourceEmailFrom: null,
      sourceEmailSubject: null,
    },
    property: {
      builderName: null,
      communityName: 'Example Community',
      lotNumber: '000250',
      model: null,
      address: {
        street: '100 Example Lane',
        unit: null,
        city: 'Arcadia',
        state: 'CA',
        postalCode: '91006',
        formatted: '100 Example Lane, Arcadia, CA 91006',
      },
      coordinates: { raw: null, latitude: null, longitude: null },
    },
    contacts: [],
    serviceItems: [],
    warnings: ['Coordinates were not present in the document.'],
  }
}

test('normalizes the Customer Service OCR preview', () => {
  const extraction = normalizeCustomerServicePdfExtraction({
    fileName: 'service-request.pdf',
    fileSize: 2048,
    pageCount: 2,
    model: 'mistral-ocr-latest',
    text: 'Customer: Elena\n\nWork: Replace exterior frame',
    pages: [
      {
        page: 1,
        markdown: 'Customer: Elena',
        averageConfidence: 0.98,
        minimumConfidence: 0.91,
      },
      {
        page: 2,
        markdown: 'Work: Replace exterior frame',
        averageConfidence: 0.96,
        minimumConfidence: 0.89,
      },
    ],
    structuredData: structuredData(),
  })

  assert.equal(extraction.pageCount, 2)
  assert.equal(extraction.sourceType, 'PDF')
  assert.equal(extraction.pages[0].page, 1)
  assert.equal(extraction.structuredData.property.lotNumber, '000250')
  assert.equal(pdfExtractionConfidenceLabel(extraction.pages), '97% average OCR confidence')
})

test('normalizes pasted email analysis through the same structured-data path', () => {
  const extraction = normalizeCustomerServicePdfExtraction({
    sourceType: 'EMAIL_TEXT',
    pageCount: 0,
    model: 'mistral-small-latest',
    text: 'From: warranty@example.com\nSubject: Door issue',
    pages: [],
    structuredData: structuredData(),
  })

  assert.equal(extraction.sourceType, 'EMAIL_TEXT')
  assert.equal(extraction.pageCount, 0)
  assert.equal(extraction.pages.length, 0)
  assert.match(extraction.text, /Door issue/)
  assert.equal(extraction.structuredData.schemaVersion, '1.0')
})

test('uses the original external email date instead of a later Valtrim forward', () => {
  const email = `From: Anelda Calvillo <acalvillo@valtriminc.com>
Sent: Wednesday, October 14, 2026 2:17 PM
To: Victor Vallejo <victor@valtriminc.com>
Subject: Fw: Warranty request

From: Felcie Kidd <Felcie.Kidd@TriPointeHomes.com>
Sent: Monday, October 12, 2026 4:17 PM
To: Anelda Calvillo <acalvillo@valtriminc.com>
Subject: Warranty request`

  assert.equal(extractOriginalValtrimEmailSentDate(email), '2026-10-12')
})

test('reported date prefers the original email, then Order Date, then Scheduled Date', () => {
  const extraction = structuredData()
  extraction.document.sourceEmailSentDate = '2026-09-12'
  extraction.document.orderDate = '2026-09-10'
  extraction.document.scheduledDate = '2026-09-11'

  const fromEmail = buildNewRequestDraftFromPdf(extraction, { today: '2026-09-15' })
  assert.equal(fromEmail.values.reportedAt, '2026-09-12')
  assert.equal(fromEmail.reportedAtSource, 'EMAIL_SENT')

  extraction.document.sourceEmailSentDate = null
  const fromOrder = buildNewRequestDraftFromPdf(extraction, { today: '2026-09-15' })
  assert.equal(fromOrder.values.reportedAt, '2026-09-10')
  assert.equal(fromOrder.reportedAtSource, 'ORDER_DATE')

  extraction.document.orderDate = null
  const fromSchedule = buildNewRequestDraftFromPdf(extraction, { today: '2026-09-15' })
  assert.equal(fromSchedule.values.reportedAt, '2026-09-11')
  assert.equal(fromSchedule.reportedAtSource, 'SCHEDULED_DATE')
})

test('does not autofill Reported on from a future source date', () => {
  const extraction = structuredData()
  extraction.document.orderDate = null
  extraction.document.scheduledDate = '2026-09-20'

  const draft = buildNewRequestDraftFromPdf(extraction, { today: '2026-09-15' })
  assert.equal(Object.hasOwn(draft.values, 'reportedAt'), false)
  assert.equal(draft.reportedAtSource, 'MANUAL')
  assert.equal(draft.reviewNotes.some((note) => note.includes('future')), true)
})

test('mixed Hardware and Doors items select Multiple work types', () => {
  const extraction = structuredData()
  extraction.serviceItems = [
    {
      sourceItemNumber: '1',
      description: 'The first floor bathroom has two black pull handles instead of brushed nickel.',
      requestedAction: null,
      assignedToValtrim: true,
      reviewReasons: [],
    },
    {
      sourceItemNumber: '2',
      description: 'The master bedroom door needs adjustment and is very hard to close into the strike plate.',
      requestedAction: null,
      assignedToValtrim: true,
      reviewReasons: [],
    },
  ]

  const draft = buildNewRequestDraftFromPdf(extraction)

  assert.equal(draft.values.workType, 'Multiple work types')
  assert.equal(
    draft.reviewNotes.some((note) => note.includes('Multiple work types were detected')),
    true,
  )
})

test('rebuilds preview text when the endpoint omits the combined value', () => {
  const extraction = normalizeCustomerServicePdfExtraction({
    pages: [
      { page: 1, markdown: 'First page' },
      { page: 2, markdown: 'Second page' },
    ],
    structuredData: structuredData(),
  })

  assert.equal(extraction.pageCount, 2)
  assert.equal(extraction.text, 'First page\n\nSecond page')
  assert.equal(pdfExtractionConfidenceLabel(extraction.pages), '')
})

test('rejects malformed OCR responses', () => {
  assert.throws(
    () => normalizeCustomerServicePdfExtraction({ pages: [{ page: 1 }] }),
    /invalid page/i,
  )
  assert.throws(
    () => normalizeCustomerServicePdfExtraction(null),
    /response is invalid/i,
  )
  assert.throws(
    () => normalizeCustomerServicePdfExtraction({
      pages: [{ page: 1, markdown: 'Readable text' }],
      structuredData: { schemaVersion: '1.0' },
    }),
    /invalid structured data/i,
  )
})

test('maps a single Valtrim work order into an editable New Request draft', () => {
  const extraction = structuredData()
  extraction.document.issuerName = 'Brookfield Residential'
  extraction.property.builderName = null
  extraction.property.communityName = 'Magnolia Townhomes'
  extraction.contacts = [
    {
      role: 'HOMEOWNER',
      name: 'Example Homeowner',
      phones: [{ type: 'HOME', number: '(999) 999-9999' }],
      email: null,
    },
    {
      role: 'PRIMARY_CONTACT',
      name: 'Contact, Primary',
      phones: [
        { type: 'HOME', number: '8582311866' },
        { type: 'MOBILE', number: '(858) 382-9192' },
      ],
      email: 'primary@example.com',
    },
  ]
  extraction.serviceItems = [{
    sourceItemNumber: '0001',
    description: 'Door getting stuck in the top left side of doorframe.',
    requestedAction: null,
    location: 'Primary Bedroom',
    assignedVendor: 'Valtrim Inc.',
    assignedToValtrim: true,
    sourceCategory: 'FNSHHDWR - Hardware',
    suggestedServiceKind: null,
    suggestedWorkType: 'Hardware',
    suggestedServiceTask: 'GENERAL_FIX',
    reviewReasons: ['Requested action was not explicit.'],
  }]
  extraction.warnings = [
    'Order date appears to be after the warranty effective date.',
    'Builder name is not provided in the document.',
    'No coordinates are explicitly provided in the document.',
    'Warranty representative name is not provided.',
    'Confirm the requested action with the coordinator.',
  ]

  const draft = buildNewRequestDraftFromPdf(extraction, {
    builderOptions: [{
      value: 'Brookfield Residential',
      communities: ['Willow'],
    }],
  })

  assert.equal(draft.values.builderName, 'Brookfield Residential')
  assert.equal(draft.values.community, 'Magnolia Townhomes')
  assert.equal(draft.values.contactName, 'Primary Contact')
  assert.equal(draft.values.contactPhone, '(858) 382-9192')
  assert.equal(draft.values.contactEmail, 'primary@example.com')
  assert.equal(draft.values.serviceKind, 'Adjustment')
  assert.equal(draft.values.workType, 'Hardware')
  assert.equal(draft.values.serviceTask, 'GENERAL_FIX')
  assert.equal(draft.values.estimatedDurationMinutes, 30)
  assert.equal(draft.values.crewSize, 1)
  assert.equal(draft.hasAdditionalContact, true)
  assert.equal(draft.values.additionalContacts[0].name, 'Example Homeowner')
  assert.deepEqual(draft.missingFields, ['Coordinates'])
  assert.equal(
    draft.reviewNotes.some((note) => note.includes('does not match an alias linked')),
    true,
  )
  assert.equal(
    draft.reviewNotes.some((note) => note.includes('Builder inferred from document issuer')),
    true,
  )
  assert.equal(
    draft.reviewNotes.some((note) => note.includes('Confirm the requested action')),
    true,
  )
  assert.equal(
    draft.reviewNotes.some((note) => /warranty effective|coordinates|representative name/i.test(note)),
    false,
  )
})

test('builder and Project / Job values resolve to registered records and Job coordinates', () => {
  const extraction = structuredData()
  extraction.document.issuerName = 'Brookfield'
  extraction.property.builderName = null
  extraction.property.communityName = 'Magnolia at Arcadia'
  extraction.property.coordinates = {
    raw: '1, 2',
    latitude: 1,
    longitude: 2,
  }

  const draft = buildNewRequestDraftFromPdf(extraction, {
    builderOptions: registeredBuilderOptions,
  })

  assert.equal(draft.values.builderName, 'Brookfield Residential')
  assert.equal(draft.values.jobId, '101')
  assert.equal(draft.values.community, 'Magnolia at Arcadia')
  assert.equal(draft.values.coordinates, '34.111521, -118.00946')
})

test('a registered Job without coordinates cannot inherit coordinates from the source', () => {
  const extraction = structuredData()
  extraction.document.issuerName = 'Tri Pointe Homes Inland Empire'
  extraction.property.builderName = null
  extraction.property.communityName = 'VITA AT ALTIS'
  extraction.property.coordinates = { raw: '1, 2', latitude: 1, longitude: 2 }

  const draft = buildNewRequestDraftFromPdf(extraction, {
    builderOptions: registeredBuilderOptions,
  })

  assert.equal(draft.values.builderName, 'Tri Pointe Homes Inland Empire')
  assert.equal(draft.values.jobId, '102')
  assert.equal(draft.values.community, 'Vita at Altis')
  assert.equal(draft.values.coordinates, undefined)
  assert.equal(
    draft.reviewNotes.some((note) => note.includes('Correct the Job before continuing')),
    true,
  )
})

test('loads all applicable items into one request and excludes other vendors', () => {
  const extraction = structuredData()
  extraction.property.builderName = 'KB Home'
  extraction.property.communityName = 'Iris'
  extraction.contacts = [{
    role: 'HOMEOWNER',
    name: 'Example Owner',
    phones: [{ type: 'MOBILE', number: '(951) 850-7811' }],
    email: 'owner@example.com',
  }]
  extraction.serviceItems = [
    {
      sourceItemNumber: '1',
      description: 'Car charger is not working.',
      requestedAction: 'Repair',
      assignedToValtrim: null,
      reviewReasons: ['Vendor assignment is missing.'],
    },
    {
      sourceItemNumber: '2',
      description: 'Clean glue off flooring.',
      requestedAction: 'Cleaning',
      assignedToValtrim: false,
      reviewReasons: [],
    },
    {
      sourceItemNumber: '3',
      description: 'Bedroom door does not close or lock.',
      requestedAction: 'Repair',
      assignedToValtrim: true,
      reviewReasons: [],
    },
    {
      sourceItemNumber: '4',
      description: 'Bathroom sink stopper is not working.',
      requestedAction: 'Repair',
      assignedToValtrim: false,
      reviewReasons: [],
    },
    {
      sourceItemNumber: '5',
      description: 'Front door has a gap letting light through and bugs.',
      requestedAction: 'Repair',
      assignedToValtrim: true,
      reviewReasons: [],
    },
  ]

  const requestedWorkItems = customerServicePdfRequestedWorkItems(extraction)
  const excludedWorkItems = customerServicePdfExcludedWorkItems(extraction)
  assert.equal(new Set(requestedWorkItems.map((item) => item.id)).size, 3)
  assert.deepEqual(
    requestedWorkItems.map(({ id, ...item }) => item),
    [
      {
        itemNumber: '1',
        description: 'Car charger is not working.',
        materialRequired: false,
        chargeable: false,
      },
      {
        itemNumber: '2',
        description: 'Bedroom door does not close or lock.',
        materialRequired: false,
        chargeable: false,
      },
      {
        itemNumber: '3',
        description: 'Front door has a gap letting light through and bugs.',
        materialRequired: false,
        chargeable: false,
      },
    ],
  )
  assert.deepEqual(excludedWorkItems, [
    {
      sourceIndex: 1,
      sourceItemNumber: '2',
      description: 'Clean glue off flooring.',
      requestedAction: 'Cleaning',
      location: '',
      assignedVendor: 'Another vendor',
    },
    {
      sourceIndex: 3,
      sourceItemNumber: '4',
      description: 'Bathroom sink stopper is not working.',
      requestedAction: 'Repair',
      location: '',
      assignedVendor: 'Another vendor',
    },
  ])

  const firstDraft = buildNewRequestDraftFromPdf(extraction, {
    builderOptions: [{ value: 'KB Home', communities: ['Andara'] }],
  })
  assert.equal(firstDraft.values.serviceKind, 'Adjustment')
  assert.equal(firstDraft.values.workType, 'Multiple work types')
  assert.equal(firstDraft.values.serviceTask, 'GENERAL_FIX')
  assert.equal(firstDraft.relevantServiceItemCount, 3)
  assert.equal(firstDraft.otherVendorCount, 2)
  assert.equal(firstDraft.unassignedItemCount, 1)
  assert.equal(
    firstDraft.reviewNotes.some((note) => note.includes('unassigned service item')),
    true,
  )
  assert.equal(
    firstDraft.reviewNotes.some((note) => note.includes('Multiple work types were detected')),
    true,
  )
  assert.equal(
    firstDraft.reviewNotes.some((note) => note.includes('Vendor assignment is missing')),
    true,
  )

  const secondDraft = buildNewRequestDraftFromPdf(extraction, {
    builderOptions: [{ value: 'KB Home', communities: ['Andara'] }],
    serviceItemIndex: 4,
  })
  assert.equal(secondDraft.values.workType, 'Multiple work types')
  assert.equal(Object.hasOwn(secondDraft.values, 'description'), false)
})
