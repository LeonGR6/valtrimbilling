import { requireSupabase } from '../../../services/api.js'
import {
  combineGoogleCalendarSyncRounds,
  toGoogleCalendarConnection,
  toGoogleCalendarSyncResult,
} from './googleCalendarRecord.js'
import { functionErrorMessage } from '../../../services/functionErrors.js'

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
    throw new Error(await functionErrorMessage(error, data, 'The Google Calendar request failed.'), { cause: error })
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

// The function stops starting Google writes after about 90 s so it is never cut
// off mid-sync; it saves what it did and reports `remaining`. Ask again until
// nothing is left, as long as each call makes progress.
const MAX_SYNC_ROUNDS = 12

export async function syncGoogleCalendarNow() {
  const client = await requireSupabase()
  const rounds = []

  for (let round = 0; round < MAX_SYNC_ROUNDS; round += 1) {
    const { data, error } = await client.functions.invoke(SYNC_FUNCTION, {
      body: {},
    })

    if (error) {
      throw new Error(await functionErrorMessage(error, data, 'The Google Calendar request failed.'), { cause: error })
    }

    const result = toGoogleCalendarSyncResult(data)
    rounds.push(result)

    const previous = rounds[rounds.length - 2]
    if (result.remaining === 0 || (previous && result.remaining >= previous.remaining)) break
  }

  return combineGoogleCalendarSyncRounds(rounds)
}
