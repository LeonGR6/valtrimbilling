import assert from 'node:assert/strict'
import test from 'node:test'
import {
  combineGoogleCalendarSyncRounds,
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
    calendar_summary: 'ValtrimBilling',
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

  assert.equal(connection.calendarSummary, 'ValtrimBilling')
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

test('Google Calendar sync results keep what is still pending and default to none', () => {
  const base = { ok: true, created: 0, updated: 0, unchanged: 4, deleted: 0, failed: 0 }

  assert.equal(toGoogleCalendarSyncResult(base).remaining, 0)

  const partial = toGoogleCalendarSyncResult({ ...base, created: 3, remaining: 5 })
  assert.equal(partial.remaining, 5)
  assert.equal(
    googleSyncSummary(partial),
    'Google Calendar partially synced: 3 created, 4 unchanged. 5 still pending: press Sync now again to finish.',
  )
  assert.throws(
    () => toGoogleCalendarSyncResult({ ...base, remaining: -1 }),
    /invalid synchronization counters/,
  )
})

test('Google Calendar sync rounds add up writes but keep the last view of the calendar', () => {
  const rounds = [
    { ok: true, created: 300, updated: 2, unchanged: 10, deleted: 0, failed: 1, remaining: 142, error: 'x', syncedAt: 'first' },
    { ok: true, created: 142, updated: 0, unchanged: 311, deleted: 4, failed: 0, remaining: 0, error: '', syncedAt: 'last' },
  ]

  assert.deepEqual(combineGoogleCalendarSyncRounds(rounds), {
    ok: true,
    created: 442,
    updated: 2,
    unchanged: 311,
    deleted: 4,
    failed: 0,
    remaining: 0,
    error: '',
    syncedAt: 'last',
  })
  assert.equal(
    googleSyncSummary(combineGoogleCalendarSyncRounds(rounds)),
    'Google Calendar synced: 442 created, 2 updated, 311 unchanged, 4 deleted.',
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
