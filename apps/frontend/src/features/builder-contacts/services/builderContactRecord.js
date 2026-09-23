export function optionalValue(value) {
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
    is_active: contact.isActive ?? true,
  }
}

export function toBuilderContact(row) {
  const builder = Array.isArray(row.builder) ? row.builder[0] : row.builder

  return {
    id: row.id,
    builderId: row.builder_id,
    builderCode: builder?.code ?? '',
    builderName: builder?.name ?? 'Unknown builder',
    name: row.name,
    type: row.type,
    email: row.email,
    phone: row.phone ?? '',
    officePhone: row.office_phone ?? '',
    notes: row.notes ?? '',
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
