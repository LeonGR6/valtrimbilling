import { assert, assertEquals, assertMatch } from '@std/assert'
import {
  buildGoogleCalendarEvent,
  googleEventColorId,
  hashGoogleCalendarEvent,
  refreshGoogleAccessToken,
  synchronizeGoogleCalendar,
  type GoogleCalendarSchedule,
  type GoogleCalendarSyncSnapshot,
} from './googleCalendarSync.ts'

const schedule: GoogleCalendarSchedule = {
  scheduleId: '101',
  activityId: '22',
  stageType: 'EXT',
  variant: 'BASE',
  scheduledDate: '2026-09-14',
  dateOwner: 'TENTATIVE',
  scheduleNote: 'Confirm delivery.',
  activityNotes: 'Use north entrance.',
  orderMaterial: true,
  jobCode: 'JOB-01',
  community: 'River Walk',
  builderName: 'Acme Builder',
  phaseCode: '3',
  building: 'B',
  supervisorName: 'Sam Supervisor',
  superintendentName: 'Jamie Superintendent',
  lotNumbers: ['1', '2', '3', '5'],
  sourceUpdatedAt: '2026-09-14 20:00:00+00',
}

function snapshot(
  schedules: GoogleCalendarSchedule[] = [schedule],
  links: GoogleCalendarSyncSnapshot['links'] = [],
): GoogleCalendarSyncSnapshot {
  return {
    calendarId: 'calendar@group.calendar.google.com',
    refreshToken: 'refresh-token',
    schedules,
    links,
  }
}

Deno.test('refreshes a Google access token without exposing the refresh token', async () => {
  const calls: Array<{ url: string; body: string }> = []
  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body) })
    return Promise.resolve(Response.json({
      access_token: 'new-access-token',
      expires_in: 3600,
    }))
  }) as typeof fetch

  const accessToken = await refreshGoogleAccessToken(
    'client-id',
    'client-secret',
    'refresh-token',
    fetcher,
  )

  assertEquals(accessToken, 'new-access-token')
  assertEquals(calls.length, 1)
  assert(calls[0].body.includes('grant_type=refresh_token'))
  assert(calls[0].body.includes('refresh_token=refresh-token'))
})

Deno.test('builds a complete all-day Google event from persisted Production data', async () => {
  const event = buildGoogleCalendarEvent(schedule)

  assertEquals(event.summary, 'EXT FRAMES • Lots 1–3, 5')
  assertEquals(event.start.date, '2026-09-14')
  assertEquals(event.end.date, '2026-09-15')
  assertEquals(event.status, 'tentative')
  assertEquals(event.colorId, '5')
  assertEquals(event.extendedProperties.private.valtrimScheduleId, '101')
  assertMatch(event.description, /Changes made in Google are overwritten/u)
  assertMatch(await hashGoogleCalendarEvent(event), /^[0-9a-f]{64}$/u)
})

Deno.test('maps ValtrimBilling Production tones to Google event colors', () => {
  assertEquals(googleEventColorId({ stageType: 'EXT', orderMaterial: false }), '3')
  assertEquals(googleEventColorId({ stageType: 'EXT', orderMaterial: true }), '5')
  assertEquals(googleEventColorId({ stageType: 'DM', orderMaterial: false }), '11')
  assertEquals(googleEventColorId({ stageType: 'HW', orderMaterial: false }), '9')
  assertEquals(googleEventColorId({ stageType: 'SHUTTER', orderMaterial: false }), undefined)
})

Deno.test('creates a missing Google event and returns a durable mapping', async () => {
  const calls: Array<{ url: string; method: string }> = []
  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET' })
    if (!init?.method) return Promise.resolve(Response.json({ items: [] }))
    return Promise.resolve(Response.json({ id: 'google-event-101' }))
  }) as typeof fetch

  const outcome = await synchronizeGoogleCalendar(snapshot(), 'access-token', fetcher)

  assertEquals(outcome.created, 1)
  assertEquals(outcome.failed, 0)
  assertEquals(outcome.results[0].googleEventId, 'google-event-101')
  assertEquals(outcome.results[0].status, 'SYNCED')
  assertEquals(calls.map(({ method }) => method), ['GET', 'POST'])
})

Deno.test('leaves matching local events unchanged and deletes inactive linked events', async () => {
  const desired = buildGoogleCalendarEvent(schedule)
  const fetcher = ((_input: string | URL | Request, init?: RequestInit) => {
    if (!init?.method) {
      return Promise.resolve(Response.json({
        items: [
          { id: 'google-event-101', ...desired },
          {
            id: 'google-event-202',
            extendedProperties: {
              private: { valtrimSource: 'ValtrimBilling', valtrimScheduleId: '202' },
            },
          },
        ],
      }))
    }
    assertEquals(init.method, 'DELETE')
    return Promise.resolve(new Response(null, { status: 204 }))
  }) as typeof fetch

  const outcome = await synchronizeGoogleCalendar(snapshot([schedule], [{
    scheduleId: '202',
    googleEventId: 'google-event-202',
    payloadHash: 'a'.repeat(64),
    status: 'SYNCED',
  }]), 'access-token', fetcher)

  assertEquals(outcome.unchanged, 1)
  assertEquals(outcome.deleted, 1)
  assertEquals(outcome.results.find(({ scheduleId }) => scheduleId === '202')?.status, 'DELETED')
})

Deno.test('updates an existing Google event when its color differs from ValtrimBilling', async () => {
  const desired = buildGoogleCalendarEvent(schedule)
  const methods: string[] = []
  const fetcher = ((_input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    methods.push(method)
    if (method === 'GET') {
      return Promise.resolve(Response.json({
        items: [{ id: 'google-event-101', ...desired, colorId: '1' }],
      }))
    }
    assertEquals(method, 'PUT')
    assertEquals(JSON.parse(String(init?.body)).colorId, '5')
    return Promise.resolve(Response.json({ id: 'google-event-101' }))
  }) as typeof fetch

  const outcome = await synchronizeGoogleCalendar(snapshot(), 'access-token', fetcher)

  assertEquals(methods, ['GET', 'PUT'])
  assertEquals(outcome.updated, 1)
  assertEquals(outcome.created, 0)
  assertEquals(outcome.failed, 0)
})

Deno.test('recreates an event when its previous Google ID no longer exists', async () => {
  const methods: string[] = []
  const fetcher = ((_input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    methods.push(method)
    if (method === 'GET') return Promise.resolve(Response.json({ items: [] }))
    if (method === 'PUT') {
      return Promise.resolve(Response.json(
        { error: { message: 'Not found' } },
        { status: 404 },
      ))
    }
    return Promise.resolve(Response.json({ id: 'replacement-google-event' }))
  }) as typeof fetch

  const outcome = await synchronizeGoogleCalendar(snapshot([schedule], [{
    scheduleId: '101',
    googleEventId: 'deleted-google-event',
    payloadHash: 'b'.repeat(64),
    status: 'SYNCED',
  }]), 'access-token', fetcher)

  assertEquals(methods, ['GET', 'PUT', 'POST'])
  assertEquals(outcome.created, 1)
  assertEquals(outcome.results[0].googleEventId, 'replacement-google-event')
})
