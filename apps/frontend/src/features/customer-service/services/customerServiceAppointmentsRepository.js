import { requireSupabase } from '../../../services/api.js'
import { toDistanceBands, upcomingAppointmentRequestIds } from '../utils/appointmentRecords.js'

const APPOINTMENT_COLUMNS = [
  'id', 'request_id', 'technician_ids', 'window_starts_at', 'window_ends_at',
  'starts_at', 'ends_at', 'pickup_minutes', 'state', 'acceptance', 'updated_at',
].join(', ')

async function functionErrorMessage(error, data, fallback) {
  const payload = data?.error ? data : await error?.context?.clone?.().json().catch(() => null)
  if (payload?.errors?.length) return payload.errors.map((entry) => entry.message).join(' ')
  return payload?.error || error?.message || fallback
}

const SETTINGS_COLUMNS = [
  'travel_traffic_mode', 'distance_green_max_miles', 'distance_yellow_max_miles', 'distance_orange_max_miles',
].join(', ')

// Current (not cancelled) appointments, the travel estimates that touch an
// appointment from today onward (the only legs the planner can prefill), the
// travel traffic mode, so the planner knows which Google legs to calculate again,
// and the distance bands used for nearby visits.
export async function loadCustomerServiceSchedule(now = new Date()) {
  const client = await requireSupabase()
  const [appointments, settings] = await Promise.all([
    client.from('service_appointments').select(APPOINTMENT_COLUMNS).eq('is_current', true),
    client.from('service_scheduling_settings').select(SETTINGS_COLUMNS).eq('id', 1).maybeSingle(),
  ])
  for (const result of [appointments, settings]) {
    if (result.error) {
      throw new Error(result.error.message || 'The schedule could not be loaded.', { cause: result.error })
    }
  }
  const travelTrafficMode = settings.data?.travel_traffic_mode ?? 'OFF'
  const distanceBands = toDistanceBands(settings.data)

  const requestIds = upcomingAppointmentRequestIds(appointments.data, now)
  if (!requestIds.length) return { appointments: appointments.data, travelEstimates: [], travelTrafficMode, distanceBands }

  const list = requestIds.join(',')
  const travel = await client.from('service_travel_estimates')
    .select('from_request_id, to_request_id, minutes, source, static_minutes, departure_at, traffic_model')
    .or(`from_request_id.in.(${list}),to_request_id.in.(${list})`)
  if (travel.error) {
    throw new Error(travel.error.message || 'The schedule could not be loaded.', { cause: travel.error })
  }
  return { appointments: appointments.data, travelEstimates: travel.data, travelTrafficMode, distanceBands }
}

// The Edge Function revalidates capacity on the server before saving.
export async function registerCustomerServiceAppointment(payload) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke('customer-service-appointments', { body: payload })
  if (error || data?.error) {
    throw new Error(await functionErrorMessage(error, data, 'The appointment could not be registered.'), { cause: error })
  }
  return data
}

// Google Routes API runs on the server; the key never reaches the browser.
// Each leg returns minutes or null (never zero on failure) with a status.
export async function estimateCustomerServiceTravel(legs) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke('customer-service-travel-estimates', { body: { legs } })
  if (error || data?.error || !Array.isArray(data?.legs)) {
    throw new Error(await functionErrorMessage(error, data, 'Travel times could not be calculated. Enter them manually.'), { cause: error })
  }
  return data.legs
}

export async function cancelCustomerServiceAppointment({ appointmentId, expectedUpdatedAt, reason }) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc('cancel_customer_service_appointment', {
    p_appointment_id: appointmentId, p_expected_updated_at: expectedUpdatedAt, p_reason: reason,
  })
  if (error) throw new Error(error.message || 'The appointment could not be cancelled.', { cause: error })
  return data
}
