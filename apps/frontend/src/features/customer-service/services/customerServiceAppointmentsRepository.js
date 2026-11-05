import { requireSupabase } from '../../../services/api.js'
import { upcomingAppointmentRequestIds } from '../utils/appointmentRecords.js'

const APPOINTMENT_COLUMNS = [
  'id', 'request_id', 'technician_ids', 'window_starts_at', 'window_ends_at',
  'starts_at', 'ends_at', 'pickup_minutes', 'state', 'acceptance', 'updated_at',
].join(', ')

async function functionErrorMessage(error, data, fallback) {
  const payload = data?.error ? data : await error?.context?.clone?.().json().catch(() => null)
  if (payload?.errors?.length) return payload.errors.map((entry) => entry.message).join(' ')
  return payload?.error || error?.message || fallback
}

// Current (not cancelled) appointments, and the travel estimates that touch an
// appointment from today onward (the only legs the planner can prefill).
export async function loadCustomerServiceSchedule(now = new Date()) {
  const client = await requireSupabase()
  const appointments = await client.from('service_appointments').select(APPOINTMENT_COLUMNS).eq('is_current', true)
  if (appointments.error) {
    throw new Error(appointments.error.message || 'The schedule could not be loaded.', { cause: appointments.error })
  }

  const requestIds = upcomingAppointmentRequestIds(appointments.data, now)
  if (!requestIds.length) return { appointments: appointments.data, travelEstimates: [] }

  const list = requestIds.join(',')
  const travel = await client.from('service_travel_estimates')
    .select('from_request_id, to_request_id, minutes, source')
    .or(`from_request_id.in.(${list}),to_request_id.in.(${list})`)
  if (travel.error) {
    throw new Error(travel.error.message || 'The schedule could not be loaded.', { cause: travel.error })
  }
  return { appointments: appointments.data, travelEstimates: travel.data }
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

export async function cancelCustomerServiceAppointment({ appointmentId, expectedUpdatedAt, reason }) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc('cancel_customer_service_appointment', {
    p_appointment_id: appointmentId, p_expected_updated_at: expectedUpdatedAt, p_reason: reason,
  })
  if (error) throw new Error(error.message || 'The appointment could not be cancelled.', { cause: error })
  return data
}
