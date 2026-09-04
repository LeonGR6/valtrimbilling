import { normalizePhoneNumber } from '../../../utils/phoneNumbers.js'

function findPerson(records, id, fallbackName) {
  return records.find((record) => record.id === id)
    ?? records.find((record) => record.name === fallbackName)
    ?? null
}

function createContact(kind, role, fallbackName, person) {
  return {
    kind,
    role,
    name: person?.name ?? fallbackName ?? '',
    email: person?.email?.trim() ?? '',
    phone: person?.phone?.trim() ?? '',
    officePhone: person?.officePhone?.trim() ?? '',
  }
}

export function getEventContacts(eventProps, jobs, people, builderContacts) {
  const job = jobs.find((item) => item.id === eventProps.jobId) ?? null
  const supervisor = findPerson(people, job?.supervisorId, eventProps.foreman)
  const superintendent = findPerson(
    builderContacts,
    job?.superintendentId,
    eventProps.superintendent,
  )

  return {
    supervisor: createContact(
      'SUPERVISOR',
      'Supervisor',
      eventProps.foreman,
      supervisor,
    ),
    superintendent: createContact(
      'JOBSITE_SUPERINTENDENT',
      'Jobsite Superintendent',
      eventProps.superintendent,
      superintendent,
    ),
  }
}

export function normalizeSmsPhone(phone) {
  return normalizePhoneNumber(phone) ?? ''
}

export function buildEmailUrl(email, subject, body) {
  const recipient = String(email ?? '').trim()
  if (!recipient) return ''

  return `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export function buildSmsUrl(phone, body) {
  const recipient = normalizeSmsPhone(phone)
  if (!recipient) return ''

  return `sms:${recipient}?body=${encodeURIComponent(body)}`
}

export function createEventContactMessage(eventProps, eventLabel, contactName) {
  const greetingName = String(contactName ?? '').trim().split(/\s+/)[0]
  const greeting = greetingName ? `Hello ${greetingName},` : 'Hello,'
  const context = [
    `Job #${eventProps.jobCode}`,
    eventProps.community,
    eventProps.phase,
    eventProps.building,
    `${eventLabel} event`,
  ].filter(Boolean).join(' · ')

  return `${greeting}\n\nRegarding ${context}:\n\n`
}
