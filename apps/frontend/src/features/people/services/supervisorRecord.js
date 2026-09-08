export function optionalValue(value) {
  const normalized = typeof value === 'string' ? value.trim() : value
  return normalized || null
}

export function toSupervisorMutation(person) {
  return {
    name: person.name.trim(),
    email: person.email.trim().toLowerCase(),
    phone: optionalValue(person.phone),
    office_phone: optionalValue(person.officePhone),
    territory: optionalValue(person.territory),
    is_active: person.isActive,
  }
}

export function toSupervisor(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? '',
    officePhone: row.office_phone ?? '',
    types: ['SUPERVISOR'],
    territory: row.territory ?? '',
    isActive: row.is_active,
  }
}
