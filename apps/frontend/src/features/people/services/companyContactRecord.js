import { personTypeOptions } from '../data/people.js'

const KNOWN_TYPES = personTypeOptions.map(({ value }) => value)

export function optionalValue(value) {
  const normalized = typeof value === 'string' ? value.trim() : value
  return normalized || null
}

/** The columns of `people` a Company Contact edit may write. */
export function toCompanyContactMutation(person) {
  return {
    name: person.name.trim(),
    email: person.email.trim().toLowerCase(),
    phone: optionalValue(person.phone),
    office_phone: optionalValue(person.officePhone),
    territory: person.types?.includes('SUPERVISOR') ? optionalValue(person.territory) : null,
    is_active: person.isActive,
  }
}

/** The contact types of a row, in the order the screen lists them. */
export function toCompanyContactTypes(roles = []) {
  const held = new Set(roles.map((item) => item.role))
  return KNOWN_TYPES.filter((type) => held.has(type))
}

export function toCompanyContact(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? '',
    officePhone: row.office_phone ?? '',
    types: toCompanyContactTypes(row.person_roles),
    territory: row.territory ?? '',
    isActive: row.is_active,
  }
}

/** True when both lists hold the same types, whatever their order. */
export function sameContactTypes(left = [], right = []) {
  return left.length === right.length && left.every((type) => right.includes(type))
}
