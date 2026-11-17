import { requireSupabase } from '../../../services/api.js'
import {
  sameContactTypes,
  toCompanyContact,
  toCompanyContactMutation,
} from './companyContactRecord.js'

const COMPANY_CONTACT_COLUMNS = [
  'id',
  'name',
  'email',
  'phone',
  'office_phone',
  'territory',
  'is_active',
  'person_roles(role)',
].join(', ')

function throwRepositoryError(error) {
  if (!error) return

  if (error.code === '23505') {
    throw new Error('A Company Contact with that email already exists.', { cause: error })
  }

  if (error.code === '42501') {
    throw new Error('You do not have permission to change Company Contacts.', { cause: error })
  }

  throw new Error(error.message || 'The Company Contacts request failed.', { cause: error })
}

async function getCompanyContact(client, contactId) {
  const { data, error } = await client
    .from('people')
    .select(COMPANY_CONTACT_COLUMNS)
    .eq('id', contactId)
    .single()

  throwRepositoryError(error)
  return toCompanyContact(data)
}

export async function listCompanyContacts() {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('people')
    .select(COMPANY_CONTACT_COLUMNS)
    .order('name', { ascending: true })

  throwRepositoryError(error)
  return data.map(toCompanyContact)
}

export async function createCompanyContact(contact) {
  const client = await requireSupabase()
  const mutation = toCompanyContactMutation(contact)
  const { data: contactId, error } = await client.rpc('create_company_contact', {
    p_name: mutation.name,
    p_email: mutation.email,
    p_phone: mutation.phone,
    p_office_phone: mutation.office_phone,
    p_territory: mutation.territory,
    p_roles: contact.types,
  })

  throwRepositoryError(error)
  return getCompanyContact(client, contactId)
}

export async function updateCompanyContact(contactId, contact) {
  const client = await requireSupabase()
  const current = await getCompanyContact(client, contactId)

  const updateDetails = async () => {
    const { error } = await client
      .from('people')
      .update(toCompanyContactMutation(contact))
      .eq('id', contactId)
    throwRepositoryError(error)
  }
  const updateTypes = async () => {
    if (sameContactTypes(current.types, contact.types)) return
    const { error } = await client.rpc('set_company_contact_roles', {
      p_person_id: contactId,
      p_roles: contact.types,
    })
    throwRepositoryError(error)
  }

  // A Supervisor needs a territory. A person who becomes one is given the
  // territory first; one who stops being one loses the type first.
  const becomesSupervisor =
    contact.types.includes('SUPERVISOR') && !current.types.includes('SUPERVISOR')
  if (becomesSupervisor) {
    await updateDetails()
    await updateTypes()
  } else {
    await updateTypes()
    await updateDetails()
  }

  return getCompanyContact(client, contactId)
}

export async function deactivateCompanyContact(contactId) {
  const client = await requireSupabase()
  const { error } = await client
    .from('people')
    .update({ is_active: false })
    .eq('id', contactId)

  throwRepositoryError(error)
  return getCompanyContact(client, contactId)
}
