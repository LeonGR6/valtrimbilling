<<<<<<< HEAD
import { contactTypeLabels, resolveContactType } from '../data/builderContacts.js'

function optionalValue(value) {
=======
export function optionalValue(value) {
>>>>>>> dev/leon
  const normalized = typeof value === 'string' ? value.trim() : value
  return normalized || null
}

/**
 * `customTypeId` is the saved id of the typed type; it is only given (and
 * only used) when the type is not one of the fixed ones.
 */
export function toBuilderContactMutation(contact, customTypeId = null) {
  const { type } = resolveContactType(contact.typeName)
  return {
    builder_id: Number(contact.builderId),
    name: contact.name.trim(),
    type,
    custom_type_id: type === 'OTHER' ? customTypeId : null,
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
    customTypeId: row.custom_type_id ?? null,
    // What the contact is called: a fixed type's label or the typed type.
    typeName: row.type === 'OTHER'
      ? row.builder_contact_types?.name ?? ''
      : contactTypeLabels[row.type] ?? row.type,
    email: row.email,
    phone: row.phone ?? '',
    officePhone: row.office_phone ?? '',
    notes: row.notes ?? '',
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
