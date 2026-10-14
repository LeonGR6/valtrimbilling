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
    error: data.error ?? '',
    syncedAt: data.syncedAt ?? null,
  }

  if ([
    result.created,
    result.updated,
    result.unchanged,
    result.deleted,
    result.failed,
  ].some((count) => !Number.isInteger(count) || count < 0)) {
    throw new Error('Google Calendar returned invalid synchronization counters.')
  }

  return result
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
  return result.failed > 0
    ? `Google Calendar partially synced: ${detail}; ${result.failed} failed.`
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
