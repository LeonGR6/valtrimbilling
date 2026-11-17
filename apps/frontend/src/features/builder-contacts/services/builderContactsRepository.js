import { requireSupabase } from '../../../services/api.js'
import { resolveContactType } from '../data/builderContacts.js'
import {
  toBuilderContact,
  toBuilderContactMutation,
} from './builderContactRecord.js'

const BUILDER_CONTACT_COLUMNS = [
  'id',
  'builder_id',
  'name',
  'type',
  'email',
  'phone',
  'office_phone',
  'notes',
  'is_active',
  'custom_type_id',
  'builder_contact_types(name)',
].join(', ')

function throwRepositoryError(error) {
  if (!error) return

  if (error.code === '23505') {
    throw new Error('A Builder Contact with that email already exists.', { cause: error })
  }

  if (error.code === '23503') {
    throw new Error('Select a Builder that still exists.', { cause: error })
  }

  if (error.code === '42501') {
    throw new Error('You do not have permission to change Builder Contacts.', { cause: error })
  }

  throw new Error(error.message || 'The Builder Contacts request failed.', { cause: error })
}

export async function listBuilderContactTypes() {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('builder_contact_types')
    .select('id, name')
    .order('name', { ascending: true })

  throwRepositoryError(error)
  return data ?? []
}

/**
 * The id of the saved contact type with this name, saving it first when the
 * team typed one that did not exist. Two people typing the same new type at
 * once end up with one record.
 */
async function ensureContactTypeId(client, name) {
  const findByName = async () => {
    const { data, error } = await client
      .from('builder_contact_types')
      .select('id')
      .ilike('name', name.replace(/[\\%_]/g, '\\$&'))
      .maybeSingle()
    throwRepositoryError(error)
    return data?.id ?? null
  }

  const existingId = await findByName()
  if (existingId) return existingId

  const { data, error } = await client
    .from('builder_contact_types')
    .insert({ name })
    .select('id')
    .single()

  if (error?.code === '23505') {
    const racedId = await findByName()
    if (racedId) return racedId
  }
  throwRepositoryError(error)
  return data.id
}

async function toMutation(client, contact) {
  const resolved = resolveContactType(contact.typeName)
  const customTypeId = resolved.type === 'OTHER'
    ? await ensureContactTypeId(client, resolved.name)
    : null
  return toBuilderContactMutation(contact, customTypeId)
}

export async function listBuilderContacts() {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('builder_contacts')
    .select(BUILDER_CONTACT_COLUMNS)
    .order('name', { ascending: true })

  throwRepositoryError(error)
  return (data ?? []).map(toBuilderContact)
}

export async function createBuilderContact(contact) {
  const client = await requireSupabase()
  const mutation = await toMutation(client, contact)
  delete mutation.is_active
  const { data, error } = await client
    .from('builder_contacts')
    .insert(mutation)
    .select(BUILDER_CONTACT_COLUMNS)
    .single()

  throwRepositoryError(error)
  return toBuilderContact(data)
}

export async function updateBuilderContact(contactId, contact) {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('builder_contacts')
    .update(await toMutation(client, contact))
    .eq('id', contactId)
    .select(BUILDER_CONTACT_COLUMNS)
    .single()

  throwRepositoryError(error)
  return toBuilderContact(data)
}

export async function deactivateBuilderContact(contactId) {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('builder_contacts')
    .update({ is_active: false })
    .eq('id', contactId)
    .select(BUILDER_CONTACT_COLUMNS)
    .single()

  throwRepositoryError(error)
  return toBuilderContact(data)
}
