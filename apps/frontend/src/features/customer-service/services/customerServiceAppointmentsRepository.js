import { requireSupabase } from '../../../services/api.js'
import { toDistanceBands, upcomingAppointmentRequestIds } from '../utils/appointmentRecords.js'
import { getCustomerServiceClock } from '../utils/dates.js'

const APPOINTMENT_COLUMNS = [
  'id', 'request_id', 'technician_ids', 'window_starts_at', 'window_ends_at',
  'starts_at', 'ends_at', 'pickup_minutes', 'state', 'acceptance', 'updated_at',
].join(', ')

async function functionErrorMessage(error, data, fallback) {
  const payload = data?.error ? data : await error?.context?.clone?.().json().catch(() => null)
  if (payload?.errors?.length) return payload.errors.map((entry) => entry.message).join(' ')
  return payload?.error || error?.message || fallback
}

// Options of proposals still waiting for the customer: they occupy their technicians.
const HOLD_COLUMNS = [
  'option_id', 'option_number', 'proposal_id', 'request_id', 'sent_at', 'technician_ids',
  'window_starts_at', 'window_ends_at', 'starts_at', 'ends_at', 'pickup_minutes',
].join(', ')

// Each request's proposals, newest first: the one waiting for the customer, or the
// customer's last answer (a counter-proposal or a rejection) shown while re-planning.
const PROPOSAL_COLUMNS = [
  'id', 'request_id', 'status', 'sender_mailbox', 'sent_at', 'reminder_sent_at', 'builder_contacted_at',
  'responded_at', 'response_via', 'counter_dates', 'counter_day_part', 'customer_note', 'cancelled_at', 'cancel_reason',
  'alternatives',
].join(', ')

const SETTINGS_COLUMNS = [
  'travel_traffic_mode', 'distance_green_max_miles', 'distance_yellow_max_miles', 'distance_orange_max_miles', 'test_mode',
].join(', ')

// Follow-ups of the proposals still waiting for the customer (block B, step B7): the
// 24-hour reminder emails and the Builder to call at 48 hours (the Job's jobsite
// superintendent). They only add notes on screen, so a failure to read them never
// blocks the schedule.
async function loadProposalFollowUps(client, proposals) {
  const requestIds = [...new Set(proposals.filter((row) => row.status === 'SENT').map((row) => row.request_id))]
  if (!requestIds.length) return { reminders: [], builderContacts: [] }
  const [reminders, contacts] = await Promise.all([
    client.from('service_communications')
      .select('request_id, status, occurred_at, error_message, metadata')
      .eq('communication_type', 'REMINDER')
      .in('request_id', requestIds),
    client.from('service_requests')
      .select('id, service_properties(jobs(builders(name), superintendent:builder_contacts!jobs_superintendent_id_builder_id_superintendent_type_fkey(name, phone, office_phone, email)))')
      .in('id', requestIds),
  ])
  return { reminders: reminders.error ? [] : reminders.data, builderContacts: contacts.error ? [] : contacts.data }
}

// The days Valtrim is closed (service_holidays, 24 Nov 2026), for Calendar and the business
// day rules. The server checks them again, so a failure to read them never blocks the
// schedule.
async function loadHolidays(client) {
  const { data, error } = await client.from('service_holidays').select('holiday_date, name').order('holiday_date')
  if (error) return []
  return data.map((row) => ({ date: row.holiday_date, name: row.name }))
}

// Day-before traffic checks for visit dates from today on (block R6). They only add a
// note on screen, so a failure to read them never blocks the schedule.
async function loadTravelChecks(client, now) {
  const { data, error } = await client.from('service_travel_check_runs')
    .select('target_date, checked_at, legs, refreshed, failed')
    .gte('target_date', getCustomerServiceClock(now).date)
    .order('target_date')
  if (error) return []
  return data.map((run) => ({
    targetDate: run.target_date, checkedAt: run.checked_at, legs: run.legs, refreshed: run.refreshed, failed: run.failed,
  }))
}

// Current (not cancelled) appointments, the days held by sent proposals, the proposals, the travel
// estimates that touch one of them from today onward (the only legs the planner can prefill), the
// travel traffic mode, so the planner knows which Google legs to calculate again,
// the distance bands used for nearby visits and the day-before traffic checks.
export async function loadCustomerServiceSchedule(now = new Date()) {
  const client = await requireSupabase()
  const [appointments, holds, proposals, settings, travelChecks, holidays] = await Promise.all([
    client.from('service_appointments').select(APPOINTMENT_COLUMNS).eq('is_current', true),
    client.from('service_proposal_holds').select(HOLD_COLUMNS),
    client.from('service_proposals').select(PROPOSAL_COLUMNS).order('sent_at', { ascending: false }),
    client.from('service_scheduling_settings').select(SETTINGS_COLUMNS).eq('id', 1).maybeSingle(),
    loadTravelChecks(client, now),
    loadHolidays(client),
  ])
  for (const result of [appointments, holds, proposals, settings]) {
    if (result.error) {
      throw new Error(result.error.message || 'The schedule could not be loaded.', { cause: result.error })
    }
  }
  const travelTrafficMode = settings.data?.travel_traffic_mode ?? 'OFF'
  const distanceBands = toDistanceBands(settings.data)
  // Cancelling a visit or a proposal is for cleaning up tests only (decided 23 Nov 2026).
  const testMode = settings.data?.test_mode === true

  const loaded = {
    appointments: appointments.data, proposalHolds: holds.data, proposals: proposals.data, travelTrafficMode, distanceBands, testMode,
    holidays,
    travelChecks, proposalFollowUps: await loadProposalFollowUps(client, proposals.data),
  }

  const requestIds = upcomingAppointmentRequestIds([...appointments.data, ...holds.data], now)
  if (!requestIds.length) return { ...loaded, travelEstimates: [] }

  const list = requestIds.join(',')
  const travel = await client.from('service_travel_estimates')
    .select('from_request_id, to_request_id, minutes, source, static_minutes, departure_at, traffic_model, google_minutes')
    .or(`from_request_id.in.(${list}),to_request_id.in.(${list})`)
  if (travel.error) {
    throw new Error(travel.error.message || 'The schedule could not be loaded.', { cause: travel.error })
  }
  return { ...loaded, travelEstimates: travel.data }
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

// Driving miles and distance bands for nearby candidates (Route Matrix on the server,
// without traffic). Candidates Google could not measure come back without miles.
export async function estimateCustomerServiceNearby({ requestId, candidateIds }) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke('customer-service-travel-estimates', {
    body: { nearby: { requestId, candidateIds } },
  })
  if (error || data?.error || !Array.isArray(data?.candidates)) {
    throw new Error(await functionErrorMessage(error, data, 'Driving miles could not be checked.'), { cause: error })
  }
  return data.candidates
}

// Reschedule block (27 Nov 2026): the same Edge Function moves or cancels a confirmed
// visit and closes a request without one. Moving revalidates capacity like registering.
async function invokeAppointments(body, fallback) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke('customer-service-appointments', { body })
  if (error || data?.error) throw new Error(await functionErrorMessage(error, data, fallback), { cause: error })
  return data
}

export function rescheduleCustomerServiceVisit(payload) {
  return invokeAppointments({ action: 'reschedule', ...payload }, 'The visit could not be moved.')
}

export function cancelCustomerServiceVisit(payload) {
  return invokeAppointments({ action: 'cancel', ...payload }, 'The visit could not be cancelled.')
}

export function closeCustomerServiceRequest(payload) {
  return invokeAppointments({ action: 'close', ...payload }, 'The request could not be closed.')
}

// Proposals (block B, steps B4 path b and B6). The Edge Function revalidates capacity,
// holds the days and emails the invitation; it also records the customer's answer.
async function invokeProposals(body, fallback) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke('customer-service-proposals', { body })
  if (error || data?.error) throw new Error(await functionErrorMessage(error, data, fallback), { cause: error })
  return data
}

export function sendCustomerServiceProposal(payload) {
  return invokeProposals({ action: 'send', ...payload }, 'The proposal could not be sent.')
}

export function answerCustomerServiceProposal(payload) {
  return invokeProposals(payload, 'The answer could not be recorded.')
}

// No capacity rule: the guarded RPC releases the held days.
export async function cancelCustomerServiceProposal({ proposalId, reason }) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc('cancel_customer_service_proposal', { p_proposal_id: proposalId, p_reason: reason })
  if (error) throw new Error(error.message || 'The proposal could not be cancelled.', { cause: error })
  return data
}

// The coordinator called the Builder about a proposal still waiting (step B7).
export async function markProposalBuilderContacted(proposalId) {
  const client = await requireSupabase()
  const { data, error } = await client.rpc('mark_customer_service_proposal_builder_contacted', { p_proposal_id: proposalId })
  if (error) throw new Error(error.message || 'The Builder call could not be recorded.', { cause: error })
  return data
}
