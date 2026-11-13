import assert from 'node:assert/strict'
import test from 'node:test'
import {
  googleCalendarLastSyncLabel,
  googleOAuthReturnMessage,
  googleSyncSummary,
  toGoogleCalendarConnection,
  toGoogleCalendarSyncResult,
} from '../src/features/calendar/services/googleCalendarRecord.js'

test('Google Calendar last sync labels include a local date and time', () => {
  const label = googleCalendarLastSyncLabel('2026-09-14T21:00:00Z')

  assert.match(label, /^Last sync: /)
  assert.match(label, /2026/)
  assert.equal(googleCalendarLastSyncLabel(null), 'Not synced yet')
  assert.equal(googleCalendarLastSyncLabel('invalid'), 'Sync time unavailable')
})

test('Google Calendar connection rows omit the Vault secret boundary', () => {
  const connection = toGoogleCalendarConnection({
    user_id: '00000000-0000-4000-8000-000000000001',
    google_calendar_id: 'calendar@group.calendar.google.com',
    calendar_summary: 'ValtrimBilling Test',
    granted_scope: 'https://www.googleapis.com/auth/calendar.app.created',
    status: 'CONNECTED',
    connected_at: '2026-09-14T20:00:00Z',
    last_error: null,
    last_sync_at: '2026-09-14T21:00:00Z',
    last_sync_status: 'SUCCESS',
    last_sync_created_count: 3,
    last_sync_updated_count: 0,
    last_sync_unchanged_count: 0,
    last_sync_deleted_count: 0,
    last_sync_failed_count: 0,
    updated_at: '2026-09-14T20:00:00Z',
    refresh_token_secret_id: 'must-not-cross-the-browser-boundary',
  })

  assert.equal(connection.calendarSummary, 'ValtrimBilling Test')
  assert.equal(connection.status, 'CONNECTED')
  assert.equal(connection.lastSyncStatus, 'SUCCESS')
  assert.equal(connection.lastSyncCreatedCount, 3)
  assert.equal('refreshTokenSecretId' in connection, false)
})

test('OAuth callback reasons become actionable messages', () => {
  assert.match(googleOAuthReturnMessage('invalid_state'), /expired/)
  assert.match(googleOAuthReturnMessage('access_denied'), /not granted/)
  assert.match(googleOAuthReturnMessage('oauth_failed'), /Edge Function logs/)
})

test('Google Calendar sync results validate counters and produce a useful summary', () => {
  const result = toGoogleCalendarSyncResult({
    ok: true,
    created: 3,
    updated: 1,
    unchanged: 2,
    deleted: 1,
    failed: 0,
    error: null,
    syncedAt: '2026-09-14T21:00:00Z',
  })

  assert.equal(result.created, 3)
  assert.equal(
    googleSyncSummary(result),
    'Google Calendar synced: 3 created, 1 updated, 2 unchanged, 1 deleted.',
  )
})

test('Google Calendar sync rejects malformed counters', () => {
  assert.throws(() => toGoogleCalendarSyncResult({
    ok: false,
    created: -1,
    updated: 0,
    unchanged: 0,
    deleted: 0,
    failed: 1,
  }), /invalid synchronization counters/)
})
