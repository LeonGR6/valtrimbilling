import { requireSupabase } from '../../../services/api.js'

const APPOINTMENT_COLUMNS = [
  'id', 'request_id', 'technician_ids', 'window_starts_at', 'window_ends_at',
  'starts_at', 'ends_at', 'pickup_minutes', 'state', 'acceptance', 'updated_at',
].join(', ')

async function functionErrorMessage(error, data, fallback) {
  const payload = data?.error ? data : await error?.context?.clone?.().json().catch(() => null)
  if (payload?.errors?.length) return payload.errors.map((entry) => entry.message).join(' ')
  return payload?.error || error?.message || fallback
}

// Current (not cancelled) appointments and every stored travel estimate. Both are
// small tables read by ADMIN/SCHEDULING under RLS.
export async function loadCustomerServiceSchedule() {
  const client = await requireSupabase()
  const [appointments, travel] = await Promise.all([
    client.from('service_appointments').select(APPOINTMENT_COLUMNS).eq('is_current', true),
    client.from('service_travel_estimates').select('from_request_id, to_request_id, minutes, source'),
  ])
  for (const result of [appointments, travel]) {
    if (result.error) throw new Error(result.error.message || 'The schedule could not be loaded.', { cause: result.error })
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
