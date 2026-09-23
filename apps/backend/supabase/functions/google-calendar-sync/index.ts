import { handlePreflight, json } from '../_shared/cors.ts'
import {
  refreshGoogleAccessToken,
  requiresGoogleReconnect,
  synchronizeGoogleCalendar,
  type GoogleCalendarSyncOutcome,
  type GoogleCalendarSyncSnapshot,
} from '../_shared/googleCalendarSync.ts'
import { serviceClient, userClient } from '../_shared/supabase.ts'

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing Edge Function secret: ${name}.`)
  return value
}

function isSnapshot(value: unknown): value is GoogleCalendarSyncSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Record<string, unknown>
  return typeof snapshot.calendarId === 'string'
    && typeof snapshot.refreshToken === 'string'
    && Array.isArray(snapshot.schedules)
    && Array.isArray(snapshot.links)
}

function emptyFailure(message: string): GoogleCalendarSyncOutcome {
  return {
    created: 0,
    updated: 0,
    unchanged: 0,
    deleted: 0,
    failed: 1,
    lastError: message.slice(0, 1000),
    results: [],
  }
}

async function finishSync(
  admin: ReturnType<typeof serviceClient>,
  userId: string,
  outcome: GoogleCalendarSyncOutcome,
  connectionError: boolean,
) {
  const { data, error } = await admin.rpc('finish_google_calendar_sync', {
    p_user_id: userId,
    p_results: outcome.results,
    p_created_count: outcome.created,
    p_updated_count: outcome.updated,
    p_unchanged_count: outcome.unchanged,
    p_deleted_count: outcome.deleted,
    p_failed_count: outcome.failed,
    p_last_error: outcome.lastError,
    p_connection_error: connectionError,
  })
  if (error) throw error
  return data as string
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  let admin: ReturnType<typeof serviceClient> | null = null
  let syncUserId: string | null = null
  let leaseAcquired = false

  try {
    const caller = userClient(req)
    const {
      data: { user },
      error: authError,
    } = await caller.auth.getUser()

    if (authError || !user) return json({ error: 'Sign in first.' }, 401)

    const { data: profile, error: profileError } = await caller
      .from('app_users')
      .select('role, is_active')
      .eq('id', user.id)
      .maybeSingle()

    if (profileError) throw profileError
    if (!profile?.is_active || profile.role !== 'ADMIN') {
      return json({ error: 'Only an administrator can synchronize Google Calendar.' }, 403)
    }

    admin = serviceClient()
    syncUserId = user.id
    const { data: rawSnapshot, error: snapshotError } = await admin.rpc(
      'begin_google_calendar_sync',
      { p_user_id: user.id },
    )

    if (snapshotError?.code === '55P03') {
      return json({ error: 'A Google Calendar synchronization is already running.' }, 409)
    }
    if (snapshotError?.code === 'P0002') {
      return json({ error: 'Connect Google Calendar again before synchronizing.' }, 409)
    }
    if (snapshotError) throw snapshotError
    leaseAcquired = true

    if (!isSnapshot(rawSnapshot)) {
      throw new Error('The Google Calendar synchronization snapshot is invalid.')
    }

    const accessToken = await refreshGoogleAccessToken(
      requiredEnv('GOOGLE_CALENDAR_CLIENT_ID'),
      requiredEnv('GOOGLE_CALENDAR_CLIENT_SECRET'),
      rawSnapshot.refreshToken,
    )
    const outcome = await synchronizeGoogleCalendar(rawSnapshot, accessToken)
    const syncedAt = await finishSync(admin, user.id, outcome, false)
    leaseAcquired = false

    return json({
      ok: outcome.failed === 0,
      created: outcome.created,
      updated: outcome.updated,
      unchanged: outcome.unchanged,
      deleted: outcome.deleted,
      failed: outcome.failed,
      error: outcome.lastError,
      syncedAt,
    })
  } catch (error) {
    const reconnect = requiresGoogleReconnect(error)
    const internalMessage = error instanceof Error
      ? error.message
      : 'Unknown Google Calendar synchronization error.'

    if (leaseAcquired && admin && syncUserId) {
      try {
        await finishSync(
          admin,
          syncUserId,
          emptyFailure(reconnect
            ? 'Google Calendar authorization is no longer valid. Reconnect Google Calendar.'
            : internalMessage),
          reconnect,
        )
      } catch (finishError) {
        console.error('Recording Google Calendar sync failure failed:', finishError)
      }
    }

    console.error('Google Calendar synchronization failed:', error)
    return json({
      error: reconnect
        ? 'Google Calendar authorization expired or the dedicated calendar is unavailable. Reconnect Google Calendar.'
        : 'Google Calendar could not be synchronized. Review the Edge Function logs and try again.',
    }, reconnect ? 409 : 500)
  }
})
