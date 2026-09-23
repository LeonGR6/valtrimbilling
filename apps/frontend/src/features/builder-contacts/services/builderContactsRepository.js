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
  'created_at',
  'updated_at',
  'builder:builders(id, code, name)',
].join(', ')

function throwRepositoryError(error) {
  if (!error) return

  if (error.code === '23505') {
    throw new Error('A builder contact with that email already exists.', { cause: error })
  }

  if (error.code === '23503') {
    throw new Error('The selected builder is no longer available.', { cause: error })
  }

  if (error.code === '42501') {
    throw new Error('You do not have permission to change builder contacts.', { cause: error })
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
  const { data, error } = await client
    .from('builder_contacts')
    .insert(toBuilderContactMutation(contact))
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

async function setBuilderContactActive(contactId, isActive) {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('builder_contacts')
    .update({ is_active: isActive })
    .eq('id', contactId)
    .select(BUILDER_CONTACT_COLUMNS)
    .single()

  throwRepositoryError(error)
  return toBuilderContact(data)
}

export function deactivateBuilderContact(contactId) {
  return setBuilderContactActive(contactId, false)
}

export function reactivateBuilderContact(contactId) {
  return setBuilderContactActive(contactId, true)
}
