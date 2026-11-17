const googleCalendarLastSyncFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

export function toGoogleCalendarConnection(row) {
  if (!row) return null
  return {
    userId: row.user_id,
    calendarId: row.google_calendar_id,
    calendarSummary: row.calendar_summary,
    grantedScope: row.granted_scope,
    status: row.status,
    connectedAt: row.connected_at,
    lastError: row.last_error ?? '',
    lastSyncAt: row.last_sync_at ?? null,
    lastSyncStatus: row.last_sync_status ?? 'NEVER_SYNCED',
    lastSyncCreatedCount: Number(row.last_sync_created_count ?? 0),
    lastSyncUpdatedCount: Number(row.last_sync_updated_count ?? 0),
    lastSyncUnchangedCount: Number(row.last_sync_unchanged_count ?? 0),
    lastSyncDeletedCount: Number(row.last_sync_deleted_count ?? 0),
    lastSyncFailedCount: Number(row.last_sync_failed_count ?? 0),
    updatedAt: row.updated_at,
  }
}

export function googleCalendarLastSyncLabel(value) {
  if (!value) return 'Not synced yet'

  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) return 'Sync time unavailable'

  return `Last sync: ${googleCalendarLastSyncFormatter.format(timestamp)}`
}

export function toGoogleCalendarSyncResult(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Google Calendar returned an invalid synchronization result.')
  }

  const result = {
    ok: Boolean(data.ok),
    created: Number(data.created),
    updated: Number(data.updated),
    unchanged: Number(data.unchanged),
    deleted: Number(data.deleted),
    failed: Number(data.failed),
    // Absent from older deployments of the function: nothing left to ask for.
    remaining: Number(data.remaining ?? 0),
    error: data.error ?? '',
    syncedAt: data.syncedAt ?? null,
  }

  if ([
    result.created,
    result.updated,
    result.unchanged,
    result.deleted,
    result.failed,
    result.remaining,
  ].some((count) => !Number.isInteger(count) || count < 0)) {
    throw new Error('Google Calendar returned invalid synchronization counters.')
  }

  return result
}

// A big sync is answered in several calls, each one saving what it finished.
// Creates, updates and deletions happen once, so they add up; "unchanged",
// "failed" and "remaining" describe the calendar as the last call found it
// (events created by an earlier call are unchanged by the next one).
export function combineGoogleCalendarSyncRounds(rounds) {
  const last = rounds[rounds.length - 1]
  const total = (key) => rounds.reduce((sum, round) => sum + round[key], 0)

  return {
    ...last,
    created: total('created'),
    updated: total('updated'),
    deleted: total('deleted'),
  }
}

export function googleSyncSummary(result) {
  const counts = [
    [result.created, 'created'],
    [result.updated, 'updated'],
    [result.unchanged, 'unchanged'],
    [result.deleted, 'deleted'],
  ].filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`)

  const detail = counts.length > 0 ? counts.join(', ') : 'no Production events'
  const pending = result.remaining > 0
    ? ` ${result.remaining} still pending: press Sync now again to finish.`
    : ''
  if (result.failed > 0) {
    return `Google Calendar partially synced: ${detail}; ${result.failed} failed.${pending}`
  }
  return result.remaining > 0
    ? `Google Calendar partially synced: ${detail}.${pending}`
    : `Google Calendar synced: ${detail}.`
}

export function googleOAuthReturnMessage(reason) {
  switch (reason) {
    case 'access_denied':
      return 'Google Calendar access was not granted.'
    case 'invalid_state':
      return 'The Google Calendar connection expired. Please try again.'
    case 'missing_code':
      return 'Google did not return an authorization code. Please try again.'
    default:
      return 'Google Calendar could not be connected. Review the Edge Function logs and try again.'
  }
}
