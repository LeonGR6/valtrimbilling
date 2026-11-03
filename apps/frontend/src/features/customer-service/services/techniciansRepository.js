import { requireSupabase } from '../../../services/api.js'

const COLUMNS = [
  'id',
  'name',
  'email',
  'phone',
  'is_active',
  'workday_starts_at',
  'workday_ends_at',
  'start_latitude',
  'start_longitude',
  'is_operational',
].join(', ')

function toTechnician(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email ?? '',
    phone: row.phone ?? '',
    isActive: row.is_active,
    workdayStartsAt: row.workday_starts_at?.slice(0, 5) ?? '',
    workdayEndsAt: row.workday_ends_at?.slice(0, 5) ?? '',
    startLatitude: row.start_latitude == null ? null : Number(row.start_latitude),
    startLongitude: row.start_longitude == null ? null : Number(row.start_longitude),
    isOperational: Boolean(row.is_operational),
  }
}

function checkError(error) {
  if (!error) return
  if (error.code === '23505') {
    throw new Error('A person with that email already exists.', { cause: error })
  }
  if (error.code === '42501') {
    throw new Error('You do not have permission to manage technicians.', { cause: error })
  }
  if (error.code === '22023' || error.code === '23514') {
    throw new Error('Review the technician’s work hours and start coordinates.', { cause: error })
  }
  throw new Error(error.message || 'The technicians request failed.', { cause: error })
}

export async function listTechnicians() {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('service_technician_roster')
    .select(COLUMNS)
    .order('name', { ascending: true })

  checkError(error)
  return data.map(toTechnician)
}

export async function createTechnician(technician) {
  const client = await requireSupabase()
  const { data: id, error } = await client.rpc('create_service_technician', {
    p_name: technician.name,
    p_email: technician.email || null,
    p_phone: technician.phone || null,
    p_workday_starts_at: technician.workdayStartsAt,
    p_workday_ends_at: technician.workdayEndsAt,
    p_start_latitude: technician.latitude ?? technician.startLatitude,
    p_start_longitude: technician.longitude ?? technician.startLongitude,
  })
  checkError(error)

  const { data, error: loadError } = await client
    .from('service_technician_roster')
    .select(COLUMNS)
    .eq('id', id)
    .single()
  checkError(loadError)
  return toTechnician(data)
}

export async function updateTechnician(id, technician) {
  const client = await requireSupabase()
  const { error } = await client.rpc('update_service_technician', {
    p_technician_id: id,
    p_name: technician.name,
    p_email: technician.email || null,
    p_phone: technician.phone || null,
    p_is_active: technician.isActive,
    p_workday_starts_at: technician.workdayStartsAt,
    p_workday_ends_at: technician.workdayEndsAt,
    p_start_latitude: technician.latitude ?? technician.startLatitude,
    p_start_longitude: technician.longitude ?? technician.startLongitude,
  })
  checkError(error)

  const { data, error: loadError } = await client
    .from('service_technician_roster')
    .select(COLUMNS)
    .eq('id', id)
    .single()

  checkError(loadError)
  return toTechnician(data)
}
