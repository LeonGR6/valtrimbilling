import { requireSupabase } from '../../../services/api.js'

const SETTINGS_COLUMNS = [
  'business_days_to_complete',
  'workday_starts_at',
  'workday_ends_at',
  'time_zone',
  'company_address',
  'company_latitude',
  'company_longitude',
  'distance_green_max_miles',
  'distance_yellow_max_miles',
  'travel_buffer_minutes',
  'default_duration_minutes',
  'requires_dispatcher_approval',
].join(', ')

const DEFAULT_SETTINGS = {
  businessDaysToComplete: 5,
  workdayStartsAt: '07:00',
  workdayEndsAt: '17:00',
  timeZone: 'America/Los_Angeles',
  companyAddress: '',
  companyLatitude: null,
  companyLongitude: null,
  distanceGreenMaxMiles: 10,
  distanceYellowMaxMiles: 20,
  travelBufferMinutes: 30,
  defaultDurationMinutes: 60,
  requiresDispatcherApproval: true,
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
    if (/appointment|proposal|schedule/i.test(error.message ?? '')) {
      throw new Error(
        'The route is no longer available because its schedule changed. Recalculate the proposals.',
        { cause: error },
      )
    }
    throw new Error('This availability window is already registered.', {
      cause: error,
    })
  }

  if (error.code === '23P01') {
    throw new Error(
      'The route conflicts with the current technician schedule. Recalculate the proposals.',
      { cause: error },
    )
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
    travelBufferMinutes: row.travel_buffer_minutes,
    defaultDurationMinutes: row.default_duration_minutes,
    requiresDispatcherApproval: row.requires_dispatcher_approval,
  }
}

export async function updateCustomerServiceSettings(settings) {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('service_scheduling_settings')
    .update({
      workday_starts_at: settings.workdayStartsAt,
      workday_ends_at: settings.workdayEndsAt,
      time_zone: settings.timeZone,
      company_address: settings.companyAddress,
      company_latitude: settings.latitude,
      company_longitude: settings.longitude,
      distance_green_max_miles: settings.distanceGreenMaxMiles,
      distance_yellow_max_miles: settings.distanceYellowMaxMiles,
      travel_buffer_minutes: settings.travelBufferMinutes,
      default_duration_minutes: settings.defaultDurationMinutes,
      requires_dispatcher_approval: settings.requiresDispatcherApproval,
    })
    .eq('id', 1)
    .select(SETTINGS_COLUMNS)
    .single()

  throwRepositoryError(error)
  return toSettings(data)
}
