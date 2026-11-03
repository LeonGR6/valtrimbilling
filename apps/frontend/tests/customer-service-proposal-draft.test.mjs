import test from 'node:test'
import assert from 'node:assert/strict'
import customerServiceMockDatabase from '../src/features/customer-service/data/customerServiceMockDatabase.js'
import { createServiceCalendarEventsFromRequests } from '../src/features/customer-service/data/serviceCalendarEvents.js'
import {
  changePrototypeProposalWindow, createPrototypeProposalDraft, getPrototypePlanningTechnicians, getPrototypeTechnicianAgenda,
  proposalDraftFormValues, proposalDraftHasChanges, proposalPlanningSignature, prototypePlanningHours, validatePrototypeProposalDraft,
} from '../src/features/customer-service/utils/proposalDraft.js'
import { getCustomerServiceClock } from '../src/features/customer-service/utils/dates.js'
import { assignedPrototypeTechnicianIds, prototypeTechnicians } from '../src/features/customer-service/data/prototypeTechnicians.js'

const now = new Date('2026-10-13T14:00:00Z') // 7 AM California, independent of test host.
const ready = {
  ...customerServiceMockDatabase.requests.find((request) => request.workflowStage === 'READY_TO_PROPOSE'),
  reportedAt: '2026-10-01', customerUnavailableDates: [],
}
const confirmed = {
  ...customerServiceMockDatabase.requests.find((request) => request.id === 'mock-1063'),
  customerWindow: { date: '2026-10-14', start: '10:00', end: '12:00' },
}
const awaiting = {
  ...customerServiceMockDatabase.requests.find((request) => request.workflowStage === 'AWAITING_CUSTOMER'),
  customerWindow: { date: '2026-10-14', start: '08:00', end: '10:00' },
}
const requests = [ready, confirmed, awaiting]
const jorge = 'prototype-Jorge Murillo'
const hilario = 'prototype-Hilario Najera'
const values = { technicianIds: [jorge], date: '2026-10-14', windowStart: '10:00', internalStart: '10:00' }
const validate = (overrides = {}, collection = requests, currentTime = now) => (
  validatePrototypeProposalDraft({ requestId: ready.id, values: { ...values, ...overrides }, requests: collection, now: currentTime })
)

test('planning uses an independent roster of existing simulation personnel and approved operating hours', () => {
  assert.deepEqual(getPrototypePlanningTechnicians(), [
    { id: hilario, name: 'Hilario Najera' }, { id: jorge, name: 'Jorge Murillo' },
  ])
  assert.deepEqual(getPrototypePlanningTechnicians([]), [])
  assert.deepEqual(customerServiceMockDatabase.technicians, prototypeTechnicians)
  assert.equal(validate({}, [ready]).isValid, true, 'A technician does not need appointment history to be selected')
  assert.deepEqual(prototypePlanningHours, { workdayStartsAt: '07:00', workdayEndsAt: '15:30' })
})

test('saving a draft preserves the request, review, calendar and source without reserving an appointment', () => {
  const collection = [{ ...ready, sourceDocument: { file: new File(['original PDF'], 'source.pdf') } }, confirmed, awaiting]
  const before = JSON.stringify(collection)
  const beforeCalendar = createServiceCalendarEventsFromRequests(collection)
  const draft = createPrototypeProposalDraft({ requestId: ready.id, values, requests: collection, now })
  assert.equal(draft.requestId, ready.id)
  assert.deepEqual(draft.internalSlot, { start: '10:00', end: '11:00' })
  assert.deepEqual(draft.customerWindow, { date: values.date, start: '10:00', end: '12:00', exceptional: false })
  assert.equal(draft.estimatedDurationMinutes, 60)
  assert.equal(draft.crewSize, 1)
  assert.equal(draft.savedAt, now.toISOString())
  assert.equal(draft.timeZone, 'America/Los_Angeles')
  assert.equal(collection[0].workflowStage, 'READY_TO_PROPOSE')
  assert.equal(JSON.stringify(collection), before)
  assert.deepEqual(createServiceCalendarEventsFromRequests(collection), beforeCalendar)
  assert.equal(Object.hasOwn(draft, 'workflowStage'), false)
  assert.deepEqual(proposalDraftFormValues(draft), values)
  draft.technicianIds.push(hilario)
  assert.deepEqual(values.technicianIds, [jorge])
})

test('only fully reviewed Ready to propose requests can be planned', () => {
  for (const workflowStage of ['NEEDS_REVIEW', 'AWAITING_CUSTOMER', 'NEEDS_CONTACT', 'CONFIRMED', 'COMPLETED']) {
    assert.equal(validate({}, [{ ...ready, workflowStage }, confirmed, awaiting]).isValid, false)
  }
  assert.equal(validate({}, [{ ...ready, review: null }, confirmed, awaiting]).isValid, false)
  assert.equal(validate({}, [{ ...ready, crewSize: null }, confirmed, awaiting]).isValid, false)
  assert.equal(validate({}, [{ ...ready, contactPhone: '', contactEmail: '' }, confirmed, awaiting]).isValid, false)
  assert.throws(() => createPrototypeProposalDraft({ requestId: 'missing', values, requests, now }), /Only Ready/)
})

test('date validation rejects impossible dates, weekends, past dates and explicitly unavailable customer dates', () => {
  for (const date of ['', '2026-02-30', '2026-13-01', '2026-10-17', '2026-10-18', '2026-10-12']) {
    const result = validate({ date })
    assert.equal(result.isValid, false, date)
    assert.ok(result.errors.some((error) => error.field === 'date'), date)
  }
  const unavailable = [{ ...ready, customerUnavailableDates: ['2026-10-14'] }, confirmed, awaiting]
  assert.ok(validate({}, unavailable).errors.some((error) => error.message.includes('unavailable')))
})

test('unknown, duplicated or insufficient technicians cannot imply crew capacity', () => {
  for (const technicianIds of [[], ['invented'], [jorge, jorge]]) {
    assert.ok(validate({ technicianIds }).errors.some((error) => error.field === 'technicianIds'))
  }
  const twoPeople = [{ ...ready, crewSize: 2 }, confirmed, awaiting]
  assert.equal(validate({}, twoPeople).isValid, false)
  assert.equal(validate({ technicianIds: [jorge, hilario], date: '2026-10-16' }, twoPeople).isValid, true)
  assert.equal(validatePrototypeProposalDraft({ requestId: ready.id, values, requests: [ready], technicians: [], now }).isValid, false)
})

test('all three approved customer windows can be selected', () => {
  assert.equal(validate().isValid, true)
  assert.equal(validate({ technicianIds: [hilario], windowStart: '08:00', internalStart: '08:00' }).isValid, true)
  assert.equal(validate({ technicianIds: [hilario], windowStart: '12:00', internalStart: '12:00' }).isValid, true)
  for (const windowStart of ['', '09:00', '14:00']) {
    assert.ok(validate({ windowStart }).errors.some((error) => error.field === 'windowStart'))
  }
})

test('selecting another window resets the internal start in either direction without changing the date or technicians', () => {
  const initial = { ...values, windowStart: '', internalStart: '' }
  const morning = changePrototypeProposalWindow(initial, '08:00')
  assert.deepEqual(morning, { ...values, windowStart: '08:00', internalStart: '08:00' })
  assert.equal(initial.internalStart, '')
  const manuallyAdjusted = { ...morning, internalStart: '09:30' }
  const later = changePrototypeProposalWindow(manuallyAdjusted, '10:00')
  assert.deepEqual(later, values)
  assert.equal(manuallyAdjusted.internalStart, '09:30')
  assert.deepEqual(changePrototypeProposalWindow(later, '08:00'), morning)
  // Reselecting the same window must not discard an internal adjustment.
  assert.equal(changePrototypeProposalWindow(manuallyAdjusted, '08:00'), manuallyAdjusted)
})

test('after changing windows the internal end uses the reviewed duration, not the old start or the window length', () => {
  const selected = changePrototypeProposalWindow({ ...values, windowStart: '08:00', internalStart: '08:00' }, '10:00')
  for (const [estimatedDurationMinutes, expectedEnd] of [[30, '10:30'], [45, '10:45'], [60, '11:00'], [120, '12:00']]) {
    const collection = [{ ...ready, estimatedDurationMinutes }, confirmed, awaiting]
    const result = validate(selected, collection)
    assert.equal(result.isValid, true)
    assert.equal(result.internalEnd, expectedEnd)
    const draft = createPrototypeProposalDraft({ requestId: ready.id, values: selected, requests: collection, now })
    assert.deepEqual(draft.internalSlot, { start: '10:00', end: expectedEnd })
  }
})

test('automatic internal-start updates do not free confirmed or pending customer windows', () => {
  const pending = changePrototypeProposalWindow(values, '08:00')
  assert.equal(validate(pending).isValid, false)
  assert.ok(validate(pending).errors.some((error) => error.message.includes('full customer window')))
  const confirmedSelection = changePrototypeProposalWindow({ ...pending, technicianIds: [hilario] }, '10:00')
  assert.equal(validate(confirmedSelection).isValid, false)
  assert.ok(validate(confirmedSelection).errors.some((error) => error.message.includes('full customer window')))
})

test('the internal start must be within the arrival window; ending after that window is allowed within the workday', () => {
  for (const internalStart of ['', '09:59', '12:00', 'invalid']) {
    assert.ok(validate({ internalStart }).errors.some((error) => error.field === 'internalStart'))
  }
  const longWork = [{ ...ready, estimatedDurationMinutes: 180 }, confirmed, awaiting]
  const result = validate({ technicianIds: [jorge], windowStart: '10:00', internalStart: '11:00' }, longWork)
  assert.equal(result.isValid, true)
  assert.equal(result.internalEnd, '14:00')
  assert.equal(validate({ internalStart: '11:59' }).internalEnd, '12:59')
})

test('the internal job may end exactly at 15:30, but never later', () => {
  const longWork = [{ ...ready, estimatedDurationMinutes: 240 }, confirmed, awaiting]
  const selection = { technicianIds: [jorge], windowStart: '10:00', internalStart: '11:30' }
  assert.equal(validate(selection, longWork).isValid, true)
  const tooLong = [{ ...ready, estimatedDurationMinutes: 241 }, confirmed, awaiting]
  assert.ok(validate(selection, tooLong).errors.some((error) => error.message.includes('3:30')))
})

test('a job cannot start in the past, including today at the current minute', () => {
  assert.equal(validate({ date: '2026-10-13' }).isValid, true)
  assert.ok(validate({ date: '2026-10-13' }, requests, new Date('2026-10-13T17:00:00Z')).errors.some((error) => error.message.includes('past')))
})

test('sent proposals reserve their full customer window until response, not just the internal work time', () => {
  const agenda = getPrototypeTechnicianAgenda(requests, [jorge], values.date)
  assert.equal(agenda.length, 1)
  assert.equal(agenda[0].stage, 'AWAITING_CUSTOMER')
  assert.equal(agenda[0].blocksAvailability, true)
  assert.equal(agenda[0].start, '08:00')
  assert.equal(agenda[0].end, '10:00')
  assert.deepEqual(agenda[0].internalSlot, { start: '09:00', end: '10:00' })
  for (const internalStart of ['08:00', '09:00', '09:30']) {
    const result = validate({ windowStart: '08:00', internalStart })
    assert.equal(result.isValid, false, internalStart)
    assert.ok(result.errors.some((error) => error.message.includes('full customer window 08:00–10:00')))
    assert.ok(result.errors.some((error) => error.message.includes('reserved pending')))
  }
  // Adjacent windows have no fixed buffer. Travel feasibility is intentionally not claimed.
  assert.equal(validate({ windowStart: '10:00', internalStart: '10:00' }).isValid, true)
})

test('confirmed windows cannot be reused by moving the internal start before an existing job', () => {
  const collection = [ready, { ...confirmed, internalSlot: { start: '11:00', end: '12:00' } }, awaiting]
  const selection = { technicianIds: [hilario], windowStart: '10:00', internalStart: '10:00' }
  const result = validate(selection, collection)
  assert.equal(result.isValid, false)
  assert.ok(result.errors.some((error) => error.message.includes('full customer window 10:00–12:00')))
  assert.throws(() => createPrototypeProposalDraft({ requestId: ready.id, values: { ...values, ...selection }, requests: collection, now }), /full customer window/)
  assert.equal(validate({ ...selection, technicianIds: [jorge] }, collection).isValid, true)
  assert.equal(validate({ ...selection, date: '2026-10-16' }, collection).isValid, true)
})

test('a reserved window blocks saving even while the new internal start is blank', () => {
  const result = validate({ windowStart: '08:00', internalStart: '' })
  assert.ok(result.errors.some((error) => error.field === 'internalStart'))
  assert.ok(result.errors.some((error) => error.message.includes('full customer window')))
})

test('confirmed appointments block every selected technician they are assigned to', () => {
  const overlap = { technicianIds: [hilario], windowStart: '10:00', internalStart: '10:30' }
  assert.equal(validate(overlap).isValid, false)
  assert.ok(validate(overlap).errors.some((error) => error.message.includes('CS-1063')))
  assert.equal(validate({ ...overlap, technicianIds: [jorge] }).isValid, true)
  assert.equal(validate({ ...overlap, technicianIds: [jorge, hilario] }).isValid, false)
})

test('completed work does not reserve time and unrelated days are not treated as busy', () => {
  const completed = [{ ...ready }, confirmed, { ...awaiting, workflowStage: 'COMPLETED' }]
  assert.equal(validate({ windowStart: '08:00', internalStart: '09:00' }, completed).isValid, true)
  assert.equal(validate({ date: '2026-10-16' }).isValid, true)
})

test('acceptance keeps the slot reserved; a rejected proposal returning to planning releases it', () => {
  const selection = { windowStart: '08:00', internalStart: '08:00' }
  assert.equal(validate(selection, [ready, confirmed, { ...awaiting, workflowStage: 'CONFIRMED' }]).isValid, false)
  for (const workflowStage of ['READY_TO_PROPOSE', 'NEEDS_CONTACT']) {
    assert.equal(validate(selection, [ready, confirmed, { ...awaiting, workflowStage }]).isValid, true)
  }
})

test('missing internal timing uses the recorded window conservatively and missing schedule data is never treated as free', () => {
  const incomplete = [ready, confirmed, { ...awaiting, internalSlot: null }]
  const entry = getPrototypeTechnicianAgenda(incomplete, [jorge], values.date)[0]
  assert.equal(entry.timingUncertain, true)
  assert.equal(entry.start, '08:00')
  assert.equal(entry.internalSlot, null)
  assert.equal(validate({ windowStart: '08:00', internalStart: '08:00' }, incomplete).isValid, false)
  assert.equal(validate({}, incomplete).isValid, true)
  const missingWindow = [ready, confirmed, { ...awaiting, internalSlot: null, customerWindow: null }]
  assert.ok(validate({}, missingWindow).errors.some((error) => error.message.includes('incomplete')))
})

test('missing or invalid customer windows never imply availability just because internal timing exists', () => {
  for (const customerWindow of [
    null,
    { date: values.date, start: '08:00', end: '09:00' },
    { date: values.date, start: '10:00', end: '08:00' },
    { date: values.date, start: 'invalid', end: '10:00' },
    { date: 'invalid', start: '08:00', end: '10:00' },
  ]) {
    const collection = [ready, confirmed, { ...awaiting, customerWindow }]
    assert.ok(validate({}, collection).errors.some((error) => error.message.includes('incomplete')))
  }
})

test('internal work extending into another reserved window is blocked even without an internal-job overlap', () => {
  const nextVisit = { ...confirmed, internalSlot: { start: '11:00', end: '12:00' } }
  const collection = [{ ...ready, estimatedDurationMinutes: 90 }, nextVisit, awaiting]
  const selection = { technicianIds: [hilario], windowStart: '08:00', internalStart: '09:00' }
  const result = validate(selection, collection)
  assert.equal(result.internalEnd, '10:30')
  assert.equal(result.isValid, false)
  assert.ok(result.errors.some((error) => error.message.includes('internal work')))
  assert.equal(validate({ ...selection, internalStart: '08:30' }, collection).isValid, true)
})

test('an earlier job extending into the new window blocks it even before the new internal job starts', () => {
  const extended = { ...awaiting, internalSlot: { start: '09:00', end: '10:30' } }
  const collection = [ready, confirmed, extended]
  const result = validate({ internalStart: '11:00' }, collection)
  assert.equal(result.isValid, false)
  assert.ok(result.errors.some((error) => error.message.includes('internal work')))
  const agenda = getPrototypeTechnicianAgenda(collection, [jorge], values.date)
  assert.equal(agenda[0].start, '08:00')
  assert.equal(agenda[0].end, '10:30')
  assert.deepEqual(agenda[0].internalSlot, { start: '09:00', end: '10:30' })
})

test('administrative edits preserve a draft signature but changes to reviewed scope, location or planning do not', () => {
  const signature = proposalPlanningSignature(ready)
  assert.equal(proposalPlanningSignature({ ...ready, priority: 'HIGH', internalNotes: 'Administrative note' }), signature)
  for (const change of [
    { estimatedDurationMinutes: 90 }, { crewSize: 2 }, { latitude: 0 },
    { requestedWorkItems: [{ ...ready.requestedWorkItems[0], description: 'Changed scope' }] },
    { review: { ...ready.review, completedAt: '2026-10-13T15:00:00Z' } },
  ]) assert.notEqual(proposalPlanningSignature({ ...ready, ...change }), signature)
})

test('saving revalidates availability rather than trusting an earlier successful check', () => {
  assert.equal(validate().isValid, true)
  const changedAgenda = [ready, confirmed, {
    ...awaiting, customerWindow: { date: values.date, start: '10:00', end: '12:00' },
    internalSlot: { start: '11:00', end: '12:00' },
  }]
  assert.throws(() => createPrototypeProposalDraft({ requestId: ready.id, values, requests: changedAgenda, now }), /full customer window/)
})

test('California clock owns operational dates and handles summer, winter and daylight saving transitions', () => {
  for (const [instant, date, minutesSinceMidnight] of [
    ['2026-10-14T06:30:00Z', '2026-10-13', 23 * 60 + 30],
    ['2026-10-14T07:00:00Z', '2026-10-14', 0],
    ['2026-01-14T07:30:00Z', '2026-01-13', 23 * 60 + 30],
    ['2026-03-08T09:59:00Z', '2026-03-08', 119],
    ['2026-03-08T10:00:00Z', '2026-03-08', 180],
    ['2026-11-01T08:30:00Z', '2026-11-01', 90],
    ['2026-11-01T09:30:00Z', '2026-11-01', 90],
  ]) {
    assert.deepEqual(getCustomerServiceClock(new Date(instant)), { date, minutesSinceMidnight }, instant)
    assert.equal(proposalDraftFormValues(null, new Date(instant)).date, date)
  }
})

test('date and past-time checks use California even when another zone is on a different day or hour', () => {
  const nextDayElsewhere = new Date('2026-10-14T06:30:00Z')
  const result = validate({ date: '2026-10-13' }, [ready], nextDayElsewhere)
  assert.equal(result.errors.some((error) => error.field === 'date'), false)
  assert.ok(result.errors.some((error) => error.field === 'internalStart'))
  assert.equal(validate({}, [ready], nextDayElsewhere).isValid, true)
  assert.equal(validate({ date: '2026-10-13' }, [ready], new Date('2026-10-13T16:59:00Z')).isValid, true)
  assert.equal(validate({ date: '2026-10-13' }, [ready], new Date('2026-10-13T17:00:00Z')).isValid, false)
})

test('complete assignment arrays override legacy primary technician fields and deduplicate agenda entries', () => {
  assert.deepEqual(assignedPrototypeTechnicianIds({ technicianIds: [jorge, hilario, jorge], technicianName: 'Not assigned' }), [jorge, hilario])
  assert.deepEqual(assignedPrototypeTechnicianIds({ technicianIds: [], technicianName: 'Jorge Murillo' }), [])
  assert.deepEqual(assignedPrototypeTechnicianIds({ technicianId: 15 }), ['15'])
  assert.deepEqual(assignedPrototypeTechnicianIds({ technicianName: 'Jorge Murillo' }), [jorge])
  assert.deepEqual(assignedPrototypeTechnicianIds({ technicianName: 'Not in roster' }), [])
  const joint = { ...awaiting, technicianIds: [jorge, hilario, jorge] }
  const agenda = getPrototypeTechnicianAgenda([joint], [jorge, hilario], values.date)
  assert.equal(agenda.length, 2)
  assert.deepEqual(agenda.map((entry) => entry.technicianName), ['Jorge Murillo', 'Hilario Najera'])
  assert.ok(agenda.every((entry) => entry.start === '08:00' && entry.end === '10:00'))
})

test('a two-person confirmed or pending visit blocks both technicians independently, including extended internal work', () => {
  for (const workflowStage of ['CONFIRMED', 'AWAITING_CUSTOMER']) {
    const joint = { ...awaiting, workflowStage, technicianIds: [jorge, hilario], internalSlot: { start: '09:00', end: '10:30' } }
    const collection = [ready, joint]
    for (const technicianIds of [[jorge], [hilario], [jorge, hilario]]) {
      assert.equal(validate({ technicianIds, windowStart: '08:00', internalStart: '08:00' }, collection).isValid, false)
      assert.equal(validate({ technicianIds, internalStart: '11:00' }, collection).isValid, false)
      assert.throws(() => createPrototypeProposalDraft({ requestId: ready.id, values: { ...values, technicianIds }, requests: collection, now }), /internal work conflict/)
      assert.equal(validate({ technicianIds, date: '2026-10-16' }, collection).isValid, true)
    }
  }
})

test('unsaved detection tracks only selection changes and does not change the last saved draft', () => {
  const draft = createPrototypeProposalDraft({ requestId: ready.id, values, requests, now })
  const originalDraft = JSON.stringify(draft)
  const baseline = proposalDraftFormValues(draft)
  assert.equal(proposalDraftHasChanges({ ...baseline }, baseline), false)
  for (const changes of [
    { technicianIds: [hilario] }, { date: '2026-10-16' },
    { windowStart: '08:00' }, { internalStart: '10:30' },
  ]) assert.equal(proposalDraftHasChanges({ ...baseline, ...changes }, baseline), true)
  assert.equal(JSON.stringify(draft), originalDraft)
  const twoPeople = { ...baseline, technicianIds: [jorge, hilario] }
  assert.equal(proposalDraftHasChanges({ ...twoPeople, technicianIds: [hilario, jorge] }, twoPeople), false)
  const untouched = proposalDraftFormValues(null, now)
  assert.equal(proposalDraftHasChanges({ ...untouched }, untouched), false)
})
