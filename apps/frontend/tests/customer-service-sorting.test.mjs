import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formStatusOptions,
  initialRequests,
  openStatuses,
  statusOptions,
} from '../src/features/customer-service/data/customerService.js'
import { sortRequests } from '../src/features/customer-service/utils/sorting.js'

function request(overrides) {
  return {
    requestNumber: 'CS-9000',
    reportedAt: '2026-08-01',
    priority: 'MEDIUM',
    appointmentState: 'NOT_SCHEDULED',
    appointmentDate: '',
    appointmentStart: '',
    ...overrides,
  }
}

function numbers(requests, sortBy) {
  return sortRequests(requests, sortBy).map((item) => item.requestNumber)
}

test('request number sorting reads from the highest folio down', () => {
  const log = [
    request({ requestNumber: 'CS-1045' }),
    request({ requestNumber: 'CS-1057' }),
    request({ requestNumber: 'CS-1050' }),
  ]

  assert.deepEqual(numbers(log, 'FOLIO'), ['CS-1057', 'CS-1050', 'CS-1045'])
})

test('request number sorting compares digits, not text', () => {
  const log = [
    request({ requestNumber: 'CS-999' }),
    request({ requestNumber: 'CS-1057' }),
  ]

  assert.deepEqual(numbers(log, 'FOLIO'), ['CS-1057', 'CS-999'])
})

test('next up puts a broken promise ahead of a booked visit', () => {
  const log = [
    request({
      requestNumber: 'CS-2',
      appointmentState: 'SCHEDULED',
      appointmentDate: '2026-08-28',
      appointmentStart: '09:00',
    }),
    request({
      requestNumber: 'CS-1',
      appointmentState: 'OVERDUE',
      appointmentDate: '2026-08-24',
    }),
  ]

  assert.deepEqual(numbers(log, 'NEXT_UP'), ['CS-1', 'CS-2'])
})

test('next up orders booked visits by the clock, not by folio', () => {
  const log = [
    request({
      requestNumber: 'CS-30',
      appointmentState: 'SCHEDULED',
      appointmentDate: '2026-08-28',
      appointmentStart: '14:30',
    }),
    request({
      requestNumber: 'CS-10',
      appointmentState: 'SCHEDULED',
      appointmentDate: '2026-08-29',
      appointmentStart: '08:00',
    }),
    request({
      requestNumber: 'CS-20',
      appointmentState: 'SCHEDULED',
      appointmentDate: '2026-08-28',
      appointmentStart: '09:00',
    }),
  ]

  assert.deepEqual(numbers(log, 'NEXT_UP'), ['CS-20', 'CS-30', 'CS-10'])
})

test('next up sinks completed work and floats what nobody has called yet', () => {
  const log = [
    request({
      requestNumber: 'CS-DONE',
      appointmentState: 'COMPLETED',
      appointmentDate: '2026-08-24',
    }),
    request({ requestNumber: 'CS-WAITING', reportedAt: '2026-08-02' }),
    request({
      requestNumber: 'CS-BOOKED',
      appointmentState: 'SCHEDULED',
      appointmentDate: '2026-08-29',
      appointmentStart: '08:00',
    }),
  ]

  assert.deepEqual(numbers(log, 'NEXT_UP'), [
    'CS-BOOKED',
    'CS-WAITING',
    'CS-DONE',
  ])
})

test('unscheduled requests queue by who has been waiting longest', () => {
  const log = [
    request({ requestNumber: 'CS-RECENT', reportedAt: '2026-08-20' }),
    request({ requestNumber: 'CS-OLD', reportedAt: '2026-08-02' }),
  ]

  assert.deepEqual(numbers(log, 'NEXT_UP'), ['CS-OLD', 'CS-RECENT'])
})

test('priority sorting leads with high and keeps next up inside each level', () => {
  const log = [
    request({ requestNumber: 'CS-LOW', priority: 'LOW' }),
    request({
      requestNumber: 'CS-HIGH-LATER',
      priority: 'HIGH',
      appointmentState: 'SCHEDULED',
      appointmentDate: '2026-08-30',
      appointmentStart: '09:00',
    }),
    request({
      requestNumber: 'CS-HIGH-SOONER',
      priority: 'HIGH',
      appointmentState: 'SCHEDULED',
      appointmentDate: '2026-08-28',
      appointmentStart: '09:00',
    }),
  ]

  assert.deepEqual(numbers(log, 'PRIORITY'), [
    'CS-HIGH-SOONER',
    'CS-HIGH-LATER',
    'CS-LOW',
  ])
})

test('newest first reads by the date the request came in', () => {
  const log = [
    request({ requestNumber: 'CS-OLD', reportedAt: '2026-08-02' }),
    request({ requestNumber: 'CS-NEW', reportedAt: '2026-08-26' }),
  ]

  assert.deepEqual(numbers(log, 'NEWEST'), ['CS-NEW', 'CS-OLD'])
})

test('sorting leaves the original log untouched', () => {
  const before = initialRequests.map((item) => item.requestNumber)
  sortRequests(initialRequests, 'NEXT_UP')

  assert.deepEqual(
    initialRequests.map((item) => item.requestNumber),
    before,
  )
})

test('a closed request drops out of the queue even while overdue', () => {
  const log = [
    request({
      requestNumber: 'CS-CLOSED',
      status: 'CLOSED',
      appointmentState: 'OVERDUE',
      appointmentDate: '2026-08-01',
    }),
    request({
      requestNumber: 'CS-LIVE',
      status: 'OVERDUE',
      appointmentState: 'OVERDUE',
      appointmentDate: '2026-08-24',
    }),
  ]

  assert.deepEqual(numbers(log, 'NEXT_UP'), ['CS-LIVE', 'CS-CLOSED'])
})

test('closed is a status that exists but the form never offers it', () => {
  assert.ok(statusOptions.some(({ value }) => value === 'CLOSED'))
  assert.ok(!formStatusOptions.some(({ value }) => value === 'CLOSED'))
})

test('the still-open filter leaves out both finished and closed work', () => {
  assert.ok(!openStatuses.includes('CLOSED'))
  assert.ok(!openStatuses.includes('COMPLETED'))
  assert.ok(openStatuses.includes('OVERDUE'))
})

test('the real log leads with the two overdue requests', () => {
  const sorted = sortRequests(initialRequests, 'NEXT_UP')

  assert.deepEqual(
    sorted.slice(0, 2).map((item) => item.requestNumber),
    ['CS-1056', 'CS-1050'],
  )
})
