import test from 'node:test'
import assert from 'node:assert/strict'
import customerServiceMockDatabase from '../src/features/customer-service/data/customerServiceMockDatabase.js'
import { createServiceCalendarEventsFromRequests } from '../src/features/customer-service/data/serviceCalendarEvents.js'
import {
  changePrototypeProposalWindow, changePrototypeTravelMinutes, createPrototypeProposalDraft, getPrototypePlanningTechnicians, getPrototypeTechnicianAgenda,
  proposalDraftFormValues, proposalDraftHasChanges, proposalPlanningSignature, prototypePickupMinutes, prototypePlanningHours,
  validatePrototypeProposalDraft,
} from '../src/features/customer-service/utils/proposalDraft.js'
import { getCustomerServiceClock } from '../src/features/customer-service/utils/dates.js'
import { assignedPrototypeTechnicianIds, prototypeTechnicians } from '../src/features/customer-service/data/prototypeTechnicians.js'

const now = new Date('2026-10-13T14:00:00Z') // 7 AM California, independent of test host.
const windowEnds = { '08:00': '10:00', '10:00': '12:00', '12:00': '14:00' }
const jorge = 'prototype-Jorge Murillo'
const hilario = 'prototype-Hilario Najera'

const ready = {
  ...customerServiceMockDatabase.requests.find((request) => request.workflowStage === 'READY_TO_PROPOSE'),
  reportedAt: '2026-10-01', customerUnavailableDates: [], dueOn: '2026-10-20',
}

// A scheduled visit from the mock catalogue. Work time is [slot[0], slot[1]]; pickup follows it.
function booked(id, { stage = 'CONFIRMED', technicianIds = [jorge], windowStart = '10:00', slot = null, date = '2026-10-14' } = {}) {
  const request = customerServiceMockDatabase.requests.find((entry) => entry.id === id)
  return {
    ...request,
    workflowStage: stage,
    technicianIds,
    customerWindow: { date, start: windowStart, end: windowEnds[windowStart] },
    internalSlot: slot ? { start: slot[0], end: slot[1] } : null,
  }
}

const values = { technicianIds: [jorge], date: '2026-10-14', windowStart: '10:00', internalStart: '10:00' }
const validate = (overrides = {}, collection = [ready], currentTime = now) => (
  validatePrototypeProposalDraft({ requestId: ready.id, values: { ...values, ...overrides }, requests: collection, now: currentTime })
)

test('planning uses an independent roster of existing simulation personnel and approved operating hours', () => {
  assert.deepEqual(getPrototypePlanningTechnicians(), [
    { id: hilario, name: 'Hilario Najera' }, { id: jorge, name: 'Jorge Murillo' },
  ])
  assert.deepEqual(getPrototypePlanningTechnicians([]), [])
  assert.deepEqual(customerServiceMockDatabase.technicians, prototypeTechnicians)
  assert.equal(validate().isValid, true, 'A technician does not need appointment history to be selected')
  assert.deepEqual(prototypePlanningHours, { workdayStartsAt: '07:00', workdayEndsAt: '15:30' })
  assert.equal(prototypePickupMinutes, 10)
})

test('saving a draft preserves the request, review, calendar and source without reserving an appointment', () => {
  const previous = booked('mock-1062', { stage: 'AWAITING_CUSTOMER', windowStart: '08:00', slot: ['08:00', '09:00'] })
  const other = booked('mock-1063', { technicianIds: [hilario], slot: ['10:30', '11:30'] })
  const collection = [{ ...ready, sourceDocument: { file: new File(['original PDF'], 'source.pdf') } }, previous, other]
  const before = JSON.stringify(collection)
  const beforeCalendar = createServiceCalendarEventsFromRequests(collection)
  const draftValues = { ...values, travelMinutes: { [`${previous.id}>${ready.id}`]: 10 } }
  const draft = createPrototypeProposalDraft({ requestId: ready.id, values: draftValues, requests: collection, now })
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
  assert.deepEqual(draft.travelMinutes, { [`${previous.id}>${ready.id}`]: 10 })
  assert.deepEqual(proposalDraftFormValues(draft), {
    technicianIds: [jorge], date: values.date, windowStart: '10:00', internalStart: '10:00',
    travelMinutes: { [`${previous.id}>${ready.id}`]: 10 },
  })
  draft.technicianIds.push(hilario)
  assert.deepEqual(values.technicianIds, [jorge])
})

test('the validation lists each travel leg once, with the technicians who share it and its estimate', () => {
  const before = booked('mock-1062', { stage: 'AWAITING_CUSTOMER', windowStart: '08:00', slot: ['08:00', '09:00'], technicianIds: [jorge, hilario] })
  const after = booked('mock-1063', { stage: 'CONFIRMED', technicianIds: [jorge], windowStart: '12:00', slot: ['12:00', '12:30'] })
  const twoPeople = { ...ready, crewSize: 2 }
  const result = validate({ technicianIds: [jorge, hilario], travelMinutes: { [`${before.id}>${ready.id}`]: 15 } }, [twoPeople, before, after])
  assert.deepEqual(result.travelLegs.map(({ key, technicianNames, minutes }) => ({ key, technicianNames, minutes })), [
    { key: `${before.id}>${ready.id}`, technicianNames: ['Jorge Murillo', 'Hilario Najera'], minutes: 15 },
    { key: `${ready.id}>${after.id}`, technicianNames: ['Jorge Murillo'], minutes: null },
  ])
  assert.equal(result.pickupEnd, '11:10')
  // Only the estimates for the current sequence are kept in the draft.
  const draft = createPrototypeProposalDraft({
    requestId: ready.id, requests: [twoPeople, before, after], now,
    values: { ...values, technicianIds: [jorge, hilario], travelMinutes: { [`${before.id}>${ready.id}`]: 15, 'old>leg': 5 } },
  })
  assert.deepEqual(draft.travelMinutes, { [`${before.id}>${ready.id}`]: 15 })
  assert.equal(validate({}, [ready]).travelLegs.length, 0)
})

test('manual travel input accepts whole minutes only, and an empty value is unknown rather than zero', () => {
  const key = 'mock-1062>mock-1061'
  assert.deepEqual(changePrototypeTravelMinutes(values, key, '25').travelMinutes, { [key]: 25 })
  assert.deepEqual(changePrototypeTravelMinutes(values, key, '0').travelMinutes, { [key]: 0 })
  for (const input of ['', ' ', '-5', '2.5', 'abc', '1000']) {
    assert.deepEqual(changePrototypeTravelMinutes({ ...values, travelMinutes: { [key]: 10 } }, key, input).travelMinutes, {}, input)
  }
  assert.equal(Object.hasOwn(values, 'travelMinutes'), false, 'the current values are not mutated')
  const baseline = { ...values, travelMinutes: { [key]: 10 } }
  assert.equal(proposalDraftHasChanges({ ...baseline, travelMinutes: { [key]: 10 } }, baseline), false)
  assert.equal(proposalDraftHasChanges({ ...baseline, travelMinutes: { [key]: 12 } }, baseline), true)
  assert.equal(proposalDraftHasChanges({ ...baseline, travelMinutes: {} }, baseline), true)
})

test('only fully reviewed Ready to propose requests can be planned', () => {
  for (const workflowStage of ['NEEDS_REVIEW', 'AWAITING_CUSTOMER', 'NEEDS_CONTACT', 'CONFIRMED', 'COMPLETED']) {
    assert.equal(validate({}, [{ ...ready, workflowStage }]).isValid, false)
  }
  assert.equal(validate({}, [{ ...ready, review: null }]).isValid, false)
  assert.equal(validate({}, [{ ...ready, crewSize: null }]).isValid, false)
  assert.equal(validate({}, [{ ...ready, contactPhone: '', contactEmail: '' }]).isValid, false)
  assert.throws(() => createPrototypeProposalDraft({ requestId: 'missing', values, requests: [ready], now }), /Only Ready/)
})

test('date validation rejects impossible dates, weekends, past dates and explicitly unavailable customer dates', () => {
  for (const date of ['', '2026-02-30', '2026-13-01', '2026-10-17', '2026-10-18', '2026-10-12']) {
    const result = validate({ date })
    assert.equal(result.isValid, false, date)
    assert.ok(result.errors.some((error) => error.field === 'date'), date)
  }
  const unavailable = [{ ...ready, customerUnavailableDates: ['2026-10-14'] }]
  assert.ok(validate({}, unavailable).errors.some((error) => error.message.includes('unavailable')))
})

test('a date after the due date is flagged as late without blocking an overdue request', () => {
  const due = [{ ...ready, dueOn: '2026-10-14' }]
  assert.equal(validate({ date: '2026-10-14' }, due).warnings.length, 0)
  const late = validate({ date: '2026-10-15' }, due)
  assert.equal(late.isValid, true)
  assert.ok(late.warnings.some((warning) => warning.message.includes('after the due date 2026-10-14')))
})

test('unknown, duplicated or insufficient technicians cannot imply crew capacity', () => {
  for (const technicianIds of [[], ['invented'], [jorge, jorge]]) {
    assert.ok(validate({ technicianIds }).errors.some((error) => error.field === 'technicianIds'))
  }
  const twoPeople = [{ ...ready, crewSize: 2 }]
  assert.equal(validate({}, twoPeople).isValid, false)
  assert.equal(validate({ technicianIds: [jorge, hilario], date: '2026-10-16' }, twoPeople).isValid, true)
  assert.equal(validatePrototypeProposalDraft({ requestId: ready.id, values, requests: [ready], technicians: [], now }).isValid, false)
})

test('all three approved customer windows can be selected', () => {
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

test('after changing windows the internal end uses the reviewed duration plus pickup, not the window length', () => {
  const selected = changePrototypeProposalWindow({ ...values, windowStart: '08:00', internalStart: '08:00' }, '10:00')
  for (const [estimatedDurationMinutes, expectedEnd] of [[30, '10:30'], [45, '10:45'], [60, '11:00']]) {
    const collection = [{ ...ready, estimatedDurationMinutes }]
    const result = validate(selected, collection)
    assert.equal(result.isValid, true)
    assert.equal(result.internalEnd, expectedEnd)
    const draft = createPrototypeProposalDraft({ requestId: ready.id, values: selected, requests: collection, now })
    assert.deepEqual(draft.internalSlot, { start: '10:00', end: expectedEnd })
  }
  // 120 minutes of work plus 10 minutes of pickup cannot fit a two-hour window.
  const longWork = [{ ...ready, estimatedDurationMinutes: 120 }]
  assert.ok(validate(selected, longWork).errors.some((error) => error.message.includes('before the customer window closes')))
})

test('work and pickup must finish before the customer window closes, not only start inside it', () => {
  for (const internalStart of ['09:59', '12:00', 'invalid', '']) {
    assert.ok(validate({ internalStart }).errors.some((error) => error.field === 'internalStart'), internalStart)
  }
  assert.equal(validate({ internalStart: '10:00' }).isValid, true)
  assert.ok(validate({ internalStart: '11:00' }).errors.some((error) => error.message.includes('before the customer window closes at 12:00')))
  // 60 minutes from 10:50 ends at 11:50 and pickup ends exactly at 12:00; one minute later does not fit.
  assert.equal(validate({ internalStart: '10:50' }).isValid, true)
  assert.equal(validate({ internalStart: '10:51' }).isValid, false)
})

test('the internal job must fit within the workday, which ends at 15:30', () => {
  const longWork = [{ ...ready, estimatedDurationMinutes: 240 }]
  const result = validate({ windowStart: '12:00', internalStart: '12:00' }, longWork)
  assert.equal(result.isValid, false)
  assert.ok(result.errors.some((error) => error.message.includes('3:30')))
})

test('a job cannot start in the past, including today at the current minute', () => {
  assert.equal(validate({ date: '2026-10-13' }).isValid, true)
  assert.ok(validate({ date: '2026-10-13' }, [ready], new Date('2026-10-13T17:00:00Z')).errors.some((error) => error.message.includes('past')))
})

test('a confirmed visit occupies only its work and pickup, so a later visit can share the window with enough travel', () => {
  const confirmed = booked('mock-1063', { technicianIds: [jorge], slot: ['10:00', '10:30'] })
  const busyUntil = '10:40' // 10:30 work end plus 10 minutes pickup
  const unknownTravel = validate({ internalStart: busyUntil }, [ready, confirmed], now)
  assert.equal(unknownTravel.isValid, true, 'a draft can be saved, but travel is not claimed as verified')
  assert.ok(unknownTravel.warnings.some((warning) => warning.message.includes('Travel time pending')))
  const withTravel = { travelMinutes: { [`${confirmed.id}>${ready.id}`]: 0 } }
  assert.equal(validate({ internalStart: busyUntil, ...withTravel }, [ready, confirmed]).isValid, true)
  const slowTravel = { travelMinutes: { [`${confirmed.id}>${ready.id}`]: 5 } }
  assert.ok(validate({ internalStart: busyUntil, ...slowTravel }, [ready, confirmed]).errors.some((error) => error.message.includes('cannot reach')))
  assert.ok(validate({ internalStart: '10:20' }, [ready, confirmed]).errors.some((error) => error.message.includes('internal work conflict')))
})

test('sent proposals reserve their occupied time until response, not the whole customer window', () => {
  const pending = booked('mock-1062', { stage: 'AWAITING_CUSTOMER', windowStart: '08:00', slot: ['08:00', '09:00'] })
  const agenda = getPrototypeTechnicianAgenda([pending], [jorge], values.date)
  assert.equal(agenda.length, 1)
  assert.equal(agenda[0].stage, 'AWAITING_CUSTOMER')
  assert.equal(agenda[0].blocksAvailability, true)
  assert.equal(agenda[0].start, '08:00')
  assert.equal(agenda[0].end, '09:10')
  assert.deepEqual(agenda[0].internalSlot, { start: '08:00', end: '09:00' })
  // The new visit cannot start before the pending work plus pickup, and needs a manual travel estimate.
  const selection = { windowStart: '10:00', internalStart: '10:00' }
  assert.ok(validate(selection, [ready, pending]).warnings.some((warning) => warning.message.includes('Travel time pending')))
  assert.equal(validate({ ...selection, travelMinutes: { [`${pending.id}>${ready.id}`]: 50 } }, [ready, pending]).isValid, true)
  assert.ok(validate({ ...selection, travelMinutes: { [`${pending.id}>${ready.id}`]: 51 } }, [ready, pending])
    .errors.some((error) => error.message.includes('cannot reach')))
  assert.ok(validate({ windowStart: '08:00', internalStart: '09:10' }, [ready, pending]).errors.some((error) => error.message.includes('before the customer window closes')))
})

test('a new visit between two neighbours needs travel from each neighbour to it, not a shortcut between them', () => {
  const before = booked('mock-1062', { stage: 'AWAITING_CUSTOMER', windowStart: '08:00', slot: ['08:00', '09:00'] })
  const after = booked('mock-1063', { stage: 'CONFIRMED', technicianIds: [jorge], windowStart: '12:00', slot: ['12:00', '12:30'] })
  const collection = [ready, before, after]
  const fits = {
    [`${before.id}>${ready.id}`]: 10,
    [`${ready.id}>${after.id}`]: 30,
  }
  assert.equal(validate({ travelMinutes: fits }, collection).isValid, true)
  assert.ok(validate({ travelMinutes: { ...fits, [`${ready.id}>${after.id}`]: 60 } }, collection)
    .errors.some((error) => error.message.includes('after this visit')))
  // A direct before→after estimate is not used when the visit sits between them.
  const shortcut = validate({ travelMinutes: { [`${before.id}>${after.id}`]: 0 } }, collection)
  assert.equal(shortcut.warnings.filter((warning) => warning.message.includes('Travel time pending')).length, 2)
})

test('the previous neighbour is the visit that ends last before the new start, not the one that starts last', () => {
  // A visit without work time keeps its whole 08:00–10:00 window; a shorter one starts later but ends earlier.
  const wholeWindow = booked('mock-1062', { stage: 'AWAITING_CUSTOMER', windowStart: '08:00' })
  const shorter = booked('mock-1063', { stage: 'CONFIRMED', windowStart: '08:00', slot: ['08:30', '08:45'] })
  const travel = { [`${wholeWindow.id}>${ready.id}`]: 15, [`${shorter.id}>${ready.id}`]: 0 }
  const result = validate({ internalStart: '10:00', travelMinutes: travel }, [ready, wholeWindow, shorter])
  assert.ok(result.errors.some((error) => error.message.includes(`from ${wholeWindow.requestNumber}`)))
  assert.equal(validate({ internalStart: '10:15', travelMinutes: travel }, [ready, wholeWindow, shorter]).isValid, true)
})

test('confirmed, pending or working visits block every selected technician they are assigned to', () => {
  for (const stage of ['CONFIRMED', 'AWAITING_CUSTOMER', 'WORKING']) {
    const joint = booked('mock-1063', { stage, technicianIds: [jorge, hilario], slot: ['10:00', '11:00'] })
    assert.equal(validate({ technicianIds: [hilario], windowStart: '10:00', internalStart: '10:00' }, [ready, joint]).isValid, false, stage)
    assert.equal(validate({ technicianIds: [jorge, hilario], internalStart: '11:10' }, [ready, joint]).isValid, false, stage)
    assert.equal(validate({ technicianIds: [jorge, hilario], date: '2026-10-16' }, [ready, joint]).isValid, true, stage)
  }
  const working = booked('mock-1063', { stage: 'WORKING', slot: ['10:00', '10:30'] })
  assert.equal(getPrototypeTechnicianAgenda([working], [jorge], values.date)[0].blocksAvailability, true)
})

test('completed work does not reserve time', () => {
  const completed = booked('mock-1062', { stage: 'COMPLETED', windowStart: '08:00', slot: ['08:00', '09:00'] })
  assert.equal(validate({}, [ready, completed]).isValid, true)
  assert.equal(getPrototypeTechnicianAgenda([completed], [jorge], values.date)[0].blocksAvailability, false)
})

test('a rejected proposal returning to planning releases its time; a confirmed one keeps it', () => {
  const selection = { windowStart: '08:00', internalStart: '08:00' }
  const confirmed = booked('mock-1062', { stage: 'CONFIRMED', windowStart: '08:00', slot: ['08:00', '09:00'] })
  assert.equal(validate(selection, [ready, confirmed]).isValid, false)
  for (const stage of ['READY_TO_PROPOSE', 'NEEDS_CONTACT']) {
    const released = booked('mock-1062', { stage, windowStart: '08:00', slot: ['08:00', '09:00'] })
    assert.equal(validate(selection, [ready, released]).isValid, true, stage)
  }
})

test('missing internal timing keeps the recorded window busy; missing schedule data is never treated as free', () => {
  const incomplete = booked('mock-1063', { stage: 'AWAITING_CUSTOMER', technicianIds: [jorge], windowStart: '10:00' })
  const entry = getPrototypeTechnicianAgenda([incomplete], [jorge], values.date)[0]
  assert.equal(entry.timingUncertain, true)
  assert.equal(entry.start, '10:00')
  assert.equal(entry.end, '12:00')
  assert.equal(entry.internalSlot, null)
  assert.equal(validate({ windowStart: '10:00', internalStart: '10:00' }, [ready, incomplete]).isValid, false)
  assert.equal(validate({ technicianIds: [hilario], windowStart: '08:00', internalStart: '08:00' }, [ready, incomplete]).isValid, true)
  const missingWindow = booked('mock-1063', { stage: 'AWAITING_CUSTOMER', technicianIds: [jorge], slot: ['10:00', '10:30'] })
  missingWindow.customerWindow = null
  assert.ok(validate({}, [ready, missingWindow]).errors.some((error) => error.message.includes('incomplete')))
})

test('missing or invalid customer windows never imply availability just because internal timing exists', () => {
  for (const customerWindow of [
    null,
    { date: values.date, start: '10:00', end: '08:00' },
    { date: values.date, start: 'invalid', end: '10:00' },
    { date: 'invalid', start: '10:00', end: '12:00' },
  ]) {
    const collection = [ready, { ...booked('mock-1063', { slot: ['10:00', '10:30'] }), customerWindow }]
    assert.ok(validate({}, collection).errors.some((error) => error.message.includes('incomplete')))
  }
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
  const changedAgenda = [ready, booked('mock-1063', { technicianIds: [jorge], slot: ['10:00', '11:00'] })]
  assert.throws(() => createPrototypeProposalDraft({ requestId: ready.id, values, requests: changedAgenda, now }), /internal work conflict/)
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
  const joint = booked('mock-1062', { stage: 'AWAITING_CUSTOMER', windowStart: '08:00', slot: ['08:00', '09:00'], technicianIds: [jorge, hilario, jorge] })
  const agenda = getPrototypeTechnicianAgenda([joint], [jorge, hilario], values.date)
  assert.equal(agenda.length, 2)
  assert.deepEqual(agenda.map((entry) => entry.technicianName), ['Jorge Murillo', 'Hilario Najera'])
  assert.ok(agenda.every((entry) => entry.start === '08:00' && entry.end === '09:10'))
})

test('unsaved detection tracks only selection changes and does not change the last saved draft', () => {
  const draft = createPrototypeProposalDraft({ requestId: ready.id, values, requests: [ready], now })
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
