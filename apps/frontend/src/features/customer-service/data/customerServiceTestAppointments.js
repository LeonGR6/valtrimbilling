// Local test appointments for checking Proposal Workspace planning by hand.
// They are never saved, sent or shown unless the development flag enables them
// (see CustomerServicePrototypeProvider). Remove this file when appointments are
// persisted in Supabase.
import customerServiceMockDatabase from './customerServiceMockDatabase.js'
import { getCustomerServiceClock, toIsoDate } from '../utils/dates.js'

const jorge = 'prototype-Jorge Murillo'

// Next Monday–Friday after today in California, so the visits are never in the past.
function nextBusinessDay(now) {
  const [year, month, day] = getCustomerServiceClock(now).date.split('-').map(Number)
  const date = new Date(year, month - 1, day, 12)
  do date.setDate(date.getDate() + 1)
  while ([0, 6].includes(date.getDay()))
  return toIsoDate(date)
}

export function createCustomerServiceTestAppointments(now = new Date()) {
  const base = customerServiceMockDatabase.requests.find((request) => request.workflowStage === 'CONFIRMED')
  const date = nextBusinessDay(now)
  const appointment = (number, window, work, minutes) => ({
    ...base,
    id: `test-appointment-${number}`,
    requestNumber: `TEST-${number}`,
    testFixture: true,
    prototypeOnly: true,
    workflowStage: 'CONFIRMED',
    technicianIds: [jorge],
    technicianName: 'Jorge Murillo',
    customerWindow: { date, start: window[0], end: window[1] },
    internalSlot: { start: work[0], end: work[1] },
    estimatedDurationMinutes: minutes,
    crewSize: 1,
    dueOn: date,
    contactName: 'Test customer',
    issue: `TEST appointment ${number} · local planning check, not a real customer`,
  })
  return [
    appointment(1, ['08:00', '10:00'], ['08:00', '08:30'], 30),
    appointment(2, ['12:00', '14:00'], ['12:00', '12:45'], 45),
  ]
}
