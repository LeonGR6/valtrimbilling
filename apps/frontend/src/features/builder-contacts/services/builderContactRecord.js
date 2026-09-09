function optionalValue(value) {
  const normalized = typeof value === 'string' ? value.trim() : value
  return normalized || null
}

export function toBuilderContactMutation(contact) {
  return {
    builder_id: Number(contact.builderId),
    name: contact.name.trim(),
    type: contact.type,
    email: contact.email.trim().toLowerCase(),
    phone: optionalValue(contact.phone),
    office_phone: optionalValue(contact.officePhone),
    notes: optionalValue(contact.notes),
    is_active: contact.isActive,
  }
}

export function toBuilderContact(row) {
  return {
    id: row.id,
    builderId: row.builder_id,
    name: row.name,
    type: row.type,
    email: row.email,
    phone: row.phone ?? '',
    officePhone: row.office_phone ?? '',
    notes: row.notes ?? '',
    isActive: row.is_active,
  }
}
