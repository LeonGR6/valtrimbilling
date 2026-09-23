import { requireSupabase } from '../../../services/api.js'
import {
  toCustomerServiceRequest,
  toCustomerServiceRpcPayload,
} from './customerServiceRecord.js'

const REQUEST_DETAIL_COLUMNS = [
  'id',
  'folio',
  'property_id',
  'reported_on',
  'due_on',
  'status',
  'tag',
  'priority',
  'request_type',
  'work_type',
  'estimated_duration_minutes',
  'homeowner_name',
  'homeowner_email',
  'homeowner_phone',
  'description',
  'internal_notes',
  'customer_availability_notes',
  'resolution_status',
  'completion_notes',
  'exception_reason',
  'status_before_close',
  'closed_at',
  'close_reason',
  'coordinator_user_id',
  'community_id',
  'builder_id',
  'builder_name',
  'community_name',
  'lot_number',
  'address',
  'city',
  'state',
  'postal_code',
  'plan_label',
  'latitude',
  'longitude',
  'current_appointment_id',
  'starts_at',
  'ends_at',
  'appointment_state',
  'confirmation_status',
  'technician_id',
  'technician_name',
  'created_at',
  'updated_at',
  'is_ready_to_schedule',
  'is_overdue',
].join(', ')

const DEFAULT_SETTINGS = {
  businessDaysToComplete: 5,
  workdayStartsAt: '08:00',
  workdayEndsAt: '17:00',
  timeZone: 'America/Los_Angeles',
  companyAddress: '',
  companyLatitude: null,
  companyLongitude: null,
  distanceGreenMaxMiles: 10,
  distanceYellowMaxMiles: 20,
}

function throwRepositoryError(error) {
  if (!error) return

  if (error.code === '42501') {
    throw new Error(
      'You do not have permission to manage Customer Service requests.',
      { cause: error },
    )
  }

  if (error.code === '23503') {
    throw new Error(
      'The selected Customer Service record is no longer available.',
      { cause: error },
    )
  }

  if (error.code === '23505') {
    throw new Error('This availability window is already registered.', {
      cause: error,
    })
  }

  throw new Error(error.message || 'The Customer Service request failed.', {
    cause: error,
  })
}

function toSettings(row) {
  if (!row) return DEFAULT_SETTINGS

  return {
    businessDaysToComplete: row.business_days_to_complete,
    workdayStartsAt: row.workday_starts_at,
    workdayEndsAt: row.workday_ends_at,
    timeZone: row.time_zone,
    companyAddress: row.company_address ?? '',
    companyLatitude: row.company_latitude === null
      ? null
      : Number(row.company_latitude),
    companyLongitude: row.company_longitude === null
      ? null
      : Number(row.company_longitude),
    distanceGreenMaxMiles: Number(row.distance_green_max_miles),
    distanceYellowMaxMiles: Number(row.distance_yellow_max_miles),
  }
}

export async function loadCustomerServiceCatalog() {
  const client = await requireSupabase()
  const [detailsResult, availabilityResult, settingsResult] =
    await Promise.all([
      client
        .from('service_request_detail')
        .select(REQUEST_DETAIL_COLUMNS)
        .order('created_at', { ascending: false }),
      client
        .from('service_request_availability')
        .select('id, request_id, available_from, available_until, notes')
        .order('available_from', { ascending: true }),
      client
        .from('service_scheduling_settings')
        .select([
          'business_days_to_complete',
          'workday_starts_at',
          'workday_ends_at',
          'time_zone',
          'company_address',
          'company_latitude',
          'company_longitude',
          'distance_green_max_miles',
          'distance_yellow_max_miles',
        ].join(', '))
        .eq('id', 1)
        .maybeSingle(),
    ])

  for (const result of [
    detailsResult,
    availabilityResult,
    settingsResult,
  ]) throwRepositoryError(result.error)

  const settings = toSettings(settingsResult.data)
  const availabilityByRequest = new Map()
  for (const window of availabilityResult.data ?? []) {
    const windows = availabilityByRequest.get(window.request_id) ?? []
    windows.push(window)
    availabilityByRequest.set(window.request_id, windows)
  }

  return {
    requests: (detailsResult.data ?? []).map((row) =>
      toCustomerServiceRequest(
        row,
        availabilityByRequest.get(row.id) ?? [],
        settings,
      )),
    settings,
  }
}

export async function createCustomerServiceRequest(form, timeZone) {
  const client = await requireSupabase()
  const payload = toCustomerServiceRpcPayload(form, timeZone)
  const { data, error } = await client.rpc('create_customer_service_request', {
    p_property: payload.property,
    p_request: payload.request,
    p_availability: payload.availability,
  })

  throwRepositoryError(error)
  return data
}

export async function updateCustomerServiceRequest(
  requestId,
  form,
  timeZone,
) {
  const client = await requireSupabase()
  const payload = toCustomerServiceRpcPayload(form, timeZone)
  const { data, error } = await client.rpc('update_customer_service_request', {
    p_request_id: requestId,
    p_property: payload.property,
    p_request: payload.request,
    p_availability: payload.availability,
  })

  throwRepositoryError(error)
  return data
}

export async function closeCustomerServiceRequest(requestId, reason) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc('close_customer_service_request', {
    p_request_id: requestId,
    p_reason: reason,
  })

  throwRepositoryError(error)
  return data
}

export async function reopenCustomerServiceRequest(requestId, note) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc('reopen_customer_service_request', {
    p_request_id: requestId,
    p_note: note || '',
  })

  throwRepositoryError(error)
  return data
}
