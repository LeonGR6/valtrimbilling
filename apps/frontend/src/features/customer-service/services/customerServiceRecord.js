const EARTH_RADIUS_MILES = 3958.8

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function dateTimeParts(value, timeZone) {
  if (!value) return null

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value))

  return Object.fromEntries(parts.map(({ type, value: part }) => [type, part]))
}

export function toZonedDateTimeInput(value, timeZone = 'America/Los_Angeles') {
  const parts = dateTimeParts(value, timeZone)
  if (!parts) return ''

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

export function zonedDateTimeToIso(value, timeZone = 'America/Los_Angeles') {
  if (!value) return ''

  const [datePart, timePart] = value.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)
  const desiredWallTime = Date.UTC(year, month - 1, day, hour, minute)

  let instant = desiredWallTime
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = dateTimeParts(new Date(instant).toISOString(), timeZone)
    const observedWallTime = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    )
    instant -= observedWallTime - desiredWallTime
  }

  return new Date(instant).toISOString()
}

function toRadians(value) {
  return (value * Math.PI) / 180
}

export function calculateDistanceMiles(origin, destination) {
  if (
    origin.latitude === null || origin.longitude === null
    || destination.latitude === null || destination.longitude === null
  ) return null

  const latitudeDelta = toRadians(destination.latitude - origin.latitude)
  const longitudeDelta = toRadians(destination.longitude - origin.longitude)
  const originLatitude = toRadians(origin.latitude)
  const destinationLatitude = toRadians(destination.latitude)
  const haversine = (
    Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(originLatitude)
      * Math.cos(destinationLatitude)
      * Math.sin(longitudeDelta / 2) ** 2
  )

  return EARTH_RADIUS_MILES * 2 * Math.atan2(
    Math.sqrt(haversine),
    Math.sqrt(1 - haversine),
  )
}

function classifyDistance(distanceMiles, settings) {
  if (distanceMiles === null) return null
  if (distanceMiles <= settings.distanceGreenMaxMiles) return 'GREEN'
  if (distanceMiles <= settings.distanceYellowMaxMiles) return 'YELLOW'
  return 'RED'
}

function appointmentDate(row, timeZone) {
  return row.starts_at
    ? toZonedDateTimeInput(row.starts_at, timeZone).slice(0, 10)
    : ''
}

function appointmentTime(row, field, timeZone) {
  return row[field]
    ? toZonedDateTimeInput(row[field], timeZone).slice(11, 16)
    : ''
}

export function toCustomerServiceRequest(
  row,
  availabilityRows = [],
  settings,
) {
  const latitude = numberOrNull(row.latitude)
  const longitude = numberOrNull(row.longitude)
  const distanceMiles = calculateDistanceMiles(
    {
      latitude: settings.companyLatitude,
      longitude: settings.companyLongitude,
    },
    { latitude, longitude },
  )

  return {
    id: row.id,
    requestNumber: row.folio,
    propertyId: row.property_id,
    reportedAt: row.reported_on,
    dueOn: row.due_on,
    status: row.status,
    tag: row.tag ?? '',
    priority: row.priority,
    type: row.request_type,
    workType: row.work_type ?? '',
    estimatedDurationMinutes: row.estimated_duration_minutes ?? '',
    contactName: row.homeowner_name,
    contactEmail: row.homeowner_email ?? '',
    contactPhone: row.homeowner_phone ?? '',
    issue: row.description,
    internalNotes: row.internal_notes ?? '',
    customerAvailabilityNotes: row.customer_availability_notes ?? '',
    resolutionStatus: row.resolution_status ?? '',
    completionNotes: row.completion_notes ?? '',
    exceptionReason: row.exception_reason ?? '',
    statusBeforeClose: row.status_before_close ?? '',
    closedAt: row.closed_at ?? '',
    closeReason: row.close_reason ?? '',
    coordinatorUserId: row.coordinator_user_id ?? '',
    communityId: row.community_id ?? '',
    builderId: row.builder_id ?? '',
    builderName: row.builder_name ?? '',
    community: row.community_name ?? '',
    lotNumber: row.lot_number ?? '',
    street: row.address,
    city: row.city ?? '',
    state: row.state ?? '',
    postalCode: row.postal_code ?? '',
    plan: row.plan_label ?? '',
    latitude,
    longitude,
    distanceMiles,
    distanceBand: classifyDistance(distanceMiles, settings),
    appointmentState: row.current_appointment_id
      ? row.appointment_state
      : row.is_overdue ? 'OVERDUE' : 'NOT_SCHEDULED',
    appointmentDate: appointmentDate(row, settings.timeZone),
    appointmentStart: appointmentTime(row, 'starts_at', settings.timeZone),
    appointmentEnd: appointmentTime(row, 'ends_at', settings.timeZone),
    technicianId: row.technician_id ?? '',
    technicianName: row.technician_name ?? '',
    confirmationStatus: row.confirmation_status ?? '',
    isReadyToSchedule: Boolean(row.is_ready_to_schedule),
    isOverdue: Boolean(row.is_overdue),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    availability: availabilityRows.map((window) => ({
      id: window.id,
      availableFrom: toZonedDateTimeInput(
        window.available_from,
        settings.timeZone,
      ),
      availableUntil: toZonedDateTimeInput(
        window.available_until,
        settings.timeZone,
      ),
      notes: window.notes ?? '',
    })),
  }
}

export function toCustomerServiceRpcPayload(form, timeZone) {
  return {
    property: {
      communityId: null,
      lotNumber: form.lotNumber,
      address: form.street,
      city: form.city,
      state: form.state,
      postalCode: form.postalCode,
      planLabel: form.plan,
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
    },
    request: {
      reportedOn: form.reportedAt,
      contactName: form.contactName,
      contactEmail: form.contactEmail,
      contactPhone: form.contactPhone,
      type: form.type,
      priority: form.priority,
      issue: form.issue,
      internalNotes: form.internalNotes,
      workType: form.workType,
      estimatedDurationMinutes: Number(form.estimatedDurationMinutes),
      customerAvailabilityNotes: form.customerAvailabilityNotes,
    },
    availability: form.availability.map((window) => ({
      availableFrom: zonedDateTimeToIso(window.availableFrom, timeZone),
      availableUntil: zonedDateTimeToIso(window.availableUntil, timeZone),
      notes: window.notes,
    })),
  }
}
