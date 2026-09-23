import { requireSupabase } from '../../../services/api.js'
import {
  toGoogleCalendarConnection,
  toGoogleCalendarSyncResult,
} from './googleCalendarRecord.js'

const OAUTH_START_FUNCTION = 'google-calendar-oauth-start'
const SYNC_FUNCTION = 'google-calendar-sync'
const CONNECTION_COLUMNS = [
  'user_id',
  'google_calendar_id',
  'calendar_summary',
  'granted_scope',
  'status',
  'connected_at',
  'last_error',
  'last_sync_at',
  'last_sync_status',
  'last_sync_created_count',
  'last_sync_updated_count',
  'last_sync_unchanged_count',
  'last_sync_deleted_count',
  'last_sync_failed_count',
  'updated_at',
].join(', ')

async function functionErrorMessage(error, data) {
  if (data?.error) return data.error

  const response = error?.context
  if (response && typeof response.clone === 'function') {
    const responsePayload = await response.clone().json().catch(() => null)
    if (responsePayload?.error) return responsePayload.error
  }

  return error?.message || 'The Google Calendar request failed.'
}

export async function getGoogleCalendarConnection() {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('google_calendar_connections')
    .select(CONNECTION_COLUMNS)
    .maybeSingle()
  if (error) throw error
  return toGoogleCalendarConnection(data)
}

export async function startGoogleCalendarOAuth() {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(OAUTH_START_FUNCTION, {
    body: {},
  })

  if (error || data?.error) {
    throw new Error(await functionErrorMessage(error, data), { cause: error })
  }

  if (!data?.authorizationUrl) {
    throw new Error('Google Calendar did not return an authorization URL.')
  }

  const authorizationUrl = new URL(data.authorizationUrl)
  if (authorizationUrl.origin !== 'https://accounts.google.com') {
    throw new Error('Google Calendar returned an invalid authorization URL.')
  }
  return authorizationUrl.toString()
}

export async function syncGoogleCalendarNow() {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(SYNC_FUNCTION, {
    body: {},
  })

  if (error) {
    throw new Error(await functionErrorMessage(error, data), { cause: error })
  }

  return toGoogleCalendarSyncResult(data)
}
