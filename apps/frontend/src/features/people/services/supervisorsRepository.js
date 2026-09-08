import { requireSupabase } from '../../../services/api.js'
import {
  toSupervisor,
  toSupervisorMutation,
} from './supervisorRecord.js'

const SUPERVISOR_COLUMNS = [
  'id',
  'name',
  'email',
  'phone',
  'office_phone',
  'territory',
  'is_active',
].join(', ')

function throwRepositoryError(error) {
  if (!error) return

  if (error.code === '23505') {
    throw new Error('A supervisor with that email already exists.', { cause: error })
  }

  if (error.code === '42501') {
    throw new Error('You do not have permission to change supervisors.', { cause: error })
  }

  throw new Error(error.message || 'The supervisors request failed.', { cause: error })
}

async function getSupervisor(client, supervisorId) {
  const { data, error } = await client
    .from('people')
    .select(SUPERVISOR_COLUMNS)
    .eq('id', supervisorId)
    .single()

  throwRepositoryError(error)
  return toSupervisor(data)
}

export async function listSupervisors() {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('people')
    .select(SUPERVISOR_COLUMNS)
    .order('name', { ascending: true })

  throwRepositoryError(error)
  return data.map(toSupervisor)
}

export async function createSupervisor(supervisor) {
  const client = await requireSupabase()
  const mutation = toSupervisorMutation(supervisor)
  const { data: supervisorId, error } = await client.rpc('create_supervisor', {
    p_name: mutation.name,
    p_email: mutation.email,
    p_phone: mutation.phone,
    p_office_phone: mutation.office_phone,
    p_territory: mutation.territory,
  })

  throwRepositoryError(error)
  return getSupervisor(client, supervisorId)
}

export async function updateSupervisor(supervisorId, supervisor) {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('people')
    .update(toSupervisorMutation(supervisor))
    .eq('id', supervisorId)
    .select(SUPERVISOR_COLUMNS)
    .single()

  throwRepositoryError(error)
  return toSupervisor(data)
}

export async function deactivateSupervisor(supervisorId) {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('people')
    .update({ is_active: false })
    .eq('id', supervisorId)
    .select(SUPERVISOR_COLUMNS)
    .single()

  throwRepositoryError(error)
  return toSupervisor(data)
}
