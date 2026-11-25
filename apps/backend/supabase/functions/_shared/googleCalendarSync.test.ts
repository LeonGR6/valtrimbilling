import { assert, assertEquals, assertMatch } from '@std/assert'
import {
  buildGoogleCalendarEvent,
  googleEventColorId,
  hashGoogleCalendarEvent,
  refreshGoogleAccessToken,
  requiresGoogleReconnect,
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

  assertEquals(event.summary, 'River Walk · P3 B · (1–3, 5) · EXT')
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
  assertEquals(
    googleEventColorId({ stageType: 'DM', orderMaterial: false, dateOwner: 'TENTATIVE', variant: 'BASE' }),
    '6',
  )
  assertEquals(
    googleEventColorId({ stageType: 'DM', orderMaterial: false, dateOwner: 'SUPERVISOR', variant: 'BASE' }),
    '11',
  )
  assertEquals(
    googleEventColorId({ stageType: 'DM', orderMaterial: false, dateOwner: 'TENTATIVE', variant: 'BASEBOARD_INSTALL' }),
    '11',
  )
  assertEquals(
    googleEventColorId({ stageType: 'HW', orderMaterial: false, dateOwner: 'TENTATIVE', variant: 'BASE' }),
    '9',
  )
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

function manySchedules(count: number): GoogleCalendarSchedule[] {
  return Array.from({ length: count }, (_, index) => ({
    ...schedule,
    scheduleId: String(1000 + index),
    activityId: String(2000 + index),
    lotNumbers: [String(index + 1)],
  }))
}

const noSleep = () => Promise.resolve()

Deno.test('creates many events with a bounded number of Google writes in flight', async () => {
  let inFlight = 0
  let maxInFlight = 0
  const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
    if (!init?.method) return Response.json({ items: [] })
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 2))
    inFlight -= 1
    return Response.json({ id: `event-${crypto.randomUUID()}` })
  }) as typeof fetch

  const outcome = await synchronizeGoogleCalendar(
    snapshot(manySchedules(25)),
    'access-token',
    fetcher,
    { concurrency: 4, sleep: noSleep },
  )

  assertEquals(outcome.created, 25)
  assertEquals(outcome.failed, 0)
  assertEquals(outcome.remaining, 0)
  assertEquals(outcome.results.length, 25)
  assertEquals(maxInFlight, 4)
})

Deno.test('stops starting Google writes at the deadline and reports what is left', async () => {
  const methods: string[] = []
  let clock = 0
  const fetcher = ((_input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    methods.push(method)
    if (method === 'GET') return Promise.resolve(Response.json({ items: [] }))
    clock += 10
    return Promise.resolve(Response.json({ id: `event-${methods.length}` }))
  }) as typeof fetch

  const outcome = await synchronizeGoogleCalendar(
    snapshot(manySchedules(10), [{
      scheduleId: '77',
      googleEventId: 'google-event-77',
      payloadHash: 'c'.repeat(64),
      status: 'SYNCED',
    }]),
    'access-token',
    fetcher,
    { concurrency: 1, deadline: 30, now: () => clock, sleep: noSleep },
  )

  // Three creates reach the deadline; the 7 left and the pending deletion wait.
  assertEquals(outcome.created, 3)
  assertEquals(outcome.remaining, 8)
  assertEquals(outcome.results.length, 3)
  assertEquals(methods, ['GET', 'POST', 'POST', 'POST'])
  assertMatch(outcome.lastError ?? '', /8 Google Calendar operations still pending/u)
})

Deno.test('a second call resumes from what Google already holds without repeating creates', async () => {
  const stored = new Map<string, Record<string, unknown>>()
  let clock = 0
  const fetcher = ((_input: string | URL | Request, init?: RequestInit) => {
    if (!init?.method) {
      return Promise.resolve(Response.json({ items: [...stored.values()] }))
    }
    clock += 10
    const body = JSON.parse(String(init.body))
    const id = `event-${body.extendedProperties.private.valtrimScheduleId}`
    stored.set(id, { id, ...body })
    return Promise.resolve(Response.json({ id }))
  }) as typeof fetch
  const schedules = manySchedules(6)

  const first = await synchronizeGoogleCalendar(
    snapshot(schedules),
    'access-token',
    fetcher,
    { concurrency: 1, deadline: 40, now: () => clock, sleep: noSleep },
  )
  const second = await synchronizeGoogleCalendar(
    snapshot(schedules),
    'access-token',
    fetcher,
    { concurrency: 1, sleep: noSleep },
  )

  assertEquals(first.created, 4)
  assertEquals(first.remaining, 2)
  assertEquals(second.created, 2)
  assertEquals(second.unchanged, 4)
  assertEquals(second.remaining, 0)
  assertEquals(stored.size, 6)
})

Deno.test('retries a Google rate limit with a pause and then succeeds', async () => {
  const sleeps: number[] = []
  let posts = 0
  const fetcher = ((_input: string | URL | Request, init?: RequestInit) => {
    if (!init?.method) return Promise.resolve(Response.json({ items: [] }))
    posts += 1
    if (posts < 3) {
      return Promise.resolve(Response.json(
        { error: { code: 403, message: 'Rate Limit Exceeded', errors: [{ reason: 'rateLimitExceeded' }] } },
        { status: 403 },
      ))
    }
    return Promise.resolve(Response.json({ id: 'google-event-101' }))
  }) as typeof fetch

  const outcome = await synchronizeGoogleCalendar(
    snapshot(),
    'access-token',
    fetcher,
    { sleep: (ms) => { sleeps.push(ms); return Promise.resolve() } },
  )

  assertEquals(posts, 3)
  assertEquals(sleeps.length, 2)
  assert(sleeps[1] > sleeps[0])
  assertEquals(outcome.created, 1)
  assertEquals(outcome.failed, 0)
})

Deno.test('gives up on a persistent 429 and records the event as failed', async () => {
  let posts = 0
  const fetcher = ((_input: string | URL | Request, init?: RequestInit) => {
    if (!init?.method) return Promise.resolve(Response.json({ items: [] }))
    posts += 1
    return Promise.resolve(Response.json(
      { error: { code: 429, message: 'Too Many Requests' } },
      { status: 429 },
    ))
  }) as typeof fetch

  const outcome = await synchronizeGoogleCalendar(
    snapshot(),
    'access-token',
    fetcher,
    { sleep: noSleep },
  )

  assertEquals(posts, 4)
  assertEquals(outcome.created, 0)
  assertEquals(outcome.failed, 1)
  assertEquals(outcome.results[0].status, 'ERROR')
})

Deno.test('does not retry an error that is not a rate limit', async () => {
  let posts = 0
  const fetcher = ((_input: string | URL | Request, init?: RequestInit) => {
    if (!init?.method) return Promise.resolve(Response.json({ items: [] }))
    posts += 1
    return Promise.resolve(Response.json(
      { error: { code: 400, message: 'Invalid value' } },
      { status: 400 },
    ))
  }) as typeof fetch

  const outcome = await synchronizeGoogleCalendar(
    snapshot(),
    'access-token',
    fetcher,
    { sleep: noSleep },
  )

  assertEquals(posts, 1)
  assertEquals(outcome.failed, 1)
})

Deno.test('an expired Google authorization stops the whole sync', async () => {
  let posts = 0
  const fetcher = ((_input: string | URL | Request, init?: RequestInit) => {
    if (!init?.method) return Promise.resolve(Response.json({ items: [] }))
    posts += 1
    return Promise.resolve(Response.json(
      { error: { code: 401, message: 'Invalid Credentials' } },
      { status: 401 },
    ))
  }) as typeof fetch

  let rejected = false
  try {
    await synchronizeGoogleCalendar(
      snapshot(manySchedules(20)),
      'access-token',
      fetcher,
      { concurrency: 2, sleep: noSleep },
    )
  } catch (error) {
    rejected = requiresGoogleReconnect(error)
  }

  assert(rejected)
  assert(posts <= 4)
})

Deno.test('a baseboard install is named in its Google Calendar event', () => {
  const event = buildGoogleCalendarEvent({
    ...schedule,
    stageType: 'DM',
    variant: 'BASEBOARD_INSTALL',
    orderMaterial: false,
  })

  assertMatch(event.summary, / · DM BASEBOARD INSTALL$/u)
})

Deno.test('a weatherstripping is named in its Google Calendar event, in the HW color', () => {
  const weatherstripping = {
    ...schedule,
    stageType: 'HW' as const,
    variant: 'WEATHERSTRIPPING' as const,
    orderMaterial: false,
  }
  const event = buildGoogleCalendarEvent(weatherstripping)

  assertMatch(event.summary, / · HW WEATHERSTRIPPING$/u)
  assertEquals(googleEventColorId(weatherstripping), googleEventColorId({ ...weatherstripping, variant: 'BASE' }))
})

Deno.test('a confirmed event has "* " before its name in Google', () => {
  assertMatch(buildGoogleCalendarEvent({ ...schedule, confirmed: true }).summary, /^\* River Walk · /u)
  assertMatch(buildGoogleCalendarEvent({ ...schedule, confirmed: false }).summary, /^River Walk · /u)
})

Deno.test('Lots with a decimal are listed on their own, not joined into a range', () => {
  const event = buildGoogleCalendarEvent({ ...schedule, lotNumbers: ['12', '12.1', '13', '14'] })

  assertEquals(event.summary, 'River Walk · P3 B · (12, 12.1, 13–14) · EXT')
})

Deno.test('the Google name is the line of the Month view: Community · Phase Building · (Lots) · Event', () => {
  const event = buildGoogleCalendarEvent({
    ...schedule,
    stageType: 'HW',
    variant: 'BASE',
    community: 'ANZA',
    phaseCode: 'Phase 2',
    building: '2',
    lotNumbers: ['6', '7', '8', '9', '10', '11'],
  })

  assertEquals(event.summary, 'ANZA · P2 B2 · (6–11) · HW')
  assertEquals(
    buildGoogleCalendarEvent({ ...schedule, building: '', lotNumbers: ['4'] }).summary,
    'River Walk · P3 · (4) · EXT',
  )
})
