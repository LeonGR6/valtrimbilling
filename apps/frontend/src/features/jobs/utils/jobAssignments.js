import { jobContactRoles } from '../data/jobContactRoles.js'

/**
 * The Company Contact types a Job's roles still need. One person can hold
 * several roles on a Job (Options Coordinator and Scheduling, say); a contact
 * picked for a role they do not have yet gets that type when the Job is saved.
 *
 * @returns {{ person: object, types: string[] }[]} the contacts to update, with
 *   the types they should end up with
 */
export function contactTypesToAdd(job, people, roles) {
  const wanted = new Map()

  for (const role of roles) {
    if (role.source !== 'company') continue
    const person = people.find((item) => String(item.id) === String(job?.[role.field]))
    if (!person || person.types.includes(role.type)) continue

    const types = wanted.get(person.id)?.types ?? [...person.types]
    if (!types.includes(role.type)) types.push(role.type)
    wanted.set(person.id, { person, types })
  }

  return [...wanted.values()]
}

const contactRolesInOrder = [
  { key: 'supervisorId', label: 'Supervisor', source: 'company' },
  ...jobContactRoles,
]

/**
 * Every contact of a Job, role by role, with the details to reach them. A
 * person who fills several roles shows up once per role; a role nobody fills
 * has an empty name.
 */
export function resolveJobContacts(job, people = [], builderContacts = []) {
  return contactRolesInOrder.map((role) => {
    const records = role.source === 'builder' ? builderContacts : people
    const id = job?.[role.key ?? role.field]
    const record = id == null
      ? null
      : records.find((item) => String(item.id) === String(id))

    return {
      key: role.key ?? role.field,
      role: role.label,
      optional: Boolean(role.optional),
      name: record?.name?.trim() ?? '',
      email: record?.email ?? '',
      phone: record?.phone ?? '',
      officePhone: record?.officePhone ?? '',
    }
  })
}
