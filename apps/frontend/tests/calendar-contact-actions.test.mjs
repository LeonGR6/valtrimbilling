import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildEmailUrl,
  buildSmsUrl,
  createEventContactMessage,
  getEventContacts,
  normalizeSmsPhone,
} from '../src/features/calendar/utils/calendarContactActions.js'

const eventProps = {
  jobId: 7,
  jobCode: '1307',
  community: 'Andara',
  phase: 'Phase 2',
  building: 'Building 15',
  foreman: 'Old Supervisor Name',
  superintendent: 'Old Superintendent Name',
}

test('event contacts resolve the latest registered email and phone through the Job', () => {
  const contacts = getEventContacts(
    eventProps,
    [{ id: 7, supervisorId: 11, superintendentId: 21 }],
    [{ id: 11, name: 'Lauren Mitchell', email: 'lauren@example.com', phone: '+17145550162' }],
    [{ id: 21, name: 'Daniel Torres', email: 'daniel@example.com', phone: '+19515550184' }],
  )

  assert.equal(contacts.supervisor.name, 'Lauren Mitchell')
  assert.equal(contacts.supervisor.email, 'lauren@example.com')
  assert.equal(contacts.superintendent.name, 'Daniel Torres')
  assert.equal(contacts.superintendent.phone, '+19515550184')
})

test('event contacts can fall back to a registered person with the saved event name', () => {
  const contacts = getEventContacts(
    { ...eventProps, jobId: 999 },
    [],
    [{ id: 11, name: 'Old Supervisor Name', email: 'supervisor@example.com', phone: '' }],
    [{ id: 21, name: 'Old Superintendent Name', email: 'jobsite@example.com', phone: '' }],
  )

  assert.equal(contacts.supervisor.email, 'supervisor@example.com')
  assert.equal(contacts.superintendent.email, 'jobsite@example.com')
})

test('email and SMS actions create encoded native composer links', () => {
  const message = createEventContactMessage(eventProps, 'DM', 'Lauren Mitchell')

  assert.match(message, /^Hello Lauren,/)
  assert.match(message, /Job #1307 · Andara · Phase 2 · Building 15 · DM event/)
  assert.equal(normalizeSmsPhone('+1 (714) 555-0162'), '+17145550162')
  assert.equal(normalizeSmsPhone('+52 55 1234 5678'), '+525512345678')
  assert.equal(
    buildEmailUrl('lauren@example.com', 'Job #1307 · DM', message),
    `mailto:lauren@example.com?subject=${encodeURIComponent('Job #1307 · DM')}&body=${encodeURIComponent(message)}`,
  )
  assert.equal(
    buildSmsUrl('(714) 555-0162', message),
    `sms:+17145550162?body=${encodeURIComponent(message)}`,
  )
})

test('missing contact channels do not create unusable action URLs', () => {
  assert.equal(buildEmailUrl('', 'Subject', 'Body'), '')
  assert.equal(buildSmsUrl('', 'Body'), '')
})
