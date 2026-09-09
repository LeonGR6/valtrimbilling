import { requireSupabase } from '../../../services/api.js'
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
  const mutation = toBuilderContactMutation(contact)
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
    .update(toBuilderContactMutation(contact))
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
