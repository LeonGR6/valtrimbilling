import assert from 'node:assert/strict'
import test from 'node:test'
import { initialRequests } from '../src/features/customer-service/data/customerService.js'
import { createServiceRequestSchema } from '../src/features/customer-service/schemas/customerServiceSchema.js'
import { nextRequestNumber } from '../src/features/customer-service/utils/requestNumber.js'

function validRequest(overrides = {}) {
  return {
    requestNumber: 'cs-2100',
    tag: 'NEW',
    reportedAt: '2026-08-26',
    createdById: 1,
    builder: 'KB_HOME',
    community: 'Andara',
    lotNumber: '24a',
    street: '123 Main Street',
    city: 'Murrieta',
    state: 'ca',
    postalCode: '92562',
    plan: 'Plan 2',
    contactName: 'Maria Lopez',
    contactPhone: '(951) 555-0123',
    contactEmail: 'Maria.Lopez@Example.com',
    type: 'WARRANTY',
    issue: 'Interior door rubbing',
    priority: 'MEDIUM',
    status: 'CONFIRMED',
    statusNote: 'Normal',
    appointmentState: 'SCHEDULED',
    appointmentDate: '2026-08-27',
    appointmentStart: '09:00',
    appointmentEnd: '11:00',
    technicianId: 3,
    notes: '',
    ...overrides,
  }
}

test('service request normalizes the number, lot, state and email', () => {
  const result = createServiceRequestSchema([], null).parse(validRequest())

  assert.equal(result.requestNumber, 'CS-2100')
  assert.equal(result.lotNumber, '24A')
  assert.equal(result.state, 'CA')
  assert.equal(result.contactEmail, 'maria.lopez@example.com')
})

test('service request rejects a number another request already uses', () => {
  const result = createServiceRequestSchema(initialRequests, null).safeParse(
    validRequest({ requestNumber: 'CS-1045' }),
  )

  assert.equal(result.success, false)
  assert.equal(result.error.issues[0].path[0], 'requestNumber')
})

test('service request keeps its own number while being edited', () => {
  const [existing] = initialRequests
  const result = createServiceRequestSchema(
    initialRequests,
    existing.id,
  ).safeParse(validRequest({ requestNumber: existing.requestNumber }))

  assert.equal(result.success, true)
})

test('a request that is not scheduled needs no visit details', () => {
  const result = createServiceRequestSchema([], null).safeParse(
    validRequest({
      appointmentState: 'NOT_SCHEDULED',
      appointmentDate: '',
      appointmentStart: '',
      appointmentEnd: '',
      technicianId: '',
      status: 'CONTACT_NEEDED',
      statusNote: '',
    }),
  )

  assert.equal(result.success, true)
})

test('a scheduled visit has to have a technician assigned', () => {
  const result = createServiceRequestSchema([], null).safeParse(
    validRequest({ technicianId: '' }),
  )

  assert.equal(result.success, false)
  assert.ok(
    result.error.issues.some((issue) => issue.path[0] === 'technicianId'),
  )
})

test('a scheduled visit has to have a date and an arrival window', () => {
  const result = createServiceRequestSchema([], null).safeParse(
    validRequest({
      appointmentDate: '',
      appointmentStart: '',
      appointmentEnd: '',
    }),
  )

  assert.equal(result.success, false)

  const paths = result.error.issues.map((issue) => issue.path[0])
  assert.ok(paths.includes('appointmentDate'))
  assert.ok(paths.includes('appointmentStart'))
  assert.ok(paths.includes('appointmentEnd'))
})

test('the arrival window has to end after it starts', () => {
  const result = createServiceRequestSchema([], null).safeParse(
    validRequest({ appointmentStart: '14:00', appointmentEnd: '11:00' }),
  )

  assert.equal(result.success, false)
  assert.ok(
    result.error.issues.some((issue) => issue.path[0] === 'appointmentEnd'),
  )
})

test('an overdue visit still needs the date it was due', () => {
  const missingDate = createServiceRequestSchema([], null).safeParse(
    validRequest({
      appointmentState: 'OVERDUE',
      appointmentDate: '',
      appointmentStart: '',
      appointmentEnd: '',
      technicianId: '',
      status: 'OVERDUE',
      statusNote: '',
    }),
  )

  assert.equal(missingDate.success, false)
  assert.equal(missingDate.error.issues[0].path[0], 'appointmentDate')

  const withDate = createServiceRequestSchema([], null).safeParse(
    validRequest({
      appointmentState: 'OVERDUE',
      appointmentDate: '2026-08-24',
      appointmentStart: '',
      appointmentEnd: '',
      technicianId: '',
      status: 'OVERDUE',
      statusNote: '',
    }),
  )

  assert.equal(withDate.success, true)
})

test('the crew has to be given a complete service address', () => {
  const schema = createServiceRequestSchema([], null)

  assert.equal(schema.safeParse(validRequest({ street: '' })).success, false)
  assert.equal(schema.safeParse(validRequest({ city: '' })).success, false)
  assert.equal(
    schema.safeParse(validRequest({ state: 'California' })).success,
    false,
  )
  assert.equal(
    schema.safeParse(validRequest({ postalCode: '925' })).success,
    false,
  )
})

test('the homeowner email is optional but has to be an address when given', () => {
  const schema = createServiceRequestSchema([], null)

  assert.equal(schema.safeParse(validRequest({ contactEmail: '' })).success, true)
  assert.equal(
    schema.safeParse(validRequest({ contactEmail: 'not-an-address' })).success,
    false,
  )
})

// The generator feeds the field the uniqueness rule above protects, so the two
// belong together: if it ever hands back a folio already in use, the schema is
// what catches it.
test('the next folio follows the highest one already issued', () => {
  assert.equal(nextRequestNumber(initialRequests), 'CS-1057')
})

test('the first folio of an empty log starts the series', () => {
  assert.equal(nextRequestNumber([]), 'CS-1001')
})

test('the next folio ignores anything that is not a numbered folio', () => {
  const requests = [
    { requestNumber: 'CS-1002' },
    { requestNumber: 'LEGACY-9999' },
    { requestNumber: '' },
    { requestNumber: 'CS-1010' },
  ]

  assert.equal(nextRequestNumber(requests), 'CS-1011')
})

test('the next folio does not depend on the order of the log', () => {
  const ascending = [{ requestNumber: 'CS-1003' }, { requestNumber: 'CS-1020' }]
  const descending = [...ascending].reverse()

  assert.equal(nextRequestNumber(ascending), nextRequestNumber(descending))
})

test('a technician reference is an id, not a typed-in name', () => {
  const result = createServiceRequestSchema([], null).safeParse(
    validRequest({ technicianId: 'Esteban Marquez' }),
  )

  assert.equal(result.success, false)
})
