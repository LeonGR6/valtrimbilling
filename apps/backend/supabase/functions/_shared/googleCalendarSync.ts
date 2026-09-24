const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_CALENDAR_API_URL = 'https://www.googleapis.com/calendar/v3'
const VALTRIM_SOURCE = 'ValtrimBilling'

const GOOGLE_EVENT_COLOR_IDS = {
  EXT: '3',
  EXT_ORDER_MATERIAL: '5',
  DM: '11',
  HW: '9',
} as const

type Fetcher = typeof fetch

export interface GoogleCalendarSchedule {
  scheduleId: string
  activityId: string
  stageType: 'EXT' | 'SHUTTER' | 'DM' | 'HW'
  variant: 'BASE' | 'DIVISION' | 'INSTALL_ONLY' | 'LOCK_UP'
  scheduledDate: string
  dateOwner: 'SUPERVISOR' | 'JOBSITE_SUPERINTENDENT' | 'TENTATIVE'
  scheduleNote: string
  activityNotes: string
  orderMaterial: boolean
  jobCode: string
  community: string
  builderName: string
  phaseCode: string
  building: string
  supervisorName: string
  superintendentName: string
  lotNumbers: string[]
  sourceUpdatedAt: string
}

export interface GoogleCalendarLink {
  scheduleId: string
  googleEventId: string | null
  payloadHash: string | null
  status: 'SYNCED' | 'DELETED' | 'ERROR'
}

export interface GoogleCalendarSyncSnapshot {
  calendarId: string
  refreshToken: string
  schedules: GoogleCalendarSchedule[]
  links: GoogleCalendarLink[]
}

interface GoogleEventPayload {
  summary: string
  description: string
  location: string
  colorId?: string
  start: { date: string }
  end: { date: string }
  status: 'confirmed' | 'tentative'
  extendedProperties: {
    private: Record<string, string>
  }
}

interface GoogleEventResource {
  id?: string
  etag?: string
  summary?: string
  description?: string
  location?: string
  colorId?: string
  start?: { date?: string }
  end?: { date?: string }
  status?: string
  extendedProperties?: {
    private?: Record<string, string>
  }
}

interface ManagedGoogleEvent {
  id: string
  scheduleId: string
  resource: GoogleEventResource
}

export interface GoogleCalendarSyncResult {
  scheduleId: string
  googleEventId: string | null
  payloadHash: string | null
  status: 'SYNCED' | 'DELETED' | 'ERROR'
  lastError: string | null
}

export interface GoogleCalendarSyncOutcome {
  created: number
  updated: number
  unchanged: number
  deleted: number
  failed: number
  lastError: string | null
  results: GoogleCalendarSyncResult[]
}

export class GoogleCalendarRequestError extends Error {
  readonly operation: string
  readonly status: number
  readonly code: string | null
  readonly reason: string | null

  constructor(
    operation: string,
    status: number,
    message: string,
    code: string | null = null,
    reason: string | null = null,
  ) {
    super(`${operation} failed: ${message}`)
    this.name = 'GoogleCalendarRequestError'
    this.operation = operation
    this.status = status
    this.code = code
    this.reason = reason
  }
}

async function responsePayload(response: Response) {
  return await response.json().catch(() => null) as Record<string, unknown> | null
}

function googleErrorDetails(
  response: Response,
  payload: Record<string, unknown> | null,
) {
  const rawError = payload?.error
  if (typeof rawError === 'string') {
    return {
      code: rawError,
      reason: rawError,
      message: typeof payload?.error_description === 'string'
        ? payload.error_description
        : rawError,
    }
  }

  if (rawError && typeof rawError === 'object') {
    const error = rawError as Record<string, unknown>
    const errors = Array.isArray(error.errors) ? error.errors : []
    const first = errors[0]
    const reason = first && typeof first === 'object'
      && typeof (first as Record<string, unknown>).reason === 'string'
      ? (first as Record<string, unknown>).reason as string
      : null
    return {
      code: typeof error.code === 'string' ? error.code : null,
      reason,
      message: typeof error.message === 'string'
        ? error.message
        : `HTTP ${response.status}`,
    }
  }

  return {
    code: null,
    reason: null,
    message: `HTTP ${response.status}`,
  }
}

async function googleRequestError(
  operation: string,
  response: Response,
  suppliedPayload?: Record<string, unknown> | null,
) {
  const payload = suppliedPayload === undefined
    ? await responsePayload(response)
    : suppliedPayload
  const details = googleErrorDetails(response, payload)
  return new GoogleCalendarRequestError(
    operation,
    response.status,
    details.message,
    details.code,
    details.reason,
  )
}

export function requiresGoogleReconnect(error: unknown) {
  if (!(error instanceof GoogleCalendarRequestError)) return false
  return error.status === 401
    || error.code === 'invalid_grant'
    || error.code === 'invalid_client'
    || error.reason === 'authError'
    || error.reason === 'insufficientPermissions'
    || (error.operation === 'Listing ValtrimBilling Google events' && error.status === 404)
}

export async function refreshGoogleAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const payload = await responsePayload(response)
  if (!response.ok) {
    throw await googleRequestError('Google OAuth refresh', response, payload)
  }

  const accessToken = payload?.access_token
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new Error('Google OAuth refresh returned an invalid access token.')
  }
  return accessToken
}

function addOneDay(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    throw new Error(`Invalid Production schedule date: ${date}.`)
  }
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + 1))
  return next.toISOString().slice(0, 10)
}

function labeledValue(prefix: string, value: string) {
  if (!value) return ''
  return value.toLowerCase().startsWith(prefix.toLowerCase())
    ? value
    : `${prefix} ${value}`
}

function lotLabel(lotNumbers: string[]) {
  const numericLots = [...new Set(lotNumbers.map(Number).filter(Number.isFinite))]
    .sort((left, right) => left - right)

  if (numericLots.length === lotNumbers.length && numericLots.length > 0) {
    const ranges: string[] = []
    let start = numericLots[0]
    let end = numericLots[0]
    for (const lot of numericLots.slice(1)) {
      if (lot === end + 1) {
        end = lot
      } else {
        ranges.push(start === end ? `${start}` : `${start}–${end}`)
        start = lot
        end = lot
      }
    }
    ranges.push(start === end ? `${start}` : `${start}–${end}`)
    return `${numericLots.length === 1 ? 'Lot' : 'Lots'} ${ranges.join(', ')}`
  }

  const labels = lotNumbers.map(String).filter(Boolean)
  return `${labels.length === 1 ? 'Lot' : 'Lots'} ${labels.join(', ')}`
}

function stageLabel(stageType: GoogleCalendarSchedule['stageType']) {
  return {
    EXT: 'EXT FRAMES',
    SHUTTER: 'Shutter',
    DM: 'DM',
    HW: 'Hardware',
  }[stageType]
}

function variantSuffix(variant: GoogleCalendarSchedule['variant']) {
  return {
    BASE: '',
    DIVISION: '',
    INSTALL_ONLY: ' INSTALL ONLY',
    LOCK_UP: ' LOCK UP',
  }[variant]
}

function dateOwnerLabel(owner: GoogleCalendarSchedule['dateOwner']) {
  return {
    SUPERVISOR: 'Supervisor',
    JOBSITE_SUPERINTENDENT: 'Jobsite Superintendent',
    TENTATIVE: 'Tentative',
  }[owner]
}

export function googleEventColorId(
  schedule: Pick<GoogleCalendarSchedule, 'stageType' | 'orderMaterial'>,
) {
  if (schedule.stageType === 'EXT') {
    return schedule.orderMaterial
      ? GOOGLE_EVENT_COLOR_IDS.EXT_ORDER_MATERIAL
      : GOOGLE_EVENT_COLOR_IDS.EXT
  }
  if (schedule.stageType === 'DM') return GOOGLE_EVENT_COLOR_IDS.DM
  if (schedule.stageType === 'HW') return GOOGLE_EVENT_COLOR_IDS.HW
  return undefined
}

export function buildGoogleCalendarEvent(
  schedule: GoogleCalendarSchedule,
): GoogleEventPayload {
  const lots = lotLabel(schedule.lotNumbers)
  const phase = labeledValue('Phase', schedule.phaseCode)
  const building = labeledValue('Building', schedule.building)
  const description = [
    'Managed by ValtrimBilling. Changes made in Google are overwritten by Sync now.',
    '',
    `Builder: ${schedule.builderName}`,
    `Job: ${schedule.jobCode}`,
    `Community: ${schedule.community}`,
    `Phase: ${phase}`,
    ...(building ? [`Building: ${building}`] : []),
    `Lots: ${lots}`,
    `Supervisor: ${schedule.supervisorName}`,
    `Jobsite Superintendent: ${schedule.superintendentName}`,
    `Date owner: ${dateOwnerLabel(schedule.dateOwner)}`,
    ...(schedule.orderMaterial ? ['Order material: Yes'] : []),
    ...(schedule.scheduleNote ? [`Schedule note: ${schedule.scheduleNote}`] : []),
    ...(schedule.activityNotes ? [`Activity notes: ${schedule.activityNotes}`] : []),
  ].join('\n')
  const colorId = googleEventColorId(schedule)

  return {
    summary: `${stageLabel(schedule.stageType)}${variantSuffix(schedule.variant)} • ${lots}`,
    description,
    location: `${schedule.builderName} — ${schedule.community}`,
    ...(colorId ? { colorId } : {}),
    start: { date: schedule.scheduledDate },
    end: { date: addOneDay(schedule.scheduledDate) },
    status: schedule.dateOwner === 'TENTATIVE' ? 'tentative' : 'confirmed',
    extendedProperties: {
      private: {
        valtrimSource: VALTRIM_SOURCE,
        valtrimSchemaVersion: '1',
        valtrimScheduleId: schedule.scheduleId,
        valtrimActivityId: schedule.activityId,
        valtrimSourceUpdatedAt: schedule.sourceUpdatedAt,
      },
    },
  }
}

export async function hashGoogleCalendarEvent(payload: GoogleEventPayload) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(payload)),
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function comparableEvent(
  resource: GoogleEventResource,
  desired: GoogleEventPayload,
) {
  const privateProperties = resource.extendedProperties?.private ?? {}
  return {
    summary: resource.summary ?? '',
    description: resource.description ?? '',
    location: resource.location ?? '',
    ...(desired.colorId ? { colorId: resource.colorId ?? '' } : {}),
    start: { date: resource.start?.date ?? '' },
    end: { date: resource.end?.date ?? '' },
    status: resource.status ?? '',
    extendedProperties: {
      private: Object.fromEntries(Object.keys(desired.extendedProperties.private).map((key) => [
        key,
        privateProperties[key] ?? '',
      ])),
    },
  }
}

export function googleEventMatches(
  resource: GoogleEventResource,
  desired: GoogleEventPayload,
) {
  return JSON.stringify(comparableEvent(resource, desired)) === JSON.stringify(desired)
}

export async function listManagedGoogleEvents(
  accessToken: string,
  calendarId: string,
  fetcher: Fetcher = fetch,
) {
  const managed: ManagedGoogleEvent[] = []
  let pageToken: string | null = null

  do {
    const url = new URL(
      `${GOOGLE_CALENDAR_API_URL}/calendars/${encodeURIComponent(calendarId)}/events`,
    )
    url.searchParams.set('privateExtendedProperty', `valtrimSource=${VALTRIM_SOURCE}`)
    url.searchParams.set('showDeleted', 'false')
    url.searchParams.set('maxResults', '2500')
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const payload = await responsePayload(response)
    if (!response.ok) {
      throw await googleRequestError(
        'Listing ValtrimBilling Google events',
        response,
        payload,
      )
    }

    const items = Array.isArray(payload?.items) ? payload.items : []
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const resource = item as GoogleEventResource
      const scheduleId = resource.extendedProperties?.private?.valtrimScheduleId
      if (typeof resource.id === 'string' && /^\d+$/u.test(scheduleId ?? '')) {
        managed.push({ id: resource.id, scheduleId: scheduleId!, resource })
      }
    }
    pageToken = typeof payload?.nextPageToken === 'string'
      ? payload.nextPageToken
      : null
  } while (pageToken)

  return managed
}

async function upsertGoogleEvent(
  accessToken: string,
  calendarId: string,
  desired: GoogleEventPayload,
  existingEventId: string | null,
  fetcher: Fetcher,
) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
  const collectionUrl =
    `${GOOGLE_CALENDAR_API_URL}/calendars/${encodeURIComponent(calendarId)}/events`

  if (existingEventId) {
    const updateResponse = await fetcher(
      `${collectionUrl}/${encodeURIComponent(existingEventId)}?sendUpdates=none`,
      { method: 'PUT', headers, body: JSON.stringify(desired) },
    )
    if (updateResponse.ok) {
      const payload = await responsePayload(updateResponse)
      const id = payload?.id
      if (typeof id !== 'string' || !id) {
        throw new Error('Google Calendar returned an invalid updated event.')
      }
      return { id, action: 'updated' as const }
    }
    if (![404, 410].includes(updateResponse.status)) {
      throw await googleRequestError('Updating a Google event', updateResponse)
    }
  }

  const createResponse = await fetcher(`${collectionUrl}?sendUpdates=none`, {
    method: 'POST',
    headers,
    body: JSON.stringify(desired),
  })
  if (!createResponse.ok) {
    throw await googleRequestError('Creating a Google event', createResponse)
  }
  const payload = await responsePayload(createResponse)
  const id = payload?.id
  if (typeof id !== 'string' || !id) {
    throw new Error('Google Calendar returned an invalid created event.')
  }
  return { id, action: 'created' as const }
}

async function deleteGoogleEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  fetcher: Fetcher,
) {
  const response = await fetcher(
    `${GOOGLE_CALENDAR_API_URL}/calendars/${encodeURIComponent(calendarId)}`
      + `/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  )
  if (response.ok) return true
  if ([404, 410].includes(response.status)) return false
  throw await googleRequestError('Deleting a Google event', response)
}

function shortError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown Google Calendar error.'
  return message.slice(0, 1000)
}

export async function synchronizeGoogleCalendar(
  snapshot: GoogleCalendarSyncSnapshot,
  accessToken: string,
  fetcher: Fetcher = fetch,
): Promise<GoogleCalendarSyncOutcome> {
  const remoteEvents = await listManagedGoogleEvents(
    accessToken,
    snapshot.calendarId,
    fetcher,
  )
  const activeScheduleIds = new Set(snapshot.schedules.map(({ scheduleId }) => scheduleId))
  const links = new Map(snapshot.links.map((link) => [link.scheduleId, link]))
  const remoteBySchedule = new Map<string, ManagedGoogleEvent>()
  const remoteToDelete: ManagedGoogleEvent[] = []
  const results = new Map<string, GoogleCalendarSyncResult>()
  const deletedEventIds = new Set<string>()
  const errors: string[] = []
  let created = 0
  let updated = 0
  let unchanged = 0
  let deleted = 0
  let failed = 0

  for (const remote of remoteEvents) {
    if (!activeScheduleIds.has(remote.scheduleId) || remoteBySchedule.has(remote.scheduleId)) {
      remoteToDelete.push(remote)
    } else {
      remoteBySchedule.set(remote.scheduleId, remote)
    }
  }

  for (const schedule of snapshot.schedules) {
    const desired = buildGoogleCalendarEvent(schedule)
    const payloadHash = await hashGoogleCalendarEvent(desired)
    const remote = remoteBySchedule.get(schedule.scheduleId)
    const linkedId = links.get(schedule.scheduleId)?.googleEventId ?? null

    try {
      if (remote && googleEventMatches(remote.resource, desired)) {
        unchanged += 1
        results.set(schedule.scheduleId, {
          scheduleId: schedule.scheduleId,
          googleEventId: remote.id,
          payloadHash,
          status: 'SYNCED',
          lastError: null,
        })
        continue
      }

      const saved = await upsertGoogleEvent(
        accessToken,
        snapshot.calendarId,
        desired,
        remote?.id ?? linkedId,
        fetcher,
      )
      if (saved.action === 'created') created += 1
      else updated += 1
      results.set(schedule.scheduleId, {
        scheduleId: schedule.scheduleId,
        googleEventId: saved.id,
        payloadHash,
        status: 'SYNCED',
        lastError: null,
      })
    } catch (error) {
      if (requiresGoogleReconnect(error)) throw error
      failed += 1
      const message = shortError(error)
      errors.push(message)
      results.set(schedule.scheduleId, {
        scheduleId: schedule.scheduleId,
        googleEventId: remote?.id ?? linkedId,
        payloadHash: null,
        status: 'ERROR',
        lastError: message,
      })
    }
  }

  for (const remote of remoteToDelete) {
    try {
      if (await deleteGoogleEvent(
        accessToken,
        snapshot.calendarId,
        remote.id,
        fetcher,
      )) deleted += 1
      deletedEventIds.add(remote.id)

      if (!activeScheduleIds.has(remote.scheduleId) && links.has(remote.scheduleId)) {
        results.set(remote.scheduleId, {
          scheduleId: remote.scheduleId,
          googleEventId: remote.id,
          payloadHash: null,
          status: 'DELETED',
          lastError: null,
        })
      }
    } catch (error) {
      if (requiresGoogleReconnect(error)) throw error
      failed += 1
      const message = shortError(error)
      errors.push(message)
      if (!activeScheduleIds.has(remote.scheduleId) && links.has(remote.scheduleId)) {
        results.set(remote.scheduleId, {
          scheduleId: remote.scheduleId,
          googleEventId: remote.id,
          payloadHash: null,
          status: 'ERROR',
          lastError: message,
        })
      }
    }
  }

  for (const link of snapshot.links) {
    if (activeScheduleIds.has(link.scheduleId) || link.status === 'DELETED') continue
    if (results.has(link.scheduleId)) continue

    try {
      if (link.googleEventId && !deletedEventIds.has(link.googleEventId)) {
        if (await deleteGoogleEvent(
          accessToken,
          snapshot.calendarId,
          link.googleEventId,
          fetcher,
        )) deleted += 1
      }
      results.set(link.scheduleId, {
        scheduleId: link.scheduleId,
        googleEventId: link.googleEventId,
        payloadHash: null,
        status: 'DELETED',
        lastError: null,
      })
    } catch (error) {
      if (requiresGoogleReconnect(error)) throw error
      failed += 1
      const message = shortError(error)
      errors.push(message)
      results.set(link.scheduleId, {
        scheduleId: link.scheduleId,
        googleEventId: link.googleEventId,
        payloadHash: null,
        status: 'ERROR',
        lastError: message,
      })
    }
  }

  return {
    created,
    updated,
    unchanged,
    deleted,
    failed,
    lastError: failed > 0
      ? `${failed} Google Calendar operation${failed === 1 ? '' : 's'} failed. ${errors[0]}`
        .slice(0, 1000)
      : null,
    results: [...results.values()],
  }
}
